// Galaxy collisions — Toomre & Toomre (1972), live.
//
// The classic restricted three-body picture that first explained the
// Antennae and the Mice: two galaxy cores move as an exact two-body
// problem (integrated on the CPU), while a quarter-million disk stars ride
// along as test particles feeling only the two softened core potentials —
// integrated on the GPU, one symplectic step per frame. Tidal bridges pour
// between the galaxies at first passage; counter-tails sling outward.
// Nothing is keyframed: the choreography is gravity's.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { generateGalaxyStars } from './galaxy.js';

const PN = 512; // 262,144 test particles

const COPY_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uSrc;
  out vec4 frag;
  void main() { frag = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0); }
`;

const VEL_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uPos;
  uniform sampler2D uVel;
  uniform vec3 uC1;
  uniform vec3 uC2;
  uniform float uM1;
  uniform float uM2;
  uniform float uEps2;
  uniform float uDt;
  out vec4 frag;
  void main() {
    ivec2 t = ivec2(gl_FragCoord.xy);
    vec3 p = texelFetch(uPos, t, 0).xyz;
    vec3 v = texelFetch(uVel, t, 0).xyz;
    vec3 d1 = p - uC1;
    vec3 d2 = p - uC2;
    vec3 a = -uM1 * d1 / pow(dot(d1, d1) + uEps2, 1.5)
             -uM2 * d2 / pow(dot(d2, d2) + uEps2, 1.5);
    frag = vec4(v + a * uDt, 0.0);
  }
`;

const POS_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uPos;
  uniform sampler2D uVel;
  uniform float uDt;
  out vec4 frag;
  void main() {
    ivec2 t = ivec2(gl_FragCoord.xy);
    frag = vec4(texelFetch(uPos, t, 0).xyz + texelFetch(uVel, t, 0).xyz * uDt, 1.0);
  }
`;

const RENDER_VERT = /* glsl */`
  precision highp float;
  uniform sampler2D uPos;
  uniform float uPx;
  in vec3 aCol;
  out vec3 vColor;
  void main() {
    ivec2 t = ivec2(gl_VertexID % ${PN}, gl_VertexID / ${PN});
    vec3 p = texelFetch(uPos, t, 0).xyz;
    vColor = aCol;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = clamp(uPx * 1.35 * (340.0 / -mv.z), 0.6, 9.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const RENDER_FRAG = /* glsl */`
  precision highp float;
  in vec3 vColor;
  out vec4 fragColor;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c);
    if (r2 > 0.25) discard;
    fragColor = vec4(vColor * exp(-r2 * 14.0), 1.0);
  }
`;

export class CollisionSim {
  /**
   * @param P  primary galaxy params (from galaxyParams, with .companion)
   */
  constructor(renderer, P) {
    this.renderer = renderer;
    if (!renderer.capabilities.isWebGL2 || !renderer.extensions.get('EXT_color_buffer_float')) {
      throw new Error('collision: needs float render targets');
    }
    const C = P.companion;
    const r = new RNG(hash(P.seed, 0xc0111d));

    // --- the two-body core orbit (CPU) --------------------------------
    this.M1 = 18 * P.radius;
    this.M2 = this.M1 * C.massRatio;
    this.eps2 = 8 * 8;
    const d0 = (P.radius + C.radius) * 1.7;
    const rp = P.radius * r.float(0.45, 0.75);          // perigee: deep passage
    const Mt = this.M1 + this.M2;
    const vAtD0 = Math.sqrt(2 * Mt / d0) * 0.98;        // just-bound: they return
    const L = Math.sqrt(2 * Mt * rp);                    // parabolic angular momentum
    const vt = L / d0;
    const vr = -Math.sqrt(Math.max(vAtD0 * vAtD0 - vt * vt, 0));
    // relative state → split about the barycenter
    const rel = new THREE.Vector3(d0, 0, 0);
    const relV = new THREE.Vector3(vr, 0, vt);           // prograde encounter
    const f1 = this.M2 / Mt, f2 = this.M1 / Mt;
    this.c1 = rel.clone().multiplyScalar(-f1);
    this.c2 = rel.clone().multiplyScalar(f2);
    this.v1 = relV.clone().multiplyScalar(-f1);
    this.v2 = relV.clone().multiplyScalar(f2);
    this.time = 0;
    this.minSep = Infinity;

    // --- test-particle initial conditions ------------------------------
    const starsA = generateGalaxyStars(P);
    const compParams = { ...P, seed: C.seed, radius: C.radius, arms: C.arms, pitch: C.pitch, barLen: 0, type: 'spiral', stars: P.stars, hueShift: C.hueShift };
    const starsB = generateGalaxyStars(compParams);
    const N = PN * PN;
    const nA = Math.floor(N * this.M1 / Mt);
    const pos = new Float32Array(N * 4);
    const vel = new Float32Array(N * 4);
    const col = new Float32Array(N * 3);

    const tilt = new THREE.Matrix4().makeRotationFromEuler(
      new THREE.Euler(r.float(0.4, 1.0), r.float(0, Math.PI), r.float(-0.3, 0.3)));
    const pv = new THREE.Vector3(), vv = new THREE.Vector3();

    const seat = (i, stars, si, M, core, coreV, R, xf, tint) => {
      const rad = stars.aR[si], th = stars.aTheta[si];
      pv.set(rad * Math.cos(th), stars.aY[si], rad * Math.sin(th));
      // circular speed in a softened point potential
      const vc = Math.sqrt(M * rad * rad / Math.pow(rad * rad + this.eps2, 1.5));
      vv.set(-Math.sin(th) * vc, 0, Math.cos(th) * vc);
      if (xf) { pv.applyMatrix4(xf); vv.applyMatrix4(xf); }
      pos[i * 4] = pv.x + core.x; pos[i * 4 + 1] = pv.y + core.y; pos[i * 4 + 2] = pv.z + core.z;
      vel[i * 4] = vv.x + coreV.x; vel[i * 4 + 1] = vv.y + coreV.y; vel[i * 4 + 2] = vv.z + coreV.z;
      col[i * 3] = stars.aColor[si * 3] * tint[0] * 0.7;
      col[i * 3 + 1] = stars.aColor[si * 3 + 1] * tint[1] * 0.7;
      col[i * 3 + 2] = stars.aColor[si * 3 + 2] * tint[2] * 0.7;
    };
    const strideA = Math.max(1, Math.floor(starsA.aR.length / nA));
    const strideB = Math.max(1, Math.floor(starsB.aR.length / (N - nA)));
    for (let i = 0; i < nA; i++) {
      seat(i, starsA, (i * strideA) % starsA.aR.length, this.M1, this.c1, this.v1, P.radius, null, [1.05, 0.95, 0.85]);
    }
    for (let i = nA; i < N; i++) {
      const si = ((i - nA) * strideB) % starsB.aR.length;
      seat(i, starsB, si, this.M2, this.c2, this.v2, C.radius, tilt, [0.8, 0.92, 1.2]);
    }
    this.starData = starsA; // the primary still defines in-system skies

    // --- GPU state ------------------------------------------------------
    const rt = () => new THREE.WebGLRenderTarget(PN, PN, {
      type: THREE.FloatType, format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: false, stencilBuffer: false,
    });
    this.posA = rt(); this.posB = rt();
    this.velA = rt(); this.velB = rt();

    this.quadScene = new THREE.Scene();
    this.quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), null);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
    const mat = (frag, uniforms) => new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, vertexShader: 'void main(){ gl_Position = vec4(position.xy, 0., 1.); }',
      fragmentShader: frag, uniforms, depthTest: false, depthWrite: false, blending: THREE.NoBlending,
    });
    this.copyMat = mat(COPY_FRAG, { uSrc: { value: null } });
    this.velMat = mat(VEL_FRAG, {
      uPos: { value: null }, uVel: { value: null },
      uC1: { value: this.c1 }, uC2: { value: this.c2 },
      uM1: { value: this.M1 }, uM2: { value: this.M2 },
      uEps2: { value: this.eps2 }, uDt: { value: 0 },
    });
    this.posMat = mat(POS_FRAG, { uPos: { value: null }, uVel: { value: null }, uDt: { value: 0 } });

    // seed the ping-pong state from the IC arrays
    const up = (arr, target) => {
      const tex = new THREE.DataTexture(arr, PN, PN, THREE.RGBAFormat, THREE.FloatType);
      tex.needsUpdate = true;
      this.copyMat.uniforms.uSrc.value = tex;
      this._pass(this.copyMat, target);
      tex.dispose();
    };
    up(pos, this.posA);
    up(vel, this.velA);
    this.renderer.setRenderTarget(null);

    // --- the visible points ---------------------------------------------
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), d0 * 6);
    this.renderUniforms = {
      uPos: { value: this.posA.texture },
      uPx: { value: Math.min(window.devicePixelRatio, 2) },
    };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3, uniforms: this.renderUniforms,
      vertexShader: RENDER_VERT, fragmentShader: RENDER_FRAG,
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, transparent: true,
    }));

    this._readback = null;
    this._readbackAge = Infinity;
  }

  _pass(material, target) {
    this.quad.material = material;
    this.renderer.setRenderTarget(target);
    this.renderer.render(this.quadScene, this.quadCam);
  }

  step(dt) {
    const r = this.renderer;
    const prevRT = r.getRenderTarget();
    let remaining = Math.min(dt, 0.4);
    while (remaining > 1e-6) {
      const h = Math.min(remaining, 0.05);
      remaining -= h;
      // cores: leapfrog on the exact two-body problem
      const d = this.c2.clone().sub(this.c1);
      const dist2 = d.lengthSq() + this.eps2;
      const acc = d.multiplyScalar(1 / Math.pow(dist2, 1.5));
      this.v1.addScaledVector(acc, this.M2 * h);
      this.v2.addScaledVector(acc, -this.M1 * h);
      this.c1.addScaledVector(this.v1, h);
      this.c2.addScaledVector(this.v2, h);
      this.time += h;
      this.minSep = Math.min(this.minSep, this.c1.distanceTo(this.c2));

      // stars: one GPU kick + drift
      this.velMat.uniforms.uPos.value = this.posA.texture;
      this.velMat.uniforms.uVel.value = this.velA.texture;
      this.velMat.uniforms.uDt.value = h;
      this._pass(this.velMat, this.velB);
      [this.velA, this.velB] = [this.velB, this.velA];

      this.posMat.uniforms.uPos.value = this.posA.texture;
      this.posMat.uniforms.uVel.value = this.velA.texture;
      this.posMat.uniforms.uDt.value = h;
      this._pass(this.posMat, this.posB);
      [this.posA, this.posB] = [this.posB, this.posA];
    }
    this.renderUniforms.uPos.value = this.posA.texture;
    r.setRenderTarget(prevRT);
    this._readbackAge += dt;
  }

  separation() { return this.c1.distanceTo(this.c2); }

  phase() {
    const sep = this.separation();
    if (this.minSep === Infinity || this.minSep > sep * 0.98) return 'first approach';
    if (sep < this.minSep * 1.8) return 'closest passage';
    return 'tails unwinding';
  }

  /** CPU copy of live positions for picking (refreshed at most ~2 Hz) */
  positions() {
    if (!this._readback || this._readbackAge > 0.5) {
      if (!this._buf) this._buf = new Float32Array(PN * PN * 4);
      this.renderer.readRenderTargetPixels(this.posA, 0, 0, PN, PN, this._buf);
      this._readback = this._buf;
      this._readbackAge = 0;
    }
    return this._readback;
  }

  dispose() {
    for (const t of [this.posA, this.posB, this.velA, this.velB]) t.dispose();
    this.quad.geometry.dispose();
    this.points.geometry.dispose();
    this.points.material.dispose();
    for (const m of [this.copyMat, this.velMat, this.posMat]) m.dispose();
  }
}

export const COLLISION_NOTE = `Two galaxies, one gravitational figure. The cores orbit as an exact two-body problem; a quarter-million disk stars ride along as test particles in the two moving potentials — the <em>restricted three-body</em> scheme with which Toomre &amp; Toomre first explained the Antennae in 1972. Watch the first passage: a <em>bridge</em> of stars pours toward the companion while a <em>counter-tail</em> slings outward on the far side, and every arc of it is integrated live on your GPU. Nothing here is animated by hand. Click any star to visit a system amid the wreckage.`;
