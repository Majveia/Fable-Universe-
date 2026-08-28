// Trees that grew, rather than trees that were modelled.
//
// What this replaces is one line of `life.js`:
//
//     new THREE.CylinderGeometry(0.14, 0.3, 1, 5)   // trunk
//     new THREE.IcosahedronGeometry(1, 1)           // canopy
//
// — a five-sided stick with a faceted ball on top, instanced a hundred and
// thirty times. On a phone it reads as exactly what it is, and it is the worst
// object in any surface frame.
//
// The method here is ported from `docs/reference/sakura-realm/src/tree/
// branches.js` (MIT, © 2026 Leonxlnx), and per §10 what is ported is the
// *method*, not the file. That reference grows one specific old Prunus at the
// origin of one world; this has to grow any tree on any of 10²⁸, so every
// number it hardcodes has to become a function of a seed or of a world.
//
// ---------------------------------------------------------------------------
// The four laws, and why each one is worth more than a tuned curve
//
// **1 · The pipe model.** Wood is plumbing. Across a fork the cross-sectional
// area is conserved, so `Σ r_child^e = loss · r_parent^e` with `e ≈ 2.35`
// (Leonardo said 2; measured wood lands 2.2–2.6). Taper is then a *consequence*
// of how often a tree branches rather than a curve anyone chose, and a tree
// that branches rarely comes out thick-limbed for free.
//
// **2 · Allometry.** Length follows radius: `L = k·r^p`. One law, no per-level
// length constants — which is why a 25 cm limb comes out metres long and a 4 mm
// twig comes out centimetres, without either being written down.
//
// **3 · Beam curvature.** A limb droops because it is a cantilever:
// `κ = M/(E·I)` with `I ∝ r⁴`. A thick limb barely bends at its base and whips
// near its tip; a trunk does not bend at all. There is no droop parameter.
//
// **4 · A crown light envelope.** One tropism with a sign change: inside the
// envelope a shoot grows toward the surface, outside it there is nothing to
// hold and it arcs back. That single change of sign is what makes a dome out
// of what would otherwise be a spray.
//
// ---------------------------------------------------------------------------
// What AEON adds, and it is not decoration
//
// `M ∝ g`. Gravity is in law 3, and AEON is the project that has a different
// gravity for every world — so **tree form is a readout of the world you are
// standing on**, and it comes for free from a law that had to be there anyway:
//
//   · a 0.16 g moon bends a limb of the same radius six times less, so trees
//     go tall, thin and improbable, holding shapes that would snap here;
//   · a 2.4 g super-earth cannot hold a limb out at all, so the same species
//     comes out squat, thick and weeping.
//
// The reference could not express that with one world to grow in. It is the
// clearest case in this file of AEON's constraint being an advantage rather
// than a tax, and it is exactly §9.6's ruling — port the function, not its
// output — applied to wood.
//
// No THREE, no clock, no DOM: the whole skeleton is arithmetic, so
// `tools/verify.js` grows trees in Node and measures them.

import { RNG, hash } from './rng.js';

const G_EARTH = 9.80665;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);

/**
 * Wood, as a material. These are the four laws' constants and they are the only
 * numbers here that are not derived from a seed or a world.
 */
export const WOOD = {
  /** area-rule exponent — Leonardo's 2.0 is the idealisation, wood measures 2.2–2.6 */
  areaExp: 2.35,
  /** wood lost to the fork itself, so a tree is not a perfectly conserving pipe */
  forkLoss: 0.955,
  /** allometry `L = k·r^p`, metres. p is the crown's density: lower fills it in. */
  alloK: 21.0,
  alloP: 0.62,
  /** `κ = gravityK · g/g⊕ · load / r⁴`, per metre */
  gravityK: 5.4e-5,
  /** a branch deflects; it does not orbit */
  maxCurvature: 0.75,
  turnBudget: 3.4,
  /** below this radius a shoot is a twig and stops forking (metres) */
  tipRadius: 0.004,
};

/**
 * The archetypes. Not species — *habits*, which is the level at which a shape
 * generalises across a universe: how hard a tree reaches sideways, how much of
 * its wood it spends on a leader, how flat its crown is.
 *
 * Four of them because that is how many are distinguishable in silhouette at
 * a hundred metres, which is where §8 axis 1 asks the question.
 */
export const HABITS = [
  { id: 'spreading', spread: 0.90, leader: 0.34, flat: 0.72, forks: 3, climb: 0.55 },
  { id: 'columnar', spread: 0.30, leader: 0.72, flat: 0.30, forks: 2, climb: 0.95 },
  { id: 'weeping', spread: 0.80, leader: 0.28, flat: 0.55, forks: 3, climb: 0.12 },
  { id: 'umbrella', spread: 1.00, leader: 0.40, flat: 0.95, forks: 4, climb: 0.42 },
];

/**
 * Invert the allometry: what trunk radius produces a tree this tall?
 *
 * Called rather than tuned, because "how tall is this tree" is the thing a
 * caller actually knows (a biome has a canopy height) and "how thick is its
 * trunk" is the thing the pipe model needs. Solving one from the other is what
 * keeps a 4 m scrub and a 40 m giant on the same physics.
 */
export const radiusForHeight = (h, k = WOOD.alloK, p = WOOD.alloP) =>
  Math.pow(Math.max(h, 0.1) / Math.max(k, 1e-6), 1 / Math.max(p, 1e-6));

/** the allometry itself */
export const lengthOf = (r, k = WOOD.alloK, p = WOOD.alloP) =>
  k * Math.pow(Math.max(r, 1e-9), p);

/**
 * How much a shoot of radius `r` bends per metre, carrying `load` metres of
 * wood beyond it, on a world of gravity `g` (m/s²).
 *
 * `I ∝ r⁴` is the second moment of area of a round beam, and it is the whole
 * reason a trunk is straight and a twig is a curve: doubling the radius makes a
 * limb sixteen times stiffer while only quadrupling what it has to carry.
 */
export function curvature(r, load, g = G_EARTH) {
  const rr = Math.max(r, 1e-6);
  const k = WOOD.gravityK * (Math.max(g, 0) / G_EARTH) * Math.max(load, 0) / (rr * rr * rr * rr);
  return clamp(k, 0, WOOD.maxCurvature);
}

/**
 * Split a parent radius across `n` children by the area rule.
 *
 * `shares` are relative weights; the result conserves `Σ r^e = loss · r₀^e`
 * exactly, which is what makes taper emergent. A leader gets the largest share
 * and therefore stays thick; laterals come off thin and are short by law 2.
 */
export function forkRadii(r0, shares, e = WOOD.areaExp, loss = WOOD.forkLoss) {
  const tot = shares.reduce((a, b) => a + Math.max(b, 0), 0);
  if (!(tot > 0) || !(r0 > 0)) return shares.map(() => 0);
  const areaAvail = loss * Math.pow(r0, e);
  return shares.map((s) => Math.pow((Math.max(s, 0) / tot) * areaAvail, 1 / e));
}

/**
 * Grow one tree.
 *
 * Returns flat segment arrays — a parameterised mass model, the same shape
 * `conjure.js` emits for a rocket and for the same reason: the call site turns
 * numbers into meshes, and the numbers can be measured without a GPU.
 *
 * `world.gravity` is m/s². `budget` is §5's lever: a segment is a quad ring, so
 * the tier's row decides how much wood a tree may spend, and the tree spends it
 * on the thickest branches first because those are the silhouette.
 */
export function growTree({
  seed = 1, gravity = G_EARTH, height = 9, habit = null, budget = 900,
} = {}) {
  const r = new RNG(hash(seed >>> 0, 0x7bee));
  const H = clamp(num(height, 9), 0.6, 90);
  const g = clamp(num(gravity, G_EARTH), 0.01, 60);
  const cap = clamp(budget | 0, 24, 20000);
  const hab = habit ? (HABITS.find((h) => h.id === habit) ?? HABITS[0])
    : HABITS[r.int(0, HABITS.length - 1)];

  const r0 = radiusForHeight(H);
  // The crown envelope: an oblate dome whose widest band sits low, because that
  // is the surface at which a shoot stops being able to hold its leaves against
  // the light and the wind. `flat` is the habit's own oblateness.
  const crownY = H * (0.42 + 0.16 * hab.climb);
  const crownR = H * 0.46 * hab.spread;
  const crownUp = H * 0.62;
  const crownDn = H * 0.34 * hab.flat;

  const seg = { x0: [], y0: [], z0: [], x1: [], y1: [], z1: [], r0: [], r1: [], depth: [] };
  let count = 0;
  const push = (a, b, ra, rb, d) => {
    if (count >= cap) return false;
    seg.x0.push(a.x); seg.y0.push(a.y); seg.z0.push(a.z);
    seg.x1.push(b.x); seg.y1.push(b.y); seg.z1.push(b.z);
    seg.r0.push(ra); seg.r1.push(rb); seg.depth.push(d);
    count++;
    return true;
  };

  /** how far outside the crown surface a point is; negative inside */
  // Below the crown's centre, only the radial term counts.
  //
  // With a full ellipsoid, a shoot standing on the axis at ground level reads
  // as far *outside* the envelope — it is six metres under the centre — so the
  // escape penalty drove the bole back down and a columnar tree topped out at
  // 2.2 m against a 12 m target. That is wrong about trees as well as about the
  // maths: every tree has a bare bole under its crown, and a shoot climbing the
  // axis toward the canopy is not escaping it, it is on its way.
  //
  // So the vertical term only bites *above* the centre, where escaping is a
  // real thing a shoot can do. `crownDn` survives on the returned object,
  // because the call site wants the envelope's true extent for whatever it
  // hangs in it, but it no longer steers anything.
  const escape = (p) => {
    const dy = p.y - crownY;
    const radial = (p.x * p.x + p.z * p.z) / (crownR * crownR);
    const vert = dy > 0 ? (dy * dy) / (crownUp * crownUp) : 0;
    return Math.sqrt(Math.max(radial + vert, 0)) - 1;
  };

  // depth-first, thickest-first: the budget buys silhouette before it buys twigs
  const queue = [{
    p: { x: 0, y: 0, z: 0 },
    d: { x: 0, y: 1, z: 0 },
    r: r0, depth: 0, turned: 0,
  }];

  while (queue.length && count < cap) {
    // thickest pending shoot first — this is what makes a truncated budget look
    // like a smaller tree rather than a half-drawn one
    let bi = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i].r > queue[bi].r) bi = i;
    const sh = queue.splice(bi, 1)[0];

    const len = lengthOf(sh.r);
    const steps = clamp(Math.round(3 + 9 * (sh.r / r0)), 3, 14);
    const dl = len / steps;
    const p = { ...sh.p };
    const d = { ...sh.d };
    const rStart = sh.r;
    // A shoot tapers to a *fraction* of what it entered at, not to nothing.
    //
    // This is the reference's own defect #5, reproduced here on the first run
    // and worth keeping written down. Tapering `r → 0` across the shoot means
    // the radius at the fork test is always below `tipRadius`, so **no shoot
    // ever forks**: the tree came out as one bent stick of twelve segments
    // against a budget of nine hundred. The reference records the same failure
    // as "every leader in the tree ended in mid-air at a third of its base
    // diameter", which is the flat sawn-off disc on every limb in its renders.
    //
    // Real wood loses roughly a third of its radius between forks and then
    // *divides*; the pipe model takes it from there. 0.62 is that third, and it
    // is the number that turns a stick into a tree.
    const rEndOfShoot = rStart * 0.62;
    let rad = rStart;
    let turned = sh.turned;
    // wood beyond this point, for the beam load — the allometry again
    let load = len;

    for (let i = 0; i < steps; i++) {
      const rEnd = rStart + (rEndOfShoot - rStart) * ((i + 1) / steps);

      // --- law 3: the limb sags ------------------------------------------
      const k = curvature(rad, load, g);
      const bend = Math.min(k * dl, WOOD.turnBudget - turned);
      if (bend > 0) { d.y -= bend; turned += bend; }

      // --- law 4: one tropism, one sign change ---------------------------
      const e = escape(p);
      // Inside the envelope, grow toward its surface; outside, arc back in.
      // The sign of `e` does both, and it is what makes a dome of a spray.
      //
      // **Asymmetric, and not scaled by the habit.** Both corrections came from
      // measuring: with the pull scaled by `hab.spread`, a columnar tree got a
      // narrow envelope *and* almost no force holding it there, so it reached
      // 10.6 m — wider than the spreading habit — and all four archetypes came
      // out within 14% of one another in height-to-width. Unrecognisable in
      // silhouette, which is the one thing §8 axis 1 asks of them.
      //
      // Escaping is not the mirror of reaching. A shoot inside the crown is
      // choosing where to grow; a shoot outside it has nothing to hold its
      // leaves against and is being pulled back by its own failure to hold
      // them. The reference weights that asymmetry 50:1; 3.7:1 is enough here
      // because AEON's shoots are shorter. The habit now sets the *envelope*,
      // which is the only thing it should ever have set.
      const t = e < 0 ? -e * 0.30 : -e * 1.10;
      const rl = Math.hypot(p.x, p.z) || 1e-6;
      d.x += (p.x / rl) * t * 0.5 + (r.float(-1, 1)) * 0.05;
      d.z += (p.z / rl) * t * 0.5 + (r.float(-1, 1)) * 0.05;
      d.y += hab.climb * 0.08 * (e < 0 ? 1 : -1);

      const dn = Math.hypot(d.x, d.y, d.z) || 1;
      d.x /= dn; d.y /= dn; d.z /= dn;

      const q = { x: p.x + d.x * dl, y: p.y + d.y * dl, z: p.z + d.z * dl };
      // nothing grows into the ground
      if (q.y < 0.02) q.y = 0.02;
      if (!push(p, q, rad, rEnd, sh.depth)) break;
      p.x = q.x; p.y = q.y; p.z = q.z;
      rad = rEnd;
      load = Math.max(load - dl, 0);
    }

    // --- law 1: fork, and let the area rule decide the children -----------
    if (rad <= WOOD.tipRadius || sh.depth >= 7 || count >= cap) continue;
    const n = clamp(hab.forks + r.int(-1, 1), 2, 5);
    const shares = [hab.leader * 2.2];
    for (let i = 1; i < n; i++) shares.push(r.float(0.5, 1.0));
    const radii = forkRadii(rad, shares);

    for (let i = 0; i < n; i++) {
      if (radii[i] <= WOOD.tipRadius) continue;
      const az = r.float(0, Math.PI * 2) + (i / n) * Math.PI * 2;
      // a leader continues; laterals leave at a real angle
      const off = i === 0 ? 0.10 : r.float(0.5, 1.15) * hab.spread;
      const nd = {
        x: d.x + Math.cos(az) * off,
        y: d.y + (i === 0 ? 0.12 : -0.10 + hab.climb * 0.34),
        z: d.z + Math.sin(az) * off,
      };
      const nn = Math.hypot(nd.x, nd.y, nd.z) || 1;
      queue.push({
        p: { ...p }, d: { x: nd.x / nn, y: nd.y / nn, z: nd.z / nn },
        r: radii[i], depth: sh.depth + 1, turned,
      });
    }
  }

  return {
    habit: hab.id, height: H, trunkRadius: r0, gravity: g, segments: count,
    crown: { y: crownY, r: crownR, up: crownUp, down: crownDn },
    seg,
  };
}

/**
 * The tips, for whatever hangs on them — leaves, blossom, fruit, nothing.
 *
 * A separate call rather than a field on the tree, because the thing that hangs
 * is a per-world decision and the wood is not.
 */
export function tipsOf(tree, minRadius = 0.02) {
  const out = [];
  const s = tree.seg;
  for (let i = 0; i < s.r1.length; i++) {
    if (s.r1[i] <= minRadius) out.push({ x: s.x1[i], y: s.y1[i], z: s.z1[i], r: s.r1[i] });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The hero — §9.7's "one hero landmark in the opening frustum"
//
// §9.7 asks for *"at least one hero landmark in the opening frustum, with scale
// legible against a human-height reference."* Nothing in the pipeline ever
// promised one. `landing.js`'s `hero` term scores **terrain prominence** over a
// 200 m collar at 180–1000 m; on the world captured for `SURFACE-DENSITY.md` it
// returned 0.96, and it was not wrong. It had found a hill. A hill at 600 m is
// a landmark in the cartographer's sense and it is not a *subject* — you cannot
// tell how big it is, and §9.7's second clause is entirely about being able to.
//
// Four facts made a subject impossible rather than merely absent:
//
//   · every tree on a world is one uniform draw, so nothing may dominate;
//   · the near cluster is isotropic about the spawn, so the 81.9° frustum gets
//     its angular share by chance and is guaranteed nothing;
//   · the median radial distance is ~153 m, where a 9 m tree is 47 px tall;
//   · the flower cap is split equally across ~400 trees.
//
// This file owns the first and third: how tall a hero may be, and where it
// stands. `life.js` owns the wood and the flowers it is then given.
//
// It lives here rather than in `life.js` for the reason `quality.js` gives
// about `SAT_AMOUNT`: **`life.js` imports THREE, so `tools/verify.js` cannot
// import it in node.** A composition rule nothing can check is a preference.

/**
 * How tall the tallest tree on this world may stand.
 *
 * Greenhill's limit (1881): a column buckles under its own weight above
 * `h ∝ (E/ρg)^⅓ · r^⅔`. Everything in that expression except `g` is a property
 * of wood, which this file already treats as one material — so across worlds
 * the whole law collapses to **`h ∝ g^-⅓`**, and hero height becomes a readout
 * of the world you are standing on rather than a number somebody picked.
 *
 * It is the same argument `growTree`'s beam curvature already makes, one level
 * up: gravity was in law 3 as a *shape*, and here it is as a *size*. A 0.16 g
 * moon holds a tree 1.8× taller than Earth does; a 2.4 g super-earth holds it
 * to 0.75×. Neither was written down.
 *
 * `canopy` is the world's ordinary canopy height — what the population is drawn
 * from — and `HERO_OVER` is how far above it a hero stands. 2.2 is not a
 * physical constant: it is the ratio at which a tree stops being the tallest
 * member of a stand and starts being the thing the frame is about, and it is
 * the one number here that is art direction. The clamp is, though — no tree may
 * exceed `growTree`'s own 90 m ceiling, and none may be shorter than the
 * population it is supposed to dominate.
 */
export const HERO_OVER = 2.2;

export function heroHeight(canopy = 9, gravity = G_EARTH) {
  const c = clamp(num(canopy, 9), 0.6, 40);
  const g = clamp(num(gravity, G_EARTH), 0.01, 60);
  const h = c * HERO_OVER * Math.cbrt(G_EARTH / g);
  return clamp(h, c * 1.25, 90);
}

/**
 * Where the subject stands.
 *
 * Three constraints, and each one is a clause of §9.7 rather than a preference:
 *
 * **In the opening frustum.** The bearing is measured off the solved heading,
 * and the half-angle used is the camera's *vertical* fov/2 — deliberately
 * narrower than the 41° the 16:9 frustum actually spans. That is the same
 * convention `scoreComposition` samples the ground in, so a hero placed to
 * satisfy this is a hero the solver's own `offCentre` term would reward, and
 * the margin between 26° and 41° is what keeps the crown off the frame edge.
 *
 * **Nothing is centred.** `THIRD_OFF = 1/6` of the frame width is the
 * rule-of-thirds line `landing.js` already scores against, and it is what this
 * aims at. Sign comes from the seed, so half the worlds put their tree left.
 *
 * **Scale legible against a human.** This is the distance band, and it is a
 * pixel argument at both ends. Too far and the tree is a mark: at 200 m a 20 m
 * crown is 5.7°, and the 1.68 m figure that would give it scale is 0.48° — 6 px
 * at 720p, which is not a reference, it is a smudge. Too near and it is a wall
 * rather than a subject, and `life.js` already refuses a trunk inside 14 m for
 * that reason. The band below puts the crown between roughly 12° and 38° of a
 * 52° frame and the figure between 1.0° and 3.2°.
 *
 * The search is a lattice rather than a scatter: two third-lines by a sweep of
 * distances, jittered once from the seed. A scatter would need many more draws
 * to cover the same band as evenly, and every draw is a §2.3 liability — an
 * extra `next()` here moves every subsequent decision on the world.
 *
 * Returns `null` when the ground refuses every candidate, which is an answer.
 * A world whose spawn faces open water has no hero and should not be given a
 * tree standing in the sea.
 */
/** the near edge of the band: closer than this a hero is a wall, not a subject */
export const HERO_NEAR = 30;
/** the far edge: past this the 1.68 m figure that gives it scale stops resolving */
export const HERO_FAR = 95;

export function heroSite({
  seed = 1,
  spawn = { x: 0, z: 0 },
  heading = 0,
  halfFov = 26 * Math.PI / 180,
  groundAt = () => 0,
  blocked = () => false,
  near = HERO_NEAR,
  far = HERO_FAR,
  height = 9,
  gravity = G_EARTH,
  thirdOff = 1 / 6,
} = {}) {
  const r = new RNG(hash(seed >>> 0, 0x8e40));
  const sx = num(spawn?.x, 0), sz = num(spawn?.z, 0);
  const hd = num(heading, 0);
  const hf = clamp(num(halfFov, 0.4538), 0.08, 1.4);
  const d0 = clamp(num(near, HERO_NEAR), 16, 400);
  const d1 = clamp(num(far, HERO_FAR), d0 + 4, 600);
  const H = heroHeight(height, gravity);

  // The datum for "is this tree above me or below me".
  //
  // The eye's own ground is the obvious choice and it is not available: the
  // `groundAt` a caller passes is `life.js`'s `dryland`, which returns `null`
  // above `amp · 0.55` — so on a mountainous world a spawn perfectly fine to
  // stand on is not plantable, the datum falls back to zero, and the `level`
  // term then reads every candidate as hundreds of metres out of place and
  // scores them all at zero. Not wrong, but the term stops discriminating,
  // silently, on exactly the terrain it exists for.
  //
  // So the datum comes from the candidates. Gather them first, take the median
  // ground among the ones that are plantable at all, and score against that:
  // it needs no second probe, it cannot be `null`, and "level" ends up meaning
  // *level relative to the ground this hero could stand on*, which is the more
  // useful reading anyway.
  const cands = [];

  // the ideal bearing: a third of the way out, on the side the seed picks
  const side = r.float(0, 1) < 0.5 ? -1 : 1;
  const wantOff = thirdOff * 2 * hf;          // frame fraction → radians
  const jitter = r.float(-0.16, 0.16);        // one draw, not one per candidate
  // How much of the frame this world's hero fills, as a fraction of the
  // vertical. It is a *draw* rather than a constant, and that is not a
  // flourish: with a fixed target the distance sweep is not a search at all —
  // every other term is flat in `d`, so the size term alone decides, and every
  // hero in the universe lands at the identical subtended angle. Measured
  // before this line existed: 1,000 worlds, every crown 18.0° of 52°, to the
  // decimal. A law that returns one answer is a constant with a loop around it.
  const wantFill = r.float(0.26, 0.46);

  // 7 bearings × 11 distances. The bearing lattice is scaled so that ±1 step
  // lands EXACTLY on `thirdOff`, because the score's own maximum is there and a
  // lattice that straddles it can only ever return a worse answer than the rule
  // it is implementing. It was ±0.7 and ±1.4 of the third, and the mean landed
  // at 0.222 of frame width against a target of 0.167.
  //
  // Both sides are tried: the side the seed asked for can be water, and a hero
  // on the wrong third beats no hero.
  const STEPS = [-1.3, -1, -0.55, 0, 0.55, 1, 1.3];
  for (let b = 0; b < STEPS.length; b++) {
    const off = STEPS[b] * wantOff + jitter * wantOff;
    for (let k = 0; k < 11; k++) {
      const d = d0 + (d1 - d0) * (k / 10);
      const a = hd + off;
      const x = sx + Math.sin(a) * d, z = sz + Math.cos(a) * d;
      const y = groundAt(x, z);
      if (y === null || !Number.isFinite(y)) continue;
      if (blocked(x, z)) continue;
      cands.push({ x, z, y, d, off, a });
    }
  }
  if (!cands.length) return null;

  const ys = cands.map((c) => c.y).sort((p, q) => p - q);
  const eyeGround = ys[ys.length >> 1];

  let best = null;
  for (const c of cands) {
    const { x, z, y, d, off, a } = c;

    // --- how well this candidate reads ---------------------------------
    // the third line, asymmetric exactly as `landing.js`'s offCentre is: a
    // centred subject is the fault §9.7 names and scores zero; one pushed
    // past the third is merely weaker
    const frac = Math.abs(off) / (2 * hf);
    const place = clamp(frac / thirdOff, 0, 1)
      * (1 - 0.55 * clamp((frac - thirdOff) / (0.5 - thirdOff), 0, 1));
    // the side the seed asked for, if it can be had
    const sided = Math.sign(off) === side ? 1 : 0.82;
    // how much of the frame the crown fills — this world's own target, and
    // falling off either side of it
    const sub = 2 * Math.atan2(H * 0.5, Math.max(d, 1));
    const fill = clamp(sub / (2 * hf), 0, 1.4);
    const size = 1 - Math.min(Math.abs(fill - wantFill) / 0.34, 1);
    // and it should stand roughly where you do. A hero 30 m up a bluff is a
    // silhouette against sky, which is a different picture; one 30 m down a
    // hollow is a crown with no trunk. Neither is wrong, both are unstable,
    // and the band is generous enough that ordinary ground never binds.
    const rise = Math.abs(y - eyeGround) / Math.max(H, 1);
    const level = 1 - clamp((rise - 0.35) / 0.9, 0, 1);

    const score = place * 1.5 + size * 1.3 + level * 0.9 + sided * 0.4;
    if (!best || score > best.score) {
      best = { x, z, y, dist: d, bearing: a, offset: off, height: H, score };
    }
  }

  if (!best) return null;

  // The habit is the seed's, but not uniformly: a hero is a tree you are meant
  // to read the shape of at a hundred metres, and two of the four habits say
  // more at that range than the others. `columnar` is a silhouette a conifer
  // stand already supplies; `spreading` and `umbrella` are what a single
  // dominant crown looks like in every painting of one.
  const pick = ['spreading', 'umbrella', 'weeping', 'spreading'][r.int(0, 3)];
  best.habit = pick;
  best.yaw = r.float(0, Math.PI * 2);
  return best;
}
