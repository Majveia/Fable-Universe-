// The Zel'dovich displacement field — one implementation, three consumers.
//
//     x(q, a) = q + D(a)·ψ(q)
//
// ψ is a sum of plane waves with a power-law amplitude spectrum. The GLSL
// vertex shader evaluates it per particle per frame; `cosmic.js` mirrors it on
// the CPU so a click can find a density peak; `nbody.js` uses it for initial
// conditions; and `tools/verify.js` checks the whole thing against finite
// differences. Four places, and §2.7's lesson is that they drift unless there
// is exactly one definition. This file is that definition.
//
// Pure: no three, no DOM, no clock. Importable in node, which is the point —
// the shader math gets a CPU reference before it enters a render loop (§7.3).
//
// ---------------------------------------------------------------------------
// The deformation tensor
//
//   ψ_i(q) = Σ_m A_m k̂_i sin(θ_m),           θ_m = k_m·q + φ_m
//   M_ij   = ∂ψ_i/∂q_j = Σ_m A_m k_m k̂_i k̂_j cos(θ_m)          (symmetric)
//
// With B = I + D·M, Zel'dovich gives density and velocity divergence exactly,
// from invariants of one tensor:
//
//   1 + δ = 1/det(B)                                   (mass conservation)
//   θ/(aHf) = 3 − I₂(B)/det(B)                         (∇·v, growth cancels)
//
// where I₂ is the sum of the principal 2×2 minors. See docs/plans/M1.md §2 for
// the derivation and the linear-limit check.

import { hash, RNG } from './rng.js';

export const N_MODES = 64;          // plane waves in the displacement field
export const SPECTRAL_TILT = -2.15; // effective amplitude slope ~ k^tilt

/**
 * Synthesize the mode set for a universe.
 *
 * The RNG draw order is load-bearing: it is what makes a seed a permanent
 * public address (§2.3). Six draws per mode — float, float, next, gauss
 * (which consumes two), float — and changing the order changes every
 * universe that was ever shared.
 *
 * @param {number} seed  the universe seed
 * @param {number} box   comoving box in display units
 */
export function buildModes(seed, box) {
  const r = new RNG(hash(seed, 0xc0517c));
  const k0 = (2 * Math.PI) / box;
  const modes = [];
  let sumAmp2 = 0;
  for (let i = 0; i < N_MODES; i++) {
    // isotropic direction
    const z = r.float(-1, 1), th = r.float(0, 2 * Math.PI);
    const s = Math.sqrt(1 - z * z);
    const dir = [s * Math.cos(th), s * Math.sin(th), z];
    // log-uniform |k| over ~1.3 decades; large scales dominate via the tilt
    const mag = k0 * Math.exp(Math.log(1.4) + r.next() * (Math.log(26) - Math.log(1.4)));
    const amp = Math.pow(mag / k0, SPECTRAL_TILT / 2) * Math.abs(r.gauss());
    const phase = r.float(0, 2 * Math.PI);
    modes.push({ k: [dir[0] * mag, dir[1] * mag, dir[2] * mag], khat: dir, klen: mag, amp, phase });
    sumAmp2 += amp * amp;
  }
  // normalize so today's rms displacement ≈ 7.5% of the box — tuned so
  // shell-crossing (filament formation) completes right around a = 1
  const norm = (box * 0.075) / Math.sqrt(sumAmp2 / 2);
  for (const m of modes) m.amp *= norm;
  return modes;
}

/** ψ(q) — the displacement itself */
export function displacement(modes, q, out = [0, 0, 0]) {
  out[0] = out[1] = out[2] = 0;
  for (const m of modes) {
    const s = m.amp * Math.sin(m.k[0] * q[0] + m.k[1] * q[1] + m.k[2] * q[2] + m.phase);
    out[0] += s * m.khat[0]; out[1] += s * m.khat[1]; out[2] += s * m.khat[2];
  }
  return out;
}

/**
 * M_ij = ∂ψ_i/∂q_j, packed as the six independent components of a symmetric
 * 3×3: [xx, yy, zz, xy, xz, yz]. The exact quantity the vertex shader
 * accumulates in its mode loop.
 */
export function deformation(modes, q, out = new Float64Array(6)) {
  out.fill(0);
  for (const m of modes) {
    const c = m.amp * m.klen * Math.cos(m.k[0] * q[0] + m.k[1] * q[1] + m.k[2] * q[2] + m.phase);
    const [x, y, z] = m.khat;
    out[0] += c * x * x; out[1] += c * y * y; out[2] += c * z * z;
    out[3] += c * x * y; out[4] += c * x * z; out[5] += c * y * z;
  }
  return out;
}

/** tr(M) — the linear overdensity is −D·tr(M), and it is the tensor's trace */
export function trace(M) { return M[0] + M[1] + M[2]; }

/**
 * The invariants of B = I + D·M that the colouring reads.
 *
 * `rho` is 1+δ, clamped: det(B) passes through zero at shell crossing, where
 * Zel'dovich stops being valid and the true density is formally infinite.
 * `crossed` marks exactly those elements — the filament and halo skeleton.
 *
 * `thetaNorm` is ∇·v in units of aHf. Negative is infall, positive outflow.
 */
export function invariants(M, D, maxRho = 12) {
  const b0 = 1 + D * M[0], b1 = 1 + D * M[1], b2 = 1 + D * M[2];
  const b3 = D * M[3], b4 = D * M[4], b5 = D * M[5];
  // det of a symmetric 3×3 [[b0,b3,b4],[b3,b1,b5],[b4,b5,b2]]
  const det = b0 * (b1 * b2 - b5 * b5) - b3 * (b3 * b2 - b5 * b4) + b4 * (b3 * b5 - b1 * b4);
  // I₂ = sum of principal 2×2 minors = tr(adj B)
  const i2 = (b0 * b1 - b3 * b3) + (b0 * b2 - b4 * b4) + (b1 * b2 - b5 * b5);
  const crossed = det <= 0;
  const rho = crossed ? maxRho : Math.min(1 / det, maxRho);
  // θ/(aHf) = 3 − I₂/det. Inside a shell-crossed element the expression is
  // meaningless, so report zero flow — which is also what a virialized region
  // physically does.
  const thetaNorm = crossed ? 0 : 3 - i2 / det;
  return { det, i2, rho, thetaNorm, crossed };
}

/** linear δ(q) at growth D — the historical CPU mirror, now one line */
export function deltaLinear(modes, q, D) {
  let div = 0;
  for (const m of modes) {
    div += m.amp * m.klen * Math.cos(m.k[0] * q[0] + m.k[1] * q[1] + m.k[2] * q[2] + m.phase);
  }
  return -D * div;
}

/** ∇δ — used by the click-to-galaxy gradient ascent */
export function gradDeltaLinear(modes, q, D, out = [0, 0, 0]) {
  out[0] = out[1] = out[2] = 0;
  for (const m of modes) {
    const c = D * m.amp * m.klen * Math.sin(m.k[0] * q[0] + m.k[1] * q[1] + m.k[2] * q[2] + m.phase);
    out[0] += c * m.k[0]; out[1] += c * m.k[1]; out[2] += c * m.k[2];
  }
  return out;
}

// ---------------------------------------------------------------------------
// The cosmic-web classification (T-web), and why it earns a place here
//
// §M1 asks the palette for "≥4 distinguishable hue families". `docs/plans/M1.md`
// §12 established, from four directions, that the divergence field cannot
// supply them: it is unimodal, and any strictly monotone readout of a unimodal
// scalar produces one peak with tails. Four modes need a second independent
// physical channel, and the tensor already computed above carries one.
//
// The eigenvalues of B = I + D·M are the stretch factors of the three principal
// axes of a Lagrangian volume element. An axis with 1 + Dλ < 1 is contracting;
// counting how many have contracted past a threshold is the standard
// classification of cosmic structure (Hahn et al. 2007; Forero-Romero et al.
// 2009):
//
//   0 collapsing axes → void        expanding in every direction
//   1                 → sheet/wall  collapsed to a plane
//   2                 → filament    collapsed to a line
//   3                 → knot        collapsed to a point — a cluster
//
// This is not a recolouring of the same number. Divergence is the *trace* of
// the flow; the classification is its *signature*. Two elements can share a
// divergence and be a sheet and a filament, and every image of the cosmic web
// ever published is drawn in these four classes.
//
// The threshold is why the classification evolves. With λ_th = 0 the sign of λ
// never changes — D scales the eigenvalues but cannot flip them — so every
// point would carry the same class forever, which is not a cosmic web, it is a
// stencil. Requiring an axis to have contracted by a measurable fraction makes
// the class a function of D, so voids empty and knots condense as they should.

/**
 * Eigenvalues of the symmetric 3×3 packed as (xx, yy, zz, xy, xz, yz),
 * descending. Closed form (Smith 1961) — no iteration, no branching beyond the
 * diagonal case, and the same arithmetic the shader runs.
 */
export function eigenvalues(M, out = [0, 0, 0]) {
  const [a, b, c, d, e, f] = M;
  const p1 = d * d + e * e + f * f;
  if (p1 === 0) {
    const s = [a, b, c].sort((x, y) => y - x);
    out[0] = s[0]; out[1] = s[1]; out[2] = s[2];
    return out;
  }
  const q = (a + b + c) / 3;
  const p2 = (a - q) ** 2 + (b - q) ** 2 + (c - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  const ip = 1 / p;
  // B = (A − qI)/p has det(B)/2 = cos(3φ), which inverts to the three roots
  const b0 = (a - q) * ip, b1 = (b - q) * ip, b2 = (c - q) * ip;
  const b3 = d * ip, b4 = e * ip, b5 = f * ip;
  const det = b0 * (b1 * b2 - b5 * b5) - b3 * (b3 * b2 - b5 * b4)
            + b4 * (b3 * b5 - b1 * b4);
  const r = Math.min(Math.max(det / 2, -1), 1);
  const phi = Math.acos(r) / 3;
  const e0 = q + 2 * p * Math.cos(phi);
  const e2 = q + 2 * p * Math.cos(phi + (2 * Math.PI) / 3);
  out[0] = e0;
  out[2] = e2;
  out[1] = 3 * q - e0 - e2;   // the trace is exact, so the middle root is free
  return out;
}

/** how much an axis counts as collapsed — one smooth step, shared with GLSL */
const collapsed = (stretch, lth, width) => {
  const t = Math.min(Math.max((lth + width - stretch) / (2 * width), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * The classification, as a *continuous* count in [0, 3].
 *
 * A hard count would put a hue discontinuity between neighbouring tracers and
 * the web would read as four flat stencils laid over each other. Each axis
 * instead contributes a smoothstep of how far past the threshold it has
 * contracted, so the field is spatially smooth — and still lands near integers
 * almost everywhere, because an axis is normally either well collapsed or well
 * expanded and only a thin shell of Lagrangian space sits between. Smooth to
 * look at, multimodal to measure, which is exactly what the clause needs.
 *
 * `lth` is in units of axis stretch: 0.2 means "this axis has contracted by
 * 20%", which is the Forero-Romero band expressed in the quantity that has a
 * physical meaning here.
 */
export function webClass(M, D, { lth = 0.2, width = 0.12, ev = [0, 0, 0] } = {}) {
  eigenvalues(M, ev);
  let n = 0;
  for (let i = 0; i < 3; i++) n += collapsed(1 + D * ev[i], 1 - lth, width);
  return n;
}
