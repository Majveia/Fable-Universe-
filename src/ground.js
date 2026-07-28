// The ground, as one definition. CLAUDE.md §2.7's discipline, one level up.
//
// §2.7 is written about the GLSL↔JS height-field parity at planet scale — *"one
// definition, because two drift"* — and the surface scale had quietly grown the
// same problem in a different shape. `surface.js` composed the walkable ground
// inline inside `_buildTerrain()`, closed over half a dozen locals, and nothing
// else could evaluate it. So when the landing-site solver needed to know what a
// site *looks* like, it could not ask; it scored the planet-scale macro field
// instead and reported 2.65 m of relief across the whole 2.8 km surface.
//
// That number is the argument for this file. The macro term is essentially flat
// underfoot — on a 6371 km world, 1400 m subtends 0.00022 radians — and every
// ridge a person standing there can actually see comes from the two fbm octaves
// and the landform. A solver that cannot see them is choosing a viewpoint by
// looking at a different planet.
//
// Nothing here is new. The formula is `surface.js`'s, moved without a change of
// value, and `tools/verify.js` pins it against 441 samples captured from the
// browser before the move: same seeds, same lattice, checksum 19546.3209. A
// refactor of a generation path that shifts any world by a millimetre has
// broken every shared URL (§2.3), so the guard is a fingerprint rather than an
// intention.

import { hash, RNG } from './rng.js';
import { planetHeight } from './terrain.js';
import { pickLandform } from './landform.js';

/** metres per unit of the macro height field */
export const S_MACRO = 320;

/** 2D value noise with a shuffled permutation — seeded, so a world is a place */
export function makeNoise(seed) {
  const r = new RNG(hash(seed, 0x7e44));
  const perm = new Uint8Array(512);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = r.int(0, i);
    [perm[i], perm[j]] = [perm[j], perm[i]];
  }
  for (let i = 0; i < 256; i++) perm[256 + i] = perm[i];
  const grad = (h, x, y) => ((h & 1) ? -x : x) + ((h & 2) ? -y : y);
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = fade(x), v = fade(y);
    const a = perm[X] + Y, b = perm[X + 1] + Y;
    return (1 - v) * ((1 - u) * grad(perm[a], x, y) + u * grad(perm[b], x - 1, y)) +
           v * ((1 - u) * grad(perm[a + 1], x, y - 1) + u * grad(perm[b + 1], x - 1, y - 1));
  };
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len3 = (a) => Math.hypot(a[0], a[1], a[2]);
const norm3 = (a) => { const l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/**
 * The local tangent frame at a landing direction — `surface.js`'s own
 * construction, in plain arrays so this module needs no three.
 */
export function frameAt(dir) {
  const d = norm3(dir);
  let e = cross([0, 1, 0], d);
  if (len3(e) < 1e-6) e = [1, 0, 0];      // straight up has no unique east
  e = norm3(e);
  return { dir: d, east: e, north: norm3(cross(d, e)) };
}

/**
 * Build the walkable ground for a world.
 *
 * Returns the height function plus everything derived on the way, because the
 * callers need those too and re-deriving them is how two definitions start.
 *
 * `lift` and `impacts` are mutable on the returned object: `surface.js` raises
 * a waterlocked world after the spawn scan, and craters are carved per visit.
 * They are state the ground owns, not arguments it takes.
 */
export function makeGround(pp, landingDir, opts = {}) {
  const { wind = { x: 1, y: 0 } } = opts;
  const noise = makeNoise(pp.seed);
  const fbm2 = (x, y, oct, lac = 2.03) => {
    let v = 0, a = 0.5, f = 1;
    for (let o = 0; o < oct; o++) { v += a * noise(x * f, y * f); a *= 0.5; f *= lac; }
    return v;
  };

  const type = pp.typeId;
  const landform = pickLandform(pp, wind);
  const ocean = pp.oceanLevel > -0.5 ? pp.oceanLevel : 0.0;
  const frame = frameAt(landingDir);
  const Rworld = Math.max(pp.radiusE, 0.05) * 6.371e6;
  const reliefAmp = type === 0 ? 55 : type === 3 ? 30 : type === 4 ? 40 : 42;

  const g = {
    noise, fbm2, landform, ocean, frame, Rworld, reliefAmp,
    amp: landform.amp,
    seaLevel: (type === 1 && pp.oceanLevel > -0.5) || type === 2 ? 0 : null,
    lift: 0,
    impacts: [],
    heightAt: null,
  };

  const { dir, east, north } = frame;
  g.heightAt = (x, z) => {
    const px = dir[0] * Rworld + east[0] * x + north[0] * z;
    const py = dir[1] * Rworld + east[1] * x + north[1] * z;
    const pz = dir[2] * Rworld + east[2] * x + north[2] * z;
    const l = Math.hypot(px, py, pz) || 1;
    const macro = planetHeight(px / l, py / l, pz / l, pp.noiseSeed) - ocean;
    // more relief inland and on high ground, gentler on the shelf
    const relief = reliefAmp * (0.35 + Math.min(Math.max(macro * 2.2, 0), 1.4));
    let h = macro * S_MACRO
      + fbm2(x * 0.0011 + 7.3, z * 0.0011 - 2.1, 5) * relief * 1.7
      + fbm2(x * 0.009 + 31.7, z * 0.009 + 11.3, 3) * 6;
    // the landform raises this world's bones — full inland, fading to the
    // shore so mountains never rise straight out of the sea
    const land = Math.min(Math.max(macro * 9 + 0.15, 0), 1);
    h += landform.contribute(x, z, noise, land);
    // the horizon truly curves with this world's radius
    h -= (x * x + z * z) / (2 * Rworld * 0.34);
    h += g.lift;
    // craters: a raised rim ringing a depressed bowl
    for (let i = 0; i < g.impacts.length; i++) {
      const im = g.impacts[i];
      const d = Math.hypot(x - im.x, z - im.z) / im.r;
      if (d > 2.2) continue;
      const bowl = -im.depth * Math.max(1 - d * d, -0.15);
      const rim = im.depth * 0.55 * Math.exp(-((d - 1) * (d - 1)) * 9);
      h += (bowl + rim) * im.grown;
    }
    return h;
  };

  return g;
}
