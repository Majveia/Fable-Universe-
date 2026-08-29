// The meadow's law — CLAUDE.md §9.5, §6 M3. Act 3.
//
// §9.5's doctrine in one line: *"density is one continuous law, rings only
// switch tessellation, and everything that moves samples one wind field."*
//
// This file is the first two clauses, and nothing else. No geometry, no three —
// the law is a mathematical object and it is the part `tools/verify.js` can
// hold to account, which matters because every failure mode §11 records about
// grass is a failure of the *law* rather than of the blades.
//
// ---------------------------------------------------------------------------
// One density, four tessellations
//
//     blades/m²(d) = B · min(1, (dn/d)^1.5)
//
// with `K = B · dn^1.5` held constant between rings, so there is no density
// step anywhere. The rings exist **only** to switch how many segments a blade
// is made of; crossing one changes the geometry and not the count.
//
// The exponent is 1.5 and not 1.45 or 1.7, for a reason beyond taste: at
// exactly 1.5 the shader evaluates `(dn/d)^1.5` as `x·x·inversesqrt(x)` —
// three single-cycle instructions against roughly ten for a general `pow()` —
// and it runs on something like twelve million vertices a frame.
//
// ---------------------------------------------------------------------------
// Two things the reference's own file gets wrong about itself
//
// **a · Its density comment is stale.** The prose block says the exponent is
// 1.45 and `K ≈ 17600`; the comment immediately below corrects to 1.5 with the
// `inversesqrt` argument, and `const DENS_POW = 1.5`. Ported from the prose you
// get a subtly denser far field and ten instructions where three would do.
//
// **b · Ring 3 breaks constant-K on purpose, and a parity test written against
// K would fail a correct port.** Computed from its own table:
//
//     ring 0   1100 /m² · 7^1.5    = 20372
//     ring 1    197 /m² · 22^1.5   = 20328
//     ring 2     31 /m² · 76^1.5   = 20538
//     ring 3    3.7 /m² · 260^1.5  = 15512      ← 24% low
//
// The reference says why: *"what actually has to stay constant is not the blade
// COUNT but the screen COVERAGE, and coverage is density × width × height."*
// Ring 3's stroke widens from 2.75 px to 4.00 px in exchange, so it draws a
// quarter fewer blades at a proportionally wider mark — cheaper, and at eight
// hundred metres more like a brush stroke and less like a hair.
//
// **That sentence is a rationale, not an identity, and the numbers say so.**
// Measured off its own table, ring 3 keeps 0.762 of ring 2's `K` and widens its
// stroke by 1.455 — so the trade lands 11% over, not on the nose. Including the
// height scale as the sentence suggests puts it 59% over. Neither is a bug:
// `wpx` is an angular *floor* that only binds past the distance where a blade
// falls under it, so no single product is conserved at a boundary. It is a
// hand-tuned table with a good reason behind it.
//
// This matters for anyone porting it, which is why it is written down here: a
// parity test asserting exact coverage continuity will fail on a correct port,
// and so will one asserting constant `K`. What is actually true, and what the
// suite therefore checks:
//
//   · `K` is continuous across rings 0 → 1 → 2, to better than 0.5%;
//   · ring 3 is 24% low, deliberately;
//   · `K · wpx` across that boundary lands within 15%, which is the trade being
//     approximately honoured rather than exactly.

import { hash } from './rng.js';

/** the exponent, and the reason it is exactly this: `x·x·inversesqrt(x)` */
export const DENS_POW = 1.5;

/**
 * Four overlapping rings, carrying blades from underfoot to the far ridge.
 *
 * `chunk` metres per chunk · `blades` per chunk at density 1.0 · `near`/`far`
 * the band this ring occupies, with soft overlaps · `dn` the distance its
 * density is quoted at · `wpx` the blade's angular width floor in pixels ·
 * `hs` a height scale · `seg` blade segments per quality row.
 *
 * The values are the reference's, and they are a measurement of what reads as
 * a meadow rather than a derivation. What AEON derives instead is the *chunk
 * grid* — see `chunkGrid()` and §11's un-grassed annuli.
 */
export const RINGS = [
  { chunk: 9, blades: 89000, near: 0, far: 26, dn: 7, wpx: 1.70, hs: 1.00 },
  { chunk: 30, blades: 177000, near: 22, far: 84, dn: 22, wpx: 2.00, hs: 1.08 },
  { chunk: 100, blades: 307000, near: 76, far: 290, dn: 76, wpx: 2.75, hs: 1.36 },
  { chunk: 250, blades: 231000, near: 260, far: 1250, dn: 260, wpx: 4.00, hs: 1.95 },
];

/** blades per square metre at the ring's own quoted distance */
export const ringB = (r) => RINGS[r].blades / (RINGS[r].chunk * RINGS[r].chunk);

/** the constant that holds across rings 0–2 and is broken on purpose at ring 3 */
export const ringK = (r) => ringB(r) * Math.pow(RINGS[r].dn, DENS_POW);

/**
 * The law. Blades per square metre at distance `d` for ring `r`.
 *
 * Flat inside `dn` — nearer than that a blade is already wider than a pixel and
 * adding more buys nothing — and falling as `d^-1.5` beyond it. The falloff is
 * *slower* than the `d^-2` that would keep the count per steradian constant,
 * which is the whole trick: at 1.5 the count per steradian rises slightly with
 * distance, and that is what makes the horizon read as a meadow rather than as
 * a green plane.
 */
export function density(r, d) {
  const ring = RINGS[r];
  return ringB(r) * Math.min(1, Math.pow(ring.dn / Math.max(d, 1e-6), DENS_POW));
}

/**
 * Screen coverage: density times the mark each blade makes. The quantity the
 * reference's ring-3 trade is *about* — approximately, not exactly; see the
 * note at the top of this file for the measured numbers.
 */
export function coverage(r, d) {
  return density(r, d) * RINGS[r].wpx * RINGS[r].hs;
}

/** the same trade without the height scale, which is what nearly balances */
export const widthCoverage = (r, d) => density(r, d) * RINGS[r].wpx;

/**
 * The chunk grid, derived from the ring's own far distance.
 *
 * §11 records this exact bug from the reference: *"hand-picked chunk grids too
 * small for the middle rings left a gap between every ring pair, which read as
 * 'dense grass only appears when you get closer.'"* A hand-picked grid is a
 * number that has to be re-checked every time a ring's band moves, and nobody
 * re-checks it. Deriving it means the gap cannot come back.
 *
 * The `+1` is not slack: the camera sits somewhere inside its own chunk, so
 * reaching `far` in the worst direction needs one chunk more than `far/chunk`.
 */
export function chunkGrid(r) {
  return Math.ceil(RINGS[r].far / RINGS[r].chunk) + 1;
}

/** how many chunks a ring draws — the draw-call count, which §5 budgets */
export const chunkCount = (r) => (2 * chunkGrid(r) + 1) ** 2;

/**
 * The nearest point of a chunk to the camera — where the CPU evaluates density.
 *
 * Deliberately the *nearest* corner, so the count is an over-draw: every blade
 * in the chunk is at least this far away, so the true density at every blade is
 * at most the density assumed here. That is what lets the shader's per-blade
 * test only ever *remove*, which is the property `keepProbability()` depends on
 * and the suite asserts.
 */
export function chunkNearDist(cx, cz, chunk, camX, camZ) {
  const x0 = cx * chunk, x1 = x0 + chunk;
  const z0 = cz * chunk, z1 = z0 + chunk;
  const dx = Math.max(x0 - camX, 0, camX - x1);
  const dz = Math.max(z0 - camZ, 0, camZ - z1);
  return Math.hypot(dx, dz);
}

/**
 * The coarse thinning: how many instances of a chunk's pre-shuffled buffer to
 * draw. The buffer is shuffled, so **any prefix is a fair spatial sample** —
 * and a thinned blade costs nothing at all, not even a vertex shader
 * invocation, which is why this is the thinning that actually saves the frame.
 */
export function chunkInstances(r, dNear, mul = 1) {
  const ring = RINGS[r];
  const area = ring.chunk * ring.chunk;
  const want = density(r, dNear) * area * mul;
  return Math.max(0, Math.min(ring.blades, Math.ceil(want)));
}

/**
 * The fine thinning: the probability a blade at true distance `d` survives,
 * given the CPU drew the chunk at density `density(r, dNear)`.
 *
 * Never above 1, because `d ≥ dNear` by construction and the law is
 * monotonically decreasing. That is not a clamp papering over a mistake — it is
 * the reason the over-draw is chosen from the nearest corner, and if it ever
 * exceeded 1 the shader would be being asked to invent blades it does not have.
 */
export function keepProbability(r, d, dNear) {
  const a = density(r, d), b = density(r, dNear);
  return b > 0 ? Math.min(a / b, 1) : 0;
}

/**
 * A deterministic shuffle — §2.3. `rng.js` owns entropy, but this module has to
 * stay three-free *and* import-light for the suite, so it takes the permutation
 * as a seeded Fisher–Yates over a small integer hash rather than pulling in the
 * RNG's state. Same seed, same meadow, forever.
 */
export function shuffledIndices(seed, n) {
  const idx = new Uint32Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  let s = (seed >>> 0) || 1;
  const next = () => {
    s ^= s << 13; s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    const t = idx[i]; idx[i] = idx[j]; idx[j] = t;
  }
  return idx;
}

// ---------------------------------------------------------------------------
// the colour of a blade — §9.5, act 5

const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lum3 = (c) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

/**
 * §9.5's blade palette, derived from the world's own vegetation colour.
 *
 * The reference gives nine greens as hex literals. §9.1 is explicit that per-
 * world palettes stay seed-derived and *"there is no default palette"* — so
 * what ports is the **shape** of that ramp, not its values, exactly as §9.6
 * ruled for the sky's four stops.
 *
 * The shape, read off the reference's own numbers: a blade runs from a dark,
 * blue-shifted, desaturated root to a bright, yellow-shifted tip. Its root
 * (`#2B564F`) is 0.30 of the mid-green's luminance and rotated toward teal; its
 * tip (`#C6D46B`) is 2.1× and rotated toward yellow. That is a luminance ramp
 * and a hue rotation, and both are things a base colour can be put through.
 *
 * Why teal at the root specifically, since it looks arbitrary: the base of a
 * sward is shadowed by everything above it and lit almost entirely by skylight,
 * which is blue. The root is not painted teal — it is painted *unlit*, and the
 * only light down there is the sky's.
 */
/**
 * The sky's spectrum, as a reflectance modulation, green-normalised.
 *
 * Rayleigh scatters as 1/lambda^4, so at the sRGB primaries' dominant
 * wavelengths (612 / 549 / 465 nm) skylight carries these relative
 * intensities. This is the *whole* justification for the cool pole in
 * `grassPalette()`: a root sees sky and almost nothing else, and what the eye
 * gets back is that light times the leaf's own reflectance. Multiplying a
 * green base by this cannot leave the green band -- the spread is 3x, and
 * chlorophyll's green:blue reflectance is wider than that.
 */
export const SKY_TINT = [
  Math.pow(549 / 612, 4),   // 0.6476
  1,
  Math.pow(549 / 465, 4),   // 1.9430
];

/**
 * The vertical ramp, as luminance multipliers and hue rotations.
 *
 * Measured off `docs/reference/sakura-realm/src/world/grass.js`, whose shipped
 * ramp is `uColBase #3a5630 -> uColTip #82a552 -> uColDry #b3ad6a`. Converted to
 * linear light and divided through, those are:
 *
 *     tip / base   4.356        dry / base   5.468
 *
 * against the 2.10 and 3.96 this file shipped. A blade ran less than half the
 * contrast of the reference's, and that — not the hue and not the count — is
 * most of why AEON's meadow read flat and dark beside the reference's.
 *
 * The stops here are not those ratios typed in. They are solved: a sweep over
 * `k` and `rot` minimising RGB distance from `grassPalette('#3a5630')` to the
 * reference's own `#82a552` and `#b3ad6a`. The luminance ratio alone lands the
 * brightness and misses the hue, because `warm` carries red at 1.9× and the
 * reference's tip is greener than that pole; the solve trades a little of the
 * ratio for the rotation and gets both. Residuals are 10/255 on the tip and
 * 8/255 on the dry, against a base colour that moves per world anyway.
 *
 * `LEGACY` is the ramp every capture in this repo before `?veg=1` was shot
 * with, kept so the A/B can be taken on one machine (§7.4).
 */
export const RAMP = {
  reference: {
    root: [0.30, -0.62], low: [0.60, -0.30], mid: [1.00, 0.00],
    upper: [2.05, 0.20], tip: [4.15, 0.32], trans: [4.90, 0.42],
    sheen: [4.50, 0.24], dry: [4.60, 0.69],
    patchA: [1.30, 0.22], patchB: [0.84, -0.18],
    patchC: [1.60, 0.10], patchD: [0.70, -0.34],
    hollow: [0.22, -0.48],
    pole: SKY_TINT,
  },
  legacy: {
    root: [0.30, -0.62], low: [0.52, -0.30], mid: [1.00, 0.00],
    upper: [1.52, 0.26], tip: [2.10, 0.52], trans: [2.55, 0.66],
    sheen: [2.40, 0.30], dry: [1.70, 0.72],
    patchA: [1.18, 0.22], patchB: [0.86, -0.18],
    patchC: [1.34, 0.10], patchD: [0.74, -0.34],
    hollow: [0.22, -0.48],
    // The pole belongs to the ramp, not to the function.
    //
    // `?veg=0`'s stated job is to restore the frame every capture before the
    // flag was shot with, so the A/B can be taken on one machine (§7.4). If the
    // cool pole moved under both ramps then the flag would no longer isolate
    // anything -- it would compare the old stops under a new pole against the
    // new stops under the same one, which is a different experiment. So the
    // teal pole stays here, attached to the frame it actually produced, and is
    // reachable only behind the flag that says "show me what it used to be".
    pole: [0.40, 0.95, 4.5],
  },
};

export function grassPalette(base, ramp = RAMP.legacy) {
  // Two poles to rotate between, each normalised to the base's own luminance so
  // that rotating hue never changes how bright the ramp is — the luminance ramp
  // is the other axis and they must not interfere.
  //
  // The coefficients are calibrated, and §9.6 is the precedent for that:
  // *"the stops above are that transfer's output for a G-type star at 13.5°.
  // That is the port: not the values, the function that produced them."* The
  // structure is the physics; the numbers are set so a temperate green
  // reproduces the reference's own nine hand-picked colours, and then carry to
  // any world's vegetation. `suiteMeadow` holds them to that.
  const L = Math.max(lum3(base), 1e-4);
  const norm = (c) => scale3(c, L / Math.max(lum3(c), 1e-4));
  // skylight is blue and it is nearly all the light a root gets — but it
  // reaches the eye having been *reflected off chlorophyll*, so the pole is
  // the base modulated by the sky's spectrum, at the ratio Rayleigh actually
  // gives (SKY_TINT). The coefficients here used to be 0.40 / 0.95 / 4.5, an
  // 11× spread inherited from hoshi-no-tani, whose grass really is teal —
  // its own root stop is #2B564F, 170°. Against 1/λ⁴'s 3× spread that was
  // manufacturing blue no leaf ever reflected, and it took the root to 175°
  // and the hollow to 164°: cyan, on every world, in the two stops that
  // `bladeColour()` builds both of its shade bands out of. Chosen reference
  // (`sakura-realm`) has no cool stop at all — its darkest grass colour is
  // `#3a5630` at 104° and its blue enters only as `albedo * skyColour`,
  // which cannot leave the green band because the albedo does not.
  const pole = ramp.pole ?? SKY_TINT;
  const cool = norm([base[0] * pole[0], base[1] * pole[1], base[2] * pole[2]]);
  // a tip is thin enough to be lit through, so it runs warm
  const warm = norm([base[0] * 1.9, base[1] * 0.7, base[2] * 0.8]);

  const stop = (k, rot) => scale3(rot < 0 ? mix3(base, cool, -rot) : mix3(base, warm, rot), k);
  const at = (name) => stop(ramp[name][0], ramp[name][1]);

  return {
    // the vertical path: five stops, root to tip
    root: at('root'),
    low: at('low'),
    mid: at('mid'),
    upper: at('upper'),
    tip: at('tip'),
    // what light coming *through* a blade looks like — §9.2's transmission
    trans: at('trans'),
    // the sheen a laid-over blade catches on a gust front
    sheen: mix3(at('sheen'), [1, 1, 1], 0.45),
    // straw on the exposed shoulders
    dry: mix3(at('dry'), [0.62, 0.50, 0.24], 0.45),
    // the four-colour meadow mosaic: two cooler, two warmer, all near the base
    patchA: at('patchA'),
    patchB: at('patchB'),
    patchC: at('patchC'),
    patchD: at('patchD'),
    // the deep interior of the sward, where nothing direct reaches
    hollow: at('hollow'),
  };
}

/** the order `MEADOW_COLOUR_GLSL` expects them in, so a caller cannot mis-pack */
export const PALETTE_KEYS = [
  'root', 'low', 'mid', 'upper', 'tip', 'trans', 'sheen', 'dry',
  'patchA', 'patchB', 'patchC', 'patchD', 'hollow',
];

/**
 * A chunk's blades: stratified, then shuffled. Both, and for different reasons.
 *
 * **Stratified** because uniform-random roots clump. At ring 0's 1100 blades/m²
 * a Poisson scatter leaves visible bald patches and visible clots, and the
 * ground between them is what the eye finds. One blade jittered inside each
 * cell of a `g × g` grid covers the chunk evenly at the same count.
 *
 * **Shuffled** because stratification correlates index with position — cell
 * `k` is at row `k/g`. Without a shuffle, drawing the first 30% of the buffer
 * would draw the first 30% of the *rows* and leave two-thirds of the chunk
 * bare. The shuffle is what makes any prefix a fair sample, and that is the
 * whole reason coarse thinning is free.
 *
 * Generating roots from `hash(seed, i)` instead would make the shuffle a no-op
 * — a hash already decorrelates index from position — which would be shipping
 * a line that looks load-bearing and is not.
 */
/**
 * How tall a stand of grass is, and what that does to everything else.
 *
 * The reference's own three modes, from
 * `docs/reference/sakura-realm/src/world/grass.js`, with its reasoning intact:
 *
 *   "A blade hides ground roughly in proportion to its own projected area, so
 *    halving the height halves the cover each blade gives; keeping the count
 *    constant would open the soil right up, which is exactly what a naive
 *    'short grass' setting looks like. Short modes therefore get many more,
 *    slightly wider blades — which is also what a real mown lawn is: a much
 *    denser stand of much smaller leaves."
 *
 * **What I first wrote here was wrong, and the frame said so.**
 *
 * The claim was that AEON shipped 0.42–1.00 m against the reference's
 * 0.42–1.48. It did not. `bladeRoots` returns a *base*, and `flora.js` then
 * multiplies it by the ring's `hs`, by a tussock term spanning 0.72–1.28, and
 * by a swale term. The blade that actually reaches the screen at ring 0 was
 *
 *     0.42 × 0.72 × 0.86  to  1.00 × 1.28 × 1.14   =   0.26 to 1.459 m
 *
 * — which is the reference's 1.48 already, at the top. Substituting the
 * reference's *final* range for AEON's *base* range multiplied it a second time
 * and produced 2.46 m blades, taller than the 1.68 m walker standing in them.
 * They spanned the frame as vertical streaks, which is what a capture showed
 * and no offline check could have.
 *
 * So the modes below are **final** heights, and `bladeRoots` divides by the
 * multipliers the shader is going to apply. The lawn-to-tall range survives,
 * driven by the drainage field; the scale error does not.
 *
 * `chunkScale` is deliberately **not** ported. The reference needs it because
 * its per-chunk instance count is capped and its near chunks already sit at the
 * cap, so shrinking the chunk is the only way to raise blades per square metre.
 * AEON's density is one continuous law (§9.5) with no such cap, and `RINGS`
 * already carries 1,099 blades/m² at ring 0 against the reference's ~167. The
 * dial exists here; it is `RINGS[r].blades`.
 */
export const SWARD_MODES = {
  lawn: { hMin: 0.060, hMax: 0.185, widthMul: 1.85, droopMul: 1.35 },
  meadow: { hMin: 0.190, hMax: 0.600, widthMul: 1.25, droopMul: 0.90 },
  tall: { hMin: 0.420, hMax: 1.480, widthMul: 1.00, droopMul: 1.00 },
};

/** the order they interpolate in, driest to wettest */
export const SWARD_ORDER = ['lawn', 'meadow', 'tall'];

/**
 * The most `flora.js` can multiply a base height by: the tussock term's 1.28
 * and the swale term's 1.16.
 *
 * It lives here because `SWARD_MODES` is stated as a *final* height and this is
 * what makes that true. If either term in the shader changes, this changes with
 * it — and `tools/verify.js` checks the two against each other rather than
 * trusting the comment, because that is exactly the coupling that produced a
 * 2.46 m blade.
 */
export const MULT_MAX = 1.28 * 1.16;

/**
 * The sward a piece of ground carries, as a continuous function of how wet it
 * is — `drainage.js`'s wetness index, 0 dry .. 1 saturated.
 *
 * Continuous rather than three settings, because ground is. A discrete mode
 * would draw a visible contour across the meadow at each boundary, which is the
 * §11 artefact ("un-grassed annuli") one axis over: a step in a field that has
 * no step in it.
 */
export function swardAt(wet) {
  const w = wet < 0 ? 0 : wet > 1 ? 1 : wet;
  const t = w * (SWARD_ORDER.length - 1);
  const i = Math.min(Math.floor(t), SWARD_ORDER.length - 2);
  const f = t - i;
  const a = SWARD_MODES[SWARD_ORDER[i]], b = SWARD_MODES[SWARD_ORDER[i + 1]];
  const lerp = (k) => a[k] + (b[k] - a[k]) * f;
  return { hMin: lerp('hMin'), hMax: lerp('hMax'), widthMul: lerp('widthMul'), droopMul: lerp('droopMul') };
}

export function bladeRoots(seed, n, chunk, sward = SWARD_MODES.tall) {
  const g = Math.ceil(Math.sqrt(n));
  const cell = chunk / g;
  const order = shuffledIndices(hash(seed, 0x91a5), n);
  const root = new Float32Array(n * 2);
  const rand = new Float32Array(n);
  const height = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = order[i];
    root[i * 2] = ((k % g) + frac01(hash(seed, k, 0x11))) * cell;
    root[i * 2 + 1] = (Math.floor(k / g) + frac01(hash(seed, k, 0x22))) * cell;
    rand[i] = frac01(hash(seed, k, 0x33));
    height[i] = (sward.hMin + frac01(hash(seed, k, 0x44)) * (sward.hMax - sward.hMin))
      / MULT_MAX;
  }
  return { root, rand, height, cells: g, cell };
}

/** a hash's top 24 bits as a float in [0,1) — enough for a root offset */
export const frac01 = (h) => (h >>> 8) / 16777216;

/** which ring owns a distance — the overlaps are soft, so this is the primary */
export function ringAt(d) {
  for (let r = 0; r < RINGS.length; r++) if (d <= RINGS[r].far) return r;
  return RINGS.length - 1;
}

// ---------------------------------------------------------------------------
// the law, as GLSL

/**
 * The per-blade test, in the vertex shader.
 *
 * `pow(x, 1.5)` is written as `x * x * inversesqrt(x)` deliberately and the
 * suite checks the two agree to float precision. It is three single-cycle
 * instructions against roughly ten, on twelve million vertices a frame, and it
 * is the only reason the exponent is 1.5 rather than something chosen purely
 * for how the far field looks.
 */
export const MEADOW_COLOUR_GLSL = /* glsl */`
  uniform vec3 uPal[${13}];   // grassPalette(), packed in PALETTE_KEYS order
  #define P_ROOT   uPal[0]
  #define P_LOW    uPal[1]
  #define P_MID    uPal[2]
  #define P_UPPER  uPal[3]
  #define P_TIP    uPal[4]
  #define P_TRANS  uPal[5]
  #define P_SHEEN  uPal[6]
  #define P_DRY    uPal[7]
  #define P_PATCHA uPal[8]
  #define P_PATCHB uPal[9]
  #define P_PATCHC uPal[10]
  #define P_PATCHD uPal[11]
  #define P_HOLLOW uPal[12]

  // Three ramps, not one. §9.2's paint() wants a shade, a mid and a lit stop
  // per surface, and a blade's three are genuinely different curves: the lit
  // face runs the full root-to-tip path, the mid stays nearer the base, and the
  // shade never leaves the cool end — which is §9.2's "shadows change hue, they
  // do not go black" expressed as a palette rather than as a clamp.
  struct Blade { vec3 shade; vec3 mid; vec3 lit; vec3 trans; float dry; };

  Blade bladeColour(float t, vec3 tint, float var) {
    Blade b;
    // the vertical hue path
    b.lit = mix(P_LOW, P_MID, smoothstep(0.00, 0.26, t));
    b.lit = mix(b.lit, P_UPPER, smoothstep(0.20, 0.66, t));
    b.lit = mix(b.lit, P_TIP, smoothstep(0.80, 1.00, t));
    b.mid = mix(P_ROOT, P_MID, smoothstep(0.05, 0.80, t));
    b.shade = mix(P_ROOT * 0.82, P_LOW, smoothstep(0.15, 0.95, t));

    // the meadow mosaic — four patch colours on two independent fields, so the
    // drifts read as different sizes of the same thing rather than as one
    // pattern at one scale
    b.lit = mix(b.lit, P_PATCHC, smoothstep(0.35, 0.85, tint.x) * 0.45);
    b.lit = mix(b.lit, P_PATCHA, smoothstep(0.65, 0.15, tint.x) * 0.35);
    b.mid = mix(b.mid, P_PATCHB, smoothstep(0.30, 0.80, tint.y) * 0.40);
    b.shade = mix(b.shade, P_HOLLOW, smoothstep(0.40, 0.90, tint.y) * 0.35);

    // straw on the exposed shoulders, and only up the blade — a dry patch is
    // dry at the tip first
    b.dry = smoothstep(0.68, 0.99, tint.z) * smoothstep(0.45, 0.98, t);
    b.lit = mix(b.lit, P_DRY, b.dry * 0.60);
    b.mid = mix(b.mid, P_DRY * 0.72, b.dry * 0.42);

    // no two blades in a meadow are the same green
    float vj = 0.84 + 0.34 * var;
    b.lit *= vj; b.mid *= vj * 0.98; b.shade *= 0.92 + 0.20 * var;
    b.lit = mix(b.lit, P_PATCHD, smoothstep(0.72, 1.0, var) * 0.30);

    b.trans = P_TRANS;
    return b;
  }

  // §9.5's tier rule, as a number: "once a blade is two or three pixels wide,
  // everything varying across its width is sub-pixel and should be dropped by
  // tier." Sub-pixel detail does not resolve — it sparkles, and a meadow that
  // sparkles reads as television static rather than as grass. Everything that
  // varies ACROSS a blade retires on this; everything that varies ALONG one
  // stays, because a blade is several pixels tall much further out than it is
  // pixels wide.
  float meadowNearK(float d) { return 1.0 - smoothstep(55.0, 240.0, d); }

  // And the same argument one step further out. At a few hundred metres full
  // contrast against the ground behind is what makes distant grass crawl as the
  // camera moves; converging toward the sward mean keeps the texture and takes
  // the edge energy out of it, which is what a painter does at that depth.
  vec3 meadowSettle(vec3 col, vec3 swardMean, float d) {
    return mix(col, mix(col, swardMean, 0.62), smoothstep(90.0, 430.0, d) * 0.42);
  }
`;

/**
 * §6 M3's last gate clause: *"the walker parts grass within 1.2 m."*
 *
 * The radius is the clause's own number, and it is not arbitrary — it is about
 * a stride plus a shoulder, which is the distance at which a person walking
 * through a meadow actually disturbs it. Anything much smaller reads as the
 * grass being afraid of your feet; much larger and you push a bow-wave.
 */
export const PART_RADIUS = 1.2;

export const MEADOW_PART_GLSL = /* glsl */`
  uniform vec4 uWalker;     // xyz position, w = the gait phase's push
  // The radius is a uniform rather than a constant because §6 M5 puts a second
  // thing through the grass. A walker parts it at 1.2 m — §6 M3's own figure —
  // and a hover skiff is the *same function* at its skirt's width. One shader,
  // two callers, and the alternative was a second parting function that would
  // have drifted from this one the first time either was touched.
  uniform float uPartR;

  // How far this blade is pushed aside, and which way.
  //
  // Two things make it read as being *walked through* rather than as a moving
  // circle of flattened grass. It falls off smoothly to nothing at the radius,
  // so there is no edge; and it is scaled by the gait phase, so a footfall
  // pushes harder than the swing between them. The reference's single gait
  // clock is what makes that free — the same phase drives the head bob, the
  // footstep audio and this, so they cannot drift apart.
  vec2 meadowPart(vec2 root, float tip) {
    vec2 away = root - uWalker.xz;
    float d = length(away);
    if (d > uPartR) return vec2(0.0);
    // vertical reach too: a blade is only parted if the walker is near its own
    // height, so grass on a bank above you is left alone
    float amount = (1.0 - smoothstep(0.0, uPartR, d)) * uWalker.w;
    // tips swing furthest, roots barely move — the same shape the wind uses,
    // because it is the same cantilever being bent
    return normalize(away + vec2(1e-5)) * amount * tip * tip;
  }
`;

export const MEADOW_GLSL = /* glsl */`
  uniform float uRingDn;      // this ring's quoted distance
  uniform float uDensityMul;  // the quality row's multiplier for this ring

  // (dn/d)^1.5 without a pow(): x*x*inversesqrt(x), three instructions
  float meadowFalloff(float d) {
    float x = uRingDn / max(d, 1e-6);
    x = min(x, 1.0);
    return x * x * inversesqrt(max(x, 1e-9));
  }

  // The blade survives if its own distance still wants it. The CPU sized the
  // chunk from its NEAREST corner, so this ratio is never above one and the
  // shader can only ever remove — it is never asked to invent a blade that was
  // not instanced.
  //
  // ---------------------------------------------------------------------------
  // chunkNear is an ARGUMENT, and it is the whole empty meadow.
  //
  // It was a uniform -- uChunkNear -- and nothing in src/ ever set it. An unset
  // uniform is 0, meadowFalloff(0) clamps x to 1 and returns 1, so the
  // denominator was the density at point-blank range on every chunk in the
  // universe. That turns a *relative* thinning -- remove the surplus this chunk
  // was over-drawn by -- into the absolute density law applied a second time, on
  // top of the CPU's. Every blade beyond a ring's own dn was thinned twice:
  // about 76% of ring 0 wrongly collapsed at 20 m, about 90% of ring 3 at its
  // far edge. Both facts in docs/captures/blind/SCORE.md were true -- 3.5 M
  // blades submitted, and a frame with no grass in it -- and this is where they
  // meet.
  //
  // The reason it was never set is recorded in src/flora.js's constructor and is
  // worth reading: two uniforms used to ride onBeforeRender, three only uploads
  // a material's uniforms when it thinks the material changed, and 411 of every
  // 412 writes were silently dropped. uChunkOrigin was moved into the model
  // matrix, which three sets on every draw. **uChunkNear was removed and never
  // given a replacement channel**, while this function went on dividing by it.
  // flora.js still computes the value every frame into mesh.userData.near,
  // where nothing reads it.
  //
  // So it cannot be a uniform: it varies per chunk and the material is shared
  // across a ring, which is exactly the condition that broke it the first time.
  // The caller derives it from the model matrix -- the channel that does work --
  // and hands it over. See BLADE_VERT in src/flora.js.
  bool meadowKeep(float d, float rand01, float chunkNear) {
    float keep = meadowFalloff(d) / max(meadowFalloff(chunkNear), 1e-9);
    return rand01 < min(keep, 1.0);
  }

  // the angular width floor: a blade never gets thinner than this many pixels,
  // which is what lets the far rings trade count for width one-for-one
  float meadowWidth(float d, float wpx, float pxPerRadian) {
    return max(wpx * d / max(pxPerRadian, 1.0), 0.004);
  }
`;

/**
 * A world's vegetation colour, as HSL — §9.1's "one base colour", decided in
 * one place so the grass you walk through and the green you saw from orbit are
 * the same green.
 *
 * It lives here rather than in `system.js` because it is a palette rule and
 * because `system.js` imports THREE, which would put it out of reach of
 * `tools/verify.js`. §3's weirdness budget is a *rule*, and a rule nothing
 * checks is a preference.
 *
 * The range this replaces was HSL 0.32–0.42 — 115° to 151°, so green at one end
 * and **spring-green/teal** at the other. On its own that is merely the cool
 * edge of plausible. What made it turquoise on screen is that it compounds:
 * `grassPalette()` rotates the root 62% toward a pole with the blue channel at
 * 4.5×, because the base of a sward is lit almost entirely by skylight. Applied
 * to a base that is already at 151°, that rotation lands the root, the hollow
 * and two of the four mosaic patches past cyan — and those are most of the mass
 * you see across a field. The teal belongs at the root; starting the base there
 * too is the same rotation applied twice.
 *
 * Real foliage runs 0.20 (sunlit yellow-green, 72°) through 0.30 (deep shade,
 * 108°), which is where the reference's own ramp sits — its tip `#C6D46B` is
 * 74°. The new range is 72°–117°.
 *
 * `hue` is one uniform draw in [0,1). The weirdness budget reads the **same**
 * draw rather than taking a new one, which matters for §2.3: an extra
 * `pr.next()` in the palette block would shift every subsequent draw for that
 * world and move its ocean level, its clouds and its ice caps along with its
 * grass.
 */
export const VEG_WEIRD = 0.95;        // top 5% of the draw — §3's budget

/**
 * The hue band real foliage occupies, as the **base** of a ramp: 85° to 117°.
 *
 * The first version of this was 72°–117°, chosen because the reference's tip
 * `#C6D46B` is 74°. That is the mistake this file already records at the other
 * end, mirrored: *"starting the base there too is the same rotation applied
 * twice."* A tip is 74° **after** the ramp has rotated it warm; a base that
 * starts there arrives past yellow. Measured — at 72° the `upper` stop comes
 * out `#79783c`, red-dominant, and at 79° `trans` still is.
 *
 * 85° is where every one of the fourteen stops stays green-dominant across the
 * whole draw and both inhabited states, which is what the suite holds. The
 * reference's base `#3a5630` is 104°, comfortably inside.
 */
export const CHLOROPHYLL = [0.2361, 0.326];

/**
 * **Grass is chlorophyll. There is no world where it is not.**
 *
 * This function used to branch: the top 5% of the hue draw returned teal,
 * violet or rust, because §3 sets a weirdness budget and says to enforce it
 * "in the seed→biome function". That is still the right place and it is still
 * enforced — but not *here*, because this is the lawn.
 *
 * The strangeness did not go anywhere. `exoticHSL()` below is the same draw,
 * the same 5%, the same three colours, and `foliage.js`, `tree.js`,
 * `ground-cover.js` and `strange.js` read it. So a strange world is now a
 * strange *wood* standing in green grass rather than a teal lawn, which is a
 * better reading of §3's own sentence — rarity is the mechanism by which
 * strangeness lands, and it lands harder against something ordinary.
 *
 * `s` and `l` moved with it, from 0.50/0.22 to the reference's own measured
 * 0.34/0.27. AEON's green was more saturated and darker than any real foliage,
 * which is the other half of why the meadow read as poster paint.
 */
export function vegetationHSL(hue, inhabited = false) {
  const u = Math.min(Math.max(Number.isFinite(hue) ? hue : 0, 0), 1);
  return {
    h: CHLOROPHYLL[0] + u * (CHLOROPHYLL[1] - CHLOROPHYLL[0]),
    s: 0.34,
    l: inhabited ? 0.32 : 0.26,
    // reported, not applied — the caller decides whether *it* is the thing
    // that gets to be strange on this world
    weird: u > VEG_WEIRD,
  };
}

/**
 * §3's weirdness budget, and where it went.
 *
 * The same draw and the same 5%. What reads this is whatever *stands in* the
 * grass — a wood, a thicket, ground cover, `strange.js`'s crystal growths —
 * rather than the grass itself. On the 95% it returns null, which is a caller
 * telling you plainly that this world is ordinary rather than a colour it has
 * to test.
 */
export function exoticHSL(hue, inhabited = false) {
  const u = Math.min(Math.max(Number.isFinite(hue) ? hue : 0, 0), 1);
  if (u <= VEG_WEIRD) return null;
  // teal, violet, rust — the 5% that make the other 95% mean something
  return { h: 0.45 + (u - VEG_WEIRD) * 8.4, s: 0.55, l: inhabited ? 0.32 : 0.24, weird: true };
}
