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
export const MEADOW_GLSL = /* glsl */`
  uniform float uRingDn;      // this ring's quoted distance
  uniform float uChunkNear;   // the distance the CPU sized this chunk at
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
  bool meadowKeep(float d, float rand01) {
    float keep = meadowFalloff(d) / max(meadowFalloff(uChunkNear), 1e-9);
    return rand01 < min(keep, 1.0);
  }

  // the angular width floor: a blade never gets thinner than this many pixels,
  // which is what lets the far rings trade count for width one-for-one
  float meadowWidth(float d, float wpx, float pxPerRadian) {
    return max(wpx * d / max(pxPerRadian, 1.0), 0.004);
  }
`;
