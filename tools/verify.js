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
  FIXTURE, STOPS, airColours, airmass, hexToLinear, linearToHex, planck,
  spectrumToXYZ, toGamut, xyzToLinearSRGB,
} from '../src/starlight.js';
import {
  buildModes, deformation, deltaLinear, displacement, eigenvalues, invariants,
  trace, webClass,
} from '../src/zeldovich.js';
import { PAINT_GLSL, REFERENCE_LIGHT, lightFor, paint, ramp3 } from '../src/paint.js';
import {
  SUN_BAND, frameAt, macroHeight, scoreComposition, solveLandingSite,
} from '../src/landing.js';
import { makeGround } from '../src/ground.js';
import {
  AERIAL_ALPHA_IS_CLARITY, AERIAL_GLSL, EARTH_AIR, HAZE_FRACTION, REFERENCE_AIR,
  REFERENCE_PARAMS, aerial, aerialParams, airFor, molarMass, scaleHeight,
  surfaceTemp,
} from '../src/aerial.js';

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
    const [l0, l1, l2] = eigenvalues(M);
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
// suite: webclass
//
// The second physical channel in the palette (M1 §12, option B). Two things
// have to hold: the closed-form eigen-solver must agree with an independent
// numerical one, and the classification it feeds must behave like a cosmic web
// — voids emptying, knots condensing, and a *multimodal* distribution, which is
// the entire reason this channel exists.

/** Jacobi eigenvalue iteration — the independent reference, slow and obvious */
function jacobiEigen(M) {
  const A = [[M[0], M[3], M[4]], [M[3], M[1], M[5]], [M[4], M[5], M[2]]];
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) off += A[i][j] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < 3; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(A[p][q]) < 1e-300) continue;
        const theta = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = A[k][p], akq = A[k][q];
          A[k][p] = c * akp - s * akq;
          A[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = A[p][k], aqk = A[q][k];
          A[p][k] = c * apk - s * aqk;
          A[q][k] = s * apk + c * aqk;
        }
      }
    }
  }
  return [A[0][0], A[1][1], A[2][2]].sort((x, y) => y - x);
}

function suiteWebclass() {
  console.log('\nwebclass — the second channel in the palette (M1 §12 option B)');

  const modes = buildModes(20250601, 240);
  const BOX = 240;
  const rand = (() => {
    let s = 424242; return () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  })();
  const sample = () => [(rand() - 0.5) * BOX, (rand() - 0.5) * BOX, (rand() - 0.5) * BOX];

  // --- the solver, against Jacobi ------------------------------------------
  {
    let worst = 0, scale = 0;
    for (let i = 0; i < 3000; i++) {
      const M = deformation(modes, sample());
      const a = eigenvalues(M), b = jacobiEigen(M);
      for (let k = 0; k < 3; k++) worst = Math.max(worst, Math.abs(a[k] - b[k]));
      scale = Math.max(scale, Math.abs(b[0]), Math.abs(b[2]));
    }
    ok('closed-form eigenvalues match Jacobi', worst / scale < 1e-9,
      `worst |Δ| ${worst.toExponential(2)} against a tensor scale of ${scale.toFixed(3)}`);
  }
  {
    // the two invariants the render path already trusts, rebuilt from the roots
    let wTr = 0, wDet = 0;
    for (let i = 0; i < 2000; i++) {
      const M = deformation(modes, sample());
      const e = eigenvalues(M);
      wTr = Math.max(wTr, Math.abs(e[0] + e[1] + e[2] - trace(M)));
      const det = M[0] * (M[1] * M[2] - M[5] * M[5]) - M[3] * (M[3] * M[2] - M[5] * M[4])
        + M[4] * (M[3] * M[5] - M[1] * M[4]);
      wDet = Math.max(wDet, Math.abs(e[0] * e[1] * e[2] - det));
    }
    ok('Σλ = tr(M) and Πλ = det(M)', wTr < 1e-12 && wDet < 1e-12,
      `worst |Δtr| ${wTr.toExponential(2)} · |Δdet| ${wDet.toExponential(2)}`);
  }
  ok('the roots come back descending', (() => {
    for (let i = 0; i < 2000; i++) {
      const e = eigenvalues(deformation(modes, sample()));
      if (!(e[0] >= e[1] && e[1] >= e[2])) return false;
    }
    return true;
  })());
  {
    // a diagonal tensor is the degenerate branch, and it is easy to get wrong
    const e = eigenvalues([2, -1, 0.5, 0, 0, 0]);
    ok('a diagonal tensor takes the p1 = 0 branch correctly',
      e[0] === 2 && e[1] === 0.5 && e[2] === -1, `[${e.join(', ')}]`);
    const iso = eigenvalues([0.7, 0.7, 0.7, 0, 0, 0]);
    ok('and an isotropic one gives a triple root', iso.every((v) => v === 0.7));
  }

  // --- the classification, as a cosmic web ---------------------------------
  const census = (D) => {
    const bins = [0, 0, 0, 0];
    let n = 0;
    for (let i = 0; i < 6000; i++) {
      const c = webClass(deformation(modes, sample()), D);
      bins[Math.min(3, Math.round(c))]++; n++;
    }
    return bins.map((b) => b / n);
  };
  const early = census(0.25), late = census(1.4);
  ok('voids give way to collapsed structure as D grows',
    early[0] > late[0] && late[3] > early[3],
    `void ${(early[0] * 100).toFixed(1)}%→${(late[0] * 100).toFixed(1)}%`
    + ` · knot ${(early[3] * 100).toFixed(1)}%→${(late[3] * 100).toFixed(1)}%`);
  ok('all four classes are occupied at an intermediate epoch', (() => {
    const c = census(0.7);
    console.log(`       D = 0.7 census — void ${(c[0] * 100).toFixed(1)}%`
      + ` sheet ${(c[1] * 100).toFixed(1)}% filament ${(c[2] * 100).toFixed(1)}%`
      + ` knot ${(c[3] * 100).toFixed(1)}%`);
    return c.every((v) => v > 0.02);
  })(), 'each above 2% — a class nobody occupies is not a hue family');

  {
    // The claim the clause turns on: the continuous count is *multimodal*,
    // which is what a monotone readout of the unimodal divergence field could
    // never produce. Measured at D = 1, where the web is formed — asserting
    // four peaks at D = 0.25 would be asserting that clusters exist before they
    // do, and the census above shows knots at 0.1% there. The physics decides
    // when the fourth family arrives; this checks that it does.
    const peaksAt = (D) => {
      const BINS = 60;
      const hist = new Array(BINS).fill(0);
      let nearInt = 0, n = 0;
      for (let i = 0; i < 20000; i++) {
        const c = webClass(deformation(modes, sample()), D);
        hist[Math.min(BINS - 1, Math.floor((c / 3) * BINS))]++;
        if (Math.abs(c - Math.round(c)) < 0.15) nearInt++;
        n++;
      }
      // a peak is a local maximum that is actually occupied — same shape as
      // gate.js's hue-mode count, at the same 0.5% floor
      let peaks = 0;
      for (let i = 1; i < BINS - 1; i++) {
        if (hist[i] >= hist[i - 1] && hist[i] > hist[i + 1] && hist[i] / n > 0.005) peaks++;
      }
      return { peaks, nearInt: nearInt / n };
    };

    const late = peaksAt(1.0);
    ok('the count is near-integer almost everywhere', late.nearInt > 0.75,
      `${(late.nearInt * 100).toFixed(1)}% within 0.15 of a class at D = 1`);
    ok('and by D = 1 its distribution has four modes', late.peaks >= 4,
      `${late.peaks} occupied local maxima — the divergence field has one, at every D`);
  }

  ok('the classification is monotone in D for a fixed element', (() => {
    for (let i = 0; i < 400; i++) {
      const M = deformation(modes, sample());
      let prev = -1;
      for (let D = 0.05; D <= 2.0; D += 0.05) {
        const c = webClass(M, D);
        if (c < prev - 1e-9) return false;
        prev = c;
      }
    }
    return true;
  })(), 'structure collapses; it does not un-collapse under Zel\'dovich');

  {
    // and it must be a *different* number from the one the palette already has
    let same = 0, n = 0;
    for (let i = 0; i < 4000; i++) {
      const M = deformation(modes, sample());
      const c = webClass(M, 0.7);
      const th = invariants(M, 0.7).thetaNorm;
      // rank-correlate crudely: does class order match divergence order?
      const M2 = deformation(modes, sample());
      const c2 = webClass(M2, 0.7);
      const th2 = invariants(M2, 0.7).thetaNorm;
      if ((c - c2) * (th2 - th) > 0) same++;
      n++;
    }
    const agree = same / n;
    ok('it correlates with divergence without duplicating it',
      agree > 0.55 && agree < 0.95,
      `${(agree * 100).toFixed(1)}% of pairs order the same way — correlated,`
      + ' as collapse and infall must be, but not the same channel');
  }
}

// ---------------------------------------------------------------------------
// suite: paint
//
// §9.2, before it lights anything (M2 act 3). The checks that matter are not
// "does it return a colour" — they are the five properties §9.2 argues for and
// §11 warns will be optimised away by a physically-based reflex. Two of them
// would look like *improvements* to someone who did not read the section: the
// band edges look like quantisation, and the shadow floor looks like a missing
// ambient occlusion term.

function suitePaint() {
  console.log('\npaint — §9.2, the light model (M2 act 3)');

  const L = REFERENCE_LIGHT;
  const UP = [0, 1, 0];
  // §9.7 forces spawn sun into 8–18 degrees; 13.5 is the reference's own
  const SUN_ELEV = (13.5 * Math.PI) / 180;
  const SUN = [Math.cos(SUN_ELEV), Math.sin(SUN_ELEV), 0];

  const surf = (o = {}) => ({
    N: UP, V: [0, 0, 1], L: SUN,
    shade: [0.10, 0.13, 0.18], mid: [0.28, 0.34, 0.22], lit: [0.62, 0.68, 0.40],
    soft: 0.10, jit: 0, shadow: 1, trans: 0, transCol: [0.5, 0.7, 0.3],
    rim: 0, ao: 1, ambient: 1, ...o,
  });
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const sat = (c) => (Math.max(...c) - Math.min(...c)) / Math.max(Math.max(...c), 1e-6);

  // --- 1. the half-Lambert wrap, which is the whole argument at low sun ----
  {
    const ndl = Math.sin(SUN_ELEV);        // flat ground, sun at 13.5 degrees
    const wrap = ndl * 0.62 + 0.46;
    ok('a 13.5° sun grazes flat ground at ndl ≈ 0.23',
      Math.abs(ndl - 0.2334) < 0.001, `ndl ${ndl.toFixed(4)}`);
    ok('plain Lambert would put that in the shade band, the wrap does not',
      ndl < 0.17 + 0.10 && wrap > 0.58 - 0.10,
      `Lambert ${ndl.toFixed(3)} — below the first band edge at 0.17;`
      + ` wrapped ${wrap.toFixed(3)} — past the second at 0.58`);
  }

  // --- 2. the ramp is BANDED, and this test exists to fail if it stops ----
  {
    // A three-stop ramp with soft edges has two peaks in |d col/dt|. A smooth
    // interpolation has one broad plateau. §11 lists deleting the band edges as
    // the archetypal PBR reflex, so the property gets asserted rather than
    // trusted.
    const N = 2000, d = [];
    for (let i = 1; i < N; i++) {
      const a = ramp3((i - 1) / N, [0, 0, 0], [0.5, 0.5, 0.5], [1, 1, 1], 0.10, 0);
      const b = ramp3(i / N, [0, 0, 0], [0.5, 0.5, 0.5], [1, 1, 1], 0.10, 0);
      d.push(Math.abs(lum(b) - lum(a)) * N);
    }
    // Contiguous runs above a threshold, not local maxima: a smoothstep edge
    // has a flat top, and peak-picking counts a plateau twice.
    const bands = [];
    for (let i = 0; i < d.length; i++) {
      if (d[i] > 0.5) {
        if (bands.length && bands[bands.length - 1].end === i - 1) bands[bands.length - 1].end = i;
        else bands.push({ start: i, end: i });
      }
    }
    const flat = d.filter((v) => v < 0.02).length / d.length;
    ok('§9.2 · the ramp has two visible band edges, not one smooth sweep',
      bands.length === 2 && flat > 0.3,
      `${bands.length} contiguous edges in the luminance derivative ·`
      + ` ${(flat * 100).toFixed(0)}% of the range is flat between them`);
    ok('and the edges sit where §9.2 puts them',
      bands.length === 2
      && Math.abs((bands[0].start + bands[0].end) / 2 / N - 0.17) < 0.02
      && Math.abs((bands[1].start + bands[1].end) / 2 / N - 0.58) < 0.02,
      bands.map((b) => ((b.start + b.end) / 2 / N).toFixed(3)).join(' · '));
    ok('jit slides both edges together, so a surface can wobble its own bands',
      (() => {
        const a = ramp3(0.17, [0, 0, 0], [1, 1, 1], [1, 1, 1], 0.10, 0);
        const b = ramp3(0.17, [0, 0, 0], [1, 1, 1], [1, 1, 1], 0.10, 0.06);
        return lum(b) < lum(a);
      })());
  }

  // --- 3. shadows change hue, they do not go black ------------------------
  {
    const lit = paint(surf({ shadow: 1 }), L);
    const dark = paint(surf({ shadow: 0 }), L);
    ok('§M2 · a shadowed surface never goes achromatic-dark',
      dark.every((v) => v > 0.01) && sat(dark) > 0.05,
      `shadowed [${dark.map((v) => v.toFixed(3)).join(', ')}]`
      + ` · saturation ${sat(dark).toFixed(3)}`);
    // the violet shift is the point: shadow is not "lit, but less"
    const hueShift = (dark[2] / Math.max(dark[0], 1e-6)) - (lit[2] / Math.max(lit[0], 1e-6));
    ok('and it shifts toward violet rather than merely darkening',
      hueShift > 0.02,
      `blue:red ${(lit[2] / lit[0]).toFixed(3)} lit → ${(dark[2] / dark[0]).toFixed(3)} shadowed`);
  }

  // --- 4. ambient rotates hue without bleaching ---------------------------
  {
    const withAmb = paint(surf({ ambient: 1, shadow: 0.2 }), L);
    const noAmb = paint(surf({ ambient: 0, shadow: 0.2 }), L);
    const dl = Math.abs(lum(withAmb) - lum(noAmb)) / Math.max(lum(noAmb), 1e-6);
    ok('§9.2 · hemispheric ambient tints rather than washes',
      sat(withAmb) > 0.04 && dl < 0.65,
      `saturation held at ${sat(withAmb).toFixed(3)};`
      + ` luminance moved ${(dl * 100).toFixed(0)}%`);
    // a surface facing down takes the warm ground bounce, one facing up the sky
    const up = paint(surf({ N: [0, 1, 0], ambient: 1, shadow: 0 }), L);
    const down = paint(surf({ N: [0, -1, 0], ambient: 1, shadow: 0 }), L);
    ok('and it rotates: sky above is cooler than ground bounce below',
      up[2] / Math.max(up[0], 1e-6) > down[2] / Math.max(down[0], 1e-6),
      `blue:red ${(up[2] / up[0]).toFixed(3)} facing sky · ${(down[2] / down[0]).toFixed(3)} facing ground`);
  }

  // --- 5. the rim, gated on both view and shadow --------------------------
  {
    const toward = paint(surf({ V: SUN.map((v) => -v), N: [0, 0, 1], rim: 1 }), L);
    const away = paint(surf({ V: SUN.slice(), N: [0, 0, 1], rim: 1 }), L);
    ok('§9.2 · the rim only fires when looking toward the sun',
      lum(toward) > lum(away) * 1.15,
      `luma ${lum(toward).toFixed(4)} toward · ${lum(away).toFixed(4)} away`);
    const shadowed = paint(surf({ V: SUN.map((v) => -v), N: [0, 0, 1], rim: 1, shadow: 0 }), L);
    const noRim = paint(surf({ V: SUN.map((v) => -v), N: [0, 0, 1], rim: 0, shadow: 0 }), L);
    ok('and it is gated on shadow — a rim in shadow is a light leak',
      Math.abs(lum(shadowed) - lum(noRim)) < 1e-9);
  }

  // --- 6. transmission is light coming through, not bouncing off ----------
  {
    // The *increment* transmission adds, at fixed orientation — comparing two
    // orientations would confound it with the ramp, which is much larger.
    const gain = (N) => {
      const on = lum(paint(surf({ N, V: SUN.map((v) => -v), trans: 1 }), L));
      const off = lum(paint(surf({ N, V: SUN.map((v) => -v), trans: 0 }), L));
      return on - off;
    };
    const edgeOn = gain([0, 0, 1]);          // N perpendicular to the sun
    const faceOn = gain(SUN.slice());        // N straight at the sun
    ok('§9.2 · only surfaces nearly edge-on to the sun transmit',
      edgeOn > 0.05 && faceOn < edgeOn * 0.02,
      `transmission adds ${edgeOn.toFixed(4)} edge-on · ${faceOn.toFixed(6)} facing the sun`);
  }

  // --- 7. the whole thing stays sane --------------------------------------
  {
    let mono = true, prev = -1;
    for (let i = 0; i <= 400; i++) {
      const a = -1 + (2 * i) / 400;
      const n = [0, a, Math.sqrt(Math.max(1 - a * a, 0))];
      const v = lum(paint(surf({ N: n, ambient: 0, rim: 0 }), L));
      if (v < prev - 1e-9) mono = false;
      prev = v;
    }
    ok('luminance never falls as a surface turns toward the sun', mono,
      '401 orientations, ambient and rim off so only the ramp speaks');
    let bad = 0;
    for (let i = 0; i < 3000; i++) {
      const r = () => Math.sin(i * 12.9898 + 78.233) * 0.5 + 0.5;
      const c = paint(surf({
        shadow: r(), ao: r(), ambient: r(), trans: r(), rim: r(),
        N: [0, Math.cos(i), Math.sin(i)],
      }), L);
      if (!c.every((v) => Number.isFinite(v) && v >= 0)) bad++;
    }
    ok('and it is finite and non-negative across the parameter space', bad === 0,
      '3000 surfaces');
  }

  // --- 8. the lights follow the star --------------------------------------
  {
    const g = lightFor(5778, 13.5), m = lightFor(3200, 13.5);
    const warmth = (c) => Math.log((c[0] + 1e-6) / (c[2] + 1e-6));
    ok('§9.6 · a cooler star gives a warmer sun and a warmer shadow',
      warmth(m.sun) > warmth(g.sun) && warmth(m.shadowTint) > warmth(g.shadowTint),
      `sun ${warmth(g.sun).toFixed(2)}→${warmth(m.sun).toFixed(2)}`
      + ` · shadow ${warmth(g.shadowTint).toFixed(2)}→${warmth(m.shadowTint).toFixed(2)}`);
    ok('and the G-type fixture reproduces §9.1\'s four light values',
      ['sun', 'ambSky', 'ambGnd', 'shadowTint'].every((k) =>
        g[k].every((v, i) => Math.abs(v - REFERENCE_LIGHT[k][i]) < 1e-6)),
      '#FFD79C #9EC6E6 #AA9C64 #5C6E9E');
  }

  // --- 9. the shader chunk is the same arithmetic -------------------------
  {
    // Not a parity test — that needs a GPU. This is the cheap guard that
    // catches the drift §2.7 warns about: every constant in the CPU path must
    // appear in the GLSL, or one of them has been tuned and the other has not.
    const needed = ['0.62', '0.46', '0.17', '0.58', '0.34', '0.86', '0.80',
      '0.040', '0.22', '0.052', '4.2', '1.15', '3.2', '2.2', '0.52', '1.32'];
    const missing = needed.filter((c) => !PAINT_GLSL.includes(c));
    ok('§2.7 · every constant in the CPU model appears in the GLSL',
      missing.length === 0, missing.length ? `missing ${missing.join(' ')}`
        : `${needed.length} constants`);
  }
}

// ---------------------------------------------------------------------------
// suite: landing
//
// §9.7's composition constraints, and §3's claim that turning them into a
// solver is "the actual engineering problem the reference sets you".
//
// The check that matters is not that the solver returns a site — anything
// returns a site. It is that the site it returns **beats a random one on the
// constraints it claims to optimise**, across many worlds. A solver that scores
// the same as chance is a scoring function with a loop around it.

function suiteLanding() {
  console.log('\nlanding — §9.7 composition constraints, as a solver (M2)');

  // a spread of worlds rather than one: an ocean planet and a dry one compose
  // differently, and a solver tuned on a single seed is tuned on nothing
  const worlds = [];
  for (let i = 0; i < 12; i++) {
    worlds.push({
      noiseSeed: 1000 + i * 7919,
      oceanLevel: i % 4 === 3 ? -1 : 0.004 + (i % 5) * 0.006,
      radiusE: 0.7 + (i % 6) * 0.22,
    });
  }

  const solved = worlds.map((w, i) => solveLandingSite(w, 0x51 + i * 977, { sites: 90 }));

  ok('every world gets a site', solved.every((s) => s && s.dir),
    `${worlds.length} worlds`);

  ok('§9.7 · spawn sun is inside the 8–18° band, on every world',
    solved.every((s) => s.fallback || (s.sunElev >= SUN_BAND[0] && s.sunElev <= SUN_BAND[1])),
    `elevations ${solved.map((s) => s.sunElev.toFixed(1)).join(' ')}`);

  // --- the comparison against chance --------------------------------------
  const KEYS = ['lowHorizon', 'offCentre', 'hero', 'lead', 'walls'];
  const randomScores = [];
  const solvedScores = [];
  for (let i = 0; i < worlds.length; i++) {
    const w = worlds[i];
    let sd = 0x9e37 + i * 31;
    const rand = () => { sd = (sd * 1103515245 + 12345) & 0x7fffffff; return sd / 0x7fffffff; };
    // 24 random (site, heading) pairs per world, scored the same way
    for (let k = 0; k < 24; k++) {
      const z = rand() * 2 - 1, th = rand() * Math.PI * 2, q = Math.sqrt(1 - z * z);
      const g = makeGround(w, [q * Math.cos(th), z, q * Math.sin(th)]);
      randomScores.push(scoreComposition(g, rand() * Math.PI * 2, 13.5).terms);
    }
    if (solved[i].terms) solvedScores.push(solved[i].terms);
  }
  const mean = (arr, k) => arr.reduce((s, t) => s + t[k], 0) / arr.length;

  const rows = KEYS.map((k) => ({
    k, rnd: mean(randomScores, k), sol: mean(solvedScores, k),
  }));
  for (const r of rows) {
    console.log(`       ${r.k.padEnd(11)} random ${r.rnd.toFixed(3)} → solved ${r.sol.toFixed(3)}`
      + `   ${r.sol > r.rnd ? '+' : ''}${((r.sol - r.rnd) * 100).toFixed(0)}%`);
  }
  ok('§9.7 · the solved site beats chance on every composition term',
    rows.every((r) => r.sol >= r.rnd),
    rows.filter((r) => r.sol < r.rnd).map((r) => r.k).join(' ') || `${KEYS.length} terms`);

  // The mistake this solver was built on, kept runnable so it cannot come back.
  //
  // The first version scored the planet-scale macro field, arguing that
  // "composition is a macro-scale property" and that surface.js's detail
  // octaves "cannot move a ridge". Backwards, and this check is the number that
  // says so: the macro term varies by **2.7 m** across the whole ±1400 m
  // surface where the ground a person stands on varies by **333 m**. On a
  // 6371 km world that patch subtends 0.00022 radians and planet-scale noise
  // has nothing to say across it; every ridge a viewer can see comes from
  // `fbm2(x·0.0011)` — a 900 m wavelength — and from the landform.
  //
  // `hero`, `lead` and `walls` consequently read zero for the solved site and a
  // random one alike, and every threshold in the scorer was calibrated against
  // a field 123× too flat.
  //
  // Both halves are asserted. The macro field must stay flat *and* the ground
  // the solver actually reads must have relief, so the day someone reintroduces
  // the shortcut, this fails rather than quietly scoring a different planet.
  {
    const w = worlds[0];
    const f = frameAt([0.3, 0.7, 0.64]);
    const R = Math.max(w.radiusE, 0.05) * 6.371e6;
    let lo = Infinity, hi = -Infinity;
    for (let x = -1400; x <= 1400; x += 100) {
      for (let z = -1400; z <= 1400; z += 100) {
        const h = macroHeight(f, w, w.oceanLevel, R, x, z);
        if (h < lo) lo = h; if (h > hi) hi = h;
      }
    }
    const real = makeGround(w, [0.3, 0.7, 0.64]);
    let rlo = Infinity, rhi = -Infinity;
    for (let x = -1400; x <= 1400; x += 100) {
      for (let z = -1400; z <= 1400; z += 100) {
        const h = real.heightAt(x, z);
        if (h < rlo) rlo = h; if (h > rhi) rhi = h;
      }
    }
    ok('the ground the solver scores has relief and the macro field does not',
      hi - lo < 5 && rhi - rlo > 40,
      `macro ${(hi - lo).toFixed(1)} m across ±1400 m · real ground`
      + ` ${(rhi - rlo).toFixed(0)} m — the ratio this solver used to be wrong by`);
  }

  // --- properties of the scorer itself ------------------------------------
  {
    const w = worlds[0];
    const g = makeGround(w, [0.3, 0.7, 0.64]);
    const inBand = scoreComposition(g, 1.0, 13.5).terms.band;
    const out = scoreComposition(g, 1.0, 42).terms.band;
    ok('the sun term is 1 inside the band and falls away outside it',
      inBand === 1 && out < 0.1, `13.5° → ${inBand} · 42° → ${out.toFixed(3)}`);
    const t = scoreComposition(g, 1.0, 13.5).terms;
    ok('every term is a normalised [0,1] score',
      Object.values(t).every((v) => v >= 0 && v <= 1 && Number.isFinite(v)),
      Object.entries(t).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · '));
  }

  // --- §2.3 ---------------------------------------------------------------
  {
    const a = solveLandingSite(worlds[2], 12345, { sites: 60 });
    const b = solveLandingSite(worlds[2], 12345, { sites: 60 });
    ok('§2.3 · the same world and seed give the same opening frame',
      a.dir.every((v, i) => v === b.dir[i]) && a.heading === b.heading
      && a.sunElev === b.sunElev);
    const c = solveLandingSite(worlds[2], 999, { sites: 60 });
    ok('and a different seed gives a different one',
      c.heading !== a.heading || c.dir.some((v, i) => v !== a.dir[i]));
  }
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
// suite: aerial
//
// §9.3's aerial perspective, ported from the reference's `aerial()` (lines
// 686–700) and checked before any of it enters a shader — M2 act 2, §7.3.
//
// What is being validated here is *not* the numbers. It is the six properties
// that make this a depth cue rather than a grey wash, each of which can be
// broken by a plausible-looking edit: monotone in distance, transparent inside
// the near plane, saturating at the far one, thinning with altitude, warm
// toward the sun and cool away from it, and pooling mist only where a valley
// floor is. Plus §9.3's NaN guard, which is the one line in the function that
// exists because of a bug rather than because of an effect.

// `aerial()` used to be defined here, which meant the suite proved a copy
// correct and shipped something else. It lives in `src/aerial.js` now, next to
// the GLSL it is the reference for, and this file tests the shipped function.
const AIR = REFERENCE_AIR;

function suiteAerial() {
  console.log('\naerial — §9.3, before it enters a shader (M2 act 2)');

  const GREY = [0.18, 0.18, 0.18];
  const SUN = (() => {
    // §9.7 forces spawn sun into 8–18°; 13.5° is the reference's own
    const e = (13.5 * Math.PI) / 180;
    return [Math.cos(e), Math.sin(e), 0];
  })();
  // V points surface → camera, so looking *at* the sun means V = −sun
  const toward = SUN.map((v) => -v);
  const away = SUN.slice();
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  const at = (dist, y = 100, V = toward, o) => aerial(GREY, dist, V, SUN, y, o);

  ok('inside the near plane there is no fog at all',
    at(0).fog === 0 && at(70).fog === 0,
    'fogNear 70 m — a depth cue that starts at the camera is a wash');

  ok('fog is monotone in distance', (() => {
    let prev = -1;
    for (let i = 0; i <= 4000; i++) {
      const f = at(i * 2).fog;
      if (f < prev - 1e-12) return false;
      prev = f;
    }
    return true;
  })());

  {
    const f1700 = at(1700).fog, f8000 = at(8000).fog;
    ok('it saturates by the far distance without ever exceeding 1',
      f8000 > 0.99 && f8000 <= 1 && f1700 > 0.5 && f1700 < 0.99,
      `f(fogFar) = ${f1700.toFixed(3)} · f(8 km) = ${f8000.toFixed(5)}`);
  }

  // the height term is what stops a valley and a mountaintop reading the same
  {
    const low = at(900, 6).fog, high = at(900, 900).fog;
    ok('air thins with altitude', high < low * 0.75,
      `at 900 m out: ${low.toFixed(3)} at eye height → ${high.toFixed(3)} at 900 m up`
      + ` (${(high / low).toFixed(2)}×)`);
    ok('the height falloff floors at the 0.72 mix rather than vanishing',
      at(900, 1e6).fog > 0.05,
      'above the haze layer the air is thin, not absent — hf → 1 − 0.72 = 0.28');
  }

  // §9.3: the fog colour is *not* one colour. If it were, this pair would match
  {
    const t = at(1500).col, a = at(1500, 100, away).col;
    const warmth = (c) => c[0] - c[2];
    ok('fog toward the sun is warmer than fog away from it',
      warmth(t) > warmth(a) + 0.02,
      `r−b: ${warmth(t).toFixed(4)} toward · ${warmth(a).toFixed(4)} away`);
    ok('and it is a hue shift, not just a brightness one',
      Math.abs(lum(t) - lum(a)) < 0.5 * Math.abs(warmth(t) - warmth(a)) + 0.1,
      `luma ${lum(t).toFixed(4)} vs ${lum(a).toFixed(4)}`);
  }

  // mist pools in the valley floor — low *and* far, never one without the other
  {
    const floorFar = at(600, 10).fog;
    const floorNear = at(90, 10).fog;
    const ridgeFar = at(600, 200).fog;
    ok('mist needs both height and distance to pool',
      floorFar > ridgeFar && floorNear < 0.2,
      `valley floor at 600 m ${floorFar.toFixed(3)} · same height at 90 m ${floorNear.toFixed(3)}`
      + ` · ridge at 600 m ${ridgeFar.toFixed(3)}`);

    // Compared at one distance and one view direction, so the only thing that
    // differs is the pool term — and the claim is directional, that the colour
    // moves *toward* K_MIST. Asserting an absolute channel order here would be
    // asserting the Mie term instead, which at 13.5° dominates anything the
    // pool does.
    const d2 = (c) => c.reduce((s, v, i) => s + (v - AIR.mist[i]) ** 2, 0);
    const pooled = at(600, 10).fc, dry = at(600, 60).fc;
    ok('pooling moves the fog colour toward mist',
      d2(pooled) < d2(dry),
      `‖fc − mist‖² ${d2(dry).toFixed(4)} at 60 m → ${d2(pooled).toFixed(4)} on the valley floor`);
  }

  // §9.3's one defensive line, and the reason it is there
  {
    const bad = aerial(GREY, NaN, toward, SUN, 100);
    ok('§9.3 · a NaN depth does not poison the colour',
      bad.col.every((v) => v === v) && bad.fog === bad.fog && bad.fog <= 1,
      `NaN depth → fog ${bad.fog} · colour [${bad.col.map((v) => v.toFixed(3)).join(', ')}]`);
    const inf = aerial(GREY, Infinity, toward, SUN, 100);
    ok('an infinite depth saturates rather than overflowing',
      inf.col.every(Number.isFinite) && inf.fog === 1);
  }

  // the whole point of §9.3's alpha trick: fog must be a usable distance proxy
  {
    let worst = 0;
    for (let i = 1; i <= 400; i++) {
      const a = at(i * 10).fog, b = at((i + 1) * 10).fog;
      worst = Math.max(worst, b - a);
    }
    ok('the fog fraction is smooth enough to serve as the post chain\'s depth',
      worst < 0.02, `largest step over a 10 m increment: ${worst.toFixed(4)}`);
  }

  // -------------------------------------------------------------------------
  // §16.3 · the three constants that could not port as literals
  //
  // Each of these is a recommendation in docs/plans/M2.md that was signed off
  // as prose. Prose does not fail. These are the same three claims written so
  // that a wrong one is a red line rather than a paragraph nobody re-read.

  // a · extinction lengths scale with how much air there is, not with the
  //     world's size — and the airless case has to fall out of the formula
  {
    const EARTHLIKE = { Teq: 255, massE: 1, radiusE: 1, typeId: 1 };
    const thick = aerialParams(EARTHLIKE, 1, 1);
    ok('§16.3a · a temperate world reproduces the reference\'s extinction lengths',
      Math.abs(thick.near - 70) < 1e-9 && Math.abs(thick.far - 1700) < 1e-9,
      `near ${thick.near.toFixed(1)} m · far ${thick.far.toFixed(1)} m`);

    const thin = aerialParams(EARTHLIKE, 0.25, 1);
    ok('thinner air sees further, in exact proportion',
      Math.abs(thin.far - 1700 / 0.25) < 1e-6,
      `atmo 0.25 → far ${thin.far.toFixed(0)} m (${(thin.far / thick.far).toFixed(2)}×)`);

    // The check the parameterisation exists to pass: no branch, no special
    // case, the fog simply is not there.
    const airless = aerialParams({ ...EARTHLIKE, typeId: 0 }, 0, 1);
    const P = airless;
    let worstAirless = 0;
    for (let d = 0; d <= 4000; d += 25) {
      worstAirless = Math.max(worstAirless, aerial(GREY, d, toward, SUN, 6, P).fog);
    }
    ok('§16.3a · an airless world has no fog, with no special case for it',
      worstAirless < 1e-6,
      `strongest fog anywhere inside 4 km: ${worstAirless.toExponential(2)}`);

    // and the resonance's mood multiplier is the same lever, not a second one
    const moody = aerialParams(EARTHLIKE, 1, 1.7);
    ok('the resonance\'s hazeX rides the same term as the atmosphere',
      Math.abs(moody.far * 1.7 - thick.far) < 1e-6,
      `hazeX 1.7 → far ${moody.far.toFixed(0)} m`);
  }

  // b · the air colours come from the star, and the reference is the fixture
  {
    const fix = airFor(5778, 13.5);
    const worst = Math.max(...Object.keys(REFERENCE_AIR).map((k) =>
      Math.max(...fix[k].map((v, i) => Math.abs(v - REFERENCE_AIR[k][i])))));
    ok('§16.3b · the transfer reproduces §9.1\'s air for a G-type star at 13.5°',
      worst < 1 / 255,
      `largest channel error across haze, mist, horizon-sun and anti: ${(worst * 255).toFixed(3)}/255`);

    // an M dwarf must move it, or the transfer is a lookup table
    const dwarf = airFor(3200, 13.5);
    const warmth = (c) => c[0] - c[2];
    ok('and a cooler star reddens the air rather than leaving it alone',
      warmth(dwarf.haze) > warmth(fix.haze) + 0.02,
      `haze r−b: ${warmth(fix.haze).toFixed(4)} at 5778 K → ${warmth(dwarf.haze).toFixed(4)} at 3200 K`);
  }

  // c · 260 m is a haze scale height, and haze is a fixed fraction of the air
  {
    const H = scaleHeight(EARTH_AIR.T, EARTH_AIR.M, EARTH_AIR.g);
    ok('§16.3c · Earth\'s dry-air scale height comes out of RT/(Mg)',
      Math.abs(H - 8435) < 25, `H = ${H.toFixed(0)} m (measured: 8.4–8.5 km)`);

    ok('the greenhouse puts Earth\'s surface 33 K above its equilibrium',
      Math.abs(surfaceTemp(255, 1) - 288.15) < 0.4,
      `Teq 255 K → ${surfaceTemp(255, 1).toFixed(1)} K surface`);

    const earth = aerialParams({ Teq: 255, massE: 1, radiusE: 1, typeId: 1 }, 1, 1);
    ok('§16.3c · a temperate world reproduces the reference\'s 260 m haze layer',
      Math.abs(earth.hazeH - 260) < 0.5,
      `hazeH = ${earth.hazeH.toFixed(2)} m · fraction ${HAZE_FRACTION.toFixed(6)}`);

    // the scaling, not the value: a heavier world holds its haze closer down
    const heavy = aerialParams({ Teq: 255, massE: 4, radiusE: 1.5, typeId: 1 }, 1, 1);
    const gRatio = 4 / (1.5 * 1.5);
    ok('haze depth follows gravity inversely, as a scale height must',
      Math.abs(heavy.hazeH * gRatio - earth.hazeH) < 1e-6,
      `g = ${gRatio.toFixed(2)} g⊕ → hazeH ${heavy.hazeH.toFixed(1)} m`);

    ok('a gas giant\'s hydrogen holds a far deeper column than a rocky world\'s air',
      molarMass(6) < molarMass(1) / 10
      && aerialParams({ Teq: 130, massE: 300, radiusE: 11, typeId: 6 }, 1, 1).hazeH > earth.hazeH,
      `μ = ${molarMass(6)} vs ${molarMass(1)} kg/mol`);
  }

  // The GLSL is generated from the same constants as the CPU function above,
  // rather than transcribed beside it. §11 names exactly this drift — two
  // definitions, free to move apart — as a trap that "will look like a
  // rendering bug and cost a day."
  {
    const shares = [
      ['the fog exponent', '1.28'],
      ['the fog gain', '3.1'],
      ['the height mix', '0.72'],
    ];
    ok('§2.7 · the GLSL carries the same curve constants as the CPU reference',
      shares.every(([, v]) => AERIAL_GLSL.includes(v)),
      shares.map(([n, v]) => `${n} ${v}`).join(' · '));
    // Strip the commentary first. The first version of this check grepped the
    // whole string and failed on the comment that *explains* the rule, which
    // is a test of the prose rather than of the code.
    const code = AERIAL_GLSL.replace(/\/\/[^\n]*/g, '');
    ok('the GLSL never writes a descending smoothstep, which GLSL leaves undefined',
      !/smoothstep\(\s*46\.0\s*,\s*8\.0/.test(code)
      && code.includes('1.0 - smoothstep(8.0, 46.0, worldY)'));
    ok('and it returns the fog fraction rather than hiding it in a global',
      /vec4 aerial\(/.test(code) && !/gFogAmt/.test(code));

    // The encoding, asserted rather than assumed. An opaque material that has
    // never heard of §9.3 writes a = 1, and under "alpha is fog" that reads as
    // maximally distant — the heaviest watercolour wash in the frame poured
    // over the nearest tree. Inverted, the same 1 means "clear", which is what
    // it already meant. See src/aerial.js's note.
    ok('alpha carries clarity, so an unported material defaults to no fog',
      AERIAL_ALPHA_IS_CLARITY && code.includes('1.0 - f)'),
      'a = 1 - fog · an opaque material writing 1 reads as sharp, not as far');
  }
}

// ---------------------------------------------------------------------------
// suite: starlight
//
// §9.6's transfer (M2 act 2 step 2). Two things have to be true at once and
// they pull in opposite directions: the fixture must come out *exactly* as
// §9.1 paints it, and every other star must move by what the physics says.
// A transfer that only did the first is a lookup table; one that only did the
// second is the scattering integral §9.6 already rejected.
//
// The machinery underneath gets checked against a constant nobody in this repo
// chose — the Planckian locus — so the spectral pipeline is validated against
// colour science rather than against itself.

function suiteStarlight() {
  console.log('\nstarlight — §9.6, the transfer that produced §9.1 (M2 act 2)');

  // --- the machinery, against published values -----------------------------

  // A 6504 K blackbody is D65 by definition of the standard illuminant's
  // correlated colour temperature; its CIE 1931 chromaticity is the Planckian
  // locus point (0.3135, 0.3236). Nothing in this repo can influence that.
  {
    const xyz = spectrumToXYZ((l) => planck(l, 6504));
    const s = xyz[0] + xyz[1] + xyz[2];
    const x = xyz[0] / s, y = xyz[1] / s;
    ok('a 6504 K blackbody lands on the Planckian locus',
      Math.abs(x - 0.3135) < 0.006 && Math.abs(y - 0.3236) < 0.006,
      `x ${x.toFixed(4)} y ${y.toFixed(4)} · published (0.3135, 0.3236)`);
  }
  {
    // Wien: the peak of a 5778 K blackbody sits at 2.898e6/T ≈ 502 nm
    let peak = 0, at = 0;
    for (let l = 300; l <= 900; l += 0.5) {
      const v = planck(l, 5778);
      if (v > peak) { peak = v; at = l; }
    }
    near('Wien displacement for a 5778 K star', at, 2.8977719e6 / 5778, 0.002);
  }
  ok('air mass is 1 at the zenith and grows toward the horizon',
    Math.abs(airmass(90) - 1) < 0.001 && airmass(13.5) > 4 && airmass(0) > 30,
    `X(90°) ${airmass(90).toFixed(3)} · X(13.5°) ${airmass(13.5).toFixed(2)}`
    + ` · X(0°) ${airmass(0).toFixed(1)}`);
  {
    // the sRGB round trip has to be exact enough to compare hexes at all
    let worst = 0;
    for (const s of Object.values(STOPS)) {
      const back = linearToHex(hexToLinear(s.hex));
      if (back !== s.hex) worst++;
    }
    ok('every §9.1 stop survives a linear round trip unchanged', worst === 0,
      `${Object.keys(STOPS).length} stops`);
  }
  ok('XYZ → linear sRGB sends D65 white to equal channels', (() => {
    const rgb = xyzToLinearSRGB([0.95047, 1, 1.08883]);
    return rgb.every((v) => Math.abs(v - 1) < 0.002);
  })(), 'the matrix is the sRGB one, not a lookalike');

  // --- the fixture, which §9.6 makes a requirement --------------------------

  {
    const got = airColours(FIXTURE.T, FIXTURE.elev);
    let worst = 0, worstName = '';
    for (const [name, stop] of Object.entries(STOPS)) {
      const want = hexToLinear(stop.hex);
      const d = Math.max(...got[name].map((v, i) => Math.abs(v - want[i])));
      if (d > worst) { worst = d; worstName = name; }
    }
    ok('§9.6 · the transfer reproduces §9.1 exactly for a G-type star at 13.5°',
      worst < 1 / 255 / 12.92,
      `worst channel error ${worst.toExponential(2)} (${worstName}), against`
      + ` a display step of ${(1 / 255 / 12.92).toExponential(2)} in linear light`);
    ok('and it reproduces them as the same hex strings',
      Object.entries(STOPS).every(([n, s]) => linearToHex(got[n]) === s.hex),
      Object.keys(STOPS).map((n) => linearToHex(got[n])).join(' '));
  }

  // --- and every other star moves by what the physics says ------------------

  const warmth = (rgb) => Math.log((rgb[0] + 1e-6) / (rgb[2] + 1e-6));

  {
    // an A-type star is hotter and bluer; an M dwarf cooler and redder. The
    // claim is directional and monotone, which a lookup table cannot fake.
    const T = [3200, 4200, 5778, 7500, 9500];
    const w = T.map((t) => warmth(airColours(t, FIXTURE.elev).skyZenith));
    let mono = true;
    for (let i = 1; i < w.length; i++) if (w[i] >= w[i - 1]) mono = false;
    ok('a hotter star makes a bluer zenith, monotonically', mono,
      T.map((t, i) => `${t}K ${w[i].toFixed(2)}`).join(' · '));
  }
  {
    let mono = true;
    const T = [3200, 4200, 5778, 7500, 9500];
    for (const name of Object.keys(STOPS)) {
      const w = T.map((t) => warmth(airColours(t, FIXTURE.elev)[name]));
      for (let i = 1; i < w.length; i++) if (w[i] >= w[i - 1]) mono = false;
    }
    ok('every stop moves the same way, so the palette stays a palette', mono,
      `${Object.keys(STOPS).length} stops, 5 temperatures`);
  }
  {
    // a star climbing the sky crosses less air, so its beam reddens less
    const low = warmth(airColours(FIXTURE.T, 4).sunDisc);
    const high = warmth(airColours(FIXTURE.T, 60).sunDisc);
    ok('a higher sun has a less reddened disc', high < low,
      `4° ${low.toFixed(3)} → 60° ${high.toFixed(3)}`);
  }
  {
    // §9.1's painted brightness is a strong preference, not an invariant — the
    // gamut takes some of it back at the bright end. What must survive is the
    // *ordering*: the four-stop wash runs dark at the zenith to bright at the
    // horizon, and that is composition, not colour science.
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    let held = true, drift = 0, at = '';
    const seen = [];
    for (const T of [2800, 3200, 5778, 9500, 12000]) {
      const a = airColours(T, FIXTURE.elev);
      const asc = lum(a.skyZenith) < lum(a.skyUpper)
        && lum(a.skyUpper) < lum(a.skyMid) && lum(a.skyMid) < lum(a.skyHorizon);
      if (!asc) { held = false; seen.push(`${T}K INVERTED`); }
      for (const [n, s] of Object.entries(STOPS)) {
        if (s.beam !== undefined) continue;
        const d = Math.abs(lum(a[n]) - lum(hexToLinear(s.hex)));
        if (d > drift) { drift = d; at = `${T}K/${n}`; }
      }
    }
    ok('the four-stop wash keeps its order under every star', held,
      seen.length ? seen.join(' · ') : '2800–12000 K'
      + ` · worst luminance drift ${drift.toFixed(3)} (${at})`);
  }
  {
    // haze and mist are aerosol, so they must stay greyer than the Rayleigh sky
    const sat = (c) => (Math.max(...c) - Math.min(...c)) / Math.max(...c, 1e-6);
    const a = airColours(FIXTURE.T, FIXTURE.elev);
    ok('haze and mist stay less saturated than the sky they hang in',
      sat(a.haze) < sat(a.skyZenith) && sat(a.mist) < sat(a.skyZenith),
      `zenith ${sat(a.skyZenith).toFixed(3)} · haze ${sat(a.haze).toFixed(3)}`
      + ` · mist ${sat(a.mist).toFixed(3)}`);
  }
  // The gamut mapper, tested as itself rather than through the transfer. An
  // end-to-end saturation check cannot separate "the mapper desaturated this"
  // from "an 8000 K horizon is genuinely near-neutral on its way from warm to
  // cool" — and the second is the transfer working, not failing.
  {
    const inGamut = [0.2, 0.5, 0.9];
    ok('a colour already inside the gamut passes through untouched',
      toGamut(inGamut).every((v, i) => v === inGamut[i]));

    const tooBright = [2.0, 1.6, 1.2];
    const mapped = toGamut(tooBright);
    const ratio = mapped.map((v, i) => v / tooBright[i]);
    ok('too bright is answered by dimming, at exactly constant hue',
      Math.max(...mapped) === 1
      && Math.abs(ratio[0] - ratio[1]) < 1e-12 && Math.abs(ratio[1] - ratio[2]) < 1e-12,
      `[${tooBright.join(', ')}] → [${mapped.map((v) => v.toFixed(3)).join(', ')}]`);

    const outOfHue = [0.9, 0.4, -0.35];
    const fixed = toGamut(outOfHue);
    const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    ok('a hue outside the gamut gives up chroma at constant luminance',
      fixed.every((v) => v >= 0 && v <= 1)
      && Math.abs(lum(fixed) - lum(outOfHue)) < 1e-9,
      `[${outOfHue.join(', ')}] → [${fixed.map((v) => v.toFixed(3)).join(', ')}]`);

    let s = 987654321;
    const rnd = () => (s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    let bad = 0;
    for (let i = 0; i < 4000; i++) {
      const c = [rnd() * 3 - 0.6, rnd() * 3 - 0.6, rnd() * 3 - 0.6];
      if (!toGamut(c).every((v) => v >= 0 && v <= 1)) bad++;
    }
    ok('and it always lands in gamut', bad === 0, '4000 colours, seeded');
  }
  {
    // The beam stops are a different case, and asserting they never clip would
    // be asserting something §9.1 already violates: `sunDisc` is #FFFAEA, which
    // is 255 in red before this file touches it, and §9.6 paints the disc
    // "3× oversize and never blown out" on purpose. Any star warmer than the
    // fixture must therefore clip, and clamping is the right answer — it takes
    // blue down rather than red up, which is what a red dwarf's disc does.
    //
    // What has to survive that is the ordering. Two stars whose discs clipped
    // to the same colour would mean the transfer had stopped saying anything.
    const beams = Object.entries(STOPS).filter(([, s]) => s.beam !== undefined);
    const T = [2800, 3500, 5778, 8000, 12000];
    let held = true;
    const shown = [];
    for (const [n] of beams) {
      const w = T.map((t) => warmth(airColours(t, FIXTURE.elev)[n]));
      for (let i = 1; i < w.length; i++) if (w[i] >= w[i - 1]) held = false;
      shown.push(`${n} ${linearToHex(airColours(2800, FIXTURE.elev)[n])}`
        + `→${linearToHex(airColours(12000, FIXTURE.elev)[n])}`);
    }
    ok('the beam stops stay ordered and distinct through the clamp', held,
      shown.join(' · '));
  }
  {
    // §2.3: same inputs, same sky, forever
    const a = JSON.stringify(airColours(4100, 9.2));
    const b = JSON.stringify(airColours(4100, 9.2));
    ok('the transfer is pure — same star, same sky', a === b);
  }

  // What an M dwarf actually looks like, reported rather than asserted. This is
  // the line to read when deciding whether §9.6's port did something worth
  // having, and it is the first non-solar sky this project has ever computed.
  {
    const m = airColours(3200, 13.5), a = airColours(9500, 13.5);
    console.log(`       M dwarf 3200 K · zenith ${linearToHex(m.skyZenith)}`
      + ` horizon ${linearToHex(m.skyHorizon)} disc ${linearToHex(m.sunDisc)}`);
    console.log(`       A-type 9500 K  · zenith ${linearToHex(a.skyZenith)}`
      + ` horizon ${linearToHex(a.skyHorizon)} disc ${linearToHex(a.sunDisc)}`);
  }
}

// ---------------------------------------------------------------------------

const only = process.argv[2];
// ---------------------------------------------------------------------------
// suite: ground
//
// `src/ground.js` is the one definition of the walkable ground (§2.7's rule,
// applied one level up from the GLSL↔JS parity it was written about). Its
// output is not a rendering detail: **the ground is the address.** §2.3 says
// the same seed gives the same universe on every machine forever, and a
// shared URL that lands a metre off a cliff it was screenshotted on has
// broken that promise as surely as a changed seed would.
//
// So the guard is a fingerprint, not an intention. These checksums were taken
// the day the formula moved out of `surface.js` — verified against 441 samples
// captured from the browser *before* the move, 0 of which differed. Any future
// edit that shifts a world by a millimetre fails here and has to say so out
// loud.
//
// Two worlds, deliberately: a flat coastal shelf and a mountainous one. A
// single sample world would let a change to the landform contribution or to
// the relief ramp pass unseen, and those are the terms most likely to be
// tuned.

function suiteGround() {
  console.log('\nground — the one definition of the walkable ground (§2.7, §2.3)');

  const WORLDS = [
    { label: 'coastal shelf', relief: 24.4, sum: -10717.5872,
      dir: [0.31, 0.62, 0.72],
      pp: { seed: 0x5eed1337, typeId: 1, noiseSeed: 424242, oceanLevel: 0.012, radiusE: 1.04 } },
    { label: 'mountainous world', relief: 764.6, sum: 189612.3066,
      dir: [0.1, 0.9, 0.42],
      pp: { seed: 0x5eed1337, typeId: 0, noiseSeed: 7777, oceanLevel: -1, radiusE: 0.55 } },
  ];

  for (const w of WORLDS) {
    const g = makeGround(w.pp, w.dir);
    let sum = 0, lo = Infinity, hi = -Infinity, n = 0;
    for (let x = -1300; x <= 1300; x += 130) {
      for (let z = -1300; z <= 1300; z += 130) {
        const h = g.heightAt(x, z);
        sum += h; n++;
        if (h < lo) lo = h;
        if (h > hi) hi = h;
      }
    }
    ok(`§2.3 · the ${w.label} is where it has always been`,
      n === 441 && Math.abs(sum - w.sum) < 1e-3 && Math.abs((hi - lo) - w.relief) < 0.1,
      `441 samples · checksum ${sum.toFixed(4)} (golden ${w.sum.toFixed(4)})`
      + ` · relief ${(hi - lo).toFixed(1)} m`);
  }

  // The measurement that reset every constant in the landing solver, kept
  // runnable because a number that explains a mistake is worth being able to
  // re-take. Both halves matter: the ground must have relief, and it must be
  // finite everywhere — a NaN here poisons a whole world silently.
  {
    const g = makeGround(WORLDS[1].pp, WORLDS[1].dir);
    let finite = true;
    for (let x = -1400; x <= 1400; x += 70) {
      for (let z = -1400; z <= 1400; z += 70) {
        if (!Number.isFinite(g.heightAt(x, z))) { finite = false; break; }
      }
    }
    ok('the ground is finite everywhere on the walkable extent', finite,
      '1681 samples over \u00b11400 m');
  }

  // `lift` and `impacts` are state the ground owns and callers mutate —
  // surface.js raises a waterlocked world after the spawn scan, and craters are
  // carved per visit. If the height function closed over their initial values
  // instead of reading them, both would silently stop working.
  {
    const g = makeGround(WORLDS[0].pp, WORLDS[0].dir);
    const before = g.heightAt(0, 0);
    g.lift = 12.5;
    const lifted = g.heightAt(0, 0);
    g.lift = 0;
    g.impacts.push({ x: 0, z: 0, r: 60, depth: 30, grown: 1 });
    const cratered = g.heightAt(0, 0);
    ok('the height function reads `lift` and `impacts` live, not at build time',
      Math.abs(lifted - before - 12.5) < 1e-9 && cratered < before - 1,
      `lift +12.5 m \u2192 ${(lifted - before).toFixed(2)} m`
      + ` \u00b7 a 30 m crater \u2192 ${(cratered - before).toFixed(2)} m`);
  }
}


const suites = {
  cosmology: suiteCosmology, zeldovich: suiteZeldovich, webclass: suiteWebclass,
  print: suitePrint, aerial: suiteAerial, starlight: suiteStarlight,
  paint: suitePaint, landing: suiteLanding, ground: suiteGround,
};

for (const [name, fn] of Object.entries(suites)) {
  if (only && only !== name) continue;
  fn();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
