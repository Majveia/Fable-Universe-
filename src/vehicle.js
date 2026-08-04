// Traversal — CLAUDE.md §6 M5.
//
// M4 gave the world a body. M5 gives it a distance, and its gate is a single
// unbroken capture forty kilometres long.
//
// The interesting engineering here is not the craft. A hover skiff is a spring,
// a drag term and a yaw rate, and `traveler.js` has had one since before this
// file existed. The interesting engineering is the last sentence of §6 M5 —
// "speed bounded by quadtree streaming rate" — because it is the only clause in
// the whole milestone ladder that makes a gameplay number a *derived* one, and
// because getting it wrong is precisely the pop-in the gate forbids.
//
// ---------------------------------------------------------------------------
// Why this file has no `import * as THREE`
//
// Same reason as `avatar.js`. The governor is arithmetic over the quadtree's
// geometry, the hover is a second-order system, and the mount is a spring —
// every one of those is plain numbers, so `tools/verify.js` runs all of it in
// Node with no browser and no GPU. What needs three lives at the call sites.
//
// ---------------------------------------------------------------------------
// The bound, and the four-times error that produced it
//
// The first derivation of this said: a depth-`d` tile has chord `c(d)`, splits
// when the camera is nearer than `c(d)·splitK`, so tiles arrive along a front
// `2·splitK·c(d)` wide and demand is `2·splitK·v/c(d)`.
//
// That is low by about four times, and the way it was caught is worth keeping.
// `quadtree.js`'s own `visit()` walk was re-implemented in plain numbers, a
// camera was flown along great circles at fixed altitude and speed, and the
// tiles it newly required were counted. Two things the argument had missed:
//
//   1. Every depth contributes a front, not just the deepest. The per-level
//      counts halve outward — 337, 234, 122, 65, 30, 17 per second at depths
//      18 down to 13 — and a geometric series in ½ sums to twice its first
//      term.
//   2. A depth-`d` tile is required when its *parent* splits, and the parent's
//      split radius is `(2·splitK+1)·c(d)`, not `splitK·c(d)`. Reading the test
//      `dist < chord·splitK` one level up is where the second two comes from.
//
// A third candidate — that flying over relief breathes the camera's altitude
// and every split radius with it — was falsified: a near-flat world gives 813
// tiles per second against the real world's 816.
//
// What remained after those two was a flat 1.42, at every altitude and every
// speed, and it is not a fudge either. It is √2: a straight line over a square
// lattice enters `|cos θ| + |sin θ|` cells per cell width, worst case √2 at
// 45°, and a great circle meets the cube-face grid at whatever angle it likes.
//
// The tell that this is structure rather than curve-fitting is that the worst
// observed `C / 4(2·splitK+1)` is 1.408 at splitK 6.5 and 1.422 at splitK 5.2 —
// the same number at two different thresholds. `tools/verify.js` asserts that,
// because the day someone retunes `splitK` for glass is the day a fitted
// constant would quietly stop being a bound.

/** worst-case diagonal: a line crossing a square grid at 45° (see above) */
export const DIAGONAL = Math.SQRT2;

/** the streaming model's own constants, all of them derived */
export const STREAM = {
  /** τ falls back to this until the first real worker round-trip lands.
   *  Deliberately pessimistic against the 9.8 ms measured on a desktop core:
   *  guessing fast means over-driving the stream for the first few seconds,
   *  which is exactly the moment a descent is streaming hardest. */
  tau0: 0.030,
  /** how quickly the measured τ tracks reality — slow, because one unlucky
   *  tile behind a garbage collection must not move the speed limit */
  tauLerp: 0.08,
  /** and no single sample may be read as more than this factor off the running
   *  value. An exponential average is not robust to outliers: at 8% a 29×
   *  sample still drags τ three times its own length, which is a craft that
   *  slams on the brakes because one tile landed behind a collection. Clamping
   *  the *sample* keeps a genuine slowdown trackable — three or four in a row
   *  and τ gets there — while a single spike moves it by at most 12%. */
  tauOutlier: 2.5,
  /** the governor never proposes less than this fraction of the walk speed,
   *  or a machine having a bad second would strand you */
  floorFrac: 0.55,
  /** drag begins here, as a fraction of the bound — a ceiling you feel before
   *  you hit is a ceiling that never feels like a wall */
  softAt: 0.72,
  /** and the queue's own pressure, as a fraction of the cache cap */
  queueAt: 0.55,
};

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/** tile chord at a depth, in the quadtree's own units (`quadtree.js:149`) */
export function chordAt(R, depth) {
  return R * (Math.PI / 2) / (1 << depth);
}

/**
 * How far out a depth-`d` tile is required, in chords.
 *
 * `quadtree.js:275` splits when `dist < chord·splitK`, with
 * `dist = near − R·ang` and `chord = 2·R·ang`, so a node splits while its
 * centre is within `R·ang·(1 + 2·splitK)` of the camera. Its children are
 * therefore required out to that same radius — and `R·ang` at the parent's
 * depth is exactly one child chord.
 */
export function reachChords(splitK) {
  return 2 * splitK + 1;
}

/** tiles demanded per second per unit speed, per unit of `1/c` */
export function demandConst(splitK) {
  return 4 * DIAGONAL * reachChords(splitK);
}

/**
 * The deepest chord actually resident at an altitude.
 *
 * Above the floor this tracks altitude, so the bound is linear in it. Below,
 * the tree hits `maxDepth` and cannot refine further, so the chord — and the
 * speed limit with it — stops falling. **That floor is the only reason a low
 * hover craft is possible at all**: without a maximum depth the limit would go
 * to zero as you approached the ground.
 */
export function effectiveChord({ R, maxDepth, splitK, alt }) {
  const deepest = chordAt(R, maxDepth);
  return Math.max(alt / reachChords(splitK), deepest);
}

/** the altitude below which the maxDepth floor is what binds */
export function floorAltitude({ R, maxDepth, splitK }) {
  return chordAt(R, maxDepth) * reachChords(splitK);
}

/**
 * The bound.
 *
 *     v_max = W · c_eff(alt) / (C · τ)
 *
 * `W` workers each finishing a tile every `τ` seconds supply `W/τ` tiles a
 * second; `C·v/c_eff` is what the tree asks for at speed `v`. Equate and solve.
 *
 * Units are whatever `R` and `alt` are in — the surface tile speaks metres and
 * the globe speaks draw units, and this arithmetic does not care which, which
 * is the point of it not importing three.
 */
export function maxSpeed({ R, maxDepth, splitK, alt, workers, tau }) {
  const c = effectiveChord({ R, maxDepth, splitK, alt });
  return workers * c / (demandConst(splitK) * Math.max(tau, 1e-6));
}

/** what the tree will ask for per second at this speed and altitude */
export function demandRate({ R, maxDepth, splitK, alt, speed }) {
  return demandConst(splitK) * speed / effectiveChord({ R, maxDepth, splitK, alt });
}

/**
 * The governor.
 *
 * Holds the two numbers the bound needs that are properties of *this machine* —
 * how many workers it runs and how long they actually take — and turns them into
 * a speed ceiling that is felt rather than hit.
 *
 * The softness matters more than it looks. A hard clamp at `v_max` means a craft
 * that accelerates smoothly and then stops accelerating, with nothing on screen
 * to say why; §8 axis 8 calls that dishonest, and it is. A drag that rises as
 * the bound approaches reads as air thickening, which is both nicer and true —
 * the limit really is the world struggling to arrive.
 */
export class StreamGovernor {
  /**
   * @param quad  a QuadtreePlanet, or anything with `{ workers, stats, cap }`
   * @param opts  `{ R, maxDepth, splitK }` — the tree's geometry
   */
  constructor(quad, opts = {}) {
    this.R = opts.R ?? quad?.R ?? 1;
    this.maxDepth = opts.maxDepth ?? quad?.maxDepth ?? 18;
    this.splitK = opts.splitK ?? quad?.splitK ?? 6.5;
    this.workers = Math.max(1, opts.workers ?? quad?.workers?.length ?? 4);
    this.quad = quad ?? null;

    this.tau = opts.tau ?? STREAM.tau0;
    this.samples = 0;
    /** last computed ceiling, in the tree's units per second */
    this.limit = Infinity;
    /** 0 → free, 1 → fully governed. What the HUD would show if it showed it. */
    this.pressure = 0;
  }

  /**
   * One measured worker round-trip.
   *
   * §2.3 is untouched: this reads a clock, but nothing generated depends on it.
   * The tile that comes back is the same tile whatever the stopwatch said — the
   * measurement only ever changes how fast you are allowed to fly toward it.
   */
  observe(seconds) {
    if (!(seconds > 0) || !isFinite(seconds)) return this.tau;
    if (this.samples === 0) {
      // the first real sample replaces the guess outright — the guess was only
      // ever a stand-in for not knowing this machine
      this.tau = seconds;
    } else {
      const lo = this.tau / STREAM.tauOutlier, hi = this.tau * STREAM.tauOutlier;
      const s = clamp(seconds, lo, hi);
      this.tau += (s - this.tau) * STREAM.tauLerp;
    }
    this.samples++;
    return this.tau;
  }

  /** the ceiling at this altitude, in the tree's units per second */
  ceiling(alt) {
    return maxSpeed({
      R: this.R, maxDepth: this.maxDepth, splitK: this.splitK,
      alt, workers: this.workers, tau: this.tau,
    });
  }

  /** how full the build queue is, 0..1 — the *other* thing that says "slow down" */
  queueLoad() {
    const s = this.quad?.stats;
    if (!s) return 0;
    const cap = this.quad.cap || 1;
    return clamp(s.pending / cap, 0, 1);
  }

  /**
   * The whole governor in one call: given where you are, how fast you want to
   * go, and a floor speed you are always allowed, return the speed to use.
   *
   * `floor` exists because a bound that can reach zero is a bound that can
   * strand you. On a machine having a genuinely bad second the craft slows to a
   * crawl but never to a stop, and the crawl is honest about why.
   */
  govern(alt, want, floor = 0) {
    const lim = this.ceiling(alt);
    this.limit = lim;
    const hard = Math.max(lim, floor);

    // the soft knee: below `softAt` of the bound nothing happens at all, which
    // is what makes this a ceiling you approach rather than a tax you always pay
    const over = want / Math.max(hard, 1e-9);
    let out = want;
    if (over > STREAM.softAt) {
      // map [softAt, ∞) → [softAt, 1] with a curve that is C¹ at the knee, so
      // there is no step in acceleration where the governor engages
      const t = (over - STREAM.softAt) / (1 - STREAM.softAt);
      const eased = 1 - Math.exp(-t);
      out = hard * (STREAM.softAt + (1 - STREAM.softAt) * eased);
    }

    // and the queue's own back-pressure, which catches the cases the altitude
    // model cannot see — a descent director streaming ahead of you, a city pad
    // regrading the ground, a cold cache after a scale change
    const q = this.queueLoad();
    if (q > STREAM.queueAt) {
      const t = (q - STREAM.queueAt) / (1 - STREAM.queueAt);
      out *= 1 - 0.55 * t * t;
    }

    out = Math.max(out, Math.min(want, floor));
    this.pressure = want > 1e-9 ? clamp(1 - out / want, 0, 1) : 0;
    return out;
  }
}

// ---------------------------------------------------------------------------
// the craft
//
// `traveler.js:149` drives the skiff today: a lerp toward a target velocity, a
// hover height with a sine bob, a yaw that chases the velocity and a bank
// proportional to the yaw rate. It works, and most of it survives — what it is
// missing is that every one of those numbers is in one file, in metres, at
// surface scale, so the globe cannot use any of it.

/** hover-craft constants. Lengths are in craft-lengths, not metres, so the
 *  same dynamics fly a 3 m skiff over a meadow and a hopper over a continent */
export const HOVER = {
  ride: 3.4,            // the height the skirt holds, in metres at surface scale
  rideK: 5.0,           // how stiffly it holds it, s⁻¹
  accel: 2.2,           // approach rate toward the target velocity, s⁻¹
  yawRate: 5.0,         // how fast the nose chases the velocity, s⁻¹
  bankK: 1.1,           // bank per unit yaw rate
  bankMax: 0.55,        // radians
  bankEase: 4.0,        // s⁻¹
  bobFreq: 2.1,         // the idle breathe
  bobAmp: 0.24,
  hopV: 7.4,            // short-hop launch speed, m/s at 1 g
  hopCut: 0.42,         // releasing early keeps this much of the rise
};

/**
 * Hover dynamics, as plain numbers.
 *
 * Deliberately *not* a rigid body. §4 says the verbs are travel and look, and a
 * craft with real angular inertia is a craft you fight; this one always knows
 * which way it is going and leans into it, which is the Ghibli reading of a
 * vehicle and also the one that never gets stuck upside down.
 */
export class Hover {
  constructor({ groundAt, gravity = 9.80665, cfg = HOVER, ride = null }) {
    this.groundAt = groundAt;
    this.gravity = gravity;
    this.c = cfg;
    this.ride = ride ?? cfg.ride;

    this.pos = { x: 0, y: 0, z: 0 };
    this.vel = { x: 0, y: 0, z: 0 };
    this.face = 0;        // heading, radians
    this.bank = 0;
    this.t = 0;
    this.airborne = false;
    this._rising = false;
    this._wasHop = false;
  }

  place(x, z, face = 0) {
    this.pos.x = x; this.pos.z = z;
    this.pos.y = this.groundAt(x, z) + this.ride;
    this.vel.x = this.vel.y = this.vel.z = 0;
    this.face = face;
    this.bank = 0;
    this.airborne = false;
  }

  /** speed over the ground */
  speed() {
    return Math.hypot(this.vel.x, this.vel.z);
  }

  /**
   * One step.
   *
   * `move` is the same analog `{x, y}` the walker takes, in the camera's frame,
   * so the craft and the body are driven by one axis and switching between them
   * cannot change what the stick means.
   */
  step(dt, input, yaw, topSpeed) {
    if (dt <= 0) return;
    const c = this.c;
    this.t += dt;

    const move = input.move ?? { x: 0, y: 0 };
    let mx = move.x, mz = move.y;
    const mag = Math.hypot(mx, mz);
    if (mag > 1) { mx /= mag; mz /= mag; }

    const cy = Math.cos(yaw), sy = Math.sin(yaw);
    const fx = -sy, fz = -cy, rx = cy, rz = -sy;
    let wx = fx * mz + rx * mx, wz = fz * mz + rz * mx;
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-6) { wx /= wl; wz /= wl; }

    const target = topSpeed * Math.min(mag, 1);
    const k = 1 - Math.exp(-c.accel * dt);
    this.vel.x += (wx * target - this.vel.x) * k;
    this.vel.z += (wz * target - this.vel.z) * k;

    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;

    // --- the short hop -----------------------------------------------------
    // §6 M5 asks for a "short-hop flyer", and the honest reading of *short* is
    // that it is a jump, not a flight mode: one impulse, gravity does the rest,
    // and the skirt catches you. So it shares the walker's variable-height
    // shape — hold for the full arc, release early for a hop — which means the
    // one thing a rider already knows how to do transfers intact.
    const hop = !!input.hop;
    if (hop && !this._wasHop && !this.airborne) {
      this.vel.y = c.hopV * Math.sqrt(this.gravity / 9.80665);
      this.airborne = true;
      this._rising = true;
    }
    if (this._rising && !hop && this.vel.y > 0) {
      this.vel.y *= c.hopCut;
      this._rising = false;
    }
    if (this.vel.y <= 0) this._rising = false;
    this._wasHop = hop;

    // --- vertical ----------------------------------------------------------
    const floor = this.groundAt(this.pos.x, this.pos.z);
    if (this.airborne) {
      // trapezoidal, for the same reason `avatar.js` is: under constant
      // acceleration `y += ½(v₀+v₁)dt` is exact, and Euler quietly lands the
      // arc short of the height it was asked for
      const vy0 = this.vel.y;
      this.vel.y -= this.gravity * dt;
      this.pos.y += (vy0 + this.vel.y) * 0.5 * dt;
      if (this.pos.y <= floor + this.ride && this.vel.y <= 0) {
        this.pos.y = floor + this.ride;
        this.vel.y = 0;
        this.airborne = false;
        this._rising = false;
      }
    } else {
      const want = floor + this.ride
        + Math.sin(this.t * c.bobFreq) * c.bobAmp * (1 - Math.min(this.speed() / topSpeed, 1) * 0.6);
      const kr = 1 - Math.exp(-c.rideK * dt);
      this.pos.y += (want - this.pos.y) * kr;
      this.vel.y = 0;
    }

    // --- heading and bank ---------------------------------------------------
    const sp = this.speed();
    if (sp > 2) {
      const wantFace = Math.atan2(-this.vel.x, -this.vel.z);
      let dy = wantFace - this.face;
      dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
      const step = dy * Math.min(dt * c.yawRate, 1);
      this.face += step;
      // bank from the yaw *rate*, not the yaw error, so a long steady turn
      // holds its lean instead of standing up as the error shrinks
      const rate = dt > 0 ? step / dt : 0;
      const wantBank = clamp(-rate * c.bankK, -c.bankMax, c.bankMax);
      this.bank += (wantBank - this.bank) * Math.min(dt * c.bankEase, 1);
    } else {
      this.bank *= Math.exp(-3 * dt);
    }
  }

  state() {
    return {
      x: this.pos.x, y: this.pos.y, z: this.pos.z,
      vx: this.vel.x, vy: this.vel.y, vz: this.vel.z,
      face: this.face, bank: this.bank, airborne: this.airborne,
    };
  }
}

// ---------------------------------------------------------------------------
// the handover
//
// §2.5: "No cuts, no loading screens, no fades to black… If a feature can't be
// entered continuously, it isn't finished."
//
// `traveler.js:139` teleports the body onto the deck. That has been a cut since
// it was written and nobody noticed, because the camera is behind the walker and
// the jump is short. At 40 km it stops going unnoticed.

export const MOUNT = {
  /** seconds the eye takes to travel from where it is to where it will be */
  dur: 0.35,
  /** how close you have to be to board */
  reach: 14,
};

/**
 * The mount spring.
 *
 * Not a lerp on `t/dur`. A lerp is continuous in position and *discontinuous in
 * velocity* at both ends — it starts by teleporting the eye to a velocity and
 * finishes by teleporting it back to zero, and both of those read as a jolt in
 * exactly the frame the handover is trying to hide.
 *
 * So the blend is smoothstep's derivative-zero-at-both-ends curve *plus* the
 * carried velocity, which is the other half of §6 M5's "camera inherits
 * velocity": during the handover the eye is still moving at the speed it was
 * moving, and the offset it is closing is what shrinks.
 */
export class Mount {
  constructor(dur = MOUNT.dur) {
    this.dur = dur;
    this.t = -1;                       // < 0 → idle
    this.off = { x: 0, y: 0, z: 0 };   // where the eye was, minus where it goes
    this.vel = { x: 0, y: 0, z: 0 };   // momentum carried across the swap
  }

  get active() { return this.t >= 0; }

  /**
   * Begin a handover.
   *
   * @param from  where the eye is now
   * @param to    where the new owner will put it this frame
   * @param vel   the velocity that must survive the swap
   */
  begin(from, to, vel = { x: 0, y: 0, z: 0 }) {
    this.off.x = from.x - to.x;
    this.off.y = from.y - to.y;
    this.off.z = from.z - to.z;
    this.vel.x = vel.x; this.vel.y = vel.y; this.vel.z = vel.z;
    this.t = 0;
  }

  /** the offset to add to the new owner's placement this frame */
  update(dt) {
    if (this.t < 0) return { x: 0, y: 0, z: 0, done: true };
    this.t += dt;
    // the epsilon is load-bearing: `dur/n` summed n times does not land on
    // `dur`, so an exact `t >= dur` test leaves the mount live for one extra
    // frame carrying an offset of about 1e-31 metres. Harmless to look at,
    // and a state machine that is still "handing over" a frame after it
    // finished is the kind of thing another feature eventually trips on.
    const u = clamp(this.t / this.dur + 1e-9, 0, 1);
    // 1 − smoothstep: 1 at u=0, 0 at u=1, and zero slope at *both* ends, so the
    // eye neither starts nor stops with a step in velocity
    const w = 1 - u * u * (3 - 2 * u);
    const out = { x: this.off.x * w, y: this.off.y * w, z: this.off.z * w, done: u >= 1 };
    if (u >= 1) this.t = -1;
    return out;
  }

  cancel() { this.t = -1; }
}

/**
 * Hand momentum across a mount or a dismount.
 *
 * Both directions, and it is the same function because it is the same physics:
 * whatever was moving keeps moving. Stepping off a skiff at 60 m/s and finding
 * yourself standing still is a cut in the velocity even when the position is
 * continuous, and §6 M5 names it — "camera inherits velocity".
 */
export function handMomentum(from, to, keep = 1) {
  to.x = from.x * keep;
  to.y = (from.y ?? 0) * keep;
  to.z = from.z * keep;
  return to;
}
