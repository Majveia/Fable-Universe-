// One wind, and everything drinks from it — CLAUDE.md §M3.
//
// §M3 calls this the milestone the reference exists to teach, and the diagnosis
// in docs/plans/M3.md §1 says why: a surface world already builds seventeen
// systems and animates fifteen of them, and every one of those fifteen receives
// the same two arguments — `dt`, and the sun's height. Fifteen loops sharing one
// variable. The world is not empty; it is *uncorrelated*, and a place where
// fifteen things move on fifteen clocks is a diorama.
//
// What replaces it is not more things. It is one field that a gust crosses, so
// that grass, foliage, smoke, rain, lanterns, motes and water all lean in the
// same second because the same air reached them.
//
// Ported from `docs/reference/hoshi-no-tani.html` §5 as technique rather than
// as file (§10), with one substantial departure — §3 below.
//
// ---------------------------------------------------------------------------
// Real wind is not sin(t), and the four ingredients are why
//
// 1. **A mean flow that meanders.** Speed and direction wander slowly around a
//    base. It is what stops the field ever quite repeating.
//
// 2. **Coherent gust cells**, riding downwind faster than the mean, each a
//    product of three profiles: a *sharp leading edge*, an exponential body
//    trailing behind it, and a cross-wind falloff. §M3 names this as the
//    ingredient that makes wind read as weather rather than as noise, and the
//    edge is the reason — a gust you can watch cross the meadow before it
//    arrives. Each cell also veers, because a gust that only changes magnitude
//    reads as somebody turning a volume knob.
//
// 3. **Turbulence advected with the flow.** Two octaves sampled at `(x − v·t)`
//    rather than at `x` — Taylor's frozen-turbulence hypothesis, eddies carried
//    along by the mean instead of wobbling in place. It is the difference
//    between air that is moving and air that is merely textured.
//
// 4. **A logarithmic boundary layer**, normalised to 1.0 at the 10 m reference
//    height. Roots barely move and tips whip, and anything that stands up gets
//    it for free.
//
// ---------------------------------------------------------------------------
// The departure: this field is a pure function of (seed, position, height, t)
//
// The reference's `updateWind` integrates `dt` and calls `Math.random()` five
// times per cell respawn. Neither survives here, and the second is the obvious
// one — §2.3 forbids `Math.random()` in any generation path by name.
//
// The first matters more and is easier to miss. **An integrator over `dt` is
// not frame-rate independent.** A wind that accumulates would give one answer
// at 60 fps and another at 30, so a capture would depend on how fast the
// machine ran, and §7.7's "re-shoot every previous milestone" would be
// comparing two different winds. This session has already lost time twice to
// frames that were not reproducible — an unpinned `dt`, and a bisect that could
// not re-render — and the one system that touches every other system is the
// worst possible place to add a third.
//
// So nothing here integrates. The meander is a noise sampled at absolute `t`,
// the gust cells' stations are closed-form in `t` and wrap, and each cell draws
// its parameters from `hash(seed, index, generation)` where the generation is
// which lap it is on. Same seed and same `t` gives the same air on every
// machine at any frame rate, forever.
//
// That is stricter than the reference and it costs nothing — the character
// comes from the *shape* of the meander, not from its being random.

import { hash, RNG } from './rng.js';
import { snoise } from './terrain.js';

const DEG = Math.PI / 180;

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};

/**
 * A smooth, deterministic scalar in roughly [−1, 1], for the meander.
 *
 * `snoise` rather than a new noise, because this repo has twice paid for two
 * definitions of one function (§2.7's height field, and `landing.js`'s second
 * `frameAt`). The third coordinate is the channel, so two calls at the same `t`
 * on different channels are independent.
 */
const drift = (t, channel) => snoise(t, channel * 37.13 + 4.7, channel * 11.9);

/** how many metres of along-wind station a cell travels before it recycles */
const CELL_SPAN = 1560;
const CELLS = 6;

/**
 * The air over one world.
 *
 * `meanDirDeg` is the direction the wind comes *from*, which is the convention
 * every weather report uses and the opposite of the vector the air travels
 * along. Getting that backwards is invisible in a still and wrong in every
 * frame — the same class of error as §9.3's view vector, so it is named here
 * and converted once, at the bottom of `windAt`.
 */
export function makeWind(seed, { meanSpeed = 4.2, meanDirDeg = 292, gustiness = 1 } = {}) {
  const cells = [];
  for (let i = 0; i < CELLS; i++) {
    // the lap-zero station, spread along the axis so they do not arrive together
    cells.push({ i, s0: -1400 + i * (CELL_SPAN / CELLS) });
  }
  return { seed, baseSpeed: meanSpeed, baseDir: meanDirDeg * DEG, gustiness, cells };
}

/**
 * A cell's parameters on the lap it is currently on. Deterministic in
 * `(seed, index, generation)`, so a cell that has recycled forty times is as
 * reproducible as one that has not.
 */
function cellParams(w, i, generation) {
  const r = new RNG(hash(w.seed, 0x77d, i, generation | 0));
  return {
    c: (r.float(0, 1) - 0.5) * 940,      // cross-wind offset
    len: 26 + r.float(0, 1) * 34,        // along-wind length of the front
    wid: 70 + r.float(0, 1) * 130,       // cross-wind width
    amp: 0.8 + r.float(0, 1) * 1.4,      // strength
    veer: (r.float(0, 1) - 0.5) * 0.44,  // how far it rotates the flow
  };
}

/**
 * The mean flow at time `t`. Meanders around the base by a bounded noise
 * rather than a random walk — see the header.
 */
export function meanFlow(w, t) {
  const speed = w.baseSpeed * (1 + 0.30 * drift(t * 0.040, 0));
  const dir = w.baseDir + 0.32 * drift(t * 0.025, 1);
  // the direction the air travels *toward*, from the direction it comes from
  const fx = Math.sin(dir + Math.PI), fz = Math.cos(dir + Math.PI);
  return { speed, dir, fwd: [fx, fz], side: [-fz, fx] };
}

/**
 * §M3's boundary layer: `log((h + z0) / z0)` normalised to 1.0 at 10 m.
 *
 * Roots barely move and tips whip, which is most of what makes a blade look
 * rooted rather than floating. Monotone and finite at zero, which the suite
 * checks, because a profile that returns 0 at the ground would freeze the
 * bottom of every blade and one that returns NaN would poison a vertex.
 */
export function shear(height) {
  return Math.log((Math.max(height, 0.015) + 0.06) / 0.06) * 0.19523;
}

/**
 * The wind at a point, at a height, at a time. Pure.
 *
 * Returns the horizontal velocity, the gust weight that produced it (which the
 * grass uses for its wind flash, §9.5), and the speed after the shear profile.
 */
export function windAt(w, x, z, height, t) {
  const M = meanFlow(w, t);
  const [fx, fz] = M.fwd, [sx, sz] = M.side;
  let vx = fx * M.speed, vz = fz * M.speed;

  const along = x * fx + z * fz;
  const cross = x * sx + z * sz;

  // Gust cells. Each is a front: it arrives, it passes, it leaves.
  const adv = w.baseSpeed * 1.25 * t;
  let gustW = 0, veer = 0;
  for (const cell of w.cells) {
    const raw = cell.s0 + adv;
    const generation = Math.floor(raw / CELL_SPAN);
    const s = raw - generation * CELL_SPAN - CELL_SPAN * 0.5;
    const p = cellParams(w, cell.i, generation);

    const u = (along - s) / p.len;
    // ahead of the front, or long past its tail — contributes nothing
    if (u > 0.16 || u < -6.0) continue;
    const head = smoothstep(0.14, 0, u);          // the sharp leading edge
    const body = Math.exp(u * 2.05);              // the exponential tail
    const cw = Math.exp(-Math.pow(Math.abs(cross - p.c) / (p.wid * 0.5), 2.3));
    const g = p.amp * head * body * cw * w.gustiness;
    gustW += g;
    veer += g * p.veer;
  }

  // Turbulence, advected with the flow (Taylor): sampled at x − v·t, so the
  // eddies are carried along rather than wobbling in place.
  const q1x = (x - vx * t) * 0.0125, q1z = (z - vz * t) * 0.0125;
  const n1 = snoise(q1x, q1z, 0.5), n1b = snoise(q1x + 3.7, q1z - 1.9, 0.5);
  const q2x = q1x * 2.6, q2z = q1z * 2.6;
  const n2 = snoise(q2x + 11, q2z + 5, 0.5), n2b = snoise(q2x - 7, q2z + 13, 0.5);
  vx += (n1 + n2 * 0.79) * M.speed * 0.19;
  vz += (n1b + n2b * 0.79) * M.speed * 0.19;

  // A gust adds magnitude *and* rotates the flow. Magnitude alone is a knob.
  const gs = 1 + gustW * 0.85;
  const ca = Math.cos(veer), sa = Math.sin(veer);
  const rx = (vx * ca - vz * sa) * gs;
  const rz = (vx * sa + vz * ca) * gs;

  const prof = height === undefined ? 1 : shear(height);
  return { x: rx * prof, z: rz * prof, gust: gustW, speed: Math.hypot(rx, rz) * prof };
}

/**
 * The cloud deck's wind: faster than the surface and veered off it.
 *
 * A deck that ran with the surface wind would read as painted onto the same
 * sheet of glass. The veer is what separates the two layers.
 */
export function cloudWind(w, t) {
  const M = meanFlow(w, t);
  const d = M.dir + Math.PI + 0.19;
  return { x: Math.sin(d) * M.speed * 2.35, z: Math.cos(d) * M.speed * 2.35 };
}
