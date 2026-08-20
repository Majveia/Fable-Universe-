// The conjured craft — CLAUDE.md §2.1, §3's "the numbers are never negotiable".
//
// The brief was: let the character magically conjure a spacecraft. §2.1 forbids
// an asset and §4 forbids an inventory, so the craft cannot be a *thing* that is
// fetched. It has to be generated. The question is from what.
//
// The lazy answer is a seed: hash the world, get a hull. It would work, and the
// craft would be arbitrary — a different shape on every world for no reason
// anyone could name, which is the definition of noise.
//
// ---------------------------------------------------------------------------
// The craft is not an object. It is an answer.
//
// There is exactly one thing a spacecraft on a planet is *for*, and it is a
// number: the velocity you must gain to stop falling back. Given that, the
// rocket equation says what the vehicle has to weigh, and what it has to weigh
// says how big it is. So the craft is **Tsiolkovsky solved for this world, and
// then drawn**:
//
//     Δv   = v_orbit + gravity losses + drag losses
//     m₀/m₁ = exp(Δv / vₑ)                            ← the whole of it
//
// Conjuring is not summoning a ship. It is asking the universe how hard this
// particular world is to leave, and being handed the answer at full scale.
//
// The consequence is the feature. On a small moon you get a slender dart you
// could carry. On Earth you get a Saturn V, because that *is* what leaving
// Earth costs. On a thick-aired super-earth you get nothing at all, and the
// reason is the best thing in this file.
//
// ---------------------------------------------------------------------------
// Some worlds you can land on and never leave
//
// A rocket stage cannot be arbitrarily light: tanks, engines and structure have
// mass, and the best flight hardware ever built lands near **6% dry**. That caps
// one stage's mass ratio near 16, so one stage can buy about `vₑ·ln(16)` — and
// stages help but each one costs you the last one's engines.
//
// Past roughly 18 km/s there is no chemical rocket. Not "none has been built" —
// **none is possible**, at any budget, with any propellant that burns. It is a
// real and published result about super-Earths (Hippke, 2018), and it falls out
// of this file rather than being asserted by it.
//
// So `craftFor()` can return `feasible: false`, and when it does the conjuring
// fails and says why. That is the single most interesting thing the mechanic can
// do: a universe of 10²⁸ worlds in which some are **one-way**, and you find out
// by trying, and the arithmetic that traps you is the same arithmetic that flew
// Apollo. Nothing in the interface has to editorialise. The craft simply does
// not come.
//
// ---------------------------------------------------------------------------
// Anchors, all of them measured
//
// Every constant below is a number somebody published, and each is placed where
// the formula that consumes it can be checked:
//
//     Earth v_orbit          7.91 km/s      sqrt(g·R)
//     Earth Δv to orbit      ~9.4 km/s      flown — note the model returns
//                                           9.56, because it targets the
//                                           surface-tangent circular orbit and
//                                           has neither a 200 km insertion nor
//                                           the 0.41 km/s of Earth's rotation
//     gravity losses         ~1.5 km/s      of that 9.4
//     drag losses            ~0.15 km/s     of that 9.4
//     LH2/LOX vacuum Isp     450 s          RL10, RS-25
//     kerolox vacuum Isp     350 s          Merlin Vacuum, F-1 class
//     best stage dry mass    ~6%            Centaur, and nothing beats it
//
// Nothing here imports three or reads a clock.

/**
 * A world's number, or the fallback.
 *
 * `??` is the wrong tool here and the sweep caught it: `NaN` is neither null
 * nor undefined, so `world.massE ?? 1` happily returns `NaN` and every formula
 * downstream returns `NaN` politely, all the way to a vehicle with no height
 * that still claims to be feasible. Generator output has holes and a conjuring
 * that silently produces a ghost is worse than one that refuses.
 */
const num = (v, fallback) => (Number.isFinite(v) ? v : fallback);

const G = 6.674e-11;
const R_EARTH = 6.371e6;          // m
const M_EARTH = 5.972e24;         // kg
const G0 = 9.80665;               // m/s², the Isp conversion constant

/**
 * `?prop=kerolox` — which chemistry the readout assumes. Default hydrolox.
 *
 * Not a feature flag under §7.4 and not a location under §2.4: it selects
 * between two numbers that are both true. It lives in the URL because the
 * answer changes with it, and a screenshot reading "22.4 km/s · no chemical
 * rocket leaves this world" has to be reproducible by whoever you sent it to.
 *
 * The `try` is what lets this file stay importable under node, where there is
 * no `window` and the whole of `tools/verify.js` runs.
 */
export const PROP = (() => {
  try {
    return new URL(window.location.href).searchParams.get('prop') === 'kerolox'
      ? 'kerolox' : 'hydrolox';
  } catch { return 'hydrolox'; }
})();

/** the two propellants worth having, as exhaust velocity in m/s */
export const PROPELLANT = {
  // Isp × g₀. Hydrogen is the best chemistry there is and the reason is its
  // molecular weight, not its energy — light exhaust leaves fast.
  hydrolox: 450 * G0,             // 4413 m/s
  kerolox: 350 * G0,              // 3433 m/s
};

/** the best dry-mass fraction flight hardware has ever achieved */
export const DRY_FRACTION = 0.06;
/** so one stage can buy at most this mass ratio */
export const MAX_STAGE_RATIO = 1 / DRY_FRACTION;

/** surface gravity, m/s² */
export function surfaceGravity(world) {
  const m = num(world?.massE, 1) * M_EARTH;
  const r = Math.max(num(world?.radiusE, 1) * R_EARTH, 1);
  return (G * m) / (r * r);
}

/**
 * Circular orbital velocity just above the surface, m/s.
 *
 * `sqrt(g·R)`, which is the same thing as `sqrt(GM/R)` and is worth writing the
 * second way because it makes the trap visible: it grows with the *square root
 * of the radius as well as the mass*, so a big world is punishing twice over.
 */
export function orbitalVelocity(world) {
  const r = Math.max(num(world?.radiusE, 1) * R_EARTH, 1);
  return Math.sqrt(surfaceGravity(world) * r);
}

/** escape velocity, m/s — √2 times orbital, always and everywhere */
export const escapeVelocity = (world) => Math.SQRT2 * orbitalVelocity(world);

/**
 * The velocity budget to reach orbit, m/s.
 *
 * Three terms, and the two losses are anchored on the only ascent anybody has
 * flown enough times to have good numbers for.
 *
 * **Gravity losses scale with the orbital velocity, not with gravity.** That is
 * counter-intuitive and it is the right answer: the loss is `g` integrated over
 * the burn, the burn lasts `v_orbit / a`, and a vehicle built for a given
 * thrust-to-weight has `a ∝ g` — so the `g` cancels and what is left is
 * proportional to `v_orbit`. Earth spends 1.5 of its 7.91, so 19%.
 *
 * **Drag goes as the square root of the pressure**, anchored at 0.15 km/s for
 * one atmosphere. This was linear, and linear was wrong in a way that mattered:
 * it made Venus cost 13.8 km/s in drag alone — 61% of its budget, more than the
 * whole of Earth's ascent — and that single term was the sole reason Venus came
 * back one-way. It was also probably backwards. A vehicle in dense air flies a
 * lower-dynamic-pressure trajectory *and* grows its ballistic coefficient as
 * `m^(1/3)`, and both make the loss sublinear in P.
 *
 * The square root puts Venus at 10.2 km/s total *when Venus's measured 92 bar
 * is what you hand it* — which is where published surface-ascent studies put
 * it, and is still what happens if a caller states `world.atmo`. This
 * project's generator does not, so Venus-class worlds come through
 * `surfacePressure()` below at around a bar and 8.9 km/s; the difference is 92
 * bar of runaway greenhouse that no formula over mass and radius can know
 * about, and it is documented there rather than hidden here.
 *
 * The headline survives either way: a 3 g super-earth is **still** one-way at
 * 22.4 km/s, and now on the strength of its orbital velocity rather than on the
 * weakest term in the model. A result that rests on the term you are least sure
 * of is not a result.
 */
export function deltaVToOrbit(world) {
  const v = orbitalVelocity(world);
  const gravityLoss = v * 0.19;
  const dragLoss = 150 * Math.sqrt(Math.max(num(world?.atmo, surfacePressure(world)), 0));
  return { v, gravityLoss, dragLoss, total: v + gravityLoss + dragLoss };
}

/** N₂, in kg — the gas that sets whether a rocky world has air worth naming */
const M_N2 = 28 * 1.66053907e-27;
const BOLTZMANN = 1.380649e-23;

/**
 * Surface pressure in bar, when the generator has not stated one.
 *
 * `world.atmo` did not exist on any planet this project generates, so every
 * world was silently taking the `1` fallback and the HUD asserted 150 m/s of
 * drag loss on airless moons. A constant standing in for a physical quantity is
 * the §8-axis-8 failure exactly: the number was not wrong by a little, it was
 * not a measurement of anything.
 *
 * Two terms, both from things the generator already decided:
 *
 * **Retention.** A world keeps a gas if its escape velocity beats the thermal
 * speed by enough. The Jeans parameter `λ = v_esc²/2v_th²` is that comparison —
 * Earth sits at 414 for N₂, Mars at 102, Luna at 8 — and the transition is
 * sharp because escape is exponential in it. A logistic through λ ≈ 120 puts
 * Earth and Venus at essentially 1, Mars at a third, and every moon at zero.
 *
 * **Supply.** Volatiles come out of the interior, so the inventory scales with
 * mass and spreads over the area: a column of `M/R²`, which is surface gravity,
 * and pressure is that column times `g` again. Normalised so Earth returns 1.
 *
 * What it will not do — and this is the honest part, not a caveat bolted on —
 * is predict Venus's 92 bar or Titan's 1.45. Both are *histories*: a runaway
 * greenhouse that boiled an ocean into the sky, and a cold body sitting on a
 * volatile reservoir it never had to hold against heat. No function of mass,
 * radius and temperature can reach either, and one that claimed to would be
 * fitting noise. This gets the ladder right — airless, thin, thick — and the
 * ladder is what the drag term is asking about.
 */
export function surfacePressure(world) {
  const massE = Math.max(num(world?.massE, 1), 1e-6);
  const radiusE = Math.max(num(world?.radiusE, 1), 1e-6);
  const Teq = Math.min(Math.max(num(world?.Teq, 255), 3), 4000);
  const vEsc = escapeVelocity({ massE, radiusE });
  // most-probable thermal speed, sqrt(2kT/m)
  const vTh = Math.sqrt((2 * BOLTZMANN * Teq) / M_N2);
  const lambda = (vEsc * vEsc) / (2 * vTh * vTh);
  const retain = 1 / (1 + Math.exp(-(lambda - 120) / 25));
  const g = massE / (radiusE * radiusE);
  // Earth: λ = 414 → retain ≈ 1, g = 1 → 1 bar, which is the anchor
  return Math.min(g * g * retain, 120);
}

/** Tsiolkovsky, in the direction you actually want it: Δv in, mass ratio out */
export const massRatio = (dv, ve) => Math.exp(dv / Math.max(ve, 1));

/**
 * The payload fraction a single stage delivers.
 *
 * This is the equation the first version of this file was missing, and missing
 * it made every answer wrong in the same direction. Asking only "can a stage
 * reach this Δv" says Earth is one stage and Venus is two — both technically
 * true and both useless, because a rocket that reaches orbit **carrying
 * nothing** has not gone anywhere. What matters is what is left at the top:
 *
 *     λ = (1/R − f) / (1 − f)        R = exp(Δv / vₑ),  f = dry fraction
 *
 * and it goes negative the moment `1/R < f` — the tanks would have to weigh
 * less than nothing. That is the wall, written as arithmetic.
 */
export const stagePayload = (dv, ve, f = DRY_FRACTION) => {
  const R = Math.exp(dv / Math.max(ve, 1));
  return (1 / R - f) / (1 - f);
};

/**
 * The dry fraction an `n`-stage vehicle can actually achieve, per stage.
 *
 * Splitting an ascent into more stages makes each tank smaller, and a smaller
 * tank is a *worse* tank: skin area falls as the square while volume falls as
 * the cube, so structure is a larger share of what you built. `f · n^(1/3)` is
 * that, and it is the term that stops the model concluding that fifty stages
 * would be even better — which is what it concluded without it.
 */
export const stageDry = (n, f = DRY_FRACTION) => f * Math.cbrt(Math.max(n, 1));

/** the minimum payload worth flying — half a percent of lift-off mass */
export const MIN_PAYLOAD = 0.005;

/**
 * How to stage this ascent, and whether any staging works at all.
 *
 * Staging is chosen to **maximise** what arrives, not to minimise the stage
 * count, and the difference is the whole reason real rockets have three stages.
 * Earth's optimum is 3–4 stages against a single stage's, and a hydrolox SSTO
 * from Earth is genuinely possible and simply carries less — which is what the
 * literature says and what nobody wants to fly. The model was not told that. It
 * found it.
 *
 * (This used to quote "9.4% against 5.9%". The model has never returned either:
 * it returns 8.36% at four stages and 5.80% at one. The 9.4 was the Δv in km/s
 * from two paragraphs earlier, reused as a percentage. The structural claim was
 * true and the numbers attached to it were not, which is the worse of the two
 * ways to be wrong in a file whose whole argument is that the numbers are real.)
 *
 * Past five stages nobody has flown one, because each new stage has to lift
 * every stage above it *and* the engines you are about to discard.
 */
export function stagesFor(dv, ve, maxStages = 5) {
  const all = [];
  for (let n = 1; n <= maxStages; n++) {
    const per = dv / n;
    const each = stagePayload(per, ve, stageDry(n));
    all.push({ stages: n, perStage: per, payload: each > 0 ? each ** n : -Infinity });
  }
  const top = all.reduce((a, b) => (b.payload > a.payload ? b : a));
  // Past three stages the curve is *flat* — 3, 4 and 5 land within a couple of
  // percent of each other — so the physics genuinely does not care and the
  // choice belongs to engineering, which has never once picked more than three.
  // Taking the fewest stages within 2% of the optimum is that judgement, stated
  // rather than smuggled in as a cap.
  const best = all.find((c) => c.payload >= top.payload * 0.98) ?? top;
  return { ...best, best: top.payload, feasible: top.payload >= MIN_PAYLOAD };
}

export function craftFor(world, propellant = 'hydrolox') {
  const ve = PROPELLANT[propellant] ?? PROPELLANT.hydrolox;
  const dv = deltaVToOrbit(world);
  const st = stagesFor(dv.total, ve);
  const ratio = massRatio(dv.total, ve);

  if (!st.feasible) {
    return {
      feasible: false, dv, ratio, ve, propellant,
      stages: st.stages, payload: Math.max(st.payload, 0),
      // The sentence the interface shows. It names the number rather than
      // apologising, because the number is the interesting part.
      why: `${(dv.total / 1000).toFixed(1)} km/s to orbit · best staging delivers`
        + ` ${(Math.max(st.payload, 0) * 100).toFixed(2)}% of lift-off mass`
        + ' · no chemical rocket leaves this world',
    };
  }

  // Size follows mass, and mass follows the payload fraction: a fixed capsule
  // at the top needs `m₀ = m_payload / λ` underneath it. Volume goes as mass and
  // length as the cube root of volume, so height is `cbrt(1/λ)` — anchored so
  // Earth returns 110 m, because Earth's answer *was* 110 m and a model that
  // gets the one case anybody has flown wrong is not worth running on 10²⁸.
  const EARTH = stagesFor(deltaVToOrbit({ massE: 1, radiusE: 1, atmo: 1 }).total,
    PROPELLANT.hydrolox);
  // the crew and the engine that would exist even with no propellant at all —
  // without it a world needing almost no Δv still gets a tower, because a cube
  // root of nearly one is nearly one rather than nearly zero
  // ...and what scales is the *propellant*, not the vehicle: `m₀ − m_payload`,
  // which is `m_payload·(1/λ − 1)`. Scaling the whole stack instead leaves a
  // world needing almost no Δv with a fifty-metre tower, because the cube root
  // of nearly one is nearly one rather than nearly nothing.
  const CORE = 9;
  const tankMass = (l) => 1 / Math.max(l, 1e-9) - 1;
  const tank = (110 - CORE) * Math.cbrt(tankMass(st.payload) / tankMass(EARTH.payload));
  const height = CORE + tank;
  return {
    feasible: true, dv, ratio, ve, propellant,
    stages: st.stages, payload: st.payload, perStage: st.perStage,
    height,
    // Slenderness is set by the air, and this had the sign backwards against
    // its own comment. Drag goes as frontal area, so a vehicle that has to
    // climb through atmosphere pays for every metre of width and a vehicle that
    // never meets a headwind pays nothing: **air is the slender one.** The
    // arithmetic said the opposite — 10:1 in vacuum, 6.8:1 in thick air — while
    // the sentence above it argued the case for the reverse. One of the two was
    // wrong and it was not the sentence.
    //
    // The fix is worth having for a reason beyond tidiness. Earth's stack goes
    // from 16.2 m across to **11.0**, against a Saturn V's real 10.1 — so the
    // one vehicle anybody has flown stops being 60% too fat. Nothing physical
    // moves: `diameter` feeds the hull that `conjure.js` builds and never the
    // Δv, which is why this could sit inverted without any number going wrong.
    diameter: height / (6.8 + 3.2 * Math.min(Math.max(num(world?.atmo, 1), 0), 1)),
    dryFraction: DRY_FRACTION,
    why: `${(dv.total / 1000).toFixed(1)} km/s · ${st.stages} stage`
      + `${st.stages > 1 ? 's' : ''} · ${(st.payload * 100).toFixed(1)}% to orbit`,
  };
}
