// The scene clock: one monotonic time, advanced by the frame loop.
//
// A `performance.now()` read inside an animation path ties that animation to
// the wall, which means the same URL renders a different frame on every visit
// — and §11 lists exactly that under determinism leaks. It is subtler than a
// stray `Math.random()` because nothing looks wrong: the beacon still pulses,
// the plume still breathes. It just never pulses the same way twice, so no two
// captures of one place can be diffed.
//
// Modules whose animation runs from a closure — a `update(night)` handed to a
// group, with no dt in reach — read this instead. Everything else should keep
// taking dt as an argument; this is not a general-purpose clock and it is not
// a substitute for one.
//
// Wall-clock reads that measure *elapsed real time* are a different thing and
// stay as they are: `city.js` budgets its incremental build against a real
// millisecond ceiling, and a frame budget that ignored the frame would not be
// a budget.

let t = 0;

/** advance the clock; the frame loop owns this call */
export function advance(dt) { t += dt; }

/** seconds since the clock was last reset */
export function now() { return t; }

/** back to zero — a fresh universe starts its animations at the beginning */
export function resetClock(v = 0) { t = v; }
