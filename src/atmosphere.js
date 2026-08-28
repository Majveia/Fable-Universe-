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
