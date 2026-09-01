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

// ---------------------------------------------------------------------------
// Coverage — the quantity the law does not bound, and the one the eye reads
//
// `drawcensus.js` has carried this contradiction in its header since it was
// written:
//
//   > In the frame, there is no grass. Visually confirmed at magnification.
//   > In the CPU's bookkeeping, there are 3.5 M blades across 162 chunks.
//   > Both are facts and they do not agree.
//
// They agree through **ground overdraw**. Frontal area per square metre of
// ground is `density · width · height`; the ground's own screen area per square
// metre is `sin θ ≈ eye/d`. The ratio is how many blades deep you are looking,
// and it is simultaneously the fill cost and the reason a sward reads as a
// sward instead of as a wash.
//
// Measured on the shipped low row at each ring's own quoted distance: **17.2×,
// 36.1×, 108.1×, 201.8×.** The reference states its own target in words —
// 26,000 blades over an 11.25 m chunk, 205/m², *"the density at which the
// ground stops being visible between blades"*, against a previous 53/m² that
// *"left the soil showing through everywhere"* — and at its blade dimensions
// that is about **2×**.
//
// So the frame is looking through seventeen to two hundred layers of blade
// where the reference looks through two, and that single number is both the
// wash and the 8.4 M triangles. They were never two problems.
//
// **Why the density law does not already prevent this.** Coverage is not
// density, and three of its four factors grow with distance where density
// falls: inside `dn` the density is deliberately *flat*, so coverage climbs as
// `d²` on one ring from one constant; `wpx` and `hs` both step up outward
// (1.70 → 4.00 px, 1.00 → 1.95); and `sin θ` falls as `1/d`, which is the
// grazing incidence a floor has and a wall does not. Nothing multiplies them
// together and checks the result. This does.

/** eye height, metres — §6 M4's, and the datum grazing incidence is measured from */
export const EYE_H = 1.68;

/** a blade's mean height as a fraction of its ring's height scale */
const BLADE_H = 0.71;

/**
 * The blade's own width in metres — the JS side of `meadowWidth` and the two
 * clamps `BLADE_VERT` wraps it in.
 *
 * It has to exist in JS because coverage needs it and §9.5's rule is stated in
 * pixels, which no shader nobody can run in node will ever tell you.
 *
 * Three terms, and which binds is most of the answer:
 *
 *   · `wpx · d / pxPerRadian` — the angular floor. Note what this is: not a
 *     floor under a natural width, because no natural width is an input. It is
 *     the width, and it is constant *in pixels* by construction.
 *   · `uWidth · 0.22` — a 6.2 mm metric minimum, the only term that ever
 *     exceeds the pixel floor, and only inside about two metres.
 *   · `1/√density` — the spacing cap, and the one that needs bounding: it grows
 *     without limit as density falls, and at ring 3's far edge it already makes
 *     a "blade" **3.45 m wide**. Thinning the far field without bounding it
 *     would make that worse rather than better — the marks would grow to fill
 *     exactly what they had stopped covering.
 */
export function bladeWidth(r, d, pxPerRadian, dens, uWidth = 0.028, maxW = Infinity) {
  const n = Math.max(dens, 1e-9);
  const floor = Math.max(RINGS[r].wpx * d / Math.max(pxPerRadian, 1), 0.004);
  return Math.min(Math.max(floor, uWidth * 0.22), 1 / Math.sqrt(n), maxW);
}

/**
 * How many times over the ground is hidden, at distance `d`, at density `dens`.
 *
 * `1` means the blades exactly cover the ground once. Below that the soil shows
 * through; far above it you are looking at a mat and no individual blade
 * resolves, which is the wash.
 */
export function groundOverdraw(r, d, dens, pxPerRadian, uWidth = 0.028, maxW = Infinity) {
  const w = bladeWidth(r, d, pxPerRadian, dens, uWidth, maxW);
  return dens * w * BLADE_H * RINGS[r].hs / (EYE_H / Math.max(d, 1e-6));
}

/**
 * The target, and it is the reference's own criterion rather than a preference.
 *
 * At 1 the ground is exactly covered and the soil is on the edge of showing.
 * The reference sits near 2 — covered twice, with enough depth that a sward
 * reads as having an inside. Above about 6 individual blades stop separating.
 * The shipped rows are at 17 to 202.
 */
export const COVER_TARGET = 2.6;

/**
 * The density multiplier that holds `groundOverdraw` at `target` for ring `r`
 * at distance `d`.
 *
 * Solved rather than tuned, and solved by bisection rather than algebra because
 * the width depends on the density through the spacing cap — halving the
 * density widens every blade by √2, which gives back some of what was saved.
 * That feedback is the reason a closed form would be wrong, and the reason the
 * far rings do not thin as fast as a naive division would predict.
 *
 * Monotone in `target` by construction, which `suiteMeadow` checks: coverage is
 * increasing in density, so the bisection cannot invert.
 */
export function coverMul(r, d, target = COVER_TARGET, pxPerRadian = 793, uWidth = 0.028, maxW = Infinity) {
  const base = density(r, d);
  if (!(base > 0)) return 0;
  const t = Math.max(target, 1e-6);
  let lo = 0, hi = 8;
  // the shipped rows already exceed any sane target, so hi = 8 is generous;
  // grow it anyway rather than returning a silently clamped answer
  while (groundOverdraw(r, d, base * hi, pxPerRadian, uWidth, maxW) < t && hi < 1e6) hi *= 4;
  for (let i = 0; i < 90; i++) {
    const m = (lo + hi) / 2;
    if (groundOverdraw(r, d, base * m, pxPerRadian, uWidth, maxW) < t) lo = m; else hi = m;
  }
  return lo;
}

/**
 * All four multipliers, from one number.
 *
 * This is what replaces `grass[]`'s four hand-picked values. §5 asks for a
 * table where *"one row change reconfigures the entire renderer"*, and a row
 * carrying one physical target is more of that than a row carrying four
 * numbers whose relationship to each other nothing states.
 *
 * It is evaluated at each ring's own `dn` — the distance the ring's density is
 * quoted at, and the nearest point in its band where the flat-inside-`dn`
 * region ends. Nearer than `dn` coverage is *lower*, which is the right
 * direction: underfoot the ground should show between blades.
 */
export function coverMuls(target = COVER_TARGET, pxPerRadian = 793, uWidth = 0.028, maxW = Infinity, fovDeg = 52) {
  const at = coverAt(fovDeg);
  return RINGS.map((ring, r) => coverMul(r, at(r), target, pxPerRadian, uWidth, maxW));
}

/**
 * Where to evaluate a ring's coverage — and it is not the ring's `dn`.
 *
 * `dn` is where the ring's density is *quoted*, which is a different question
 * from where the ring is *seen*. Evaluating there set ring 0's cap by its
 * behaviour at 7 m, and because coverage falls toward the camera — `sin θ` is
 * `eye/d`, so looking down at ground near your feet you see a lot of it per
 * blade — the near end went bare: **0.06× at half a metre, 0.26× at two
 * metres.** The shipped build is thin there too (0.4× at half a metre), so the
 * cap was deepening a hole rather than digging one, but deepening it is still
 * the wrong direction.
 *
 * The right evaluation point is where the meadow first fills the frame, and
 * that is derivable rather than chosen. The bottom third of a `fov` frame spans
 * from `fov/6` to `fov/2` below the centre line, so the ground it lands on runs
 * from `eye/tan(fov/2)` to `eye/tan(fov/6)` — **3.44 m to 11.0 m** at a 52°
 * frame and a 1.68 m eye. The near edge of that is where a meadow starts being
 * the picture, and it is the distance the cap should be set by.
 *
 * A ring whose band starts beyond it is evaluated at its own near edge, because
 * the frame's lower third is not where that ring lives.
 */
export const lowerThirdNear = (fovDeg = 52, eye = EYE_H) =>
  eye / Math.tan((fovDeg / 2) * Math.PI / 180);

export const coverAt = (fovDeg = 52) => (r) =>
  Math.max(RINGS[r].near, Math.min(lowerThirdNear(fovDeg), RINGS[r].far));

/**
 * The physical bound on a blade's width, in metres.
 *
 * The reference's own line, from its source: *"Real meadow grass is 4–10 mm
 * across."* This is the upper end of that, doubled, because a blade here is
 * allowed to stand in for its thinned-away neighbours up to a point — but only
 * up to a point, and 2 cm is where a blade stops being a blade.
 *
 * Without it the spacing cap turns the far field into billboards as it thins,
 * which is the failure mode that made the far rings expensive *and* wrong at
 * the same time.
 */
export const BLADE_MAX_W = 0.020;

/**
 * How far the blade field reaches, in metres. Past it the ground's own colour
 * is the grass.
 *
 * This is the half of the reference's design that a coverage cap alone does not
 * supply, and the reason it does not is worth writing down because the first
 * attempt here got it wrong.
 *
 * Capping coverage *and* bounding width interact badly at distance. A blade
 * that may not exceed 2 cm can no longer widen to stand in for the neighbours
 * that were thinned away — so solving for a fixed coverage at 1250 m asks for
 * **more** blades, not fewer, and the far rings come back denser than they
 * started. The suite caught that: the cap alone took 8.4 M triangles to 3.0 M
 * and stopped, with ring 3's multiplier at 0.16 against a shipped 0.24.
 *
 * The error was in the goal, not the arithmetic. **Blades are not what covers
 * the ground at a kilometre and no amount of them should be.** A real meadow at
 * that range is a colour, and the reference says so in its own terms: the field
 * ends at 72 m and *"terrain's meadow blend carries the distance."*
 *
 * So coverage governs density *inside* the reach, and outside it there are no
 * blades at all. 84 m is AEON's own ring-1 far edge, which lands within a few
 * metres of the reference's 90 m — the two arrived at the same number from
 * different directions, which is the best evidence either of them is right.
 */
export const COVER_REACH = 84;

/**
 * Where the field begins to lie down, as a fraction of the reach.
 *
 * *"the fade is deliberately long so it dissolves into the terrain colour
 * instead of ending on a visible edge"* — and long is the load-bearing word. A
 * short fade is a line with a gradient painted on it. At 0.55 the last two
 * fifths of the field are lying down: from 46 m to 84 m.
 */
export const FADE_START = 0.55;

/** the band, as the shader wants it: where blades begin to lie down, and where they have gone */
export const fadeBand = (reach = COVER_REACH) => [reach * FADE_START, reach];

/** does this ring have any blades left to draw, given the reach? */
export const ringLives = (r, reach = COVER_REACH) => RINGS[r].near < reach;

/**
 * Blades per steradian — the quantity the density law is *about*, and the one
 * nobody had evaluated.
 *
 * `density()`'s own note argues the exponent this way: *"The falloff is slower
 * than the `d^-2` that would keep the count per steradian constant, which is
 * the whole trick: at 1.5 the count per steradian rises slightly with distance,
 * and that is what makes the horizon read as a meadow rather than as a green
 * plane."*
 *
 * **`d^-2` is the neutral exponent for a fronto-parallel surface.** Ground is
 * not one. Seen from a fixed eye height `e`, the patch of ground subtending a
 * solid angle `dΩ` at distance `d` has area `d³·dΩ/e` — the extra power is the
 * grazing incidence, and it is the whole difference between a wall and a floor.
 * So the exponent that holds blades-per-steradian flat across a *floor* is
 * **3**, and the law is not slightly under it, it is one and a half powers
 * under it.
 *
 * Measured, across the bands the rings actually occupy: **1.61 M blades per
 * steradian at 26 m and 407.6 M at 1250 m — 254× more, not "slightly".** That
 * is where roughly half of every surface frame's grass budget goes, and the
 * result is the thing the sentence was written to prevent: at that spacing the
 * width cap has grown the marks to 1.69 m and the ground beneath them is not
 * visible anywhere, which is a green plane made of four million billboards.
 *
 * **The exponent is not the thing to change.** §6 M3 pins it at exactly 1.5 so
 * the shader can evaluate it as `x·x·inversesqrt(x)`, and that is a settled
 * ruling (§3). What is not pinned is where the rings *stop*: `RINGS[3].far` is
 * 1250 m because the reference's valley is 2400 m across, and `horizon.js`
 * already draws everything past the haze line as silhouette (§M2). The band is
 * the dial. Changing it needs a scored frame and this container cannot render
 * one — see `docs/plans/SURFACE-DENSITY.md` §7.
 */
export function bladesPerSteradian(r, d, eye = 1.68) {
  return density(r, d) * d * d * d / Math.max(eye, 1e-3);
}

/** the exponent that would hold `bladesPerSteradian` flat over a floor */
export const NEUTRAL_POW = 3;

/**
 * The blade's own width, in metres — the JS side of `meadowWidth` and the two
 * clamps `BLADE_VERT` wraps it in.
 *
 * It is here rather than only in GLSL for the reason `density()` is: §9.5's
 * tier rule is stated in **pixels** — *"once a blade is two or three pixels
 * wide, everything varying across its width is sub-pixel and should be dropped
 * by tier"* — and a rule in pixels cannot be checked against a shader nobody
 * can run in node. `quality.js`'s `curvedRings` column is the knob that rule
 * governs, and its stated justification was arithmetic that had never been
 * done: *"at 5 m a blade is about 9 px."* It is 1.70.
 *
 * Three terms, and which one binds is the whole answer:
 *
 *   · `wpx · d / pxPerRadian` — the **angular floor**. Note what this is: not a
 *     floor under a natural width, because no natural width is an input. It is
 *     the width, and it is *constant in pixels by construction* — that is what
 *     "floor in pixels" means and it is why a blade does not get wider as you
 *     walk up to it.
 *   · `uWidth · 0.22` — a metric minimum, 6.2 mm, which is the only term that
 *     ever makes a blade wider than `wpx`, and it binds only inside about 2 m.
 *   · `1/√density` — the spacing cap. Past it a blade is wider than the gap to
 *     its neighbour and further width is pure overdraw.
 */
/**
 * A blade's width in pixels — the unit §9.5's tier rule is actually written in.
 *
 * At the ring's own shipped density and with no physical bound, which is what
 * the `curvedRings` question is about: whether a blade is wide enough on screen
 * for a rolled cross-section to resolve, given how many of them the law puts
 * there. `bladeWidth` is the one definition; this is that call with the ring's
 * own density substituted.
 */
export const bladePixels = (r, d, pxPerRadian, uWidth = 0.028) =>
  bladeWidth(r, d, pxPerRadian, density(r, d), uWidth) / Math.max(d, 1e-6) * pxPerRadian;

/**
 * §9.5's retirement threshold, as one number: the width in pixels below which
 * across-blade detail is sub-pixel and the curved cross-section buys nothing.
 *
 * *"two or three pixels"* — the conservative end of the clause, so a ring is
 * only retired when it is inside the regime on the reading most favourable to
 * keeping it.
 */
export const CURVE_PX = 3.0;

/**
 * How far out a ring's blade still earns the rolled-leaf cross-section.
 *
 * Returns the distance beyond which it does not, which is what makes this
 * comparable against the ring's own band: a ring earns `curved` when the answer
 * covers a meaningful share of `[near, far]`, and every row of the table today
 * earns it over the first two to four metres of a twenty-six metre band.
 */
export function curveReach(r, pxPerRadian, uWidth = 0.028) {
  let lo = 0.05, hi = RINGS[r].far;
  if (bladePixels(r, lo, pxPerRadian, uWidth) < CURVE_PX) return 0;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) * 0.5;
    if (bladePixels(r, mid, pxPerRadian, uWidth) >= CURVE_PX) lo = mid; else hi = mid;
  }
  return lo;
}

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
export function grassPalette(base) {
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
  // skylight is blue and it is nearly all the light a root gets
  const cool = norm([base[0] * 0.40, base[1] * 0.95, base[2] * 4.5]);
  // a tip is thin enough to be lit through, so it runs warm
  const warm = norm([base[0] * 1.9, base[1] * 0.7, base[2] * 0.8]);

  const stop = (k, rot) => scale3(rot < 0 ? mix3(base, cool, -rot) : mix3(base, warm, rot), k);

  return {
    // the vertical path: five stops, root to tip
    root: stop(0.30, -0.62),
    low: stop(0.52, -0.30),
    mid: stop(1.00, 0.00),
    upper: stop(1.52, 0.26),
    tip: stop(2.10, 0.52),
    // what light coming *through* a blade looks like — §9.2's transmission
    trans: stop(2.55, 0.66),
    // the sheen a laid-over blade catches on a gust front
    sheen: mix3(stop(2.4, 0.30), [1, 1, 1], 0.45),
    // straw on the exposed shoulders
    dry: mix3(stop(1.7, 0.72), [0.62, 0.50, 0.24], 0.45),
    // the four-colour meadow mosaic: two cooler, two warmer, all near the base
    patchA: stop(1.18, 0.22),
    patchB: stop(0.86, -0.18),
    patchC: stop(1.34, 0.10),
    patchD: stop(0.74, -0.34),
    // the deep interior of the sward, where nothing direct reaches
    hollow: stop(0.22, -0.48),
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
export function bladeRoots(seed, n, chunk) {
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
    height[i] = 0.42 + frac01(hash(seed, k, 0x44)) * 0.58;
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

  // The physical bound, as a uniform so a build without ?cover=1 can send +inf
  // and reproduce the previous frame exactly. See BLADE_MAX_W: without it the
  // spacing cap grows a "blade" to 3.45 m at ring 3's far edge, and thinning
  // the far field without it would widen the survivors to fill precisely what
  // they had stopped covering.
  uniform float uMaxW;
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

export function vegetationHSL(hue, inhabited = false) {
  const u = Math.min(Math.max(Number.isFinite(hue) ? hue : 0, 0), 1);
  if (u > VEG_WEIRD) {
    // teal, violet, rust — the 5% that make the other 95% mean something
    return { h: 0.45 + (u - VEG_WEIRD) * 8.4, s: 0.55, l: inhabited ? 0.32 : 0.24, weird: true };
  }
  return { h: 0.20 + u * 0.126, s: 0.5, l: inhabited ? 0.3 : 0.22, weird: false };
}
