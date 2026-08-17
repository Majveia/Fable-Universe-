// What grows between the blades.
//
// `flora.js` renders one species: a dense sward. A real meadow is never one
// species, and a field of a single repeated silhouette is the loudest remaining
// "this is procedural" tell in any frame — which is the reference's own
// diagnosis of the same problem, and it is right.
//
// Method from `docs/reference/sakura-realm/src/world/scatter.js` (MIT, © 2026
// Leonxlnx). Per §10 the method ports and the file does not: that one scatters
// nineteen hand-authored tiles of English meadow across one world, and this has
// to furnish any biome on any of 10²⁸ from a seed.
//
// ---------------------------------------------------------------------------
// The one idea worth more than the other five
//
// **Every species gets its own density field.** Not one scatter with a species
// picked per instance — six independent fields, sampled at the same point, each
// with its own spatial scale, its own threshold, and its own opinion about
// moisture. What falls out is *drifts, colonies and stands* rather than an even
// sprinkle: seed-heads thin where the ground is damp, dock stands only where it
// is, and the reeds and the clover almost never meet.
//
// That is the whole difference between a field that looks scattered and one
// that looks grown, and it costs one noise lookup per species. Everything else
// in a scatter system — the cards, the atlas, the fade windows — is bookkeeping
// by comparison.
//
// The second idea, which is cheap and load-bearing: **a plant's silhouette
// lives in alpha, not in geometry.** A card is four vertices whatever it is a
// picture of, so a new species costs a tile rather than a mesh and a draw call.
// AEON generates its tiles the way it generates everything else (§2.1).
//
// ---------------------------------------------------------------------------
// What AEON adds
//
// The reference's six species are one climate. Here a species has **tolerances**
// — moisture, temperature, and how much light it needs — and a world's biome
// decides which of them can live in it at all. A hot dry world grows the
// stalks and none of the reeds; a cold wet one is the reverse; and a world too
// hostile for any of them gets bare ground, which is a real answer rather than
// a fallback.
//
// No THREE, no clock: placement is arithmetic, so `tools/verify.js` can measure
// whether the colonies are actually colonies.

import { RNG, hash } from './rng.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);
const smooth = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0 || 1e-6), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * A cheap value-noise field, seeded per species.
 *
 * Deliberately not the simplex in `terrain.js`: this decides where a clover
 * patch is, not where a coast is, and §2.7's parity requirement is about the
 * height field. A hash lattice is two orders cheaper and nobody can tell where
 * a patch of vetch stops.
 */
export function field(x, z, seed, scale) {
  const s = Math.max(scale, 1e-3);
  const fx = x / s, fz = z / s;
  const ix = Math.floor(fx), iz = Math.floor(fz);
  const tx = fx - ix, tz = fz - iz;
  const ux = tx * tx * (3 - 2 * tx), uz = tz * tz * (3 - 2 * tz);
  const at = (a, b) => ((hash(a | 0, b | 0, seed >>> 0) >>> 8) & 0xffff) / 0xffff;
  const a = at(ix, iz), b = at(ix + 1, iz), c = at(ix, iz + 1), d = at(ix + 1, iz + 1);
  return (a + (b - a) * ux) + ((c + (d - c) * ux) - (a + (b - a) * ux)) * uz;
}

/**
 * The plant community.
 *
 * `scale` is the size of a colony in metres — the single number that decides
 * whether a species reads as a drift or as a dusting. `thr` is how much of the
 * world it claims. `wet`/`warm`/`sun` are the tolerances, each a preferred
 * value in 0..1; a species thins as conditions move away from its preference,
 * which is what makes a biome select a community rather than a palette.
 */
export const SPECIES = [
  // low creeping cover, so the soil never reads as a bare floor
  { id: 'cover', rank: 5, scale: 14, thr: 0.38, wet: 0.55, warm: 0.5, sun: 0.4, h: 0.10, w: 0.26, n: 5.5 },
  // fine feathery tufts that break the hard edge of the sward
  { id: 'bent', rank: 4, scale: 22, thr: 0.46, wet: 0.45, warm: 0.5, sun: 0.6, h: 0.34, w: 0.20, n: 3.0 },
  // the only wide silhouette out there, which is why it does so much work
  { id: 'broad', rank: 3, scale: 31, thr: 0.62, wet: 0.70, warm: 0.55, sun: 0.35, h: 0.30, w: 0.44, n: 0.9 },
  // seed heads standing ABOVE the sward — what makes a field read as tall
  { id: 'stalk', rank: 2, scale: 26, thr: 0.56, wet: 0.28, warm: 0.6, sun: 0.85, h: 0.92, w: 0.09, n: 1.6 },
  // sparse flowers in muted colours. Never a primary; the field is quiet.
  { id: 'bloom', rank: 6, scale: 18, thr: 0.72, wet: 0.5, warm: 0.55, sun: 0.7, h: 0.26, w: 0.14, n: 0.5 },
  // tall plumed stands, damp hollows only
  { id: 'reed', rank: 1, scale: 38, thr: 0.70, wet: 0.92, warm: 0.5, sun: 0.5, h: 1.5, w: 0.16, n: 1.1 },
];

/**
 * How well a species tolerates a place, 0..1.
 *
 * A product rather than a sum, so one intolerable axis is enough to exclude it.
 * That is what stops every world growing all six and reading identically.
 */
export function tolerance(sp, { wet = 0.5, warm = 0.5, sun = 0.6, atmo = 1 } = {}) {
  // Air first, and it is a gate rather than a term.
  //
  // The graded tolerances are a niche model and they behave like one: an
  // airless sunlit rock came out *tolerable* to seed-head stalks at 0.034,
  // because it is dry and bright and those are two of the three things a stalk
  // wants. Which is true about the niche and absurd about the world. Nothing
  // photosynthesises in a vacuum, and AEON already knows every world's `atmo`,
  // so this is physics that was simply missing rather than a threshold to tune
  // around. A world with no air grows nothing, and that is an answer.
  if (!(num(atmo, 1) >= 0.05)) return 0;
  const f = (pref, actual, width) =>
    1 - smooth(0, 1, Math.abs(num(actual, 0.5) - pref) / width);
  return clamp(f(sp.wet, wet, 0.55) * f(sp.warm, warm, 0.7) * f(sp.sun, sun, 0.75), 0, 1);
}

/**
 * The density of one species at one point, 0..1.
 *
 * The species' own field, thresholded, times how well it tolerates the biome.
 * Two independent gates: *where it could grow* and *whether it grows here*.
 */
export function densityAt(sp, x, z, seed, biome) {
  const tol = tolerance(sp, biome);
  if (tol <= 0.001) return 0;
  const own = rawDensity(sp, x, z, seed) * tol;
  if (own <= 0) return 0;
  // --- competitive exclusion ------------------------------------------------
  //
  // Independent fields are not enough, and measuring said so: with tolerance
  // as the only interaction, reed and stalk co-occurred 144 times against 148
  // expected by chance. Exactly independent — which reads as two sprinkles
  // overlaid, not as a meadow. The separation I had was coming entirely from
  // the biome gate (a marsh simply excludes stalk), so within any biome where
  // two species *can* both live they were meeting at random.
  //
  // Real plants do not do that: where two species can both grow, the stronger
  // competitor takes the ground and the weaker one holds the gaps. One line of
  // ecology — a species is suppressed by whatever outranks it and is present —
  // and the fields stay independent, which is what keeps colonies the shape
  // their own noise made them rather than a Voronoi partition.
  let suppress = 1;
  for (const other of SPECIES) {
    if (other.rank >= sp.rank) continue;
    const o = rawDensity(other, x, z, seed) * tolerance(other, biome);
    if (o > 0) suppress *= 1 - COMPETITION * o;
  }
  return own * Math.max(suppress, 0);
}

/** the species' own field, before the biome and before its neighbours */
function rawDensity(sp, x, z, seed) {
  const f = field(x, z, hash(seed >>> 0, sp.id.charCodeAt(0) * 2654435761), sp.scale);
  // a colony has an edge, not a boundary
  return smooth(sp.thr, Math.min(sp.thr + 0.22, 1), f);
}

/**
 * How completely a dominant stand excludes what is under it.
 *
 * 1.0 would be a hard partition and reads as tiling; 0 is the independence this
 * was measured at. 0.78 leaves the weaker species a real presence in the gaps,
 * which is where a meadow's texture actually lives.
 */
const COMPETITION = 0.78;

/**
 * Furnish one chunk.
 *
 * Returns flat instance records — the call site turns them into cards. Budget
 * is §5's lever and is spent across species in proportion to what is actually
 * growing here, so a chunk in the middle of a reed bed spends it on reeds.
 */
export function scatterChunk({
  x0 = 0, z0 = 0, size = 32, seed = 1, biome = {}, budget = 260, groundAt = null,
} = {}) {
  const r = new RNG(hash(seed >>> 0, (x0 | 0) * 73856093 ^ (z0 | 0) * 19349663));
  const cap = clamp(budget | 0, 0, 20000);
  const out = [];
  // one pass to see what wants to live here, so the budget follows the ecology
  const want = SPECIES.map((sp) => {
    let acc = 0;
    for (let i = 0; i < 9; i++) {
      const sx = x0 + ((i % 3) + 0.5) * size / 3;
      const sz = z0 + (((i / 3) | 0) + 0.5) * size / 3;
      acc += densityAt(sp, sx, sz, seed, biome);
    }
    return (acc / 9) * sp.n;
  });
  const total = want.reduce((a, b) => a + b, 0);
  if (total <= 1e-6) return out;      // bare ground is a real answer

  for (let si = 0; si < SPECIES.length; si++) {
    const sp = SPECIES[si];
    const n = Math.round(cap * (want[si] / total));
    for (let i = 0; i < n && out.length < cap; i++) {
      const x = x0 + r.float(0, size), z = z0 + r.float(0, size);
      // rejection against the species' own field: this is what makes the drift
      // an actual drift rather than a uniform sprinkle wearing a mask
      if (r.float(0, 1) > densityAt(sp, x, z, seed, biome)) continue;
      const y = groundAt ? groundAt(x, z) : 0;
      if (y === null) continue;
      out.push({
        id: sp.id, species: si, x, y, z,
        h: sp.h * r.float(0.72, 1.34),
        w: sp.w * r.float(0.78, 1.25),
        yaw: r.float(0, Math.PI * 2),
        lean: r.float(-0.14, 0.14),
        tint: r.float(0, 1),
      });
    }
  }
  return out;
}

/** which species can live in this biome at all — for a HUD, and for a test */
export const communityOf = (biome) =>
  SPECIES.filter((sp) => tolerance(sp, biome) > 0.02).map((sp) => sp.id);
