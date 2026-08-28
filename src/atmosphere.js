// The sky the planet already had, and lost the moment you landed.
//
// `planetscale.js` builds real Rayleigh + Mie transmittance and
// multiple-scattering LUTs through `scatterlut.js` and renders the atmosphere
// from orbit. Land, and `surface.js` paints a four-stop gradient instead.
//
// §9.6 ruled that deliberately — *"a painted gradient, not a scattering
// integral. Deliberate, and right — cheaper, art-directable, and it looks
// better."* Two of those three were true when it was written. It is not
// cheaper any more, because the expensive part of a scattering integral is the
// nested sun-march and `scatterlut.js` already removed it; and "looks better"
// was a judgement against a from-orbit shader nobody had ever stood under.
//
// This overrides that clause. What it keeps is the clause §9.6 spends most of
// its words on:
//
//   "sun colour must stay honest to the star's blackbody temperature... derive
//    the four sky stops from the star's spectrum through a fixed transfer,
//    rather than hardcoding them. That is the port: not the values, the
//    function that produced them."
//
// The function that produces them is now the scattering integral itself. A
// G-type star gives an Earth-blue sky because 5,800 K through 1/λ⁴ *is* an
// Earth-blue sky; a 3,300 K red dwarf gives its own, from the same code.
//
// ---------------------------------------------------------------------------
// Where the numbers come from, and why none of them is a colour
//
// The medium this replaces was `pp.atmoColor × 0.0095` — a *painted* scattering
// coefficient, which is the same category error one level down: art direction
// standing in for a measurement, inside a model whose whole claim is that it is
// measured.
//
// Rayleigh scattering goes as 1/λ⁴, and Earth's sea-level coefficients are
// known: 5.8, 13.5 and 33.1 × 10⁻⁶ m⁻¹ at 680, 550 and 440 nm. Those are the
// constants here. What this world does to them is physics the repo already
// computes:
//
//   · **column density** scales with surface pressure — `atmo`, linearly;
//   · **scale height** is `kT/mg`, which `aerial.js:scaleHeight()` already
//     derives from this world's temperature, molar mass and gravity;
//   · **composition** moves the molar mass, which moves the scale height, which
//     is why a hydrogen envelope is deep and hazy and a CO₂ one is shallow.
//
// So a thick-atmosphere world has a different sky because its air is different,
// not because a different colour was chosen for it.
//
// Three-free, so `tools/verify.js` can hold the mirror. The assembly that needs
// three — the LUTs and the uniform block — lives in `scatterlut.js`, which
// already owns the tables and already imports it.

import { molarMass, scaleHeight, surfaceTemp } from './aerial.js';
import { planck, spectrumToXYZ, xyzToLinearSRGB } from './starlight.js';

/** Earth's Rayleigh coefficients at sea level, per metre, at 680/550/440 nm */
export const BETA_R_EARTH = [5.802e-6, 13.558e-6, 33.1e-6];

/** Earth's Mie coefficient, per metre — grey, as aerosol very nearly is */
export const BETA_M_EARTH = 21e-6;

/** Earth's aerosol scale height, metres. Rayleigh's comes from `kT/mg`. */
export const H_MIE_EARTH = 1200;

/** Earth's own scale height, the divisor that makes `atmo = 1` return Earth */
export const H_RAY_EARTH = 8500;

/** the Mie asymmetry — forward-scattering, which is what makes the aureole */
export const MIE_G = 0.76;

/**
 * What lifts the model's output into the renderer's linear range.
 *
 * Not a guess and not a taste. `solveExposure()` integrates Earth's zenith at a
 * 60 degree sun and scales it to linear 1.0, which is where §9.4's tonemap puts
 * a bright unclipped sky — that curve sends 1.0 to 0.70 on the display. It
 * comes out at 65.8; the first version of this file guessed **22**, three times
 * too dark, and looked exactly like a sky that had been graded rather than lit.
 *
 * Trimmed to 56 from there for one stated reason: `solveExposure()` integrates
 * single scattering only, and the shader adds the multiple-scattering LUT on
 * top, which at an Earth zenith is worth something like a further fifth. Better
 * to name the correction than to let the twin and the shader disagree by it
 * silently.
 *
 * One number for every world, deliberately. A thin atmosphere is dark because
 * it scatters less, not because it is exposed differently — calibrating per
 * world would delete exactly the thing the model is for.
 */
export const SKY_EXPOSURE = 56;

/** how far above the ground the model stops caring, in scale heights */
export const ATMO_TOP = 9;

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * This world's air, as the six numbers the integral needs.
 *
 * Three-free on purpose, so `tools/verify.js` can hold the mirror — the
 * property `material.js`, `meadow.js`, `cloudshade.js` and `drainage.js` have,
 * and bought the same way.
 *
 * @param {object} pp    the planet params
 * @param {number} atmo  surface pressure, Earth = 1
 * @param {number} g     surface gravity, m/s²
 */
export function mediumFor(pp = {}, atmo = 1, g = 9.81) {
  const a = clamp(atmo, 0, 40);
  const T = surfaceTemp(pp.Teq ?? 288, a);
  const M = molarMass(pp.typeId ?? 1);
  // kT/mg — the same derivation §9.3's haze already runs, so the sky and the
  // fog cannot disagree about how deep this world's air is
  const Hr = clamp(scaleHeight(T, M, Math.max(g, 0.05)), 300, 120000);
  // aerosol sits in the boundary layer and scales with it rather than with the
  // gas column: a deep atmosphere is not proportionally dustier
  const Hm = clamp(Hr * (H_MIE_EARTH / H_RAY_EARTH), 60, 30000);

  // Column density scales with pressure. Coefficients are per *metre* at the
  // surface, so what changes with `atmo` is the number density there.
  const k = a;
  const R = Math.max(pp.radiusE ?? 1, 0.05) * 6.371e6;
  return {
    R,
    Ra: R + Hr * ATMO_TOP,
    betaR: BETA_R_EARTH.map((b) => b * k),
    betaM: BETA_M_EARTH * k,
    Hr,
    Hm,
    /** for the report line, and for the suite: how Earth-like this air is */
    earthLike: k * (Hr / H_RAY_EARTH),
  };
}

/**
 * The star's irradiance at the top of this world's atmosphere, as linear RGB
 * normalised to unit luminance.
 *
 * At the *top*, deliberately. `starlight.js:beamXYZ()` returns the beam after
 * airmass extinction, which is the right answer for a light model that has no
 * atmosphere in it — and exactly the wrong one here, because the integral below
 * computes that extinction itself. Handing it a pre-reddened sun reddens the
 * sunset twice.
 */
export function starIrradiance(T = 5778) {
  const xyz = spectrumToXYZ((l) => planck(l, Math.max(T, 500)));
  const rgb = xyzToLinearSRGB(xyz);
  const lum = Math.max(rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722, 1e-9);
  return rgb.map((c) => Math.max(c, 0) / lum);
}

/**
 * The march, as a chunk.
 *
 * Structure ported from `planetscale.js`'s `ATMO2_FRAG`, which is already
 * correct and already reads the two LUTs — and, being written in terms of
 * `rsi()` against the atmosphere shell, is position-independent. Standing on
 * the ground puts the camera inside the shell, `atm.x` goes negative and `t0`
 * clamps to zero; nothing else changes. That is the whole reason this is a port
 * of forty lines rather than a new model.
 *
 * @param {number} steps the tier's `atmoSteps` — 6 on low, 16 on ultra
 */
export function atmosphereGLSL(steps = 12) {
  const N = Math.max(2, Math.min(64, Math.round(steps)));
  return /* glsl */`
uniform vec3  uAtmoCam;     // the eye, in planet frame — metres from the centre
uniform vec3  uAtmoSun;     // toward the star
uniform vec3  uAtmoBetaR;
uniform vec3  uAtmoSunCol;  // the star's spectrum at the TOP of the air
uniform float uAtmoBetaM;
uniform float uAtmoR;
uniform float uAtmoRa;
uniform float uAtmoHr;
uniform float uAtmoHm;
uniform float uAtmoI;
uniform sampler2D uAtmoT;
uniform sampler2D uAtmoMS;
uniform float uAtmoPsi;
// GLSL ES 1.00 spells it texture2D and 3.00 spells it texture, and this
// chunk is included in both: the terrain's fragment shader is 1.00 and the
// blade's *vertex* shader is 3.00. three defines the alias for 1.00 shaders and
// deliberately does not for 3.00, so a chunk that hard-codes either one
// compiles in one host and fails in the other — which is how this was found,
// with the meadow silently absent and the terrain fine.
#ifndef AEON_TEX
  #if __VERSION__ >= 300
    #define AEON_TEX(s, uv) texture(s, uv)
  #else
    #define AEON_TEX(s, uv) texture2D(s, uv)
  #endif
#endif

vec2 atmoRSI(vec3 o, vec3 d, float r) {
  float b = dot(o, d);
  float c = dot(o, o) - r * r;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(-1.0);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}
vec2 atmoLutUV(float h, float mu) {
  return vec2((mu + 0.3) / 1.3, clamp(h / (uAtmoRa - uAtmoR), 0.0, 1.0));
}
vec3 atmoSunT(float h, float mu) {
  vec3 s = AEON_TEX(uAtmoT, atmoLutUV(h, mu)).rgb;
  return s * s;   // sqrt-encoded, so twilight does not band
}

// The sky along one direction. rgb is radiance; a is the view transmittance,
// which is what a sun disc has to be multiplied by to set behind the air.
vec4 skyRadiance(vec3 dir) {
  vec3 o = uAtmoCam;
  vec2 atm = atmoRSI(o, dir, uAtmoRa);
  if (atm.y < 0.0) return vec4(0.0, 0.0, 0.0, 1.0);
  float t0 = max(atm.x, 0.0);
  float t1 = atm.y;
  vec2 gnd = atmoRSI(o, dir, uAtmoR);
  // Looking down from inside, the near root is behind us and the far one is the
  // ground: take whichever is in front. Getting this wrong is a black band at
  // the horizon, which is the artefact that says a from-orbit shader was reused
  // from underneath without being asked where the ground went.
  if (gnd.x > 0.0) t1 = min(t1, gnd.x);
  else if (gnd.y > 0.0) t1 = min(t1, gnd.y);
  if (t1 <= t0) return vec4(0.0, 0.0, 0.0, 1.0);

  float dt = (t1 - t0) / ${N}.0;
  vec3 sumR = vec3(0.0), sumM = vec3(0.0), msL = vec3(0.0);
  float odR = 0.0, odM = 0.0;
  for (int i = 0; i < ${N}; i++) {
    vec3 x = o + dir * (t0 + (float(i) + 0.5) * dt);
    float xr = length(x);
    float h = max(xr - uAtmoR, 0.0);
    float dR = exp(-h / uAtmoHr) * dt;
    float dM = exp(-h / uAtmoHm) * dt;
    odR += dR; odM += dM;
    vec3 Tv = exp(-uAtmoBetaR * odR - uAtmoBetaM * 1.1 * odM);
    float mus = dot(x, uAtmoSun) / xr;
    vec3 Ts = atmoSunT(h, mus);
    sumR += Tv * Ts * dR;
    sumM += Tv * Ts * dM;
    msL += Tv * AEON_TEX(uAtmoMS, atmoLutUV(h, mus)).rgb * uAtmoPsi
         * (uAtmoBetaR * dR + vec3(uAtmoBetaM * dM));
  }
  float mu = dot(dir, uAtmoSun);
  float phR = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
  const float g = ${MIE_G.toFixed(2)};
  float phM = 3.0 / (8.0 * 3.14159265) * (1.0 - g * g) * (1.0 + mu * mu)
    / ((2.0 + g * g) * pow(max(1.0 + g * g - 2.0 * g * mu, 1e-4), 1.5));
  vec3 L = (sumR * uAtmoBetaR * phR + sumM * uAtmoBetaM * phM + msL)
         * uAtmoI * uAtmoSunCol;
  vec3 Tview = exp(-uAtmoBetaR * odR - uAtmoBetaM * 1.1 * odM);
  return vec4(max(L, 0.0), clamp(dot(Tview, vec3(0.3333)), 0.0, 1.0));
}
`;
}

// ---------------------------------------------------------------------------
// the same integral, on the CPU
//
// §7.3: "New shader math gets a CPU reference implementation and a pixel diff
// before it enters the render loop." This is that, and it earns its keep twice
// — because the exposure that lifts the model's output into the renderer's
// linear range cannot be guessed, and this is what measures it.
//
// The reference states the scale its own model works at: *"radiance comes out
// around 0.006 for a daytime zenith. SKY_EXPOSURE lifts that into the
// renderer's linear range."* Same here — the units are "solar irradiance = 1",
// so the raw number is small and the exposure is the whole of the calibration.
// `?atmoI=` overrides it; `solveExposure()` is where the default came from.

const A_EPS = 1e-9;

function rsi(ox, oy, dx, dy, r) {
  // 2D is enough: the geometry is a ray against a sphere, and everything here
  // lies in the plane containing the ray and the centre
  const b = ox * dx + oy * dy;
  const c = ox * ox + oy * oy - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const s = Math.sqrt(disc);
  return [-b - s, -b + s];
}

/**
 * Radiance along one direction, as `[r, g, b]` in the model's own units.
 *
 * Single scattering only — the multiple-scattering term is a LUT the shader
 * reads and this does not need it to calibrate an exposure, which is set by the
 * daytime zenith where multiple scattering is a few percent. Stated rather than
 * hidden, because a twin that quietly computes something else is worse than no
 * twin.
 *
 * @param {object} m       from `mediumFor()`
 * @param {number} elevDeg the view direction's elevation
 * @param {number} sunDeg  the star's elevation
 * @param {number} steps
 */
export function skyRadianceCPU(m, elevDeg = 90, sunDeg = 45, steps = 64) {
  const th = (elevDeg * Math.PI) / 180;
  // in the plane, with +y the zenith: the eye sits at (0, R)
  const dx = Math.cos(th), dy = Math.sin(th);
  const ox = 0, oy = m.R + 2;
  const atm = rsi(ox, oy, dx, dy, m.Ra);
  if (!atm) return [0, 0, 0];
  let t0 = Math.max(atm[0], 0), t1 = atm[1];
  const gnd = rsi(ox, oy, dx, dy, m.R);
  if (gnd) {
    if (gnd[0] > 0) t1 = Math.min(t1, gnd[0]);
    else if (gnd[1] > 0) t1 = Math.min(t1, gnd[1]);
  }
  if (t1 <= t0) return [0, 0, 0];

  const sd = (sunDeg * Math.PI) / 180;
  const sx = Math.cos(sd), sy = Math.sin(sd);
  const mu = dx * sx + dy * sy;
  const phR = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const g = MIE_G;
  const phM = (3 / (8 * Math.PI)) * (1 - g * g) * (1 + mu * mu)
    / ((2 + g * g) * Math.pow(Math.max(1 + g * g - 2 * g * mu, 1e-4), 1.5));

  const dt = (t1 - t0) / steps;
  const sumR = [0, 0, 0], sumM = [0, 0, 0];
  let odR = 0, odM = 0;
  for (let i = 0; i < steps; i++) {
    const t = t0 + (i + 0.5) * dt;
    const px = ox + dx * t, py = oy + dy * t;
    const pr = Math.hypot(px, py);
    const h = Math.max(pr - m.R, 0);
    const dR = Math.exp(-h / m.Hr) * dt;
    const dM = Math.exp(-h / m.Hm) * dt;
    odR += dR; odM += dM;
    // transmittance from the sample to the star, integrated rather than
    // looked up — the LUT is the shader's optimisation, not the model
    const mus = (px * sx + py * sy) / Math.max(pr, A_EPS);
    const ts = sunTransmittance(m, h, mus, 24);
    for (let c = 0; c < 3; c++) {
      const tv = Math.exp(-m.betaR[c] * odR - m.betaM * 1.1 * odM);
      sumR[c] += tv * ts[c] * dR;
      sumM[c] += tv * ts[c] * dM;
    }
  }
  return sumR.map((v, c) => v * m.betaR[c] * phR + sumM[c] * m.betaM * phM);
}

/** transmittance from a point at height `h`, cosine `mu`, to the top */
export function sunTransmittance(m, h, mu, steps = 24) {
  const r0 = m.R + Math.max(h, 0);
  const dx = Math.sqrt(Math.max(1 - mu * mu, 0)), dy = mu;
  const gnd = rsi(0, r0, dx, dy, m.R);
  if (gnd && gnd[0] > 0) return [0, 0, 0];
  const atm = rsi(0, r0, dx, dy, m.Ra);
  if (!atm || atm[1] <= 0) return [1, 1, 1];
  const dt = atm[1] / steps;
  let odR = 0, odM = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) * dt;
    const pr = Math.hypot(dx * t, r0 + dy * t);
    const hh = Math.max(pr - m.R, 0);
    odR += Math.exp(-hh / m.Hr) * dt;
    odM += Math.exp(-hh / m.Hm) * dt;
  }
  return m.betaR.map((b) => Math.exp(-b * odR - m.betaM * 1.1 * odM));
}

/**
 * The exposure that puts an Earth daytime zenith where the print expects it.
 *
 * §9.4's tonemap sends linear 1.0 to 0.70 on the display, which is where a
 * bright but unclipped sky belongs. So: integrate Earth's zenith at a high sun,
 * and scale it to 1.0. Everything else — a thin atmosphere, a red dwarf, dusk —
 * then falls out of the model at that one fixed exposure, which is the point of
 * calibrating on a reference world rather than per world.
 */
export function solveExposure(target = 1.0, sunDeg = 60) {
  const m = mediumFor({ Teq: 255, typeId: 1, radiusE: 1 }, 1, 9.81);
  const L = skyRadianceCPU(m, 90, sunDeg, 96);
  const lum = L[0] * 0.2126 + L[1] * 0.7152 + L[2] * 0.0722;
  return target / Math.max(lum, 1e-12);
}
