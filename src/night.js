// Night has a palette of its own — CLAUDE.md §9.1, §9.2, §M8.
//
// It did not have one. `surface.js` calls
//
//     lightFor(T, Math.max(elev, 0.5))
//
// so at three in the morning §9.2's light model is handed a sun half a degree
// above the horizon and paints the ground as a sunrise. The scene *looks* dark
// because the directional light fades out, but the ambient it is lit by is
// dawn-coloured, and every night frame in the project has a beach in it.
//
// That is the one hour §M8 says the project stops being a demo, and it is also
// the hour that makes everything else built here matter: an aurora at 0.85 of
// a full moon is the brightest thing in a real night and merely a tint over a
// sunrise.
//
// ---------------------------------------------------------------------------
// 1 · What actually lights a moonless night, in order
//
// Almost nobody guesses this order, and the first entry is the surprise.
//
//     airglow      ~0.0006 lux    chemiluminescence at 87-100 km
//     starlight    ~0.0002        integrated, all stars
//     zodiacal     ~0.0001        sunlight off interplanetary dust
//     moon         up to 0.25     when there is one, and it is up
//
// **Airglow is the brightest natural source in a moonless sky** — brighter than
// every star combined. It is the mesosphere quietly re-emitting the day: oxygen
// atoms that were split by ultraviolet at noon recombining at midnight, and a
// layer of meteoric sodium at 92 km doing the same. It is why a truly dark
// night still has a horizon.
//
// And it is the *same green line* the aurora emits — O I 557.7 nm, from the
// same metastable state, at nearly the same altitude. An aurora is airglow that
// somebody hit. `src/magnetosphere.js` and this file are describing one
// mechanism at two energies, which is why they share a transfer.
//
// ---------------------------------------------------------------------------
// 2 · The spectrum goes through the same pipe the day does
//
// §9.6's ruling is that the sky's colours are *"not the values, the function
// that produced them"*. `starlight.js` already has that function — a spectral
// radiance integrated against the CIE observer — and the day palette is what it
// returns for a Planck curve.
//
// So night is not a hand-picked blue. It is an **emission-line spectrum** put
// through the identical integral. The lines are real and their relative
// intensities are measured, including the ones that dominate the energy and are
// invisible: the OH Meinel bands near 866 nm are by far the largest emitter in
// the night sky and contribute exactly nothing to what you see. Passing them in
// and letting the observer reject them is the honest way to say so.
//
// ---------------------------------------------------------------------------
// 3 · Moonlight is warm, and looks blue for a reason that is not the moon
//
// The Moon is a grey-brown rock with an albedo of 0.12 and a reflectance that
// *rises* toward the red. Moonlight is therefore warmer than sunlight — around
// 4100 K equivalent — and every photograph taken with a daylight white balance
// shows it that way.
//
// It looks blue to the eye because of the **Purkinje shift**: at these levels
// vision moves onto rods, which peak at 507 nm, and the residual colour is
// biased short. So the physically correct thing to do is compute a warm light
// and then desaturate it toward the blue-grey the eye actually reports — which
// is exactly what `src/magnetosphere.js` does to a faint aurora, and for the
// same reason.
//
// Getting this backwards — painting the moon blue at source — is the standard
// shortcut and it cannot be undone downstream: a blue key light makes warm
// window-light look green instead of gold, and on this project the windows are
// the best thing in a settlement.
//
// ---------------------------------------------------------------------------
// 4 · What it does not do
//
// It does not touch the print. §2.8 already rules that inside an atmosphere
// nothing reaches pure black, and this model returns real light for the shadow
// tint rather than a smaller number, so the lift stays where it is.

import {
  airmass, spectrumToXYZ, toGamut, xyzToLinearSRGB, planck,
} from './starlight.js';

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------- 1 ---
// airglow

/**
 * The night sky's own emission, as measured.
 *
 * `rel` is relative photon emission rate, roughly to the published rayleigh
 * figures. The 762 nm and 866 nm entries are in the list on purpose: together
 * they are most of the energy the night sky radiates, and the CIE observer
 * throws nearly all of it away. A model that omitted them because they are
 * invisible would get the same colour by accident rather than on purpose.
 */
export const AIRGLOW_LINES = [
  { nm: 557.7, rel: 1.00, what: 'O I green, the same line an aurora emits' },
  { nm: 589.3, rel: 0.60, what: 'Na D, the meteoric sodium layer at 92 km' },
  { nm: 630.0, rel: 0.22, what: 'O I red, thermospheric' },
  { nm: 686.0, rel: 0.85, what: 'O2 atmospheric band' },
  { nm: 762.0, rel: 1.60, what: 'O2 (0-0) — strong, and past the eye' },
  { nm: 866.0, rel: 2.40, what: 'OH Meinel — the largest emitter, and invisible' },
];

/** a line spectrum as a continuous function, for the CIE integral */
const lineSpectrum = (lines, width = 4) => (nm) => {
  let v = 0;
  for (const l of lines) {
    const d = (nm - l.nm) / width;
    if (d > -4 && d < 4) v += l.rel * Math.exp(-d * d);
  }
  return v;
};

/** typical zenith values, lux — the ladder in the header */
export const AIRGLOW_LUX = 6e-4;
export const STARLIGHT_LUX = 2e-4;
export const ZODIACAL_LUX = 1e-4;
export const FULL_MOON_LUX = 0.25;

/** the colour of airglow, through the same integral the day palette uses */
export function airglowColour() {
  return toGamut(xyzToLinearSRGB(spectrumToXYZ(lineSpectrum(AIRGLOW_LINES))));
}

/**
 * Integrated starlight. Dominated by cool giants rather than by the Sun-like
 * stars people picture, so the effective temperature is around 4000 K and the
 * night sky's stellar component is faintly warm — which the eye never reports,
 * for the reason in §3 of the header.
 */
export function starlightColour() {
  return toGamut(xyzToLinearSRGB(spectrumToXYZ((nm) => planck(nm, 4100))));
}

// ---------------------------------------------------------------------- 2 ---
// the moon

/**
 * Lunar regolith reflectance, normalised at 550 nm.
 *
 * The Moon is not grey. Its reflectance rises roughly linearly through the
 * visible — about 25% higher at 700 nm than at 450 — which is why lunar samples
 * look brown in a laboratory and why moonlight is warmer than sunlight.
 */
const REGOLITH = (nm) => 1 + (nm - 550) * 0.0011;

/**
 * The beam colour of moonlight from a star of temperature `T`, at moon
 * elevation `elevDeg`. Sunlight, reddened by the regolith, then reddened again
 * by whatever air it crosses on the way down.
 */
export function moonlightColour(T = 5778, elevDeg = 45) {
  const m = airmass(elevDeg);
  return toGamut(xyzToLinearSRGB(spectrumToXYZ((nm) => {
    // Rayleigh extinction along the path: tau proportional to lambda^-4
    const tau = 0.0973 * Math.pow(nm / 550, -4) * m;
    return planck(nm, T) * REGOLITH(nm) * Math.exp(-tau);
  })));
}

/**
 * How much light the moon actually delivers, in lux.
 *
 * Two things here are not linear and both matter.
 *
 * **The opposition surge.** A half moon gives roughly a *tenth* of a full
 * moon's light, not a half. The regolith is porous, so near full phase every
 * grain hides its own shadow and the disc brightens sharply — a real
 * photometric effect and the reason moonlit nights feel binary: either it is
 * bright out or it is not. `pow(illuminated, 2.6)` is the standard fit.
 *
 * **Extinction near the horizon.** A moon at 5° has crossed ten air masses and
 * delivers a fraction of what it does overhead, which is why a rising moon is
 * orange and useless for seeing by.
 */
export function moonLux(illuminated = 1, elevDeg = 45, albedoScale = 1) {
  if (elevDeg <= -0.5) return 0;
  const surge = Math.pow(clamp(illuminated, 0, 1), 2.6);
  const ext = Math.exp(-0.14 * (airmass(elevDeg) - 1));
  const cosine = Math.sin(Math.max(elevDeg, 0) * Math.PI / 180);
  return FULL_MOON_LUX * surge * ext * (0.25 + 0.75 * cosine) * albedoScale;
}

// ---------------------------------------------------------------------- 3 ---
// the four lights §9.2 reads

/**
 * The Purkinje desaturation, shared with `src/magnetosphere.js`.
 *
 * Cones need roughly 0.01 lux. Below that the eye is on rods, which do not
 * report colour, so the honest thing is to compute the real spectrum and then
 * take the colour away — rather than to invent a blue and call it night.
 */
export function coneFraction(lux) {
  return smoothstep(0.0025, 0.06, lux);
}

const desat = (rgb, cone, toward) => {
  const g = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  // Rods peak at 507 nm, so what survives at the bottom is biased short. This
  // is the *only* place night gets its blue, and it comes from the observer
  // rather than from the sky.
  const s = [g * toward[0], g * toward[1], g * toward[2]];
  return rgb.map((v, i) => s[i] + (v - s[i]) * cone);
};

/** the scotopic bias — a neutral grey seen by rods reads faintly blue */
const ROD_BIAS = [0.86, 0.97, 1.22];

/**
 * §9.2's four lights, at night.
 *
 * Same shape as `lightFor()` so it drops straight into `_syncPaintLight`, plus
 * `lux` and `cone` so a caller can say *why* the frame looks the way it does.
 *
 * `sun` is the key light and at night that is the moon, or nothing. When there
 * is no moon the key is set to the ambient rather than to black: a surface with
 * no key at all loses its form entirely, and §8 axis 2 asks whether any surface
 * is receiving no light information — which on a moonless night is a real
 * question with the answer "airglow, from every direction at once".
 */
export function nightLight(T = 5778, {
  moonIlluminated = 0, moonElevDeg = -90, moonAlbedo = 1,
} = {}) {
  const mLux = moonLux(moonIlluminated, moonElevDeg, moonAlbedo);
  const skyLux = AIRGLOW_LUX + STARLIGHT_LUX + ZODIACAL_LUX;
  const lux = mLux + skyLux;
  const cone = coneFraction(lux);

  // the ambient is airglow and starlight in proportion, plus whatever the moon
  // is scattering into the sky
  const ag = airglowColour();
  const st = starlightColour();
  const w = AIRGLOW_LUX / (AIRGLOW_LUX + STARLIGHT_LUX + ZODIACAL_LUX);
  const skyRaw = ag.map((v, i) => v * w + st[i] * (1 - w));

  const moonRaw = moonlightColour(T, moonElevDeg);
  const moonShare = mLux / Math.max(lux, 1e-9);
  const skyMixed = skyRaw.map((v, i) => v * (1 - moonShare * 0.7) + moonRaw[i] * moonShare * 0.7);

  const ambSky = desat(skyMixed, cone, ROD_BIAS);
  // Ground bounce at night is the sky again, once — so it is the same hue,
  // darker and a shade warmer for the albedo it came off.
  const ambGnd = desat(skyMixed.map((v, i) => v * [1.06, 1.0, 0.88][i]), cone, ROD_BIAS)
    .map((v) => v * 0.62);
  const sun = mLux > 1e-4 ? desat(moonRaw, cone, ROD_BIAS) : ambSky.slice();
  // The shadow tint is the coolest thing in a night frame, because a shadow at
  // night is lit by the sky and by nothing else. §9.2: shadows change hue, they
  // do not go black.
  const shadowTint = desat(skyMixed, cone * 0.6, ROD_BIAS).map((v) => v * 0.78);

  return { sun, ambSky, ambGnd, shadowTint, lux, cone, moonLux: mLux };
}

/**
 * How much of the night model applies, from the sun's elevation.
 *
 * Zero above the horizon, one below nautical twilight at −12°, smooth between.
 * Those are the real thresholds: civil twilight (−6°) is where the brightest
 * stars appear and nautical (−12°) is where the horizon stops being visible at
 * sea, which is exactly the point at which nothing is left of the day.
 */
export function nightFraction(sunElevDeg) {
  return smoothstep(-0.5, -12, sunElevDeg);
}

// ---------------------------------------------------------------------- 4 ---
// how much light there is

/**
 * The exposure §9.2 is missing, from real lux.
 *
 * `paint()` is a shading model normalised to "fully lit": it decides hue,
 * banding, rim and ambient rotation, and nothing in it knows whether there is
 * a sun. So with the light model on and the sun below the horizon it returned a
 * ground as bright as noon, in a night hue — which reads as snow at midnight
 * and is why this function exists.
 *
 * **This is a stand-in for §M8's exposure adaptation and says so.** A real one
 * tracks the frame's own history with a time constant; this is a static curve
 * from the scene's light level. What makes it defensible rather than a fudge is
 * that it is *logarithmic*, which is the one property dark adaptation certainly
 * has: the eye trades about a thousandfold of scene luminance for about
 * threefold of apparent brightness, and a linear map of eight decades onto a
 * display would put every night frame at zero.
 *
 * The floor is 0.26 and not 0. §2.8: inside an atmosphere nothing reaches pure
 * black, and an exposure that could reach zero would take that ruling out of
 * the print's hands and put it here, where it does not belong.
 */
export function exposureFor(lux) {
  const REF = 8e4;                       // full daylight, lux
  const decades = Math.log10(Math.max(lux, 1e-5) / REF);   // 0 at noon, about -8 at night
  // three display stops across eight decades of scene luminance
  return clamp(1 + decades * 0.092, 0.26, 1);
}

/**
 * Horizontal illuminance from the sky, lux, at a given sun elevation.
 *
 * Above the horizon it is close to `1.28e5 · sin(h)` for a clear sky — the
 * standard clear-sky luminous efficacy — and below it the twilight anchors are
 * the ones every observer's handbook lists: about 3.4 lux at civil (−6°),
 * 0.008 at nautical (−12°), and then whatever the night itself provides.
 *
 * Exists so `exposureFor` has one number to read across the whole day rather
 * than a day branch and a night branch that disagree at the seam.
 */
export function skyLux(sunElevDeg, nightFloor = AIRGLOW_LUX + STARLIGHT_LUX + ZODIACAL_LUX) {
  const h = sunElevDeg;
  if (h > 0) return Math.max(1.28e5 * Math.pow(Math.sin(h * Math.PI / 180), 1.15), 500);
  // twilight: roughly a decade of illuminance per two degrees of depression,
  // which is what the −6° and −12° anchors imply
  const twilight = 500 * Math.pow(10, h / 2.4);
  return Math.max(twilight, nightFloor);
}
