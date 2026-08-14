// The rooms between — CLAUDE.md §2.3, §2.4, §3's weirdness budget.
//
// A Backrooms in a procedural universe is an easy thing to do badly. The lazy
// version is a themed level: yellow wallpaper, damp carpet, a trigger volume
// that teleports you into it. It would look right and it would be a lie about
// the project, because every other module in this repo earns its imagery from
// something real — `magnetosphere.js` gets its colours from emission-line
// lifetimes, `score.js` gets its pitch from the speed of sound, `night.js` gets
// its blue from the Purkinje shift. A hand-placed corridor would be the one
// room in the universe that was *decorated* rather than computed.
//
// So this file does not invent a place. It notices one that is already there.
//
// ---------------------------------------------------------------------------
// 1 · The universe is a hash, and a hash has a negative space
//
// Every star in AEON is `hash(galaxySeed, i, 0x57a9)`. That is a map from an
// index into a **32-bit address space** — four billion addresses, of which a
// galaxy populates a few thousand. The overwhelming majority of the space is
// not empty in the sense of being far away. It is empty in the sense of *not
// decoding to anything*: addresses the generator can express and never visits.
//
// The Backrooms, in this universe, is that. Not a level between worlds — the
// **interior of the address space**, which is a real structure with a real
// shape, and it has been sitting inside the seed function since the first
// commit. Nobody put it there. It is what is left when you take the worlds out.
//
// That is the whole thesis, and everything below is a consequence of it.
//
// ---------------------------------------------------------------------------
// 2 · Where reality is thin, and why it is rare without a threshold
//
// Two worlds are *neighbours in address space* when their star seeds agree in
// their high bits — however far apart they are in metres. A world with a very
// close address-neighbour sits near a fold in the map: two addresses the
// generator can barely tell apart.
//
// **Those are the thin worlds**, and the beautiful part is that their rarity is
// not a tuning constant. It is the birthday problem. With `N` stars drawn over
// `2^d` prefix buckets, the chance a given star shares its bucket with another
// is `1 − (1 − 2^−d)^(N−1) ≈ N/2^d`. §3 sets the weirdness budget at **≤5% of
// worlds**; `thinDepth()` below solves that equation for `d` instead of picking
// a threshold and hoping. Change the galaxy's star count and the depth moves on
// its own, and the budget stays 5%.
//
// This is the same discipline as `ascent.js`'s release altitude: the number
// exists, so find it rather than choose it.
//
// ---------------------------------------------------------------------------
// 3 · A room is an address, so a room is a URL (§2.4)
//
// §2.4 is not optional — *"Any feature creating a new kind of location extends
// the deep-link schema in main.js in the same commit."* It costs nothing here,
// because a room **is** an address: the shared prefix of the two worlds whose
// near-collision opened it, plus the depth at which they agree.
//
//     ?room=a3f0c000.19
//
// is a complete, shareable, permanent description of one room, on any machine,
// forever. There is no room table, no allocation, no id server. `roomShape()`
// is a pure function of those two numbers.
//
// ---------------------------------------------------------------------------
// 4 · Why every room feels the same and no two are alike
//
// This is the signature of the aesthetic and it is *free*, because it is the
// signature of a good hash.
//
// A hash has **avalanche**: flip one input bit and half the output bits change.
// Rooms whose addresses differ in a single low bit are therefore completely
// different in every dimension — and rooms at the same *depth* are drawn from
// identical distributions, so they share a ceiling height, a lamp pitch, a
// doorway width, a sense of proportion. Same statistics, uncorrelated draws.
//
// That is exactly what the Backrooms is: endless rooms that all feel like the
// same building and none of which you have seen before. It falls out of
// `hash()` having good avalanche. `suiteLiminal` measures the avalanche rather
// than trusting it, because if the hash were weak the aesthetic would quietly
// become "rooms that all look alike", which is a different and much worse thing.
//
// ---------------------------------------------------------------------------
// 5 · The light is mercury, and it is the aurora's own function
//
// The Backrooms' yellow is fluorescent light, and fluorescent light is not a
// colour anybody has to choose. It is a **mercury discharge**: four sharp lines
// at 404.7, 435.8, 546.1 and 578.2 nm, the last two carrying most of the
// visible power, plus a broad phosphor continuum that fills in the rest.
//
// The famous sickly yellow-green *is the 546.1 nm line and the 578.2 doublet.*
//
// So the lamp is computed the way the aurora is computed — line strengths
// through the CIE 1931 observer, via the very same `wavelengthRGB()` in
// `magnetosphere.js`. The corridor overhead and the auroral curtain are lit by
// one function. Nothing in this file picks a colour.
//
// The buzz is equally not a choice: a discharge lamp extinguishes and reignites
// **twice per mains cycle**, so it flickers at `2f`, and at 50 Hz supply that
// is the 100 Hz that gives fluorescent light its particular quality of making a
// room feel like it is holding its breath.
//
// ---------------------------------------------------------------------------
// 6 · And the doors go somewhere real
//
// This is the part that makes it a feature rather than a diorama.
//
// A room's doors are **the worlds that share its address prefix.** Walk through
// one and you are on a real, addressable, deep-linkable planet — one that may
// be ten thousand light years from where you noclipped in, because address
// proximity has nothing whatever to do with distance.
//
// So the rooms are not a side area. They are a **second metric on the
// universe**: a graph whose vertices are worlds, whose edges are hash
// collisions, and whose traversal is a genuine shortcut across 10²⁸ systems.
// §4 says the verbs are *travel* and *look*. This is travel, by the only route
// that could exist in a universe made of arithmetic.
//
// ---------------------------------------------------------------------------
// Nothing here imports three, reads a clock, or allocates a scene. It is the
// law; `main.js` and the scene that draws it are the consumers.

import { hash } from './rng.js';
import { wavelengthRGB } from './magnetosphere.js';

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

// ---------------------------------------------------------------------------
// the lamp

/**
 * The mercury discharge, as the lines it actually emits.
 *
 * Wavelengths in nm, relative radiant power. These are the four visible lines
 * of a low-pressure mercury lamp; the weights are the standard relative
 * intensities, normalised. `phosphor` is the broadband component the tube's
 * coating adds by down-converting the 254 nm ultraviolet — without it a
 * mercury lamp is a stark blue-green, and with it you get the familiar sickly
 * warmth. The ratio is what separates a "cool white" tube from a "daylight"
 * one, and it is the only number here with any latitude in it.
 */
export const MERCURY_LINES = [
  { nm: 404.7, w: 0.06 },   // violet
  { nm: 435.8, w: 0.19 },   // blue
  { nm: 546.1, w: 0.42 },   // green — the one everybody actually sees
  { nm: 578.2, w: 0.33 },   // yellow doublet, unresolved at this precision
];

/** how much of the tube's output is phosphor continuum rather than line */
export const PHOSPHOR = 0.55;
/** the phosphor's effective centroid, nm — a broad hump in the yellow-green */
export const PHOSPHOR_NM = 565;

/**
 * The lamp's colour, linear RGB, normalised to unit maximum.
 *
 * `age` is 0 for a fresh tube and 1 for one at end of life. An old tube loses
 * phosphor efficiency faster than it loses the mercury lines, so it drifts
 * *toward* the raw discharge — greener, colder, harsher. That is why the worst
 * corridor in any building is the one nobody has re-lamped, and it is one
 * parameter rather than a second palette.
 */
export function lampColour(age = 0) {
  const ph = PHOSPHOR * (1 - 0.55 * clamp(age, 0, 1));
  let r = 0, g = 0, b = 0;
  for (const l of MERCURY_LINES) {
    const c = wavelengthRGB(l.nm);
    const w = l.w * (1 - ph);
    r += c[0] * w; g += c[1] * w; b += c[2] * w;
  }
  const c = wavelengthRGB(PHOSPHOR_NM);
  r += c[0] * ph; g += c[1] * ph; b += c[2] * ph;
  const m = Math.max(r, g, b, 1e-6);
  return [r / m, g / m, b / m];
}

/** supply frequency, Hz. A discharge lamp fires twice per cycle. */
export const MAINS_HZ = 50;
/** so the flicker is 2f — the reason fluorescent light feels held-breath */
export const FLICKER_HZ = MAINS_HZ * 2;

/**
 * Lamp brightness at time `t`, 0..1.
 *
 * A rectified sine, because the discharge does not care which way the current
 * is going — it strikes on both half-cycles. `persistence` is the phosphor's
 * afterglow, which is what stops the room going fully dark a hundred times a
 * second: it fills the troughs and leaves a shallow ripple. A tube with dead
 * phosphor ripples much harder, which is the visible half of the same ageing
 * that turns the colour green.
 */
export function lampFlicker(t, persistence = 0.82) {
  const raw = Math.abs(Math.sin(Math.PI * FLICKER_HZ * t));
  return persistence + (1 - persistence) * raw;
}

// ---------------------------------------------------------------------------
// the address space

/** how many high bits two 32-bit addresses agree on, 0..32 */
export function sharedBits(a, b) {
  const x = ((a >>> 0) ^ (b >>> 0)) >>> 0;
  if (x === 0) return 32;
  return Math.clz32(x);
}

/**
 * The prefix depth at which about `budget` of worlds have an address-neighbour.
 *
 * §3 fixes the weirdness budget at 5% of worlds, and this is that constraint
 * solved rather than approximated. For `N` stars over `2^d` buckets the chance
 * a given star shares a bucket is `1 − (1 − 2^−d)^(N−1)`; invert it:
 *
 *     d = log2( (N − 1) / −ln(1 − budget) )
 *
 * Rounded up, because a deeper prefix is rarer and overshooting the budget is
 * the failure mode §3 actually cares about — *"rarity is the mechanism by which
 * strangeness lands."*
 */
export function thinDepth(starCount, budget = 0.05) {
  const n = Math.max(starCount - 1, 1);
  const p = clamp(budget, 1e-6, 0.9);
  return clamp(Math.ceil(Math.log2(n / -Math.log(1 - p))), 1, 31);
}

/** the star seed at index `i` of a galaxy — the generator's own addressing */
export const starAt = (galaxySeed, i) => hash(galaxySeed, i, 0x57a9) >>> 0;

/**
 * Find this world's nearest neighbour in address space, and how close it is.
 *
 * Linear over the galaxy's index range, which is what makes it honest: there is
 * no acceleration structure and no cached table, so the answer is a pure
 * function of the two seeds and cannot drift from what the generator would
 * actually produce. `scan` bounds it; the caller passes the galaxy's real star
 * count and gets the real answer.
 */
export function nearestAddress(galaxySeed, index, scan) {
  const me = starAt(galaxySeed, index);
  let best = -1, bestBits = -1;
  for (let i = 0; i < scan; i++) {
    if (i === index) continue;
    const b = sharedBits(me, starAt(galaxySeed, i));
    if (b > bestBits) { bestBits = b; best = i; }
  }
  return { seed: me, neighbour: best, neighbourSeed: best < 0 ? 0 : starAt(galaxySeed, best), bits: Math.max(bestBits, 0) };
}

/**
 * Is this world thin — does it sit on a fold in the address map?
 *
 * The whole answer, and the reason there is no threshold in it: a world is thin
 * when it has a neighbour at or past `thinDepth`, and `thinDepth` is whatever
 * makes that true of 5% of worlds.
 */
export function isThin(galaxySeed, index, starCount) {
  const d = thinDepth(starCount);
  const n = nearestAddress(galaxySeed, index, starCount);
  return { thin: n.bits >= d, depth: d, ...n };
}

// ---------------------------------------------------------------------------
// a room

/**
 * The room two near-colliding worlds open onto: their shared prefix, and how
 * deep the agreement runs.
 *
 * Symmetric by construction — either world opens onto the same room, which is
 * what makes the graph undirected and what makes a door you came in by a door
 * you can go back through.
 */
export function roomAddress(seedA, seedB) {
  const depth = sharedBits(seedA, seedB);
  // the shared prefix, with the disagreeing tail cleared
  const mask = depth >= 32 ? 0xffffffff : (~0 << (32 - depth)) >>> 0;
  return { prefix: ((seedA >>> 0) & mask) >>> 0, depth };
}

/** `a3f0c000.19` — §2.4's whole cost, and it is not a cost */
export const roomKey = (addr) => `${(addr.prefix >>> 0).toString(16).padStart(8, '0')}.${addr.depth}`;

/** and back, refusing anything that is not one */
export function parseRoomKey(s) {
  const m = /^([0-9a-f]{1,8})\.(\d{1,2})$/i.exec(String(s ?? '').trim());
  if (!m) return null;
  const depth = parseInt(m[2], 10);
  if (!(depth >= 0 && depth <= 32)) return null;
  const mask = depth >= 32 ? 0xffffffff : (~0 << (32 - depth)) >>> 0;
  return { prefix: (parseInt(m[1], 16) & mask) >>> 0, depth };
}

/**
 * The room itself, as numbers.
 *
 * Everything is drawn from `hash(prefix, depth, salt)`, so two things hold at
 * once and they are the two the aesthetic needs (§4 above): rooms at one depth
 * share their *distributions*, and rooms one bit apart share nothing else.
 *
 * The proportions are a real building's, not a fantasy's. Office ceilings run
 * 2.4–3.0 m, corridors 1.2–2.4 m wide, ceiling tiles are the 600 mm grid the
 * whole world uses, and fluorescent troffers sit on that grid at 1.2 or 2.4 m
 * pitch. A room that gets those wrong reads as a videogame corridor no matter
 * what is on the walls; a room that gets them right reads as a *place you have
 * been*, which is the entire emotional mechanism being borrowed here.
 */
export function roomShape(addr) {
  const h = (salt) => (hash(addr.prefix | 0, addr.depth | 0, salt) >>> 0) / 4294967296;
  const TILE = 0.6;                                   // the ceiling grid, metres
  // Deeper address, fewer worlds share it, smaller room. The depth is the one
  // input with meaning rather than entropy, so it is the one that sets scale.
  const roominess = clamp((32 - addr.depth) / 16, 0.25, 1.6);
  const w = TILE * Math.round((6 + h(0x11) * 26) * roominess);
  const d = TILE * Math.round((6 + h(0x12) * 26) * roominess);
  const ceil = 2.4 + Math.round(h(0x13) * 3) * 0.2;   // 2.4 to 3.0, on the grid
  return {
    width: w, depth: d, ceiling: ceil, tile: TILE,
    // troffers on the grid, never off it
    lampPitch: TILE * (h(0x14) < 0.5 ? 2 : 4),
    lampAge: h(0x15),
    // how far the walls are out of true. Real buildings are not square, and
    // the Backrooms' unease is mostly this: a room that is *almost* right.
    skew: (h(0x16) - 0.5) * 0.035,
    // carpet or vinyl — one bit, and it changes the sound more than the look
    carpet: h(0x17) < 0.62,
    // the damp. Not decoration: it is what the room does to the light, and it
    // is why the corners of a Backrooms image are always darker than the middle.
    damp: h(0x18) * 0.7,
  };
}

/**
 * The worlds this room's doors open onto.
 *
 * Every star sharing the room's prefix, in index order, so the same room always
 * presents the same doors in the same arrangement (§2.3). A room with one door
 * is a dead end and is allowed to be — the graph is not required to be
 * interesting everywhere, and a corridor that goes nowhere is load-bearing for
 * the feeling this is borrowing.
 */
export function roomDoors(galaxySeed, addr, scan, limit = 8) {
  const mask = addr.depth >= 32 ? 0xffffffff : (~0 << (32 - addr.depth)) >>> 0;
  const out = [];
  for (let i = 0; i < scan && out.length < limit; i++) {
    const s = starAt(galaxySeed, i);
    if (((s & mask) >>> 0) === (addr.prefix >>> 0)) out.push({ index: i, starSeed: s });
  }
  return out;
}

/**
 * The whole room, ready to build: shape, doors, and the light it is under.
 *
 * One call so a consumer cannot assemble half of it — the lamp age belongs to
 * the room, and a scene that drew the geometry from one address and the colour
 * from another would be subtly, unfixably wrong.
 */
export function room(galaxySeed, addr, scan) {
  const shape = roomShape(addr);
  return {
    addr, key: roomKey(addr), shape,
    doors: roomDoors(galaxySeed, addr, scan),
    lamp: lampColour(shape.lampAge),
    flickerHz: FLICKER_HZ,
  };
}
