// Starlight → air colour. CLAUDE.md §9.6, M2 act 2 step 2.
//
// §9.6 rules that the sky is "a painted gradient, not a scattering integral"
// and is right about that — but it also rules that the paint cannot be nine hex
// literals, because AEON has 10²⁸ stars and the reference has one:
//
//   "derive the four sky stops from the star's spectrum through a fixed
//    transfer, rather than hardcoding them. The stops above are that transfer's
//    output for a G-type star at 13.5°. That is the port: not the values, the
//    function that produced them."
//
// So this file is the function, and the reference's values are its fixture. The
// requirement is exact: `airColours(5778, 13.5)` must reproduce §9.1's table to
// inside a display step, or the transfer is wrong.
//
// ---------------------------------------------------------------------------
// How it satisfies both halves
//
// A scattering integral would give physically-correct colours that do not look
// like the reference — which is the half §9.6 already rejected. Reproducing the
// reference exactly gives one star. The transfer does both by moving the
// reference's painted values *by the chromatic difference between two stars*:
//
//   1. Compute, from first principles, the light of the air under star T.
//   2. Compute the same for the fixture, a 5778 K sun at 13.5°.
//   3. Chromatically adapt the reference's painted stop from (2)'s white to
//      (1)'s, in Bradford LMS.
//
// At T = 5778, elevation 13.5°, step 3 is the identity and the painted values
// come out untouched — by construction, not by fitting. Under an M dwarf the
// same painted relationships arrive reddened by exactly as much as the physics
// says they should be. The art direction is preserved and the physics is real,
// which is §3's standing ruling on every tension of this shape.
//
// ---------------------------------------------------------------------------
// What is computed from first principles
//
// Planck's law for the star's spectrum · the CIE 1931 colour-matching functions
// (Wyman, Sloan & Shirley's analytic multi-lobe fit, so no data file — §2.1) ·
// Rayleigh optical depth ∝ λ⁻⁴ · Ångström aerosol depth ∝ λ⁻ᵅ · Kasten–Young
// air mass · single-scattering radiance along a view ray.
//
// Zero bytes shipped, no tables, deterministic, and every constant is a
// measured property of air or a published fit rather than a taste.

// ---------------------------------------------------------------------------
// spectra

const H = 6.62607015e-34;   // Planck, J·s
const C = 2.99792458e8;     // m/s
const KB = 1.380649e-23;    // Boltzmann, J/K

/** spectral radiance of a blackbody at temperature T, per wavelength, in nm */
export function planck(lambdaNm, T) {
  const l = lambdaNm * 1e-9;
  const l5 = l * l * l * l * l;
  return (2 * H * C * C) / (l5 * (Math.exp((H * C) / (l * KB * T)) - 1));
}

// CIE 1931 2° colour-matching functions — Wyman, Sloan & Shirley (2013),
// "Simple Analytic Approximations to the CIE XYZ Color Matching Functions",
// JCGT 2(2). Piecewise-Gaussian lobes; max error well under the difference
// between any two of the stops this file produces.
const lobe = (x, mu, s1, s2) => {
  const t = (x - mu) * (x < mu ? 1 / s1 : 1 / s2);
  return Math.exp(-0.5 * t * t);
};
const xBar = (l) => 1.056 * lobe(l, 599.8, 37.9, 31.0)
  + 0.362 * lobe(l, 442.0, 16.0, 26.7)
  - 0.065 * lobe(l, 501.1, 20.4, 26.2);
const yBar = (l) => 0.821 * lobe(l, 568.8, 46.9, 40.5)
  + 0.286 * lobe(l, 530.9, 16.3, 31.1);
const zBar = (l) => 1.217 * lobe(l, 437.0, 11.8, 36.0)
  + 0.681 * lobe(l, 459.0, 26.0, 13.8);

const LAMBDA_MIN = 380, LAMBDA_MAX = 780, LAMBDA_STEP = 2;

/** integrate a spectral radiance function against the CMFs → CIE XYZ */
export function spectrumToXYZ(f) {
  let X = 0, Y = 0, Z = 0;
  for (let l = LAMBDA_MIN; l <= LAMBDA_MAX; l += LAMBDA_STEP) {
    const v = f(l);
    X += v * xBar(l); Y += v * yBar(l); Z += v * zBar(l);
  }
  return [X * LAMBDA_STEP, Y * LAMBDA_STEP, Z * LAMBDA_STEP];
}

/** CIE XYZ (D65) → linear sRGB */
export function xyzToLinearSRGB([X, Y, Z]) {
  return [
    3.2404542 * X - 1.5371385 * Y - 0.4985314 * Z,
    -0.9692660 * X + 1.8760108 * Y + 0.0415560 * Z,
    0.0556434 * X - 0.2040259 * Y + 1.0572252 * Z,
  ];
}

// ---------------------------------------------------------------------------
// air

/** Kasten–Young (1989) relative air mass; h is elevation above the horizon */
export function airmass(elevDeg) {
  const h = Math.max(elevDeg, -0.9);
  return 1 / (Math.sin((h * Math.PI) / 180)
    + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

/** Rayleigh optical depth at sea level; 0.0973 at 550 nm, falling as λ⁻⁴ */
const tauRayleigh = (l) => 0.0973 * Math.pow(550 / l, 4);

/** Ångström aerosol depth; the exponent is the particle size, small = grey */
const tauAerosol = (l, alpha, beta) => beta * Math.pow(550 / l, alpha);

/**
 * Single-scattered radiance reaching the eye along a view ray, from a star of
 * temperature `T` at elevation `sunElev`, looking at elevation `viewElev`.
 *
 * Two terms, and between them they are the whole colour of a sky: the beam is
 * reddened on the way in by `exp(−τ·X_sun)`, and the fraction of it scattered
 * toward the eye, `1 − exp(−τ·X_view)`, is blue-weighted because τ is. Sunset
 * is warm and the zenith is blue for the same reason, which is why one function
 * gives both.
 */
export function scatteredXYZ(T, sunElev, viewElev, { alpha = 4, beta = 0.0973 } = {}) {
  const Xs = airmass(sunElev), Xv = airmass(viewElev);
  const tau = alpha === 4 ? tauRayleigh : (l) => tauAerosol(l, alpha, beta);
  return spectrumToXYZ((l) => {
    const t = tau(l);
    return planck(l, T) * Math.exp(-t * Xs) * (1 - Math.exp(-t * Xv));
  });
}

/** the direct beam, reddened by the air it crossed — sun disc and glow */
export function beamXYZ(T, sunElev, massScale = 1) {
  const Xs = airmass(sunElev) * massScale;
  return spectrumToXYZ((l) => planck(l, T) * Math.exp(-tauRayleigh(l) * Xs));
}

// ---------------------------------------------------------------------------
// the transfer

// Bradford cone response, for von Kries adaptation in a space where a change of
// illuminant is a diagonal scale. Doing it in linear RGB instead would swing
// the hue of anything far from neutral, which is most of this table.
const BRADFORD = [
  [0.8951, 0.2664, -0.1614],
  [-0.7502, 1.7135, 0.0367],
  [0.0389, -0.0685, 1.0296],
];
const BRADFORD_INV = [
  [0.9869929, -0.1470543, 0.1599627],
  [0.4323053, 0.5183603, 0.0492912],
  [-0.0085287, 0.0400428, 0.9684867],
];
const mul3 = (M, v) => [
  M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
  M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
  M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2],
];

const luma = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

/**
 * Bring a colour into sRGB while keeping its **hue**, which is the one quantity
 * this file exists to compute. Two moves, in order of what they cost:
 *
 *   1. If a channel has gone negative the hue is outside the gamut entirely, so
 *      chroma has to go — blend toward the grey of the same luminance until it
 *      fits. This is rare and small.
 *   2. If a channel exceeds 1 the colour is merely too bright, so divide by the
 *      largest channel. That is exact: scaling all three equally leaves
 *      chromaticity untouched and only dims.
 *
 * Three alternatives were tried and are worse, for reasons worth keeping:
 *
 * - **Per-channel clamp** shifts hue. A 12000 K sky asks for more blue than
 *   sRGB holds, and clamping answers by making it *yellower*, which is the one
 *   thing the transfer must never do.
 * - **Exact luminance preservation, chroma compressed to fit** sounds
 *   principled and strangles the bright stops: at `skyHorizon`'s painted
 *   luminance of about 0.70, the gamut has almost no room for a blue hue, and
 *   an 8000 K star lost **73.5%** of its chroma to hold a brightness nobody
 *   asked to hold.
 * - **Nothing at all** lets the pale stops inflate past 1.0 and clip anyway.
 *
 * So luminance is what gets given up, and only at the top. §9.1's painted
 * brightness is a strong preference, not an invariant; its hue relationships
 * are the thing a different star is supposed to change.
 */
export function toGamut(rgb) {
  let c = rgb;
  if (c.some((v) => v < 0)) {
    const Y = Math.min(Math.max(luma(c), 0), 1);
    let t = 1;
    for (const v of c) {
      const d = v - Y;
      if (d < -1e-12) t = Math.min(t, -Y / d);
    }
    c = c.map((v) => Y + (v - Y) * Math.min(Math.max(t, 0), 1));
  }
  const hi = Math.max(...c, 1);
  return c.map((v) => Math.min(Math.max(v / hi, 0), 1));
}

/** normalise to unit luminance — the model has no absolute scale, only hue */
function unitLuma(xyz) {
  const Y = Math.max(xyz[1], 1e-30);
  return [xyz[0] / Y, 1, xyz[2] / Y];
}

/** sRGB hex → linear */
export function hexToLinear(h) {
  return [1, 3, 5].map((i) => {
    const c = parseInt(h.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
}

/** linear → sRGB hex, for reading the transfer's output back as §9.1 writes it */
export function linearToHex(rgb) {
  return '#' + rgb.map((c) => {
    const v = Math.min(Math.max(c, 0), 1);
    const s = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
    return Math.round(s * 255).toString(16).padStart(2, '0').toUpperCase();
  }).join('');
}

/**
 * The fixture. §9.1's anchor values for a temperate world, and §9.6's statement
 * that they are "that transfer's output for a G-type star at 13.5°" — which is
 * what makes them a test rather than a preference.
 */
export const FIXTURE = { T: 5778, elev: 13.5 };

/**
 * Each stop, and the physical quantity it is a painting of. The view elevations
 * are the gradient §9.6 describes — a four-stop vertical wash — and the two
 * aerosol rows are §9.1's `haze` and `mist`, which are larger particles and so
 * greyer: a smaller Ångström exponent scatters all wavelengths more equally,
 * which is exactly why haze whitens a distance instead of bluing it.
 */
export const STOPS = {
  skyZenith: { hex: '#4E80B4', view: 90 },
  skyUpper: { hex: '#7BA9CE', view: 55 },
  skyMid: { hex: '#A8CAE0', view: 25 },
  skyHorizon: { hex: '#E4DAC2', view: 2 },
  skyAnti: { hex: '#C8D4D6', view: 20 },
  skyHorizonSun: { hex: '#FBE2AE', beam: 1.0 },
  sunGlow: { hex: '#FFF1CE', beam: 0.6 },
  sunDisc: { hex: '#FFFAEA', beam: 0.25 },
  haze: { hex: '#A9BCC7', view: 5, alpha: 1.3, beta: 0.12 },
  mist: { hex: '#D6DDD4', view: 2, alpha: 0.8, beta: 0.20 },

  // §9.1's `light` group. These are the four colours §9.2's paint() runs on,
  // and they follow the star for the same reason the sky does — a world around
  // an M dwarf cannot have a #FFD79C sun and a #5C6E9E shadow.
  //
  //   sunLight     the direct beam that reaches the ground
  //   ambSky       the sky's own hemispheric fill, from a mid elevation
  //   ambGnd       sunlight bounced off the ground: the beam, warmed by albedo,
  //                so its *star* dependence is the beam's
  //   shadowTint   what a shadowed surface still receives — sky only, which is
  //                exactly why §9.2 says shadows are violet and never grey
  sunLight: { hex: '#FFD79C', beam: 1.0 },
  ambSky: { hex: '#9EC6E6', view: 45 },
  ambGnd: { hex: '#AA9C64', beam: 1.0 },
  shadowTint: { hex: '#5C6E9E', view: 70 },

  // §9.1's `clouds` group, which this file was missing and the cumulus deck
  // needs. The reference paints seven of them and AEON cannot ship the hexes
  // for the same reason it cannot ship the sky's: a cloud is a white object,
  // and a white object is a mirror for whatever star is lighting it. Under an
  // M dwarf a cumulus top is amber and its belly is olive, and any pipeline
  // that renders it #FFF8EC has stopped telling the truth about the star.
  //
  // Each stop is a painting of a specific optical path, which is what decides
  // its `beam` multiplier — how much air the light crossed before it arrived:
  //
  //   cloudRim   forward-scattered through the *thin* edge of the cloud, which
  //              is the shortest path of the seven and therefore the least
  //              reddened — this is why a silver lining is silver
  //   cirrus     ice at 8 km, above most of the aerosol, so shorter still
  //   cloudTop   the sunlit shoulder, a kilometre up: it has skipped the
  //              boundary layer the ground is sitting in
  //   cloudBody  the lit flank, slightly more grazing
  //   cloudTerm  the terminator, where the beam grazes tangentially and so
  //              crosses *more* air than anything on the ground does — the
  //              reason the band just before the shadow is the warmest one
  //
  // The two shadowed stops take no beam at all. A cumulus belly is lit only by
  // the sky dome above it and the ground beneath, so they are `view` stops at
  // the elevations that dome subtends — which is why they come out violet
  // rather than grey, by exactly the argument §9.2 makes about shadows.
  cloudTop: { hex: '#FFF8EC', beam: 0.85 },
  cloudBody: { hex: '#F6E7D2', beam: 0.95 },
  cloudTerm: { hex: '#E8CFB4', beam: 1.15 },
  cloudRim: { hex: '#FFEFBE', beam: 0.35 },
  cirrus: { hex: '#F3E6D6', beam: 0.25 },
  cloudUnder: { hex: '#B7ACC3', view: 40 },
  cloudCore: { hex: '#9791B0', view: 70 },
};

/** the physical chromaticity a stop is a painting of, under a given star */
function physical(stop, T, elev) {
  if (stop.beam !== undefined) return unitLuma(beamXYZ(T, elev, stop.beam));
  return unitLuma(scatteredXYZ(T, elev, stop.view,
    stop.alpha === undefined ? {} : { alpha: stop.alpha, beta: stop.beta }));
}

/**
 * §9.6's port: the air of a world, from its star's temperature and the sun's
 * elevation, as linear-light RGB keyed by the names in §9.1.
 *
 * `T` in kelvin, `elev` in degrees above the horizon. Deterministic and pure —
 * no clock, no entropy, so a seed that picks a star picks a sky (§2.3).
 */
export function airColours(T, elev = FIXTURE.elev) {
  const out = {};
  for (const [name, stop] of Object.entries(STOPS)) {
    const ref = hexToLinear(stop.hex);
    const here = mul3(BRADFORD, physical(stop, T, elev));
    const fix = mul3(BRADFORD, physical(stop, FIXTURE.T, FIXTURE.elev));
    const painted = mul3(BRADFORD, ref);
    // von Kries: scale the painted stop by the cone-response ratio between the
    // two illuminants. Identity when the star is the fixture's.
    const adapted = mul3(BRADFORD_INV, [
      painted[0] * (here[0] / fix[0]),
      painted[1] * (here[1] / fix[1]),
      painted[2] * (here[2] / fix[2]),
    ]);
    // Cone-response ratios are not luminance-preserving, so the adaptation can
    // raise a pale stop's level as well as move its hue. `toGamut` puts that
    // back at the top end without touching hue — see its note for the three
    // ways of doing this that are worse.
    out[name] = toGamut(adapted);
  }
  return out;
}

/**
 * The same table, for the render loop, bucketed in airmass.
 *
 * `airColours` is a spectral integral — fourteen stops, each over 201
 * wavelengths and three colour-matching functions — and it measures **1.73 ms**.
 * `surface.js` calls it once per frame from its update loop, which spends 14% of
 * §5's 12 ms CPU budget re-deriving a value whose input moved by a hundredth of
 * a degree since the last frame. §2.9 makes the frame budget a correctness
 * property and §5 says any change that costs frames must pay for them; act 2
 * needs a second caller, so this is that payment.
 *
 * **Bucketed in airmass, not elevation.** Elevation is the wrong variable:
 * airmass goes as 1/sin(h), so a quarter-degree step near the horizon moves
 * `skyHorizon` by 6.2/255 while a five-degree step at noon moves nothing.
 * Equal *relative* steps in airmass are equal steps in how much air the beam
 * crossed, which is the quantity every stop is a function of.
 *
 * At 1% per bucket the worst step across all fourteen stops over 0.5°–75° is
 * **1.15/255**, measured — below the display's own quantisation and below the
 * ±0.5/255 dither §9.4 step 8 already applies over the top. So the steps need
 * no interpolation to be invisible, and this stays a memo rather than becoming
 * a resampler.
 *
 * `airColours` itself stays exact and unmemoised, because §19's fixture check
 * pins it to §9.1's painted hexes at 5e-8 and a bucket would drift that by
 * three orders of magnitude. The transfer is exact; only the render loop's
 * *sampling* of it is quantised, and by a stated amount.
 *
 * Deterministic (§2.3): the bucket is a pure function of the inputs, so two
 * machines land in the same one.
 */
const AIR_CACHE = new Map();
const BUCKET = Math.log(1.01);

export function airColoursQuantised(T, elev = FIXTURE.elev) {
  const bucket = Math.round(Math.log(airmass(elev)) / BUCKET);
  const key = T + '|' + bucket;
  let hit = AIR_CACHE.get(key);
  if (hit === undefined) {
    // Evaluate at the bucket's own elevation rather than at the caller's, so
    // every elevation inside a bucket gets the *same* answer. Keyed on the
    // caller's instead, the cache would return whichever elevation happened to
    // ask first and the quantisation error would depend on arrival order —
    // which is a determinism leak (§2.3) that no test would catch, because
    // every individual answer is inside tolerance.
    hit = airColours(T, elevForAirmass(Math.exp(bucket * BUCKET)));
    // A day walks ~345 buckets and a session can visit many worlds. Cheap to
    // rebuild, so drop the whole table rather than carry an LRU for it.
    if (AIR_CACHE.size > 512) AIR_CACHE.clear();
    AIR_CACHE.set(key, hit);
  }
  return hit;
}

/** the elevation whose airmass is `X` — bisection, since `airmass` is monotone */
function elevForAirmass(X) {
  let lo = 0.02, hi = 90;
  for (let i = 0; i < 48; i++) {
    const m = (lo + hi) * 0.5;
    if (airmass(m) > X) lo = m; else hi = m;
  }
  return (lo + hi) * 0.5;
}
