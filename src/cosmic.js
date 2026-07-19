// SCALE 0 — THE COSMIC WEB
//
// A live structure-formation simulation. Dark-matter tracer particles evolve
// under the Zel'dovich approximation of ΛCDM perturbation theory:
//
//     x(q, a) = q + D(a) · ψ(q)
//
// where q is the initial (Lagrangian) position, D(a) is the linear growth
// factor integrated from the Friedmann equation (see cosmology.js), and ψ is
// a Gaussian random displacement field with a power-law spectrum, synthesized
// as a sum of plane waves — evaluated analytically per particle, per frame,
// in the vertex shader. As the user plays cosmic time forward, voids empty
// and matter drains into walls, filaments and nodes: the cosmic web.
//
// The same analytic field is mirrored on the CPU so a click can find the
// nearest density peak (gradient ascent on δ) and dive into a galaxy there.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { COSMO } from './cosmology.js';
import { hash, RNG } from './rng.js';
import { NBodySim, NBODY_LAYOUT } from './nbody.js';

const BOX = 900;           // comoving box, display units (≙ ~500 Mpc)
const N_MODES = 64;        // plane waves in the displacement field
const A_START = 0.048;     // z ≈ 20
const SPECTRAL_TILT = -2.15; // effective displacement-amplitude slope ~ k^tilt

const vert = /* glsl */`
  uniform vec3  uK[${N_MODES}];
  uniform vec2  uAP[${N_MODES}];   // (amplitude, phase)
  uniform float uD;                // growth factor D(a)
  uniform float uAScale;           // 1 = comoving view, a = physical view
  uniform float uPx;               // pixel-ratio size boost
  uniform float uTime;
  varying float vDelta;
  varying float vEdge;
  varying float vHash;
  varying float vNova;

  void main() {
    vec3 q = position;
    // every tracer keeps its own clock: a hash for twinkle and hue, and —
    // for one particle in two thousand — a supernova schedule
    vHash = fract(sin(dot(q, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
    vNova = 0.0;
    if (vHash > 0.9995) {
      float lc = fract(uTime / 90.0 + vHash * 991.0);
      vNova = max(0.0, 1.0 - lc * 30.0);
      vNova *= vNova;
    }
    vec3 disp = vec3(0.0);
    float div = 0.0;
    for (int i = 0; i < ${N_MODES}; i++) {
      vec3 k = uK[i];
      float kl = length(k);
      float ph = dot(k, q) + uAP[i].y;
      float amp = uAP[i].x;
      disp += (amp / kl) * k * sin(ph);
      div  += amp * kl * cos(ph);
    }
    vec3 x = (q + uD * disp) * uAScale;

    // linear-theory overdensity δ = -D ∇·ψ, boosted toward the Zel'dovich
    // nonlinear estimate 1/(1 - Dδ_l) where collapse is underway
    float dlin = -uD * div;
    float rho = 1.0 / max(1.0 - 0.55 * dlin, 0.12);
    vDelta = dlin;

    // fade the hard box boundary away
    vec3 aq = abs(q) / ${(BOX / 2).toFixed(1)};
    vEdge = 1.0 - smoothstep(0.86, 1.0, max(aq.x, max(aq.y, aq.z)));

    vec4 mv = modelViewMatrix * vec4(x, 1.0);
    float size = uPx * (0.95 + 0.6 * clamp(rho - 0.6, 0.0, 2.6)) * (1.0 + vNova * 3.5);
    gl_PointSize = clamp(size * (620.0 / -mv.z), 0.75, 9.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const frag = /* glsl */`
  precision highp float;
  uniform float uTime;
  varying float vDelta;
  varying float vEdge;
  varying float vHash;
  varying float vNova;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c);
    if (r2 > 0.25) discard;
    float fall = exp(-r2 * 11.0);

    // voids: near-black indigo · filaments: cold blue-violet · nodes: hot white-gold
    float t = clamp(vDelta * 0.75, -1.0, 2.5);
    vec3 voidC = vec3(0.055, 0.06, 0.16);
    vec3 filC  = vec3(0.30, 0.38, 1.00);
    vec3 nodeC = vec3(1.35, 1.12, 0.78);
    vec3 col = t < 0.35
      ? mix(voidC, filC, smoothstep(-1.0, 0.35, t))
      : mix(filC, nodeC, smoothstep(0.35, 2.2, t));
    // no two lights are quite the same color, and none holds still
    col *= vec3(1.0 + 0.10 * sin(vHash * 6.283), 1.0 + 0.07 * sin(vHash * 12.6 + 2.0), 1.0 + 0.12 * cos(vHash * 6.283));
    float lum = 0.035 + 0.11 * smoothstep(-0.9, 0.1, t) + 0.38 * smoothstep(0.35, 2.6, t);
    lum *= 0.86 + 0.14 * sin(uTime * (0.4 + vHash * 1.8) + vHash * 40.0);
    // a supernova blooms white and dies ember-red
    col += mix(vec3(1.4, 0.55, 0.32), vec3(1.9, 1.8, 1.55), vNova) * vNova * 2.4;

    gl_FragColor = vec4(col * (lum + vNova) * fall * vEdge, 1.0);
  }
`;

// GLSL3 point renderer fed directly by the N-body sim's GPU textures
const NB_VERT = /* glsl */`
  precision highp float;
  uniform sampler2D uPos;
  uniform sampler2D uDen;
  uniform float uAScale;
  uniform float uPx;
  uniform float uTime;
  out float vDelta;
  out float vEdge;
  out float vHash;
  out float vNova;
  ${NBODY_LAYOUT.LAYOUT}

  void main() {
    ivec2 t = ivec2(gl_VertexID % ${NBODY_LAYOUT.PN}, gl_VertexID / ${NBODY_LAYOUT.PN});
    vec3 x = texelFetch(uPos, t, 0).xyz;                  // box units [0,1)
    ivec3 cell = ivec3(fract(x) * float(G)) % G;
    float delta = texelFetch(uDen, cellToTexel(cell), 0).x - 1.0;
    // compress the nonlinear range so halos glow without nuking the frame
    vDelta = clamp(log(1.0 + max(delta, -0.95)) * 1.05 - 0.25, -1.0, 2.5);

    // per-tracer clock: twinkle, hue, and the occasional supernova
    vHash = fract(sin(float(gl_VertexID) * 0.1031) * 43758.5453);
    vNova = 0.0;
    if (vHash > 0.9995) {
      float lc = fract(uTime / 90.0 + vHash * 991.0);
      vNova = max(0.0, 1.0 - lc * 30.0);
      vNova *= vNova;
    }

    vec3 disp = (x - 0.5) * ${BOX.toFixed(1)} * uAScale;
    vec3 ax = abs(x - 0.5) * 2.0;
    vEdge = 1.0 - smoothstep(0.86, 1.0, max(ax.x, max(ax.y, ax.z)));

    vec4 mv = modelViewMatrix * vec4(disp, 1.0);
    float size = uPx * (0.95 + 0.42 * clamp(vDelta, 0.0, 2.0)) * (1.0 + vNova * 3.5);
    gl_PointSize = clamp(size * (620.0 / -mv.z), 0.75, 9.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const NB_FRAG = /* glsl */`
  precision highp float;
  uniform float uTime;
  in float vDelta;
  in float vEdge;
  in float vHash;
  in float vNova;
  out vec4 fragColor;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c);
    if (r2 > 0.25) discard;
    float fall = exp(-r2 * 11.0);
    float t = vDelta;
    vec3 voidC = vec3(0.055, 0.06, 0.16);
    vec3 filC  = vec3(0.30, 0.38, 1.00);
    vec3 nodeC = vec3(1.35, 1.12, 0.78);
    vec3 col = t < 0.35
      ? mix(voidC, filC, smoothstep(-1.0, 0.35, t))
      : mix(filC, nodeC, smoothstep(0.35, 2.2, t));
    col *= vec3(1.0 + 0.10 * sin(vHash * 6.283), 1.0 + 0.07 * sin(vHash * 12.6 + 2.0), 1.0 + 0.12 * cos(vHash * 6.283));
    float lum = 0.035 + 0.1 * smoothstep(-0.9, 0.1, t) + 0.3 * smoothstep(0.35, 2.4, t);
    lum *= 0.86 + 0.14 * sin(uTime * (0.4 + vHash * 1.8) + vHash * 40.0);
    col += mix(vec3(1.4, 0.55, 0.32), vec3(1.9, 1.8, 1.55), vNova) * vNova * 2.4;
    fragColor = vec4(col * (lum + vNova) * fall * vEdge, 1.0);
  }
`;

export class CosmicScale {
  constructor(app) {
    this.app = app;
    this.kind = 'cosmic';
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(55, 1, 1, 20000);
    this.camera.position.set(0, BOX * 0.33, BOX * 0.85);

    this.a = A_START;
    this.playing = true;
    this.rate = 0.16;          // d(ln a)/dt per real second
    this.physicalView = false;

    this._buildField(app.seed);
    this._buildParticles();
    this._buildNBody();

    this.controls = new OrbitControls(this.camera, app.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.rotateSpeed = 0.5;
    this.controls.minDistance = 60;
    this.controls.maxDistance = BOX * 2.1;
    this.controls.autoRotate = true;
    this.controls.autoRotateSpeed = 0.14;
    app.renderer.domElement.addEventListener('pointerdown', () => {
      this.controls.autoRotate = false;
    }, { once: true });

    this.bloomSettings = { strength: 0.8, radius: 0.8, threshold: 0.0 };
  }

  // ------------------------------------------------------------ field ----
  _buildField(seed) {
    const r = new RNG(hash(seed, 0xc0517c));
    const k0 = (2 * Math.PI) / BOX;
    this.modes = [];
    let sumAmp2 = 0;
    for (let i = 0; i < N_MODES; i++) {
      // isotropic direction
      const z = r.float(-1, 1), th = r.float(0, 2 * Math.PI);
      const s = Math.sqrt(1 - z * z);
      const dir = [s * Math.cos(th), s * Math.sin(th), z];
      // log-uniform |k| over ~1.3 decades; large scales dominate via the tilt
      const mag = k0 * Math.exp(Math.log(1.4) + r.next() * (Math.log(26) - Math.log(1.4)));
      const amp = Math.pow(mag / k0, SPECTRAL_TILT / 2) * Math.abs(r.gauss());
      const phase = r.float(0, 2 * Math.PI);
      this.modes.push({ k: [dir[0] * mag, dir[1] * mag, dir[2] * mag], amp, phase });
      sumAmp2 += amp * amp;
    }
    // normalize so today's rms displacement ≈ 7.5% of the box — tuned so
    // shell-crossing (filament formation) completes right around a = 1
    const target = BOX * 0.075;
    const norm = target / Math.sqrt(sumAmp2 / 2);
    for (const m of this.modes) m.amp *= norm;
  }

  /** linear δ(q) at growth D — CPU mirror of the vertex shader */
  delta(p, D) {
    let div = 0;
    for (const m of this.modes) {
      const kl = Math.hypot(m.k[0], m.k[1], m.k[2]);
      const ph = m.k[0] * p.x + m.k[1] * p.y + m.k[2] * p.z + m.phase;
      div += m.amp * kl * Math.cos(ph);
    }
    return -D * div;
  }

  gradDelta(p, D, out) {
    out.set(0, 0, 0);
    for (const m of this.modes) {
      const kl = Math.hypot(m.k[0], m.k[1], m.k[2]);
      const ph = m.k[0] * p.x + m.k[1] * p.y + m.k[2] * p.z + m.phase;
      const c = D * m.amp * kl * Math.sin(ph);
      out.x += c * m.k[0]; out.y += c * m.k[1]; out.z += c * m.k[2];
    }
    return out;
  }

  // -------------------------------------------------------- particles ----
  _buildParticles() {
    const url = new URL(window.location.href);
    const nSide = Math.min(Math.max(parseInt(url.searchParams.get('n')) || 68, 32), 110);
    const n = nSide ** 3;
    const pos = new Float32Array(n * 3);
    const r = new RNG(hash(this.app.seed, 0x9a27));
    const cell = BOX / nSide;
    let j = 0;
    for (let ix = 0; ix < nSide; ix++)
      for (let iy = 0; iy < nSide; iy++)
        for (let iz = 0; iz < nSide; iz++) {
          pos[j++] = (ix + 0.5 + (r.next() - 0.5) * 0.9) * cell - BOX / 2;
          pos[j++] = (iy + 0.5 + (r.next() - 0.5) * 0.9) * cell - BOX / 2;
          pos[j++] = (iz + 0.5 + (r.next() - 0.5) * 0.9) * cell - BOX / 2;
        }
    this.particleCount = n;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BOX);

    const kArr = [], apArr = [];
    for (const m of this.modes) {
      kArr.push(new THREE.Vector3(...m.k));
      apArr.push(new THREE.Vector2(m.amp, m.phase));
    }
    this.uTime = { value: 0 };
    this.uniforms = {
      uK: { value: kArr },
      uAP: { value: apArr },
      uD: { value: COSMO.growth(this.a) },
      uAScale: { value: 1 },
      uPx: { value: Math.min(window.devicePixelRatio, 2) },
      uTime: this.uTime,
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: vert,
      fragmentShader: frag,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      transparent: true,
    });
    this.points = new THREE.Points(geo, mat);
    this.scene.add(this.points);
  }

  /** the PM N-body integrator; falls back to pure Zel'dovich if unsupported */
  _buildNBody() {
    this.sim = null;
    this.mode = 'linear';
    const url = new URL(window.location.href);
    if (url.searchParams.get('nb') === '0') return;
    try {
      this.sim = new NBodySim(this.app.renderer, this.modes, BOX, this.a);
    } catch (e) {
      console.warn('AEON: PM N-body unavailable, staying with linear theory —', e.message);
      return;
    }
    const N = this.sim.particleCount;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), BOX);
    this.nbUniforms = {
      uPos: { value: this.sim.posTexture },
      uDen: { value: this.sim.densityTexture },
      uAScale: { value: 1 },
      uPx: { value: Math.min(window.devicePixelRatio, 2) },
      uTime: this.uTime,
    };
    this.nbPoints = new THREE.Points(geo, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.nbUniforms,
      vertexShader: NB_VERT,
      fragmentShader: NB_FRAG,
      blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, transparent: true,
    }));
    this.scene.add(this.nbPoints);
    this.mode = 'nbody';
    this.points.visible = false;
  }

  toggleMode() {
    if (!this.sim) return;
    this.mode = this.mode === 'nbody' ? 'linear' : 'nbody';
    this.nbPoints.visible = this.mode === 'nbody';
    this.points.visible = this.mode === 'linear';
    if (this.mode === 'nbody' && Math.abs(this.sim.a - this.a) > 0.02) {
      // linear scrubbing moved the clock: re-run gravity up to it
      this.sim.reset(A_START);
      this.sim.step(Math.max(this.a - A_START, 0));
    }
  }

  // ------------------------------------------------------------- loop ----
  update(dt) {
    // the dance never pauses: twinkle and supernovae run on their own clock
    this.uTime.value += dt;
    if (this.mode === 'nbody') {
      if (this.playing && this.a < 1) {
        const da = this.a * (Math.exp(this.rate * dt) - 1);
        this.sim.step(Math.min(da, 1 - this.a + 1e-6));
        this.a = Math.min(this.sim.a, 1);
        if (this.a >= 1) this.playing = false;
      }
      this.nbUniforms.uPos.value = this.sim.posTexture;
      this.nbUniforms.uDen.value = this.sim.densityTexture;
      this.nbUniforms.uAScale.value = this.physicalView ? this.a : 1;
    } else if (this.playing && this.a < 1) {
      this.a = Math.min(this.a * Math.exp(this.rate * dt), 1);
      if (this.a >= 1) this.playing = false; // the present day
    }
    this.uniforms.uD.value = COSMO.growth(this.a);
    this.uniforms.uAScale.value = this.physicalView ? this.a : 1;
    this.controls.update();
  }

  // ------------------------------------------------------------- time ----
  togglePlay() {
    if (this.a >= 1 && !this.playing) {
      this.a = A_START;
      if (this.mode === 'nbody') this.sim.reset(A_START);
      this.playing = true;
      return;
    }
    this.playing = !this.playing;
  }
  speedUp() { this.rate = Math.min(this.rate * 1.6, 2.2); }
  slowDown() { this.rate = Math.max(this.rate / 1.6, 0.02); }
  scrub(dir) { // step in ln a (linear theory is reversible; gravity is not)
    this.playing = false;
    if (this.mode === 'nbody') {
      if (dir < 0) { this.sim.reset(A_START); this.a = A_START; }
      else { this.sim.step(this.a * (Math.exp(0.06) - 1)); this.a = Math.min(this.sim.a, 1); }
      return;
    }
    this.a = Math.min(Math.max(this.a * Math.exp(dir * 0.06), A_START), 1);
  }

  timeReadout() {
    const z = COSMO.z(this.a);
    return `z ${z >= 10 ? z.toFixed(0) : z.toFixed(2)} · ${COSMO.age(this.a).toFixed(2)} Gyr`;
  }

  hudStats() {
    const n = this.mode === 'nbody' ? this.sim.particleCount : this.particleCount;
    return [
      ['epoch', this.a >= 1 ? 'present day' : (this.playing ? 'evolving' : 'paused')],
      ['redshift', 'z = ' + (COSMO.z(this.a) >= 10 ? COSMO.z(this.a).toFixed(1) : COSMO.z(this.a).toFixed(2))],
      ['age of universe', COSMO.age(this.a).toFixed(2) + ' Gyr'],
      ['gravity', this.mode === 'nbody' ? 'particle-mesh N-body' : 'Zel’dovich linear theory'],
      ['tracer particles', n.toLocaleString()],
      ['coordinates', this.physicalView ? 'physical (expanding)' : 'comoving'],
    ];
  }

  // ------------------------------------------------------------ input ----
  /** click → densest peak near the ray → galaxy dive target, or null */
  pick(raycaster) {
    const D = Math.max(COSMO.growth(this.a), 0.05);
    const ro = raycaster.ray.origin, rd = raycaster.ray.direction;
    const p = new THREE.Vector3();
    let best = null, bestScore = -1e9;
    for (let i = 0; i < 140; i++) {
      const t = 30 + i * (BOX * 1.9 / 140);
      p.copy(rd).multiplyScalar(t).add(ro);
      const h = Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z));
      if (h > BOX * 0.52) continue;
      const score = this.delta(p, D) - t * 0.0006;
      if (score > bestScore) { bestScore = score; best = p.clone(); }
    }
    if (!best) return null;
    // gradient-ascend onto the peak
    const g = new THREE.Vector3();
    for (let i = 0; i < 16; i++) {
      this.gradDelta(best, D, g);
      const gl = g.length();
      if (gl < 1e-6) break;
      best.addScaledVector(g, Math.min(6 / gl, 900));
      best.clampScalar(-BOX / 2, BOX / 2);
    }
    const q = 8; // quantize → stable galaxy identity for nearby clicks
    const gseed = hash(this.app.seed, Math.round(best.x / q), Math.round(best.y / q), Math.round(best.z / q));
    return { position: best, galaxySeed: gseed };
  }

  onKey(code) {
    if (code === 'KeyE') { this.physicalView = !this.physicalView; return true; }
    if (code === 'KeyN') { this.toggleMode(); return true; }
    return false;
  }

  enter() {}
  exit() { this.controls.enabled = false; }
  resume() { this.controls.enabled = true; }

  dispose() {
    this.controls.dispose();
    this.points.geometry.dispose();
    this.points.material.dispose();
    if (this.sim) {
      this.sim.dispose();
      this.nbPoints.geometry.dispose();
      this.nbPoints.material.dispose();
    }
  }
}

export const COSMIC_NOTE = `The <em>cosmic web</em>, forming under real gravity. 262,144 dark-matter particles run through a <em>particle-mesh N-body code on your GPU</em>: each frame their mass is deposited on a 64³ mesh, Poisson's equation is solved by FFT (<em>φ_k = −3Ω<sub>m</sub>δ_k/2ak²</em>), and the particles are kicked and drifted with ΛCDM factors integrated from the Friedmann equation (Ω<sub>m</sub> = 0.315, Ω<sub>Λ</sub> = 0.685, H₀ = 67.4). Initial conditions come from the Zel'dovich approximation at z ≈ 20 — press <em>N</em> to compare against pure linear theory and watch self-gravity sharpen the filaments and virialize the halos. Click a bright node to fall into one of its galaxies.`;
