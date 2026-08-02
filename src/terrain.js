// The planet's height field, on the CPU.
//
// This is an exact arithmetic port of the Ashima simplex noise the orbital
// planet shader uses (planet.js NOISE_GLSL), plus the same fbm/ridged
// pyramids with the same lacunarities and offsets — so JavaScript and GLSL
// agree about every continent. That agreement is what makes descent
// continuous: the world you land on is the world you aimed at from orbit.

// ---- exact Ashima snoise(vec3) port ---------------------------------------

/**
 * `?intnoise=1` — decide the gradient table's sign from integers (§28.2).
 *
 * `x` and `y` in Ashima's gradient table are not arbitrary floats. With `xg`,
 * `yg` integers in 0..6,
 *
 *     x = xg*(2/7) + (0.5/7 - 1) = (4*xg - 13) / 14      exactly
 *     h = 1 - |x| - |y|          = (14 - |4*xg-13| - |4*yg-13|) / 14
 *
 * and seven of the forty-nine cells have h **exactly zero** — (0,3) (1,2) (2,1)
 * (3,0) (4,6) (5,5) (6,4). `sh = h <= 0` is then decided by rounding noise, and
 * float64 and float32 land on opposite sides of all seven: this file reads four
 * as <= 0 and the shader reads the other three. That is the whole of §2.7's
 * parity failure — see docs/plans/M2.md §28.2.
 *
 * Ashima's own semantics settle it: `step(edge, x)` returns 1 when `x >= edge`,
 * so `step(0.0, 0.0)` is 1 and `sh` is -1 for all seven. Neither float path gets
 * that right; the integer test does, on every machine, because there is nothing
 * left to round.
 *
 * Default-off (§7.4): turning it on moves every world, so flipping it is its own
 * commit with the shift measured. `planetHeight` and `snoise` take it as an
 * argument so `tools/` can measure both without a browser.
 */
const INT_NOISE = (() => {
  try { return new URL(window.location.href).searchParams.get('intnoise') === '1'; }
  catch { return false; }
})();

const F3 = 1 / 3, G3 = 1 / 6;

function mod289(x) { return x - Math.floor(x * (1 / 289)) * 289; }
function permute(x) { return mod289(((x * 34) + 10) * x); }
function taylorInvSqrt(r) { return 1.79284291400159 - 0.85373472095314 * r; }

export function snoise(vx, vy, vz, exact = INT_NOISE) {
  // skew
  const s = (vx + vy + vz) * F3;
  const ix = Math.floor(vx + s), iy = Math.floor(vy + s), iz = Math.floor(vz + s);
  const t = (ix + iy + iz) * G3;
  const x0 = vx - ix + t, y0 = vy - iy + t, z0 = vz - iz + t;

  // rank the components (g = step(x0.yzx, x0.xyz))
  const gx = x0 >= y0 ? 1 : 0, gy = y0 >= z0 ? 1 : 0, gz = z0 >= x0 ? 1 : 0;
  const lx = 1 - gx, ly = 1 - gy, lz = 1 - gz;
  // i1 = min(g, l.zxy); i2 = max(g, l.zxy)
  const i1x = Math.min(gx, lz), i1y = Math.min(gy, lx), i1z = Math.min(gz, ly);
  const i2x = Math.max(gx, lz), i2y = Math.max(gy, lx), i2z = Math.max(gz, ly);

  const x1 = x0 - i1x + G3, y1 = y0 - i1y + G3, z1 = z0 - i1z + G3;
  const x2 = x0 - i2x + 2 * G3, y2 = y0 - i2y + 2 * G3, z2 = z0 - i2z + 2 * G3;
  const x3 = x0 - 0.5, y3 = y0 - 0.5, z3 = z0 - 0.5;

  const im = mod289(ix), jm = mod289(iy), km = mod289(iz);
  const p0 = permute(permute(permute(km) + jm) + im);
  const p1 = permute(permute(permute(km + i1z) + jm + i1y) + im + i1x);
  const p2 = permute(permute(permute(km + i2z) + jm + i2y) + im + i2x);
  const p3 = permute(permute(permute(km + 1) + jm + 1) + im + 1);

  // gradient synthesis, faithfully following the vectorized original
  const ns_x = 2 / 7, ns_y = 0.5 / 7 - 1, ns_z = 1 / 7;
  const grad = (p, xs, ys, zs, out) => {
    const j = p - 49 * Math.floor(p * ns_z * ns_z);
    const xg = Math.floor(j * ns_z);
    const yg = Math.floor(j - 7 * xg);
    let gx_ = xg * ns_x + ns_y;
    let gy_ = yg * ns_x + ns_y;
    const gh = 1 - Math.abs(gx_) - Math.abs(gy_);
    // b0/b1, s0/s1, sh folding — scalar equivalent:
    const sx = Math.floor(gx_) * 2 + 1;
    const sy = Math.floor(gy_) * 2 + 1;
    const sh = exact
      ? ((14 - Math.abs(4 * xg - 13) - Math.abs(4 * yg - 13)) <= 0 ? -1 : 0)
      : (gh <= 0 ? -1 : 0);
    gx_ += sx * sh;
    gy_ += sy * sh;
    out[0] = gx_; out[1] = gy_; out[2] = gh;
  };
  const g0 = [0, 0, 0], g1 = [0, 0, 0], g2 = [0, 0, 0], g3 = [0, 0, 0];
  grad(p0, x0, y0, z0, g0);
  grad(p1, x1, y1, z1, g1);
  grad(p2, x2, y2, z2, g2);
  grad(p3, x3, y3, z3, g3);

  const n0 = taylorInvSqrt(g0[0] * g0[0] + g0[1] * g0[1] + g0[2] * g0[2]);
  const n1 = taylorInvSqrt(g1[0] * g1[0] + g1[1] * g1[1] + g1[2] * g1[2]);
  const n2 = taylorInvSqrt(g2[0] * g2[0] + g2[1] * g2[1] + g2[2] * g2[2]);
  const n3 = taylorInvSqrt(g3[0] * g3[0] + g3[1] * g3[1] + g3[2] * g3[2]);

  let m0 = Math.max(0.5 - (x0 * x0 + y0 * y0 + z0 * z0), 0); m0 *= m0;
  let m1 = Math.max(0.5 - (x1 * x1 + y1 * y1 + z1 * z1), 0); m1 *= m1;
  let m2 = Math.max(0.5 - (x2 * x2 + y2 * y2 + z2 * z2), 0); m2 *= m2;
  let m3 = Math.max(0.5 - (x3 * x3 + y3 * y3 + z3 * z3), 0); m3 *= m3;

  return 105 * (
    m0 * m0 * n0 * (g0[0] * x0 + g0[1] * y0 + g0[2] * z0) +
    m1 * m1 * n1 * (g1[0] * x1 + g1[1] * y1 + g1[2] * z1) +
    m2 * m2 * n2 * (g2[0] * x2 + g2[1] * y2 + g2[2] * z2) +
    m3 * m3 * n3 * (g3[0] * x3 + g3[1] * y3 + g3[2] * z3));
}

// ---- the same pyramids the shader stacks ----------------------------------

export function fbm(x, y, z, exact = INT_NOISE) {
  let v = 0, a = 0.5;
  for (let i = 0; i < 5; i++) {
    v += a * snoise(x, y, z, exact);
    x = x * 2.07 + 11.3; y = y * 2.07 + 11.3; z = z * 2.07 + 11.3;
    a *= 0.5;
  }
  return v;
}

export function ridged(x, y, z, exact = INT_NOISE) {
  let v = 0, a = 0.5;
  for (let i = 0; i < 4; i++) {
    v += a * (1 - Math.abs(snoise(x, y, z, exact)));
    x = x * 2.13 + 5.7; y = y * 2.13 + 5.7; z = z * 2.13 + 5.7;
    a *= 0.5;
  }
  return v;
}

/**
 * Height of a solid planet's crust along unit direction (dx,dy,dz) —
 * the exact expression from the orbital fragment shader:
 *   h = fbm(p·2.3 + sd)·0.75 + ridged(p·5 + sd·1.7)·0.45 − 0.28
 */
export function planetHeight(dx, dy, dz, noiseSeed, exact = INT_NOISE) {
  const sx = noiseSeed * 17.31, sy = noiseSeed * 9.17, sz = noiseSeed * 31.7;
  const cont = fbm(dx * 2.3 + sx, dy * 2.3 + sy, dz * 2.3 + sz, exact);
  const mount = ridged(dx * 5 + sx * 1.7, dy * 5 + sy * 1.7, dz * 5 + sz * 1.7, exact);
  return cont * 0.75 + mount * 0.45 - 0.28;
}

/**
 * Choose where to land: scan the globe for the kind of ground worth walking —
 * coastal lowland when there's a sea, any modest terrain otherwise.
 * Deterministic per world. Returns a unit vector.
 */
export function findLandingSite(pp, hashSeed) {
  let s = hashSeed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ocean = pp.oceanLevel > -0.5 ? pp.oceanLevel : 0.0;
  let best = [0, 1, 0], bestScore = -1e9;
  for (let i = 0; i < 600; i++) {
    const z = rand() * 2 - 1, th = rand() * Math.PI * 2;
    const q = Math.sqrt(1 - z * z);
    const dx = q * Math.cos(th), dy = z, dz = q * Math.sin(th);
    const h = planetHeight(dx, dy, dz, pp.noiseSeed) - ocean;
    // sweet spot: metres above the waterline, so local relief carves a shore
    const score = -Math.abs(h - 0.018) * 4 - (h < 0.004 ? 3 : 0) - (h > 0.35 ? 1.5 : 0);
    if (score > bestScore) { bestScore = score; best = [dx, dy, dz]; }
  }
  return best;
}
