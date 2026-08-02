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
//
// ---------------------------------------------------------------------------
// Two faces, and the seam chosen so that as little as possible can drift
//
// §M3 wants this field on the GPU (a 256² target, so twelve million grass
// vertices can each read it in one fetch) and on the CPU (so smoke, herds, the
// camera and audio can ask without a readback). That is the same
// two-implementations-of-one-function shape as §2.7's height field, and §2.7
// cost a day: the pair drifted, was never tested, and failed by 46×.
//
// The lesson §2.7 actually teaches is not "test the pair" — it is **make the
// pair smaller**. So the field is cut in two along the line where the seam is
// cheapest:
//
//   the seeded half   which lap each gust cell is on, what parameters it drew,
//                     where the mean flow has meandered to. Depends on the seed
//                     and on `t` and on nothing else — so it is resolved
//                     **once per frame, on the CPU only**, into thirty-eight
//                     floats, and uploaded. There is exactly one implementation
//                     and it cannot drift because there is nothing to drift
//                     from. `hash` and `RNG` never reach a shader.
//
//   the arithmetic    projections, three gust profiles, four octaves of
//                     advected noise, a rotation. Depends on position, so it
//                     has to exist on both sides. `windSample` and `WIND_GLSL`
//                     are that half, mirrored statement for statement, and
//                     `tools/pixeldiff.js --suite wind` is the gate on it.
//
// `windAt` is then a two-line composition of the two, which means the CPU path
// is not a *reimplementation* of anything — it is the same `windSample` the
// shader mirrors, called with the same uniforms the shader receives.
//
// The one thing this does not fix is `snoise`, which the arithmetic half calls
// four times and which is float64 here and float32 there. That is §2.7's own
// residue and the suite measures it rather than assuming it away: the advected
// coordinate grows linearly in `t`, so parity has a shelf life, and the suite
// prints where it ends.
//
// `WIND_GLSL` deliberately does **not** carry a copy of `snoise`. It requires
// one to be in scope, and the caller concatenates `NOISE_GLSL` from
// `planet.js` — the same string the orbital shader compiles, the one §2.7's
// parity test is green against. A private copy here would be a third
// definition of a function this repo has already been bitten by having two of.
// It is also why this module imports no three: `verify.js` and `pixeldiff.js`
// both load it under node, exactly as `wash.js` is split from `soft.js`.

import { hash, RNG } from './rng.js';
import { snoise as snoiseAny } from './terrain.js';

/**
 * The noise, on the **exact** gradient path, always — and the shader half asks
 * `planet.js` for the matching chunk rather than taking whatever `?intnoise`
 * selected.
 *
 * docs/plans/M2.md §28.5 found the fault: seven of Ashima's forty-nine gradient
 * cells have `h` exactly zero, `sh = -step(h, 0)` is then decided by rounding
 * noise, and float32 and float64 land on opposite sides of all seven. It is 14%
 * of the table, it does not depend on coordinate magnitude, and it makes the
 * two faces of *any* field disagree on about a fifth of samples by up to the
 * full range of the noise. §28.7 closed it on the integer path.
 *
 * `?intnoise=1` is still default-off for the terrain because flipping it moves
 * every world once and re-takes the `ground` goldens — a human's call. **The
 * wind has no worlds to move and no goldens to re-take.** It is new, so it pays
 * none of that price, and taking the exact path from the first commit is what
 * makes M3's parity gate a statement about the port rather than a re-run of an
 * open finding about the noise.
 *
 * It also matters more here than there. §M3's field is the one system that
 * touches every other system, and a gradient that flips on driver rounding is
 * exactly the "different answer on a different machine" that docs/plans/M3.md
 * §3 refused to accept from `Math.random()`. Refusing it from `Math.random()`
 * and then accepting it from `step()` would be an odd place to stop.
 */
const snoise = (x, y, z) => snoiseAny(x, y, z, true);

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
 * The seeded half, resolved once for a whole frame — see the header.
 *
 * Thirty-eight floats: the mean flow, the advection offset, and six cells.
 * Every seed-dependent decision in the field is made here and nowhere else,
 * which is what keeps `hash` and `RNG` out of the shader entirely.
 *
 * **`adv` is formed here on purpose.** The shader needs the turbulence sampled
 * at `x − v·t`, and `v·t` reaches fifteen kilometres after an hour. Handing a
 * shader `t` and asking it to form that product costs a float32 multiply of two
 * large numbers on every one of twelve million vertices; handing it the product
 * costs nothing and is formed in doubles.
 *
 * Cached on `t` alone, because a frame asks for this once and then samples it
 * a few hundred times — per creature, per emitter, per audio tap. The cache
 * cannot break determinism: the value is a pure function of `(seed, t)`, so a
 * hit and a miss return the same thirty-eight floats. `verify.js`'s
 * "sampling it elsewhere first changes nothing" check is the guard on that.
 */
export function windUniforms(w, t) {
  if (w._uAt === t) return w._u;

  const M = meanFlow(w, t);
  const cellS = new Float64Array(CELLS * 4);   // station, cross offset, length, width
  const cellP = new Float64Array(CELLS * 2);   // amplitude, veer

  const adv = w.baseSpeed * 1.25 * t;
  for (let k = 0; k < w.cells.length; k++) {
    const cell = w.cells[k];
    const raw = cell.s0 + adv;
    const generation = Math.floor(raw / CELL_SPAN);
    const p = cellParams(w, cell.i, generation);
    cellS[k * 4] = raw - generation * CELL_SPAN - CELL_SPAN * 0.5;
    cellS[k * 4 + 1] = p.c;
    cellS[k * 4 + 2] = p.len;
    cellS[k * 4 + 3] = p.wid;
    // gustiness folded in here rather than at the multiply, so the shader
    // carries one fewer uniform and one fewer instruction per cell per vertex
    cellP[k * 2] = p.amp * w.gustiness;
    cellP[k * 2 + 1] = p.veer;
  }

  const u = {
    mean: [M.fwd[0], M.fwd[1], M.speed],
    adv: [M.fwd[0] * M.speed * t, M.fwd[1] * M.speed * t],
    cellS, cellP,
  };
  w._uAt = t; w._u = u;
  return u;
}

/**
 * The arithmetic half. `WIND_GLSL` mirrors this statement for statement, and
 * `tools/pixeldiff.js --suite wind` is the gate that says so.
 *
 * Returns the horizontal velocity at the reference height, the gust weight that
 * produced it (which the grass uses for its wind flash, §9.5), and the speed.
 * The boundary layer is *not* applied here — it is one `log` of a height the
 * caller knows and the field does not, so it stays out of the 2D field and out
 * of the render target.
 */
export function windSample(U, x, z) {
  const fx = U.mean[0], fz = U.mean[1], sp = U.mean[2];
  const sx = -fz, sz = fx;
  let vx = fx * sp, vz = fz * sp;

  const along = x * fx + z * fz;
  const across = x * sx + z * sz;

  // Gust cells. Each is a front: it arrives, it passes, it leaves.
  let gustW = 0, veer = 0;
  for (let k = 0; k < CELLS; k++) {
    const s = U.cellS[k * 4], c = U.cellS[k * 4 + 1];
    const len = U.cellS[k * 4 + 2], wid = U.cellS[k * 4 + 3];
    const u = (along - s) / len;
    // ahead of the front, or long past its tail — contributes nothing
    if (u > 0.16 || u < -6.0) continue;
    const head = smoothstep(0.14, 0, u);          // the sharp leading edge
    const body = Math.exp(u * 2.05);              // the exponential tail
    const cw = Math.exp(-Math.pow(Math.abs(across - c) / (wid * 0.5), 2.3));
    const g = U.cellP[k * 2] * head * body * cw;
    gustW += g;
    veer += g * U.cellP[k * 2 + 1];
  }

  // Turbulence, advected with the flow (Taylor): sampled at x − v·t, so the
  // eddies are carried along rather than wobbling in place.
  const q1x = (x - U.adv[0]) * 0.0125, q1z = (z - U.adv[1]) * 0.0125;
  const n1 = snoise(q1x, q1z, 0.5), n1b = snoise(q1x + 3.7, q1z - 1.9, 0.5);
  const q2x = q1x * 2.6, q2z = q1z * 2.6;
  const n2 = snoise(q2x + 11, q2z + 5, 0.5), n2b = snoise(q2x - 7, q2z + 13, 0.5);
  vx += (n1 + n2 * 0.79) * sp * 0.19;
  vz += (n1b + n2b * 0.79) * sp * 0.19;

  // A gust adds magnitude *and* rotates the flow. Magnitude alone is a knob.
  const gs = 1 + gustW * 0.85;
  const ca = Math.cos(veer), sa = Math.sin(veer);
  return { x: (vx * ca - vz * sa) * gs, z: (vx * sa + vz * ca) * gs, gust: gustW };
}

/**
 * The wind at a point, at a height, at a time. Pure.
 *
 * Two lines, and that is the point: the CPU path is not a second
 * implementation, it is the same `windSample` the shader mirrors, fed the same
 * uniforms the shader receives.
 */
export function windAt(w, x, z, height, t) {
  const r = windSample(windUniforms(w, t), x, z);
  const prof = height === undefined ? 1 : shear(height);
  return { x: r.x * prof, z: r.z * prof, gust: r.gust, speed: Math.hypot(r.x, r.z) * prof };
}

/**
 * The field's full scale, in metres per second, for anything that has to store
 * it in a fixed range — the render target, and the parity gate's normalisation.
 *
 * Derived rather than guessed: the base flow is `speed`, turbulence adds at
 * most `(1 + 0.79)·0.19 ≈ 0.34` of it, and the gust factor `1 + 0.85·gustW`
 * reaches about 4 when two fronts overlap. 8× leaves better than a factor of
 * two in hand, and `tools/pixeldiff.js --suite wind` prints the observed
 * maximum so the margin is measured rather than asserted.
 */
export const windScale = (w) => w.baseSpeed * 8;

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

// ---------------------------------------------------------------------------
// The window the GPU copy lives in
//
// `src/windfield.js` holds the render target; the *addressing* lives here,
// because it is arithmetic rather than plumbing and `verify.js` has to be able
// to reach it without a browser. Get it wrong and the field is subtly,
// permanently offset from the world — which looks like the wind blowing from
// the wrong bearing, and would be chased for a day in the wrong module.

/** the reference's own numbers: 440 m across 256 texels, so 1.72 m each */
export const WIND_SPAN = 440;
export const WIND_SIZE = 256;
export const windTexel = () => WIND_SPAN / WIND_SIZE;

/**
 * The window origin for a camera at `(x, z)`, snapped to the texel lattice.
 *
 * Snapped, and not tracking continuously: a sliding lattice means a blade
 * standing still reads a slightly different point every frame, which reads as a
 * shimmer no filter can remove because the error is in the sampling. `WIND_SPAN`
 * is a whole number of texels by construction, so the half-span subtraction
 * keeps the origin on the lattice too.
 */
export function windWindow(x, z) {
  const t = windTexel();
  return [Math.round(x / t) * t - WIND_SPAN * 0.5, Math.round(z / t) * t - WIND_SPAN * 0.5];
}

// ---------------------------------------------------------------------------
// The shader half

/**
 * `windSample` and `shear`, in GLSL, mirrored statement for statement.
 *
 * **Requires `snoise(vec3)` already in scope** — concatenate `NOISE_GLSL` from
 * `planet.js` ahead of it. See the header for why there is no copy here.
 *
 * Declares its own uniforms, all prefixed uWind, filled by `windUniformBlock`.
 * Two entry points, because the caller knows a height and the 2D field does
 * not: `windField(vec2)` is the velocity and gust at the reference height, and
 * `windShear(float)` is the boundary-layer profile to multiply it by. Keeping
 * them apart is what lets a blade evaluate the expensive half once at its root
 * and the cheap half per vertex.
 */
export const WIND_GLSL = /* glsl */`
uniform vec3 uWindMean;             // (fwd.x, fwd.z, mean speed), fwd = where the air goes
uniform vec2 uWindAdv;              // mean flow x elapsed time, metres; formed in float64
uniform vec4 uWindCellS[${CELLS}];  // (station, cross offset, length, width)
uniform vec2 uWindCellP[${CELLS}];  // (amplitude x gustiness, veer)

float windShear(float h) {
  return log((max(h, 0.015) + 0.06) / 0.06) * 0.19523;
}

vec3 windField(vec2 P) {
  vec2 fwd = uWindMean.xy;
  vec2 sid = vec2(-fwd.y, fwd.x);
  float sp = uWindMean.z;
  vec2 v = fwd * sp;

  float along = dot(P, fwd);
  float across = dot(P, sid);

  float gustW = 0.0;
  float veer = 0.0;
  for (int i = 0; i < ${CELLS}; i++) {
    vec4 S = uWindCellS[i];
    float u = (along - S.x) / S.z;
    if (u > 0.16 || u < -6.0) continue;
    // smoothstep(0.14, 0.0, u) written out. GLSL leaves smoothstep undefined
    // when edge0 >= edge1, and an undefined that happens to work on the driver
    // in front of you is the exact shape of a determinism bug (2.3).
    float e = clamp((u - 0.14) / -0.14, 0.0, 1.0);
    float head = e * e * (3.0 - 2.0 * e);          // the sharp leading edge
    float body = exp(u * 2.05);                    // the exponential tail
    float cw = exp(-pow(abs(across - S.y) / (S.w * 0.5), 2.3));
    float g = uWindCellP[i].x * head * body * cw;
    gustW += g;
    veer += g * uWindCellP[i].y;
  }

  vec2 q1 = (P - uWindAdv) * 0.0125;
  float n1  = snoise(vec3(q1.x, q1.y, 0.5));
  float n1b = snoise(vec3(q1.x + 3.7, q1.y - 1.9, 0.5));
  vec2 q2 = q1 * 2.6;
  float n2  = snoise(vec3(q2.x + 11.0, q2.y + 5.0, 0.5));
  float n2b = snoise(vec3(q2.x - 7.0, q2.y + 13.0, 0.5));
  v.x += (n1 + n2 * 0.79) * sp * 0.19;
  v.y += (n1b + n2b * 0.79) * sp * 0.19;

  float gs = 1.0 + gustW * 0.85;
  float ca = cos(veer), sa = sin(veer);
  return vec3((v.x * ca - v.y * sa) * gs, (v.x * sa + v.y * ca) * gs, gustW);
}
`;

/**
 * The uniform block `WIND_GLSL` declares, as three.js uniforms — flat typed
 * arrays, so this module still imports no three (see the header).
 */
export function windUniformBlock() {
  return {
    uWindMean: { value: new Float32Array(3) },
    uWindAdv: { value: new Float32Array(2) },
    uWindCellS: { value: new Float32Array(CELLS * 4) },
    uWindCellP: { value: new Float32Array(CELLS * 2) },
  };
}

/** re-point an existing block at time `t`. One call per frame, per material. */
export function syncWindUniforms(block, w, t) {
  const u = windUniforms(w, t);
  block.uWindMean.value.set(u.mean);
  block.uWindAdv.value.set(u.adv);
  block.uWindCellS.value.set(u.cellS);
  block.uWindCellP.value.set(u.cellP);
  return block;
}
