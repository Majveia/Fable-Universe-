// Numeric verification, run offline before anything reaches a render loop.
//
//   node tools/verify.js [suite]
//
// §7.3: "New shader math gets a CPU reference implementation ... before it
// goes near the render loop." §2.7 says the same thing about the terrain
// height field, and §11 records that a drift between the two "will look like a
// rendering bug and cost a day."
//
// These are not snapshot tests. A snapshot of the implementation under test
// only proves it has not changed, which is the least interesting property it
// has. Each suite computes the answer a second, independent way — adaptive
// quadrature against a lookup table, finite differences against an analytic
// derivative — and asserts the two agree.

import { COSMO } from '../src/cosmology.js';
import {
  buildModes, deformation, deltaLinear, displacement, invariants, trace,
} from '../src/zeldovich.js';

let failures = 0;
let checks = 0;

function ok(name, pass, detail = '') {
  checks++;
  if (!pass) failures++;
  console.log(`${pass ? '  ok  ' : '  FAIL'} ${name}${detail ? '   ' + detail : ''}`);
}

function near(name, got, want, tol) {
  const err = Math.abs(got - want);
  const rel = err / Math.max(Math.abs(want), 1e-12);
  ok(name, err <= tol || rel <= tol,
    `got ${got.toPrecision(8)} want ${want.toPrecision(8)} · err ${err.toExponential(2)}`);
}

// ---------------------------------------------------------------------------
// suite: cosmology
//
// cosmology.js tabulates D(a) and t(a) on a log grid and interpolates. The
// independent reference is adaptive Simpson on the same integrals, to a
// tolerance far tighter than the table's. This validates the table for any
// A_MAX and N_TAB — so widening the range to let deep time run past the
// present day (M1 §4) cannot silently coarsen the range that already mattered.

const OM = 0.315, OL = 0.685, H0_INV_GYR = 14.51;
const E = (a) => Math.sqrt(OM / (a * a * a) + OL);

/** adaptive Simpson on [a,b] */
function simpson(f, a, b, tol = 1e-13, depth = 50) {
  const c = (a + b) / 2;
  const h = b - a;
  const fa = f(a), fb = f(b), fc = f(c);
  const s = (h / 6) * (fa + 4 * fc + fb);
  const rec = (a, b, fa, fb, fc, s, tol, depth) => {
    const c = (a + b) / 2, h = b - a;
    const d = (a + c) / 2, e = (c + b) / 2;
    const fd = f(d), fe = f(e);
    const sl = (h / 12) * (fa + 4 * fd + fc);
    const sr = (h / 12) * (fc + 4 * fe + fb);
    if (depth <= 0 || Math.abs(sl + sr - s) <= 15 * tol) return sl + sr + (sl + sr - s) / 15;
    return rec(a, c, fa, fc, fd, sl, tol / 2, depth - 1)
      + rec(c, b, fc, fb, fe, sr, tol / 2, depth - 1);
  };
  return rec(a, b, fa, fb, fc, s, tol, depth);
}

/** D(a) ∝ E(a)·∫₀^a da'/(a'E(a'))³, normalized to D(1)=1 — reference version */
function growthRef(a) {
  const integral = (x) => {
    // the integrand ~ a^{3/2} near zero; split off an analytic head so the
    // quadrature never has to resolve the singular-looking region
    const aSmall = Math.min(1e-4, x);
    const head = (2 / 5) * Math.pow(aSmall, 2.5) / Math.pow(OM, 1.5);
    return head + (x > aSmall ? simpson((t) => 1 / Math.pow(t * E(t), 3), aSmall, x) : 0);
  };
  const raw = (x) => 2.5 * OM * E(x) * integral(x);
  return raw(a) / raw(1);
}

function ageRef(a) {
  const aSmall = Math.min(1e-4, a);
  const head = (2 / 3) * Math.pow(aSmall, 1.5) / Math.sqrt(OM);
  const tail = a > aSmall ? simpson((t) => 1 / (t * E(t)), aSmall, a) : 0;
  return (head + tail) * H0_INV_GYR;
}

function suiteCosmology() {
  console.log('\ncosmology — tabulated D(a), t(a) vs adaptive Simpson');

  near('D(1) = 1 exactly', COSMO.growth(1), 1, 1e-12);

  let worstD = 0, worstDa = 0, worstT = 0, worstTa = 0;
  for (let i = 0; i <= 300; i++) {
    const a = Math.exp(Math.log(2e-3) + (Math.log(1.5) - Math.log(2e-3)) * i / 300);
    const dRel = Math.abs(COSMO.growth(a) - growthRef(a)) / growthRef(a);
    const tRel = Math.abs(COSMO.age(a) - ageRef(a)) / ageRef(a);
    if (dRel > worstD) { worstD = dRel; worstDa = a; }
    if (tRel > worstT) { worstT = tRel; worstTa = a; }
  }
  ok('D(a) within 1e-4 of quadrature over a ∈ [2e-3, 1.5]', worstD < 1e-4,
    `worst ${worstD.toExponential(2)} at a=${worstDa.toPrecision(4)}`);
  ok('t(a) within 1e-4 of quadrature over the same range', worstT < 1e-4,
    `worst ${worstT.toExponential(2)} at a=${worstTa.toPrecision(4)}`);

  // matter domination: D ∝ a when Λ is negligible
  const r = COSMO.growth(4e-3) / COSMO.growth(2e-3);
  near('D ∝ a in matter domination', r, 2, 3e-3);

  // monotonicity — a universe whose structure un-grows is a bug
  let mono = true, monoT = true;
  let prev = -1, prevT = -1;
  for (let i = 0; i <= 500; i++) {
    const a = Math.exp(Math.log(1e-3) + (Math.log(7.9) - Math.log(1e-3)) * i / 500);
    const d = COSMO.growth(a), t = COSMO.age(a);
    if (d < prev - 1e-12) mono = false;
    if (t < prevT - 1e-12) monoT = false;
    prev = d; prevT = t;
  }
  ok('D(a) monotonically increasing to a = 7.9', mono);
  ok('t(a) monotonically increasing to a = 7.9', monoT);

  // f = dlnD/dlna should match the Ωm^0.55 fit that growthRate() returns
  for (const a of [0.1, 0.3, 0.6, 1.0]) {
    const h = 1e-3;
    const num = (Math.log(COSMO.growth(a * (1 + h))) - Math.log(COSMO.growth(a * (1 - h))))
      / (Math.log(a * (1 + h)) - Math.log(a * (1 - h)));
    near(`f(a=${a}) from dlnD/dlna matches Ωm^0.55`, num, COSMO.growthRate(a), 0.02);
  }
}

// ---------------------------------------------------------------------------
// suite: zeldovich
//
// The deformation tensor is new shader math, so it gets the §7.3 treatment
// before a single line of GLSL is written. The independent reference is finite
// differencing of ψ itself — if M_ij really is ∂ψ_i/∂q_j, central differences
// of the displacement must reproduce it.

/**
 * Eigenvalues of a symmetric 3×3 packed as [xx, yy, zz, xy, xz, yz], by the
 * closed-form trigonometric method (Smith 1961). Used only here, as an
 * independent route to the invariants — the shader never needs it.
 */
function symEigenvalues(M) {
  const [a, b, c, d, e, f] = M;
  const p1 = d * d + e * e + f * f;
  const q = (a + b + c) / 3;
  if (p1 < 1e-30) return [a, b, c].sort((x, y) => y - x);
  const p2 = (a - q) ** 2 + (b - q) ** 2 + (c - q) ** 2 + 2 * p1;
  const p = Math.sqrt(p2 / 6);
  // B = (M − qI)/p has det in [−1, 1]; its determinant fixes the angle
  const b0 = (a - q) / p, b1 = (b - q) / p, b2 = (c - q) / p;
  const b3 = d / p, b4 = e / p, b5 = f / p;
  const det = b0 * (b1 * b2 - b5 * b5) - b3 * (b3 * b2 - b5 * b4) + b4 * (b3 * b5 - b1 * b4);
  const r = Math.min(1, Math.max(-1, det / 2));
  const phi = Math.acos(r) / 3;
  const e1 = q + 2 * p * Math.cos(phi);
  const e3 = q + 2 * p * Math.cos(phi + (2 * Math.PI / 3));
  return [e1, 3 * q - e1 - e3, e3];
}

function suiteZeldovich() {
  console.log('\nzeldovich — analytic deformation tensor vs finite differences');

  const BOX = 900;
  const modes = buildModes(20250601, BOX);
  ok('64 modes built', modes.length === 64);

  // k̂ must be a unit vector and k = |k|·k̂, or the tensor's k̂k̂ factorization
  // (which is what makes tr(M) equal the existing `div`) is wrong
  let unit = 0, recon = 0;
  for (const m of modes) {
    unit = Math.max(unit, Math.abs(Math.hypot(...m.khat) - 1));
    for (let i = 0; i < 3; i++) recon = Math.max(recon, Math.abs(m.k[i] - m.klen * m.khat[i]));
  }
  ok('k̂ is unit', unit < 1e-12, `worst ${unit.toExponential(2)}`);
  ok('k = |k|·k̂', recon < 1e-9, `worst ${recon.toExponential(2)}`);

  const rand = (() => { let s = 12345; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; })();
  const h = 0.02;
  const psi = [0, 0, 0], psiP = [0, 0, 0], psiM = [0, 0, 0];

  let worstM = 0, worstTr = 0, worstJac = 0, worstLin = 0, worstTheta = 0;
  for (let s = 0; s < 400; s++) {
    const q = [(rand() - 0.5) * BOX, (rand() - 0.5) * BOX, (rand() - 0.5) * BOX];
    const M = deformation(modes, q);

    // M_ij vs central differences of ψ_i along q_j
    for (let j = 0; j < 3; j++) {
      const qp = [...q], qm = [...q];
      qp[j] += h; qm[j] -= h;
      displacement(modes, qp, psiP);
      displacement(modes, qm, psiM);
      for (let i = 0; i < 3; i++) {
        const fd = (psiP[i] - psiM[i]) / (2 * h);
        const idx = i === j ? i : (i + j === 1 ? 3 : i + j === 2 ? 4 : 5);
        worstM = Math.max(worstM, Math.abs(M[idx] - fd));
      }
    }

    // tr(M) is the quantity the current shader already accumulates as `div`,
    // and δ_lin = −D·tr(M) must reproduce the historical deltaLinear()
    const D = 0.4;
    worstTr = Math.max(worstTr, Math.abs(-D * trace(M) - deltaLinear(modes, q, D)));

    // det(I + D·M) vs the Jacobian of x(q) = q + D·ψ(q) by finite differences
    const J = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    for (let j = 0; j < 3; j++) {
      const qp = [...q], qm = [...q];
      qp[j] += h; qm[j] -= h;
      displacement(modes, qp, psiP);
      displacement(modes, qm, psiM);
      for (let i = 0; i < 3; i++) {
        J[i][j] = (i === j ? 1 : 0) + D * (psiP[i] - psiM[i]) / (2 * h);
      }
    }
    const detFD = J[0][0] * (J[1][1] * J[2][2] - J[1][2] * J[2][1])
      - J[0][1] * (J[1][0] * J[2][2] - J[1][2] * J[2][0])
      + J[0][2] * (J[1][0] * J[2][1] - J[1][1] * J[2][0]);
    const inv = invariants(M, D);
    worstJac = Math.max(worstJac, Math.abs(inv.det - detFD) / Math.max(Math.abs(detFD), 1e-6));

    // linear limit: as D → 0, 1+δ → 1 − D·tr(M), and θ/(aHf) → D·tr(M)
    const Ds = 1e-4;
    const small = invariants(M, Ds);
    worstLin = Math.max(worstLin, Math.abs(small.rho - (1 - Ds * trace(M))) / Ds);
    worstTheta = Math.max(worstTheta, Math.abs(small.thetaNorm - Ds * trace(M)) / Ds);
  }

  // central differences carry O(h²) truncation error; h = 0.02 on a field whose
  // shortest mode is ~35 units puts that near 1e-4 of the tensor's own scale
  const scale = Math.max(...deformation(modes, [0, 0, 0]).map(Math.abs));
  ok('M_ij = ∂ψ_i/∂q_j (central differences)', worstM < 1e-3 * Math.max(scale, 1),
    `worst ${worstM.toExponential(2)}, tensor scale ${scale.toPrecision(3)}`);
  ok('−D·tr(M) reproduces deltaLinear()', worstTr < 1e-9, `worst ${worstTr.toExponential(2)}`);
  ok('det(I + D·M) is the Jacobian of x(q)', worstJac < 2e-3, `worst rel ${worstJac.toExponential(2)}`);
  ok('1+δ → 1 − D·tr(M) as D → 0', worstLin < 1e-2, `worst ${worstLin.toExponential(2)}`);
  ok('θ/(aHf) → D·tr(M) as D → 0', worstTheta < 1e-2, `worst ${worstTheta.toExponential(2)}`);

  // The invariant identities, checked against the eigenvalues themselves.
  // This is the strongest available test of what the shader will actually
  // compute: det and I₂ are cheap to evaluate but easy to get subtly wrong,
  // and an eigen-decomposition reaches the same numbers by a different road.
  //
  //   det(B) = Π(1 + Dλ_i)
  //   I₂(B)  = Σ_{i<j} (1 + Dλ_i)(1 + Dλ_j)
  //   θ/(aHf) = 3 − I₂/det = Σ_i Dλ_i/(1 + Dλ_i)
  let worstDet = 0, worstI2 = 0, worstTh = 0;
  for (let s = 0; s < 600; s++) {
    const q = [(rand() - 0.5) * BOX, (rand() - 0.5) * BOX, (rand() - 0.5) * BOX];
    const M = deformation(modes, q);
    const D = 0.5;
    const [l0, l1, l2] = symEigenvalues(M);
    const b = [1 + D * l0, 1 + D * l1, 1 + D * l2];
    const inv = invariants(M, D, Infinity);
    const detE = b[0] * b[1] * b[2];
    const i2E = b[0] * b[1] + b[0] * b[2] + b[1] * b[2];
    const thE = D * l0 / b[0] + D * l1 / b[1] + D * l2 / b[2];
    worstDet = Math.max(worstDet, Math.abs(inv.det - detE) / Math.max(Math.abs(detE), 1e-6));
    worstI2 = Math.max(worstI2, Math.abs(inv.i2 - i2E) / Math.max(Math.abs(i2E), 1e-6));
    if (!inv.crossed) worstTh = Math.max(worstTh, Math.abs(inv.thetaNorm - thE) / Math.max(Math.abs(thE), 1e-3));
  }
  ok('det(B) = Π(1 + Dλ_i)', worstDet < 1e-9, `worst rel ${worstDet.toExponential(2)}`);
  ok('I₂(B) = Σ (1 + Dλ_i)(1 + Dλ_j)', worstI2 < 1e-9, `worst rel ${worstI2.toExponential(2)}`);
  ok('3 − I₂/det = Σ Dλ_i/(1 + Dλ_i)', worstTh < 1e-8, `worst rel ${worstTh.toExponential(2)}`);

  // Sign convention. In the LINEAR regime overdense means converging, full
  // stop — that is what the colouring is built on and it must be exact.
  const signAgreement = (D) => {
    let agree = 0, total = 0, worstMiss = 0;
    for (let s = 0; s < 3000; s++) {
      const q = [(rand() - 0.5) * BOX, (rand() - 0.5) * BOX, (rand() - 0.5) * BOX];
      const inv = invariants(deformation(modes, q), D);
      if (inv.crossed) continue;
      total++;
      if ((inv.rho > 1) === (inv.thetaNorm < 0)) agree++;
      else worstMiss = Math.max(worstMiss, Math.abs(inv.rho - 1));
    }
    return { agree, total, frac: agree / total, worstMiss };
  };

  // The relation is exact only to first order in D, so at any finite D there is
  // a thin boundary layer around δ = 0 where the two channels cross at slightly
  // different places. What must be true is that every disagreement lives in
  // that layer — an element that is *visibly* overdense must be infalling.
  const D_LIN = 0.02;
  const lin = signAgreement(D_LIN);
  ok('linear regime: every sign disagreement sits at δ ≈ 0',
    lin.worstMiss < 4 * D_LIN * D_LIN,
    `${lin.agree}/${lin.total} agree · worst |δ| among the rest ${lin.worstMiss.toExponential(2)}`
    + ` (bound ${(4 * D_LIN * D_LIN).toExponential(2)})`);

  // Nonlinearly it is NOT an identity, and that is physics rather than a bug:
  // 1+δ = 1/Π(1+Dλ_i) but θ = Σ Dλ_i/(1+Dλ_i), and those disagree wherever one
  // axis expands faster than another collapses. A pancake forming inside a void
  // is underdense and converging at the same time. The colouring wants exactly
  // this — hue and luminance stop being redundant precisely where structure is
  // interesting — so the test asserts strong-but-imperfect agreement, and would
  // fail just as loudly if the two ever became the same channel.
  const nl = signAgreement(0.6);
  ok('nonlinear regime: correlated but not identical', nl.frac > 0.80 && nl.frac < 0.995,
    `${(nl.frac * 100).toFixed(1)}% agree — the rest is real anisotropic collapse`);

  // the shell-crossed fraction should be small at a=1 and grow with D —
  // if everything has collapsed the field is not a cosmic web, it is a mess
  const frac = (D) => {
    let n = 0, c = 0;
    for (let s = 0; s < 4000; s++) {
      const q = [(rand() - 0.5) * BOX, (rand() - 0.5) * BOX, (rand() - 0.5) * BOX];
      n++; if (invariants(deformation(modes, q), D).crossed) c++;
    }
    return c / n;
  };
  const f03 = frac(0.3), f10 = frac(1.0);
  ok('shell-crossed fraction grows with D', f10 > f03,
    `D=0.3 → ${(f03 * 100).toFixed(1)}% · D=1.0 → ${(f10 * 100).toFixed(1)}%`);
  ok('shell-crossed fraction at D=1 is a skeleton, not a flood', f10 > 0.01 && f10 < 0.5,
    `${(f10 * 100).toFixed(1)}%`);
}


// ---------------------------------------------------------------------------
// suite: print
//
// §9.4's curve, checked for the properties that make it a *print* rather than
// an arbitrary rational function — and checked against ACES, which it replaces,
// so the change is characterised rather than asserted.

/** §9.4 step 1 — the reference's rational print curve, which owns atmosphere */
function tonemapPrint(x) {
  x = Math.max(x, 0);
  return Math.min(Math.max((x * (x * 0.36 + 0.42)) / (x * (x * 0.34 + 0.66) + 0.11), 0), 1);
}

/** §3 row 3 — AEON's own curve, which survives in vacuum */
function tonemapVacuum(x) {
  return Math.min(Math.max(1 - Math.exp(-1.32 * Math.max(x, 0)), 0), 1);
}

/** and the ruling: cross-faded by the same uPaint that drives the grade */
function tonemapRef(x, paint) {
  const v = tonemapVacuum(x), p = tonemapPrint(x);
  return v + (p - v) * paint;
}

/** three's ACESFilmicToneMapping, for comparison only */
function acesRef(x) {
  const a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  x *= 0.6;
  return Math.min(Math.max((x * (a * x + b)) / (x * (c * x + d) + e), 0), 1);
}

function suitePrint() {
  console.log('\nprint — §9.4 tonemap properties, and what it changes vs ACES');

  // Two curves, one uniform. §3 row 3 splits the tonemap by medium exactly as
  // §3 row 1 splits the lift, so every property below has to hold across the
  // whole cross-fade rather than at its endpoints.
  const PAINTS = [0, 0.25, 0.5, 0.75, 1];

  ok('both curves map black to black, so the blend does at every uPaint',
    PAINTS.every((p) => tonemapRef(0, p) === 0));
  ok('the blend is monotone at every uPaint', (() => {
    for (const p of PAINTS) {
      let prev = -1;
      for (let i = 0; i <= 4000; i++) {
        const v = tonemapRef(i / 100, p);
        if (v < prev - 1e-12) return false;
        prev = v;
      }
    }
    return true;
  })(), 'a convex blend of two monotone curves — checked, not assumed');
  ok('it saturates below 1 and never exceeds it, in either medium',
    PAINTS.every((p) => tonemapRef(1e6, p) <= 1 && tonemapRef(1e6, p) > 0.99),
    `vacuum ${tonemapVacuum(1e6).toPrecision(6)} · print ${tonemapPrint(1e6).toPrecision(6)}`);

  // Why the split is load-bearing rather than decorative: the two curves agree
  // in the highlights and diverge hard in the shadows, which is the entire
  // difference between a deep field and a painted one. Reported, not predicted.
  {
    let worst = 0, at = 0;
    for (let i = 1; i <= 2000; i++) {
      const x = i / 200, d = tonemapPrint(x) - tonemapVacuum(x);
      if (d > worst) { worst = d; at = x; }
    }
    ok('the print curve lifts shadows and the vacuum curve does not',
      tonemapPrint(0.02) > tonemapVacuum(0.02) * 2 && worst > 0.05,
      `at 2% grey: ${tonemapVacuum(0.02).toFixed(4)} → ${tonemapPrint(0.02).toFixed(4)}`
      + ` (${(tonemapPrint(0.02) / tonemapVacuum(0.02)).toFixed(2)}×);`
      + ` widest gap ${worst.toFixed(3)} at x = ${at.toFixed(2)}`);
  }

  // ACES is what both regimes replace, so characterise the departure in each
  {
    const dev = (f) => {
      let m = 0;
      for (let i = 0; i <= 2000; i++) m = Math.max(m, Math.abs(f(i / 200) - acesRef(i / 200)));
      return m;
    };
    ok('neither regime is ACES by another name',
      dev(tonemapVacuum) > 0.05 && dev(tonemapPrint) > 0.05,
      `max |Δ| vs ACES — vacuum ${dev(tonemapVacuum).toFixed(3)} · print ${dev(tonemapPrint).toFixed(3)}`);
  }

  // §2.8's actual claim, tested end to end rather than asserted: run the whole
  // print on the CPU and check that vacuum keeps black at exactly zero while
  // atmosphere lands it on the lift. The shader is the same arithmetic.
  const LIFT = [0.017, 0.021, 0.036];
  function printRef(rgb, paint) {
    let c = rgb.map((v) => tonemapRef(v, paint));
    const lum = (v) => 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
    const ss = (e0, e1, x) => {
      const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
      return t * t * (3 - 2 * t);
    };
    let l = lum(c);
    const sh = [0.90, 0.95, 1.16].map((v) => v + (1 - v) * ss(0.0, 0.34, l));
    const hi = [1.055, 1.012, 0.925].map((v) => 1 + (v - 1) * ss(0.44, 0.98, l));
    c = c.map((v, i) => v * (1 + (sh[i] - 1) * 0.85 * paint) * (1 + (hi[i] - 1) * 0.9 * paint));
    c = c.map((v, i) => v * (1 - LIFT[i] * paint) + LIFT[i] * paint);
    c = c.map((v) => v + (v * v * (3 - 2 * v) - v) * 0.16 * paint);
    l = lum(c);
    const sat = 1 + 0.16 * paint * ss(0.10, 0.42, l) * (1 - ss(0.62, 0.96, l));
    return c.map((v) => l + (v - l) * sat);
  }

  const vacuumBlack = printRef([0, 0, 0], 0);
  ok('§2.8 · in vacuum, black comes out exactly #000',
    vacuumBlack.every((v) => v === 0), `got [${vacuumBlack.join(', ')}]`);

  // The stronger claim, and the one that makes uPaint = 0 honest: in vacuum the
  // print is not a faint print, it is *absent*. Every graded step — push, lift,
  // S, saturation — has to collapse to identity, leaving only AEON's curve.
  {
    let worst = 0;
    for (let i = 0; i <= 60; i++) {
      const x = i / 20;
      const got = printRef([x, x * 0.7, x * 0.4], 0);
      const want = [x, x * 0.7, x * 0.4].map(tonemapVacuum);
      worst = Math.max(worst, ...got.map((v, k) => Math.abs(v - want[k])));
    }
    ok('§3 row 3 · at uPaint 0 the pass is exactly AEON\'s curve and nothing else',
      worst < 1e-12, `max |Δ| over 61 samples: ${worst.toExponential(2)}`);
  }

  // The floor is *near* the §9.4 lift rather than equal to it — the S-curve and
  // the midtone saturation both run afterwards and shape it. What §2.8 claims
  // is that nothing reaches black, so that is what gets asserted; the exact
  // floor is reported rather than predicted.
  const airBlack = printRef([0, 0, 0], 1);
  ok('§2.8 · in atmosphere, nothing reaches black',
    airBlack.every((v) => v > 0.005),
    `floor [${airBlack.map((v) => v.toFixed(4)).join(', ')}]`
    + ` from a lift of [${LIFT.join(', ')}], violet-biased as §9.4 intends`);

  // and the cross-fade between them has to be continuous, or §3's "cross-fade
  // on the atmospheric-entry hyperzoom" would be a cut
  let jump = 0;
  for (let i = 0; i < 200; i++) {
    const a = printRef([0.2, 0.2, 0.2], i / 200);
    const b = printRef([0.2, 0.2, 0.2], (i + 1) / 200);
    jump = Math.max(jump, ...a.map((v, k) => Math.abs(v - b[k])));
  }
  ok('the vacuum→atmosphere cross-fade is continuous', jump < 0.01,
    `largest step over 200 samples of uPaint: ${jump.toExponential(2)}`);
}

// ---------------------------------------------------------------------------

const only = process.argv[2];
const suites = { cosmology: suiteCosmology, zeldovich: suiteZeldovich, print: suitePrint };

for (const [name, fn] of Object.entries(suites)) {
  if (only && only !== name) continue;
  fn();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
