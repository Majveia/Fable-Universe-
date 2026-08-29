// Coming down — CLAUDE.md §2.5, §3's "the numbers are never negotiable".
//
// `climb.js` flies a vehicle off a world. This is the other half, and until it
// existed the ladder was asymmetric in a way §2.5 does not allow: you *left* a
// planet continuously, under power, watching the ground stop filling the lens —
// and you *arrived* at one by pushing a scale. One direction was flown and the
// other was a scene change, which is the cut the invariant forbids.
//
// ---------------------------------------------------------------------------
// Why this is not a camera path
//
// The obvious way to build a descent is to author one: pick a duration, ease a
// camera down a spline, play a sound. The reference game this was ported from
// does exactly that and is right to — it is a game, and a game wants a shot.
//
// §3 rules the other way for AEON: *the numbers are never negotiable.* And the
// honest version turns out to be the cheap one, because ballistic entry has a
// closed-form solution and has had since 1953.
//
// ---------------------------------------------------------------------------
// Allen–Eggers
//
// H. Julian Allen and A. J. Eggers, NACA, 1953. For an exponential atmosphere
// `ρ(h) = ρ₀·exp(−h/H)`, a constant flight-path angle `γ` below the horizon and
// no lift, the equation of motion integrates directly. Writing `β = m/(Cd·A)`
// for the ballistic coefficient:
//
//     m·dv/dt = −½·ρ·v²·Cd·A          and        dh/dt = −v·sin|γ|
//     ⇒  dv/v = ρ·dh / (2·β·sin|γ|)
//     ⇒  v(h) = v_e · exp( −ρ(h)·H / (2·β·sin|γ|) )
//
// and the deceleration `a = ½ρv²/β` maximises at
//
//     a_max = v_e²·sin|γ| / (2·e·H)
//     h_max = H·ln( ρ₀·H / (β·sin|γ|) )
//     v(h_max) = v_e·e^(−½) = 0.6065·v_e
//
// **`a_max` does not contain β.** The ballistic coefficient decides the
// *altitude* at which the deceleration pulse happens and never its size — a
// feather and a cannonball entering the same atmosphere at the same speed and
// angle pull the same peak g, the feather just does it higher up. That is a
// real result, it is slightly startling the first time, and it is the reason
// this file is arithmetic rather than an animation.
//
// It also gives `tools/verify.js` something §14 actually asks for: an
// *independent second derivation*. `stepEntry()` integrates numerically frame
// by frame; the suite checks it against the closed form above. Neither is the
// other's snapshot, so agreement between them is evidence rather than a
// tautology.
//
// ---------------------------------------------------------------------------
// One vehicle, two directions
//
// Everything here reads the same `craftFor()` result and the same world that
// `climb.js` does, with the same ballistic-coefficient convention and the same
// scale-height law. That is deliberate and load-bearing: a world that is
// expensive to leave is expensive to enter, the two files describe *one*
// spacecraft, and a number that disagreed between them would be a vehicle that
// changed shape depending on which way it was pointing.
//
// Nothing here imports three and nothing reads a clock, so the whole law is
// under test in `tools/verify.js` rather than being something you have to fly
// to find out about.

import { PROPELLANT, surfaceGravity, orbitalVelocity } from './craft.js';

const R_EARTH = 6.371e6;          // m
const G_EARTH = 9.80665;          // m/s²
const RHO_SEA = 1.225;            // kg/m³, Earth sea level
const H_EARTH = 8500;             // m, Earth's density scale height

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);

export const ENTRY = {
  /**
   * Flight-path angle below the local horizon at the entry interface, degrees.
   *
   * This is the one number a pilot actually chooses, and the band is narrow for
   * a reason that is not a game-design constraint — it is the corridor. Too
   * shallow and the vehicle skips: drag bleeds enough speed to matter but the
   * trajectory leaves the atmosphere again with orbital energy still on it. Too
   * steep and `a_max` goes linear in `sin|γ|`, and the pulse arrives all at once.
   *
   * **3.5° because this model has no lift.** The number usually quoted is
   * Apollo's 6.5°, and putting it here would be quoting the wrong vehicle: a
   * capsule with an offset centre of mass flies at an angle of attack and uses
   * its L/D to hold itself up in the thin air, stretching the pulse out. This
   * file solves the *unlifted* case, where 6.5° pulls 15.6 g on Earth. A Soyuz
   * that loses attitude control and enters ballistically pulls 8–9 g, and that
   * is the honest comparison for what is modelled here — 3.5° returns 8.4 g.
   *
   * The lesson generalises past this constant: a real number borrowed from a
   * vehicle the model does not describe is worse than an invented one, because
   * it carries a citation.
   */
  gammaDeg: 3.5,
  /** the shallow edge of the corridor — below this the vehicle skips out */
  gammaMinDeg: 1.0,
  /** and the steep edge, past which the pulse is not survivable by the airframe */
  gammaMaxDeg: 12.0,
  /**
   * Where the atmosphere is declared to begin, in scale heights above the
   * ground rather than in metres.
   *
   * Earth's Kármán-adjacent entry interface is 122 km, which is 14.4 of its
   * 8500 m scale heights. Fixing the *ratio* rather than the altitude is what
   * makes this work on a world whose atmosphere is a tenth of ours: 122 km on
   * a thin world is empty space, and the entry would start in vacuum and
   * nothing would happen for a very long time.
   */
  interfaceH: 14.4,
  /**
   * Drag coefficient of a blunt entry body. Everything that has ever survived
   * an entry has been blunt, and for a reason Allen and Eggers are also
   * responsible for: a blunt body puts its bow shock *ahead* of itself and
   * dumps the heat into the air instead of into the structure. A slender one
   * is a better glider and a worse survivor.
   */
  cd: 1.4,
  /**
   * Ballistic coefficient of the entry configuration, kg/m², for a
   * reference-sized vehicle — and this is a **design choice, not a
   * consequence**, in exactly the sense `LAUNCH.netAccel` is one.
   *
   * The tempting move is to derive it from the launcher `climb.js` already
   * sized: same world, same `craftFor()`, so reuse its `betaPerM·height`. That
   * was tried and it is wrong by two orders of magnitude. A 110 m stack nose-on
   * is 94,600 kg/m², and an object that dense does not decelerate in air — it
   * is a meteor, and the integrator faithfully flew it into the ground at
   * 5.5 km/s. The launcher's β is a real number about the wrong direction: a
   * vehicle climbs on its nose and enters on its base.
   *
   * What a real entry body does instead is *choose* β low, deliberately, so the
   * deceleration happens high up where the air is thin and the heating is
   * survivable. That is the entire content of the blunt-body insight. The
   * flown numbers cluster tightly — Apollo CM 332, Soyuz descent module ~380,
   * Shuttle orbiter ~500 — because they are all solving the same problem.
   *
   * 380 kg/m² puts peak deceleration at 46 km on Earth, against a real 45–50.
   */
  betaRef: 380,
  /** the vehicle height, in metres, `betaRef` is quoted for */
  betaRefHeight: 110,
  /**
   * The vertical speed the flare is asked to arrive at, m/s. A metre a second
   * is a firm landing in a lift, and it is roughly what a lander is trimmed for.
   */
  touchdownSpeed: 1.0,
  /**
   * Net braking acceleration the flare commands, m/s² above local weight — the
   * same design-acceleration argument `LAUNCH.netAccel` makes for the way up,
   * pointed the other way, so a world's craft flares as hard as it lifts.
   */
  flareAccel: 1.7,
  /** m/s of descent below which the vehicle is considered down */
  settled: 0.35,
  /** m above the capture line at which the descent stops being ballistic */
  flareMargin: 1.35,
  /**
   * Headroom on the altitude a powered descent is started from.
   *
   * The stopping distance `v²/2a` is exact for a straight line at a fixed
   * angle, and a descent is neither: γ steepens as the burn takes speed out
   * (`θ' = g·cos θ / v` runs away precisely as `v` falls), and a steeper path
   * spends less horizontal distance per metre of height, so the path the
   * vehicle actually has is shorter than the path the formula priced. The
   * margin covers that, and it is measured rather than guessed — see the
   * sweep in `tools/verify.js`. Below ~2.4 the thin worlds arrive hot.
   */
  poweredMargin: 3.0,
};

/**
 * The altitude at which the *surface* scale takes over, mirroring
 * `ascent.js`'s `releaseAltitude()`.
 *
 * It is the same geometry read the other way round — the height at which the
 * tile stops filling the lens is also the height at which it starts to — so
 * this deliberately delegates rather than restating the trigonometry. Two
 * copies of one formula is how a hand-off ends up half a tile out.
 *
 * Re-exported rather than aliased so a reader of this file can find it.
 */
export { releaseAltitude as captureAltitude } from './ascent.js';

/**
 * Everything about this world and this vehicle that does not change during the
 * entry. Computed once; the per-frame step is then arithmetic with no lookups.
 *
 * `craft` is a `craftFor()` result, `world` the same `{ massE, radiusE, atmo }`
 * it was solved for, and `gammaDeg` the entry angle if the caller wants one
 * other than the corridor's middle.
 */
export function entryFor(craft = {}, world = {}, gammaDeg = ENTRY.gammaDeg) {
  const g0 = surfaceGravity(world);
  const atmo = clamp(num(world.atmo, 1), 0, 100);
  const H = num(craft.height, 40);
  const gamma = clamp(num(gammaDeg, ENTRY.gammaDeg),
    ENTRY.gammaMinDeg, ENTRY.gammaMaxDeg) * Math.PI / 180;

  // β = m/(Cd·A). Mass goes as L³ and frontal area as L², so a geometrically
  // similar vehicle twice the size has twice the ballistic coefficient — but
  // real entry bodies are not geometrically similar, because the shield is
  // grown to hold β near the design figure. The cube root is the compromise:
  // a vehicle 8× the reference volume enters 2× harder rather than 8×.
  const beta = ENTRY.betaRef * Math.cbrt(Math.max(H, 1) / ENTRY.betaRefHeight);

  // A denser, colder, higher-gravity atmosphere is a *shorter* one: H = kT/mg.
  // Identical to `launchFor()` — see the note there about the sign.
  const hScale = H_EARTH * (G_EARTH / Math.max(g0, 1e-3));
  const rho0 = RHO_SEA * atmo;
  const airless = rho0 <= 1e-6;
  const vOrb = orbitalVelocity(world);

  return {
    g0,
    ve: num(craft.ve, PROPELLANT.hydrolox),
    R: Math.max(num(world.radiusE, 1), 1e-3) * R_EARTH,
    beta,
    rho0,
    hScale,
    gamma,
    sinGamma: Math.sin(gamma),
    height: H,
    /** speed a circular orbit is held at, and so the speed entry begins with */
    vEntry: vOrb,
    /** true when there is no air to enter through — see `stepEntry` */
    airless,
    /**
     * The altitude the descent is declared to begin at, m.
     *
     * With air, this is the entry interface — `interfaceH` scale heights up,
     * which lands on Earth's real 122 km without being told to.
     *
     * **Without air there is no such thing**, and pretending otherwise was a
     * real error: Luna's atmosphere-shaped interface came out at 741 km, and a
     * vehicle released there arrived at the ground still doing a kilometre a
     * second, because nothing had been available to slow it and the engine
     * could not make up an orbit's worth of speed in the time left.
     *
     * That is not how anybody lands on an airless world. Apollo did not fall to
     * the Moon; it burned into a 15 km periapsis and then flew a long, shallow,
     * almost entirely *horizontal* braking burn — 12 minutes, 500 km downrange,
     * from only 15 km up.
     *
     * So the airless start is derived from the one thing that decides it: the
     * altitude from which this vehicle can actually stop. Kill `v_orb` at the
     * engine's net capability, ask how much path that takes, and convert path
     * to height through the entry angle. For a Luna-class world it returns
     * **26 km** — the same order as the 15 km a lander with the same job
     * actually used, from a formula that has never been shown that number.
     *
     * Where there *is* air, the interface stands however thin it is. Mars is
     * the interesting case: 6 mbar of CO₂ leaves a ballistic vehicle doing
     * 695 m/s at the ground, which is precisely why every Mars lander ever
     * flown carried a parachute *and* retro-rockets. That is not fixed by
     * starting higher — a longer fall is a faster one, and raising the start
     * made the arrival speed *worse*. It is fixed by the flare firing in time,
     * which is a trigger problem and is solved in `stepEntry`.
     */
    interface: airless
      ? (vOrb * vOrb * Math.sin(gamma) * ENTRY.poweredMargin)
        / (2 * Math.max(ENTRY.flareAccel, 0.05))
      : hScale * ENTRY.interfaceH,
  };
}

/** Density at an altitude, m → kg/m³. */
export const densityAt = (p, h) => p.rho0 * Math.exp(-Math.max(h, 0) / p.hScale);

/**
 * The Allen–Eggers closed form: speed at an altitude, given the speed at the
 * entry interface.
 *
 * This is the *analytic* answer. `stepEntry()` reaches its own, numerically,
 * and `tools/verify.js` insists the two agree — which is only evidence because
 * neither one is derived from the other.
 */
export function allenEggers(p, h, vEntry = p.vEntry) {
  if (p.airless) return vEntry;
  const x = (densityAt(p, h) * p.hScale) / (2 * p.beta * Math.max(p.sinGamma, 1e-6));
  return vEntry * Math.exp(-x);
}

/**
 * Peak deceleration of a ballistic entry, m/s² — and the altitude and speed it
 * happens at.
 *
 * Note what `a` is not a function of: β does not appear. See the header. The
 * altitude very much is a function of it, which is the whole reason a light
 * vehicle decelerates high and a dense one decelerates low.
 */
export function peakDecel(p, vEntry = p.vEntry) {
  if (p.airless) return { a: 0, h: 0, v: vEntry };
  const a = (vEntry * vEntry * p.sinGamma) / (2 * Math.E * p.hScale);
  // ρ(h)·H / (β·sin γ) = 1  ⇒  h = H·ln( ρ₀·H / (β·sin γ) )
  const ratio = (p.rho0 * p.hScale) / (p.beta * Math.max(p.sinGamma, 1e-6));
  return {
    a,
    h: ratio > 1 ? p.hScale * Math.log(ratio) : 0,
    v: vEntry * Math.exp(-0.5),
    /** false when the atmosphere is too thin to ever produce the pulse */
    reached: ratio > 1,
  };
}

/**
 * Terminal velocity at an altitude, m/s — the speed at which drag balances
 * weight, `√(2βg/ρ)`.
 *
 * This is what the last few kilometres of any entry into real air converge to,
 * and it is why a descent does not need a retro burn until the very end. In
 * vacuum it is infinite, and returns `Infinity` honestly rather than a large
 * number that would read as a physical answer.
 */
export function terminalVelocity(p, h) {
  const rho = densityAt(p, h);
  if (rho <= 1e-9) return Infinity;
  const rOverR = p.R / (p.R + Math.max(h, 0));
  return Math.sqrt((2 * p.beta * p.g0 * rOverR * rOverR) / rho);
}

/**
 * The vehicle at the top of the descent.
 *
 * Velocity is carried as **vertical and horizontal components**, not as a speed
 * and a path angle, and that is not a stylistic choice — it is the change that
 * made a powered landing possible at all.
 *
 * The first version tracked `(v, γ)` and burned purely retrograde, which is
 * correct for a capsule and hopeless for a lander. Taking speed out of a
 * retrograde burn makes `θ' = g·cos θ / v` run away exactly as `v` falls, so
 * the path tips toward vertical, the horizontal distance left to brake in
 * collapses, and the vehicle arrives at the ground still doing hundreds of
 * metres a second. Raising the start altitude made it *worse*, because a
 * longer fall is a faster one — which is the tell that the model rather than
 * the constant was wrong.
 *
 * A real descent does not let that happen. Apollo's braking phase held its
 * altitude nearly constant for eleven of its twelve minutes: the engine is
 * pitched so that part of the thrust carries the vehicle's weight while the
 * rest kills the orbit. Splitting the velocity lets the flare split the thrust
 * the same way, and it makes this file the mirror of `climb.js`, which has
 * carried `vUp` and `vHor` separately since it was written.
 */
export const entryState = (p) => ({
  t: 0,               // s since the top of the descent
  h: p ? p.interface : 0,   // m above the ground
  down: 0,            // m of downrange travel
  vUp: p ? -p.vEntry * Math.sin(p.gamma) : 0,   // m/s, positive up
  vHor: p ? p.vEntry * Math.cos(p.gamma) : 0,   // m/s along the ground track
  decel: 0,           // m/s² of drag this frame — for the HUD and the plasma
  q: 0,               // dynamic pressure, Pa
  phase: 'entry',     // entry | terminal | flare | down
  thrust: 0,          // m/s² the engine is commanding, total
  tUp: 0,             // ...and how much of it is holding the vehicle up
  starved: false,     // true when the flare wants more than the vehicle has
  captured: false,    // the edge: true on exactly the frame the surface takes over
  taken: false,       // the latch behind it, so the edge cannot fire twice
});

/** rate of descent, m/s, positive downward */
export const sinkOf = (s) => -s.vUp;
/** ground-track speed, m/s */
export const groundSpeedOf = (s) => Math.abs(s.vHor);
/** total speed along the flight path, m/s */
export const speedOf = (s) => Math.hypot(s.vUp, s.vHor);
/** the flight-path angle the state implies, rad below the horizon */
export const gammaOf = (s) => Math.atan2(-s.vUp, Math.abs(s.vHor));

/**
 * One frame of the descent.
 *
 * Pure and allocating: takes a state, returns the next one, so the whole entry
 * can be run offline in a loop and the caller never owns the integration —
 * exactly the contract `stepLaunch()` offers for the way up.
 *
 * `capture` is the altitude at which the scale below takes over. Pass
 * `captureAltitude()` for the tile and the lens, and `captured` comes back true
 * on the frame it is crossed, exactly once.
 *
 * `analytic` reconstructs the world Allen–Eggers is derived in — the engine off
 * and the path angle frozen — so `tools/verify.js` can compare like with like.
 * It is not a flight mode and nothing in the app passes it.
 *
 * Semi-implicit Euler, for the same reason `climb.js` gives: at 1/60 s the
 * difference from RK4 is under a metre over the whole descent, and the property
 * that matters — that nothing gains energy it was not given — is one the
 * symplectic form has and explicit Euler does not.
 */
export function stepEntry(prev, p, dt, capture = 0, analytic = false) {
  const s = { ...prev, captured: false };
  const step = clamp(num(dt, 0), 0, 0.25);
  if (step <= 0 || s.phase === 'down') return s;

  s.t += step;

  const rOverR = p.R / (p.R + Math.max(s.h, 0));
  const g = p.g0 * rOverR * rOverR;
  const rho = densityAt(p, s.h);

  const v = Math.hypot(s.vUp, s.vHor);
  // ½ρv²/β — the deceleration this ballistic coefficient feels. The area
  // cancelled out of β, which is why nothing here needs an absolute mass.
  s.q = 0.5 * rho * v * v;
  s.decel = s.q / Math.max(p.beta, 1);

  // drag opposes the velocity vector, so it splits by the same direction cosines
  const dragUp = v > 1e-6 ? s.decel * (s.vUp / v) : 0;
  const dragHor = v > 1e-6 ? s.decel * (s.vHor / v) : 0;

  // --- the flare -------------------------------------------------------------
  // The engine has one budget, `tMax`, and two jobs: carry the weight so the
  // vehicle stops falling faster, and kill the orbit. Vertical is solved first
  // because it is the one that ends the descent early if it is got wrong, and
  // horizontal gets whatever is left — which is the same priority order a real
  // descent guidance uses, and the reason Apollo's braking phase is nearly
  // level for most of its length.
  const sink = Math.max(-s.vUp, 0);
  const remain = Math.max(s.h - capture, 0.1);
  const tMax = g + ENTRY.flareAccel;

  // the vertical deceleration that arrives at `touchdownSpeed`: v² = u² + 2as
  const wantUp = (sink * sink - ENTRY.touchdownSpeed * ENTRY.touchdownSpeed)
    / (2 * remain);

  /* ---------------------------------------------------------------- the cue
     Two things had to be got right here, and the second is the one that took
     three attempts.

     **It compares times, not distances.** Phrased as a distance it cannot be
     right on a thick world and a thin one at once, because the two jobs eat
     different axes: arresting the sink eats the altitude that is left, while
     killing the ground track eats the *clock* — and once the flare is carrying
     the weight, the clock is the binding one.

     **And it asks the engine only for what the air will not do.** Comparing
     against the *current* speed fires the flare at the entry interface on
     Earth, because 7.9 km/s is indeed more than the engine can remove in the
     four minutes before the ground arrives — and it is a wrong question, since
     the atmosphere is about to remove all of it. The descent came out 232
     minutes long and flew powered from 122 km with zero aerodynamic braking,
     which is the tell: nothing was falling.

     So the predicate runs on the speed drag will *leave*. Allen–Eggers gives
     that directly — propagate the current speed through the air still below —
     floored at terminal velocity, because that is the speed drag can never take
     a vehicle below and the closed form, having dropped weight, wrongly decays
     past it. On an airless world the floor is `Infinity` and the flare fires at
     once, which is exactly right: there is nothing else that is going to. */
  const brakeH = Math.max(tMax * 0.7, 0.05);
  const gam = Math.atan2(sink, Math.abs(s.vHor));
  // what the remaining air takes out, by the closed form, along the path left
  const shed = ((densityAt(p, capture) - rho) * p.hScale)
    / (2 * Math.max(p.beta, 1) * Math.max(Math.sin(gam), 1e-3));
  const vRes = Math.max(v * Math.exp(-Math.max(shed, 0)),
    terminalVelocity(p, Math.max(capture, 0)));

  const tGround = remain / Math.max(sink, 1e-3);
  const tStopH = (Number.isFinite(vRes) ? vRes * Math.cos(gam) : Infinity) / brakeH;
  const tStopV = Math.max((Number.isFinite(vRes) ? vRes * Math.sin(gam) : Infinity)
    - ENTRY.touchdownSpeed, 0) / Math.max(tMax - g, 0.05);

  if (!analytic && s.phase !== 'flare' && sink > ENTRY.settled
      && tGround <= Math.max(tStopH, tStopV) * ENTRY.flareMargin) {
    s.phase = 'flare';
  } else if (s.phase === 'entry' && rho > 0 && v < terminalVelocity(p, s.h) * 1.05) {
    s.phase = 'terminal';
  }

  let thrUp = 0, thrHor = 0;
  if (s.phase === 'flare') {
    // Carry the weight, trim the sink, and take out whatever drag is already
    // doing. Clamped to the whole budget: a vehicle that cannot even hover has
    // nothing left over and says so through `starved` rather than pretending.
    thrUp = clamp(g + wantUp + dragUp, 0, tMax);
    // Pythagoras on the remaining capability — thrust is one vector, and the
    // horizontal component is what is left after the vertical one is paid for.
    const spare = Math.sqrt(Math.max(tMax * tMax - thrUp * thrUp, 0));
    thrHor = Math.min(spare, Math.abs(s.vHor) / Math.max(step, 1e-6))
      * (s.vHor >= 0 ? 1 : -1);
    s.starved = thrUp >= tMax - 1e-9 && wantUp + g + dragUp > tMax;
  }
  s.tUp = thrUp;
  s.thrust = Math.hypot(thrUp, thrHor);

  // --- integrate -------------------------------------------------------------
  s.vUp += (thrUp - g - dragUp) * step;
  s.vHor += (-thrHor - dragHor) * step;
  if (analytic) {
    // hold the path angle where it started, which is the assumption the closed
    // form is derived under — re-project the speed onto the original direction
    const sp = Math.hypot(s.vUp, s.vHor);
    s.vUp = -sp * Math.sin(p.gamma);
    s.vHor = sp * Math.cos(p.gamma);
  }

  s.h = Math.max(s.h + s.vUp * step, 0);
  s.down += Math.abs(s.vHor) * step;

  // `captured` is an *edge* and `taken` is the latch behind it — the same
  // structure, and for the same reason, as `stepLaunch`'s `released`/`gone`.
  // Without the latch the edge re-fires every other frame and a scale handover
  // that runs twice pushes two levels of the stack.
  s.taken = prev.taken || s.h <= capture;
  s.captured = s.taken && !prev.taken;
  // Reaching the capture line *is* the end of this module's job — below it the
  // surface scale owns the vehicle.
  if (s.taken) s.phase = 'down';
  return s;
}

/**
 * Fly the whole descent offline — for the suite, and for anything that wants
 * to know what an entry costs before committing to watching one.
 *
 * `maxT` defaults to four hours because that is what the slow worlds actually
 * need: Huygens took 2 h 27 min to reach Titan's surface and this model agrees
 * with it to within a few minutes. An hour's cap silently returned a descent
 * that had not finished.
 *
 * Returns the final state plus the three numbers an entry is judged by: how
 * long it took, the peak deceleration it actually pulled, and the peak dynamic
 * pressure — max-q, the load case the airframe is sized by.
 */
export function flyEntry(craft, world, capture, dt = 1 / 60, maxT = 14400, gammaDeg,
  analytic = false) {
  const p = entryFor(craft, world, gammaDeg);
  let s = entryState(p);
  let maxG = 0, maxQ = 0, hMaxG = 0, vMaxG = 0;
  while (s.t < maxT && s.phase !== 'down') {
    s = stepEntry(s, p, dt, capture, analytic);
    if (s.decel > maxG) { maxG = s.decel; hMaxG = s.h; vMaxG = s.v; }
    if (s.q > maxQ) maxQ = s.q;
    if (s.h <= 0 && sinkOf(s) <= 0) break;
  }
  return {
    ...s, params: p,
    time: s.t,
    maxDecel: maxG,
    maxQ,
    peakAt: hMaxG,
    peakSpeed: vMaxG,
    landed: s.phase === 'down',
    sink: sinkOf(s),
    ground: groundSpeedOf(s),
  };
}

/**
 * How far through the descent the vehicle is, 0 to 1 — for the HUD, and for
 * anything that wants to react before the hand-over rather than at it.
 *
 * Deliberately measured in **scale heights** rather than in metres. Half the
 * altitude is nowhere near half the descent: the top half of an entry is
 * traversed in vacuum in a few seconds and the bottom half is most of the
 * clock, so a linear read on altitude sits at 0.9 for almost the whole thing.
 * Log-density is very nearly linear in *time* through the interesting part,
 * which is what a progress reading is actually being asked for.
 *
 * §3, and §2.8's cross-fade: this is the parameter the atmospheric grade rides.
 */
export function entryFraction(s, p) {
  if (!p || !(p.interface > 0)) return 0;
  if (s.taken) return 1;
  const top = Math.log1p(p.interface / p.hScale);
  const now = Math.log1p(Math.max(s.h, 0) / p.hScale);
  return clamp(1 - now / Math.max(top, 1e-6), 0, 1);
}
