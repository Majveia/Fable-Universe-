// Flow — the body under its own power. `?flow=1`, default-off (§7.4).
//
// M4 gave the world a body that walks, jumps and falls. This is the third verb
// the body never had, and the brief for it was one word: *Neo*. Not the `F`
// noclip that has been in `surface.js` since scale three existed — that is a
// debug camera with a walker's silhouette bolted to it, it has no mass, no
// terrain and no top speed, and it stays exactly as it is. This is a separate
// mode with weight in it.
//
// ---------------------------------------------------------------------------
// Why this file has no `import * as THREE`
//
// The same reason `avatar.js` and `vehicle.js` do not. A flight model is a
// second-order system over a height field, and every claim worth making about
// it — that a turn has a radius, that momentum survives a released throttle,
// that the air thins with altitude and takes the control authority with it, and
// above all that nothing anywhere returns NaN — is decidable in plain numbers.
// So all of it runs in `tools/verify.js` with no browser, no GPU and no
// renderer, and `surface.js` and `camera.js` are only what turn its output into
// a view.
//
// ---------------------------------------------------------------------------
// The control law, which is the whole design
//
// Everything below is one idea repeated: **the flight chases a target velocity,
// and the interesting behaviour comes from the fact that it is only allowed to
// chase it so hard.**
//
//   1. The target is the look direction times a top speed. You fly where you
//      look. There is no separate steering axis to learn, and the mouse that
//      already aims the camera is already the stick.
//
//   2. The error between where you are going and where you want to go is split
//      into an **along-track** part and a **lateral** part, against the current
//      velocity — not against the world axes. Speeding up is the first; turning
//      is the second; and they get different rates and different ceilings,
//      because a throttle and a rudder are not the same instrument.
//
//   3. Each part is clamped to its own maximum acceleration. That single clamp
//      is what makes the mode feel like flight rather than like a cursor: a
//      turn at speed cannot be granted instantly, so it comes out as an arc of
//      radius `v² / turnMax` — 222 m at full boost — which is a *swept* turn,
//      banked, that you have to plan. At walking-pace speeds the same clamp is
//      never reached and the response is immediate.
//
//   4. Deceleration gets a far lower rate than acceleration (`coastRate`,
//      τ ≈ 5 s) unless you actively brake. Letting go of the stick does not
//      stop you. That is the momentum preservation §M4 asks for, spent here.
//
//   5. Gravity is never fully cancelled — the flight carries `support` of the
//      weight and no more — so altitude is something you hold rather than
//      something you have. And `support` is scaled by the **air density at
//      your altitude**, which is the only reason the ceiling is a physical
//      quantity rather than a number somebody chose: on a thin-atmosphere world
//      it is low, on a thick one it is high, and the same scale height that
//      `aerial.js` fogs the frame with is the one that decides it.
//
// The launch is a crouch and a go: the body plants for `crouch` seconds, drops
// `crouchDrop` at the eye, then takes `kick` m/s instantly and `liftAccel` held
// for `liftTime` on top of it. Both are accelerations rather than heights, so —
// exactly as with the jump in `avatar.js` — a small moon throws you very much
// further than a super-earth does, and that relationship is the point.
//
// ---------------------------------------------------------------------------
// What is deliberately *not* here: the sonic boom
//
// The brief offered a vapour cone at high speed as optional. It is not drawn,
// and the reason is §8 axis 8 — "does anything on screen contradict the physics
// the HUD asserts?" A vapour cone is a Prandtl–Glauert singularity and it wants
// Mach ~0.9. Boost cruise on a temperate world is 87 m/s against a 340 m/s
// speed of sound: **Mach 0.26.** Painting a shock cone there would be a lie of
// exactly the kind that axis exists to catch, and the tile is 1400 m wide so
// there is nowhere to fly fast enough to earn one.
//
// So `mach` is computed and exposed honestly — from `√(γRT/M)` on the world's
// own air, so a hot thin world genuinely has a lower one — and the speed cue is
// spent instead on things that cost nothing and claim nothing: the boom arm
// stretches, the camera falls behind, the field of view opens, the body banks.
// `camera.js` owns all four. When the tile grows enough to hold a transonic
// run, the cone is one shader away and `mach` is already there to gate it.
//
// ---------------------------------------------------------------------------
// Determinism (§2.3)
//
// No `Math.random`, no clock, no wall time. Every quantity is a function of the
// previous state, `dt` and the input, so the same trace at the same `dt` is the
// same trajectory on every machine — which `tools/verify.js` asserts by
// checksum, and which §2.4's shareable URLs depend on one level up.

import { molarMass, scaleHeight, surfaceTemp } from './aerial.js';
import { RHO_EARTH, airDensity } from './wind.js';

const R_GAS = 8.314462618;          // J/(mol·K)
const G_EARTH = 9.80665;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
const fin = (x, fallback = 0) => (Number.isFinite(x) ? x : fallback);

/**
 * The air a flight happens in, from the world's own numbers.
 *
 * One function, three answers, every one of them out of a definition that
 * already exists somewhere else in the repo — `aerial.js`'s `T` and `M`, and
 * `wind.js`'s `airDensity`. Nothing here is a second opinion about the air, so
 * the altitude at which the haze closes over, the altitude at which the wind
 * stops being able to push a blade of grass, and the altitude at which the
 * flight stops holding you up are all the same altitude, because they are all
 * the same number (§2.7's rule, applied one quantity over).
 *
 *   `H`    scale height, metres. `ρ(y) = ρ₀·exp(−y/H)`. Earth: 8436 m.
 *   `c`    speed of sound, `√(γRT/M)`. Earth at 288 K: 340 m/s.
 *   `rho0` **surface** density as a fraction of Earth's — the term that makes a
 *          quarter-atmosphere world handle like a quarter-atmosphere world.
 *          Leaving it out (the first version did) measured density against each
 *          world's own surface, so every world was sea-level Earth at sea level
 *          and thin air was unreachable by construction.
 *
 * A vacuum returns a scale height large enough that `exp(−y/H)` is 1 over any
 * altitude a surface can reach — which is the right answer and not a branch: a
 * vacuum is uniformly empty, not thinner higher up. `rho0` is what is zero.
 */
export function airColumn(world, atmo = 1) {
  const thickness = Math.max(atmo, 0);
  const g = G_EARTH * (world?.massE ?? 1) / Math.max((world?.radiusE ?? 1) ** 2, 1e-6);
  const T = surfaceTemp(world?.Teq ?? 255, thickness);
  const M = molarMass(world?.typeId ?? 1);
  const H = thickness > 1e-4 ? scaleHeight(T, M, g) : 1e9;
  return {
    H: Math.max(H, 1),
    c: Math.sqrt((FLIGHT.gamma * R_GAS * T) / Math.max(M, 1e-9)),
    rho0: airDensity({ typeId: world?.typeId ?? 1, Teq: world?.Teq ?? 255 }, thickness) / RHO_EARTH,
    thickness,
  };
}

/**
 * The flight's constants. The four that are not free choices, and why:
 *
 *   `turnMax` 34 m/s² is 3.5 g of lateral acceleration, which is what a human
 *   can take sustained without a suit, and it is also what sets the turn radius
 *   at every speed — 222 m at boost. Raising it makes the mode a cursor.
 *
 *   `support` 0.88 leaves 12% of the weight uncarried, so level flight needs a
 *   nose a few degrees up and letting go means sinking. A mode that cancels
 *   gravity outright has no altitude in it, only a Y coordinate.
 *
 *   `coastRate` 0.20 s⁻¹ against `thrustRate` 1.5 is the asymmetry that *is*
 *   momentum: five seconds to shed speed, two thirds of one to gain it.
 *
 *   `gamma` 1.4 is diatomic air, and it only ever feeds the speed of sound.
 */
export const FLIGHT = {
  // --- the launch ---------------------------------------------------------
  crouch: 0.20,          // s the body plants before it goes
  crouchDrop: 0.34,      // m the eye sinks while it does
  kick: 9.0,             // m/s, instantly, on the frame of the go
  liftAccel: 34.0,       // m/s² of upward thrust held after it
  liftTime: 0.70,        // s
  airKick: 4.0,          // m/s when the mode is started mid-fall instead

  // --- the cruise ---------------------------------------------------------
  cruise: 46.0,          // m/s target at full throttle
  boost: 92.0,           // m/s with sprint held
  idle: 0.34,            // throttle with nothing pressed — it does not stall
  lateral: 0.55,         // how much of the strafe axis enters the target

  // --- how hard it is allowed to chase that target ------------------------
  thrustMax: 42.0,       // m/s² along track
  thrustRate: 1.5,       // s⁻¹ accelerating
  coastRate: 0.20,       // s⁻¹ decelerating with the stick released
  coastMax: 5.0,         // m/s² · and never harder than this. See below.
  brakeRate: 2.4,        // s⁻¹ decelerating with `back` held
  turnMax: 34.0,         // m/s² lateral · the turn radius is v²/this
  turnRate: 2.2,         // s⁻¹

  // --- the world pushing back ---------------------------------------------
  support: 0.88,         // fraction of g the flight carries, in full air
  /**
   * `a_drag = dragK·ρ̂·v²`, and the coefficient is not a taste.
   *
   * A drag acceleration equal to `g` *is* terminal velocity, so `dragK = g/v_t²`
   * for whatever terminal velocity the body has. A streamlined human — head
   * down, arms in, which is the posture of everything this mode does — reaches
   * about 90 m/s. `9.80665 / 90² = 0.00121`. Rounded to 0.0012, and the number
   * it produces is checkable against a real one, which is the only reason to
   * prefer it to a slider.
   */
  dragK: 0.0012,
  authorityFloor: 0.45,  // thrust and turn left when the air runs out

  // --- what it looks like -------------------------------------------------
  bankK: 0.026,          // radians of roll per m/s² of lateral acceleration
  bankMax: 0.80,
  bankEase: 3.4,         // s⁻¹

  // --- the ground, and the tile -------------------------------------------
  skin: 0.35,            // m of clearance before a descent becomes a landing
  landSkid: 0.42,        // horizontal velocity kept through touchdown
  edgeBand: 90.0,        // m of soft edge inside the tile bound
  edgeAccel: 30.0,       // m/s² of turn-back inside it
  ceilBand: 160.0,       // the same, in the vertical

  gamma: 1.4,            // ratio of specific heats — the speed of sound only
};

/**
 * How much of the boom is a flight boom.
 *
 * `camera.js` owns the arm and this is only the schedule it reads: at `f = 0`
 * every one of these is the identity and the rig is exactly §M4's third-person
 * rig, so a flight at a standstill and a walk are photographed the same way.
 *
 * `refSpeed` is `boost`'s **drag-limited equilibrium** — 86.2 m/s measured on a
 * temperate world, not the 92 m/s the target asks for — because a schedule
 * normalised by a speed the body can never reach tops out at 0.94 and the last
 * 6% of every curve is dead. The suite asserts the two agree, so retuning
 * `dragK` or `boost` without re-measuring this fails rather than quietly
 * shortening the boom.
 */
export const FLOW_ARM = {
  refSpeed: 86.4,        // m/s at which the speed schedules are fully engaged
  stretch: 5.4,          // m the boom grows by
  drop: 0.55,            // fraction of the rise given up — the horizon goes low
  lead: 0.30,            // s added to the aim's velocity look-ahead
  lag: 0.45,             // fraction of the follow rate given up — it trails
  trail: 0.55,           // how far the boom swings behind the *velocity*
  fovGain: 13.0,         // degrees of field of view opened at refSpeed
  grow: 0.25,            // m the arm starts at on launch, so it grows, not cuts
};

/**
 * The flight, as plain numbers.
 *
 * `groundAt(x, z)` is the same walkable ground `Walker` stands on — handed the
 * same callback, or the body flies through a surface it later lands on
 * (§2.7's fault, one scale down and one verb over).
 */
export class Flight {
  constructor({
    groundAt, gravity = G_EARTH, cfg = FLIGHT,
    air = { H: 8436, c: 340, thickness: 1 },
    bound = Infinity, ceiling = Infinity, baseY = 0,
  }) {
    this.groundAt = groundAt;
    this.gravity = gravity;
    this.c = cfg;
    this.air = air;
    /** tile half-extent in x and z — the same clamp `surface.js` already has */
    this.bound = bound;
    /** metres above `baseY` the frame stays composed to (art, not physics) */
    this.ceiling = ceiling;
    this.baseY = baseY;

    /** 'off' · 'crouch' · 'fly' */
    this.mode = 'off';
    this.pos = { x: 0, y: 0, z: 0 };   // the feet, as everywhere else
    this.vel = { x: 0, y: 0, z: 0 };

    this.t = 0;             // seconds in the current mode
    this.crouchFrac = 0;    // 0..1 through the plant
    this.bank = 0;          // radians of roll, eased
    this.speed = 0;         // m/s, all three axes
    this.mach = 0;
    this.rho = 1;           // air density fraction at this altitude
    this.launches = 0;
    this.landed = 0;
    this.aloft = 0;         // seconds in the air this flight, for the HUD

    this._lat = 0;          // signed lateral acceleration, for the bank
    this._lift = 0;         // seconds of launch thrust left
  }

  /** true while the flight owns the body; false while the walker still does */
  get flying() { return this.mode === 'fly'; }
  /** true through the plant, when the walker is still integrating the body */
  get crouching() { return this.mode === 'crouch'; }

  /**
   * The key.
   *
   * From the ground it begins the crouch. In the air with the mode off it
   * starts the flight where you are — falling off a cliff and catching yourself
   * is the single most Neo thing the mode can do, and refusing it because the
   * feet are not touching anything would be a rule with no reason behind it.
   * In flight it lets go, and what happens next is `Walker`'s fall, which is
   * already tested.
   */
  press(grounded, pos, vel) {
    if (this.mode === 'fly') { this.release(); return 'release'; }
    if (this.mode === 'crouch') { this.mode = 'off'; this.crouchFrac = 0; return 'cancel'; }
    if (grounded) {
      this.mode = 'crouch';
      this.t = 0;
      this.crouchFrac = 0;
      return 'crouch';
    }
    this.launch(pos, vel, this.c.airKick);
    return 'air';
  }

  /**
   * The plant's clock. Returns true on the one frame the body should leave the
   * ground — the caller keeps stepping the walker until then, so the crouch is
   * a walk with the eye lowered and not a fourth movement model.
   */
  tickCrouch(dt) {
    if (this.mode !== 'crouch' || !(dt > 0)) return false;
    this.t += dt;
    this.crouchFrac = clamp(this.t / Math.max(this.c.crouch, 1e-6), 0, 1);
    return this.t >= this.c.crouch;
  }

  /** take the body: feet position and velocity, plus the vertical go */
  launch(pos, vel, kick = this.c.kick) {
    this.pos.x = fin(pos.x); this.pos.y = fin(pos.y); this.pos.z = fin(pos.z);
    this.vel.x = fin(vel?.x); this.vel.y = fin(vel?.y); this.vel.z = fin(vel?.z);
    this.vel.y += kick;
    this.mode = 'fly';
    this.t = 0;
    this.aloft = 0;
    this.crouchFrac = 0;
    this._lift = this.c.liftTime;
    this.launches++;
  }

  /** hand the body back mid-air — the walker's fall takes it from here */
  release() {
    if (this.mode === 'off') return;
    this.mode = 'off';
    this.crouchFrac = 0;
    this._lift = 0;
  }

  /** air density here, as a fraction of Earth's at sea level */
  density() {
    const alt = Math.max(this.pos.y - this.baseY, 0);
    const rho0 = this.air.rho0 ?? 1;
    return rho0 <= 1e-5 ? 0 : rho0 * Math.exp(-alt / Math.max(this.air.H, 1));
  }

  /**
   * One step.
   *
   * `cmd.move` is the same analog `{x: strafe, y: forward}` the walker and the
   * skiff take, in the camera's frame, so one axis drives all three modes and
   * switching between them cannot change what the stick means.
   */
  step(dt, cmd, yaw, pitch) {
    if (this.mode !== 'fly' || !(dt > 0)) return;
    const c = this.c;
    this.t += dt;
    this.aloft += dt;

    const move = cmd?.move ?? { x: 0, y: 0 };
    let mx = fin(move.x), my = fin(move.y);
    const mag = Math.hypot(mx, my);
    if (mag > 1) { mx /= mag; my /= mag; }

    // --- where the body wants to go ----------------------------------------
    // yaw 0 looks down −Z, the convention every camera in this codebase uses,
    // and pitch tilts it — so the target direction is the look direction and
    // there is nothing else to learn.
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const lx = -Math.sin(yaw) * cp, ly = sp, lz = -Math.cos(yaw) * cp;
    const rx = Math.cos(yaw), rz = -Math.sin(yaw);

    const fwd = clamp(my, -1, 1);
    // The launch does not steer. For as long as the lift thrust is burning the
    // target is straight up at full throttle, whatever the camera is doing —
    // otherwise a look that happens to be level asks the chase law to cancel
    // the climb in the same breath the thrust is creating it, and the go reads
    // as a hop. The camera regains the target the instant the burn ends, with
    // forty-odd m/s of upward momentum already in the body.
    const burning = this._lift > 0;
    const braking = !burning && fwd < -0.05;
    // Throttle, not thrust: `idle` is what the mode does with nothing pressed,
    // because a flight that stalls when you stop steering is a glider.
    const throttle = burning ? 1 : (braking ? 0 : Math.max(fwd, c.idle));
    const top = (cmd?.sprint ? c.boost : c.cruise) * throttle;

    let dx, dy, dz;
    if (burning) {
      dx = 0; dy = 1; dz = 0;
    } else {
      dx = lx + rx * mx * c.lateral;
      dy = ly;
      dz = lz + rz * mx * c.lateral;
      const dl = Math.hypot(dx, dy, dz);
      if (dl > 1e-6) { dx /= dl; dy /= dl; dz /= dl; }
      else { dx = lx; dy = ly; dz = lz; }
    }

    // --- the air at this altitude -------------------------------------------
    this.rho = this.density();
    // Thrust and turn bite the air. `authorityFloor` is what is left when there
    // is none — the mode still works in a vacuum, it just handles like a truck,
    // which is the trade that makes altitude a decision rather than a freebie.
    const auth = c.authorityFloor + (1 - c.authorityFloor) * this.rho;

    // --- split the error along track and across it --------------------------
    const sp0 = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    let ux, uy, uz;
    if (sp0 > 1e-4) { ux = this.vel.x / sp0; uy = this.vel.y / sp0; uz = this.vel.z / sp0; }
    else { ux = dx; uy = dy; uz = dz; }

    const ex = dx * top - this.vel.x;
    const ey = dy * top - this.vel.y;
    const ez = dz * top - this.vel.z;
    const along = ex * ux + ey * uy + ez * uz;
    let px = ex - ux * along, py = ey - uy * along, pz = ez - uz * along;

    // Along track: three different rates *and* two different ceilings, because
    // a throttle, a coast and a brake are three different instruments.
    //
    // `coastMax` is the one that matters and it is what momentum preservation
    // actually costs. Without it, releasing the stick at 86 m/s asks the chase
    // law to reach a 16 m/s idle target, and a rate of even 0.2 s⁻¹ against a
    // 70 m/s error is 14 m/s² — so letting go *braked harder than the brake
    // does at low speed*, and the mode had no glide in it at all. Capped at
    // 5 m/s², a released stick sheds about a third of a boost run in three
    // seconds and the rest of it is drag, which is honest.
    const rate = along > 0 ? c.thrustRate : (braking ? c.brakeRate : c.coastRate);
    const backCap = along > 0 || braking ? c.thrustMax : c.coastMax;
    const aAlong = clamp(along * rate, -backCap * auth, c.thrustMax * auth);

    // across track: this clamp is the turn radius, and the turn radius is the
    // whole feel of the mode
    const pl = Math.hypot(px, py, pz);
    const aLat = pl > 1e-6 ? Math.min(pl * c.turnRate, c.turnMax * auth) : 0;
    if (pl > 1e-6) { px /= pl; py /= pl; pz /= pl; }
    else { px = py = pz = 0; }

    let ax = ux * aAlong + px * aLat;
    let ay = uy * aAlong + py * aLat;
    let az = uz * aAlong + pz * aLat;

    // --- the launch's own thrust, on top ------------------------------------
    if (this._lift > 0) {
      const bite = Math.min(this._lift, dt) / dt;
      ay += c.liftAccel * bite;
      this._lift -= dt;
    }

    // --- weight the flight does not carry -----------------------------------
    // Never all of it. `support` scaled by the air is the only reason the
    // ceiling is a physical quantity rather than a number somebody chose: a
    // thin world holds you badly high up, and an airless one barely at all.
    const support = c.support * auth;
    ay -= this.gravity * (1 - support);

    // --- drag, which is what makes a dive terminate --------------------------
    if (sp0 > 1e-4) {
      const d = c.dragK * this.rho * sp0 * sp0;
      ax -= ux * d; ay -= uy * d; az -= uz * d;
    }

    // --- the tile's own bounds, and they are the tile's, not the world's -----
    // `surface.js` has clamped the body to ±EXT·0.48 since before there was a
    // body; a hard clamp at 87 m/s is a wall. This turns you inside the last
    // 90 m instead, which is the same bound arrived at without the stop.
    if (Number.isFinite(this.bound)) {
      ax += this._edge(this.pos.x, this.bound);
      az += this._edge(this.pos.z, this.bound);
    }
    if (Number.isFinite(this.ceiling)) {
      const over = (this.pos.y - this.baseY) - this.ceiling;
      if (over > -this.c.ceilBand) {
        ay -= c.edgeAccel * clamp((over + this.c.ceilBand) / this.c.ceilBand, 0, 1);
      }
    }

    // --- integrate ------------------------------------------------------------
    // Trapezoidal, for the reason `avatar.js` gives at length: under a constant
    // acceleration `x += ½(v₀+v₁)dt` is exact, and the one constant
    // acceleration in here is the one that decides where a dive bottoms out.
    const vx0 = this.vel.x, vy0 = this.vel.y, vz0 = this.vel.z;
    this.vel.x += ax * dt; this.vel.y += ay * dt; this.vel.z += az * dt;
    this.pos.x += (vx0 + this.vel.x) * 0.5 * dt;
    this.pos.y += (vy0 + this.vel.y) * 0.5 * dt;
    this.pos.z += (vz0 + this.vel.z) * 0.5 * dt;

    // A poisoned height field must not poison the body (§9.3's rule, one
    // module over). One NaN in a position is a body that leaves the universe
    // and never comes back, and every downstream reader inherits it.
    if (!Number.isFinite(this.pos.x) || !Number.isFinite(this.pos.y) || !Number.isFinite(this.pos.z)
      || !Number.isFinite(this.vel.x) || !Number.isFinite(this.vel.y) || !Number.isFinite(this.vel.z)) {
      this.pos.x = fin(this.pos.x); this.pos.y = fin(this.pos.y); this.pos.z = fin(this.pos.z);
      this.vel.x = 0; this.vel.y = 0; this.vel.z = 0;
      this.release();
      return;
    }

    // --- the ground is still solid ------------------------------------------
    const floor = fin(this.groundAt(this.pos.x, this.pos.z), this.pos.y);
    if (this.pos.y <= floor + c.skin && this.vel.y <= 0) {
      this.pos.y = floor;
      this.vel.y = 0;
      this.vel.x *= c.landSkid;
      this.vel.z *= c.landSkid;
      this.landed++;
      this.bank = 0;
      this.release();
      return;
    }

    // --- what it looks like --------------------------------------------------
    this.speed = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    this.mach = this.speed / Math.max(this.air.c, 1e-6);

    // Bank from the *lateral acceleration*, resolved about the up axis — not
    // from a heading error. A long steady turn holds its lean this way, where
    // an error-driven bank stands up again as the error shrinks; `vehicle.js`
    // records the same lesson, learned on the skiff.
    //
    // The 2-D cross product of the horizontal heading with the horizontal part
    // of the lateral acceleration is signed by which way the turn goes, and is
    // zero for a pure climb or dive — so pulling up does not roll you, which is
    // the failure mode of banking off the whole lateral vector.
    const side = uz * (px * aLat) - ux * (pz * aLat);
    this._lat = side;
    const want = clamp(side * c.bankK, -c.bankMax, c.bankMax);
    this.bank += (want - this.bank) * Math.min(dt * c.bankEase, 1);
  }

  /** inward acceleration inside the soft edge of the tile, 0 outside the band */
  _edge(p, bound) {
    const over = Math.abs(p) - (bound - this.c.edgeBand);
    if (over <= 0) return 0;
    return -Math.sign(p) * this.c.edgeAccel * clamp(over / this.c.edgeBand, 0, 1);
  }

  /** everything a test, a camera or a HUD needs, as plain numbers */
  state() {
    return {
      mode: this.mode,
      x: this.pos.x, y: this.pos.y, z: this.pos.z,
      vx: this.vel.x, vy: this.vel.y, vz: this.vel.z,
      speed: this.speed, mach: this.mach, rho: this.rho, bank: this.bank,
      launches: this.launches, landed: this.landed, aloft: this.aloft,
    };
  }
}

/**
 * Replay a fixed command trace at a fixed timestep and return the trajectory.
 *
 * The same shape `avatar.js` exposes, and for the same reason (§7.3): the model
 * is exercised with no renderer, no browser and no clock, so its trajectory is
 * a pure function of (trace, dt, world) and the suite can compare it against
 * closed-form answers — a turn radius, a drag-limited terminal speed — rather
 * than against a snapshot of itself.
 */
export function flyReplay(flight, trace, dt, frames) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    const c = trace(i, i * dt);
    flight.step(dt, c, c.yaw ?? 0, c.pitch ?? 0);
    out.push(flight.state());
    if (flight.mode !== 'fly') break;
  }
  return out;
}
