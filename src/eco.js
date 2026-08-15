// Regional populations — CLAUDE.md §2.3, §4, §8 axis 8.
//
// A herd is a number on screen. `life.js` reads `eco.striders` and draws that
// many animals, `planetscale.js` prints "regional fauna: 6 striders · 21
// skimmers" into the HUD, and both of those are claims the universe is making
// about itself.
//
// The previous version made them out of `Date.now()` and `localStorage`. It
// read the wall clock, grew the population by however many real hours had
// passed since your last visit, and wrote the result back to disk. It is a nice
// mechanic and it was a flat violation of three separate rules:
//
//   §2.3  same seed + same code = same universe on every machine, forever.
//         Two people opening the identical deep link saw different herds, and
//         so did the same person on two different afternoons. The URL stopped
//         being an address.
//   §4    persistence is the URL plus the logbook. An ecology database is
//         neither.
//   §8.8  the HUD asserted a count that nothing in the world could produce.
//
// It also quietly broke §7.3's pixel diff and §7.7's re-shoot, because a
// capture taken on Tuesday could not be differenced against one from Monday.
//
// ---------------------------------------------------------------------------
// What replaces it
//
// The same logistic curve, evaluated in closed form against **world time** —
// `clock.js`, which starts at zero with the universe and is advanced by the
// frame loop. Nothing is stored, nothing is read from the wall.
//
//     N(t) = K / (1 + ((K − N₀)/N₀)·e^(−t/τ))
//
// The initial condition N₀ is drawn from the region's own hash, so a valley
// that was sparse is sparse for everybody. The herd still grows while you stand
// and watch it, and it still differs region to region — the only thing lost is
// the ability for *your* machine to remember, which is precisely the part that
// was not allowed to exist.
//
// Nothing here imports three or reads a clock; `t` arrives as an argument, so
// all of it is under test.

import { RNG } from './rng.js';

/**
 * Growth e-folding time, in seconds of world time.
 *
 * Fifteen minutes is chosen against how long anyone stands in one place. A herd
 * that starts at 0.35·K reaches 0.59·K by t = τ and 0.79·K by 2τ — a curve you
 * can notice across a long stay without it reading as spawning. Faster and the
 * animals pop in; slower and the whole mechanic is invisible and may as well be
 * a constant.
 */
export const ECO_TAU = 900;

/**
 * Carrying capacity for a region of vegetation richness `veg` ∈ [0,1].
 *
 * The two species scale together because they share the same primary
 * production; the skimmers are smaller and there are more of them.
 */
export function capacityFor(veg) {
  return { striders: Math.round(2 + veg * 7), skimmers: Math.round(10 + veg * 30) };
}

/**
 * The logistic solution, closed form.
 *
 * Solved rather than stepped, because a stepped integration would need the
 * previous value — which is the state that had to go. The closed form is a pure
 * function of `(n0, K, t)`, which is what makes the herd addressable.
 */
export function logisticAt(n0, K, t, tau = ECO_TAU) {
  if (!(K > 0)) return 0;
  const N0 = Math.min(Math.max(n0, 1e-3), K);
  if (!(t > 0)) return N0;
  // clamped so a very long session cannot overflow the exponential; by 40τ the
  // curve is at capacity to well under a thousandth of an animal anyway
  const x = Math.exp(-Math.min(t / tau, 40));
  return K / (1 + ((K - N0) / N0) * x);
}

/**
 * Everything `life.js` and the HUD need for one region, from its hash and the
 * world clock.
 *
 * `h32` is the region's hash — `planetscale.js` quantises the surface normal
 * and hashes it with the planet seed, so neighbouring footsteps land in the
 * same region and a hop across a range does not.
 */
export function ecoAt(h32, t = 0) {
  const key = (h32 >>> 0).toString(36);
  const rng = new RNG(h32 >>> 0);
  const veg = 0.4 + 0.6 * rng.next();
  const K = capacityFor(veg);
  // the initial condition is the region's own history: some valleys were
  // already full when you arrived, some are recovering from something
  const f = rng.float(0.35, 1);
  return {
    striders: Math.round(logisticAt(K.striders * f, K.striders, t)),
    skimmers: Math.round(logisticAt(K.skimmers * f, K.skimmers, t)),
    veg,
    key,
  };
}
