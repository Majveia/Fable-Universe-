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

import { planetHeight, fbm } from './terrain.js';

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

/**
 * Sample a 3×2 cube-face atlas (the watershed corridor map) along a unit
 * direction — bilinear, clamped one texel inside each face so filtering
 * never bleeds across the seams. The tile fragment repeats this arithmetic.
 */
export function sampleHydro(atlas, n, dx, dy, dz) {
  const ax = Math.abs(dx), ay = Math.abs(dy), az = Math.abs(dz);
  let f;
  if (ax >= ay && ax >= az) f = dx > 0 ? 0 : 1;
  else if (ay >= ax && ay >= az) f = dy > 0 ? 2 : 3;
  else f = dz > 0 ? 4 : 5;
  const F = FACES[f];
  const dn = dx * F.n[0] + dy * F.n[1] + dz * F.n[2];
  const a = (dx * F.r[0] + dy * F.r[1] + dz * F.r[2]) / dn;
  const b = (dx * F.u[0] + dy * F.u[1] + dz * F.u[2]) / dn;
  const AW = 3 * n;
  const x = Math.min(Math.max(((a + 1) / 2) * n - 0.5, 0.51), n - 1.51) + (f % 3) * n;
  const y = Math.min(Math.max(((b + 1) / 2) * n - 0.5, 0.51), n - 1.51) + ((f / 3) | 0) * n;
  const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0;
  const k = y0 * AW + x0;
  return ((atlas[k] * (1 - fx) + atlas[k + 1] * fx) * (1 - fy)
    + (atlas[k + AW] * (1 - fx) + atlas[k + AW + 1] * fx) * fy) / 255;
}

/**
 * Radius of the crust along a unit direction, in draw units.
 *
 * One field for every consumer: the macro continents from the orbital
 * shader, plus a kilometre band and a metre band of fbm relief so the
 * ground is worth standing on. The bands exist at every LOD depth —
 * coarse tiles undersample them into sub-pixel noise, fine tiles resolve
 * them — so geomorphing, collision and rendering always agree.
 */
export function surfaceRadius(dx, dy, dz, job) {
  if (job.flat != null) return job.R + job.amp * job.flat;   // the sea sheet
  let h = planetHeight(dx, dy, dz, job.seed);
  // with a real water surface above, the terrain keeps its true bathymetry;
  // without one, the old sea-level clamp still fakes a flat dark sea
  const drowned = job.sea && !job.bathy && h < job.ocean;
  if (drowned) h = job.ocean;
  let r = job.R + job.amp * h;
  if (!drowned) {
    const s = job.seed;
    const inland = 0.25 + Math.min(Math.max((h - (job.sea ? job.ocean : -0.1)) * 2.5, 0), 1.2);

    // rivers: fine analytic meanders, gated and scaled by the watershed
    // corridors — a second fbm's zero-crossings supply the channel shape,
    // but a channel only exists where the global flow solve says water
    // actually passes, and its width and depth follow the accumulated flow.
    // riverT < 1 is the channel; the fragment recomputes the same network.
    let riverT = 9, carve = 0;
    if (job.sea) {
      const above = h - job.ocean;
      const corridor = job.hydro && above > -0.05 && above < 0.5
        ? sampleHydro(job.hydro.atlas, job.hydro.n, dx, dy, dz) : (job.hydro ? 0 : 1);
      if (above > 0.002 && above < 0.42) {
        if (corridor > 0.06) {
          const rv = fbm(dx * 45 + s * 7.7, dy * 45 + s * 3.1, dz * 45 + s * 13.9);
          const w = (0.010 + 0.020 * Math.max(1 - above * 3.5, 0)) * (0.35 + 0.9 * corridor);
          riverT = Math.abs(rv) / w;
          if (riverT < 1) {
            carve = (0.016 + 0.024 * Math.max(1 - above * 3, 0))
              * (1 - riverT * riverT) * Math.min(above * 60, 1) * (0.4 + 0.8 * corridor);
          }
        }
      }
      // erosion history — the terrain remembers the water. Trunk corridors
      // carve broad swales (the more upstream area, the wider the valley
      // reads from the air)…
      if (job.hydro && corridor > 0.12 && above > 0.02 && above < 0.5) {
        const band = Math.min((above - 0.02) * 24, 1) * Math.min((0.5 - above) * 4, 1);
        r -= 0.14 * corridor * corridor * band;
      }
      // …and what the river took, the sea receives: braided deposition
      // fans where the trunks cross the shoreline — bars breach the water
      // where the braid noise runs high, shallows lace between them
      if (job.hydro && job.bathy && corridor > 0.2 && above > -0.05 && above < 0.02) {
        const shore = 1 - Math.min(Math.abs(above + 0.015) / 0.05, 1);
        const braid = 0.5 + 0.5 * fbm(dx * 260 + s * 23.1, dy * 260 + s * 29.3, dz * 260 + s * 31.7);
        r += (0.12 + 0.10 * braid) * corridor * shore;
      }
    }
    const alluvium = riverT < 2.5 ? 0.3 + 0.7 * (riverT / 2.5) : 1;

    r += fbm(dx * 880 + s * 3.7, dy * 880 + s * 5.1, dz * 880 + s * 7.3) * 0.11 * inland * alluvium;
    r += fbm(dx * 21000 + s * 11.3, dy * 21000 + s * 13.7, dz * 21000 + s * 17.9) * 0.014 * inland * alluvium;
    r -= carve;
  }
  // craters: bowls and rims stamped straight into the crust — packed as
  // [siteX, siteY, siteZ, angularRadius, depth] per scar
  const C = job.craters;
  if (C) {
    for (let i = 0; i < C.length; i += 5) {
      const ddx = dx - C[i], ddy = dy - C[i + 1], ddz = dz - C[i + 2];
      const rc = C[i + 3];
      const d2 = ddx * ddx + ddy * ddy + ddz * ddz;
      if (d2 > rc * rc * 4.84) continue;
      const x = Math.sqrt(d2) / rc;
      r += C[i + 4] * (-Math.max(1 - x * x, -0.15) + 0.55 * Math.exp(-9 * (x - 1) * (x - 1)));
    }
  }
  return r;
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
  const morph = new Float32Array((nGrid + nSkirt) * 3);
  const morphN = new Float32Array((nGrid + nSkirt) * 3);
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

  // geomorph targets: what this vertex looks like on the parent's grid.
  // The parent's vertices over this quadrant are exactly this tile's
  // even-index samples, so the target is a bilerp of the surrounding
  // even-index corners — a child spawns wearing its parent's shape and
  // refines as the camera closes. Roots have no parent: target = self.
  for (let y = 0; y < res; y++) {
    for (let x = 0; x < res; x++) {
      const o = (y * res + x) * 3;
      if (depth === 0) {
        morph[o] = pos[o]; morph[o + 1] = pos[o + 1]; morph[o + 2] = pos[o + 2];
        morphN[o] = norm[o]; morphN[o + 1] = norm[o + 1]; morphN[o + 2] = norm[o + 2];
        continue;
      }
      const px0 = x & ~1, py0 = y & ~1;
      const px1 = Math.min(px0 + 2, res - 1), py1 = Math.min(py0 + 2, res - 1);
      const fx = (x - px0) / 2, fy = (y - py0) / 2;
      const k00 = (py0 * res + px0) * 3, k10 = (py0 * res + px1) * 3;
      const k01 = (py1 * res + px0) * 3, k11 = (py1 * res + px1) * 3;
      for (let c = 0; c < 3; c++) {
        morph[o + c] =
          (pos[k00 + c] * (1 - fx) + pos[k10 + c] * fx) * (1 - fy) +
          (pos[k01 + c] * (1 - fx) + pos[k11 + c] * fx) * fy;
        morphN[o + c] =
          (norm[k00 + c] * (1 - fx) + norm[k10 + c] * fx) * (1 - fy) +
          (norm[k01 + c] * (1 - fx) + norm[k11 + c] * fx) * fy;
      }
    }
  }

  // skirt: a shallow insurance stub — geomorphing closes the real cracks
  const drop = (R * span * 0.02 + job.amp * 0.35) * (job.skirtK ?? 1);
  const rim = (edge, t) => edge === 0 ? t : edge === 1 ? (res - 1) * res + t
    : edge === 2 ? t * res : t * res + (res - 1);
  for (let e = 0; e < 4; e++) {
    for (let t = 0; t < res; t++) {
      const g = rim(e, t) * 3;
      const o = (nGrid + e * res + t) * 3;
      const wx = pos[g] + cx, wy = pos[g + 1] + cy, wz = pos[g + 2] + cz;
      const inv = drop / (Math.hypot(wx, wy, wz) || 1);
      const dx = wx * inv, dy = wy * inv, dz = wz * inv;
      pos[o] = pos[g] - dx; pos[o + 1] = pos[g + 1] - dy; pos[o + 2] = pos[g + 2] - dz;
      norm[o] = norm[g]; norm[o + 1] = norm[g + 1]; norm[o + 2] = norm[g + 2];
      morph[o] = morph[g] - dx; morph[o + 1] = morph[g + 1] - dy; morph[o + 2] = morph[g + 2] - dz;
      morphN[o] = morphN[g]; morphN[o + 1] = morphN[g + 1]; morphN[o + 2] = morphN[g + 2];
    }
  }

  return {
    key: job.key, pos, norm, morph, morphN,
    center: [cx, cy, cz],
    boundR: Math.sqrt(boundR) + drop,
    gen: job.gen,
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
    self.postMessage(out, [out.pos.buffer, out.norm.buffer, out.morph.buffer, out.morphN.buffer]);
  };
}
