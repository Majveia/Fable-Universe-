// Where a canopy flowers, and when.
//
// The fourth and last of the four nature systems taken from the reference.
// Method from `docs/reference/sakura-realm/src/tree/blossoms.js` and
// `src/tree/petals.js` (MIT, © 2026 Leonxlnx). Per §10 the method ports and
// the file does not.
//
// ---------------------------------------------------------------------------
// The mistake the reference documents, and why it is the whole file
//
// Its header records what it tried first: a **smoothstep window in normalised
// crown radius** — flower where `r/R` is between 0.78 and 1.0. It is the
// obvious thing, it is one line, and it produces *"not a cloud of flowers, it
// is a SHELL of them"*. The tree reads as a hollow bubble, because that is
// exactly what it is: a surface with nothing inside it.
//
// What replaces it is **Beer's law over two light paths**. A flower opens where
// light reaches, light is attenuated exponentially by the foliage it crosses,
// and a site inside a crown is reached along two very different paths:
//
//   · **up**, to the sky, through however much canopy is overhead;
//   · **out**, through the flank, to the nearest open air sideways.
//
// Both, because either one alone is a *different and wrong answer* rather than
// a cheaper approximation of the right one. Measured on a 14 m crown: a point
// low on the flank — the crown's skirt — scores **0.92** with the out-path
// alone, because it is 19 cm from the outside; with the sky path in, the same
// point scores **0.12**. The reference's own defect list has this: with the
// flank path alone, 54% of its flowers piled into two narrow bands.
//
// ---------------------------------------------------------------------------
// What AEON adds: the year
//
// The reference's tree is in bloom because it was built in bloom. Here a world
// has an orbit, and `M0` — its mean anomaly at epoch — is already on the planet
// record because `system.js` needs it to place the world in its orbit. So the
// season is not a second clock; it is the same number the orbit diagram is
// drawn from. About a third of a year has any flower on it, which means most
// worlds are not in bloom when you arrive.
//
// That is the point. A season you can miss is the only kind worth catching.
//
// And a petal falls through `precip.js`, not through a second model, so petals
// and snow cannot disagree about the same air.
//
// No THREE, no clock: everything here is arithmetic, so `tools/verify.js`
// measures it without a GPU and `tools/glslcheck.js` compiles its shader
// without a world.

import { RNG, hash } from './rng.js';
import { terminalVelocity } from './precip.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);
const TAU = Math.PI * 2;

/**
 * Beer's law's length scale, in **metres of canopy**.
 *
 * `L = 1/(k·a)`, where `a` is leaf area density in m²/m³ and `k` the extinction
 * coefficient of a leaf layer. A closed broadleaf canopy runs `a ≈ 0.8–1.5` and
 * `k ≈ 0.5`, which puts `L` between 1.3 and 2.5 m. The reference's 2.3 sits in
 * that band and is kept.
 *
 * It is deliberately **absolute, not a fraction of the tree**. I tried relative
 * first — 0.5·crownR, on the reasoning that a 40 m giant should not flower only
 * on its skin — and it is wrong, in a way worth recording because the argument
 * for it sounds better than the argument against.
 *
 * Leaf area density is a property of the *foliage*, not of the tree's size. A
 * giant's leaves are not spaced further apart than a shrub's; there are simply
 * more of them, over a longer path. So the flowering cloud is a fixed few
 * metres thick on every tree, and what changes with size is what fraction of
 * the crown that is:
 *
 *     6 m shrub    (crown 1.6 m across)  · 0.308 at the axis — flowers through
 *     14 m tree    (crown 3.9 m across)  · 0.064 at the axis — a rind on a core
 *     30 m giant   (crown 8.2 m across)  · 0.003 at the axis — skin only
 *
 * Which is exactly what a photograph of each shows. The relative version made
 * all three look like the shrub, and a 30 m tree flowering right through its
 * own trunk is a worse error than the shell, not a better one.
 *
 * §9.6's ruling — port the function, not its output — is satisfied by porting
 * *Beer's law*. 2.3 is not an output, it is the leaf.
 */
export const EXTINCTION = 2.3;
/** below this a canopy is not a canopy and the law has nothing to attenuate */
export const EXTINCTION_MIN = 0.3;

/**
 * How the two paths are weighted against each other.
 *
 * Not equal: a canopy is lit from above far more than from the side, because
 * the sky is a hemisphere and the flank is a sliver of it. 0.65/0.35 is the
 * split, and it is a **weighted sum inside one exponential** rather than the
 * product of two exponentials — a site is not shaded twice over. Multiplying
 * them, which is what I wrote first, doubles the effective optical depth and
 * gives the shell back by a different route.
 */
export const W_UP = 0.65;
export const W_OUT = 0.35;

/** a cherry petal: 11 mm, and about as dense as balsa once it is dry-ish */
export const PETAL = { radius: 0.011, rhoBody: 240, cd: 1.5 };

/**
 * Where a world is in its year, 0..1, from its own orbital phase.
 *
 * `M0` is the mean anomaly at epoch, already on the planet record because
 * `system.js` needs it to place the world in its orbit. So the season is not a
 * second clock — it is the *same* number the orbit diagram is drawn from.
 *
 * `override` is the `?season=` deep-link value, passed in as a raw string
 * because that is what a URL yields. It has to be tested as a string first:
 * `Number(null)` is **0**, not NaN, so the obvious `isFinite(Number(param))`
 * reads "no override given" as "phase zero" and pins every world in the
 * universe to the same day of its year. That is the whole reason this is a
 * function here rather than three lines at the call site — a bug that makes
 * 10²⁸ worlds flower in unison is worth a test.
 */
export function seasonPhaseOf(M0 = 0, override = null) {
  const forced = paramNumber(override);
  if (Number.isFinite(forced)) return forced;
  const p = (num(M0, 0) / TAU) % 1;
  return p < 0 ? p + 1 : p;
}

/**
 * A URL parameter as a number, or NaN when it was not given.
 *
 * The whole content of this function is the trap it exists to avoid, and it is
 * worth a name because two callers here need it and both would have got it
 * wrong the same way: **`Number(null)` is 0, not NaN**, and `Number('')` is 0
 * too. `Number.isFinite(Number(param))` therefore reads "no override given" as
 * "the value zero", which for `?season=` pinned every world in the universe to
 * the same day of its year and for `?bloom=` would have stripped the flowers
 * off all of them.
 */
export function paramNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return NaN;
  const v = Number(raw);
  return Number.isFinite(v) ? v : NaN;
}

/**
 * How far into its flowering the world is, 0..1, at a point in its orbit.
 *
 * A window of half-width `width` around a seeded centre, opening and closing
 * smoothly. 0.16 gives 32% of the year with any flower on it and a much
 * narrower band in full bloom, which is roughly a real temperate spring
 * measured as a fraction of a year.
 *
 * The distance is taken **around the circle**, not along the line, so a world
 * whose spring straddles its new year gets a spring rather than two half ones.
 */
export function seasonOpenness(phase, seed = 0, width = 0.16) {
  const w = Math.max(num(width, 0.16), 1e-4);
  const centre = new RNG(hash(seed >>> 0, 0x5ea5)).float(0, 1);
  let ph = num(phase, 0) % 1;
  if (ph < 0) ph += 1;
  let d = Math.abs(ph - centre);
  if (d > 0.5) d = 1 - d;
  const t = 1 - d / w;
  if (t <= 0) return 0;
  return clamp(t * t * (3 - 2 * t), 0, 1);
}

/**
 * The two optical depths at a point inside a crown, in metres of canopy.
 *
 * The crown is the oblate envelope `tree.js` grew the wood against, so this
 * asks the tree about itself rather than inventing a second shape:
 * `{ y, r, up, down }` — centre height, radius at the widest band, and the
 * half-heights above and below it.
 *
 * **up** · the ray leaves the crown at `up·√(1 − rad²/r²)` above the widest
 * band. The path is counted from `max(dy, 0)`, not from `dy`, which is the one
 * modelling choice in this function worth defending. Below the widest band a
 * vertical ray is not passing through canopy — it is passing through the bare
 * bole and the inner branches, which is the same asymmetry `tree.js` already
 * asserts in its escape function ("every tree has a bare bole under its
 * crown"). Counting the full ellipsoid chord from the skirt to the apex would
 * make the underside of every crown pitch dark and flowerless, which is not
 * what a flowering tree looks like from underneath.
 *
 * **out** · horizontally, the crown's radius at this height is `r·√(1 − dy²/up²)`
 * and the ray crosses the difference. `up` is used on both sides deliberately:
 * using `down` puts the skirt formally *outside* the envelope, which makes
 * `kOut` zero, which makes the flank path zero, which flowers the skirt fully —
 * the reference's exact recorded defect, reached from the other direction.
 */
export function opticalDepth(p, crown) {
  const cy = num(crown?.y, 0);
  const cr = Math.max(num(crown?.r, 1), 1e-4);
  const cu = Math.max(num(crown?.up, 1), 1e-4);
  const x = num(p?.x, 0), z = num(p?.z, 0);
  const dy = num(p?.y, 0) - cy;
  const rad = Math.hypot(x, z);

  const kUp = Math.sqrt(Math.max(0, 1 - (rad * rad) / (cr * cr)));
  const up = Math.max(0, cu * kUp - Math.max(dy, 0));

  const kOut = Math.sqrt(Math.max(0, 1 - (dy * dy) / (cu * cu)));
  const out = Math.max(0, cr * kOut - rad);

  return { up, out };
}

/**
 * How heavily a site flowers, 0..1 — Beer's law over both paths.
 *
 * One exponential of a **weighted sum** of the two depths, not the product of
 * two exponentials: a site is not shaded twice over. The exponential is what
 * puts a flowering cloud several metres deep instead of a skin on a bubble.
 *
 * The measurement that matters is the reference's own: with the flank path
 * alone a crown's *skirt* scores 0.92 — fully lit, everywhere, because it is
 * only a metre from the outside. With the sky path in, the same point is 0.12.
 * One path is not a cheaper two; it is a different, wrong answer.
 */
export function floweringAt(p, crown, extinction = EXTINCTION) {
  const d = opticalDepth(p, crown);
  const L = Math.max(num(extinction, EXTINCTION), EXTINCTION_MIN);
  return clamp(Math.exp(-(W_UP * d.up + W_OUT * d.out) / L), 0, 1);
}

/**
 * The flower's hue, from the foliage's.
 *
 * Not a taste call and not a sakura-pink constant. A flower is an
 * advertisement, and an advertisement that matches its background is not one —
 * so a petal sits across the wheel from the leaf it is displayed against, which
 * on a green-leaved world puts it in the pinks and on a rust-leaved one puts it
 * in the blues. The seed moves it within a band; the opposition is the law.
 *
 * Returns `{ h, s, l }` in the same 0..1 space `THREE.Color.setHSL` takes.
 */
export function petalHue(vegH = 0.3, seed = 0) {
  const r = new RNG(hash(seed >>> 0, 0x9e77));
  const h = (num(vegH, 0.3) + 0.5 + r.float(-0.11, 0.11) + 1) % 1;
  return { h, s: r.float(0.30, 0.62), l: r.float(0.72, 0.88) };
}

/**
 * Every flower on one tree, in the tree's own frame.
 *
 * Walks the tree's **own twig ends** rather than sampling the crown volume, so
 * a flower is always attached to wood that exists and the wind cannot separate
 * the two. A flower stands off its twig on a short spur, because that is where
 * a cherry flowers and it is what fills the space *between* neighbouring twigs
 * instead of painting the twig itself.
 *
 * Clusters, not singles. A twig in full bloom carries three to five flowers,
 * which is the difference between a tree in flower and a tree with a hundred
 * white dots on it — measured, 629 flowers on the 362 segments of a 14 m tree.
 * The cluster size scales with the light *and* the season, so a world at the
 * edge of its spring gets sparse singles and one in full bloom gets mass.
 *
 * Returns `{ x, y, z, size, yaw, tilt, tint, lit }` per flower. `lit` is the
 * flowering that opened it, which is already the right lever for how bright to
 * paint it — a flower deep in the crown opened in shade and stays duskier.
 */
export function blossomsFor(tree, {
  seed = 1, openness = 1, budget = 6000, minRadius = 0.02, extinction = EXTINCTION,
} = {}) {
  const s = tree?.seg;
  const out = [];
  if (!s || !Array.isArray(s.r1) || !s.r1.length) return out;
  const cap = Math.max(budget | 0, 0);
  if (cap === 0) return out;
  const open = clamp(num(openness, 1), 0, 1);
  if (open <= 0) return out;
  const crown = tree.crown ?? { y: 0, r: 1, up: 1, down: 1 };
  const minR = Math.max(num(minRadius, 0.02), 1e-5);
  const r = new RNG(hash(seed >>> 0, 0xf10a));

  for (let i = 0; i < s.r1.length && out.length < cap; i++) {
    if (!(s.r1[i] <= minR)) continue;             // flowers grow on twigs
    const px = num(s.x1[i], 0), py = num(s.y1[i], 0), pz = num(s.z1[i], 0);
    const lit = floweringAt({ x: px, y: py, z: pz }, crown, extinction);
    // Rejection first, then cluster size — the same number decides both, so a
    // twig deep in the crown is both less likely to flower and, when it does,
    // carries fewer. That is one law doing two jobs rather than two knobs.
    if (r.float(0, 1) > lit * open) continue;
    const cluster = 1 + Math.round(r.float(0, 1) * 4 * lit * open);
    for (let c = 0; c < cluster && out.length < cap; c++) {
      // A flower stands off the wood on a spur — that is where a cherry
      // flowers, and it is what fills the space between neighbouring twigs
      // instead of painting the twig itself.
      const spur = s.r1[i] + r.float(0.02, 0.13);
      const th = r.float(0, TAU), ph = Math.acos(r.float(-1, 1));
      out.push({
        x: px + spur * Math.sin(ph) * Math.cos(th),
        y: py + spur * Math.cos(ph),
        z: pz + spur * Math.sin(ph) * Math.sin(th),
        size: r.float(0.7, 1.35),
        yaw: r.float(0, TAU),
        tilt: r.float(-0.6, 0.6),
        tint: r.float(0, 1),
        lit,
      });
    }
  }
  return out;
}

/**
 * How a petal falls here.
 *
 * The speed is `precip.js`'s drag law with a petal's numbers in it, so this is
 * the *same* law the snow and the rain use and they cannot disagree about the
 * same air. Thin air drops a petal fast and nearly straight; thick air makes it
 * hang; low gravity does the same, by the law that also made its trees tall.
 *
 * `flutter` is how far it slips sideways per swing, which scales with the air
 * that is doing the slipping — in a near-vacuum a petal has nothing to catch on
 * and falls like a stone.
 *
 * `period` is that swing, as a pendulum: a lateral excursion of amplitude
 * `flutter` under gravity's restoring pull, `T = 2π√(A/g)`. It is why a petal
 * on a low-gravity world takes its time about it.
 */
export function petalFall(world = {}) {
  const { gravity = 9.80665, rhoAir = 1.225 } = world;
  const g = Math.max(num(gravity, 9.80665), 0);
  const rho = Math.max(num(rhoAir, 1.225), 0);
  const speed = terminalVelocity(PETAL.radius, g, rho, {
    rhoBody: PETAL.rhoBody, cd: PETAL.cd,
  });
  const flutter = clamp(Math.min(rho / 1.225, 2) * 0.9, 0, 1.8);
  const period = clamp(TAU * Math.sqrt(Math.max(flutter, 0.02) / Math.max(g, 0.05)), 0.25, 8);
  return { speed: num(speed, 0), flutter, period };
}

/**
 * The falling-petal shader, kept here rather than in `life.js`.
 *
 * Not tidiness: §M0 requires every shader to be compile-checked **as passed to
 * `gl.shaderSource`**, and a string buried inside a build function is only
 * reachable by running the whole app on a world that happens to be in flower.
 * As an export it is reachable by `tools/glslcheck.js` in ten seconds, on any
 * machine, whatever season it is.
 *
 * Everything it does comes from `precip.js`'s three ideas — analytic position,
 * a wrapped box, a minimum pixel footprint with the alpha scaled by its inverse
 * — plus the one thing a petal does that a raindrop does not, which is stall
 * and slip sideways instead of falling in a line.
 */
export const PETAL_GLSL = {
  vert: /* glsl */`
attribute vec2 aPh;
uniform float uTime, uBox, uBoxY, uSpeed, uFlutter, uPeriod, uR, uH;
uniform vec3 uCam;
uniform vec2 uDrift;
varying float vSpin;
varying float vDim;
void main() {
  vec3 p = position;
  p.y -= uTime * uSpeed;
  p.xz += uDrift;
  float w = 6.2831853 * uTime / uPeriod + aPh.x;
  p.x += sin(w) * uFlutter;
  p.z += cos(w * 0.83) * uFlutter;
  // idea 1: wrap the box around the camera, never respawn. a particle leaving
  // the far face re-enters at the near one with its phase intact, so density
  // is exactly constant while you walk and nothing trails behind you
  vec3 box = vec3(uBox, uBoxY, uBox);
  vec3 c = uCam + vec3(0.0, uBoxY * 0.30, 0.0);
  vec3 dl = p - c;
  p = c + (dl - floor(dl / box + 0.5) * box);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  // the scene this hangs in is not always in metres — planetscale.js hosts the
  // same code inside a group scaled by 1/mpu — so recover the scale rather than
  // assume it. assuming it is how a petal ends up ninety kilometres wide
  float sc = length(modelViewMatrix[0].xyz);
  float px = uR * sc * uH * projectionMatrix[1][1] / max(-mv.z, 1e-3);
  // idea 3: widen to a floor, dim by the same factor. their product is 1, so
  // distant petals cannot brighten into a pink fog
  float k = max(1.6 / max(px, 1e-4), 1.0);
  gl_PointSize = px * k;
  vDim = 1.0 / k;
  vSpin = 0.5 + 0.5 * abs(sin(w * 1.7 + aPh.y));
}
`,
  frag: /* glsl */`
precision highp float;
uniform vec3 uColor;
uniform float uDay, uOpen;
varying float vSpin;
varying float vDim;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float a = smoothstep(0.25, 0.05, dot(q, q));
  if (a < 0.02) discard;
  // a petal turning edge-on all but disappears, which is most of what makes
  // real falling blossom flicker rather than stream
  gl_FragColor = vec4(uColor * (0.45 + 0.55 * vSpin) * uDay,
                      a * vDim * vSpin * uOpen * 0.9);
}
`,
};
