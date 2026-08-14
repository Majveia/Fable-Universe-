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
 * Locomotion constants.
 *
 *   `eye` 1.68 m and `fov` 52 are §6 M4's, and are also the reference's own
 *   (`hoshi-no-tani.html:181-185`) — the two documents agree to the digit,
 *   which is the tell that §M4 is transcribing that class.
 *
 * ---------------------------------------------------------------------------
 * On `walk`, `sprint` and `jumpHeight`, which have all moved
 *
 * The previous values were 3.45 m/s, ×2.25 and 0.55 m, and the note above them
 * argued — correctly, against the 16/60 m/s arcade numbers they replaced —
 * that those are what an unaugmented human body does. The complaint they earn
 * in practice is that this is a person in a pressure suit standing on a world
 * nobody has named, with a 1400 m tile to cross and a horizon fourteen
 * kilometres out, and a 3.45 m/s stroll makes all of that feel like distance
 * rather than freedom.
 *
 * The resolution is not to go back to 16 m/s. It is to say what the body *is*.
 * A powered suit is the only thing that explains surviving 338 K and 0.6 g in
 * the first place, and a powered suit has a stated capability: it moves a
 * person at a fast run without their spending anything, and it stores enough
 * in its legs for a two-storey standing jump. So `walk` is 4.8 m/s — a real
 * jog, still visibly a gait and not a glide — and `sprint` ×3.0 puts a run at
 * 14.4 m/s, which crosses the tile in a hundred seconds instead of seven
 * minutes. Both remain speeds a body could have. Neither is a physical claim
 * the HUD contradicts (§8 axis 8).
 *
 * ---------------------------------------------------------------------------
 * The jump, and the bug that was hiding inside the old one
 *
 * `jumpHeight` is 1.45 m now rather than 0.55 m, for the same suit reason. But
 * the more interesting change is what it means. The old controller solved
 * `v₀ = √(2·g·jumpHeight)` from *the world's own g*, so the height was held
 * constant everywhere and only the time of flight changed — the suite asserted
 * exactly that, in the words "a low-gravity world gets the same jump height,
 * taken more slowly."
 *
 * That is backwards, and §3's ruling that "the numbers are never negotiable"
 * decides it. A leg extends over a fixed distance with a roughly fixed force,
 * so what a body holds constant across worlds is its **launch velocity**, not
 * its apex. Height then goes as v₀²/2g and a sixth of a gravity buys six times
 * the jump. The old model quietly deleted the single most legible consequence
 * of standing on another world — and it deleted it in the direction of *less*
 * spectacle, which is the worst direction for a bug to point.
 *
 * So `jumpHeight` is now explicitly the apex **at one Earth gravity**, and
 * `jumpV0` derives the constant launch speed from it once. `tools/verify.js`
 * asserts the new relation.
 */
export const GAIT = {
  eye: 1.68,
  fov: 52,
  walk: 4.8,
  sprint: 3.0,
  radius: 0.34,          // capsule radius, metres
  accelGround: 11.0,     // m/s² toward the target velocity
  accelStop: 13.5,       // stopping is quicker than starting
  accelAir: 2.4,         // some authority in the air, not none
  stepUp: 0.55,          // a kerb, a root, a low wall — not a cliff
  slopeLimit: 50,        // degrees; above this you slide instead of walking
  slideAccel: 0.62,      // fraction of the downhill gravity component
  coyote: 0.14,          // seconds of grace after walking off an edge
  jumpBuffer: 0.10,      // seconds a jump pressed just before landing survives
  jumpHeight: 1.45,      // metres **at 1 g**; elsewhere v₀ is what is held
  jumpCut: 0.45,         // releasing early keeps this much of the rise
  skin: 0.02,            // ground contact tolerance

  /**
   * Flight — "like Neo in The Matrix", which is a specific request and not a
   * vague one. What distinguishes that from the flight this controller had is
   * not the top speed, it is the **mass**.
   *
   * The old `fly` was one number, 16 m/s, fed through the same exponential
   * velocity-matching the walk uses at `accelStop` = 12/s. That is a 60 ms
   * time constant: input and velocity are effectively the same variable, so
   * the body has no momentum, cannot be *aimed*, stops dead the instant the
   * stick centres, and reads as a camera on rails. Every frame of Neo flying
   * is the opposite — a body that has to be pointed, that takes a moment to
   * get going, that arrives somewhere and keeps going a little.
   *
   * So flight is integrated as thrust against drag instead:
   *
   *     a = look · thrust · |input| · boost
   *     v ← (v + a·dt) · exp(−drag·dt),   |v| ≤ top
   *
   * with a *higher* drag when there is no input, which is what gives the hover
   * a settle instead of a coast to infinity. Terminal speed falls out of the
   * two constants rather than being clamped into place: thrust/drag = 47.5 m/s
   * cruising and 162 m/s boosted, and `top` is a safety rail above both rather
   * than the thing you fly at.
   *
   * `rise` is the explicit vertical axis (R/F, or the pinch on glass), kept
   * separate from the look vector so you can hold an altitude while looking
   * down — the single most useful thing a flying camera can do and the thing
   * pure look-directed thrust takes away.
   */
  flyThrust: 62,         // m/s² along the look vector at full deflection
  flyBoost: 3.4,         // ×, on both thrust and the drag-limited top speed
  flyDrag: 1.3,          // 1/s while thrusting — sets cruise at thrust/drag
  flyCoastDrag: 0.55,    // 1/s with no input: a long, deliberate glide
  flyHoverDrag: 2.6,     // 1/s with no input near the ground: settle, do not drift
  flyRise: 30,           // m/s² on the explicit vertical axis
  flyTop: 340,           // m/s hard rail; the drag law normally binds first
};

/** the launch speed the legs produce, constant across worlds (see above) */
export const jumpV0 = (gait = GAIT) => Math.sqrt(2 * G_EARTH * gait.jumpHeight);

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

    // the closed-form horizontal displacement for the step in progress; see
    // the note in `step()`. Written every walking step, read once.
    this._dx = 0;
    this._dz = 0;

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
    return this.pos.y + this.g.eye + this.bobY;
  }

  /**
   * One step.
   *
   * `input.move` is an **analog** vector in the camera's frame — `{x: strafe,
   * y: forward}`, magnitude 0..1. It is analog because a thumb on glass has a
   * magnitude and the old touch layer threw it away by synthesizing keystrokes;
   * a keyboard simply reports 0 or ±1 into the same field.
   */
  step(dt, input, yaw, pitch = 0) {
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

    // Flight is a different integrator, not a different constant. It needs the
    // *unnormalised* stick and the pitch, so it takes the branch before the
    // ground model's target-velocity arithmetic runs at all.
    if (this.fly) {
      this._flyStep(dt, { fx, fz, rx, rz }, mx, mz, speedScale, pitch,
        !!input.sprint, input.up ?? 0);
      this._gait(dt, false);
      return;
    }

    const base = g.walk * (input.sprint ? g.sprint : 1);

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
    const a = this.grounded ? (moving ? g.accelGround : g.accelStop)
      : g.accelAir;
    // Exponential approach rather than a lerp on dt: the rate is then a
    // property of the controller and not of the frame rate, which is what lets
    // the suite replay the same trace at three different dt and get the same
    // trajectory.
    const k = 1 - Math.exp(-a * dt);
    const vx0 = this.vel.x, vz0 = this.vel.z;
    this.vel.x += (tx - this.vel.x) * k;
    this.vel.z += (tz - this.vel.z) * k;

    // The displacement that velocity produces, in closed form.
    //
    // Velocity was exactly dt-independent already; *position* was not, because
    // `pos += vel·dt` is first-order and integrates the post-step velocity
    // across the whole step. The residual is the acceleration transient, so it
    // appears every time the stick moves and it scales with speed.
    //
    // This integral has an elementary answer. With v(t) = T + (v₀−T)e^{−at}
    //
    //     ∫₀^dt v dt = T·dt + (v₀ − T)(1 − e^{−a·dt})/a = T·dt + (v₀ − v₁)/a
    //
    // because v₁ − v₀ = (T − v₀)·k and k = 1 − e^{−a·dt} are the same k already
    // computed above. So the exact displacement costs one subtract and one
    // multiply by a reciprocal, and the horizontal trajectory becomes dt-exact
    // under a constant target rather than merely close — the same upgrade the
    // vertical axis got from its trapezoid, and for the same reason: a
    // controller that lands somewhere different at 60 Hz than at 120 Hz will
    // eventually be tuned until it looks right on one machine.
    //
    // Worth being precise about what this does *not* buy. The suite's 60-vs-120
    // Hz walking drift over rough ground barely moves, because that residual is
    // not the velocity transient at all — it is `slopeAt`/`normalAt`/the
    // step-up probe each being sampled once per step, so two frame rates take
    // two slightly different lines across the same height field. That is the
    // cost of discretising a continuous field and no integrator removes it.
    // This removes the part that *is* removable.
    const inv = 1 / a;
    this._dx = tx * dt + (vx0 - this.vel.x) * inv;
    this._dz = tz * dt + (vz0 - this.vel.z) * inv;

    // --- jump: buffered, forgiving, and cuttable ---------------------------
    this._buffer = jump && !this._wasJump ? g.jumpBuffer : Math.max(0, this._buffer - dt);
    this._wasJump = jump;

    if (this._buffer > 0 && (this.grounded || this._coyote > 0)) {
      // The legs produce a launch *speed*, not a launch *height* — a fixed
      // extension against a fixed force. So this constant does not read
      // `this.gravity`, and the apex that follows is v₀²/2g: 1.45 m here,
      // 8.8 m on a Moon-gravity world. See the note on GAIT.jumpHeight.
      this.vel.y = jumpV0(g);
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

  /**
   * Flight, as thrust against drag. See the note on `GAIT.flyThrust`.
   *
   * `basis` is the yaw frame the walk already computed — forward and right on
   * the horizontal plane. Pitch tilts the forward axis out of that plane here
   * rather than in the caller, so a controller that has no pitch (the suite,
   * the autopilot) simply passes 0 and gets level flight.
   *
   * The one asymmetry worth naming: the *strafe* axis stays horizontal even
   * when the look is pitched. Rolling the strafe with the pitch is what makes
   * a free-flying camera feel like it is tumbling, and there is no roll input
   * to correct it with.
   */
  _flyStep(dt, basis, mx, mz, mag, pitch, sprint, rise) {
    const g = this.g;
    const boost = sprint ? g.flyBoost : 1;

    // the look vector: yaw's forward, tilted by pitch
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    const lx = basis.fx * cp, ly = sp, lz = basis.fz * cp;

    // Thrust along the look for the forward axis, along the horizontal right
    // for strafe, and along world up for the explicit rise axis.
    let ax = (lx * mz + basis.rx * mx) * g.flyThrust * boost;
    let ay = (ly * mz) * g.flyThrust * boost + rise * g.flyRise * boost;
    let az = (lz * mz + basis.rz * mx) * g.flyThrust * boost;

    this.vel.x += ax * dt;
    this.vel.y += ay * dt;
    this.vel.z += az * dt;

    // Drag. Thrusting, it is what sets cruise speed (thrust/drag). Idle, it is
    // what ends the flight gracefully — and near the ground it is stronger
    // still, so a hover a metre up settles instead of sliding away.
    const thrusting = mag > 1e-3 || Math.abs(rise) > 1e-3;
    let drag;
    if (thrusting) drag = g.flyDrag;
    else {
      const clearance = this.pos.y - this.groundAt(this.pos.x, this.pos.z);
      // blend over the first four metres: a landing approach damps, a cruise
      // at altitude does not
      const near = clamp(1 - clearance / 4, 0, 1);
      drag = g.flyCoastDrag + (g.flyHoverDrag - g.flyCoastDrag) * near;
    }
    // Exponential, so the decay rate is a property of the controller and not
    // of the frame rate — the same reason the ground model uses it.
    const keep = Math.exp(-drag * dt);
    this.vel.x *= keep; this.vel.y *= keep; this.vel.z *= keep;

    // the hard rail; the drag law normally binds a long way below it
    const sp2 = Math.hypot(this.vel.x, this.vel.y, this.vel.z);
    const top = g.flyTop * boost;
    if (sp2 > top) {
      const s = top / sp2;
      this.vel.x *= s; this.vel.y *= s; this.vel.z *= s;
    }

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
    // `_dx`/`_dz` are the closed-form displacement `step()` just computed, not
    // `vel·dt`. See the note there.
    const dx = this._dx ?? this.vel.x * dt;
    const dz = this._dz ?? this.vel.z * dt;
    const nx = this.pos.x + dx;
    const nz = this.pos.z + dz;

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
        // The wall projection changed the velocity, so the closed form no
        // longer describes this step — slide on the corrected velocity.
        const slide = into < 0 ? (dx * wallX + dz * wallZ) : 0;
        this.pos.x += dx - wallX * slide;
        this.pos.z += dz - wallZ * slide;
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
    const spd = Math.hypot(this.vel.x, this.vel.z);
    this.stepFreq = (spd > 0.14 && this.grounded && !this.fly) ? 0.58 + 0.34 * spd : 0;

    const prev = this.stepPhase;
    this.stepPhase += this.stepFreq * dt;
    // two footfalls per cycle — left and right
    if (Math.floor(this.stepPhase * 2) !== Math.floor(prev * 2)) this.steps++;

    const gp = this.stepPhase * Math.PI * 2;
    const amp = this.fly ? 0 : clamp(spd / 3.6, 0, 1);
    const kf = clamp(11 * dt, 0, 1);
    this.bobY += (Math.sin(gp * 2) * 0.0135 * amp - this.bobY) * kf;
    this.bobX += (Math.sin(gp) * 0.0095 * amp - this.bobX) * kf;
    this.roll += (Math.sin(gp) * 0.0060 * amp - this.roll) * clamp(9 * dt, 0, 1);
    this.lean += (clamp(spd * 0.016, 0, 0.05) - this.lean) * clamp(4 * dt, 0, 1);
    this.breath += dt * 0.9;
    if (!moving && spd < 0.02) this.stepFreq = 0;
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
export function replay(walker, trace, dt, frames, yaw = 0, pitch = 0) {
  const out = [];
  for (let i = 0; i < frames; i++) {
    walker.step(dt, trace(i, i * dt), yaw, pitch);
    out.push(walker.state());
  }
  return out;
}
