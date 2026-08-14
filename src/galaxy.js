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
import { RNG, arand, galaxyName, hash, starName } from './rng.js';
import { bulgeTexture, makeNebulaSprites, softDotTexture, galaxyAtlasTexture, makeVolumetricNebula } from './nebula.js';
import { COSMO } from './cosmology.js';
import { CollisionSim, COLLISION_NOTE } from './collision.js';

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
  const radius = r.float(170, 260);
  // some nodes hold interacting pairs mid-collision
  const interacting = (type === 'spiral' || type === 'barred spiral') && r.chance(0.16);
  const companionSeed = hash(seed, 0xc0111);
  return {
    seed,
    name: galaxyName(seed),
    type,
    arms: type === 'barred spiral' ? 2 : r.pick([2, 2, 2, 3, 4, 5]),
    pitch: r.float(0.18, 0.34),              // pitch angle (rad)
    radius,                                  // display units
    stars: 240000,
    hueShift: r.float(-0.06, 0.08),
    barLen: type === 'barred spiral' ? r.float(0.22, 0.34) : 0,
    massMsun: r.float(0.3, 3.5) * 1e11,
    bhMassMsun: r.float(0.8, 40) * 1e6,
    interacting,
    companion: interacting ? {
      seed: companionSeed,
      name: galaxyName(companionSeed),
      massRatio: r.float(0.35, 0.95),
      radius: radius * r.float(0.55, 0.9),
      arms: r.pick([2, 2, 3]),
      pitch: r.float(0.2, 0.32),
      hueShift: r.float(-0.05, 0.1),
    } : null,
  };
}

/**
 * Pure, deterministic star-cloud synthesis for a galaxy — used both to render
 * the galaxy scale and to build the true night sky seen from inside it.
 */
export function generateGalaxyStars(P) {
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

  return { aR, aTheta, aY, aSize, aColor, aPhase };
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
    // The dolly is ours, for the reason `cosmic.js` documents at `onWheel`:
    // `main.js` and `touch.js` both synthesise a pinch into
    // `active().onWheel?.({ deltaY })`, and `OrbitControls` listens for real
    // DOM wheel events on the canvas, which a plain object is not. Leaving the
    // zoom with `OrbitControls` means two fingers on the glass do nothing here.
    this.controls.enableZoom = false;
    // one 100-unit notch is 9.25%, matching the tuned `zoomSpeed = 1.7` feel
    this._zoomK = Math.log(Math.pow(0.95, -1.7)) / 100;
    if (window.matchMedia && matchMedia('(pointer: coarse)').matches) this._zoomK *= 2.9;

    this.bloomSettings = { strength: 0.75, radius: 0.75, threshold: 0.0 };

    // stochastic supernovae — one per galaxy per century, dramatized
    this._svPool = [];
    const svTex = softDotTexture();
    for (let i = 0; i < 3; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: svTex, color: new THREE.Color(1, 1, 1),
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
      }));
      sp.visible = false;
      this.scene.add(sp);
      this._svPool.push({ sp, age: -1 });
    }
    this._svTimer = 4 + arand() * 8;
  }

  _updateSupernovae(dt) {
    const R = this.params.radius;
    this._svTimer -= dt * this.speed;
    if (this._svTimer <= 0) {
      this._svTimer = 6 + arand() * 12;
      const slot = this._svPool.find(s => s.age < 0);
      if (slot) {
        const i = (arand() * this.starData.aR.length) | 0;
        this.starPosAt(i, slot.sp.position);
        slot.age = 0;
      }
    }
    for (const s of this._svPool) {
      if (s.age < 0) continue;
      s.age += dt * this.speed;
      const rise = Math.min(s.age / 0.35, 1);
      const decay = Math.exp(-Math.max(s.age - 0.35, 0) / 2.2);
      const b = rise * decay;
      s.sp.visible = b > 0.01;
      s.sp.material.opacity = Math.min(b * 1.4, 1);
      // white-hot flash cooling into the ember of a remnant
      s.sp.material.color.setRGB(1.6 * b + 0.4, (1.4 * b + 0.25) * (0.55 + 0.45 * rise * decay), 1.1 * b * b + 0.15);
      s.sp.scale.setScalar(R * (0.015 + 0.05 * Math.min(s.age / 3, 1)));
      if (s.age > 8) { s.age = -1; s.sp.visible = false; }
    }
  }

  _build() {
    const P = this.params;

    // interacting pair? hand the whole disk over to gravity
    if (P.interacting) {
      try {
        this.sim = new CollisionSim(this.app.renderer, P);
        this.starData = this.sim.starData;
        this.scene.add(this.sim.points);
        this.uniforms = { uTime: { value: 0 }, uVrot: { value: 0 } }; // sky compat
        const coreTex = bulgeTexture();
        this.coreSprites = [this.sim.c1, this.sim.c2].map((c, i) => {
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({
            map: coreTex, color: i === 0 ? new THREE.Color(0.65, 0.55, 0.4) : new THREE.Color(0.42, 0.5, 0.65),
            blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
          }));
          // the same r^¼ profile as the single-galaxy nucleus, for the same
          // reason — two Gaussians clipping into each other was worse, not
          // better, than one
          sp.scale.setScalar(P.radius * (i === 0 ? 0.46 : 0.34));
          this.scene.add(sp);
          return { sp, c };
        });
        this._buildBackdrop();
        this._buildWebBackdrop();
        this.noteOverride = COLLISION_NOTE;
        return;
      } catch (e) {
        console.warn('AEON: collision sim unavailable, showing single galaxy —', e.message);
        this.params.interacting = false;
      }
    }

    const r = new RNG(hash(P.seed, 0xd057));
    const N = P.stars;
    const R = P.radius;
    const elliptical = P.type === 'elliptical';

    const { aR, aTheta, aY, aSize, aColor, aPhase } = generateGalaxyStars(P);
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
    this._buildWebBackdrop();
  }

  /**
   * The deepest background: the cosmic web this galaxy actually lives in,
   * evaluated from the same Zel'dovich displacement field as scale 0 and
   * projected onto the far sky from this galaxy's node.
   */
  _buildWebBackdrop() {
    const cosmic = this.app.stack[0];
    if (!cosmic || cosmic.kind !== 'cosmic' || !cosmic.modes) return;
    let wp = this.ctx.webPos;
    if (!wp) { // deep link: any consistent seat in the box will do
      const wr = new RNG(hash(this.params.seed, 0x3eb));
      wp = new THREE.Vector3(wr.float(-430, 430), wr.float(-430, 430), wr.float(-430, 430));
    }
    const D = COSMO.growth(Math.max(cosmic.a, 0.35));
    const n = 22, BOXC = 900, cell = BOXC / n;
    const R = this.params.radius * 35;
    const jr = new RNG(hash(this.params.seed, 0x77eb));
    const pos = [], col = [];
    for (let ix = 0; ix < n; ix++)
      for (let iy = 0; iy < n; iy++)
        for (let iz = 0; iz < n; iz++) {
          const qx = (ix + 0.5 + (jr.next() - 0.5) * 0.9) * cell - BOXC / 2;
          const qy = (iy + 0.5 + (jr.next() - 0.5) * 0.9) * cell - BOXC / 2;
          const qz = (iz + 0.5 + (jr.next() - 0.5) * 0.9) * cell - BOXC / 2;
          let dx = 0, dy = 0, dz = 0;
          for (const m of cosmic.modes) {
            const kl = Math.hypot(m.k[0], m.k[1], m.k[2]);
            const s = (m.amp / kl) * Math.sin(m.k[0] * qx + m.k[1] * qy + m.k[2] * qz + m.phase);
            dx += m.k[0] * s / kl; dy += m.k[1] * s / kl; dz += m.k[2] * s / kl;
          }
          const x = qx + D * dx - wp.x;
          const y = qy + D * dy - wp.y;
          const z = qz + D * dz - wp.z;
          const d2 = x * x + y * y + z * z;
          if (d2 < 3600) continue; // inside our own node
          const inv = 1 / Math.sqrt(d2);
          pos.push(x * inv * R, y * inv * R, z * inv * R);
          const b = Math.min(2600 / d2, 0.28);
          col.push(0.5 * b, 0.56 * b, b);
        }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(col), 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), R * 1.05);
    const pts = new THREE.Points(geo, new THREE.PointsMaterial({
      size: R * 0.008, vertexColors: true, sizeAttenuation: true,
      map: softDotTexture(64), transparent: true, depthWrite: false, depthTest: false,
      blending: THREE.AdditiveBlending,
    }));
    pts.renderOrder = -1;
    this.scene.add(pts);
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

    // and a handful with true volume: raymarched HII clouds along the arms
    const camU = { value: this.camera.position };
    for (let i = 0; i < 9; i++) {
      const rad = R * (0.2 + 0.65 * r.next());
      let th = r.float(0, Math.PI * 2);
      if (P.type !== 'irregular') {
        const armPhase = Math.log(Math.max(rad, 6) / (R * 0.045)) / tanP;
        const k = Math.round((th - armPhase) / (2 * Math.PI / P.arms));
        th = armPhase + k * (2 * Math.PI / P.arms) + r.gauss() * 0.08;
      }
      const warm = r.chance(0.6);
      const neb = makeVolumetricNebula(
        hash(P.seed, 0x0e8, i),
        R * r.float(0.045, 0.085),
        warm ? new THREE.Color(0.5, 0.1, 0.13) : new THREE.Color(0.1, 0.4, 0.38),
        warm ? new THREE.Color(0.36, 0.16, 0.3) : new THREE.Color(0.22, 0.24, 0.5),
        camU, 0.7);
      neb.position.set(rad * Math.cos(th), r.gauss() * R * 0.012, rad * Math.sin(th));
      neb.renderOrder = 3;
      this.scene.add(neb);
    }
  }

  _buildCore() {
    const R = this.params.radius;
    const tex = softDotTexture();
    // The nucleus, on a de Vaucouleurs r^¼ profile rather than a Gaussian.
    //
    // A Gaussian is flat near its centre, so an additive sprite at `R * 0.16`
    // clipped across a disc a sixth of the galaxy wide and the core read as a
    // white hole with nothing in it. The r^¼ law is a cusp with faint wings:
    // the saturated part is small, the falloff around it stays readable, and
    // the bulge stars — 22% of everything drawn, and already there — carry the
    // extended light the old sprite was standing in for.
    //
    // §9.6 rules that the sun disc is "painted 3× oversize and never blown
    // out". Same principle one scale up: brightness reads as a bright *small*
    // thing with a gradient, not as a large flat maximum.
    const core = new THREE.Sprite(new THREE.SpriteMaterial({
      map: bulgeTexture(), color: new THREE.Color(0.85, 0.7, 0.5),
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
    }));
    core.scale.setScalar(R * 0.30);
    core.renderOrder = 4;
    this.scene.add(core);
    // The spheroid's unresolved light: the stars too faint to be worth a point
    // sprite, summed into one soft disc. It is an **LOD stand-in**, and it has
    // to retire like one.
    //
    // It did not. At a distance the galaxy is small in frame and the glow reads
    // as a halo; fly in and the same sprite is still `R * 1.1` across, so it
    // floods the whole frame with an additive tan wash. Two things are wrong
    // with that at once, and the second is an invariant:
    //
    //   · it double-counts light — the stars it stands in for are being drawn
    //     as points at that range, so their brightness is added twice;
    //   · §2.8 says "in vacuum the background is true #000 and blacks are never
    //     lifted", and a full-frame additive wash is exactly a lifted black.
    //
    // Measured at a third of the default framing: 23.3% of the frame reached
    // true #000 at distance and 0.4% up close. So it fades out as the stars it
    // represents become resolvable, which is the same rule §M3's grass rings
    // follow and the same reason.
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(0.16, 0.13, 0.095),
      blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
      transparent: true, opacity: 1,
    }));
    glow.scale.setScalar(R * 1.1);
    glow.renderOrder = 0;
    this.scene.add(glow);
    this.haloGlow = glow;
  }

  /**
   * How much of the unresolved-light stand-in survives at this camera distance.
   *
   * 1 beyond two galaxy radii, 0 inside one. Inside a radius you are among the
   * stars it was standing in for, and they are all being drawn.
   */
  _glowFade() {
    const R = Math.max(this.params.radius, 1e-6);
    const d = this.camera.position.length() / R;
    const t = Math.min(Math.max((d - 1.0) / 1.0, 0), 1);
    return t * t * (3 - 2 * t);
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
    if (this.sim && this.playing) this.sim.step(dt * this.speed * 5);
    if (this.coreSprites) for (const { sp, c } of this.coreSprites) sp.position.copy(c);
    if (this.playing) this._updateSupernovae(dt);
    this.uniforms.uTime.value = this.time;
    // retire the unresolved-light stand-in as its stars become resolvable
    if (this.haloGlow) this.haloGlow.material.opacity = this._glowFade();
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
  timeReadout() {
    return this.sim ? `${this.sim.phase()} · ×${this.speed.toFixed(1)}` : `rotation ×${this.speed.toFixed(1)}`;
  }

  hudStats() {
    const P = this.params;
    if (this.sim) {
      return [
        ['pair', P.name + ' & ' + P.companion.name],
        ['class', 'interacting spirals'],
        ['mass ratio', P.companion.massRatio.toFixed(2)],
        ['separation', (this.sim.separation() / P.radius * 15).toFixed(1) + ' kpc'],
        ['encounter', this.sim.phase()],
        ['test particles', this.sim.starData.aR.length >= 0 ? '262,144' : ''],
      ];
    }
    return [
      ['galaxy', P.name],
      ['class', P.type],
      ['stars rendered', P.stars.toLocaleString()],
      ['stellar mass', (P.massMsun / 1e11).toFixed(2) + ' × 10¹¹ M☉'],
      ['nuclear black hole', (P.bhMassMsun / 1e6).toFixed(1) + ' × 10⁶ M☉'],
    ];
  }

  /** live position of star i right now */
  starPosAt(i, out = new THREE.Vector3()) {
    if (this.sim) {
      const buf = this.sim.positions();
      return out.set(buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]);
    }
    const { aR, aTheta, aY } = this.starData;
    const th = aTheta[i] + (this.uniforms.uVrot.value / Math.max(aR[i], 14)) * this.time;
    return out.set(aR[i] * Math.cos(th), aY[i], aR[i] * Math.sin(th));
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

    // interacting pair: pick against the live GPU positions
    if (this.sim) {
      const buf = this.sim.positions();
      const v = new THREE.Vector3();
      const view = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse);
      let bestI = -1, bestD = 18 * 18;
      const N = buf.length / 4;
      for (let i = 0; i < N; i += 2) {
        v.set(buf[i * 4], buf[i * 4 + 1], buf[i * 4 + 2]).applyMatrix4(view);
        if (v.z < -1 || v.z > 1) continue;
        const sx = (v.x * 0.5 + 0.5) * w, sy = (-v.y * 0.5 + 0.5) * h;
        const d = (sx - px) * (sx - px) + (sy - py) * (sy - py);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestI < 0) return null;
      const starSeed = hash(this.params.seed, bestI, 0x57a9);
      return {
        type: 'star', starSeed, name: starName(starSeed), index: bestI,
        position: new THREE.Vector3(buf[bestI * 4], buf[bestI * 4 + 1], buf[bestI * 4 + 2]),
      };
    }

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

  /**
   * Zoom, owned here rather than by `OrbitControls`, so that the pinch works.
   * The argument is `cosmic.js`'s at its own `onWheel`, and this is the same
   * bug at the next scale down: a synthesised `{ deltaY }` is not a DOM wheel
   * event, so `OrbitControls` never saw one and two fingers did nothing.
   *
   * Geometric rather than linear, because 8 to R·9 is a factor of several
   * thousand and a fixed step is unusable at one end of that or the other.
   */
  onWheel(e) {
    const dy = Number(e?.deltaY) || 0;
    if (!dy) return true;
    // DOM_DELTA_LINE reports notches, not pixels; one line is about 16 px
    const k = this._zoomK * (e.deltaMode === 1 ? 16 : 1);
    const t = this.controls.target;
    const d = this.camera.position.clone().sub(t);
    const len = Math.min(Math.max(d.length() * Math.exp(k * dy),
      this.controls.minDistance), this.controls.maxDistance);
    this.camera.position.copy(t).addScaledVector(d.normalize(), len);
    return true;
  }
  enter() {}
  exit() { this.controls.enabled = false; }
  resume() { this.controls.enabled = true; }

  dispose() {
    this.controls.dispose();
    if (this.sim) this.sim.dispose();
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}

export const GALAXY_NOTE = `A galaxy of a few hundred billion suns — here, 240,000 stars stand in for them. The spiral arms are <em>density waves</em>: traffic jams of stars and gas that the disk rotates through, which is why hot young blue stars and pink H-α star nurseries trace the arms while older amber stars fill the space between. Rotation here is differential — a flat rotation curve, the classic signature of the dark-matter halo this galaxy formed inside. Dust lanes truly absorb the light of the stars behind them. Click any star to visit its system; click the nucleus to meet the supermassive black hole.`;
