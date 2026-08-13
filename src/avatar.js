// The body — CLAUDE.md §6 M4.
//
// What was here before this file is 44 lines inline in `surface.js`, and its
// entire vertical model was one line:
//
//     body.y += (ground - body.y) * (1 - exp(-12 * dt))
//
// That is not a controller, it is a smoothing filter. There is no gravity in
// it, so there is no jump and no fall; there is no slope limit, so a cliff is
// something you glide up; there is no step-up, because there is nothing to step
// over. §M4 asks for all of those by name, plus coyote time, variable-height
// jump and momentum preservation.
//
// ---------------------------------------------------------------------------
// Why this file has no `import * as THREE`
//
// §7.3 says new maths gets a CPU reference and a numeric test *before* it
// enters the render loop, and §M4's gate — "input→visible response ≤ 2 frames,
// camera never clips terrain across the full route" — is mostly about feel,
// which no test can score. The physics underneath it is not about feel at all,
// and every part of it is decidable: a ballistic arc has a closed form, a
// coyote window is an exact number of frames, a capsule either penetrates the
// height field or it does not.
//
// So the controller is plain numbers over a `heightAt(x, z)` callback. It runs
// in `tools/verify.js` with no browser, no GPU and no renderer, and the suite
// replays a fixed input trace through it and checks the trajectory against
// closed-form answers. `camera.js` is what turns its output into a view.
//
// ---------------------------------------------------------------------------
// Determinism (§2.3)
//
// No `Math.random`, no clock. Every quantity is a function of the previous
// state, `dt`, and the input — so the same trace at the same `dt` produces the
// same trajectory on every machine, which `?dt=` makes testable and which
// §2.4's shareable URLs quietly depend on.

const G_EARTH = 9.80665;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/**
 * Locomotion constants. The four that are not free choices:
 *
 *   `eye` 1.68 m and `fov` 52 are §6 M4's, and are also the reference's own
 *   (`hoshi-no-tani.html:181-185`) — the two documents agree to the digit,
 *   which is the tell that §M4 is transcribing that class.
 *
 *   `walk` 3.45 m/s is a human walking pace, and `sprint` 2.25× puts a run at
 *   7.8 m/s. The old 16 m/s walk and 60 m/s sprint were not speeds, they were
 *   a way of crossing a 1400 m tile before the interest ran out — which is
 *   what the skiff (M5) is for.
 */
export const GAIT = {
  eye: 1.68,
  fov: 52,
  walk: 3.45,
  sprint: 2.25,
  fly: 16.0,
  radius: 0.34,          // capsule radius, metres
  accelGround: 9.5,      // m/s² toward the target velocity
  accelStop: 12.0,       // stopping is quicker than starting
  accelAir: 1.9,         // some authority in the air, not none
  stepUp: 0.45,          // a kerb, a root, a low wall — not a cliff
  slopeLimit: 50,        // degrees; above this you slide instead of walking
  slideAccel: 0.62,      // fraction of the downhill gravity component
  coyote: 0.12,          // seconds of grace after walking off an edge
  jumpBuffer: 0.10,      // seconds a jump pressed just before landing survives
  jumpHeight: 0.55,      // metres at 1 g — a standing jump, not a leap
  jumpCut: 0.45,         // releasing early keeps this much of the rise
  skin: 0.02,            // ground contact tolerance
  /**
   * The gait clock's own law: `cycles/s = cadence0 + cadenceK·v`, and `bobSat`
   * is the speed at which the head bob reaches full amplitude.
   *
   * These were three literals inside `_gait`. They are in the table because a
   * row that changes the walking speed has to be able to change the cadence
   * with it — a body moved 1.7× faster on the old constants takes 6.4 footfalls
   * a second, which is a sprinter's cadence at a jogger's speed. The values
   * here are exactly the literals they replace, so nothing about the default
   * row moves.
   */
  cadence0: 0.58,
  cadenceK: 0.34,
  bobSat: 3.6,
  /**
   * The jump, as a *height* — the launch speed is solved from the world's own
   * `g`, so every world gives the same 0.55 m, reached more slowly on a moon.
   *
   * `pushAccel` null selects exactly that. Set it and the jump becomes the leg
   * model in `launchSpeed()` instead, where the *impulse* is the constant and
   * the height is what the world decides. See `FLOW_GAIT`.
   */
  pushDepth: null,       // m of crouch the legs push through
  pushAccel: null,       // m/s² the legs can produce, against gravity
};

/**
 * `?flow=1`'s row — CLAUDE.md §7.4, default-off. Three changes, no more.
 *
 * **Speed.** 3.45 → 5.87 m/s, exactly 1.70×. A human walks at 3.45 and this is
 * a steady run; the honest name for the row is not "walk" any more. `sprint`
 * stays a *multiplier*, so the sprint moves by the same 1.70× for free —
 * 7.76 → 13.19 m/s — and the two can never drift apart, which they would if
 * the sprint were an absolute speed edited alongside.
 *
 * **Cadence.** Fitted through two points a physiologist would recognise rather
 * than scaled arbitrarily: 1.7 footfalls/s at a 1.5 m/s stroll and 2.8 at a
 * 5.9 m/s run. That is `cadence0 = 0.66`, `cadenceK = 0.125`, and it puts the
 * row's sprint at 4.6 footfalls/s at 13.2 m/s — which is very nearly world
 * record pace, and correctly reads as one. `bobSat` moves by the same 1.70× so
 * the head bob saturates at the same *fraction* of the row's own top speed.
 *
 * **Jump.** The default row holds the height and solves the speed. This row
 * inverts it: the legs do a fixed amount of work, and what that buys you
 * depends entirely on the world you are standing on. See `launchSpeed()`.
 */
export const FLOW_GAIT = {
  ...GAIT,
  walk: 5.87,
  cadence0: 0.66,
  cadenceK: 0.125,
  bobSat: 6.12,
  pushDepth: 0.42,       // the crouch a standing jump actually travels through
  pushAccel: 36.6,       // 3.73 g of leg thrust — a good vertical, not a myth
};

/**
 * The speed the body leaves the ground at.
 *
 * Two models, and the difference between them is the whole of the jump change.
 *
 * **Height-constant** (`pushAccel` null, the default row). `v₀ = √(2gh)`, so
 * every world gives the same 0.55 m. Correct as far as it goes, and completely
 * silent about gravity: a moon and a super-earth produce the same jump, taken
 * at different speeds. There is nothing to feel.
 *
 * **Work-constant** (`?flow=1`). The legs push the body's mass through a crouch
 * of depth `d` at an acceleration `a` they can produce and gravity opposes, so
 *
 *     ½v₀² = d·(a − g)   ⇒   v₀ = √(2d(a − g))   ⇒   apex = d(a − g)/g
 *
 * — and the apex is now *inversely* proportional to `g`, which is the whole
 * point. On Earth `d = 0.42`, `a = 36.6` gives 4.74 m/s and a 1.15 m leap; on
 * Luna's 1.62 m/s² the same legs give 5.42 m/s and **9.07 m**; on a 2.5 g
 * super-earth, 0.24 m. The relationship §M4 asks for is not decoration on top
 * of the number, it *is* the number.
 *
 * And the model has an edge, which is the tell that it is a model rather than a
 * curve: at `g ≥ a` the legs cannot lift the body at all and `v₀` is zero. A
 * world you cannot jump on is a real place, and it falls out rather than being
 * special-cased.
 */
export function launchSpeed(gravity, gait = GAIT) {
  if (gait.pushAccel === null || gait.pushAccel === undefined) {
    return Math.sqrt(2 * gravity * gait.jumpHeight);
  }
  const net = gait.pushAccel - gravity;
  return net <= 0 ? 0 : Math.sqrt(2 * gait.pushDepth * net);
}

/** surface gravity in m/s², from the world's own mass and radius (§6 M4) */
export function gravityOf(world) {
  const m = world?.massE ?? 1;
  const r = world?.radiusE ?? 1;
  return G_EARTH * m / Math.max(r * r, 1e-6);
}

/**
 * The controller.
 *
 * `heightAt(x, z)` is the walkable ground — `src/ground.js` owns that
 * definition and this must be handed the same one the terrain was meshed from,
 * or the body walks on a surface nobody can see (§2.7's fault, one scale down).
 */
export class Walker {
  constructor({ heightAt, gravity = G_EARTH, seaLevel = null, gait = GAIT }) {
    this.heightAt = heightAt;
    this.gravity = gravity;
    this.seaLevel = seaLevel;
    this.g = gait;

    this.pos = { x: 0, y: 0, z: 0 };     // the feet, not the eye
    this.vel = { x: 0, y: 0, z: 0 };
    this.grounded = false;
    this.fly = false;
    /**
     * A deliberate offset on the eye, in metres, that nothing in the controller
     * writes. `?flow=1`'s crouch-and-go lowers the head through the plant with
     * it; with the flag off it is zero for the life of the body and `eyeY()` is
     * the expression it always was.
     */
    this.sink = 0;

    this._coyote = 0;      // time left in the grace window
    this._buffer = 0;      // time left on a buffered jump press
    this._rising = false;  // in the cuttable part of a jump
    this._wasJump = false;

    // the single gait clock — §6 M4. One phase drives head bob, footstep
    // audio and (when M3 lands) the grass the walker parts, so they cannot
    // drift out of sync, because there is only one of them.
    this.stepPhase = 0;
    this.stepFreq = 0;
    this.bobY = 0;
    this.bobX = 0;
    this.roll = 0;
    this.lean = 0;
    this.breath = 0;
    this.steps = 0;        // footfalls since spawn; the audio hook reads this
    this.landed = 0;       // landings since spawn, for the same reason
  }

  /** the ground under a point, respecting a waterline if the world has one */
  groundAt(x, z) {
    const h = this.heightAt(x, z);
    return this.seaLevel === null ? h : Math.max(h, this.seaLevel);
  }

  /**
   * The surface normal, by central difference over the same field the body
   * stands on. `h` is the sample spacing: too small and it reads the noise
   * floor, too large and a step reads as a ramp. 0.5 m is about a boot.
   */
  normalAt(x, z, h = 0.5) {
    const dx = this.groundAt(x + h, z) - this.groundAt(x - h, z);
    const dz = this.groundAt(x, z + h) - this.groundAt(x, z - h);
    const nx = -dx, ny = 2 * h, nz = -dz;
    const l = Math.hypot(nx, ny, nz) || 1;
    return { x: nx / l, y: ny / l, z: nz / l };
  }

  /** the ground's slope in degrees at a point */
  slopeAt(x, z) {
    return Math.acos(clamp(this.normalAt(x, z).y, -1, 1)) * 180 / Math.PI;
  }

  /** put the body somewhere, feet on the ground, with no residual motion */
  place(x, z, y = null) {
    this.pos.x = x; this.pos.z = z;
    this.pos.y = y === null ? this.groundAt(x, z) : y;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.grounded = true;
    this._coyote = this.g.coyote;
  }

  /** where the eye sits: the feet, plus standing height, plus the gait */
  eyeY() {
    return this.pos.y + this.g.eye + this.bobY + this.sink;
  }

  /**
   * One step.
   *
   * `input.move` is an **analog** vector in the camera's frame — `{x: strafe,
   * y: forward}`, magnitude 0..1. It is analog because a thumb on glass has a
   * magnitude and the old touch layer threw it away by synthesizing keystrokes;
   * a keyboard simply reports 0 or ±1 into the same field.
   */
  step(dt, input, yaw) {
    if (dt <= 0) return;
    const g = this.g;
    const move = input.move ?? { x: 0, y: 0 };
    const jump = !!input.jump;

    // --- the direction the body wants to go, in world space ----------------
    let mx = move.x, mz = move.y;
    const mag = Math.hypot(mx, mz);
    // A stick pushed into a corner is not faster than a stick pushed straight;
    // clamping the magnitude rather than normalising it is what keeps analog
    // input analog. Normalising here is the classic way to turn a thumbstick
    // back into four booleans.
    if (mag > 1) { mx /= mag; mz /= mag; }
    const speedScale = Math.min(mag, 1);

    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    // yaw 0 looks down -Z, which is what every camera in this codebase assumes
    const fx = -sy, fz = -cy;
    const rx = cy, rz = -sy;
    let wx = fx * mz + rx * mx;
    let wz = fz * mz + rz * mx;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-6) { wx /= wl; wz /= wl; }

    const base = (this.fly ? g.fly : g.walk) * (input.sprint ? g.sprint : 1);

    // Uphill is slower and downhill a touch faster, from the ground's own
    // gradient rather than from a state machine.
    let slopeMul = 1;
    if (!this.fly && wl > 1e-6) {
      const n = this.normalAt(this.pos.x, this.pos.z);
      slopeMul = clamp(1 + (n.x * wx + n.z * wz) * 1.15, 0.42, 1.30);
    }
    const target = base * speedScale * slopeMul;

    // --- horizontal integration -------------------------------------------
    const tx = wx * target, tz = wz * target;
    const moving = wl > 1e-6;
    const a = this.fly ? g.accelStop
      : this.grounded ? (moving ? g.accelGround : g.accelStop)
        : g.accelAir;
    // Exponential approach rather than a lerp on dt: the rate is then a
    // property of the controller and not of the frame rate, which is what lets
    // the suite replay the same trace at three different dt and get the same
    // trajectory.
    const k = 1 - Math.exp(-a * dt);
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;

    if (this.fly) {
      this.vel.y += ((input.up ?? 0) * base - this.vel.y) * k;
      this._integrateFly(dt);
      this._gait(dt, false);
      return;
    }

    // --- jump: buffered, forgiving, and cuttable ---------------------------
    this._buffer = jump && !this._wasJump ? g.jumpBuffer : Math.max(0, this._buffer - dt);
    this._wasJump = jump;

    if (this._buffer > 0 && (this.grounded || this._coyote > 0)) {
      // One line, two models — see `launchSpeed`. The default row solves v₀
      // from the height it should reach, so a low-gravity moon launches you
      // properly instead of needing a per-world constant; `?flow=1`'s row fixes
      // the *work the legs do* instead, and lets the world decide the height.
      this.vel.y = launchSpeed(this.gravity, g);
      this.grounded = false;
      this._coyote = 0;
      this._buffer = 0;
      this._rising = true;
    }
    // Variable height: releasing the button part-way keeps `jumpCut` of the
    // remaining rise. Gating on `_rising` means a release during the fall
    // cannot make you drop faster, which is what a bare velocity cut does.
    if (this._rising && !jump && this.vel.y > 0) {
      this.vel.y *= g.jumpCut;
      this._rising = false;
    }
    if (this.vel.y <= 0) this._rising = false;

    this._integrateWalk(dt);
    this._gait(dt, moving);
  }

  _integrateFly(dt) {
    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;   // no gravity in flight, so no trapezoid
    this.pos.z += this.vel.z * dt;
    // even flying, the ground is solid
    const floor = this.groundAt(this.pos.x, this.pos.z);
    if (this.pos.y < floor) { this.pos.y = floor; this.vel.y = Math.max(this.vel.y, 0); }
    this.grounded = false;
    this._coyote = 0;
  }

  _integrateWalk(dt) {
    const g = this.g;
    const wasGrounded = this.grounded;

    // --- horizontal, with step-up and a slope limit ------------------------
    const nx = this.pos.x + this.vel.x * dt;
    const nz = this.pos.z + this.vel.z * dt;

    if (this.vel.x !== 0 || this.vel.z !== 0) {
      const here = this.groundAt(this.pos.x, this.pos.z);
      // Probe a capsule radius ahead rather than at the destination point: a
      // body with width cannot put its centre against a wall.
      const len = Math.hypot(nx - this.pos.x, nz - this.pos.z) || 1;
      const px = nx + (nx - this.pos.x) / len * g.radius;
      const pz = nz + (nz - this.pos.z) / len * g.radius;
      const ahead = this.groundAt(px, pz);
      const rise = ahead - here;

      const blocked = this.grounded
        && rise > g.stepUp
        && this.slopeAt(px, pz) > g.slopeLimit;

      if (blocked) {
        // Slide along the wall instead of stopping dead against it: project
        // the velocity onto the contour. Stopping dead is what makes a
        // controller feel like it is fighting you on broken ground.
        const n = this.normalAt(px, pz);
        const hl = Math.hypot(n.x, n.z) || 1;
        const wallX = n.x / hl, wallZ = n.z / hl;
        const into = this.vel.x * wallX + this.vel.z * wallZ;
        if (into < 0) { this.vel.x -= wallX * into; this.vel.z -= wallZ * into; }
        this.pos.x += this.vel.x * dt;
        this.pos.z += this.vel.z * dt;
      } else {
        this.pos.x = nx;
        this.pos.z = nz;
      }
    }

    // --- vertical ----------------------------------------------------------
    //
    // Trapezoidal rather than Euler, and it is worth the extra add. Under
    // constant acceleration `y += ½(v₀ + v₁)·dt` is *exact*, where Euler leaves
    // a residual of ½·g·dt·t — 13.5 mm short of the apex at 120 Hz and 27 mm by
    // the time the body lands. That is not a rounding error, it is a jump that
    // silently does not reach the height it was asked for, and it would have
    // been paid back by tuning `jumpHeight` until the frame looked right, on
    // one machine, at one frame rate.
    const vy0 = this.vel.y;
    this.vel.y -= this.gravity * dt;
    this.pos.y += (vy0 + this.vel.y) * 0.5 * dt;
    const floor = this.groundAt(this.pos.x, this.pos.z);

    // Step-up is resolved here rather than during the horizontal move: walking
    // onto a kerb should not require leaving the ground, so a grounded body
    // whose feet ended up inside a small rise is simply lifted onto it.
    if (this.pos.y < floor - g.skin) {
      const climbing = wasGrounded && floor - this.pos.y <= g.stepUp;
      this.pos.y = floor;
      // A step-up must not cost you your fall: keep downward velocity only
      // when it was a real landing, so walking up stairs does not stutter.
      this.vel.y = 0;
      if (!wasGrounded && !climbing) this.landed++;
      this.grounded = true;
      this._rising = false;
    } else if (this.pos.y <= floor + g.skin && this.vel.y <= 0) {
      this.pos.y = floor;
      this.vel.y = 0;
      if (!wasGrounded) this.landed++;
      this.grounded = true;
      this._rising = false;
    } else {
      this.grounded = false;
    }

    // --- coyote time -------------------------------------------------------
    // The window opens when the ground goes away, not when a jump is pressed,
    // so it is a property of the body rather than of the input.
    this._coyote = this.grounded ? g.coyote : Math.max(0, this._coyote - dt);

    // --- sliding on ground too steep to stand on ---------------------------
    if (this.grounded) {
      const n = this.normalAt(this.pos.x, this.pos.z);
      const slope = Math.acos(clamp(n.y, -1, 1)) * 180 / Math.PI;
      if (slope > g.slopeLimit) {
        const hl = Math.hypot(n.x, n.z) || 1;
        const acc = this.gravity * Math.sin(slope * Math.PI / 180) * g.slideAccel;
        this.vel.x += (n.x / hl) * acc * dt;
        this.vel.z += (n.z / hl) * acc * dt;
      }
    }
  }

  /**
   * The gait clock. One phase, and everything that has to stay in step with a
   * footfall reads it: head bob at twice the step rate, lateral sway at once,
   * roll coupled to the sway, and the footstep event itself.
   *
   * §6 M4 asks for exactly this and gives the reason — "so they can never drift
   * out of sync." They cannot drift because there is nothing to drift from.
   */
  _gait(dt, moving) {
    const g = this.g;
    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.stepFreq = (spd > 0.14 && this.grounded && !this.fly)
      ? g.cadence0 + g.cadenceK * spd : 0;

    const prev = this.stepPhase;
    this.stepPhase += this.stepFreq * dt;
    // two footfalls per cycle — left and right
    if (Math.floor(this.stepPhase * 2) !== Math.floor(prev * 2)) this.steps++;

    const gp = this.stepPhase * Math.PI * 2;
    const amp = this.fly ? 0 : clamp(spd / g.bobSat, 0, 1);
    const kf = clamp(11 * dt, 0, 1);
    this.bobY += (Math.sin(gp * 2) * 0.0135 * amp - this.bobY) * kf;
    this.bobX += (Math.sin(gp) * 0.0095 * amp - this.bobX) * kf;
    this.roll += (Math.sin(gp) * 0.0060 * amp - this.roll) * clamp(9 * dt, 0, 1);
    this.lean += (clamp(spd * 0.016, 0, 0.05) - this.lean) * clamp(4 * dt, 0, 1);
    this.breath += dt * 0.9;
    if (!moving && spd < 0.02) this.stepFreq = 0;
  }

  /**
   * Let the gait go quiet without touching its clock.
   *
   * `?flow=1`'s flight takes the body away from the controller for as long as
   * it lasts, so `_gait` stops running and the bob, the sway and the roll
   * freeze at whatever fraction of a stride they were in — a permanent
   * centimetre of head tilt for the whole flight. This eases those four to
   * zero and **leaves `stepPhase` and `steps` exactly where they are**, which
   * is the part that matters: §6 M4's clock is a *gait* clock, there is no gait
   * in flight, and resetting or re-running it would be the second clock the
   * milestone exists to forbid. It stops, and it resumes where it stopped.
   */
  calm(dt) {
    const k = clamp(9 * dt, 0, 1);
    this.bobY += (0 - this.bobY) * k;
    this.bobX += (0 - this.bobX) * k;
    this.roll += (0 - this.roll) * k;
    this.lean += (0 - this.lean) * k;
    this.stepFreq = 0;
  }

  /** everything a test or a camera needs, as plain numbers */
  state() {
    return {
      x: this.pos.x, y: this.pos.y, z: this.pos.z,
      vx: this.vel.x, vy: this.vel.y, vz: this.vel.z,
      grounded: this.grounded, coyote: this._coyote,
      steps: this.steps, landed: this.landed, phase: this.stepPhase,
    };
  }
}

// ---------------------------------------------------------------------------
// where the body is looked at from
//
// These live here rather than in `camera.js` for one reason: `camera.js` has to
// import three, and every module `tools/verify.js` exercises must not — the
// suite runs in Node, where the browser's importmap does not exist. The rig's
// *geometry* is plain numbers and is exactly the part §M4's gate makes a claim
// about, so it sits on this side of the line and `camera.js` re-exports it.

/** one sensitivity, one clamp, for every scale that looks around by dragging */
export const LOOK = {
  /** radians per pixel of drag — the mean of the three it replaces */
  perPixel: 0.0031,
  /** how much slower pitch is than yaw; a wrist turns further than it nods */
  pitchScale: 0.92,
  /** radians. Short of ±π/2 so the horizon never inverts */
  pitchClamp: 1.45,
};

/** third-person rig geometry (§9.7 — the horizon is held low) */
export const ARM = {
  dist: 4.6,           // metres behind the head
  rise: 1.35,          // metres above it
  lookAhead: 0.16,     // seconds of velocity the aim point leads by
  follow: 7.0,         // exponential rate, s⁻¹
  clearance: 0.55,     // metres the boom keeps off any surface
  samples: 12,         // how finely the boom is swept for obstructions
};

/**
 * Sweep the boom and return the distance at which it first meets the ground.
 *
 * `traveler.js:233` clamps the arm against the height *directly under the
 * camera*, which is a different question from whether anything sits between the
 * camera and the head — walk backwards toward a cliff and that arm goes through
 * it. §M4's gate says "camera never clips terrain across the full route", so
 * the segment is swept and the boom shortened to the first obstruction.
 *
 * Marching a fixed number of samples rather than solving analytically is
 * deliberate: the height field is noise and has no closed form. Twelve samples
 * over 4.6 m is a 38 cm resolution against a 55 cm clearance, so the boom
 * cannot pass through anything it could not also stand on.
 */
export function sweepArm(head, dir, maxDist, heightAt,
  clearance = ARM.clearance, samples = ARM.samples) {
  for (let i = 1; i <= samples; i++) {
    const t = (i / samples) * maxDist;
    if (head.y + dir.y * t < heightAt(head.x + dir.x * t, head.z + dir.z * t) + clearance) {
      return ((i - 1) / samples) * maxDist;
    }
  }
  return maxDist;
}

/**
 * Replay a fixed input trace at a fixed timestep and return the trajectory.
 *
 * This is the shape §7.3 asks for: the controller is exercised with no
 * renderer, no browser and no clock, so its trajectory is a pure function of
 * (trace, dt, world) and the suite can compare it against closed-form answers
 * — a ballistic arc, an exact coyote window — rather than against a snapshot
 * of itself, which would only prove it had not changed.
 */
export function replay(walker, trace, dt, frames, yaw = 0) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    walker.step(dt, trace(i, i * dt), yaw);
    out.push(walker.state());
  }
  return out;
}
