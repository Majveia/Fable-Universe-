// The climb-out — what happens after the craft is standing there.
//
// `craft.js` says whether a world can be left and how big the vehicle has to
// be. `conjure.js` turns that into parts you watch assemble. Neither of them
// flies it, and a rocket that stands on the pad forever is a worse promise than
// no rocket: §2.5 says a feature you cannot enter continuously is not finished,
// and this is the file that finishes it.
//
// ---------------------------------------------------------------------------
// What this has to do, and — more usefully — what it does not
//
// It does **not** have to reach orbit. The surface tile is 1400 m across and
// `ascent.js` already owns the moment the ground stops filling the lens:
// `releaseAltitude(1400, 52)` is 1435 m, and above that the scale above takes
// the body with its velocity intact. So the whole job here is the first kilometre
// and a half of a launch — which is a tractable, honest integration rather than
// a trajectory optimiser, and it is the part you actually watch.
//
// That boundary is worth stating because it is the reason this file is 200 lines
// instead of a solver. Everything past release belongs to `planetscale.js`.
//
// ---------------------------------------------------------------------------
// The four terms, and where each number comes from
//
//   **Thrust.** Constant, set by lift-off thrust-to-weight. Real launchers sit
//   between 1.17 (Saturn V) and about 1.5 (Falcon 9); 1.35 is inside that and
//   is the only free parameter in the file that is taste rather than derivation.
//   Everything else follows: mass flow is `F/ve`, so the vehicle burns itself
//   away on a fixed clock `τ = ve / (TWR·g₀)` and the acceleration *rises*
//   through the climb the way a real one does. That rise is most of what makes
//   a launch feel like a launch rather than like a lift.
//
//   **Gravity.** `g(h) = g₀ (R/(R+h))²`, with `g₀` and `R` from the world. Over
//   1435 m on Earth this is a 0.045% correction and it is in here anyway,
//   because the alternative is a constant that would be wrong on a 200 km-radius
//   moon where the same climb is 1.4% of the radius.
//
//   **Drag**, through the ballistic coefficient `β = m / (Cd·A)`. This is the
//   one term that needs an absolute mass, and the trick is that for a body of
//   roughly uniform density `m ∝ A·H`, so `β ∝ H` and **the area cancels**. A
//   taller stack punches through air better and a wider one does not, which is
//   both true and exactly what you would want the shape to mean. The constant
//   is anchored the way `craft.js` anchors its height: 860 kg/m² per metre puts
//   a 110 m Earth stack at 94,600 kg/m², which is the Saturn V's measured value.
//
//   **The turn.** A zero-lift gravity turn: once the vehicle is pitched over by
//   any amount, gravity does the rest, `dθ/dt = g·sin θ / v`. It needs a kick to
//   start — a real launch pitches over deliberately at a few hundred metres —
//   and after that nothing steers. The whole trajectory is therefore two
//   numbers (when to kick, how hard) and three forces, which is why it can be
//   checked in Node rather than flown.
//
// No THREE, no clock, no DOM: `tools/verify.js` runs the entire ascent.

import { PROPELLANT, surfaceGravity } from './craft.js';

const R_EARTH = 6.371e6;          // m
const G_EARTH = 9.80665;          // m/s²
const RHO_SEA = 1.225;            // kg/m³, Earth sea level
const H_EARTH = 8500;             // m, Earth's density scale height

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);

export const LAUNCH = {
  /**
   * The net acceleration a launch vehicle is *designed for*, m/s².
   *
   * Thrust-to-weight is not a law, it is a design choice, and the number a
   * designer actually holds is this one — how hard the stack accelerates once
   * weight is taken out. Saturn V lifted off at 1.67 m/s² net, the LM ascent
   * stage at 1.72, Falcon 9 nearer 4.9. Fixing 1.7 and solving for TWR is the
   * honest direction of the arithmetic, and it has a consequence worth naming:
   * every world's launcher clears the same altitude in about the same time,
   * because that is what designing to the same acceleration means.
   *
   * Fixing *TWR* instead — which is what this file did first — makes a low
   * gravity world's vehicle absurd. At TWR 1.35 a tiny rock's craft nets
   * 0.3 m/s² and takes 96 seconds to clear 1.4 km, and no engineer has ever
   * built that. Airless low-gravity vehicles run high TWR precisely to avoid it.
   */
  netAccel: 1.7,
  /** and the band a real stack stays inside whatever the world asks for */
  twrMin: 1.2,
  twrMax: 3.0,
  /**
   * The pitch-over is commanded on **speed**, with altitude only as a floor so
   * nothing tips over on the pad.
   *
   * This was altitude alone and it was wrong in a way worth keeping written
   * down, because the failure is a property of the gravity turn itself rather
   * than of the number. `θ' = g·sin θ / v` diverges as `v → 0`: kick a vehicle
   * over at 26 m/s and the turn runs away to horizontal in half a minute, all
   * the thrust goes sideways, and the stack never leaves the first kilometre.
   * Earth and Venus both did exactly that. A real launcher pitches over once it
   * is moving — the manoeuvre needs airspeed for the same reason the equation
   * needs it — and gating on speed makes the turn stable on every world instead
   * of on the ones that happen to accelerate fast enough.
   */
  kickSpeed: 55,
  /** metres above the pad below which the pitch-over is held whatever the speed */
  kickAlt: 120,
  /** degrees off vertical the kick puts in. After this, only gravity steers. */
  kickDeg: 1.8,
  /**
   * How far off vertical the turn is allowed to run before the guidance is
   * someone else's problem. Past the first couple of kilometres a real ascent
   * is closed-loop, not ballistic, and this scale hands over at 1435 m — so
   * rather than model a guidance computer, the turn is capped at the angle a
   * launcher is actually at when it leaves this frame.
   */
  pitchMaxDeg: 35,
  /** kg/m² of ballistic coefficient per metre of vehicle height (see header) */
  betaPerM: 860,
  /**
   * The fraction of lift-off mass that is structure. Burning past it would be
   * burning the tanks, so the engine cuts — the same `DRY_FRACTION` craft.js
   * uses to decide feasibility, restated as an engine-time ceiling.
   */
  minMass: 0.06,
  /** m/s of vertical climb below which the trigger does not consider it a climb */
  liftoff: 0.35,
};

/**
 * Everything about this world and this vehicle that does not change during the
 * climb. Computed once, so the per-frame step is arithmetic with no lookups.
 *
 * `craft` is a `craftFor()` result; `world` is the same `{ massE, radiusE, atmo }`
 * it was solved for.
 */
export function launchFor(craft = {}, world = {}) {
  const g0 = surfaceGravity(world);
  const ve = num(craft.ve, PROPELLANT.hydrolox);
  const atmo = clamp(num(world.atmo, 1), 0, 100);
  const H = num(craft.height, 40);
  // solve TWR from the acceleration the vehicle was designed for, not the
  // other way round — see LAUNCH.netAccel
  const twr = clamp(1 + LAUNCH.netAccel / Math.max(g0, 1e-3),
    LAUNCH.twrMin, LAUNCH.twrMax);
  return {
    g0,
    ve,
    twr,
    R: Math.max(num(world.radiusE, 1), 1e-3) * R_EARTH,
    // the whole vehicle, burned: `m₀/ṁ` with `ṁ = F/ve` and `F = TWR·m₀·g₀`
    tau: ve / (twr * g0),
    beta: LAUNCH.betaPerM * H,
    rho0: RHO_SEA * atmo,
    // A denser, colder, higher-gravity atmosphere is a *shorter* one: `H = kT/mg`.
    // Holding Earth's 8500 m on every world would give a 2.4 g super-earth an
    // atmosphere reaching as high as ours, which is the wrong sign and visible
    // as drag that never lets go.
    hScale: H_EARTH * (G_EARTH / Math.max(g0, 1e-3)),
    height: H,
  };
}

/** the vehicle on the pad, engines not yet lit */
export const launchState = () => ({
  t: 0,          // s since ignition
  h: 0,          // m above the pad
  down: 0,       // m of downrange travel
  vUp: 0,        // m/s
  vHor: 0,       // m/s, in the direction of the pitch-over
  theta: 0,      // rad off vertical
  mass: 1,       // fraction of lift-off mass remaining
  thrust: 0,     // m/s² of thrust this frame, for the HUD and the plume
  burning: true,
  released: false,   // the edge: true on exactly the frame the ground lets go
  gone: false,       // the latch behind it, so the edge cannot fire twice
});

/** total speed, m/s */
export const speedOf = (s) => Math.hypot(s.vUp, s.vHor);

/**
 * One frame of the ascent.
 *
 * Pure and allocating: takes a state, returns the next one, so the whole climb
 * can be run in a loop offline and the caller never has to own the integration.
 * `release` is the altitude at which the scale above takes over — pass
 * `ascent.js`'s `releaseAltitude()` and the flag comes back on the frame it is
 * crossed under power, exactly once.
 *
 * Semi-implicit Euler: velocity is stepped first and position with the *new*
 * velocity. At 1/60 s over a 30 s climb the difference from RK4 is under a
 * metre, and the property that matters — that nothing gains energy it was not
 * given — is one the symplectic form has and explicit Euler does not.
 */
export function stepLaunch(prev, p, dt, release = Infinity) {
  const s = { ...prev, released: false };
  const step = clamp(num(dt, 0), 0, 0.25);
  if (step <= 0) return s;

  s.t += step;

  // --- mass, and the moment there is nothing left to burn --------------------
  if (s.burning) {
    s.mass = 1 - s.t / p.tau;
    if (s.mass <= LAUNCH.minMass) { s.mass = LAUNCH.minMass; s.burning = false; }
  }

  // --- the three accelerations ----------------------------------------------
  // Thrust is constant force over falling mass, so the acceleration climbs.
  s.thrust = s.burning ? (p.twr * p.g0) / Math.max(s.mass, LAUNCH.minMass) : 0;

  const rOverR = p.R / (p.R + Math.max(s.h, 0));
  const g = p.g0 * rOverR * rOverR;

  const v = Math.hypot(s.vUp, s.vHor);
  const rho = p.rho0 * Math.exp(-Math.max(s.h, 0) / p.hScale);
  // ½ρv²/β — the deceleration a body of this ballistic coefficient feels. The
  // area cancelled out of β, which is why nothing here needs an absolute mass.
  const drag = (0.5 * rho * v * v) / Math.max(p.beta, 1);

  // --- the turn --------------------------------------------------------------
  // Vertical until the kick, then a zero-lift gravity turn. `θ' = g sinθ / v`
  // is the classic result and it is why a launch curve is not authored: once
  // there is any angle at all, the only thing bending the trajectory is weight.
  const pitchMax = (LAUNCH.pitchMaxDeg * Math.PI) / 180;
  if (s.theta === 0 && s.h >= LAUNCH.kickAlt && v >= LAUNCH.kickSpeed) {
    s.theta = (LAUNCH.kickDeg * Math.PI) / 180;
  } else if (s.theta > 0 && v > 1) {
    s.theta = Math.min(s.theta + (g * Math.sin(s.theta) / v) * step, pitchMax);
  }

  // --- integrate -------------------------------------------------------------
  // Thrust along the vehicle's axis, drag against the velocity, gravity down.
  const sinT = Math.sin(s.theta), cosT = Math.cos(s.theta);
  const dragUp = v > 1e-6 ? drag * (s.vUp / v) : 0;
  const dragHor = v > 1e-6 ? drag * (s.vHor / v) : 0;

  s.vUp += (s.thrust * cosT - g - dragUp) * step;
  s.vHor += (s.thrust * sinT - dragHor) * step;

  // The pad pushes back. Before the engines out-lift the weight the vehicle
  // does not sink into the concrete, and without this clamp a TWR that dipped
  // below 1 for one frame would put the craft underground for the rest of it.
  if (s.h <= 0 && s.vUp < 0) { s.vUp = 0; s.vHor = 0; }

  s.h = Math.max(s.h + s.vUp * step, 0);
  s.down += s.vHor * step;

  // `released` is an *edge* and `gone` is the latch behind it. Without the
  // latch the edge re-fires every other frame: the frame after it fires,
  // `prev.released` is true and it is suppressed; the frame after that,
  // `prev.released` is false again — because the returned state always clears
  // it — and it fires a second time. A scale handover that runs twice pops two
  // levels of the stack, which is not a bug you find by looking at a graph.
  s.gone = prev.gone || (s.h >= release && s.vUp > LAUNCH.liftoff);
  s.released = s.gone && !prev.gone;
  return s;
}

/**
 * Fly the whole climb offline, for the suite and for anything that wants to
 * know how long a world takes to leave before committing to watching it.
 *
 * Returns the final state plus the two numbers a launch is judged by: how long
 * it took and how fast it was going when the ground let go.
 */
export function flyClimb(craft, world, release, dt = 1 / 60, maxT = 600) {
  const p = launchFor(craft, world);
  let s = launchState();
  let maxQ = 0;
  while (s.t < maxT && !s.released) {
    const v = speedOf(s);
    const rho = p.rho0 * Math.exp(-Math.max(s.h, 0) / p.hScale);
    maxQ = Math.max(maxQ, 0.5 * rho * v * v);
    s = stepLaunch(s, p, dt, release);
    if (!s.burning && s.vUp <= 0 && s.h <= 0) break;   // never got off the pad
  }
  return {
    ...s, params: p, maxQ,
    time: s.t,
    speed: speedOf(s),
    reached: s.released,
    pitchDeg: (s.theta * 180) / Math.PI,
  };
}
