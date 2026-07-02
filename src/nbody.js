// A cosmological particle-mesh N-body code, running on the GPU.
//
// This is the real algorithm used by cosmology codes, miniaturized:
//   1. deposit 262,144 particles onto a 64³ mesh (NGP, additive blending)
//   2. solve Poisson's equation in Fourier space:  φ_k = −(3Ωm/2a) δ_k / k²
//      via a Stockham radix-2 FFT (6 passes per axis, forward + inverse)
//   3. difference the potential for forces, then kick momenta / drift
//      positions with the ΛCDM factors:  dp/da = −∇φ/(aE),  dx/da = p/(a³E)
//
// Initial conditions are the same Zel'dovich displacement field the linear
// scale uses — so the web forms in the same places, but here gravity is
// genuinely self-consistent: after shell-crossing, filaments stay thin and
// halos virialize instead of streaming apart.
//
// Comoving box = 1, time unit = 1/H0. The k=0 mode is zeroed (mean removal);
// a Gaussian cutoff at ~1 cell suppresses NGP grid noise.

import * as THREE from 'three';
import { COSMO } from './cosmology.js';

const G = 64;                 // mesh cells per axis
const TILES = 8;              // G³ flattened into TILES×TILES slices
const TEX = G * TILES;        // 512
const PN = 512;               // particle texture side → PN² = 262,144 particles

const LAYOUT = /* glsl */`
  const int G = ${G};
  const int TILES = ${TILES};
  ivec3 texelToCell(ivec2 t) {
    return ivec3(t.x % G, t.y % G, (t.y / G) * TILES + (t.x / G));
  }
  ivec2 cellToTexel(ivec3 c) {
    c = (c % G + G) % G;
    return ivec2((c.z % TILES) * G + c.x, (c.z / TILES) * G + c.y);
  }
`;

const QUAD_VERT = /* glsl */`
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

// ---- Zel'dovich initial conditions (positions + momenta) ------------------
const IC_FRAG = (K) => /* glsl */`
  precision highp float;
  uniform vec3 uK[${K}];
  uniform vec2 uAP[${K}];
  uniform float uD;      // D(a0)
  uniform float uPfac;   // a0² E(a0) f(a0) D(a0)
  uniform int uWhich;    // 0 = positions, 1 = momenta
  out vec4 frag;

  float hash(float n) { return fract(sin(n) * 43758.5453123); }

  void main() {
    ivec2 t = ivec2(gl_FragCoord.xy);
    int id = t.y * ${PN} + t.x;
    // lagrangian grid: 64³ + deterministic jitter
    int ix = id % ${G}, iy = (id / ${G}) % ${G}, iz = id / ${G * G};
    float fid = float(id);
    vec3 q = (vec3(ix, iy, iz) + 0.5 +
      (vec3(hash(fid * 0.731 + 1.3), hash(fid * 1.193 + 7.7), hash(fid * 0.577 + 3.1)) - 0.5) * 0.9
    ) / float(${G});

    vec3 psi = vec3(0.0);
    for (int i = 0; i < ${K}; i++) {
      vec3 k = uK[i];
      psi += (uAP[i].x / length(k)) * k * sin(dot(k, q) + uAP[i].y);
    }
    frag = (uWhich == 0)
      ? vec4(fract(q + uD * psi), 1.0)
      : vec4(uPfac * psi, 0.0);
  }
`;

// ---- NGP mass deposition ---------------------------------------------------
const DEPOSIT_VERT = /* glsl */`
  precision highp float;
  uniform sampler2D uPos;
  ${LAYOUT}
  void main() {
    ivec2 t = ivec2(gl_VertexID % ${PN}, gl_VertexID / ${PN});
    vec3 x = fract(texelFetch(uPos, t, 0).xyz);
    ivec3 cell = ivec3(x * float(G)) % G;
    vec2 uv = (vec2(cellToTexel(cell)) + 0.5) / float(${TEX});
    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
    gl_PointSize = 1.0;
  }
`;
const DEPOSIT_FRAG = /* glsl */`
  precision highp float;
  out vec4 frag;
  void main() { frag = vec4(1.0, 0.0, 0.0, 0.0); }
`;

// ---- Stockham FFT, one axis, one stage ------------------------------------
const FFT_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uSrc;
  uniform float uSubSize;   // 2, 4, ..., G
  uniform int uAxis;        // 0/1/2
  uniform float uSign;      // -1 forward, +1 inverse
  out vec4 frag;
  ${LAYOUT}

  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }

  void main() {
    ivec3 cell = texelToCell(ivec2(gl_FragCoord.xy));
    int idx = uAxis == 0 ? cell.x : (uAxis == 1 ? cell.y : cell.z);
    float fi = float(idx);
    float evenIdx = floor(fi / uSubSize) * (uSubSize * 0.5) + mod(fi, uSubSize * 0.5);
    int e = int(evenIdx);
    int o = e + G / 2;
    ivec3 ec = cell, oc = cell;
    if (uAxis == 0) { ec.x = e; oc.x = o; }
    else if (uAxis == 1) { ec.y = e; oc.y = o; }
    else { ec.z = e; oc.z = o; }
    vec2 even = texelFetch(uSrc, cellToTexel(ec), 0).xy;
    vec2 odd  = texelFetch(uSrc, cellToTexel(oc), 0).xy;
    float ang = uSign * 6.283185307 * mod(fi, uSubSize) / uSubSize;
    frag = vec4(even + cmul(vec2(cos(ang), sin(ang)), odd), 0.0, 0.0);
  }
`;

// ---- Poisson: multiply by the ΛCDM Green's function ------------------------
const GREEN_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uSrc;
  uniform float uA;        // scale factor
  uniform float uOm;
  out vec4 frag;
  ${LAYOUT}
  void main() {
    ivec3 cell = texelToCell(ivec2(gl_FragCoord.xy));
    ivec3 m = cell;
    if (m.x >= G/2) m.x -= G;
    if (m.y >= G/2) m.y -= G;
    if (m.z >= G/2) m.z -= G;
    vec3 k = 6.283185307 * vec3(m);
    float k2 = dot(k, k);
    vec2 d = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0).xy;
    if (k2 < 1.0) { frag = vec4(0.0); return; }   // zero the mean (k = 0)
    float cellW = 1.0 / float(G);
    float smooth_ = exp(-k2 * cellW * cellW * 1.44);  // NGP noise suppression
    // Green fn × FFT round-trip normalization (1/G³)
    float g = -1.5 * uOm / (uA * k2) * smooth_ / float(G*G*G);
    frag = vec4(d * g, 0.0, 0.0);
  }
`;

// ---- forces: −∇φ by central differences ------------------------------------
const FORCE_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uPhi;
  out vec4 frag;
  ${LAYOUT}
  float phi(ivec3 c) { return texelFetch(uPhi, cellToTexel(c), 0).x; }
  void main() {
    ivec3 c = texelToCell(ivec2(gl_FragCoord.xy));
    float h2 = 2.0 / float(G);
    frag = vec4(
      -(phi(c + ivec3(1,0,0)) - phi(c - ivec3(1,0,0))) / h2,
      -(phi(c + ivec3(0,1,0)) - phi(c - ivec3(0,1,0))) / h2,
      -(phi(c + ivec3(0,0,1)) - phi(c - ivec3(0,0,1))) / h2,
      0.0);
  }
`;

// ---- kick / drift -----------------------------------------------------------
const KICK_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uPos;
  uniform sampler2D uVel;
  uniform sampler2D uForce;
  uniform float uDa;
  uniform float uAE;       // a·E(a)
  out vec4 frag;
  ${LAYOUT}
  void main() {
    ivec2 t = ivec2(gl_FragCoord.xy);
    vec3 x = texelFetch(uPos, t, 0).xyz;
    vec3 p = texelFetch(uVel, t, 0).xyz;
    // trilinear force interpolation across the two bracketing slices
    vec3 g = fract(x) * float(G) - 0.5;
    ivec3 c0 = ivec3(floor(g));
    vec3 f = g - vec3(c0);
    vec3 F = vec3(0.0);
    for (int dz = 0; dz <= 1; dz++)
      for (int dy = 0; dy <= 1; dy++)
        for (int dx = 0; dx <= 1; dx++) {
          float w = (dx == 1 ? f.x : 1.0 - f.x) *
                    (dy == 1 ? f.y : 1.0 - f.y) *
                    (dz == 1 ? f.z : 1.0 - f.z);
          F += w * texelFetch(uForce, cellToTexel(c0 + ivec3(dx, dy, dz)), 0).xyz;
        }
    frag = vec4(p + F * (uDa / uAE), 0.0);
  }
`;

const DRIFT_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uPos;
  uniform sampler2D uVel;
  uniform float uDa;
  uniform float uA3E;      // a³·E(a)
  out vec4 frag;
  void main() {
    ivec2 t = ivec2(gl_FragCoord.xy);
    vec3 x = texelFetch(uPos, t, 0).xyz;
    vec3 p = texelFetch(uVel, t, 0).xyz;
    frag = vec4(fract(x + p * (uDa / uA3E)), 1.0);
  }
`;

export class NBodySim {
  /**
   * @param modes  the Zel'dovich plane-wave set from CosmicScale, in display
   *               units of box size `boxDisp` — converted to box=1 here.
   */
  constructor(renderer, modes, boxDisp, a0) {
    this.renderer = renderer;
    const gl = renderer.getContext();
    if (!renderer.capabilities.isWebGL2) throw new Error('nbody: needs WebGL2');
    if (!renderer.extensions.get('EXT_color_buffer_float')) throw new Error('nbody: no float RT');
    if (!gl.getExtension('EXT_float_blend')) throw new Error('nbody: no float blending');

    this.a = a0;
    this.particleCount = PN * PN;

    const rt = (size) => new THREE.WebGLRenderTarget(size, size, {
      type: THREE.FloatType, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false,
    });
    this.posA = rt(PN); this.posB = rt(PN);
    this.velA = rt(PN); this.velB = rt(PN);
    this.density = rt(TEX);
    this.fftA = rt(TEX); this.fftB = rt(TEX);
    this.force = rt(TEX);

    // fullscreen quad plumbing
    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);

    const mat = (frag, uniforms) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: QUAD_VERT, fragmentShader: frag,
      uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });

    const K = modes.length;
    const kArr = [], apArr = [];
    for (const m of modes) {
      kArr.push(new THREE.Vector3(m.k[0] * boxDisp, m.k[1] * boxDisp, m.k[2] * boxDisp));
      apArr.push(new THREE.Vector2(m.amp / boxDisp, m.phase));
    }
    this.icMat = mat(IC_FRAG(K), {
      uK: { value: kArr }, uAP: { value: apArr },
      uD: { value: 0 }, uPfac: { value: 0 }, uWhich: { value: 0 },
    });
    this.fftMat = mat(FFT_FRAG, {
      uSrc: { value: null }, uSubSize: { value: 2 }, uAxis: { value: 0 }, uSign: { value: -1 },
    });
    this.greenMat = mat(GREEN_FRAG, {
      uSrc: { value: null }, uA: { value: 1 }, uOm: { value: COSMO.OmegaM },
    });
    this.forceMat = mat(FORCE_FRAG, { uPhi: { value: null } });
    this.kickMat = mat(KICK_FRAG, {
      uPos: { value: null }, uVel: { value: null }, uForce: { value: null },
      uDa: { value: 0 }, uAE: { value: 1 },
    });
    this.driftMat = mat(DRIFT_FRAG, {
      uPos: { value: null }, uVel: { value: null }, uDa: { value: 0 }, uA3E: { value: 1 },
    });

    // deposit: one gl.POINT per particle
    const depGeo = new THREE.BufferGeometry();
    depGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.particleCount * 3), 3));
    depGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
    this.depositPoints = new THREE.Points(depGeo, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: DEPOSIT_VERT, fragmentShader: DEPOSIT_FRAG,
      uniforms: { uPos: { value: null } },
      depthTest: false, depthWrite: false, transparent: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
    }));
    this.depositPoints.frustumCulled = false;
    this.depositScene = new THREE.Scene();
    this.depositScene.add(this.depositPoints);

    this.reset(a0);
  }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  reset(a0) {
    this.a = a0;
    this.icMat.uniforms.uD.value = COSMO.growth(a0);
    this.icMat.uniforms.uPfac.value =
      a0 * a0 * COSMO.E(a0) * COSMO.growthRate(a0) * COSMO.growth(a0);
    this.icMat.uniforms.uWhich.value = 0;
    this._pass(this.icMat, this.posA);
    this.icMat.uniforms.uWhich.value = 1;
    this._pass(this.icMat, this.velA);
    this._depositAndSolve(); // so the first rendered frame has densities
    this.renderer.setRenderTarget(null);
  }

  _depositAndSolve() {
    const r = this.renderer;
    // deposit
    this.depositPoints.material.uniforms.uPos.value = this.posA.texture;
    r.setRenderTarget(this.density);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    r.render(this.depositScene, this.quadCam);

    // forward FFT of counts (real input; imag arrives as 0 via R channel copy)
    let src = this.density, dst = this.fftA, other = this.fftB;
    for (let axis = 0; axis < 3; axis++) {
      for (let sub = 2; sub <= G; sub *= 2) {
        this.fftMat.uniforms.uSrc.value = src.texture;
        this.fftMat.uniforms.uSubSize.value = sub;
        this.fftMat.uniforms.uAxis.value = axis;
        this.fftMat.uniforms.uSign.value = -1;
        this._pass(this.fftMat, dst);
        src = dst; dst = (src === this.fftA) ? this.fftB : this.fftA;
      }
    }
    // Green's function
    this.greenMat.uniforms.uSrc.value = src.texture;
    this.greenMat.uniforms.uA.value = this.a;
    this._pass(this.greenMat, dst);
    src = dst; dst = (src === this.fftA) ? this.fftB : this.fftA;
    // inverse FFT → φ(x)
    for (let axis = 0; axis < 3; axis++) {
      for (let sub = 2; sub <= G; sub *= 2) {
        this.fftMat.uniforms.uSrc.value = src.texture;
        this.fftMat.uniforms.uSubSize.value = sub;
        this.fftMat.uniforms.uAxis.value = axis;
        this.fftMat.uniforms.uSign.value = 1;
        this._pass(this.fftMat, dst);
        src = dst; dst = (src === this.fftA) ? this.fftB : this.fftA;
      }
    }
    // forces
    this.forceMat.uniforms.uPhi.value = src.texture;
    this._pass(this.forceMat, this.force);
  }

  /** advance by Δa (internally sub-stepped for stability) */
  step(daTotal) {
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    let remaining = daTotal;
    let guard = 0;
    while (remaining > 1e-9 && guard++ < 4) {
      const da = Math.min(remaining, Math.max(0.02 * this.a, 0.0012), 0.006);
      remaining -= da;

      this._depositAndSolve();

      const aE = this.a * COSMO.E(this.a);
      this.kickMat.uniforms.uPos.value = this.posA.texture;
      this.kickMat.uniforms.uVel.value = this.velA.texture;
      this.kickMat.uniforms.uForce.value = this.force.texture;
      this.kickMat.uniforms.uDa.value = da;
      this.kickMat.uniforms.uAE.value = aE;
      this._pass(this.kickMat, this.velB);
      [this.velA, this.velB] = [this.velB, this.velA];

      const aMid = this.a + da * 0.5;
      this.driftMat.uniforms.uPos.value = this.posA.texture;
      this.driftMat.uniforms.uVel.value = this.velA.texture;
      this.driftMat.uniforms.uDa.value = da;
      this.driftMat.uniforms.uA3E.value = aMid ** 3 * COSMO.E(aMid);
      this._pass(this.driftMat, this.posB);
      [this.posA, this.posB] = [this.posB, this.posA];

      this.a += da;
    }
    r.setRenderTarget(prevRT);
    r.setClearColor(0x000000, 1);
  }

  get posTexture() { return this.posA.texture; }
  get densityTexture() { return this.density.texture; }

  dispose() {
    for (const t of [this.posA, this.posB, this.velA, this.velB, this.density, this.fftA, this.fftB, this.force]) t.dispose();
    this.quad.geometry.dispose();
    this.depositPoints.geometry.dispose();
    this.depositPoints.material.dispose();
    for (const m of [this.icMat, this.fftMat, this.greenMat, this.forceMat, this.kickMat, this.driftMat]) m.dispose();
  }
}

export const NBODY_LAYOUT = { G, TEX, PN, LAYOUT };
