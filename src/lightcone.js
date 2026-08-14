// The web on a light cone — CLAUDE.md §M1, §3's "the numbers are never
// negotiable; the palette always is".
//
// The brief arrived as a #つぶやきProcessing sketch — four lines that draw a
// rotating, breathing field of eight thousand points — with the request that
// the cosmic web *behave and appear like this*. Running the sketch headless and
// reading what it actually computes, rather than what it looks like, gives
// three structural ideas:
//
//     c = d/2 − t/8        the polar angle depends on the RADIAL coordinate,
//                          so the field winds: inner and outer turn out of step
//     sin(d·d − t)         a wave travelling outward in d², breathing the radius
//     41 shells × 200      structure quantised into shells, scattered within
//
// The honest way to take that is not to replace 262,144 gravitating particles
// with a parametric vortex. §3 is explicit that the numbers survive and the
// palette bends. And it turns out nothing has to bend at all, because **all
// three of those ideas are real cosmology that this scale was not yet showing.**
//
// ---------------------------------------------------------------------------
// 1 · Winding by radius is what a light cone *is*
//
// The web is drawn at one instant everywhere, which is the one thing no
// observer has ever seen. Light takes time to arrive, so a shell at comoving
// distance `d` is seen as it was `d/c` ago — **less evolved, less collapsed,
// less wound up**. Look far enough out and you are looking at a smoother
// universe, because it was one.
//
// So the sketch's `angle ∝ radius` is not a stylisation. It is the statement
// that distance is time, and the field genuinely does turn out of step with
// itself: `growth(a(d))` differs shell to shell, and structure at each radius
// sits at its own stage of collapse. The winding falls out.
//
// The one thing the sketch gets to keep as taste is the *rate*. Everything else
// here is `D(a)` from the same Friedmann integration `cosmology.js` already runs.
//
// ---------------------------------------------------------------------------
// 2 · The breathing wave in d² is the baryon acoustic oscillation
//
// Before recombination, photons and baryons were one fluid, and every
// overdensity launched a spherical sound wave into it. At recombination the
// photons left and the wave stopped, frozen at the distance it had travelled:
// the **sound horizon, 147 Mpc**, and it is still there, a faint preferred
// separation printed across every survey ever taken.
//
// That is a real radial ripple in the correlation function, at a real scale,
// and the web has never drawn it. It is the sketch's `sin(d·d − t)` with a
// wavelength somebody measured.
//
// ---------------------------------------------------------------------------
// 3 · Shells are not a rendering trick either
//
// A survey is quantised in redshift because that is how it was taken. Drawing
// the field on shells of constant lookback time is the honest presentation of a
// light cone, and it is also — not coincidentally — the thing that makes the
// sketch's 41 rings read as depth rather than as bands.
//
// ---------------------------------------------------------------------------
// What this file is
//
// The transform, and nothing else: given a comoving distance it returns which
// cosmic time you are seeing, how far collapse had got by then, and how much
// the acoustic ripple lifts the density there. `cosmic.js` applies it. Nothing
// here imports three or reads a clock, so all of it is under test.

/** ΛCDM, the same row `cosmology.js` uses — Planck 2018 */
export const OMEGA_M = 0.315;
export const OMEGA_L = 0.685;
export const H0 = 67.4;                   // km/s/Mpc

/** the Hubble distance, Mpc — c/H₀, and the natural ruler for everything here */
export const HUBBLE_DIST = 299792.458 / H0;   // 4448 Mpc

/**
 * The sound horizon at the drag epoch, in Mpc.
 *
 * The distance a pressure wave in the photon-baryon fluid had travelled by the
 * time the photons let go. Measured, repeatedly, and one of the cleanest
 * numbers in cosmology: **147.1 Mpc**. It is the standard ruler that BAO
 * surveys use to measure the expansion, and it is a real preferred separation
 * printed into the density field everywhere.
 */
export const SOUND_HORIZON = 147.1;

/**
 * Scale factor at comoving distance `d` (Mpc), on the observer's light cone.
 *
 * Comoving distance to redshift z is `∫ c dz / H(z)`, which does not invert in
 * closed form; this integrates it forward instead and reports where it landed,
 * which is the same answer arrived at from the useful end. Twenty steps is
 * plenty — the integrand is smooth and the whole thing is monotone.
 */
export function scaleAt(d, steps = 24) {
  if (!(d > 0)) return 1;
  let z = 0, dist = 0;
  const dz = 0.02;
  for (let i = 0; i < steps * 40 && dist < d; i++) {
    const a = 1 / (1 + z);
    const E = Math.sqrt(OMEGA_M / (a * a * a) + OMEGA_L);
    dist += (HUBBLE_DIST / E) * dz;
    z += dz;
  }
  return 1 / (1 + z);
}

/**
 * The linear growth factor `D(a)`, normalised to 1 today.
 *
 * Carroll, Press & Turner's fit, which is accurate to well under a percent
 * across ΛCDM and is the standard thing to use when you do not want to
 * integrate. This is the number that says how far collapse had got — and
 * because it is smaller at every larger distance, **it is the winding**.
 */
export function growth(a) {
  const A = Math.min(Math.max(a, 1e-4), 1);
  const g = (aa) => {
    const om = OMEGA_M / (aa * aa * aa);
    const E2 = om + OMEGA_L;
    const Om = om / E2, Ol = OMEGA_L / E2;
    return 2.5 * Om / (Math.pow(Om, 4 / 7) - Ol + (1 + Om / 2) * (1 + Ol / 70));
  };
  return (A * g(A)) / g(1);
}

/**
 * How far round a shell at distance `d` has wound, in radians.
 *
 * Named `windingAt` and not `windAt` because this project already has a wind
 * and it is made of air — `wind.js` owns that word. The collision was a hard
 * error rather than a subtle one, which is the good kind, but the name would
 * have been wrong even if the two files had never met.
 *
 * The sketch's `d/2`, with the arbitrary half replaced by the thing that makes
 * the winding real: shells differ in how collapsed they are, and `1 − D(a(d))`
 * is exactly that difference. A shell at zero distance is fully evolved and has
 * wound nothing; a shell at the horizon is nearly primordial and has wound the
 * most. `turns` is the one number left to taste — §3 says the palette bends and
 * this is palette.
 */
export function windingAt(d, turns = 2.4) {
  return (1 - growth(scaleAt(d))) * turns * Math.PI * 2;
}

/**
 * The acoustic ripple at comoving distance `d`, as a density multiplier.
 *
 * A real BAO feature is a **few percent** bump in the correlation function at
 * one separation — not a sine wave across the sky. Drawn as a decaying
 * oscillation at the sound horizon's wavelength, with the amplitude real
 * surveys actually see, so it reads as a texture in the field rather than as
 * corduroy. Anything stronger would be the corduroy, and would be a lie about
 * a measurement that took a decade to make.
 */
export const BAO_AMPLITUDE = 0.035;

export function acoustic(d, phase = 0) {
  // `Number.isFinite` and not `d > 0`, because the failure here is `0 × NaN`:
  // at infinite distance the damping term is exactly zero and the sine is NaN,
  // and zero times NaN is NaN rather than zero. A guard that only rejects
  // non-positive distances lets that straight through, and it arrives as a
  // whole shell of particles at the origin.
  if (!Number.isFinite(d) || d <= 0) return 1;
  const k = (2 * Math.PI) / SOUND_HORIZON;
  // the ripple damps with distance from the source, as Silk damping and
  // nonlinear evolution both smear it — one e-fold per ten sound horizons
  const damp = Math.exp(-d / (SOUND_HORIZON * 10));
  return 1 + BAO_AMPLITUDE * damp * Math.sin(k * d - phase);
}

/**
 * Everything a shell needs, in one call.
 *
 * One entry point because the three numbers are not independent — a consumer
 * that took the wind from one distance and the growth from another would be
 * drawing a universe where light travelled at two speeds.
 */
export function shell(d, { turns = 2.4, phase = 0 } = {}) {
  const a = scaleAt(d);
  const D = growth(a);
  return {
    d,
    a,
    z: 1 / a - 1,
    growth: D,
    // lookback, in Gyr — the honest label for what "distance" means here
    lookbackGyr: (1 - a) * 13.8,
    wind: (1 - D) * turns * Math.PI * 2,
    acoustic: acoustic(d, phase),
    // structure at a smaller `D` is smoother: contrast scales with growth, so
    // the far field is genuinely fainter and genuinely less clumped, which is
    // the whole visual consequence of putting the web on a cone
    contrast: D,
  };
}
