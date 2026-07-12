// The watershed, solved.
//
// A coarse global drainage network baked once per world: heights on a
// gnomonic cube grid (the macro continents plus the kilometre relief band —
// the scales rivers actually answer to), depressions filled by
// priority-flood seeded from the sea, then D8 steepest-descent flow
// accumulation. The result is a corridor map — every corridor provably
// drains to the ocean — packed into a 3×2 face atlas of bytes that the
// tile worker samples in JS and the tile fragment samples as a texture,
// with the same mapping arithmetic on both sides. The old analytic
// channels survive as the fine meanders *inside* these corridors.

import { planetHeight, fbm } from './terrain.js';
import { FACES } from './tilebuild.js';

export const HYDRO_N = 160;              // cells per cube-face edge

/** direction of a cell center (gnomonic, NOT tangent-warped) */
function cellDir(f, i, j, n, out) {
  const a = ((i + 0.5) / n) * 2 - 1, b = ((j + 0.5) / n) * 2 - 1;
  const F = FACES[f];
  const x = F.n[0] + a * F.r[0] + b * F.u[0];
  const y = F.n[1] + a * F.r[1] + b * F.u[1];
  const z = F.n[2] + a * F.r[2] + b * F.u[2];
  const inv = 1 / Math.hypot(x, y, z);
  out[0] = x * inv; out[1] = y * inv; out[2] = z * inv;
  return out;
}

/** which cell contains a direction — the inverse of cellDir */
function dirCell(dx, dy, dz, n) {
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  let f;
  if (ax >= ay && ax >= az) f = dx > 0 ? 0 : 1;
  else if (ay >= ax && ay >= az) f = dy > 0 ? 2 : 3;
  else f = dz > 0 ? 4 : 5;
  const F = FACES[f];
  const dn = dx * F.n[0] + dy * F.n[1] + dz * F.n[2];
  const a = (dx * F.r[0] + dy * F.r[1] + dz * F.r[2]) / dn;
  const b = (dx * F.u[0] + dy * F.u[1] + dz * F.u[2]) / dn;
  const i = Math.min(Math.max(((a + 1) / 2) * n | 0, 0), n - 1);
  const j = Math.min(Math.max(((b + 1) / 2) * n | 0, 0), n - 1);
  return f * n * n + j * n + i;
}

export function solveWatershed(seed, ocean, amp) {
  const n = HYDRO_N;
  const C = 6 * n * n;
  const d3 = [0, 0, 0];

  // ---- elevations at cell centers (radius units above the sea) ----------
  const E = new Float32Array(C);
  for (let f = 0; f < 6; f++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        cellDir(f, i, j, n, d3);
        const h = planetHeight(d3[0], d3[1], d3[2], seed);
        let e = amp * (h - ocean);
        e += fbm(d3[0] * 880 + seed * 3.7, d3[1] * 880 + seed * 5.1, d3[2] * 880 + seed * 7.3) * 0.11;
        E[f * n * n + j * n + i] = e;
      }
    }
  }

  // ---- neighbors (8-connected, correct across cube-face seams) ----------
  const nbr = (cell, k) => {
    const f = (cell / (n * n)) | 0;
    const rem = cell - f * n * n;
    const j = (rem / n) | 0, i = rem - j * n;
    const di = [1, -1, 0, 0, 1, 1, -1, -1][k];
    const dj = [0, 0, 1, -1, 1, -1, 1, -1][k];
    const ii = i + di, jj = j + dj;
    if (ii >= 0 && ii < n && jj >= 0 && jj < n) return f * n * n + jj * n + ii;
    // stepped off the face: rebuild the direction and find the true cell
    const a = ((ii + 0.5) / n) * 2 - 1, b = ((jj + 0.5) / n) * 2 - 1;
    const F = FACES[f];
    const x = F.n[0] + a * F.r[0] + b * F.u[0];
    const y = F.n[1] + a * F.r[1] + b * F.u[1];
    const z = F.n[2] + a * F.r[2] + b * F.u[2];
    return dirCell(x, y, z, n);
  };

  // ---- priority-flood from the sea: fills every pit ----------------------
  const W = new Float32Array(C);          // filled ("water") elevation
  const state = new Uint8Array(C);        // 0 unseen · 1 queued · 2 done
  const heap = new Float64Array(C + 1);   // binary min-heap of packed (elev, cell)
  const heapCell = new Int32Array(C + 1);
  let hn = 0;
  const push = (e, c) => {
    let k = ++hn;
    heap[k] = e; heapCell[k] = c;
    while (k > 1) {
      const p = k >> 1;
      if (heap[p] <= heap[k]) break;
      const te = heap[p]; heap[p] = heap[k]; heap[k] = te;
      const tc = heapCell[p]; heapCell[p] = heapCell[k]; heapCell[k] = tc;
      k = p;
    }
  };
  const pop = () => {
    const c = heapCell[1], e = heap[1];
    heap[1] = heap[hn]; heapCell[1] = heapCell[hn]; hn--;
    let k = 1;
    for (;;) {
      let m = k;
      const l = k * 2, r = l + 1;
      if (l <= hn && heap[l] < heap[m]) m = l;
      if (r <= hn && heap[r] < heap[m]) m = r;
      if (m === k) break;
      const te = heap[m]; heap[m] = heap[k]; heap[k] = te;
      const tc = heapCell[m]; heapCell[m] = heapCell[k]; heapCell[k] = tc;
      k = m;
    }
    return [e, c];
  };

  for (let c = 0; c < C; c++) {
    if (E[c] <= 0) { W[c] = E[c]; state[c] = 1; push(E[c], c); }
  }
  let seeded = hn;
  if (!seeded) return null;               // a world without a sea has no rivers
  while (hn > 0) {
    const [e, c] = pop();
    if (state[c] === 2) continue;
    state[c] = 2;
    W[c] = e;
    for (let k = 0; k < 8; k++) {
      const b = nbr(c, k);
      if (state[b] === 2) continue;
      // pits rise to their spill level — plus an epsilon per step, so the
      // filled lakes are not flat and D8 can drain them to the pour point
      const fill = Math.max(E[b], e + 1e-5);
      if (state[b] === 0 || fill < W[b]) {
        W[b] = fill;
        state[b] = 1;
        push(fill, b);
      }
    }
  }

  // ---- D8 accumulation down the filled surface ---------------------------
  const order = new Int32Array(C);
  for (let c = 0; c < C; c++) order[c] = c;
  const Warr = W;
  order.sort((a, b) => Warr[b] - Warr[a]);   // highest first
  const acc = new Float32Array(C).fill(1);
  const down = new Int32Array(C).fill(-1);
  for (let c = 0; c < C; c++) {
    let best = -1, bestDrop = 0;
    for (let k = 0; k < 8; k++) {
      const b = nbr(c, k);
      const drop = W[c] - W[b];
      if (drop > bestDrop) { bestDrop = drop; best = b; }
    }
    down[c] = best;
  }
  for (let x = 0; x < C; x++) {
    const c = order[x];
    if (E[c] <= 0) continue;              // the sea collects, it doesn't flow
    const d = down[c];
    if (d >= 0) acc[d] += acc[c];
  }

  // ---- corridor map: log-scaled flow, packed into a 3×2 atlas ------------
  const T = 25;                            // cells of rain before a river is born
  let maxAcc = 0;
  for (let c = 0; c < C; c++) if (E[c] > 0 && acc[c] > maxAcc) maxAcc = acc[c];
  const lo = Math.log2(T), hi = Math.log2(Math.max(maxAcc, T * 4));
  const flow = new Float32Array(C);
  for (let c = 0; c < C; c++) {
    if (E[c] <= 0 || acc[c] < T) continue;
    flow[c] = Math.min(Math.max((Math.log2(acc[c]) - lo) / (hi - lo), 0), 1);
  }
  // one widening pass so corridors survive bilinear sampling
  const flow2 = new Float32Array(C);
  for (let c = 0; c < C; c++) {
    let m = flow[c];
    for (let k = 0; k < 4; k++) m = Math.max(m, flow[nbr(c, k)] * 0.72);
    flow2[c] = m;
  }

  const AW = 3 * n, AH = 2 * n;
  const atlas = new Uint8Array(AW * AH);
  for (let f = 0; f < 6; f++) {
    const cx = (f % 3) * n, cy = ((f / 3) | 0) * n;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        atlas[(cy + j) * AW + cx + i] = flow2[f * n * n + j * n + i] * 255;
      }
    }
  }
  return { atlas, n, riverCells: flow.reduce((s, v) => s + (v > 0 ? 1 : 0), 0), down, W, E, acc };
}

// (the atlas sampler lives in tilebuild.js so the worker can use it without
// a circular import — the fragment shader repeats the same arithmetic)
