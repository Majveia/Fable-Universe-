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
// Why the macro field, and not the one the surface actually builds
//
// `surface.js` composes its ground from a macro term, two fbm octaves, a
// landform contribution and a curvature term. The solver scores the macro term
// and the curvature only.
//
// That is deliberate and it is not an approximation of convenience:
// **composition is a macro-scale property.** A hero landmark, a valley
// cross-section and a ridge that exits frame are all features of hundreds of
// metres. The detail octaves have amplitudes of tens of metres over wavelengths
// of tens of metres — they change what the ground *is made of*, which is act 4,
// and they cannot move a ridge. Scoring them would cost a great deal and decide
// nothing.

import { planetHeight } from './terrain.js';

const DEG = Math.PI / 180;

/** §9.7: "Sun elevation at spawn forced into 8–18°." */
export const SUN_BAND = [8, 18];

/** metres per unit of the macro height field — surface.js's own `S_MACRO` */
export const S_MACRO = 320;

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
 * The local tangent frame at a site — `surface.js`'s own construction, so the
 * solver's x/z axes are the ones the ground will actually be built on.
 */
export function frameAt(dir) {
  const d = norm(dir);
  let e = cross([0, 1, 0], d);
  if (len(e) < 1e-6) e = cross([1, 0, 0], d);   // the poles need a second axis
  e = norm(e);
  return { dir: d, east: e, north: norm(cross(d, e)) };
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * The macro ground height in metres at local (x, z), including the curvature
 * term — `surface.js`'s formula with the detail octaves left out.
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

/**
 * Score one (site, heading, sun) triple against §9.7.
 *
 * Every term is in [0, 1] and named, so a frame that scores badly can be told
 * *which* constraint it missed — §8 asks for one sentence naming the region
 * that lost the point, and a scalar cannot answer that.
 */
export function scoreComposition(frame, pp, ocean, Rworld, heading, sunElevDeg, opts = {}) {
  const { eye = 1.68, fov = 52, far = 1400 } = opts;
  const ch = Math.cos(heading), sh = Math.sin(heading);
  const H = (x, z) => macroHeight(frame, pp, ocean, Rworld, x, z);
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
  const lowHorizon = clamp01(1 - Math.abs(skyMean + 2 * DEG) / (9 * DEG));
  // off-centre: the tallest column away from the middle
  const peakCol = sky.indexOf(skyMax);
  const offCentre = clamp01(Math.abs(peakCol / (COLS - 1) - 0.5) / 0.32);

  // --- 2 · a hero landmark in the opening frustum -------------------------
  // A landmark is prominence, not height: how far it stands above the terrain
  // immediately around it. And it has to be far enough to read as a landmark
  // and near enough to have scale — §9.7 wants it legible against a human.
  let hero = 0, heroDist = 0;
  for (let c = 0; c < COLS; c++) {
    const a = (c / (COLS - 1) - 0.5) * 2 * halfFov;
    for (let d = 180; d <= far * 0.8; d += 60) {
      const fx = d * Math.cos(a), fz = d * Math.sin(a);
      const y = at(fx, fz);
      // prominence against a 200 m collar
      let ring = 0;
      for (let k = 0; k < 6; k++) {
        const t = (k / 6) * Math.PI * 2;
        ring += at(fx + 200 * Math.cos(t), fz + 200 * Math.sin(t));
      }
      const prom = y - ring / 6;
      const scale = clamp01(prom / 70) * clamp01((far - d) / far + 0.35);
      if (scale > hero) { hero = scale; heroDist = d; }
    }
  }

  // --- 3 · a leading line exiting frame -----------------------------------
  // A ridge or valley whose axis is *oblique* to the view runs out of the side
  // of the frame; one straight ahead runs to the vanishing point and leads the
  // eye nowhere. Measure the cross-frame gradient of the skyline: a strong,
  // consistent slope means a line crossing the view.
  let slope = 0;
  for (let c = 1; c < COLS; c++) slope += sky[c] - sky[c - 1];
  const lead = clamp01(Math.abs(slope) / (7 * DEG));

  // --- 4 · a valley cross-section framing the view ------------------------
  // The reference's own reason for its viewpoint. Ground rising on both flanks
  // and falling away ahead: the frame has walls.
  const leftFlank = at(320, -260), rightFlank = at(320, 260), ahead = at(520, 0);
  const walls = clamp01((Math.min(leftFlank, rightFlank) - ahead) / 45);

  // --- 5 · the sun, and where it is relative to the view ------------------
  // §9.7 forces 8–18°. §9.2's rim — "the connective tissue of the whole image"
  // — only fires looking toward the sun, so a composition that puts the sun
  // behind the camera throws away the light model's best term.
  const inBand = sunElevDeg >= SUN_BAND[0] && sunElevDeg <= SUN_BAND[1];
  const band = inBand ? 1 : clamp01(1 - Math.min(
    Math.abs(sunElevDeg - SUN_BAND[0]), Math.abs(sunElevDeg - SUN_BAND[1])) / 10);

  const terms = { lowHorizon, offCentre, hero, lead, walls, band };
  const total = 2.2 * band + 1.6 * hero + 1.3 * lead + 1.1 * walls
    + 1.0 * lowHorizon + 0.7 * offCentre;
  return { total, terms, heroDist, skyMeanDeg: skyMean / DEG };
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
  const { sites = 600, shortlist = 6, headings = 8 } = opts;
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

  // The sun is a free variable with nothing to search: the band term is flat
  // inside 8–18° and no other term reads elevation, so every value in the band
  // scores identically. Take the middle — 13°, half a degree off the
  // reference's own 13.5°, and for the same reason.
  const sunElev = (SUN_BAND[0] + SUN_BAND[1]) / 2;

  let best = null;
  for (const c of cands.slice(0, shortlist)) {
    const frame = frameAt(c.dir);
    for (let hd = 0; hd < headings; hd++) {
      const heading = (hd / headings) * Math.PI * 2;
      const sc = scoreComposition(frame, pp, ocean, Rworld, heading, sunElev, opts);
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
