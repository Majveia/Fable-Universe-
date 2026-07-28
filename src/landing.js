// The landing-site solver. CLAUDE.md §9.7, and §3's second ruling.
//
// §3 names this as *"the actual engineering problem the reference sets you.
// Everything else is transcription."* The reference is one hand-composed place:
// a valley cross-section chosen because it "makes the whole composition", hero
// landmarks the terrain is deformed to accommodate, a footpath routed to lead
// the eye out of frame-left, and a sun nailed at 13.5° elevation. None of that
// ports. What ports is the *constraint*: a solver has to guarantee procedurally
// what a person placed by hand.
//
// The previous site picker scored one thing — height above the waterline:
//
//     score = -|h - 0.018|·4 - (h < 0.004 ? 3 : 0) - (h > 0.35 ? 1.5 : 0)
//
// That guarantees you land near a shore. It says nothing about what you are
// looking at, which is why the first frame of a world is currently luck: the
// shadow pass landed correct and the opening view still read dark, because the
// camera happened to face the shaded side of a dune.
//
// ---------------------------------------------------------------------------
// A site is three numbers, not one
//
// Where you stand is only a third of a composition. The solver picks:
//
//   dir       where on the sphere
//   heading   which way you face
//   sunPhase  where the sun is when you arrive
//
// and scores the triple. Splitting them would let a perfect viewpoint face the
// wrong way, which is exactly the failure being fixed.
//
// ---------------------------------------------------------------------------
// It scores the ground a person will stand on, and the first version did not
//
// The first version scored the planet-scale macro field on the argument that
// "composition is a macro-scale property" and that surface.js's detail octaves
// "cannot move a ridge". That was backwards, and the suite measured it: the
// macro field varies by **2.7 m across the whole ±1400 m surface**. On a
// 6371 km world that patch subtends 0.00022 radians, and planet-scale noise has
// nothing to say across it. Every ridge a viewer can see comes from
// `fbm2(x·0.0011)` — a 900 m wavelength — and from the landform.
//
// So `hero`, `lead` and `walls` all read exactly zero, for the solved site and
// a random one alike. The solver was choosing a viewpoint by looking at a
// different planet.
//
// `src/ground.js` now holds the one definition of the walkable ground, and this
// scores that. Which is §2.7's rule — one definition, because two drift —
// arriving one level up from where it was written.

import { S_MACRO, frameAt, makeGround } from './ground.js';
import { planetHeight } from './terrain.js';

// Re-exported, not redefined. This file used to carry its own copy of the
// tangent-frame construction, and the two had already drifted: at the poles
// `ground.js` falls back to `[1,0,0]` and this one fell back to
// `cross([1,0,0], d)`, which are different axes. Nobody had noticed because no
// test lands on a pole. That is §2.7's failure mode exactly — one definition,
// because two drift — and the answer is the same one: delete the second.
export { S_MACRO, frameAt };

const DEG = Math.PI / 180;

/** §9.7: "Sun elevation at spawn forced into 8–18°." */
export const SUN_BAND = [8, 18];



// --- normalisation constants ------------------------------------------------
//
// Every term is a raw measurement — an angle, a prominence in metres — divided
// by the value at which it counts as satisfied. Those divisors are the only
// tuning in the file, so they live together where they can be argued with.
//
// All six were first chosen against the macro field, which turned out to vary
// by 2.7 m across the whole ±1400 m surface where the real ground varies by
// 333 m: a factor of 123. Calibrated against that, `hero`/`lead`/`walls` all
// read exactly zero and `lowHorizon` read exactly one, everywhere, for solved
// and random sites alike. Re-derived here from the measured distribution of
// each raw quantity over 288 random (site, heading) pairs across twelve worlds,
// with each divisor set near the p75 of its measurement — a term that is
// always 0 or always 1 is not a constraint, it is a constant.

/** the skyline elevation a low horizon sits at, and how far off that is tolerable */
export const HORIZON_DEG = 0.0, HORIZON_TOL_DEG = 9.0;
/** the rule-of-thirds offset from frame centre */
export const THIRD_OFF = 1 / 6;
/** prominence, in metres above a 200 m collar, at which a rise reads as a landmark */
export const PROM_M = 90;
/** net cross-frame rise, in degrees, at which the skyline reads as a line */
export const LEAD_DEG = 12;
/** how far the frame edges must stand above its middle, in degrees, to be walls */
export const WALL_DEG = 7;

/** seeded, and the same generator the old picker used, so seeds stay addresses */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The planet-scale term alone. Kept only so `tools/verify.js` can keep
 * measuring how flat it is underfoot — it is the reason this solver was wrong,
 * and a number that explains a mistake is worth keeping runnable.
 */
export function macroHeight(frame, pp, ocean, Rworld, x, z) {
  const { dir, east, north } = frame;
  const px = dir[0] * Rworld + east[0] * x + north[0] * z;
  const py = dir[1] * Rworld + east[1] * x + north[1] * z;
  const pz = dir[2] * Rworld + east[2] * x + north[2] * z;
  const l = Math.hypot(px, py, pz) || 1;
  const macro = planetHeight(px / l, py / l, pz / l, pp.noiseSeed) - ocean;
  return macro * S_MACRO - (x * x + z * z) / (2 * Rworld * 0.34);
}

/** per-ground height memo, shared across the headings scored at one site */
const CACHES = new WeakMap();

/**
 * Score one (site, heading, sun) triple against §9.7.
 *
 * Every term is in [0, 1] and named, so a frame that scores badly can be told
 * *which* constraint it missed — §8 asks for one sentence naming the region
 * that lost the point, and a scalar cannot answer that.
 */
export function scoreComposition(ground, heading, sunElevDeg, opts = {}) {
  const { eye = 1.68, fov = 52, far = 1400 } = opts;
  const ch = Math.cos(heading), sh = Math.sin(heading);
  // Memoised on a 20 m lattice: the skyline scan and the hero search revisit
  // the same ground repeatedly, and nothing this scorer asks about lives
  // between lattice points. 20 m is not arbitrary — the finest octave that
  // moves a skyline is `fbm2(x·0.0011)`'s fifth, a 53 m wavelength, so this is
  // the coarsest lattice that still resolves the terrain the terms measure.
  //
  // The cache is keyed on the *ground*, not on the call, because the solver
  // scores eight headings at every site and a rotated fan out of one origin
  // re-reads the same near-field lattice eight times. Held here rather than on
  // the ground object: `surface.js` builds vertices from the same `heightAt`
  // and quantising those to 20 m would be a catastrophe.
  let cache = CACHES.get(ground);
  if (!cache) { cache = new Map(); CACHES.set(ground, cache); }
  const H = (x, z) => {
    const key = ((Math.round(x / 20) & 0xffff) << 16) | (Math.round(z / 20) & 0xffff);
    let v = cache.get(key);
    if (v === undefined) { v = ground.heightAt(x, z); cache.set(key, v); }
    return v;
  };
  // local frame: +z forward along the heading, +x to the right
  const at = (fwd, side) => H(ch * side + sh * fwd, -sh * side + ch * fwd);

  const y0 = H(0, 0) + eye;
  const halfFov = (fov / 2) * DEG;

  // --- 1 · the horizon sits low, and nothing is centred -------------------
  // Sample the skyline across the frame: the elevation angle of the highest
  // thing along each column. §9.7 wants it low — ground in the lower third —
  // and §9.7's "nothing is centred" means the highest column is off-axis.
  const COLS = 21;
  const sky = new Array(COLS);
  for (let c = 0; c < COLS; c++) {
    const a = (c / (COLS - 1) - 0.5) * 2 * halfFov;
    let hi = -Math.PI / 2;
    for (let d = 30; d <= far; d += 30) {
      const y = at(d * Math.cos(a), d * Math.sin(a));
      hi = Math.max(hi, Math.atan2(y - y0, d));
    }
    sky[c] = hi;
  }
  const skyMax = Math.max(...sky), skyMean = sky.reduce((s, v) => s + v, 0) / COLS;
  // a low horizon: the mean skyline below the eye line, but not a flat plain
  const lowHorizon = clamp01(1 - Math.abs(skyMean / DEG - HORIZON_DEG) / HORIZON_TOL_DEG);

  // --- 2 · a hero landmark in the opening frustum -------------------------
  // A landmark is prominence, not height: how far it stands above the terrain
  // immediately around it. And it has to be far enough to read as a landmark
  // and near enough to have scale — §9.7 wants it legible against a human.
  //
  // Strided: every second column and every 90 m, because prominence against a
  // 200 m collar is a 200 m-scale quantity and sampling it every 1.3° and every
  // 60 m is measuring the same hill four times. This loop is 71% of the
  // scorer's ground evaluations and the stride pays for the whole solve.
  let hero = 0, heroDist = 0, heroProm = 0, heroCol = (COLS - 1) / 2;
  for (let c = 0; c < COLS; c += 2) {
    const a = (c / (COLS - 1) - 0.5) * 2 * halfFov;
    for (let d = 180; d <= far * 0.8; d += 90) {
      const fx = d * Math.cos(a), fz = d * Math.sin(a);
      const y = at(fx, fz);
      // prominence against a 200 m collar
      let ring = 0;
      for (let k = 0; k < 6; k++) {
        const t = (k / 6) * Math.PI * 2;
        ring += at(fx + 200 * Math.cos(t), fz + 200 * Math.sin(t));
      }
      const prom = y - ring / 6;
      const scale = clamp01(prom / PROM_M) * clamp01((far - d) / far + 0.35);
      if (scale > hero) { hero = scale; heroDist = d; heroProm = prom; heroCol = c; }
    }
  }

  // --- 2b · and it is not centred -----------------------------------------
  // §9.7's "nothing is centred" is about the *subject*, so it reads where the
  // hero landmark sits in frame — not, as the first version had it, where the
  // skyline maximum sits.
  //
  // Those are different objects, and scoring the skyline maximum put this term
  // in direct conflict with `lead`: a coherent cross-frame slope is a skyline
  // that rises steadily to one side, which places its maximum against a frame
  // edge *by construction*. The two terms could not both be satisfied, and the
  // solver — correctly, given the weights — spent `offCentre` to buy `lead`,
  // landing it at exactly 0.500 on all twelve worlds while chance scored 0.590.
  // Reading the landmark's column decouples them, and it is the more faithful
  // reading of the clause: the reference's footpath leads out of frame-left
  // *and* its hero landmark sits off-axis, because they are not the same thing.
  //
  // Asymmetric on purpose. A centred landmark is the fault §9.7 names, so it is
  // punished to zero; one against the frame edge is merely a weaker composition
  // than one on the third line, so it tapers to half rather than to nothing.
  const peakOff = Math.abs(heroCol / (COLS - 1) - 0.5);
  const offCentre = clamp01(peakOff / THIRD_OFF)
    * (1 - 0.5 * clamp01((peakOff - THIRD_OFF) / (0.5 - THIRD_OFF)));

  // --- 3 · a leading line exiting frame -----------------------------------
  // A ridge or valley whose axis is *oblique* to the view runs out of the side
  // of the frame; one straight ahead runs to the vanishing point and leads the
  // eye nowhere. Measure the cross-frame gradient of the skyline: a strong,
  // *consistent* slope means a line crossing the view.
  //
  // The first version summed the per-column differences, which telescopes —
  // `Σ (sky[c] − sky[c−1])` is just `sky[last] − sky[0]`, so it read two columns
  // out of twenty-one and called it a line. Against 2.65 m of macro relief that
  // was harmlessly small; against the real ground it saturated at 1.000 on
  // almost every frame, and a term that is always 1 carries no information while
  // still dominating an additive total. Magnitude times *coherence* — how much
  // of the total variation runs one way — distinguishes a ridge crossing the
  // frame from a jagged skyline with the same endpoints.
  let up = 0, dn = 0;
  for (let c = 1; c < COLS; c++) {
    const d = sky[c] - sky[c - 1];
    if (d > 0) up += d; else dn -= d;
  }
  const netRise = Math.abs(up - dn);
  const coherence = up + dn > 1e-9 ? netRise / (up + dn) : 0;
  const lead = clamp01(netRise / LEAD_DEG / DEG) * (0.25 + 0.75 * coherence);

  // --- 4 · a valley cross-section framing the view ------------------------
  // The reference's own reason for its viewpoint. Ground rising on both flanks
  // and falling away ahead: the frame has walls.
  //
  // The first version probed three points — `at(320, ±260)` against `at(520, 0)`
  // — and compared them in metres. Both halves were wrong. Three samples of a
  // field whose finest octave has a 110 m wavelength is mostly noise, and a
  // flank 45 m above the valley floor 400 m away subtends 6°, which is not a
  // wall; what frames a view is angular, not metric. Measured over 288 random
  // frames it read 0.000 on 70% of them and the solver could not find the term
  // at all.
  //
  // The skyline array already holds the answer. Read across it, the three terms
  // decompose cleanly: `lowHorizon` is its mean, `lead` its linear trend, and
  // `walls` its curvature — the edges of the frame standing above the middle.
  // Twenty-one samples instead of three, at no cost, and the three constraints
  // stop measuring overlapping things.
  const band4 = (a, b) => { let s = 0; for (let c = a; c <= b; c++) s += sky[c]; return s / (b - a + 1); };
  const edges = (band4(0, 3) + band4(COLS - 4, COLS - 1)) / 2;
  const middle = band4((COLS >> 1) - 2, (COLS >> 1) + 2);
  const wallRise = edges - middle;
  const walls = clamp01(wallRise / WALL_DEG / DEG);

  // --- 5 · the sun, and where it is relative to the view ------------------
  // §9.7 forces 8–18°. §9.2's rim — "the connective tissue of the whole image"
  // — only fires looking toward the sun, so a composition that puts the sun
  // behind the camera throws away the light model's best term.
  const inBand = sunElevDeg >= SUN_BAND[0] && sunElevDeg <= SUN_BAND[1];
  const band = inBand ? 1 : clamp01(1 - Math.min(
    Math.abs(sunElevDeg - SUN_BAND[0]), Math.abs(sunElevDeg - SUN_BAND[1])) / 10);

  const terms = { lowHorizon, offCentre, hero, lead, walls, band };
  const raw = {
    skyMeanDeg: skyMean / DEG,
    skyMaxDeg: skyMax / DEG,
    peakOff,
    promM: heroProm,
    netRiseDeg: netRise / DEG,
    coherence,
    wallDeg: wallRise / DEG,
  };
  return { total: aggregate(terms), terms, raw, heroDist, skyMeanDeg: skyMean / DEG };
}

/**
 * Combine the terms **conjunctively**, not additively.
 *
 * §8 gates a frame at *"≥4 every axis, ≥4.5 mean"* — a floor per axis and then
 * an average, in that order. A weighted sum cannot express that: it lets a
 * saturated term buy out a dead one, and it did. With the additive total the
 * solver found sites where `lead` pinned at 1.000 and paid for it with
 * `lowHorizon` and `walls` at zero — a frame with a spectacular diagonal and no
 * horizon and no walls, which is not what §9.7 asks for and scored *below
 * chance* on two of the six constraints it claims to optimise.
 *
 * A weighted geometric mean over a small floor is §8's rule as arithmetic: a
 * term near zero drags the whole product down no matter what the others do, so
 * the solver cannot trade a constraint away. The floor (`FLOOR`) keeps it from
 * being a hard veto — one genuinely unavailable feature on a flat ocean world
 * should cost a lot, not everything.
 */
const FLOOR = 0.06;
const WEIGHTS = { band: 2.2, hero: 1.6, lead: 1.3, walls: 1.1, lowHorizon: 1.0, offCentre: 0.7 };

export function aggregate(terms) {
  let acc = 0, wsum = 0;
  for (const k in WEIGHTS) {
    const w = WEIGHTS[k];
    acc += w * Math.log(FLOOR + (1 - FLOOR) * clamp01(terms[k]));
    wsum += w;
  }
  return Math.exp(acc / wsum);
}

const clamp01 = (x) => Math.min(Math.max(x, 0), 1);

/**
 * Pick where to stand, which way to face, and when to arrive.
 *
 * Deterministic: same planet and same seed give the same opening frame,
 * forever (§2.3). The candidate count is fixed rather than adaptive for the
 * same reason.
 */
export function solveLandingSite(pp, hashSeed, opts = {}) {
  const { sites = 600, shortlist = 10, headings = 8 } = opts;
  const rand = rng(hashSeed);
  const ocean = pp.oceanLevel > -0.5 ? pp.oceanLevel : 0.0;
  const Rworld = Math.max(pp.radiusE, 0.05) * 6.371e6;

  // Two stages, because the search is not affordable as one.
  //
  // Composition scoring costs about ten milliseconds; habitability costs one
  // noise sample. Scoring every (site, heading, sun) triple directly is
  // thousands of scores per world and takes half a minute — measured, 27
  // seconds for a single world. So: rank every site on the cheap term, then
  // compose only the shortlist. The cheap term is a hard gate anyway — a
  // beautifully framed view from the sea floor is not a candidate — so nothing
  // worth having is lost by applying it first.
  const cands = [];
  for (let i = 0; i < sites; i++) {
    const z = rand() * 2 - 1, th = rand() * Math.PI * 2;
    const q = Math.sqrt(1 - z * z);
    const dir = [q * Math.cos(th), z, q * Math.sin(th)];
    const h = planetHeight(dir[0], dir[1], dir[2], pp.noiseSeed) - ocean;
    const live = -Math.abs(h - 0.018) * 4 - (h < 0.004 ? 3 : 0) - (h > 0.35 ? 1.5 : 0);
    if (live < -1.2) continue;
    cands.push({ dir, live });
  }
  cands.sort((a, b) => b.live - a.live);

  // Take the shortlist as a *spread* across the passing candidates, not the top
  // few. Habitability is uncorrelated with composition — the best-scoring sites
  // are a narrow band of near-identical coastal shelf, and handing the second
  // stage six versions of the same place leaves it nothing to choose between.
  // Measured: the top-6 shortlist made `hero` 9% *worse* than chance, because a
  // hero landmark was not available at any of them.
  const pool = [];
  const span = Math.max(1, Math.floor(cands.length / Math.max(shortlist, 1)));
  for (let i = 0; i < cands.length && pool.length < shortlist; i += span) pool.push(cands[i]);

  // The sun is a free variable with nothing to search: the band term is flat
  // inside 8–18° and no other term reads elevation, so every value in the band
  // scores identically. Take the middle — 13°, half a degree off the
  // reference's own 13.5°, and for the same reason.
  const sunElev = (SUN_BAND[0] + SUN_BAND[1]) / 2;

  let best = null;
  for (const c of pool) {
    // the real ground at this site — the same function surface.js will build
    const ground = makeGround(pp, c.dir, opts);
    const frame = ground.frame;
    for (let hd = 0; hd < headings; hd++) {
      const heading = (hd / headings) * Math.PI * 2;
      const sc = scoreComposition(ground, heading, sunElev, opts);
      const total = sc.total + c.live * 0.55;
      if (!best || total > best.total) {
        best = { total, dir: c.dir, frame, heading, sunElev, live: c.live, ...sc };
      }
    }
  }

  // A world can be a featureless ocean planet, and then there is no composition
  // to find. Falling back is honest; pretending is not.
  if (!best) {
    const dir = [0, 1, 0];
    return { dir, frame: frameAt(dir), heading: 0, sunElev: 13.5, total: -Infinity,
      terms: null, fallback: true };
  }
  return best;
}
