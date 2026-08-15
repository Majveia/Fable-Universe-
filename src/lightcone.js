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
// the acoustic ripple lifts the density there.
//
// **Nothing consumes it yet.** This said "`cosmic.js` applies it", which was
// not true when it was written and is not true now — `cosmic.js` imports
// `cosmology.js`, `nbody.js` and four others, and none of them is this. The
// physics below is real and tested; the claim that it is *in* the universe was
// not, and an unreachable computation is the one failure mode a project whose
// thesis is "a universe that is computed" cannot absorb. Wiring it is the next
// commit; the correction is this one.
//
// Nothing here imports three or reads a clock, so all of it is under test.

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
export function scaleAt(d) {
  if (!(d > 0)) return 1;
  // Adaptive rather than a fixed `dz = 0.02` march, which had two faults and
  // both were silent. Near in it quantised redshift to multiples of 0.02, so
  // 100 Mpc reported z = 0.04 against a true 0.023. Far out it ran out of
  // iterations at z = 19.2 and returned the same scale factor forever — the
  // last quarter of the observable volume all mapped to one shell, with no
  // signal that it had given up. Neither showed in a test that only asked for
  // monotonicity.
  //
  // Stepping in `ln(1+z)` instead puts the samples where the integrand needs
  // them, and the horizon (D_C(∞) ≈ 14,188 Mpc for these parameters) is now
  // reached rather than approached and abandoned.
  const MAX_LNZ = Math.log(1 + 3000);
  const N = 4096;
  const h = MAX_LNZ / N;
  let dist = 0, prevDist = 0, lnz = 0;
  for (let i = 1; i <= N; i++) {
    const lnzA = (i - 1) * h, lnzB = i * h;
    const f = (u) => {
      const zz = Math.exp(u) - 1;
      const a = 1 / (1 + zz);
      return (HUBBLE_DIST / Math.sqrt(OMEGA_M / (a * a * a) + OMEGA_L)) * (1 + zz);
    };
    prevDist = dist;
    dist += (h / 6) * (f(lnzA) + 4 * f((lnzA + lnzB) / 2) + f(lnzB));
    if (dist >= d) {
      // linear in the panel, which is plenty at this step size
      const t = (d - prevDist) / Math.max(dist - prevDist, 1e-12);
      lnz = lnzA + t * h;
      return 1 / Math.exp(lnz);
    }
    lnz = lnzB;
  }
  return 1 / Math.exp(lnz);
}

/**
 * Lookback time to comoving distance `d`, in Gyr.
 *
 * `(1 − a) · 13.8` is what this used to be, and it is only the lookback time in
 * a universe that never decelerated — it ran 13% short at the Hubble distance.
 * The real thing is `(1/H₀)∫₀^z dz'/((1+z')E(z'))`, which is what this is.
 *
 * It mattered because the check above it asked only that lookback be monotone
 * and under 13.8 Gyr, and a straight line satisfies both. A test strictly
 * weaker than the prose it guards is a test that will let the prose drift.
 */
export function lookbackAt(d) {
  const a = scaleAt(d);
  const z = 1 / a - 1;
  if (!(z > 0)) return 0;
  // The substitution that makes this well-behaved: with `u = ln(1+z)`,
  // `dz = (1+z)du`, so `∫ dz/((1+z)E)` collapses to `∫ du/E` exactly. Uniform
  // panels in `z` under-resolve the small-`z` end where the integrand is
  // largest — at the horizon that gave **18.4 Gyr in a 13.8 Gyr universe**,
  // which is the kind of answer that tells you the method is wrong rather than
  // the number being slightly off.
  const HUBBLE_TIME = 977.79 / H0;          // 1/H₀ in Gyr
  const U = Math.log(1 + z);
  const N = 1024;
  const h = U / N;
  const f = (u) => {
    const aa = Math.exp(-u);
    return 1 / Math.sqrt(OMEGA_M / (aa * aa * aa) + OMEGA_L);
  };
  let sum = f(0) + f(U);
  for (let i = 1; i < N; i++) sum += f(i * h) * (i % 2 ? 4 : 2);
  return HUBBLE_TIME * (h / 3) * sum;
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
    // lookback, in Gyr — integrated, not `(1 − a)·13.8`, which is the same
    // thing only in a universe that never decelerated
    lookbackGyr: lookbackAt(d),
    wind: (1 - D) * turns * Math.PI * 2,
    acoustic: acoustic(d, phase),
    // structure at a smaller `D` is smoother: contrast scales with growth, so
    // the far field is genuinely fainter and genuinely less clumped, which is
    // the whole visual consequence of putting the web on a cone
    contrast: D,
  };
}
