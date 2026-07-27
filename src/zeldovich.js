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
