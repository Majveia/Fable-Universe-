// SCALE 1 — GALAXY
//
// A quarter-million stars, procedurally seeded from a node of the cosmic web.
// Spirals follow the density-wave picture: stars are laid down around
// logarithmic arms (θ_arm ∝ ln r / tan i) with young hot blue populations and
// HII star-forming regions tracing the arms, an old yellow bulge, a globular
// halo, and dust lanes rendered with reverse-subtract blending so they
// genuinely absorb the starlight behind them. Rotation is differential —
// a flat rotation curve v(r) ≈ const, evaluated live in the vertex shader.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { hash, RNG, galaxyName, starName } from './rng.js';
import { makeNebulaSprites, softDotTexture, galaxyAtlasTexture } from './nebula.js';

const STAR_VERT = /* glsl */`
  attribute float aR;      // cylindrical radius
  attribute float aTheta;  // initial azimuth
  attribute float aY;      // height above midplane
  attribute float aSize;
  attribute vec3  aColor;
  attribute float aPhase;  // twinkle phase
  uniform float uTime;
  uniform float uPx;
  uniform float uVrot;     // flat rotation-curve speed (units/s at r=Rcore+)
  varying vec3 vColor;
  varying float vTw;

  void main() {
    // flat rotation curve: v(r) ~ const  =>  ω = v / max(r, rc)
    float omega = uVrot / max(aR, 14.0);
    float th = aTheta + omega * uTime;
    vec3 p = vec3(aR * cos(th), aY, aR * sin(th));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vColor = aColor;
    vTw = 0.82 + 0.28 * sin(uTime * (1.1 + fract(aPhase) * 2.4) + aPhase * 41.0);
    gl_PointSize = clamp(uPx * aSize * (340.0 / -mv.z), 0.6, 24.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const STAR_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c);
    if (r2 > 0.25) discard;
    float fall = exp(-r2 * 14.0);
    gl_FragColor = vec4(vColor * fall * vTw, 1.0);
  }
`;

const DUST_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vColor;
  varying float vTw;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c);
    if (r2 > 0.25) discard;
    float fall = smoothstep(0.25, 0.0, r2);
    fall *= fall;
    gl_FragColor = vec4(vColor * fall, 1.0);
  }
`;

/** blackbody-ish star color from a 0..1 "temperature" parameter */
function starColor(t, out) {
  // 0 = cool red (M) → 1 = hot blue (O)
  const r = t < 0.62 ? 1.0 : 1.0 - (t - 0.62) * 0.9;
  const g = 0.42 + 0.62 * t * (1.35 - 0.5 * t);
  const b = t < 0.3 ? 0.32 + t * 1.4 : 0.74 + 0.35 * t;
  out[0] = Math.min(r * 1.05, 1.15); out[1] = Math.min(g, 1.05); out[2] = Math.min(b, 1.25);
}

export function galaxyParams(seed) {
  const r = new RNG(hash(seed, 0x6a7a));
  const roll = r.next();
  const type = roll < 0.68 ? 'spiral' : roll < 0.86 ? 'barred spiral' : roll < 0.95 ? 'elliptical' : 'irregular';
  return {
    seed,
    name: galaxyName(seed),
    type,
    arms: type === 'barred spiral' ? 2 : r.pick([2, 2, 2, 3, 4, 5]),
    pitch: r.float(0.18, 0.34),              // pitch angle (rad)
    radius: r.float(170, 260),               // display units
    stars: 240000,
    hueShift: r.float(-0.06, 0.08),
    barLen: type === 'barred spiral' ? r.float(0.22, 0.34) : 0,
    massMsun: r.float(0.3, 3.5) * 1e11,
    bhMassMsun: r.float(0.8, 40) * 1e6,
  };
}

export class GalaxyScale {
  constructor(app, ctx) {
    this.app = app;
    this.kind = 'galaxy';
    this.ctx = ctx;
    this.params = galaxyParams(ctx.galaxySeed);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.5, 30000);
    const R = this.params.radius;
    this.camera.position.set(R * 0.7, R * 1.05, R * 1.7);

    this.time = 0;
    this.playing = true;
    this.speed = 1;

    this._build();

    this.controls = new OrbitControls(this.camera, app.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.rotateSpeed = 0.5;
    this.controls.minDistance = 8;
    this.controls.maxDistance = R * 9;

    this.bloomSettings = { strength: 0.75, radius: 0.75, threshold: 0.0 };
  }

  _build() {
    const P = this.params;
    const r = new RNG(hash(P.seed, 0x57a55));
    const N = P.stars;
    const R = P.radius;
    const elliptical = P.type === 'elliptical';
    const irregular = P.type === 'irregular';

    const aR = new Float32Array(N);
    const aTheta = new Float32Array(N);
    const aY = new Float32Array(N);
    const aSize = new Float32Array(N);
    const aColor = new Float32Array(N * 3);
    const aPhase = new Float32Array(N);
    const col = [0, 0, 0];

    const nBulge = Math.floor(N * (elliptical ? 0.86 : 0.22));
    const nHalo = Math.floor(N * 0.05);
    const Rd = R * 0.30;                      // exponential disk scale length
    const armWidth = 0.42;                    // radians of azimuthal scatter
    const tanP = Math.tan(P.pitch);

    for (let i = 0; i < N; i++) {
      let rad, th, y, t, size;
      if (i < nBulge) {
        // bulge / spheroid — Hernquist-like cusp
        const u = r.next();
        const s = (elliptical ? R * 0.55 : R * 0.085) * u / Math.max(1 - u * 0.92, 0.08);
        const zc = r.float(-1, 1), ph = r.float(0, Math.PI * 2);
        const sq = Math.sqrt(1 - zc * zc);
        const flat = elliptical ? r.float(0.55, 0.9) : 0.62;
        rad = Math.abs(s * sq) + 0.5;
        th = ph;
        y = s * zc * flat;
        t = 0.18 + 0.2 * r.next();                    // old, red-yellow
        size = 0.7 + 1.3 * Math.pow(r.next(), 3.0);
      } else if (i < nBulge + nHalo) {
        // stellar halo + globulars
        const s = R * (0.35 + 1.05 * Math.pow(r.next(), 1.6));
        const zc = r.float(-1, 1), ph = r.float(0, Math.PI * 2);
        const sq = Math.sqrt(1 - zc * zc);
        rad = s * sq; th = ph; y = s * zc;
        t = 0.15 + 0.18 * r.next();
        size = 0.65 + r.next();
      } else {
        // disk — exponential in r, sech²-ish in z
        rad = -Rd * Math.log(1 - r.next() * 0.985) * (irregular ? r.float(0.5, 1.4) : 1);
        rad = Math.min(rad, R * 1.35);
        th = r.float(0, Math.PI * 2);
        const hz = 0.045 * R * (0.4 + rad / R);
        y = Math.atanh(r.float(-0.96, 0.96)) * hz * 0.5;

        let armBoost = 0;
        if (!elliptical && !irregular) {
          // pull azimuth toward the nearest logarithmic spiral arm
          const armPhase = Math.log(Math.max(rad, 6) / (R * 0.045)) / tanP;
          const k = Math.round((th - armPhase) / (2 * Math.PI / P.arms));
          const thArm = armPhase + k * (2 * Math.PI / P.arms);
          const pull = Math.exp(-Math.pow(rad / R - 0.12, 2) * 0.4); // arms live in the disk
          const w = armWidth * (0.55 + 0.8 * r.next());
          const g = r.gauss() * w;
          if (r.chance(0.62 * pull)) { th = thArm + g; armBoost = Math.exp(-g * g / (armWidth * armWidth)); }
          // bar: pull inner stars toward an elongated spheroid
          if (P.barLen > 0 && rad > R * 0.04 && rad < R * P.barLen) {
            th = Math.round(th / Math.PI) * Math.PI + r.gauss() * (0.22 + 0.5 * rad / (R * P.barLen));
            armBoost = 0.3;
          }
        }
        if (irregular) {
          // clumpy star-forming knots
          const knot = Math.floor(r.next() * 9);
          const kr = new RNG(hash(P.seed, 0x4e07, knot));
          rad = Math.min(Math.abs(kr.float(0.1, 0.9) * R + r.gauss() * R * 0.09), R * 1.2);
          th = kr.float(0, Math.PI * 2) + r.gauss() * 0.24;
          y = r.gauss() * R * 0.05;
          armBoost = 0.75;
        }
        // stellar population: arms are young & blue, interarm old & warm
        t = armBoost > 0.35 && r.chance(0.6)
          ? 0.55 + 0.45 * r.next()
          : 0.16 + 0.3 * r.next();
        size = 0.55 + 1.5 * Math.pow(r.next(), 2.6) + (t > 0.75 ? 0.9 : 0);
      }

      aR[i] = rad;
      aTheta[i] = th;
      aY[i] = y;
      aSize[i] = size;
      aPhase[i] = r.next() * Math.PI * 2;
      starColor(Math.min(t + P.hueShift, 1), col);
      // surface-brightness taming: the dense inner disk would otherwise
      // stack additively into a white hole
      const s3 = Math.min(Math.hypot(rad, y * 2.5) / (R * 0.4), 1);
      const dim = (0.5 + 0.5 * r.next()) * (0.22 + 0.78 * s3 * s3);
      aColor[i * 3] = col[0] * dim; aColor[i * 3 + 1] = col[1] * dim; aColor[i * 3 + 2] = col[2] * dim;
    }

    this.starData = { aR, aTheta, aY, aSize, aColor };

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3)); // unused, required
    geo.setAttribute('aR', new THREE.BufferAttribute(aR, 1));
    geo.setAttribute('aTheta', new THREE.BufferAttribute(aTheta, 1));
    geo.setAttribute('aY', new THREE.BufferAttribute(aY, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 2.6);

    this.uniforms = {
      uTime: { value: 0 },
      uPx: { value: Math.min(window.devicePixelRatio, 2) },
      uVrot: { value: 3.2 },  // display units/s — slow, alive, no winding on human timescales
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      blending: THREE.AdditiveBlending,
      depthWrite: false, depthTest: false, transparent: true,
    });
    this.stars = new THREE.Points(geo, mat);
    this.scene.add(this.stars);

    if (!elliptical) this._buildDust(r);
    if (!elliptical) this._buildNebulas();
    this._buildCore();
    this._buildBackdrop();
  }

  _buildDust(r) {
    // dust rides slightly inside the arms and absorbs light: reverse-subtract
    const P = this.params, R = P.radius;
    const N = 26000;
    const aR = new Float32Array(N), aTheta = new Float32Array(N), aY = new Float32Array(N);
    const aSize = new Float32Array(N), aColor = new Float32Array(N * 3), aPhase = new Float32Array(N);
    const tanP = Math.tan(P.pitch);
    for (let i = 0; i < N; i++) {
      let rad = -R * 0.26 * Math.log(1 - r.next() * 0.98);
      if (rad < R * 0.15 || rad > R * 0.85) { aSize[i] = 0; continue; } // no dust in the bulge
      let th = r.float(0, Math.PI * 2);
      if (P.type !== 'irregular') {
        const armPhase = Math.log(Math.max(rad, 6) / (R * 0.045)) / tanP;
        const k = Math.round((th - armPhase) / (2 * Math.PI / P.arms));
        th = armPhase + k * (2 * Math.PI / P.arms) - 0.14 + r.gauss() * 0.18; // inner edge
      }
      aR[i] = rad; aTheta[i] = th;
      aY[i] = r.gauss() * R * 0.008;
      aSize[i] = 2.4 + 3.6 * r.next();
      aPhase[i] = r.next() * 6.28;
      const d = (0.02 + 0.04 * r.next()) * (1 - rad / (R * 0.95)); // eats light, fades outward
      aColor[i * 3] = d * 0.9; aColor[i * 3 + 1] = d; aColor[i * 3 + 2] = d * 1.05;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    geo.setAttribute('aR', new THREE.BufferAttribute(aR, 1));
    geo.setAttribute('aTheta', new THREE.BufferAttribute(aTheta, 1));
    geo.setAttribute('aY', new THREE.BufferAttribute(aY, 1));
    geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
    geo.setAttribute('aColor', new THREE.BufferAttribute(aColor, 3));
    geo.setAttribute('aPhase', new THREE.BufferAttribute(aPhase, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 2.6);

    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: STAR_VERT,
      fragmentShader: DUST_FRAG,
      blending: THREE.CustomBlending,
      blendEquation: THREE.ReverseSubtractEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      depthWrite: false, depthTest: false, transparent: true,
    });
    this.dust = new THREE.Points(geo, mat);
    this.dust.renderOrder = 2;
    this.scene.add(this.dust);
    this.stars.renderOrder = 1;
  }

  _buildNebulas() {
    // HII star-forming regions strung along the arms
    const P = this.params, R = P.radius;
    const r = new RNG(hash(P.seed, 0xeb01a));
    const tanP = Math.tan(P.pitch);
    const spots = [];
    const count = P.type === 'irregular' ? 26 : 34;
    for (let i = 0; i < count; i++) {
      const rad = R * (0.15 + 0.75 * r.next());
      let th = r.float(0, Math.PI * 2);
      if (P.type !== 'irregular') {
        const armPhase = Math.log(Math.max(rad, 6) / (R * 0.045)) / tanP;
        const k = Math.round((th - armPhase) / (2 * Math.PI / P.arms));
        th = armPhase + k * (2 * Math.PI / P.arms) + r.gauss() * 0.1;
      }
      spots.push({
        r: rad, theta: th, y: r.gauss() * R * 0.01,
        size: R * r.float(0.05, 0.13),
        hue: r.next(), // 0 → Hα crimson, 1 → OIII teal
      });
    }
    this.nebulaMesh = makeNebulaSprites(spots, this.uniforms);
    this.nebulaMesh.renderOrder = 3;
    this.scene.add(this.nebulaMesh);
  }

  _buildCore() {
    const R = this.params.radius;
    const tex = softDotTexture();
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(0.85, 0.7, 0.5),
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    core.scale.setScalar(R * 0.16);
    core.renderOrder = 4;
    this.scene.add(core);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(0.16, 0.13, 0.095),
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    glow.scale.setScalar(R * 1.1);
    glow.renderOrder = 0;
    this.scene.add(glow);
  }

  _buildBackdrop() {
    // faint deep-field of distant galaxies
    const r = new RNG(hash(this.params.seed, 0xdeef));
    const tex = galaxyAtlasTexture();
    const N = 420;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const siz = new Float32Array(N);
    const D = this.params.radius * 22;
    for (let i = 0; i < N; i++) {
      const z = r.float(-1, 1), th = r.float(0, Math.PI * 2);
      const s = Math.sqrt(1 - z * z);
      pos[i * 3] = D * s * Math.cos(th); pos[i * 3 + 1] = D * z; pos[i * 3 + 2] = D * s * Math.sin(th);
      const warm = r.next();
      const b = 0.05 + 0.12 * Math.pow(r.next(), 2.);
      col[i * 3] = b * (0.8 + 0.4 * warm); col[i * 3 + 1] = b * 0.85; col[i * 3 + 2] = b * (1.15 - 0.3 * warm);
      siz[i] = D * (0.004 + 0.011 * Math.pow(r.next(), 2.5));
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(siz, 1));
    const mat = new THREE.PointsMaterial({
      map: tex, vertexColors: true, transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending, size: D * 0.012, sizeAttenuation: true,
    });
    const pts = new THREE.Points(geo, mat);
    pts.renderOrder = 0;
    this.scene.add(pts);
  }

  // ------------------------------------------------------------- loop ----
  update(dt) {
    if (this.playing) this.time += dt * this.speed;
    this.uniforms.uTime.value = this.time;
    if (this.nebulaMesh) {
      // world-size → pixel-size conversion for the nebula sprites
      this.nebulaMesh.material.uniforms.uProj.value =
        this.app.renderer.domElement.height * this.camera.projectionMatrix.elements[5] * 0.5;
    }
    this.controls.update();
  }

  togglePlay() { this.playing = !this.playing; }
  speedUp() { this.speed = Math.min(this.speed * 1.7, 24); }
  slowDown() { this.speed = Math.max(this.speed / 1.7, 0.1); }
  timeReadout() { return `rotation ×${this.speed.toFixed(1)}`; }

  hudStats() {
    const P = this.params;
    return [
      ['galaxy', P.name],
      ['class', P.type],
      ['stars rendered', P.stars.toLocaleString()],
      ['stellar mass', (P.massMsun / 1e11).toFixed(2) + ' × 10¹¹ M☉'],
      ['nuclear black hole', (P.bhMassMsun / 1e6).toFixed(1) + ' × 10⁶ M☉'],
    ];
  }

  // ------------------------------------------------------------ input ----
  /**
   * Screen-space star picking: project the live (rotated) star positions and
   * find the best candidate near the cursor. Clicking near the center dives
   * to the nucleus (black hole).
   */
  pick(raycaster, ndc) {
    const cam = this.camera;
    const w = this.app.width, h = this.app.height;
    const px = (ndc.x * 0.5 + 0.5) * w, py = (-ndc.y * 0.5 + 0.5) * h;

    // nucleus?
    const cpos = new THREE.Vector3(0, 0, 0).project(cam);
    if (cpos.z < 1) {
      const cx = (cpos.x * 0.5 + 0.5) * w, cy = (-cpos.y * 0.5 + 0.5) * h;
      if (Math.hypot(px - cx, py - cy) < 26) {
        return { type: 'core', bhMassMsun: this.params.bhMassMsun };
      }
    }

    const { aR, aTheta, aY } = this.starData;
    const t = this.time, vrot = this.uniforms.uVrot.value;
    const v = new THREE.Vector3();
    const view = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
    let bestI = -1, bestD = 18 * 18; // 18 px capture radius
    const N = aR.length, stride = N > 200000 ? 2 : 1;
    for (let i = 0; i < N; i += stride) {
      const rad = aR[i];
      const th = aTheta[i] + (vrot / Math.max(rad, 14)) * t;
      v.set(rad * Math.cos(th), aY[i], rad * Math.sin(th)).applyMatrix4(view);
      if (v.z < -1 || v.z > 1) continue;
      const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
      const d = (sx - px) * (sx - px) + (sy - py) * (sy - py);
      if (d < bestD) { bestD = d; bestI = i; }
    }
    if (bestI < 0) return null;
    const starSeed = hash(this.params.seed, bestI, 0x57a9);
    const rad = aR[bestI];
    const th = aTheta[bestI] + (vrot / Math.max(rad, 14)) * t;
    return {
      type: 'star',
      starSeed,
      name: starName(starSeed),
      index: bestI,
      position: new THREE.Vector3(rad * Math.cos(th), aY[bestI], rad * Math.sin(th)),
    };
  }

  onKey() { return false; }
  enter() {}
  exit() { this.controls.enabled = false; }
  resume() { this.controls.enabled = true; }

  dispose() {
    this.controls.dispose();
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}

export const GALAXY_NOTE = `A galaxy of a few hundred billion suns — here, 240,000 stars stand in for them. The spiral arms are <em>density waves</em>: traffic jams of stars and gas that the disk rotates through, which is why hot young blue stars and pink H-α star nurseries trace the arms while older amber stars fill the space between. Rotation here is differential — a flat rotation curve, the classic signature of the dark-matter halo this galaxy formed inside. Dust lanes truly absorb the light of the stars behind them. Click any star to visit its system; click the nucleus to meet the supermassive black hole.`;
