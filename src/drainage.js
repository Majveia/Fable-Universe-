// Where the water went, at the scale you can walk to it.
//
// `material.js:matMoisture()` decides how wet the ground is from three things:
// height above sea, distance to shore, and one global rain scalar. All three
// are true and none of them is *where water goes*, so the sward rises with
// altitude and the hollow that visibly drains the whole valley is the same
// green as the shoulder above it. Stand in it and the ground is a surface. It
// should be a record.
//
// `hydrology.js` already solves this — priority-flood, then D8 accumulation —
// but globally, at 160 cells per cube face, which on an Earth-sized world is a
// couple of hundred kilometres a cell. It decides where rivers are. It cannot
// decide anything at 1.68 m of eye height.
//
// So: the same algorithm, on the landing tile. `ground.js:heightAt()` is a CPU
// height function in local metres and is the field the shader draws (§2.7), so
// a wet seam solved from it is provably in the hollow you can see rather than
// near it.
//
// ---------------------------------------------------------------------------
// What comes out, and why each channel is a physical quantity
//
// **R · flow** — log-normalised contributing area. Where a river would be, if
// this tile were big enough to have one.
//
// **G · wetness** — the topographic wetness index, `ln(a / tan β)`, with `a`
// the upslope area per unit contour width and `β` the local slope. This is the
// standard quantity in the literature and it is the right one: it says a broad
// flat hollow that drains a hillside stays wet, and a steep gully that drains
// the same hillside does not, because the water leaves. Nothing derived from
// height alone can tell those two apart, which is exactly the failure the
// current moisture term has.
//
// **B · silt** — what the water left behind. Grades with flow and against
// slope, because a stream drops what it is carrying when it slows down.
//
// **A · wash** — a braid mask: high flow, low wetness. A channel the water uses
// and does not stay in. That is a dry wash, and it is stones.
//
// ---------------------------------------------------------------------------
// Three-free, on purpose
//
// No three, so `tools/verify.js` can hold the mirror — the property
// `material.js`, `meadow.js` and `cloudshade.js` have, bought the same way.
// This returns typed arrays; `surface.js` wraps them in a `DataTexture`.

/** the landing tile, in metres — the same EXT `surface.js` and `rivers.js` use */
export const DRAIN_EXT = 1400;

/**
 * Cells across the tile.
 *
 * 160 puts a cell at 8.75 m, which is coarser than a footstep and is meant to
 * be: a drainage line is a *valley* feature, and the metre-scale detail on top
 * of it belongs to the material noise that is already running. Sampling finer
 * would cost `heightAt` calls to resolve something the shader is going to
 * overwrite with fbm anyway.
 *
 * That trade is measured rather than assumed, because the sampling *is* the
 * cost — the flood and the D8 are 48 ms of it and `heightAt` is the rest:
 *
 *     res 128 · cell 10.94 m · 134 ms sampling · 141 ms total
 *     res 160 · cell  8.75 m · 136 ms sampling · 184 ms total
 *     res 192 · cell  7.29 m · 212 ms sampling · 281 ms total
 *     res 256 · cell  5.47 m · 327 ms sampling · 386 ms total
 *
 * 184 ms once at build, on the main thread, beside the composition solver's
 * 127–337 ms. §5 budgets 2.5 s to interactive and this is spent inside it.
 */
export const DRAIN_RES = 160;

/** cells of rain before a channel is a channel — `hydrology.js`'s own threshold */
export const CHANNEL_T = 25;

/** the slope floor in `ln(a / tan β)`: flat ground is not infinitely wet */
export const SLOPE_FLOOR = 0.006;

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

// ---------------------------------------------------------------------------
// a binary heap keyed on elevation
//
// The priority flood needs the *lowest unprocessed* cell every step, and a
// linear scan makes that O(n²) — 15 seconds at this resolution rather than 15
// milliseconds. Two parallel typed arrays rather than an array of pairs,
// because the pairs are the allocation.

function makeHeap(cap) {
  const key = new Float64Array(cap);
  const val = new Int32Array(cap);
  let n = 0;
  return {
    get size() { return n; },
    push(k, v) {
      let i = n++;
      key[i] = k; val[i] = v;
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (key[p] <= key[i]) break;
        const tk = key[p]; key[p] = key[i]; key[i] = tk;
        const tv = val[p]; val[p] = val[i]; val[i] = tv;
        i = p;
      }
    },
    pop() {
      const top = val[0];
      n--;
      if (n > 0) {
        key[0] = key[n]; val[0] = val[n];
        let i = 0;
        for (;;) {
          const l = i * 2 + 1, r = l + 1;
          let s = i;
          if (l < n && key[l] < key[s]) s = l;
          if (r < n && key[r] < key[s]) s = r;
          if (s === i) break;
          const tk = key[s]; key[s] = key[i]; key[i] = tk;
          const tv = val[s]; val[s] = val[i]; val[i] = tv;
          i = s;
        }
      }
      return top;
    },
  };
}

/**
 * Solve the tile.
 *
 * @param {(x:number,z:number)=>number} heightAt local metres in, metres out
 * @param {object} [o]
 * @param {number} [o.ext]  tile size in metres
 * @param {number} [o.res]  cells across
 * @param {number} [o.sea]  sea level in the same units, or null for a dry world
 * @returns {{res:number, ext:number, cell:number, height:Float32Array,
 *            filled:Float32Array, down:Int32Array, slope:Float32Array,
 *            acc:Float32Array, flow:Float32Array, wet:Float32Array,
 *            silt:Float32Array, wash:Float32Array}}
 */
export function solveDrainage(heightAt, {
  ext = DRAIN_EXT, res = DRAIN_RES, sea = null,
} = {}) {
  const N = res, C = N * N;
  const cell = ext / N;
  const half = ext / 2;
  const xz = (i) => (i + 0.5) * cell - half;

  // ---- 1 · the surface ---------------------------------------------------
  const E = new Float32Array(C);
  for (let j = 0; j < N; j++) {
    const z = xz(j);
    for (let i = 0; i < N; i++) E[j * N + i] = heightAt(xz(i), z);
  }

  // ---- 2 · priority flood ------------------------------------------------
  //
  // Barnes, Lehman & Mulla's formulation, and the same one `hydrology.js:120`
  // runs: seed with the outflow, always process the lowest cell you have, and
  // raise every neighbour to at least the level you reached it at. Pits fill to
  // their spill point, with an epsilon per step so the filled lakes are not
  // flat and D8 still has a direction to take out of them.
  //
  // The boundary is the outflow here, not the sea, because this is a *tile*: on
  // a dry world, or one whose sea is off the edge, water still has to leave.
  const W = new Float32Array(C);
  const state = new Uint8Array(C);       // 0 unseen · 1 queued · 2 done
  const heap = makeHeap(C + 8);
  const seed = (c) => { if (state[c] === 0) { state[c] = 1; W[c] = E[c]; heap.push(E[c], c); } };
  for (let i = 0; i < N; i++) {
    seed(i); seed((N - 1) * N + i); seed(i * N); seed(i * N + N - 1);
  }
  if (sea !== null) for (let c = 0; c < C; c++) if (E[c] <= sea) seed(c);

  while (heap.size > 0) {
    const c = heap.pop();
    if (state[c] === 2) continue;
    state[c] = 2;
    const e = W[c];
    const cx = c % N, cy = (c / N) | 0;
    for (let k = 0; k < 8; k++) {
      const nx = cx + (k === 0 || k === 4 || k === 5 ? -1 : k === 2 || k === 6 || k === 7 ? 1 : 0);
      const ny = cy + (k === 1 || k === 4 || k === 7 ? -1 : k === 3 || k === 5 || k === 6 ? 1 : 0);
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const b = ny * N + nx;
      if (state[b] === 2) continue;
      const fill = Math.max(E[b], e + 1e-5);
      if (state[b] === 0 || fill < W[b]) {
        W[b] = fill; state[b] = 1; heap.push(fill, b);
      }
    }
  }

  // ---- 3 · D8 down the filled surface ------------------------------------
  const down = new Int32Array(C).fill(-1);
  const slope = new Float32Array(C);
  for (let c = 0; c < C; c++) {
    const cx = c % N, cy = (c / N) | 0;
    let best = -1, bestGrad = 0;
    for (let k = 0; k < 8; k++) {
      const dx = (k === 0 || k === 4 || k === 5 ? -1 : k === 2 || k === 6 || k === 7 ? 1 : 0);
      const dy = (k === 1 || k === 4 || k === 7 ? -1 : k === 3 || k === 5 || k === 6 ? 1 : 0);
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue;
      const b = ny * N + nx;
      // per *distance*, not per step: a diagonal is 1.414 cells away, and
      // ignoring that biases every channel toward the diagonals — the classic
      // D8 artefact, and it looks like a herringbone in the wet map
      const dist = (dx && dy) ? Math.SQRT2 * cell : cell;
      const grad = (W[c] - W[b]) / dist;
      if (grad > bestGrad) { bestGrad = grad; best = b; }
    }
    down[c] = best;
    slope[c] = bestGrad;
  }

  // highest first, so a cell's own inflow is final before it passes it on
  const order = new Int32Array(C);
  for (let c = 0; c < C; c++) order[c] = c;
  order.sort((a, b) => W[b] - W[a]);

  const acc = new Float32Array(C).fill(1);
  for (let x = 0; x < C; x++) {
    const c = order[x];
    if (sea !== null && E[c] <= sea) continue;   // the sea collects, it does not flow
    const d = down[c];
    if (d >= 0) acc[d] += acc[c];
  }

  // ---- 4 · the four channels --------------------------------------------
  const flow = new Float32Array(C);
  const wet = new Float32Array(C);
  const silt = new Float32Array(C);
  const wash = new Float32Array(C);

  let maxAcc = 0;
  for (let c = 0; c < C; c++) if (acc[c] > maxAcc) maxAcc = acc[c];
  const lo = Math.log2(CHANNEL_T), hi = Math.log2(Math.max(maxAcc, CHANNEL_T * 4));

  // The wetness index, normalised across this tile rather than against an
  // absolute: `ln(a/tanβ)` has no natural zero, and what the ground needs to
  // know is which parts of *this* valley are the wet ones.
  const twi = new Float32Array(C);
  let twiLo = Infinity, twiHi = -Infinity;
  for (let c = 0; c < C; c++) {
    const a = (acc[c] * cell * cell) / cell;          // area per unit contour
    const t = Math.log(a / Math.max(slope[c], SLOPE_FLOOR));
    twi[c] = t;
    if (t < twiLo) twiLo = t;
    if (t > twiHi) twiHi = t;
  }
  const twiSpan = Math.max(twiHi - twiLo, 1e-6);

  for (let c = 0; c < C; c++) {
    flow[c] = acc[c] < CHANNEL_T ? 0
      : clamp01((Math.log2(acc[c]) - lo) / (hi - lo));
    wet[c] = clamp01((twi[c] - twiLo) / twiSpan);
    // a stream drops what it carries when it slows: silt goes with water and
    // against gradient
    silt[c] = clamp01(Math.sqrt(flow[c]) * (1 - clamp01(slope[c] * 6)));
    // a channel the water uses and does not stay in
    wash[c] = clamp01(flow[c] * 1.4) * clamp01(1 - wet[c] * 1.6);
  }

  return { res: N, ext, cell, height: E, filled: W, down, slope, acc,
    flow, wet, silt, wash };
}

/**
 * The four channels as one RGBA byte array, ready for a `DataTexture`.
 *
 * Bytes rather than floats: this is a mask, not a measurement, and the shader
 * multiplies it by noise before anything sees it. A float texture would be four
 * times the memory to carry precision that the first `mix()` throws away.
 */
export function packDrainage(d) {
  const C = d.res * d.res;
  const out = new Uint8Array(C * 4);
  for (let c = 0; c < C; c++) {
    out[c * 4] = Math.round(d.flow[c] * 255);
    out[c * 4 + 1] = Math.round(d.wet[c] * 255);
    out[c * 4 + 2] = Math.round(d.silt[c] * 255);
    out[c * 4 + 3] = Math.round(d.wash[c] * 255);
  }
  return out;
}

/**
 * How the tile enters the shader.
 *
 * `uDrainOrigin` and `uDrainSpan` rather than a plain UV so the lookup is in
 * world metres — the tile is placed once around the landing site and the camera
 * walks away from it, and a sampler indexed on anything else would slide.
 * Outside the tile the texture clamps and `drainAt()` fades to zero, so the far
 * field falls back to the height-and-shore moisture that was always there
 * rather than to a hard edge.
 */
export const DRAINAGE_GLSL = /* glsl */`
uniform sampler2D uDrainTex;
uniform vec2  uDrainOrigin;   // the tile's min corner, world xz
uniform float uDrainSpan;     // its size in metres
uniform float uDrainAmt;      // 0 off .. 1 — the world's own rain, folded in

// r flow · g wetness · b silt · a dry-wash braid, all faded outside the tile
vec4 drainAt(vec3 wp) {
  vec2 uv = (wp.xz - uDrainOrigin) / uDrainSpan;
  vec2 e = abs(uv - 0.5);
  float inside = 1.0 - smoothstep(0.40, 0.499, max(e.x, e.y));
  if (inside <= 0.0) return vec4(0.0);
  return texture2D(uDrainTex, clamp(uv, 0.0, 1.0)) * inside * uDrainAmt;
}
`;
