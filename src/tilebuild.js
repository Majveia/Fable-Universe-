// Tile geometry for the streaming quadtree planet.
//
// This file runs in two places: imported on the main thread to build the six
// root tiles synchronously (so the globe is never blank), and launched as a
// module Worker pool for every deeper tile. Workers cannot see the page's
// import map, so everything here is pure math — the only import is
// terrain.js, the exact JS port of the orbital shader's height field. That
// shared field is the whole trick: the continents the worker meshes are the
// continents the fragment shader paints are the continents you saw from the
// system view.

import { planetHeight } from './terrain.js';

// cube faces: right, up, normal — one consistent basis shared with quadtree.js
export const FACES = [
  { r: [0, 0, -1], u: [0, 1, 0], n: [1, 0, 0] },
  { r: [0, 0, 1], u: [0, 1, 0], n: [-1, 0, 0] },
  { r: [1, 0, 0], u: [0, 0, -1], n: [0, 1, 0] },
  { r: [1, 0, 0], u: [0, 0, 1], n: [0, -1, 0] },
  { r: [1, 0, 0], u: [0, 1, 0], n: [0, 0, 1] },
  { r: [-1, 0, 0], u: [0, 1, 0], n: [0, 0, -1] },
];

const QW = Math.PI / 4;

/**
 * Tangent-warped cube→sphere. The tan() pre-warp counters the cube's
 * corner stretching, so cells keep near-uniform angular size — one split
 * threshold then works across a whole face.
 */
export function uvToDir(f, u, v, out) {
  const a = Math.tan(QW * u), b = Math.tan(QW * v);
  const F = FACES[f];
  const x = F.n[0] + a * F.r[0] + b * F.u[0];
  const y = F.n[1] + a * F.r[1] + b * F.u[1];
  const z = F.n[2] + a * F.r[2] + b * F.u[2];
  const inv = 1 / Math.hypot(x, y, z);
  out[0] = x * inv; out[1] = y * inv; out[2] = z * inv;
  return out;
}

/** radius of the crust along a unit direction, in draw units */
export function surfaceRadius(dx, dy, dz, job) {
  let h = planetHeight(dx, dy, dz, job.seed);
  if (job.sea) h = Math.max(h, job.ocean);
  return job.R + job.amp * h;
}

/**
 * Build one tile: a res×res displaced grid over the node's UV window in
 * double precision, positions stored relative-to-center (RTC) as float32,
 * geometric normals by central differences over a 1-vertex padded grid,
 * and a dropped skirt around the rim so neighboring depths never crack.
 */
export function buildTile(job) {
  const { face, depth, i, j, res, R } = job;
  const span = 2 / (1 << depth);
  const u0 = -1 + i * span, v0 = -1 + j * span;
  const step = span / (res - 1);

  // padded grid of displaced positions, double precision throughout
  const P = res + 2;
  const px = new Float64Array(P * P), py = new Float64Array(P * P), pz = new Float64Array(P * P);
  const d3 = [0, 0, 0];
  for (let y = 0; y < P; y++) {
    for (let x = 0; x < P; x++) {
      uvToDir(face, u0 + (x - 1) * step, v0 + (y - 1) * step, d3);
      const r = surfaceRadius(d3[0], d3[1], d3[2], job);
      const k = y * P + x;
      px[k] = d3[0] * r; py[k] = d3[1] * r; pz[k] = d3[2] * r;
    }
  }

  // the RTC origin: sphere point under the tile center (no displacement)
  uvToDir(face, u0 + span / 2, v0 + span / 2, d3);
  const cx = d3[0] * R, cy = d3[1] * R, cz = d3[2] * R;

  const nGrid = res * res, nSkirt = 4 * res;
  const pos = new Float32Array((nGrid + nSkirt) * 3);
  const norm = new Float32Array((nGrid + nSkirt) * 3);
  let boundR = 0;

  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const k = (y + 1) * P + (x + 1);
      const o = (y * res + x) * 3;
      const ox = px[k] - cx, oy = py[k] - cy, oz = pz[k] - cz;
      pos[o] = ox; pos[o + 1] = oy; pos[o + 2] = oz;
      const rr = ox * ox + oy * oy + oz * oz;
      if (rr > boundR) boundR = rr;
      // geometric normal: du × dv across the padded neighbors
      const kx0 = k - 1, kx1 = k + 1, ky0 = k - P, ky1 = k + P;
      const ax = px[kx1] - px[kx0], ay = py[kx1] - py[kx0], az = pz[kx1] - pz[kx0];
      const bx = px[ky1] - px[ky0], by = py[ky1] - py[ky0], bz = pz[ky1] - pz[ky0];
      let nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      // orient outward regardless of the face's handedness
      if (nx * px[k] + ny * py[k] + nz * pz[k] < 0) { nx = -nx; ny = -ny; nz = -nz; }
      const inv = 1 / (Math.hypot(nx, ny, nz) || 1);
      norm[o] = nx * inv; norm[o + 1] = ny * inv; norm[o + 2] = nz * inv;
    }
  }

  // skirt: rim vertices dropped toward the planet center, hiding any seam
  // between tiles of different depth
  const drop = (R * span * 0.055 + job.amp * 1.2) * (job.skirtK ?? 1);
  const rim = (edge, t) => edge === 0 ? t : edge === 1 ? (res - 1) * res + t
    : edge === 2 ? t * res : t * res + (res - 1);
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < res; t++) {
      const g = rim(e, t) * 3;
      const o = (nGrid + e * res + t) * 3;
      const wx = pos[g] + cx, wy = pos[g + 1] + cy, wz = pos[g + 2] + cz;
      const inv = drop / (Math.hypot(wx, wy, wz) || 1);
      pos[o] = pos[g] - wx * inv; pos[o + 1] = pos[g + 1] - wy * inv; pos[o + 2] = pos[g + 2] - wz * inv;
      norm[o] = norm[g]; norm[o + 1] = norm[g + 1]; norm[o + 2] = norm[g + 2];
    }
  }

  return {
    key: job.key, pos, norm,
    center: [cx, cy, cz],
    boundR: Math.sqrt(boundR) + drop,
  };
}

/**
 * Index buffer shared by every tile of a given resolution — grid quads plus
 * skirt quads wound both ways (backface culling then never opens a crack,
 * and the depth test keeps the cost at zero).
 */
export function buildIndices(res) {
  const nGrid = res * res;
  const quads = (res - 1) * (res - 1) + 4 * (res - 1) * 2;
  const idx = new Uint16Array(quads * 6);
  let w = 0;
  for (let y = 0; y < res - 1; y++) {
    for (let x = 0; x < res - 1; x++) {
      const a = y * res + x, b = a + 1, c = a + res, d = c + 1;
      // CCW seen from outside: (b−a)×(c−a) = du×dv = outward
      idx[w++] = a; idx[w++] = b; idx[w++] = c;
      idx[w++] = b; idx[w++] = d; idx[w++] = c;
    }
  }
  const rim = (edge, t) => edge === 0 ? t : edge === 1 ? (res - 1) * res + t
    : edge === 2 ? t * res : t * res + (res - 1);
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < res - 1; t++) {
      const a = rim(e, t), b = rim(e, t + 1);
      const a2 = nGrid + e * res + t, b2 = a2 + 1;
      idx[w++] = a; idx[w++] = a2; idx[w++] = b;
      idx[w++] = b; idx[w++] = a2; idx[w++] = b2;
      idx[w++] = a; idx[w++] = b; idx[w++] = a2;
      idx[w++] = b; idx[w++] = b2; idx[w++] = a2;
    }
  }
  return idx;
}

// ---- worker entry ----------------------------------------------------------
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  self.onmessage = (e) => {
    const out = buildTile(e.data);
    self.postMessage(out, [out.pos.buffer, out.norm.buffer]);
  };
}
