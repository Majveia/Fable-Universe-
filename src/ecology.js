// Ecology — how many animals a place holds, and why that number moves.
//
// This exists because `planetscale.js` was computing it from `Date.now()`.
//
// The idea was good: quantise the sphere into regions, give each a carrying
// capacity from the seed, persist a population in `localStorage`, and grow it
// logistically over the hours you were away. Come back tomorrow and the herd
// has changed. As a *feeling* that is exactly right.
//
// As an implementation it broke §2.3 twice over, and the second way is worse
// than the first:
//
//   · **The wall clock.** Same seed, same code, different universe depending on
//     what time you opened the link. §2.3 says "on every machine, forever" and
//     a herd that depends on when you looked is not that.
//
//   · **`localStorage` in the generation path.** §2.4 says every place is a
//     URL. A returning visitor saw a grown herd and a first-time visitor saw
//     the base one, from the same link, on the same day. The URL could not
//     carry the world because part of the world was on one person's disk. §4
//     permits `localStorage` for the *logbook* — a record of where you have
//     been — not for what is there when you arrive.
//
// The fix keeps the whole of the idea and none of the leak: growth runs on the
// world's own day counter, which is deterministic, already advanced by the
// frame loop, already seated from the approach geometry, and already bent by
// the time lever that drives the seasons. So the herd still changes while you
// watch — and now it changes *faster when you speed the clock*, which the wall
// clock could never do. Two people following one link at one day-count see one
// herd, which is the whole of §2.3 in a sentence.
//
// No THREE, no clock read, no storage: `tools/verify.js` runs all of it.

import { RNG, hash } from './rng.js';

/**
 * Intrinsic growth rate, per local day.
 *
 * 0.06/day is an e-folding time of about 17 local days. With `speedDays` at 12
 * that is a visible change over a minute or two of watching, and a saturated
 * region inside a season — which is the timescale the feature was reaching for
 * when it reached for the wall clock.
 */
export const ECO_RATE = 0.06;

/** how far apart the region centres are, in inverse radians of direction */
export const ECO_QUANT = 28;

/**
 * The region key for a unit direction on the sphere.
 *
 * Quantising the *direction* rather than a lat/long avoids the pole crowding
 * that a lat/long grid has, and it is what the original did — kept verbatim so
 * that a world's regions do not move under this change.
 */
export function regionKey(dir, seed = 0, q = ECO_QUANT) {
  return (hash(Math.round(dir.x * q), Math.round(dir.y * q), Math.round(dir.z * q),
    seed >>> 0) >>> 0).toString(36);
}

/**
 * Logistic growth, closed form.
 *
 * `n(t) = K / (1 + A·e^(−r t))` with `A = (K − n₀)/n₀`. Closed form rather than
 * stepped, because a stepped integration needs a previous state to step *from*
 * — which is the `localStorage` this file exists to delete. Evaluating the
 * curve instead makes the population a pure function of the day count, so it
 * needs no memory and cannot drift between two machines.
 */
export function logistic(n0, K, t, r = ECO_RATE) {
  if (!(K > 0) || !(n0 > 0)) return 0;
  const A = (K - n0) / n0;
  const e = Math.exp(-r * (Number.isFinite(t) ? t : 0));
  const n = K / (1 + A * e);
  return Math.min(Math.max(n, 0), K);
}

/**
 * What lives here, on this day.
 *
 * `dir` is a unit direction in planet frame, `seed` the world's, `days` the
 * world's own day counter. Returns integer counts, the region's vegetation
 * index, and the key — the same shape the call site already consumed.
 *
 * Each region carries its own seeded epoch offset so they do not all bloom in
 * lockstep: a continent where every valley fills on the same afternoon reads
 * as a switch being thrown rather than as an ecology.
 */
export function ecologyAt(dir, seed = 0, days = 0) {
  const key = regionKey(dir, seed);
  const rng = new RNG(parseInt(key, 36) >>> 0);
  const veg = 0.4 + 0.6 * rng.next();
  const Ks = 2 + veg * 7;             // striders — larger, fewer
  const Kk = 10 + veg * 30;           // skimmers — smaller, many
  const s0 = Ks * rng.float(0.35, 1);
  const k0 = Kk * rng.float(0.35, 1);
  // the region's own place in its cycle, in local days
  const epoch = rng.float(0, 400);
  const t = (Number.isFinite(days) ? days : 0) - epoch;
  return {
    striders: Math.max(Math.round(logistic(s0, Ks, t)), 0),
    skimmers: Math.max(Math.round(logistic(k0, Kk, t)), 0),
    veg,
    key,
  };
}
