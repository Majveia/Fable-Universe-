// Conjuring — the caller `craft.js` did not have.
//
// `craft.js` answers the only question that matters about leaving a world: how
// much velocity it costs, whether any chemical rocket can buy it, and how big
// the vehicle has to be. It is real physics and it was, until this file, dead
// code — nothing invoked it. §1's claim is a universe that is *computed*, and a
// computation nothing calls is a claim rather than a universe.
//
// This is the layer between that answer and the world: it turns a `craftFor()`
// result into a vehicle with parts and a place to stand, and it schedules the
// materialisation so that a craft arriving is something you watch rather than
// something that is suddenly there (§2.5 — no cuts, and a vehicle popping into
// existence is the most literal cut available).
//
// ---------------------------------------------------------------------------
// Why there is no THREE in here
//
// Same reason as `vehicle.js`, `avatar.js` and `craft.js`: the whole of it is
// arithmetic, so `tools/verify.js` runs it in Node with no browser and no GPU.
// What this file emits is a **parameterised mass model** — a list of part
// descriptors in metres — and the call site turns descriptors into meshes.
// §6 M6 already requires that of settlements ("parameterised mass models, no
// meshes on disk"); a spacecraft is the same problem with fewer walls.
//
// The practical consequence is that the shape of the vehicle is checkable. A
// hull that pokes through its own fairing, a stage stack that does not add up to
// the height the rocket equation asked for, an engine bell wider than the base
// it hangs from — all of those are assertions about numbers, and all of them are
// the kind of defect that a screenshot shows only from one angle.
//
// ---------------------------------------------------------------------------
// The shape is not styling
//
// Every proportion below is read off something physical, because a shape chosen
// for looks would make the vehicle decoration bolted to a physics model rather
// than an expression of it:
//
//   **stage count → tank segments.** `craft.js` picks the staging that maximises
//   what arrives. You can see how hard the world was to leave by counting.
//
//   **height and diameter → straight from `craftFor()`.** Earth returns 110 m,
//   which is a Saturn V, because that is what leaving Earth costs.
//
//   **fins → atmosphere.** Fins are aerodynamic surfaces and do nothing in
//   vacuum, so an airless world's craft has none. This is the clearest case in
//   the file of physics choosing art rather than the other way round, and it is
//   free: the term is already in `craftFor()`'s slenderness.
//
//   **engines → base area.** You can fit so many bells under a given diameter
//   and no more, which is why the F-1s on a Saturn V are five and not fifty.
//
//   **the craft that does not come.** When `craftFor()` returns
//   `feasible: false` there is no hull at all, and the reason is a real number
//   about a real world. Nothing editorialises; the vehicle simply does not
//   arrive.

import { RNG, hash } from './rng.js';
import { craftFor } from './craft.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/**
 * The materialisation's own clock, in seconds.
 *
 * `gather` is deliberately longer than `assemble`: the parts drifting in is the
 * part you look at, and the snap together is the payoff. Both are well under the
 * four seconds §3 gives the HUD before it fades, so a conjuring never outlasts
 * the interface element that announced it.
 */
export const CONJURE = {
  gather: 1.9,        // parts converge from a scattered shell
  assemble: 1.1,      // they seat, bottom-up
  settle: 0.6,        // the last shiver damps out
  spread: 0.55,       // how much of `gather` separates first part from last
  shell: 34,          // m — how far out the parts assemble from
  spin: 2.4,          // rad of tumble bled off during the approach
};

export const PHASES = ['idle', 'gather', 'assemble', 'settle', 'ready', 'refused'];

/** total wall-clock length of a successful conjuring */
export const CONJURE_TIME = CONJURE.gather + CONJURE.assemble + CONJURE.settle;

/**
 * The hull, as a parameterised mass model.
 *
 * Lengths are metres and the origin is the pad — `y` up, `z` along the axis the
 * craft will fly. Every part carries a `role` so the call site can pick a
 * material without pattern-matching on geometry, which is the thing that makes
 * a descriptor list survive someone changing the shape.
 */
export function hullOf(craft, world = {}, seed = 0) {
  if (!craft?.feasible) return [];
  const r = new RNG(hash(seed >>> 0, 0xc0117a));
  const H = craft.height, D = craft.diameter;
  const n = clamp(craft.stages | 0, 1, 5);
  const atmo = clamp(Number.isFinite(world.atmo) ? world.atmo : 1, 0, 2);
  const parts = [];

  // --- the stack ----------------------------------------------------------
  // Lower stages are bigger: each one lifts everything above it, so the mass —
  // and the tank — grows downward. The taper is the visible form of that, and
  // the fractions sum to one by construction rather than by a fudge factor, so
  // the stack is exactly `H` tall whatever the stage count.
  const CORE = 9;                       // craft.js's crew + engine core
  // The interstage rings come **out of** the tank length, not on top of it. The
  // first version added them afterwards, so an Earth stack closed at 114 m
  // against the 110 the rocket equation asked for — a vehicle 4% taller than
  // its own mass budget, which is exactly the class of error a descriptor list
  // exists to make checkable.
  const ringH = Math.min((H - CORE) * 0.06 / Math.max(n - 1, 1), 2.2);
  const rings = ringH * (n - 1);
  const tankLen = Math.max(H - CORE - rings, 1);
  const weights = [];
  for (let i = 0; i < n; i++) weights.push(Math.pow(1.9, n - 1 - i));
  const wSum = weights.reduce((a, b) => a + b, 0);

  let y = 0;
  for (let i = 0; i < n; i++) {
    const len = tankLen * (weights[i] / wSum);
    // diameter tapers with the same weighting, so a lower stage is visibly the
    // one carrying the others
    const dia = D * (0.72 + 0.28 * (weights[i] / weights[0]));
    parts.push({
      id: `stage${i}`, role: 'tank', kind: 'cylinder', stage: i,
      x: 0, y: y + len / 2, z: 0, radius: dia / 2, height: len,
      order: y / H,
    });
    y += len;
    if (i < n - 1) {
      const ring = ringH;
      parts.push({
        id: `inter${i}`, role: 'interstage', kind: 'cylinder', stage: i,
        x: 0, y: y + ring / 2, z: 0, radius: dia / 2 * 0.94, height: ring,
        order: y / H,
      });
      y += ring;
    }
  }

  // --- the core: crew and the engines that exist even with no propellant ----
  parts.push({
    id: 'capsule', role: 'capsule', kind: 'cone',
    x: 0, y: y + CORE / 2, z: 0, radius: D * 0.34, height: CORE,
    order: 1,
  });

  // --- engines: how many bells fit under the base, by actual packing --------
  // An engine bell is a **fixed physical size class** — an F-1 is 3.7 m across
  // and a world with a wider rocket does not get wider engines, it gets more of
  // them. The first version scaled the bell with `D` and then counted bells per
  // unit area, which cancels: every craft in the universe came back with
  // exactly six, from a 39 m dart to a 224 m super-earth stack.
  //
  // Counting *across* the base was the fix for that and is wrong in a quieter
  // way: engines pack in two dimensions, not along a line. The question "how
  // many circles of diameter d fit inside a circle of diameter D" has known
  // optimal answers, and using them rather than a ratio is what makes the count
  // an observation instead of an estimate. `PACK[n]` is the smallest D/d that
  // admits `n` — 2.701 for five, which is the centre-plus-four quincunx, and
  // 3.000 for both six and seven because the seventh goes in the middle for free.
  //
  // Earth's base is 11.0 m and an F-1 is 3.7, so D/d = 2.97: five fit and six
  // do not. That is a Saturn V, arrived at from a packing table and a diameter
  // that now matches the real vehicle to 0.9 m. The previous rule got five as
  // well, but from a 16.2 m base — the right answer for the wrong reason, which
  // is the kind of agreement that stops being true the moment anything moves.
  const BELL_CLASS = 3.7;               // m — an F-1, the large-engine size class
  const PACK = [0, 1.000, 2.000, 2.155, 2.414, 2.701, 3.000, 3.000, 3.304, 3.613];
  const ratio = D / BELL_CLASS;
  let engines = 1;
  for (let n = PACK.length - 1; n >= 1; n--) {
    if (ratio >= PACK[n]) { engines = n; break; }
  }
  // The clamp at nine is a statement about drawing, not about engineering: a
  // 224 m stack genuinely wants about thirty, which is an N1, and an N1 is both
  // a real vehicle and four consecutive failures. Laying out thirty bells needs
  // concentric rings this does not yet have.
  engines = clamp(engines, 1, PACK.length - 1);
  // The bell is the class size. It does not shrink to make room — that is the
  // whole content of "fixed physical size class", and the packing table is what
  // guarantees the room exists.
  const bell = Math.min(BELL_CLASS, D * 0.92);
  // seated so the outermost bell's rim is inside the base rather than proud of it
  const ring = engines > 1 ? Math.max((D - bell) * 0.5 * 0.86, bell * 0.55) : 0;
  // five or more puts one in the middle — a quincunx is what five circles in a
  // circle *is*, and it is what a Saturn V looks like from underneath
  const centre = engines >= 5 ? 1 : 0;
  for (let i = 0; i < engines; i++) {
    const onRing = i >= centre;
    const th = onRing ? ((i - centre) / (engines - centre)) * Math.PI * 2 : 0;
    const rr = onRing ? ring : 0;
    parts.push({
      id: `engine${i}`, role: 'engine', kind: 'cone', stage: 0,
      x: Math.cos(th) * rr, y: -bell * 0.45, z: Math.sin(th) * rr,
      radius: bell / 2, height: bell, flip: true,
      order: 0,
    });
  }

  // --- fins: aerodynamic surfaces, so vacuum gets none ---------------------
  // Not a style choice and not a threshold invented here — `atmo` is the same
  // number `craft.js` already spends drag Δv on. A world that charges you
  // nothing for drag is a world where a fin would be dead weight.
  const finN = atmo < 0.05 ? 0 : atmo < 0.4 ? 3 : 4;
  const finSpan = D * (0.55 + 0.75 * clamp(atmo, 0, 1));
  for (let i = 0; i < finN; i++) {
    const th = (i / finN) * Math.PI * 2 + r.float(0, 0.05);
    parts.push({
      id: `fin${i}`, role: 'fin', kind: 'fin',
      x: Math.cos(th) * D * 0.5, y: tankLen * 0.055, z: Math.sin(th) * D * 0.5,
      ry: th, span: finSpan, height: Math.min(tankLen * 0.11, 9),
      order: 0.02,
    });
  }

  // --- the materialisation's own scatter -----------------------------------
  // Each part gets a deterministic point on a shell to arrive from and a
  // deterministic tumble to bleed off. Seeded (§2.3), so the same world
  // conjures the same way every time anyone follows the link.
  for (const p of parts) {
    const th = r.float(0, Math.PI * 2), ph = Math.acos(r.float(-1, 1));
    const d = CONJURE.shell * r.float(0.6, 1.4);
    p.from = {
      x: Math.sin(ph) * Math.cos(th) * d,
      y: p.y + Math.cos(ph) * d * 0.45 + CONJURE.shell * 0.3,
      z: Math.sin(ph) * Math.sin(th) * d,
    };
    p.spin = { x: r.float(-1, 1) * CONJURE.spin, y: r.float(-1, 1) * CONJURE.spin, z: r.float(-1, 1) * CONJURE.spin };
    // bottom-up: a rocket is built from the pad, and watching it assemble in
    // any other order reads as a shuffle rather than a construction
    p.delay = clamp(p.order, 0, 1) * CONJURE.spread * CONJURE.gather;
  }
  return parts;
}

/**
 * Where a part is, `t` seconds into the conjuring.
 *
 * Returns a *pose offset*, not a position: `0` means seated. The call site adds
 * it to the part's own place in the stack, which is what lets the same
 * descriptor list be both the finished vehicle and the animation of it arriving.
 *
 * The easing is `1 − (1−u)³` — zero velocity at the seat. A part that arrives
 * still moving reads as a collision, and a hundred parts arriving still moving
 * reads as a crash.
 */
export function partAt(part, t) {
  const u0 = (t - (part.delay ?? 0)) / Math.max(CONJURE.gather, 1e-6);
  const u = clamp(u0, 0, 1);
  const e = 1 - Math.pow(1 - u, 3);
  const g = 1 - e;
  return {
    progress: u,
    // still out on the shell at u=0, seated at u=1
    dx: (part.from?.x ?? 0) * g,
    dy: ((part.from?.y ?? part.y) - part.y) * g,
    dz: (part.from?.z ?? 0) * g,
    rx: (part.spin?.x ?? 0) * g,
    ry: (part.spin?.y ?? 0) * g,
    rz: (part.spin?.z ?? 0) * g,
    // the seam glows as it closes and fades once seated — the only part of the
    // effect that is not a rigid-body motion, and the reason it reads as
    // conjuring rather than as a crate being assembled
    glow: Math.pow(Math.sin(Math.PI * u), 1.6),
    opacity: u <= 0 ? 0 : Math.min(1, u * 2.2),
  };
}

/**
 * Ask the world for a craft.
 *
 * The whole mechanic in one call: `craft.js` decides whether leaving is
 * possible and how big the vehicle is, this decides what it looks like and how
 * it arrives. When the world is one-way the hull is empty and `why` carries the
 * number — §8 axis 8, the interface never has to editorialise.
 */
export function conjureFor(world = {}, seed = 0, propellant = 'hydrolox') {
  const craft = craftFor(world, propellant);
  const hull = hullOf(craft, world, seed);
  return {
    craft, hull, seed: seed >>> 0,
    feasible: !!craft.feasible,
    why: craft.why,
    height: craft.feasible ? craft.height : 0,
    duration: CONJURE_TIME,
  };
}

/**
 * The state machine, for a call site that has a clock.
 *
 * Deliberately tiny and deliberately not a component: it holds a phase, a
 * timer and the conjuration, and everything that needs a renderer stays at the
 * call site. `update()` returns the phase so a caller can react to the edge
 * without keeping its own copy of the state.
 */
export class Conjuration {
  constructor(world = {}, seed = 0, propellant = 'hydrolox') {
    this.result = conjureFor(world, seed, propellant);
    this.phase = 'idle';
    this.t = 0;
  }

  get parts() { return this.result.hull; }
  get craft() { return this.result.craft; }

  /** begin. Returns false — and refuses — when the world cannot be left. */
  summon() {
    if (!this.result.feasible) { this.phase = 'refused'; this.t = 0; return false; }
    this.phase = 'gather';
    this.t = 0;
    return true;
  }

  dismiss() { this.phase = 'idle'; this.t = 0; }

  update(dt) {
    if (this.phase === 'idle' || this.phase === 'ready' || this.phase === 'refused') return this.phase;
    this.t += dt;
    const g = CONJURE.gather, a = g + CONJURE.assemble;
    this.phase = this.t < g ? 'gather' : this.t < a ? 'assemble'
      : this.t < CONJURE_TIME ? 'settle' : 'ready';
    return this.phase;
  }

  /** 0..1 across the whole materialisation, for anything that wants one number */
  get progress() {
    if (this.phase === 'ready') return 1;
    if (this.phase === 'idle' || this.phase === 'refused') return 0;
    return clamp(this.t / CONJURE_TIME, 0, 1);
  }

  /** every part's pose offset this frame */
  poses() {
    if (this.phase === 'idle' || this.phase === 'refused') return [];
    return this.result.hull.map((p) => partAt(p, this.t));
  }
}
