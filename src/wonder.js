// "Somewhere wondrous" — what the button is actually promising.
//
// The button rolls a few dozen random worlds, scores them, and takes you to the
// winner. The scoring lived inline in `hud.js` and had a bug that is worth
// writing down, because it is not a typo — it is a scoring function that was
// right about every individual term and wrong about the sum.
//
// ---------------------------------------------------------------------------
// The bug: two bonuses that are the same bonus
//
// Giants scored `+1.0` for being a giant and `+3.2` for having rings. Both
// reasonable in isolation. But rings in this generator are very nearly a giant's
// exclusive property, so those are not two independent terms — they are one
// term counted twice, and a giant walked in at **4.2** before anything else was
// considered, against an ocean world's 1.6 and a lava world's 1.4.
//
// The jitter (`+0..1.8`) was not enough to overcome a 2.6-point head start, so
// the button landed on a gas giant nearly every time. Nobody wrote "prefer gas
// giants" anywhere; it is what the arithmetic said.
//
// ---------------------------------------------------------------------------
// The fix is not a reweighting, it is an eligibility rule
//
// A giant has no ground. Arriving at one drops you at a cloud deck, and a cloud
// deck is a *view* — you cannot walk on it, there is nothing to find, and the
// only verb left is to look. §4 says the verbs are **travel and look**, and a
// destination that supports only half of them is not what a button called
// "somewhere wondrous" is promising. The promise is a place you can *be*.
//
// So giants are ineligible outright rather than down-weighted. That is a
// stronger statement and it is the true one: the problem was never that giants
// scored too highly, it is that they should not have been in the draw. They are
// still reachable — from their own system, by choosing to go, which is the
// difference between a place you may visit and a place you get *sent*.
//
// Everything here is a pure function of a planet record, so `tools/verify.js`
// can assert what the button will do without a renderer and without rolling
// dice sixty-four times and hoping.

/** the ground you can stand on: terrestrial, ocean, ice, lava — not a giant */
export const walkable = (p) => (p?.typeId ?? 9) <= 4;

/**
 * How much of a place a world is, before the roll's jitter.
 *
 * Every term answers "what will you see when you get there", and each one is
 * worth roughly what it changes about the frame. Rings are still the single
 * best silhouette in the project and still score highest — but now only on the
 * worlds that can actually carry you, where they are rare enough to be a real
 * find rather than a foregone conclusion.
 */
export function wonderScore(p, starTemp = 5772) {
  if (!walkable(p)) return -Infinity;
  let sc = 0;
  if (p.hasRings) sc += 3.2;                    // the best silhouette there is
  if (p.inhabited) sc += 2.4;                   // lit windows at dusk
  if (p.moons >= 3) sc += 1.5;                  // a crowded sky
  else if (p.moons >= 1) sc += 0.6;
  if (p.typeId === 2) sc += 1.6;                // ocean
  if (p.typeId === 4) sc += 1.4;                // lava
  if (p.typeId === 3) sc += 0.8;                // ice
  // A star that is not the Sun, seen from close in, is the cheapest wonder
  // there is — an M dwarf's red daylight or an A-type's blue one.
  if (starTemp < 4200 || starTemp > 8000) {
    sc += 1.2 * Math.min(1, 1 / Math.max(p.a ?? 1, 0.2));
  }
  if ((p.e ?? 0) > 0.25) sc += 0.5;             // a visibly eccentric orbit
  return sc;
}

/**
 * Where the winner sends you.
 *
 * Always `pl` — the surface. There is no cloud-deck branch any more, because
 * there is nothing eligible that would need one, and leaving the branch in
 * would leave the bug one edit away from returning.
 */
export const wonderDestination = (g, s, i) => ({ g, s, pl: i });
