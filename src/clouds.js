// SCALE 3½ — INSIDE A GIANT
//
// Gas giants have no ground to land on; what they have is weather the size
// of worlds. This scale drops you between the cloud decks: infinite
// procedural stratus sheets sampled from the planet's own palette, cumulus
// towers drifting past, haze in every direction, the star a smeared lamp
// overhead — and now and then, lightning somewhere below the deck.
// Fly toward where you look. There is no bottom you would ever reach.

import * as THREE from 'three';
import { CLOUD_FIELD_GLSL as FIELD_CHUNK } from './cloudfield.js';
import { RNG, arand, hash } from './rng.js';
import { NOISE_GLSL } from './planet.js';
import { nebulaTexture, softDotTexture } from './nebula.js';

const DECK_VERT = /* glsl */`
  varying vec3 vW;
  void main() {
    vW = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }
`;

const DECK_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uColA;      // lit cloud
  uniform vec3 uColB;      // shadowed cloud
  uniform vec3 uHaze;
  uniform vec3 uCam;
  uniform float uSeed;
  uniform float uTime;
  uniform float uDensity;
  uniform vec4 uFlash;     // xyz world pos, w intensity
  varying vec3 vW;
  ${NOISE_GLSL}

  void main() {
    vec2 p = vW.xz * 0.0016;
    vec2 drift = vec2(uTime * 0.004, uTime * 0.0007);
    float w = fbm3(vec3(p * 1.7 + drift * 0.5, uSeed)) * 0.8;
    float n = fbm(vec3(p + drift + w * 0.3, uSeed * 1.7));
    float a = smoothstep(0.5 - uDensity * 0.3, 0.75, n * 0.5 + 0.5);

    float lit = clamp(uSunDir.y, 0.05, 1.0);
    float shade = fbm3(vec3(p * 3.1 + drift, uSeed + 9.0)) * 0.5 + 0.5;
    vec3 col = mix(uColB * 0.5, uColA * 0.85, shade) * (0.22 + 0.65 * lit);

    // lightning: inverse-square glow from the strike point
    vec3 fd = vW - uFlash.xyz;
    col += vec3(0.75, 0.8, 1.0) * uFlash.w * 3.5 / (1.0 + dot(fd, fd) * 4e-6);

    // haze with distance
    float dist = length(vW - uCam);
    float fog = 1.0 - exp(-dist * 0.00026);
    col = mix(col, uHaze * (0.12 + 0.4 * lit), fog);
    a *= smoothstep(11000.0, 3500.0, dist) * 0.85;

    gl_FragColor = vec4(col, a);
  }
`;

const SKYG_VERT = /* glsl */`
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 p = projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0);
    gl_Position = p.xyww;
  }
`;

const SKYG_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform vec3 uUp;        // zenith haze
  uniform vec3 uDown;      // the deep below
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float t = d.y * 0.5 + 0.5;
    vec3 col = mix(uDown * 0.14, uUp, smoothstep(0.18, 0.75, t));
    // the star, smeared by kilometers of hydrogen
    float ang = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
    col += uSunColor * exp(-ang * 5.5) * 0.4;
    col += uSunColor * exp(-ang * 26.0) * 1.1;
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class CloudsScale {
  constructor(app, ctx) {
    this.app = app;
    this.kind = 'clouds';
    this.ctx = ctx;
    const pp = this.pp = ctx.planet;

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(64, 1, 0.5, 40000);
    this.camera.position.set(0, 0, 0);

    this.playing = true;
    this.speed = 1;         // cruise multiplier
    this.yaw = 0.4; this.pitch = -0.04;
    this.time = 0;
    this._drag = null;

    this.uSunDir = { value: new THREE.Vector3(0.4, 0.55, 0.6).normalize() };
    this.uSunColor = { value: ctx.sunColor.clone() };
    this.uTime = { value: 0 };
    this.uCam = { value: this.camera.position };
    this.uFlash = { value: new THREE.Vector4(0, 0, 0, 0) };

    const r = new RNG(hash(pp.seed, 0xc10d));
    this.haze = pp.colA.clone().lerp(pp.colB, 0.4);

    this._buildSky();
    this._buildDecks(r);
    this._buildTowers(r);

    this._nextBolt = r.float(3, 8);

    this.controls = { // duck-typed for the hyperzoom
      enabled: false,
      target: new THREE.Vector3(600, -40, 260),
      update: () => {},
    };
    this.camera.lookAt(this.controls.target);
    this._syncAngles();

    this.bloomSettings = { strength: 0.5, radius: 0.7, threshold: 0.3 };
    this._bindKeys();
  }

  _buildSky() {
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(30000, 32, 16),
      new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: this.uSunDir, uSunColor: this.uSunColor,
          uUp: { value: this.haze.clone().multiplyScalar(0.38) },
          uDown: { value: this.pp.colB.clone().multiplyScalar(0.2) },
        },
        vertexShader: SKYG_VERT, fragmentShader: SKYG_FRAG,
        side: THREE.BackSide, depthWrite: false,
      }));
    this.sky.frustumCulled = false;
    this.scene.add(this.sky);
  }

  _buildDecks(r) {
    this.decks = [];
    const levels = [340, 150, -170, -340, -520];
    for (let i = 0; i < levels.length; i++) {
      const geo = new THREE.PlaneGeometry(26000, 26000, 1, 1);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.ShaderMaterial({
        uniforms: {
          uSunDir: this.uSunDir, uSunColor: this.uSunColor,
          uColA: { value: this.pp.colA.clone().lerp(new THREE.Color(1, 1, 1), 0.35) },
          uColB: { value: this.pp.colB.clone().multiplyScalar(0.75) },
          uHaze: { value: this.haze },
          uCam: this.uCam,
          uSeed: { value: this.pp.noiseSeed + i * 7.3 },
          uTime: this.uTime,
          uDensity: { value: r.float(0.5, 0.95) },
          uFlash: this.uFlash,
        },
        vertexShader: DECK_VERT, fragmentShader: DECK_FRAG,
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.position.y = levels[i];
      mesh.renderOrder = 10 - i; // farthest-below first
      this.scene.add(mesh);
      this.decks.push(mesh);
    }
  }

  _buildTowers(r) {
    // cumulus the size of continents, drifting past the hull
    this.towers = [];
    const tex = nebulaTexture(hash(this.pp.seed, 5), 256);
    const tint = this.pp.colA.clone().lerp(new THREE.Color(1, 1, 1), 0.25);
    for (let i = 0; i < 70; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex, color: tint.clone().multiplyScalar(r.float(0.14, 0.3)),
        transparent: true, depthWrite: false, opacity: 0.6,
        rotation: r.float(0, Math.PI * 2),
      }));
      sp.position.set(r.float(-6000, 6000), r.float(-420, 300), r.float(-6000, 6000));
      sp.scale.set(r.float(700, 2100), r.float(500, 1400), 1);
      this.scene.add(sp);
      this.towers.push(sp);
    }
    // the strike glow itself
    this.boltSprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: softDotTexture(), color: new THREE.Color(2.2, 2.3, 3.0),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0,
    }));
    this.boltSprite.scale.setScalar(900);
    this.scene.add(this.boltSprite);
  }

  _bindKeys() {
    this._keys = new Set();
    this._kd = (e) => this._keys.add(e.code);
    this._ku = (e) => this._keys.delete(e.code);
    window.addEventListener('keydown', this._kd);
    window.addEventListener('keyup', this._ku);
  }

  onPointerDown(e) { this._drag = { x: e.clientX, y: e.clientY }; }
  onPointerUp() { this._drag = null; }
  onPointerMove(e) {
    if (!this._drag) return;
    this.yaw -= (e.clientX - this._drag.x) * 0.0032;
    this.pitch = Math.min(Math.max(this.pitch - (e.clientY - this._drag.y) * 0.003, -0.7), 0.7);
    this._drag = { x: e.clientX, y: e.clientY };
  }
  _syncAngles() {
    const d = new THREE.Vector3();
    this.camera.getWorldDirection(d);
    this.yaw = Math.atan2(-d.x, -d.z);
    this.pitch = Math.asin(Math.min(Math.max(d.y, -1), 1));
  }

  update(dt) {
    this.time += dt;
    this.uTime.value = this.time;

    if (this.controls.enabled) {
      this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
      if (this.playing) {
        // cruise toward the gaze; W/S trims
        let v = 60 * this.speed;
        if (this._keys.has('KeyW')) v *= 2.2;
        if (this._keys.has('KeyS')) v *= 0.3;
        const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
        this.camera.position.addScaledVector(fwd, v * dt);
        this.camera.position.y = Math.min(Math.max(this.camera.position.y, -560), 420);
      }
    }

    // decks and towers ride along; the noise field stays put in world space
    for (const d of this.decks) {
      d.position.x = this.camera.position.x;
      d.position.z = this.camera.position.z;
    }
    for (const t of this.towers) {
      const dx = t.position.x - this.camera.position.x;
      const dz = t.position.z - this.camera.position.z;
      if (Math.abs(dx) > 6500) t.position.x -= Math.sign(dx) * 13000;
      if (Math.abs(dz) > 6500) t.position.z -= Math.sign(dz) * 13000;
    }

    // the sun wheels slowly — fast rotators, these giants
    const az = this.time * 0.008 + 0.6;
    this.uSunDir.value.set(Math.cos(az) * 0.75, 0.5 + 0.2 * Math.sin(this.time * 0.01), Math.sin(az) * 0.75).normalize();

    // lightning
    this._nextBolt -= dt;
    const F = this.uFlash.value;
    if (this._nextBolt <= 0) {
      this._nextBolt = 3 + arand() * 11;
      const th = arand() * Math.PI * 2;
      const d = 1200 + arand() * 3800;
      F.set(
        this.camera.position.x + Math.cos(th) * d,
        -380 - arand() * 160,
        this.camera.position.z + Math.sin(th) * d,
        1.0);
      this.boltSprite.position.set(F.x, F.y, F.z);
    }
    if (F.w > 0) {
      F.w = Math.max(F.w - dt * 2.6, 0);
      // a couple of restrikes
      if (F.w > 0.25 && arand() < 0.09) F.w = Math.min(F.w + 0.5, 1);
      this.boltSprite.material.opacity = F.w;
    }
  }

  togglePlay() { this.playing = !this.playing; }
  speedUp() { this.speed = Math.min(this.speed * 1.6, 8); }
  slowDown() { this.speed = Math.max(this.speed / 1.6, 0.2); }
  timeReadout() { return `cruise ×${this.speed.toFixed(1)}`; }

  hudStats() {
    const pp = this.pp;
    const wind = Math.round(Math.abs(pp.spin) * 4800 + 300);
    return [
      ['world', pp.name],
      ['class', pp.type + ' — no surface, ever'],
      ['deck', '≈ 0.7 bar, ' + pp.Teq + ' K'],
      ['zonal winds', wind.toLocaleString() + ' km/h'],
      ['below', 'metallic hydrogen, ' + (pp.massE / 318).toFixed(2) + ' M♃ of it'],
    ];
  }

  /** hyperzoom: arrive falling out of the upper haze */
  arriveFrom(rest) {
    return rest.clone().add(new THREE.Vector3(-300, 1600, 500));
  }

  pick() { return null; }
  onKey() { return false; }
  enter() { this.controls.enabled = true; }
  exit() { this.controls.enabled = false; }
  resume() { this.controls.enabled = true; }

  dispose() {
    window.removeEventListener('keydown', this._kd);
    window.removeEventListener('keyup', this._ku);
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}

export const CLOUDS_NOTE = `There is nothing to stand on here and never will be: pressure just keeps rising until hydrogen forgets how to be a gas. So you fly. The decks are the planet's own palette breathing in world-space noise — steer into a cumulus tower and it swallows the view; wait long enough and lightning goes off below the deck, as it does on Jupiter, where single bolts carry a thousand times the energy of ours. The wind figure is honest for a fast rotator. The bottom of this world is thousands of kilometers of glowing metal.`;

// ===========================================================================
// SURFACE CUMULUS — the clouds you stand under, as opposed to the ones you
// fly between (CloudsScale, above).
// ===========================================================================
//
// What this replaces, and why "blobs" was the accurate description:
//
//   surface.js drew its weather as two `THREE.Points` layers of a radial
//   `softDotTexture(64)`, 9 and 14 puffs, `opacity` 0.5 and 0.38, tinted a
//   single flat grey that tracked the time of day. A radial gradient sprite has
//   no top, no base, no silhouette and no light direction, so nine of them
//   scattered across the sky is nine smudges on the lens. Measured off the
//   shipped frame, the cloud region came back at saturation 0.127 and value
//   0.825 — a flat pale wash, which is exactly what the geometry predicts.
//
// A cumulus has three things that sprite could not have, and all three are
// what makes it read as cloud rather than as fog:
//
//   1. **Form.** A flat base at the condensation level and a cauliflower top,
//      grown as a real cumulus grows — a broad base disc, then towers of
//      decreasing radius, then shoulders budding off the towers. That is the
//      reference's construction and it is right; it is transcribed here.
//   2. **A lit top and a shadowed base.** Not a lambert term — a *height
//      fraction* carried per puff, so a stack of towers separates into readable
//      storeys instead of averaging into one grey mass. A cumulus is lit as
//      much by the sky dome above it as by the sun on its shoulder, and the
//      height fraction is what encodes that.
//   3. **A silver lining.** The rim of a backlit cumulus blazes, and the
//      shaded side carries a thin cool line. The reference annotates the second
//      as the thing that "actually reads as drawn rather than rendered", and
//      that is worth believing.
//
// ---------------------------------------------------------------------------
// Everything moves on one wind (§6 M3)
//
// M3's thesis is that one global field is sampled by everything, cloud
// advection named explicitly. The deck therefore takes its drift from
// `surface.js`'s `cloudWind()`, which is `meanFlow()` veered by CLOUD_VEER and
// sped up by CLOUD_SPEEDUP — the Ekman spiral, not a random scalar. The same
// vector shears the cirrus in `starfield.js`, so the high deck and the low deck
// cannot disagree about which way the weather is going.
//
// ---------------------------------------------------------------------------
// Zero assets (§2.1)
//
// The puff atlas is four profiles of gradient noise computed on the CPU at
// init from `hash(seed, ...)`. It is 256 x 256 x RGBA = 256 KB of generated
// texture and nothing on the wire.

import { airColoursQuantised } from './starlight.js';

// ---------------------------------------------------------------------------
// the atlas

/** the fract/dot hash family used elsewhere in this repo, on the CPU */
function chash2(x, y) {
  let p0 = (x * 0.1031) % 1, p1 = (y * 0.1030) % 1, p2 = (x * 0.0973) % 1;
  if (p0 < 0) p0 += 1; if (p1 < 0) p1 += 1; if (p2 < 0) p2 += 1;
  const d = p0 * (p1 + 33.33) + p1 * (p2 + 33.33) + p2 * (p0 + 33.33);
  p0 += d; p1 += d; p2 += d;
  const a = ((p0 + p1) * p2) % 1;
  return a < 0 ? a + 1 : a;
}

function cnoise2(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  const a = chash2(ix, iy), b = chash2(ix + 1, iy);
  const c = chash2(ix, iy + 1), d = chash2(ix + 1, iy + 1);
  return (a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy) * 2 - 1;
}

function cfbm2(x, y, oct) {
  let v = 0, amp = 0.5, px = x, py = y;
  for (let i = 0; i < oct; i++) { v += amp * cnoise2(px, py); px = px * 2.07 + 11.3; py = py * 2.07 + 11.3; amp *= 0.5; }
  return v;
}

/**
 * Four puff profiles in one texture, 2 x 2 tiles.
 *
 *   R  scalloped alpha profile — the silhouette
 *   G  interior density        — which storey of the ramp a texel lands on
 *   B  rim mask                — where the silver lining and the cool line go
 *   A  a softer shoulder, for anything that wants smoke rather than cumulus
 *
 * Per-puff variety then comes from picking a tile and spinning the billboard by
 * the golden angle, which is visually identical to evaluating the noise live
 * and costs one fetch instead of eight octaves.
 */
export function puffAtlas(seed = 0, side = 256) {
  const data = new Uint8Array(side * side * 4);
  const half = side / 2;
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const s = (tx + ty * 2) * 37.13 + 5 + (seed % 977) * 0.0137;
      for (let j = 0; j < half; j++) {
        for (let i = 0; i < half; i++) {
          const cx = (i + 0.5) / half * 2 - 1, cy = (j + 0.5) / half * 2 - 1;
          const r = Math.hypot(cx, cy);
          const ang = Math.atan2(cy, cx);
          // the lobes are sampled on the unit circle, so the profile closes on
          // itself exactly — a scallop that did not would show as a seam
          const rx = Math.cos(ang), ry = Math.sin(ang);
          const lob = cfbm2(rx * 2.35 + s * 13.7, ry * 2.35 + s * 13.7, 3)
            + cfbm2(rx * 5.1 + s * 29.1, ry * 5.1 + s * 29.1, 2) * 0.45;
          const R = 0.80 + lob * 0.20;
          const a = smooth01(R, R - 0.34, r);
          const den = cfbm2(cx * 2.6 + s * 31.3, cy * 2.6 + s * 31.3, 3) * 0.5 + 0.5;
          const edge = smooth01(R - 0.36, R - 0.02, r);
          const aSoft = smooth01(R, R - 0.42, r);
          const o = ((ty * half + j) * side + (tx * half + i)) * 4;
          data[o] = clamp255(a); data[o + 1] = clamp255(den);
          data[o + 2] = clamp255(edge); data[o + 3] = clamp255(aSoft);
        }
      }
    }
  }
  return { data, side };
}

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
function smooth01(e0, e1, x) {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0 || 1e-6)));
  return t * t * (3 - 2 * t);
}

// ---------------------------------------------------------------------------
// the coverage field
//
// One field decides two things: whether a puff is drawn at all, and — when
// surface.js grows a shadow pass — where its shadow falls. The reference makes
// that identity explicit and it is the right invariant: a shadow must always
// belong to a cloud you can point at.

// Lives in `cloudfield.js` now, and re-exported here so every caller and
// every check that names it keeps working. It moved because `cloudshade.js`
// needs it and must not import three — see that file, and `cloudfield.js`.
export { CLOUD_FIELD_GLSL } from './cloudfield.js';

const CUMULUS_VERT = /* glsl */`
precision highp float;
${FIELD_CHUNK}
attribute vec2 corner;
attribute vec3 pdata;    // radius, per-puff seed, height fraction
attribute vec2 fcen;     // the formation's centre, for the coverage lookup
varying vec2 vC;
varying float vSeed;
varying float vHF;
varying vec3 vW;
varying float vOp;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vFwd;

void main() {
  vec3 wc = position + vec3(uCloudDrift.x, 0.0, uCloudDrift.y);
  vec2 fw = fcen + uCloudDrift;
  // the same field that will draw the shadow decides whether this puff exists
  float cf = cloudField(fw);
  float op = smoothstep(0.16, 0.52, cf);
  vOp = op;
  // A degenerate triangle off-screen, not a discard: a puff that is not in a
  // cloud costs no fragment at all this way.
  if (op < 0.012) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }

  vRight = normalize(vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]));
  vUp    = normalize(vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]));
  vFwd   = normalize(vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]));

  float rad = pdata.x * mix(0.80, 1.06, op);
  float ra = pdata.y * 2.399963;             // golden angle: no two puffs align
  float cr = cos(ra), sr = sin(ra);
  vec2 rc = vec2(corner.x * cr - corner.y * sr, corner.x * sr + corner.y * cr);
  // 0.86 on the vertical: a cumulus puff is wider than it is tall
  vec3 wp = wc + vRight * (rc.x * rad) + vUp * (rc.y * rad * 0.86);
  vC = rc; vSeed = pdata.y; vHF = pdata.z; vW = wp;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}
`;

const CUMULUS_FRAG = (aerialGLSL) => /* glsl */`
precision highp float;
uniform sampler2D uPuff;
uniform vec3 uSunDir;
uniform vec3 uCamPos;
uniform vec3 uCTop, uCBody, uCTerm, uCUnder, uCCore, uCRim;
uniform vec3 uCSun, uCShadow;
uniform float uCloudLum;      // the day/night clock, shared with the sky
uniform float uCloudThick;    // optical depth scale — Beer's law, one dial
varying vec2 vC;
varying float vSeed;
varying float vHF;
varying vec3 vW;
varying float vOp;
varying vec3 vRight;
varying vec3 vUp;
varying vec3 vFwd;
${aerialGLSL}

// §9.2's three-colour hue path, verbatim from src/paint.js. Bands that are
// soft but *visible* are the single largest contributor to the illustrated
// look, and §11's last trap is a warning not to smooth them out.
vec3 cloudRamp3(float t, vec3 shade, vec3 mid, vec3 lit, float soft, float jit) {
  float a = smoothstep(0.17 - soft + jit, 0.17 + soft + jit, t);
  float b = smoothstep(0.58 - soft + jit, 0.58 + soft + jit, t);
  return mix(mix(shade, mid, a), lit, b);
}

// Henyey–Greenstein, without the 1/4pi: the sun term here is a painted
// irradiance, not radiometric watts, and carrying the normalisation would only
// force a compensating gain somewhere less honest.
float cloudHG(float cosT, float g) {
  float g2 = g * g;
  float den = max(1.0 + g2 - 2.0 * g * cosT, 1e-4);
  return (1.0 - g2) / (den * sqrt(den));
}

// Three-lobe Mie phase for a 10-micron water droplet.
//
// Technique ported — not vendored — from Leonxlnx/sakura-realm (MIT), whose
// decomposition is the clearest statement of why one lobe cannot do this job.
// Mie scattering off cloud water has three distinct features and a single HG
// term can only ever have one of them:
//
//   · a needle-sharp forward spike, which IS the silver lining and the reason a
//     thin edge in front of the sun goes incandescent rather than merely pale
//   · a broad forward pedestal carrying most of the energy out to 60-90 deg,
//     which is what makes a side-lit flank read as lit water rather than grey
//   · a small backscatter shoulder, which lights the face of a cloud when the
//     sun is behind the viewer
//
// The weights sum to 1 and every HG lobe integrates to the same total over the
// sphere, so this is an energy-conserving redistribution and not a gain: it
// buys the silver lining without brightening the frame.
float cloudMiePhase(float cosT) {
  return cloudHG(cosT,  0.91) * 0.52    // forward spike — the silver lining
       + cloudHG(cosT,  0.38) * 0.24    // forward pedestal — side-lit luminosity
       + cloudHG(cosT, -0.32) * 0.24;   // backscatter shoulder — the sunlit face
}

void main() {
  float r = length(vC);
  if (!(r <= 1.02)) discard;
  vec2 tile = vec2(mod(floor(vSeed * 4.0), 2.0), mod(floor(vSeed * 2.0), 2.0));
  vec4 pf = texture2D(uPuff, (clamp(vC, -1.0, 1.0) * 0.5 + 0.5) * 0.5 + tile * 0.5);
  // An analytic falloff over the baked profile. It softens the silhouette, and
  // it makes a hard-edged opaque quad structurally impossible even if the
  // atlas failed to upload.
  float a = pf.r * smoothstep(1.02, 0.60, r);
  if (!(a > 0.004)) discard;
  float den = pf.g;
  a *= mix(0.62, 1.0, den);
  a *= vOp;

  // A fake volumetric normal off the billboard disc, biased upward: cumulus
  // tops face the sky and bellies face the ground, and a flat card cannot say
  // so on its own.
  float zz = sqrt(max(0.0, 1.0 - min(r, 1.0) * min(r, 1.0)));
  vec3 N = normalize(vRight * vC.x + vUp * vC.y + vFwd * zz * 0.85 + vec3(0.0, 0.62, 0.0));
  vec3 V = normalize(uCamPos - vW);

  float ndl = dot(N, uSunDir);
  float t = clamp(ndl * 0.5 + 0.5, 0.0, 1.0);
  // The height fraction as its own term rather than a nudge to the lambert.
  // This is what separates a stack of towers into readable storeys instead of
  // one grey mass — a cumulus is lit as much by the dome above it as by the
  // sun on its shoulder.
  t = mix(t, clamp(t + vHF * 0.36 - 0.10, 0.0, 1.0), 0.78);
  t *= mix(0.68, 1.10, den);
  float term = smoothstep(0.30, 0.54, t);      // the terminator, as a line

  vec3 col = cloudRamp3(t, uCUnder, uCTerm, uCTop, 0.085, (den - 0.5) * 0.06);
  // The belly goes violet fast and does not pass through grey to get there —
  // §9.2's ruling that shadows change hue rather than going black, applied to
  // the one surface in the frame that is nothing but shadow and light.
  col = mix(mix(uCCore, uCUnder, 0.30), col, smoothstep(0.0, 0.28, t));
  col = mix(col, uCBody, 0.13);
  // the sunlit flank takes the colour of the light that is on it
  col *= mix(vec3(1.0), uCSun * 1.28, term * 0.44);

  // --- optical depth through the puff ------------------------------------
  //
  // zz is the half-chord of the sphere the billboard stands in, so 2*zz is
  // a genuine path length through the droplet medium rather than a fudge on
  // the alpha. Everything below is Beer's law on that path, which means the
  // rind and the silver lining come out of one number instead of two dials.
  float tau = 2.0 * zz * mix(0.55, 1.45, den) * uCloudThick;
  float trans = exp(-tau);

  // Beer–Powder (sakura-realm's framing): the dark-edge term that turns a
  // silhouette from a cut-out into something with a rind. Weighted to the lit
  // side only — a thin edge lit from behind is bright, a thin edge lit from in
  // front is dark, and that asymmetry is most of what says "this is a volume".
  float cosT = dot(-V, uSunDir);          // +1 = looking into the sun
  float powder = 1.0 - exp(-tau * 2.6);
  float powderM = mix(1.0, powder, 0.55 * (0.5 - 0.5 * cosT));
  col *= mix(1.0, powderM, 0.70);

  // --- the light that came *through* --------------------------------------
  //
  // The silver lining is not a rim shader. It is transmitted sunlight,
  // weighted by the forward spike of the Mie phase — so it appears exactly
  // where the cloud is thin AND the sun is behind it, and nowhere else, with
  // no term of its own to tune. The clamp is the whole normalisation: the
  // three-lobe phase peaks near 124 at zero degrees against 0.39 at ninety,
  // and 0.06 puts the side-lit case at nothing and the forward case hard
  // against the ceiling, which is what a silver lining looks like.
  float phase = cloudMiePhase(cosT);
  col += uCRim * clamp(phase * 0.06, 0.0, 1.10) * trans;

  // ...and the painted rim, which is a different claim: §9.2's bands say an
  // edge should read as a *line*, and a physically correct gradient will not
  // draw one. Both, deliberately — the physics decides where the light is, the
  // paint decides that it has an edge.
  float edge = pf.b;
  float sunEdge = clamp(dot(normalize(vRight * vC.x + vUp * vC.y + vec3(1e-5)), uSunDir) * 0.5 + 0.5, 0.0, 1.0);
  float rimLine = smoothstep(0.30, 0.84, edge);
  col = mix(col, uCRim * 1.45,
            clamp(rimLine * pow(sunEdge, 1.9) * (0.22 + 0.55 * clamp(phase * 0.06, 0.0, 1.2)), 0.0, 0.92));
  // a thin cool line down the shaded side — the reference annotates this as
  // the thing that actually reads as drawn rather than rendered
  col = mix(col, mix(uCCore, uCShadow, 0.42), rimLine * (1.0 - sunEdge) * (1.0 - term) * 0.36);

  col *= uCloudLum;

  float dist = length(uCamPos - vW);
  // 0.55x the true distance. A deck at 1.2 km would otherwise be handed
  // straight to §9.3's curve and come back as haze — but a cumulus is *above*
  // most of the boundary layer the extinction length was measured in, so the
  // air between the eye and it is thinner than the same distance along the
  // ground. The factor is the reference's and it is a statement about where
  // the aerosol is, not a fudge to keep the clouds visible.
  vec4 fogged = aerial(col, dist * 0.55, V, uSunDir, vW.y);
  gl_FragColor = vec4(fogged.rgb, clamp(a, 0.0, 1.0) * clamp(fogged.a * 0.55 + 0.45, 0.0, 1.0));
}
`;

// ---------------------------------------------------------------------------
// growing a cumulus
//
// A cumulus congestus is not a blob and it is not a sphere. It has a flat base
// at the lifting condensation level — every cloud in a field shares that base,
// which is why a real sky looks ruled — and above it a few towers of
// decreasing radius with cauliflower budding off their shoulders. Grown in
// that order, the silhouette comes out right without anyone drawing it.

/** how many formations across, by tier — the deck spans grid x spacing metres */
const CUMULUS_GRID = { low: 5, mobile: 7, desktop: 9, ultra: 11 };

/**
 * Puff centres for a whole sky's worth of cumulus.
 *
 * `rand` is a deterministic 0..1 source (§2.3: `RNG` from `rng.js`, never
 * `Math.random`). `base` is the condensation level in metres.
 */
export function growCumulus(rand, { grid = 9, spacing = 3050, base = 900, scale = 1 } = {}) {
  const puffs = [];
  let fi = 0;
  for (let gz = 0; gz < grid; gz++) {
    for (let gx = 0; gx < grid; gx++) {
      const fx = (gx - (grid - 1) / 2) * spacing + (rand() - 0.5) * spacing * 0.75;
      const fz = (gz - (grid - 1) / 2) * spacing + (rand() - 0.5) * spacing * 0.75;
      // the base wanders a little between formations but not much: they all
      // condensed out of the same air at the same dew point
      const cbase = base * (0.86 + rand() * 0.36);
      const sc = (0.72 + rand() * 0.85) * scale;
      const nTow = 2 + ((rand() * 3) | 0);
      const baseR = (300 + rand() * 230) * sc;
      let maxY = 0;
      const local = [];
      // the broad flat base
      const nb = 7 + ((rand() * 7) | 0);
      for (let i = 0; i < nb; i++) {
        const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * baseR;
        const py = rand() * 0.10 * baseR;
        local.push({
          x: Math.cos(a) * rr, y: py, z: Math.sin(a) * rr * 0.72,
          rad: (0.44 + rand() * 0.32) * baseR, seed: rand() * 100,
        });
        maxY = Math.max(maxY, py);
      }
      // the towers
      for (let t = 0; t < nTow; t++) {
        const a = rand() * Math.PI * 2, rr = Math.sqrt(rand()) * baseR * 0.55;
        const tx = Math.cos(a) * rr, tz = Math.sin(a) * rr * 0.7;
        const hTop = (0.85 + rand() * 1.15) * baseR;
        const steps = 4 + ((rand() * 4) | 0);
        for (let s = 0; s < steps; s++) {
          const u = s / (steps - 1);
          const py = u * hTop;
          const rad = (0.52 - 0.22 * u * u + rand() * 0.13) * baseR * (1 - 0.25 * u);
          const jx = (rand() - 0.5) * baseR * 0.30 * (0.4 + u);
          const jz = (rand() - 0.5) * baseR * 0.30 * (0.4 + u);
          local.push({ x: tx + jx, y: py, z: tz + jz, rad, seed: rand() * 100 });
          maxY = Math.max(maxY, py);
          // cauliflower on the shoulders — the thing that makes a tower read
          // as boiling rather than as a cylinder
          if (s > 0 && rand() < 0.7) {
            const aa = rand() * Math.PI * 2, dd = rad * (0.55 + rand() * 0.5);
            local.push({
              x: tx + jx + Math.cos(aa) * dd, y: py + (rand() - 0.3) * rad * 0.5,
              z: tz + jz + Math.sin(aa) * dd, rad: rad * (0.42 + rand() * 0.30),
              seed: rand() * 100,
            });
          }
        }
      }
      for (const p of local) {
        puffs.push({
          cx: fx + p.x, cy: cbase + p.y, cz: fz + p.z, rad: p.rad, seed: p.seed,
          // the height fraction, which is what separates a stack of towers into
          // storeys in the fragment shader
          hf: maxY > 1 ? Math.min(Math.max(p.y / maxY, 0), 1) : 0.5,
          fx, fz,
        });
      }
      fi++;
    }
  }
  return puffs;
}

/**
 * The deck. Returns `{ mesh, uniforms, update }`.
 *
 * `sunDir` and `camPos` must be the **same uniform objects** the rest of the
 * scale holds — the sky, the terrain and the clouds have to agree about where
 * the star is to within a frame, and sharing the object is the only way that
 * cannot drift.
 *
 * `aerialGLSL` is `AERIAL_GLSL` from `src/aerial.js` when §9.3 is on, and ''
 * when it is not; passing it in rather than importing it keeps this module from
 * deciding whether the flag is set. When it is '', a no-op `aerial()` is
 * supplied so the shader still compiles.
 */
export function makeCumulus({
  sunDir, camPos, seed = 0, rand, tier = 'desktop',
  T = 5778, base = 900, spacing = 3050, amount = 0.55, scale = 1,
  aerialGLSL = '', aerialUniforms = {},
} = {}) {
  const grid = CUMULUS_GRID[tier] || CUMULUS_GRID.desktop;
  const puffs = growCumulus(rand, { grid, spacing, base, scale });
  const n = puffs.length;

  const pos = new Float32Array(n * 4 * 3);
  const cor = new Float32Array(n * 4 * 2);
  const dat = new Float32Array(n * 4 * 3);
  const fcen = new Float32Array(n * 4 * 2);
  const idx = new Uint32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const p = puffs[i];
    for (let v = 0; v < 4; v++) {
      const k = i * 4 + v;
      pos[k * 3] = p.cx; pos[k * 3 + 1] = p.cy; pos[k * 3 + 2] = p.cz;
      cor[k * 2] = (v === 1 || v === 3) ? 1 : -1;
      cor[k * 2 + 1] = (v >= 2) ? 1 : -1;
      dat[k * 3] = p.rad; dat[k * 3 + 1] = p.seed; dat[k * 3 + 2] = p.hf;
      fcen[k * 2] = p.fx; fcen[k * 2 + 1] = p.fz;
    }
    const b = i * 4;
    idx.set([b, b + 1, b + 2, b + 2, b + 1, b + 3], i * 6);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('corner', new THREE.BufferAttribute(cor, 2));
  geo.setAttribute('pdata', new THREE.BufferAttribute(dat, 3));
  geo.setAttribute('fcen', new THREE.BufferAttribute(fcen, 2));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  // The deck is bigger than any frustum test worth doing, and the vertex
  // shader already culls per puff by pushing empties off-screen.
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, base, 0), grid * spacing);

  const atlas = puffAtlas(seed);
  const tex = new THREE.DataTexture(atlas.data, atlas.side, atlas.side, THREE.RGBAFormat);
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.needsUpdate = true;

  const v3 = () => ({ value: new THREE.Vector3() });
  const u = {
    uPuff: { value: tex },
    uSunDir: sunDir || { value: new THREE.Vector3(0, 1, 0) },
    uCamPos: camPos || { value: new THREE.Vector3() },
    uCloudDrift: { value: new THREE.Vector2(0, 0) },
    uCloudAmount: { value: amount },
    uCloudLum: { value: 1 },
    // 3.4 is the optical depth of a puff seen through its middle. Below about
    // 2 the whole deck goes translucent and the ramp's bands stop reading;
    // above about 6 the powder term darkens every edge into a hard rind and
    // the silver lining disappears because nothing transmits.
    uCloudThick: { value: 3.4 },
    uCTop: v3(), uCBody: v3(), uCTerm: v3(),
    uCUnder: v3(), uCCore: v3(), uCRim: v3(),
    uCSun: v3(), uCShadow: v3(),
    ...aerialUniforms,
  };

  // A cloud shader with §9.3 switched off still has to compile, and a stub
  // that returns full clarity is exactly what "no aerial perspective" means.
  const air = aerialGLSL || /* glsl */`
    vec4 aerial(vec3 c, float d, vec3 V, vec3 s, float y) { return vec4(c, 1.0); }
  `;

  const mat = new THREE.ShaderMaterial({
    uniforms: u,
    vertexShader: CUMULUS_VERT,
    fragmentShader: CUMULUS_FRAG(air),
    transparent: true,
    depthWrite: false,
    // Standard over-composite on colour, and **coverage** on alpha. Alpha is
    // §9.3's clarity channel, not a second copy of opacity: `src.a + dst.a *
    // (1 - src.a)` makes a cloud core read as clear (sharp) and a wispy edge
    // inherit the sky's own 0 (fully softened by §9.4 step 5), which is what a
    // cumulus edge actually does. Three's default would square the source
    // alpha here and darken the channel for no reason.
    blending: THREE.CustomBlending,
    blendSrc: THREE.SrcAlphaFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
  });

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;

  /**
   * Per frame. `drift` is the **shared wind field's** cloud-deck vector times
   * elapsed time — §6 M3's "one global wind field sampled by everything, cloud
   * advection named explicitly". `elevDeg` drives the same day/night clock the
   * sky runs on, so the two can never disagree about the hour.
   */
  function update(elevDeg, drift) {
    const a = airColoursQuantised(T, Math.max(elevDeg, 0.5));
    u.uCTop.value.set(...a.cloudTop);
    u.uCBody.value.set(...a.cloudBody);
    u.uCTerm.value.set(...a.cloudTerm);
    u.uCUnder.value.set(...a.cloudUnder);
    u.uCCore.value.set(...a.cloudCore);
    u.uCRim.value.set(...a.cloudRim);
    u.uCSun.value.set(...a.sunLight);
    u.uCShadow.value.set(...a.shadowTint);
    const y = Math.sin((elevDeg * Math.PI) / 180);
    // A cumulus deck is a kilometre up, so it keeps the sun after the valley
    // has lost it and loses it before the valley is fully dark. The offset is
    // what makes the last lit cloud the last lit thing in the frame.
    u.uCloudLum.value = 0.045 + 0.955 * Math.min(Math.max((y + 0.16) / 0.30, 0), 1);
    if (drift) u.uCloudDrift.value.set(drift.x, drift.y);
  }
  update(13.5);

  return { mesh, uniforms: u, update, puffs: n };
}
