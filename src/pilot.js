// Flying it yourself, at system scale — CLAUDE.md §4's "travel", §6 M5, §3.
//
// `system.js` has had a cruise since long before this file: press J, pick a
// heading, and a relativistic beta ramps from 0.02 to 0.985 while the sky
// aberrates around you. It is the best thing at that scale and it ends badly.
// The last four lines of it are:
//
//     const v = 60 + 2600 * this.rel.beta ** 3;
//     this.camera.position.addScaledVector(this.rel.dir, v * dt);
//     if (this.camera.position.length() > 13000) this.camera.position.setLength(13000);
//
// A cube of speed, and a wall. Steer at a world and you arrive at 2,660 units
// a second, which at planet scale is about 6.5 million metres a second, and
// nothing about the approach knows the world is there. You either overshoot it
// or you hit the clamp, and the clamp is a *sphere around the star* — so the
// same manoeuvre that reads as arrival on one heading reads as a glass wall on
// another.
//
// The Long Silence solves this in one sentence, and its README states it as a
// design rule rather than a mechanic: **"Fold speed scales with distance from
// the nearest mass, so an approach decelerates itself and drops you out just
// clear of the surface."**
//
// ---------------------------------------------------------------------------
// The governor, and why it is not a curve
//
// The obvious port is a falloff — some `smoothstep` of distance over radius,
// tuned until arrivals feel right. That would work and it would be a fudge, and
// §3 rules on exactly this: *the numbers are never negotiable; the palette
// always is.*
//
// There is a real constraint available, and it is the one every pilot actually
// flies. If the craft can decelerate at `a`, then from speed `v` it needs
// `v²/2a` of room to stop. Turn that around and the fastest you are allowed to
// be at distance `d` from where you must be stopped is
//
//     v(d) = sqrt(2 · a · d)
//
// capped by the drive. That is the whole governor. It is not tuned, it is
// solved, and three things fall out of it rather than being arranged:
//
//   · The approach decelerates itself, because the bound tightens as `d`
//     shrinks and the craft is always riding it.
//   · You arrive at zero exactly at the stopping distance, not near it.
//   · **A heavier world is harder to approach**, because the surface you must
//     stop clear of is further from the centre. The gravity is not simulated
//     here and does not need to be — the geometry already says it.
//
// The reference's own phrasing gives away that it found the same thing: an
// approach that "decelerates itself" is a description of a craft riding a
// stopping bound, not of a craft being slowed by a lookup.
//
// ---------------------------------------------------------------------------
// Why there is no `import * as THREE` in this file
//
// The same reason `vehicle.js` and `avatar.js` say in their own headers. The
// governor is arithmetic, the throttle is a first-order lag and the roll is a
// second-order system, so every claim this file makes can be checked in Node
// with no browser and no GPU — which `tools/verify.js` does, against an
// independently derived answer rather than a snapshot. What needs three lives
// at the call site in `system.js`.
//
// ---------------------------------------------------------------------------
// What is deliberately not here (§4)
//
// No scanning, no drive charge, no fold objectives, no Resonators, no Aperture.
// The reference is a game and AEON is not one: "this is a place, not a game
// loop", and the verbs are travel and look. A craft is travel. Everything the
// reference hangs off its craft is the other thing.

const clamp = (v, a, b) => Math.min(Math.max(v, a), b);

/**
 * The craft, as numbers.
 *
 * Units are system-scale units and seconds throughout. `system.js` places the
 * star at the origin and works in units where a planet's orbit is hundreds and
 * the far edge is 13,000, so these are not metres and the file never pretends
 * they are.
 */
export const PILOT = {
  /** peak drive speed, units/s — the old cruise's `60 + 2600·beta³` at full */
  vMax: 2660,
  /** the floor, so a stationary craft still has steerage way */
  vMin: 6,
  /** deceleration authority, units/s². Everything about arrival follows. */
  decel: 74,
  /** throttle lag: how fast demand becomes thrust. A drive is not a switch. */
  spool: 1.6,
  /** roll rate, rad/s, and how hard it is damped */
  rollRate: 1.5,
  rollDamp: 3.4,
  /** how far clear of a surface the governor brings you to rest, in radii */
  standoff: 1.35,
};

/**
 * The speed limit at distance `d` from a body's centre.
 *
 * `d` and `radius` share units. Returns the largest speed from which the craft
 * can still stop by the time it reaches `standoff · radius`, capped at `vMax`.
 *
 * Inside the standoff the bound is zero and not negative: a craft already too
 * close is not owed imaginary speed, and a `sqrt` of a negative number is how
 * a NaN reaches the frame and then the whole scene graph.
 */
export function speedLimit(d, radius, o = PILOT) {
  const stop = radius * o.standoff;
  const room = d - stop;
  if (!(room > 0)) return 0;
  return Math.min(o.vMax, Math.sqrt(2 * o.decel * room));
}

/**
 * The tightest limit across every body in the system.
 *
 * Nearest by *distance* is the wrong test and it took one to see why: a star
 * is a hundred times a planet's radius, so at equal range the star's bound is
 * far tighter, and picking the nearest body by centre distance would let you
 * fly through a sun to reach a world just past it. The bound is a minimum over
 * all of them, which costs a loop over a handful of entries once a frame.
 *
 * @param {{x:number,y:number,z:number,radius:number}[]} bodies
 */
export function governedSpeed(pos, bodies, o = PILOT) {
  let v = o.vMax;
  for (const b of bodies) {
    const d = Math.hypot(pos.x - b.x, pos.y - b.y, pos.z - b.z);
    const lim = speedLimit(d, b.radius, o);
    if (lim < v) v = lim;
  }
  return Math.max(v, 0);
}

/**
 * How much room a craft at `v` needs to stop — the inverse of `speedLimit`.
 *
 * Exists so the HUD can say "braking" honestly rather than guessing, and so
 * `tools/verify.js` has a second expression of the same relation to check the
 * first against. Two derivations that agree is evidence; one is a claim.
 */
export function stoppingDistance(v, o = PILOT) {
  return (v * v) / (2 * o.decel);
}

/**
 * The craft's own state: throttle, roll, and the speed it actually has.
 *
 * `demand` is the pilot's ask, 0..1. `beta` is what the drive is delivering,
 * which lags it — a drive is not a switch, and the lag is most of what makes a
 * craft feel like a mass rather than a cursor.
 */
export class Pilot {
  constructor(o = PILOT) {
    this.o = o;
    this.demand = 0;
    this.beta = 0;       // 0..1 of the *governed* limit, not of vMax
    this.roll = 0;
    this.rollV = 0;
    this.speed = 0;      // units/s, after the governor
    this.limit = o.vMax; // what the governor allowed this frame
    this.braking = false;
  }

  /** throttle, -1 .. 1 (S .. W); roll, -1 .. 1 (Q .. E) */
  step(dt, { throttle = 0, rollIn = 0, pos, bodies = [] } = {}) {
    const o = this.o;
    if (!(dt > 0)) return this.speed;

    this.demand = clamp(this.demand + throttle * dt * 0.55, 0, 1);
    // first-order lag toward the demand, framerate-independent
    this.beta += (this.demand - this.beta) * (1 - Math.exp(-o.spool * dt));

    // Roll is a second-order system so it overshoots slightly and settles,
    // which is what a craft with angular momentum does and what a lerp cannot.
    this.rollV += (rollIn * o.rollRate - this.rollV) * (1 - Math.exp(-o.rollDamp * dt));
    this.roll += this.rollV * dt;

    this.limit = pos ? governedSpeed(pos, bodies, o) : o.vMax;
    /* The cube is kept. It is not physics — it is the throttle *curve*, and it
       is the reason the old cruise felt like a starship: most of the stick is
       spent in the low decades, so you can hold a slow drift near a world and
       still reach the far edge of the system. §3's ruling applies in the other
       direction here. The governor above is the number and is not negotiable;
       how the pilot's hand maps onto it is the palette. */
    const want = o.vMin + (o.vMax - o.vMin) * this.beta ** 3;
    this.speed = Math.min(want, Math.max(this.limit, 0));
    /* Braking is a fact, not a mood: it is true exactly when the governor is
       taking speed the drive is asking for. The HUD reads this rather than
       inferring it from a falling number, which would also be true while the
       pilot was simply closing the throttle. */
    this.braking = this.limit < want - 1e-6;
    return this.speed;
  }

  /**
   * Has an interstellar arrival spent its momentum?
   *
   * `system.js` has always asked this, and before the governor it asked it of
   * `rel.beta` — the relativistic parameter — because that was the only number
   * a cruise had. Under `?pilot=1` that reading is wrong twice over. `rel.beta`
   * is now a *display* quantity derived from the pilot's demand, and the pilot
   * overwrites it after the check has already run, so the check sees a beta
   * from the previous frame that is near zero for the first seconds of every
   * cruise — which handed the helm back the moment you arrived somewhere.
   *
   * The honest question is about the craft, not the sky: has it actually come
   * to rest? That is `speed` against the governor, and both live here, so the
   * predicate lives here too and `tools/verify.js` can ask it in Node.
   *
   * `slow` is a fraction of peak, not an absolute: a craft still under way at
   * a hundredth of its drive is not arriving, whatever the governor is
   * allowing it nearby.
   */
  arrived(slow = 0.02) {
    // Riding the bound is not arriving — a craft can be governed to a crawl on
    // a close pass and still be going somewhere. Demand has to be off too.
    return this.speed <= this.o.vMax * slow && this.demand <= slow;
  }

  /**
   * Hand the helm back — used when a transition takes the camera (§2.5).
   *
   * `speed` is stood down with the rest, and it was not: the first version
   * cleared the *inputs* and left the last computed speed in place, so a craft
   * whose camera had been taken by a hyperzoom went on reporting full drive to
   * anything that asked. `arrived()` asks, which is how it was caught — the
   * predicate and the reset have to agree about what "not flying" means, and
   * a released craft is not flying.
   */
  release() {
    this.demand = 0;
    this.beta = 0;
    this.rollV = 0;
    this.speed = 0;
    this.braking = false;
  }
}

/**
 * Quantise a craft position for the deep link — §2.4, and §11's boundary.
 *
 * §2.4 says every place is a URL, and §11 says a quantity reaching a *branch*
 * must not ride on a last bit. A shared craft position is both at once: it is
 * written to a URL, parsed back on another machine, and the world it resolves
 * to has to be the same one. Twelve significant figures of a double through a
 * decimal round trip is not a guarantee, and a `sin` anywhere upstream of it
 * on arm64 makes it certainly false.
 *
 * So the link carries a fixed grid. One part in 2^20 of the 13,000-unit system
 * radius is about 12 milliunits — far below anything visible at this scale, and
 * exactly representable, so encode and decode are inverse rather than nearly so.
 */
export const LINK_GRID = 13000 / (1 << 20);

export function quantise(v) {
  return Math.round(v / LINK_GRID) * LINK_GRID;
}

/** `x,y,z,heading` for the `cr=` key. Fixed width, so the round trip is exact. */
export function encodeCraft(pos, dir) {
  const q = (v) => Math.round(v / LINK_GRID);
  const a = Math.round(Math.atan2(dir.x, dir.z) * 4096);
  const e = Math.round(Math.asin(clamp(dir.y, -1, 1)) * 4096);
  return `${q(pos.x)},${q(pos.y)},${q(pos.z)},${a},${e}`;
}

/**
 * The inverse. Returns null rather than a partly-parsed craft — a URL with
 * four numbers in it is a typo or an older schema, and dropping the visitor at
 * a plausible-but-wrong place is worse than dropping them at the default one.
 */
export function decodeCraft(s) {
  if (typeof s !== 'string') return null;
  const p = s.split(',');
  if (p.length !== 5) return null;
  const n = p.map(Number);
  if (!n.every(Number.isFinite)) return null;
  const [x, y, z, a, e] = n;
  const az = a / 4096, el = clamp(e / 4096, -Math.PI / 2, Math.PI / 2);
  const ce = Math.cos(el);
  return {
    pos: { x: x * LINK_GRID, y: y * LINK_GRID, z: z * LINK_GRID },
    dir: { x: Math.sin(az) * ce, y: Math.sin(el), z: Math.cos(az) * ce },
  };
}
