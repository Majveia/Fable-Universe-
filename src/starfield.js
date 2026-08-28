// The sky — both of them.
//
// Half of this file is the night: a seeded dome of stars with a milky band
// across it, the home galaxy's disk seen edge-on from within. That half is
// older than §9.6 and is documented where it starts.
//
// The other half, at the bottom, is the **day**: §9.6's painted four-stop
// wash. It is new, and it exists because the surface scale was shipping a
// two-stop `mix(uZenith, uHorizon, pow(1-y, 2.6))` — a flat pale wash with no
// vertical structure, no azimuthal asymmetry, no Mie halo and no cirrus, whose
// two colours were `pp.atmoColor * 0.5` and `pp.atmoColor * 0.26`. Nine of the
// ten stops §9.1 names, and every one of them already computed by the transfer
// in `starlight.js`, went unread. See `SKY_BODY_GLSL`.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { softDotTexture, nebulaTexture } from './nebula.js';
import { blackbodyRGB } from './planet.js';
import { airColoursQuantised } from './starlight.js';

// Blackbody color ramp, log-spaced 1500 K → 30000 K (T = 1500·20^u)
let _rampTex = null, _rampCols = null;
function blackbodyRamp() {
  if (_rampTex) return { tex: _rampTex, cols: _rampCols };
  const N = 128;
  const data = new Uint8Array(N * 4);
  _rampCols = [];
  for (let i = 0; i < N; i++) {
    const T = 1500 * Math.pow(20, i / (N - 1));
    const c = blackbodyRGB(T);
    data[i * 4] = c.r * 255; data[i * 4 + 1] = c.g * 255; data[i * 4 + 2] = c.b * 255; data[i * 4 + 3] = 255;
    _rampCols.push(c);
  }
  _rampTex = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  _rampTex.minFilter = _rampTex.magFilter = THREE.LinearFilter;
  _rampTex.needsUpdate = true;
  return { tex: _rampTex, cols: _rampCols };
}

// Special relativity, star by star: exact aberration, Doppler-shifted
// blackbody color (T' = Tδ walks the ramp), and δ³ headlight beaming.
const RELSKY_VERT = /* glsl */`
  uniform float uBeta;
  uniform vec3 uDir;
  uniform sampler2D uRamp;
  uniform float uPx;
  uniform float uRadius;
  attribute float aBright;
  attribute float aTemp;
  varying vec3 vCol;
  void main() {
    vec3 d = normalize(position);
    float b = uBeta;
    float ct = dot(d, uDir);
    float gam = 1.0 / sqrt(max(1.0 - b * b, 1e-6));
    float ctp = clamp((ct + b) / (1.0 + b * ct), -1.0, 1.0);
    vec3 perp = d - uDir * ct;
    float pl = length(perp);
    vec3 dp = pl > 1e-4
      ? normalize(uDir * ctp + perp * (sqrt(max(1.0 - ctp * ctp, 0.0)) / pl))
      : d;
    float dopp = 1.0 / (gam * (1.0 - b * ctp));
    float u = clamp(aTemp + log(dopp) / 2.9957, 0.02, 0.98); // ln(20)
    vec3 col = texture2D(uRamp, vec2(u, 0.5)).rgb;
    float br = aBright * min(pow(dopp, 3.0), 18.0);
    vCol = min(col * br, vec3(3.0));
    vec4 mv = modelViewMatrix * vec4(dp * uRadius, 1.0);
    gl_PointSize = clamp(uPx * (1.15 + 0.9 * min(br, 2.0)), 1.0, 5.5);
    gl_Position = projectionMatrix * mv;
  }
`;

const RELSKY_FRAG = /* glsl */`
  precision highp float;
  varying vec3 vCol;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r2 = dot(c, c);
    if (r2 > 0.25) discard;
    gl_FragColor = vec4(vCol * exp(-r2 * 13.0), 1.0);
  }
`;

/**
 * The night sky as it truly is from a point inside a galaxy: every one of the
 * galaxy's rendered stars projected onto the sky sphere with 1/d² brightness.
 * Stand near the rim and the band thins; near the core and the sky burns.
 *
 * `starData` are the arrays from generateGalaxyStars; `time`/`vrot` freeze the
 * differential rotation at the moment of arrival; the system's own sun (any
 * star within ~2 units of the viewer) is skipped — it's rendered in person.
 */
export function makeGalaxySkyFromWithin(starData, time, vrot, viewerPos, radius) {
  const group = new THREE.Group();
  const { aR, aTheta, aY, aColor, aSize } = starData;
  const N = aR.length;
  const ramp = blackbodyRamp();
  const pos = new Float32Array(N * 3);
  const bright = new Float32Array(N);
  const temp = new Float32Array(N);
  const K_LUM = 60; // display-unit luminance scale, tuned for the band to glow
  let j = 0;
  let bulgeDir = null;
  for (let i = 0; i < N; i++) {
    const th = aTheta[i] + (vrot / Math.max(aR[i], 14)) * time;
    const wx = aR[i] * Math.cos(th) - viewerPos.x;
    const wy = aY[i] - viewerPos.y;
    const wz = aR[i] * Math.sin(th) - viewerPos.z;
    const d2 = wx * wx + wy * wy + wz * wz;
    if (d2 < 4) continue; // that one is *our* sun
    const inv = 1 / Math.sqrt(d2);
    pos[j * 3] = wx * inv * radius;
    pos[j * 3 + 1] = wy * inv * radius;
    pos[j * 3 + 2] = wz * inv * radius;
    const b = Math.min((K_LUM * (0.5 + aSize[i])) / d2, 1.5);
    // estimate a blackbody temperature from the star's color, so the
    // relativistic Doppler shift can walk it along the ramp honestly
    const r0 = aColor[i * 3], g0 = aColor[i * 3 + 1], b0 = aColor[i * 3 + 2];
    const rb = b0 / Math.max(r0, 1e-4);
    const T = Math.min(Math.max(6400 * Math.pow(rb, 2.2), 1600), 28000);
    const u = Math.log(T / 1500) / Math.log(20);
    temp[j] = u;
    const rc = ramp.cols[Math.min(Math.max((u * 127) | 0, 0), 127)];
    const lum0 = 0.35 * r0 + 0.55 * g0 + 0.1 * b0;
    const lumR = 0.35 * rc.r + 0.55 * rc.g + 0.1 * rc.b;
    bright[j] = b * lum0 / Math.max(lumR, 0.05);
    j++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, j * 3), 3));
  geo.setAttribute('aBright', new THREE.BufferAttribute(bright.subarray(0, j), 1));
  geo.setAttribute('aTemp', new THREE.BufferAttribute(temp.subarray(0, j), 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), radius * 1.01);
  const relUniforms = {
    uBeta: { value: 0 },
    uDir: { value: new THREE.Vector3(0, 0, -1) },
    uRamp: { value: ramp.tex },
    uPx: { value: Math.min(window.devicePixelRatio, 2) },
    uRadius: { value: radius },
  };
  const stars = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: relUniforms,
    vertexShader: RELSKY_VERT,
    fragmentShader: RELSKY_FRAG,
    transparent: true, depthWrite: false, depthTest: false,
    blending: THREE.AdditiveBlending,
  }));
  group.add(stars);
  group.userData.rel = relUniforms;

  // bright stars become destinations for interstellar travel. Bucket the sky
  // by direction and keep each bucket's brightest, so wherever the bow points
  // there is somewhere to go — then add the overall brightest for density
  // along the band.
  const buckets = new Map();
  for (let idx = 0; idx < j; idx++) {
    const dx = pos[idx * 3], dy = pos[idx * 3 + 1], dz = pos[idx * 3 + 2];
    const inv = 1 / Math.hypot(dx, dy, dz);
    const key = (Math.round(dx * inv * 3) + 4) * 81 + (Math.round(dy * inv * 3) + 4) * 9 + (Math.round(dz * inv * 3) + 4);
    const cur = buckets.get(key);
    if (!cur || bright[idx] > cur.b) buckets.set(key, { i: idx, b: bright[idx] });
  }
  const cand = [];
  for (let idx = 0; idx < j; idx++) cand.push({ i: idx, b: bright[idx] });
  cand.sort((a, b) => b.b - a.b);
  const chosen = new Set();
  for (const c of buckets.values()) chosen.add(c.i);
  for (let k = 0; k < 320 && k < cand.length; k++) chosen.add(cand[k].i);
  const targets = [];
  for (const i of chosen) {
    const dx = pos[i * 3], dy = pos[i * 3 + 1], dz = pos[i * 3 + 2];
    const inv = 1 / Math.hypot(dx, dy, dz);
    const dir = new THREE.Vector3(dx * inv, dy * inv, dz * inv);
    // stable neighbor identity from the quantized sky direction
    const q = 40;
    const seed = hash(Math.round(dir.x * q), Math.round(dir.y * q), Math.round(dir.z * q), 0x5741) >>> 0;
    targets.push({ dir, seed, temp: temp[i] });
  }
  group.userData.targets = targets;

  // the bulge glows toward galactic center
  bulgeDir = new THREE.Vector3(-viewerPos.x, -viewerPos.y * 0.4, -viewerPos.z);
  const dCore = Math.max(bulgeDir.length(), 8);
  bulgeDir.normalize();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDotTexture(),
    color: new THREE.Color(1.0, 0.82, 0.6).multiplyScalar(Math.min(30 / dCore, 0.34)),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
  }));
  glow.position.copy(bulgeDir).multiplyScalar(radius * 0.97);
  glow.scale.setScalar(radius * (0.35 + 24 / dCore));
  group.add(glow);

  return group;
}

export function makeSkyDome(seed, radius) {
  const group = new THREE.Group();
  const r = new RNG(hash(seed, 0x5c7));

  // random great circle for the galactic plane
  const nz = r.float(-1, 1), nth = r.float(0, Math.PI * 2);
  const ns = Math.sqrt(1 - nz * nz);
  const normal = new THREE.Vector3(ns * Math.cos(nth), ns * Math.sin(nth), nz);
  const u = new THREE.Vector3(0, 1, 0).cross(normal);
  if (u.lengthSq() < 1e-4) u.set(1, 0, 0); else u.normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);

  const N = 9000;
  const pos = new Float32Array(N * 3);
  const col = new Float32Array(N * 3);
  const dir = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const inBand = i < N * 0.55; // over half the stars hug the galactic plane
    if (inBand) {
      const th = r.float(0, Math.PI * 2);
      const lat = r.gauss() * 0.12;
      dir.copy(u).multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th)).addScaledVector(normal, lat).normalize();
    } else {
      const z = r.float(-1, 1), th = r.float(0, Math.PI * 2);
      const s = Math.sqrt(1 - z * z);
      dir.set(s * Math.cos(th), s * Math.sin(th), z);
    }
    pos[i * 3] = dir.x * radius; pos[i * 3 + 1] = dir.y * radius; pos[i * 3 + 2] = dir.z * radius;
    const t = Math.pow(r.next(), 3);
    const b = 0.25 + 1.3 * Math.pow(r.next(), 6);
    col[i * 3] = b * (1 - t * 0.25);
    col[i * 3 + 1] = b * (0.82 + 0.1 * t);
    col[i * 3 + 2] = b * (0.72 + 0.5 * t);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({
    size: radius * 0.0021, vertexColors: true, sizeAttenuation: true,
    map: softDotTexture(64), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  group.add(stars);

  // the soft glowing band itself
  const bandTex = nebulaTexture(hash(seed, 3), 256);
  const M = 42;
  for (let i = 0; i < M; i++) {
    const th = (i / M) * Math.PI * 2;
    const lat = r.gauss() * 0.05;
    dir.copy(u).multiplyScalar(Math.cos(th)).addScaledVector(v, Math.sin(th)).addScaledVector(normal, lat).normalize();
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map: bandTex,
      color: new THREE.Color(0.035, 0.033, 0.05),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      rotation: r.float(0, Math.PI * 2),
    }));
    sp.position.copy(dir).multiplyScalar(radius * 0.98);
    sp.scale.setScalar(radius * r.float(0.28, 0.5));
    group.add(sp);
  }

  // occasionally, a vast drifting emission nebula owns a corner of the sky
  if (r.chance(0.45)) {
    const z = r.float(-0.7, 0.7), th = r.float(0, Math.PI * 2);
    const s = Math.sqrt(1 - z * z);
    dir.set(s * Math.cos(th), s * Math.sin(th), z);
    const warm = r.chance(0.5);
    const tint = warm ? new THREE.Color(0.10, 0.028, 0.045) : new THREE.Color(0.03, 0.055, 0.08);
    for (let i = 0; i < 4; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: bandTex, color: tint,
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
        rotation: r.float(0, Math.PI * 2),
      }));
      sp.position.copy(dir).multiplyScalar(radius * 0.96)
        .add(new THREE.Vector3(r.gauss(), r.gauss(), r.gauss()).multiplyScalar(radius * 0.07));
      sp.scale.setScalar(radius * r.float(0.3, 0.55));
      group.add(sp);
    }
  }

  return group;
}

// ===========================================================================
// §9.6 · THE DAY SKY — a painted gradient, not a scattering integral
// ===========================================================================
//
// §9.6 is unusually specific, and every clause of it is here:
//
//   "Four-stop vertical wash, azimuthal asymmetry (warm toward sun, cool
//    away), Mie halo as pow(ang,7)·0.72 + pow(ang,1.9)·0.16, sun disc painted
//    3× oversize and never blown out, sheared cirrus above the horizon."
//
// …followed by AEON's own complication, which is the whole reason this is a
// module and not eight hex literals:
//
//   "derive the four sky stops from the star's spectrum through a fixed
//    transfer, rather than hardcoding them. The stops above are that
//    transfer's output for a G-type star at 13.5°. That is the port: not the
//    values, the function that produced them."
//
// That transfer already exists and is already correct — `starlight.js`
// integrates Planck against the CIE colour-matching functions through Rayleigh
// and Ångström optical depths and von Kries-adapts §9.1's painted stops onto
// the result, and `tools/verify.js` pins it to §9.1's hexes at the fixture. So
// this file writes **no colour at all**. Every one of the ten stops arrives as
// a uniform, from `airColoursQuantised(T, elev)`, and a red dwarf's sky comes
// out of the same code looking like a red dwarf's sky because the numbers that
// went in were a red dwarf's numbers.
//
// ---------------------------------------------------------------------------
// Why the shape matters more than the palette
//
// The frame this replaced was not dark, and it was not the wrong hue. It was
// *flat*: one `mix()` between two colours, on `pow(1 - y, 2.6)`. Two stops
// cannot hold a horizon. The four-stop wash puts three separate transitions
// into the top half of the frame — horizon→mid at y≈0.05, mid→upper at y≈0.23,
// upper→zenith at y≈0.6 — and the azimuthal term then rotates the horizon band
// itself, warm on the sun's side and cool on the anti-solar side. That is what
// makes a skyline a *line* rather than the place two greys happen to meet, and
// it is §8 axis 3's third depth plane arriving for free.
//
// ---------------------------------------------------------------------------
// What is deliberately not physical, per §11's last trap
//
// The sun disc is painted 3× oversize and the band edges in the wash are soft
// but visible. Both look like defects to a PBR reflex. §9.6 and §11 both say
// so in advance, so they are spelled out here rather than discovered later:
//
//   · the disc is `mix(col, uSunDisc * 1.9, mask)` — a *mix*, not an additive
//     term, so it cannot exceed 1.9 no matter what else is in the pixel. Under
//     §9.4's rational tonemap 1.9 prints at about 0.81, which is a bright warm
//     cream and not white. "Never blown out" is enforced by the operator, not
//     by hoping the exposure stays low. The path this replaced was
//     `uSunColor * disk * 5.0`, added — which clips, and which then feeds a
//     clipped white into the bloom pyramid.
//
//   · the halo is clamped at 0.9, so the sky's own colour is never entirely
//     replaced even at the centre of the glow.

/**
 * A gradient noise for the cirrus, and nothing else in the frame.
 *
 * Self-contained on purpose. The sky shader is included into hosts that may or
 * may not already have `NOISE_GLSL` (surface.js's sky did not), and a second
 * `snoise` in one program is a redefinition error rather than a wrong picture.
 * Every symbol here is prefixed `sky`.
 *
 * The hash is the fract/dot family already used by `surface.js`'s `hash13`,
 * not a `sin()` hash: `sin` at large arguments is precision-dependent, and a
 * cirrus deck that differs between two drivers is a §2.3 leak that only ever
 * shows up in somebody else's screenshot.
 */
const SKY_NOISE_GLSL = /* glsl */`
vec2 skyHash2(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy) * 2.0 - 1.0;
}
float skyNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return 1.4 * mix(
    mix(dot(skyHash2(i), f), dot(skyHash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(skyHash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)),
        dot(skyHash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x), u.y);
}
`;

/** an unrolled fbm — the octave count is a tier knob, so it is not a loop */
const skyFbm = (n) => /* glsl */`
float skyFbm${n}(vec2 p) {
  float v = 0.0, a = 0.5;
  ${Array.from({ length: n }, () => 'v += a * skyNoise(p); p = p * 2.07 + 11.3; a *= 0.5;').join('\n  ')}
  return v;
}
`;

/**
 * The ten stops, as uniforms. Declared apart from the body so a host that
 * already has `uSunDir` (most surface-scale shaders do) can include the body
 * without a redefinition — the same split `wind.js` makes between `WIND_GLSL`
 * and `WIND_CONSUMER_GLSL`, for the same reason.
 */
export const SKY_UNIFORM_GLSL = /* glsl */`
uniform vec3 uSkyZen;      // §9.1's four-stop vertical wash, zenith → horizon
uniform vec3 uSkyUp;
uniform vec3 uSkyMid;
uniform vec3 uSkyHor;
uniform vec3 uSkyAnti;     // the anti-solar horizon: cool
uniform vec3 uSkyHorSun;   // the solar horizon: warm
uniform vec3 uSunGlow;     // the Mie halo's colour
uniform vec3 uSunDiscCol;  // the disc, painted — see the note on 1.9
uniform vec3 uSkyHaze;     // the ground-side wash, so the dome has no edge
uniform vec3 uSkyMist;
uniform vec3 uCirrusCol;
uniform float uSunAng;     // PAINTED angular radius of the disc, radians (3×)
uniform float uSkyAir;     // 0 vacuum … 1 thick atmosphere
uniform float uSkyLum;     // 0.055 night floor … 1 full day
uniform float uCirrusAmt;  // cirrus coverage, 0 … 1
uniform vec2 uCirrusDir;   // unit; the upper wind, so the streaks lie along it
uniform vec2 uCirrusDrift; // metres of advection, from the shared wind field
`;

const SKY_SUN_GLSL = /* glsl */`
uniform vec3 uSunDir;
`;

/**
 * The body. `cirrusWarp`/`cirrusDetail` are octave counts, because the cirrus
 * is the only expensive thing in this shader and §5 wants one row of the
 * quality table to reconfigure it.
 */
const skyBody = (cirrusWarp, cirrusDetail, scattered = false) => /* glsl */`
${SKY_NOISE_GLSL}
${skyFbm(cirrusDetail)}
${cirrusWarp > 0 ? skyFbm(cirrusWarp) : ''}

// The wash, and only the wash. skyDomeLite and skyDome share it so a
// reflection and the sky it reflects cannot drift apart.
vec3 skyWash(vec3 d) {
  float yy = max(d.y, -0.18);
  // four stops. The band edges overlap deliberately — a hard join between two
  // of them would be a horizon in the wrong place.
  vec3 col = mix(uSkyHor, uSkyMid, smoothstep(-0.02, 0.13, yy));
  col = mix(col, uSkyUp,  smoothstep(0.10, 0.36, yy));
  col = mix(col, uSkyZen, smoothstep(0.32, 0.86, yy));

  // azimuthal asymmetry: warm toward the sun, cool away from it. This is the
  // term that gives the horizon a *direction*, which is most of why a painted
  // sky beats a scattering integral at a fifth of the cost.
  vec2 dh = normalize(d.xz + vec2(1e-5));
  vec2 sh = normalize(uSunDir.xz + vec2(1e-5));
  float az = dot(dh, sh) * 0.5 + 0.5;
  float horiz = pow(1.0 - clamp(yy, 0.0, 1.0), 3.4);
  col = mix(col, uSkyAnti,   horiz * (1.0 - az) * 0.62);
  col = mix(col, uSkyHorSun, horiz * pow(az, 2.1) * 0.92);
  return col;
}

// The full dome. sunMask comes back so a god-ray or flare pass can be gated
// on the disc the sky actually drew, rather than on its own idea of where the
// sun is.
vec3 skyDome(vec3 d, out float sunMask) {
  float air = clamp(uSkyAir, 0.0, 1.0);
  float ang = dot(d, uSunDir);
${scattered ? /* glsl */`
  // The wash is an integral now — see atmosphere.js.
  //
  // What it replaces is skyWash()'s four painted stops plus a painted Mie
  // halo. Both are models of scattering, and there is a scattering model here
  // now, so keeping them would be the same light counted twice — the aureole
  // especially, which the Mie phase inside skyRadiance() already produces and
  // which is exactly what pow(ang, 7.0) was approximating.
  //
  // Everything below this line stays: the disc, the cirrus, the ground-side
  // wash. Those are art direction rather than physics — §9.6 draws the disc
  // three times oversize on purpose and says so — and an integral has no
  // opinion about them.
  vec3 col = skyRadiance(d).rgb;
` : /* glsl */`
  vec3 col = skyWash(d) * (uSkyLum * air);

  // Mie forward-scatter halo — §9.6's exponents exactly. It is scattered
  // light, so it needs air: in vacuum this term is zero and the star sits on
  // black, which is §2.8 arriving out of the physics rather than a branch.
  float halo = pow(max(ang, 0.0), 7.0);
  float wide = pow(max(ang, 0.0), 1.9);
  col = mix(col, uSunGlow * uSkyLum,
            clamp(halo * 0.72 + wide * 0.16, 0.0, 0.9) * air);
`}

  // The disc. Chord length rather than the angle: for a sun a third of a
  // degree across, cos(ang) sits 1e-5 below 1.0, and thresholding a float32
  // dot product there is a handful of ulps from the answer. |d - sunDir| is
  // 2·sin(ang/2) ≈ ang, and it is exact where it matters.
  float chord = length(d - uSunDir);
  // Below the horizon the disc is occluded by the world, not by the shader —
  // but the dome is drawn at infinity, so it has to say so itself.
  float up = smoothstep(-0.035, 0.005, uSunDir.y);
  sunMask = smoothstep(uSunAng * 1.10, uSunAng * 0.88, chord) * up;
  // A mix, not an add. See this section's header: this is what "never blown
  // out" is implemented as.
  col = mix(col, uSunDiscCol * 1.9, sunMask);

  // Sheared cirrus, above the horizon only. The shear is along the *upper*
  // wind rather than along world z: the reference could bake its one wind
  // direction into the anisotropy, and AEON cannot, because the streaks have
  // to lie along whatever direction this world's Ekman-veered deck is running.
  float cd = smoothstep(0.035, 0.30, max(d.y, 0.0));
  if (cd > 0.001 && uCirrusAmt > 0.002) {
    // project the ray onto a flat deck, then rotate into the wind's frame
    vec2 fp = d.xz / max(d.y, 0.05) * 0.0016 + uCirrusDrift * 0.00022;
    vec2 sp = vec2(dot(fp, uCirrusDir), dot(fp, vec2(-uCirrusDir.y, uCirrusDir.x)));
    ${cirrusWarp > 0 ? `vec2 w = vec2(skyFbm${cirrusWarp}(sp * 2.1 + vec2(7.3, 2.1)),
                    skyFbm${cirrusWarp}(sp * 2.1 + vec2(1.9, 9.4)));`
    : 'vec2 w = vec2(0.0);'}
    // 0.55 along the wind against 3.4 across it: a 6:1 stretch, which is what
    // makes a lump of noise read as a mare's tail
    float ci = skyFbm${cirrusDetail}(vec2(sp.x * 0.55, sp.y * 3.4) + w * 0.6);
    ci = smoothstep(0.10, 0.44, ci) * cd * (0.30 + 0.5 * pow(max(ang, 0.0), 1.4));
    // ice forward-scatters hard, so cirrus in front of the sun is the
    // brightest thing in the sky that is not the sun
    col = mix(col, uCirrusCol * uSkyLum * (0.92 + 0.55 * pow(max(ang, 0.0), 3.0)),
              clamp(ci * 0.55 * uCirrusAmt * air, 0.0, 1.0));
  }

  // the ground-side wash, so the dome never shows a hard edge below the
  // horizon where the terrain does not reach
  col = mix(col, mix(uSkyHaze, uSkyMist, 0.35) * (uSkyLum * air),
            smoothstep(0.0, -0.16, d.y));
  return col;
}

// §9.6: "Keep a lightweight variant without disc or cirrus for reflections —
// moving water resolves none of it and the octaves come back as sparkle."
vec3 skyDomeLite(vec3 d) {
  float air = clamp(uSkyAir, 0.0, 1.0);
  vec3 col = skyWash(d) * (uSkyLum * air);
  float ang = max(dot(d, uSunDir), 0.0);
  col = mix(col, uSunGlow * uSkyLum,
            clamp(pow(ang, 7.0) * 0.72 + pow(ang, 1.9) * 0.16, 0.0, 0.9) * air);
  return col;
}
`;

/** octaves per tier. Low gets no warp at all — see `skyGLSL`. */
const CIRRUS_OCTAVES = {
  low: [0, 2], mobile: [1, 3], desktop: [2, 4], ultra: [2, 5],
};

/**
 * The chunk, built for a tier.
 *
 * `withSun` is false for a host that already declares `uSunDir` — which is
 * every surface-scale material in this repo, and the reason this is a
 * parameter rather than one constant.
 *
 * The cirrus is the only thing in the shader whose cost is not fixed, and it
 * is the thing §5 says must be a row: at `low` it is two octaves and no domain
 * warp (three noise lookups a pixel), at `desktop` it is the reference's own
 * two-plus-four (six). The wash, the asymmetry, the halo and the disc are the
 * same arithmetic on every tier, because none of them is measurable.
 */
/**
 * @param {string} tier     which cirrus octave count this row gets
 * @param {boolean} withSun whether the host already declares uSunDir
 * @param {string} atmo     atmosphere.js's chunk, or '' for §9.6's painted
 *                          gradient. Its presence is what switches the dome
 *                          from a wash to an integral — see skyBody.
 */
export function skyGLSL(tier = 'desktop', withSun = true, atmo = '') {
  const [w, d] = CIRRUS_OCTAVES[tier] || CIRRUS_OCTAVES.desktop;
  return (withSun ? SKY_SUN_GLSL : '') + SKY_UNIFORM_GLSL + atmo
    + skyBody(w, d, !!atmo);
}

/**
 * The dome itself, plus the uniform block and the per-frame sync.
 *
 * `sunDir` must be the **same uniform object** the rest of the scale holds, not
 * a copy — the sky, the terrain, the grass and the flare all have to agree
 * about where the star is to within a frame, and sharing the object is the only
 * way that cannot drift.
 *
 * `sunAng` is the **painted** angular radius, in radians: the caller has
 * already multiplied the true `atan(rStar / a)` by §9.6's 3. Keeping the
 * physics and the paint in the caller means this file never has to know which
 * of the two it was handed.
 */
export function makeSurfaceSky({
  sunDir, T = 5778, atmo = 1, sunAng = 0.012, cirrus = 0.45,
  tier = 'desktop', radius = 20000, scattering = null,
} = {}) {
  const v3 = (c) => new THREE.Vector3(c[0], c[1], c[2]);
  const u = {
    uSunDir: sunDir || { value: new THREE.Vector3(0, 1, 0) },
    uSkyZen: { value: new THREE.Vector3() },
    uSkyUp: { value: new THREE.Vector3() },
    uSkyMid: { value: new THREE.Vector3() },
    uSkyHor: { value: new THREE.Vector3() },
    uSkyAnti: { value: new THREE.Vector3() },
    uSkyHorSun: { value: new THREE.Vector3() },
    uSunGlow: { value: new THREE.Vector3() },
    uSunDiscCol: { value: new THREE.Vector3() },
    uSkyHaze: { value: new THREE.Vector3() },
    uSkyMist: { value: new THREE.Vector3() },
    uCirrusCol: { value: new THREE.Vector3() },
    uSunAng: { value: Math.max(sunAng, 0.006) },
    uSkyAir: { value: atmo },
    uSkyLum: { value: 1 },
    uCirrusAmt: { value: cirrus },
    uCirrusDir: { value: new THREE.Vector2(1, 0) },
    uCirrusDrift: { value: new THREE.Vector2(0, 0) },
    // the integral's own block, when there is one — `atmosphere.js`
    ...(scattering ? scattering.uniforms : {}),
  };

  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 48, 24),
    new THREE.ShaderMaterial({
      uniforms: u,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = position;
          gl_Position = (projectionMatrix * mat4(mat3(viewMatrix)) * vec4(position, 1.0)).xyww;
        }
      `,
      fragmentShader: /* glsl */`
        precision highp float;
        // withSun: true. This read false — the value for a chunk injected into
        // a host material that already declares uSunDir, which is every *other*
        // consumer of skyGLSL in the repo. This one is a standalone
        // ShaderMaterial with no host, so nothing declared it and the fragment
        // did not compile: six errors from line 118, starting at uSunDir.xz in
        // the azimuthal-asymmetry term.
        //
        // It could not have been caught until now. Nothing called
        // makeSurfaceSky, and dead GLSL compiles perfectly — §M0's rule is that
        // a shader must be compile-checked *as assembled*, and a shader that is
        // never assembled has nothing to check. The first frame that asked for
        // this sky is the first frame that could have found it.
        ${skyGLSL(tier, true, scattering ? scattering.glsl : '')}
        varying vec3 vDir;
        void main() {
          float sm;
          vec3 col = skyDome(normalize(vDir), sm);
          // Alpha is clarity (src/aerial.js). The sky is at infinity, so it is
          // the least clear thing in the frame and §9.4 step 5 gives it the
          // full watercolour wash — which is what a painted sky wants.
          gl_FragColor = vec4(col, 0.0);
        }
      `,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
    }));
  mesh.frustumCulled = false;
  mesh.renderOrder = -1000;

  /**
   * Per frame. `elevDeg` is the star's elevation; everything else follows.
   *
   * The stops come from the **quantised** transfer, not the exact one: a
   * spectral integral over fourteen — now twenty-one — stops costs 1.7 ms, and
   * §5 makes 12 ms the whole CPU frame. The bucket is in airmass rather than
   * elevation, for the reason `starlight.js` gives, and its worst step is
   * below the display's own quantisation.
   */
  function update(elevDeg, { cirrusDrift, cirrusDir } = {}) {
    // An airless world's star is not reddened by air it does not have, so the
    // beam stops are evaluated at the zenith rather than at the true elevation.
    // Without this a moon at sunset would have an orange sun, which is a lie
    // the transfer would tell perfectly happily.
    const air = clamp01(atmo);
    const a = airColoursQuantised(T, Math.max(air > 0.15 ? elevDeg : 90, 0.5));
    u.uSkyZen.value.set(...a.skyZenith);
    u.uSkyUp.value.set(...a.skyUpper);
    u.uSkyMid.value.set(...a.skyMid);
    u.uSkyHor.value.set(...a.skyHorizon);
    u.uSkyAnti.value.set(...a.skyAnti);
    u.uSkyHorSun.value.set(...a.skyHorizonSun);
    u.uSunGlow.value.set(...a.sunGlow);
    u.uSunDiscCol.value.set(...a.sunDisc);
    u.uSkyHaze.value.set(...a.haze);
    u.uSkyMist.value.set(...a.mist);
    u.uCirrusCol.value.set(...a.cirrus);

    // The night floor. Civil twilight is about −6°, and below it the air is
    // still lit by light it no longer receives directly — 0.055 rather than
    // zero, which is `_syncAerial`'s own floor and §2.8's ruling that inside an
    // atmosphere nothing reaches pure black.
    const y = Math.sin((elevDeg * Math.PI) / 180);
    u.uSkyLum.value = 0.055 + 0.945 * clamp01((y + 0.10) / 0.28);

    if (cirrusDrift) u.uCirrusDrift.value.set(cirrusDrift.x, cirrusDrift.y);
    if (cirrusDir) {
      const L = Math.hypot(cirrusDir.x, cirrusDir.y) || 1;
      u.uCirrusDir.value.set(cirrusDir.x / L, cirrusDir.y / L);
    }
  }
  update(13.5);

  return { mesh, uniforms: u, update };
}

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);
