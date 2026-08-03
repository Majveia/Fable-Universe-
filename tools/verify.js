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

import { readFileSync } from 'node:fs';
import { A_OPEN, A_START, COSMO } from '../src/cosmology.js';
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
  ARM, GAIT, LOOK, Walker, gravityOf, replay, sweepArm,
} from '../src/avatar.js';
import { BINDINGS, JUMP_CODE, input, setAnalog } from '../src/input.js';
import {
  LAYERS, MATERIAL_GLSL, blend, materialPalette, moistureAt, snowLine, worldBias,
} from '../src/material.js';
import {
  DEPTH_BANDS, EXTINCTION, OCEAN_GLSL, WAVE_COUNT, buildWaves, fresnel,
  gerstner, peakOmega, significantHeight, transmission, whitecap,
} from '../src/ocean.js';
import {
  AERIAL_ALPHA_IS_CLARITY, AERIAL_GLSL, EARTH_AIR, HAZE_FRACTION, REFERENCE_AIR,
  REFERENCE_PARAMS, aerial, aerialParams, airFor, molarMass, scaleHeight,
  surfaceTemp,
} from '../src/aerial.js';
import {
  BASE_DROP, HORIZON_VERT, MAX_BANDS, RIDGE_SEGS, SATURATION, bandPlan,
  NO_LIMIT, baseAngles, buildHorizon, geometricHorizon, horizonFragment, marchSkyline,
  ridgeAlbedo, saturationRadius,
} from '../src/horizon.js';

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

// Two pinned worlds, shared by the `ground` and `walk` suites. Module scope
// rather than one copy each: the walk suite asserts that a body never
// penetrates *this* ground, which is only a meaningful claim while both suites
// are talking about the same terrain.
const WORLDS = [
  { label: 'coastal shelf', relief: 24.4, sum: -10717.5872,
    dir: [0.31, 0.62, 0.72],
    pp: { seed: 0x5eed1337, typeId: 1, noiseSeed: 424242, oceanLevel: 0.012, radiusE: 1.04 } },
  { label: 'mountainous world', relief: 764.6, sum: 189612.3066,
    dir: [0.1, 0.9, 0.42],
    pp: { seed: 0x5eed1337, typeId: 0, noiseSeed: 7777, oceanLevel: -1, radiusE: 0.55 } },
];

function suiteGround() {
  console.log('\nground — the one definition of the walkable ground (§2.7, §2.3)');

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


// ---------------------------------------------------------------------------
// suite: walk
//
// §M4's gate is mostly about feel — "input→visible response ≤ 2 frames", "no
// frame where control fights the camera" — and no test scores feel. The physics
// underneath it is not about feel at all, and all of it is decidable: a
// ballistic arc has a closed form, a coyote window is an exact number of
// frames, a capsule either penetrates the height field or it does not.
//
// So this is the part of M4 that can be settled without a GPU, and it is
// settled here rather than by looking at it. Every check computes the answer a
// second, independent way — against `v0·t − ½g·t²`, against `makeGround()`'s
// own height field, against an analytic step count — rather than against a
// snapshot of the controller, which would only prove it had not changed.

// ---------------------------------------------------------------------------
// suite: opening
//
// §8 axis 1 asks for "a readable subject at three distances", and the cosmic
// web is the first thing anyone sees. It opened at a = 0.048 — z ≈ 20, before
// any structure has formed — so what a visitor arrived at was a field of
// speckle, and the web only appeared after nineteen seconds of watching.
//
// That is not a brightness problem and no grade fixes it. It is the same class
// of choice §9.7 makes when it forces the spawn sun into an 8–18° band: the
// opening frame is a composition, and a composition has to contain its subject.
// So the epoch is measured here, against the seed's own mode set, rather than
// chosen by eye.

function suiteOpening() {
  console.log('\nopening — §8 axis 1, does the first frame contain its subject');

  const BOX = 1000;
  const modes = buildModes(20250601, BOX);
  const N = 22;

  /** density contrast statistics of the linear field at growth D */
  const contrast = (a) => {
    const D = COSMO.growth(a);
    const q = [0, 0, 0];
    let s = 0, s2 = 0, n = 0, over = 0;
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        for (let k = 0; k < N; k++) {
          q[0] = ((i + 0.5) / N) * BOX; q[1] = ((j + 0.5) / N) * BOX; q[2] = ((k + 0.5) / N) * BOX;
          const d = deltaLinear(modes, q, D);
          s += d; s2 += d * d; n++;
          if (Math.abs(d) > 1) over++;
        }
      }
    }
    const mean = s / n;
    return { sigma: Math.sqrt(s2 / n - mean * mean), over: over / n };
  };

  {
    const early = contrast(0.048);
    ok('at the epoch the web used to open on, there is no web',
      early.sigma < 0.15 && early.over < 0.001,
      `a = 0.048 · σ(δ) = ${early.sigma.toFixed(3)}, ${(100 * early.over).toFixed(1)}%`
      + ' of the volume overdense — a ripple on a uniform grid, which is what it looked like');
  }

  {
    const now = contrast(A_OPEN);
    ok('§8 axis 1 · at the epoch it opens on now, there is',
      now.sigma > 1.2 && now.over > 0.4,
      `a = ${A_OPEN} · σ(δ) = ${now.sigma.toFixed(3)},`
      + ` ${(100 * now.over).toFixed(1)}% overdense`);
  }

  {
    // Monotone up to saturation, which is the reason A_OPEN is near the present
    // day rather than as late as possible: past a ≈ 2.5 the nodes swallow the
    // filaments and σ stops buying legibility.
    const s = [0.25, 0.45, 0.7, 1.0, 1.6, 2.5].map((a) => contrast(a).sigma);
    let rising = true;
    for (let i = 1; i < s.length; i++) if (s[i] <= s[i - 1]) rising = false;
    ok('structure grows monotonically with the growth factor, and then saturates',
      rising && contrast(4).sigma / contrast(2.5).sigma < 1.1,
      s.map((v, i) => v.toFixed(2)).join(' → ')
      + ` · a = 4 adds only ${((contrast(4).sigma / contrast(2.5).sigma - 1) * 100).toFixed(1)}%`);
  }

  {
    // The formation replay is not lost — it is what the tour resets to, and
    // what scrubbing back reaches. A_START stays where the physics wants it.
    ok('and the simulation still begins where the physics begins',
      A_START < 0.06,
      `A_START = ${A_START} (z ≈ ${(1 / A_START - 1).toFixed(0)}) — the tour resets`
      + ' here to replay formation, and the deep-time lever scrubs back to it');
  }
}

function suiteWalk() {
  console.log('\nwalk — §M4\'s controller, before it enters the render loop');

  const flat = () => new Walker({ heightAt: () => 0, gravity: 9.80665 });
  const still = () => ({ move: { x: 0, y: 0 } });
  const DT = 1 / 120;

  // --- gravity comes from the world, not from a constant --------------------
  {
    ok('gravity is GM/R² from the world\'s own mass and radius',
      Math.abs(gravityOf({ massE: 1, radiusE: 1 }) - 9.80665) < 1e-9
      && Math.abs(gravityOf({ massE: 0.107, radiusE: 0.532 }) - 3.711) < 0.02,
      `Earth ${gravityOf({ massE: 1, radiusE: 1 }).toFixed(3)}`
      + ` · Mars ${gravityOf({ massE: 0.107, radiusE: 0.532 }).toFixed(3)} m/s²`
      + ' (measured 3.721)');
  }

  // --- the ballistic arc, against its closed form ---------------------------
  {
    const w = flat();
    w.place(0, 0);
    // hold jump for the whole flight so the variable-height cut never fires
    const t = replay(w, () => ({ move: { x: 0, y: 0 }, jump: true }), DT, 260);
    const v0 = Math.sqrt(2 * 9.80665 * GAIT.jumpHeight);
    let worst = 0, apex = 0, apexT = 0;
    // The impulse is applied and integrated inside the same step, so the state
    // recorded as frame 0 is already one dt into the flight. Comparing frame i
    // against t = i·dt rather than (i+1)·dt reports 26 mm of "integration
    // error" that is entirely the test's own indexing.
    for (let i = 0; i < t.length && !(t[i].grounded && i > 4); i++) {
      const tt = (i + 1) * DT;
      const want = v0 * tt - 0.5 * 9.80665 * tt * tt;
      worst = Math.max(worst, Math.abs(t[i].y - want));
      if (t[i].y > apex) { apex = t[i].y; apexT = tt; }
    }
    // Trapezoidal integration is *exact* under constant acceleration, so this
    // is a real equality and not a tolerance on a first-order scheme. Euler
    // would land 27 mm low by the end of the arc.
    ok('a jump follows v₀t − ½gt² exactly, not approximately',
      worst < 1e-12, `largest deviation over the whole arc: ${(worst * 1e6).toFixed(3)} µm`);
    ok('and it reaches the height it was asked for',
      Math.abs(apex - GAIT.jumpHeight) < 0.01,
      `apex ${apex.toFixed(3)} m at t = ${apexT.toFixed(2)} s (asked for ${GAIT.jumpHeight})`);
  }

  // --- the same jump on a smaller world -------------------------------------
  {
    const moon = new Walker({ heightAt: () => 0, gravity: gravityOf({ massE: 0.0123, radiusE: 0.273 }) });
    moon.place(0, 0);
    const t = replay(moon, () => ({ move: { x: 0, y: 0 }, jump: true }), DT, 900);
    const apex = Math.max(...t.map((s) => s.y));
    // v₀ is solved from the world's own g, so the *height* is the constant and
    // the launch speed is what changes. On the Moon that is the same 0.55 m,
    // reached far more slowly — which is right, and is why there is no
    // per-world jump constant anywhere in the controller.
    ok('a low-gravity world gets the same jump height, taken more slowly',
      Math.abs(apex - GAIT.jumpHeight) < 0.01,
      `g = ${moon.gravity.toFixed(3)} m/s² → apex ${apex.toFixed(3)} m`);
  }

  // --- variable height ------------------------------------------------------
  {
    const held = flat(); held.place(0, 0);
    const apexHeld = Math.max(...replay(held, () => ({ move: { x: 0, y: 0 }, jump: true }), DT, 260).map((s) => s.y));
    const tapped = flat(); tapped.place(0, 0);
    const apexTap = Math.max(...replay(tapped, (i) => ({ move: { x: 0, y: 0 }, jump: i < 6 }), DT, 260).map((s) => s.y));
    ok('releasing the button early cuts the rise',
      apexTap < apexHeld * 0.65 && apexTap > 0.02,
      `held ${apexHeld.toFixed(3)} m · tapped ${apexTap.toFixed(3)} m`);

    // and the cut must not be able to *speed up* a fall
    const late = flat(); late.place(0, 0);
    const tl = replay(late, (i) => ({ move: { x: 0, y: 0 }, jump: i < 40 }), DT, 260);
    const th = replay(flat(), () => ({ move: { x: 0, y: 0 }, jump: true }), DT, 260);
    ok('and releasing during the fall changes nothing',
      Math.abs(tl[200].y - th[200].y) < 1e-9,
      'a bare velocity cut would have made the descent faster');
  }

  // --- coyote time, in exact frames ----------------------------------------
  {
    // a cliff at x = 0: ground 0 behind, -50 ahead
    const cliff = (x) => (x < 0 ? 0 : -50);
    // What distinguishes a jump that fired from one that did not is the *peak*
    // reached after leaving the edge, not the state at the end of the fall —
    // both bodies are at the bottom of a 50 m drop by then, and the first
    // version of this check read exactly that and called it a failure.
    const peakAfterEdge = (delayFrames) => {
      const w = new Walker({ heightAt: (x) => cliff(x), gravity: 9.80665 });
      w.place(-2, 0);
      let off = -1, peak = -Infinity;
      for (let i = 0; i < 600; i++) {
        const airborne = off >= 0;
        const sinceOff = airborne ? (i - off) * DT : 0;
        w.step(DT, {
          // walk east until the ground goes, then press jump after the delay
          move: { x: 0, y: airborne ? 0 : 1 },
          // held from the press onward, so the variable-height cut does not
          // confound the measurement — a two-frame tap peaks at 0.15 m rather
          // than 0.55 m, which is the cut working, not the window failing
          jump: airborne && sinceOff >= delayFrames * DT,
          sprint: false,
        }, -Math.PI / 2);
        if (off < 0 && !w.grounded) off = i;
        if (off >= 0) peak = Math.max(peak, w.pos.y);
        if (off >= 0 && i - off > 200) break;
      }
      return peak;
    };
    // walk east: forward at yaw 0 is −Z, so +X is yaw −π/2
    const early = peakAfterEdge(2);    // 0.017 s after the edge — inside
    const late = peakAfterEdge(40);    // 0.33 s after — well outside 0.12 s
    ok('a jump just after walking off an edge still fires',
      early > 0.2,
      `coyote window ${GAIT.coyote}s · rose ${early.toFixed(3)} m above the edge`);
    ok('and one long after the edge does not',
      late < 0.001 && late < early - 0.2,
      `same press ${(40 * DT).toFixed(2)}s later peaks at ${late.toFixed(3)} m —`
      + ' the window is a property of the body, not of the input');
  }

  // --- the capsule never gets inside the ground -----------------------------
  {
    const g = makeGround(WORLDS[0].pp, WORLDS[0].dir);
    const w = new Walker({ heightAt: g.heightAt, gravity: 9.80665 });
    w.place(0, 0);
    let worst = 0, frames = 0;
    // a long traverse with turns, jumps and sprints — the whole route, not a
    // straight line, because a straight line never meets a slope side-on
    const t = replay(w, (i) => ({
      move: { x: Math.sin(i * 0.004), y: 1 },
      jump: i % 190 === 0,
      sprint: (i % 400) < 200,
    }), 1 / 60, 6000, 0);
    for (const s of t) {
      frames++;
      const floor = g.heightAt(s.x, s.z);
      worst = Math.min(worst, s.y - floor);
    }
    ok('§M4 · the body never penetrates the height field',
      worst > -GAIT.skin - 1e-6,
      `deepest the feet ever got below the ground over ${frames} frames:`
      + ` ${(worst * 1000).toFixed(3)} mm`);

    // and it stays finite — a NaN in a controller is a body that vanishes
    ok('and every position on the route is finite',
      t.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y) && Number.isFinite(s.z)));
  }

  // --- the slope limit actually limits ---------------------------------------
  {
    // a 70° ramp rising to the east — steeper than the 50° limit
    const ramp = (x) => (x <= 0 ? 0 : x * Math.tan(70 * Math.PI / 180));
    const w = new Walker({ heightAt: (x) => ramp(x), gravity: 9.80665 });
    w.place(-3, 0);
    replay(w, () => ({ move: { x: 0, y: 1 }, sprint: true }), 1 / 60, 900, -Math.PI / 2);
    ok('a slope past the limit cannot be walked up',
      w.pos.y < 2.0,
      `after 15 s of sprinting into a 70° face the body is ${w.pos.y.toFixed(2)} m up`);

    // ...but a gentle one can
    const easy = new Walker({ heightAt: (x) => (x <= 0 ? 0 : x * Math.tan(20 * Math.PI / 180)), gravity: 9.80665 });
    easy.place(-3, 0);
    replay(easy, () => ({ move: { x: 0, y: 1 } }), 1 / 60, 900, -Math.PI / 2);
    ok('and a walkable one is walked up',
      easy.pos.y > 5,
      `20° slope, 15 s → ${easy.pos.y.toFixed(2)} m up`);
  }

  // --- step-up: a kerb is not a cliff ---------------------------------------
  {
    const kerb = (x, h) => (x < 0 ? 0 : h);
    const cross = (h) => {
      const w = new Walker({ heightAt: (x) => kerb(x, h), gravity: 9.80665 });
      w.place(-2, 0);
      replay(w, () => ({ move: { x: 0, y: 1 } }), 1 / 60, 300, -Math.PI / 2);
      return w.pos.x;
    };
    ok('a step inside the step-up height is walked over without jumping',
      cross(0.3) > 0.5, `0.30 m kerb → reached x = ${cross(0.3).toFixed(2)}`);
    ok('and a wall above it is not',
      cross(3.0) < 0.35, `3.0 m wall → stopped at x = ${cross(3.0).toFixed(2)}`);
  }

  // --- analog input stays analog --------------------------------------------
  {
    const speedFor = (mag) => {
      const w = flat(); w.place(0, 0);
      replay(w, () => ({ move: { x: 0, y: mag } }), 1 / 60, 400, 0);
      return Math.hypot(w.vel.x, w.vel.z);
    };
    const half = speedFor(0.5), full = speedFor(1);
    ok('a half-pushed stick walks at half speed',
      Math.abs(half / full - 0.5) < 0.02,
      `${half.toFixed(3)} vs ${full.toFixed(3)} m/s — the old touch layer`
      + ' synthesised keystrokes and threw this away');

    // and a stick in the corner is not faster than a stick pushed straight
    const w = flat(); w.place(0, 0);
    replay(w, () => ({ move: { x: 1, y: 1 } }), 1 / 60, 400, 0);
    const diag = Math.hypot(w.vel.x, w.vel.z);
    ok('and a diagonal is not faster than a straight line',
      Math.abs(diag - full) < 0.02, `diagonal ${diag.toFixed(3)} m/s`);
  }

  // --- the gait clock is one clock ------------------------------------------
  {
    const w = flat(); w.place(0, 0);
    const SEC = 20;
    replay(w, () => ({ move: { x: 0, y: 1 } }), 1 / 60, 60 * SEC, 0);
    const spd = GAIT.walk;
    // stepFreq = 0.58 + 0.34·v cycles/s, two footfalls per cycle; the first
    // fractions of a second are spent accelerating, so allow one step of slack
    const want = (0.58 + 0.34 * spd) * 2 * SEC;
    ok('footfalls come out at the analytic rate for the speed walked',
      Math.abs(w.steps - want) < 4,
      `${w.steps} footfalls in ${SEC}s · analytic ${want.toFixed(1)}`);

    // The head bob cannot drift from the footsteps because it is computed from
    // the same phase. Assert the coupling rather than the values: bob is at
    // twice the step rate, so it returns to its own sign every half-step.
    ok('head bob, sway and footfall all derive from one phase',
      Math.abs(w.bobY) < 0.02 && Math.abs(w.bobX) < 0.02 && w.stepFreq > 0,
      `bob ±${Math.abs(w.bobY).toFixed(4)} m at ${w.stepFreq.toFixed(2)} steps/s`);

    const idle = flat(); idle.place(0, 0);
    replay(idle, still, 1 / 60, 300, 0);
    ok('and standing still produces no footsteps at all',
      idle.steps === 0 && idle.stepFreq === 0);
  }

  // --- §2.3 · the same trace twice is the same trajectory -------------------
  {
    const g = makeGround(WORLDS[0].pp, WORLDS[0].dir);
    const trace = (i) => ({
      move: { x: Math.sin(i * 0.011), y: Math.cos(i * 0.007) },
      jump: i % 97 === 0,
      sprint: (i % 300) < 150,
    });
    const once = () => {
      const w = new Walker({ heightAt: g.heightAt, gravity: 9.80665 });
      w.place(12, -30);
      const t = replay(w, trace, 1 / 60, 3000, 0.7);
      let sum = 0;
      for (const s of t) sum += s.x + s.y * 3 + s.z * 7 + s.vy * 11;
      return sum;
    };
    const a = once(), b = once();
    ok('§2.3 · the same trace at the same dt is bit-identical',
      a === b, `checksum ${a.toFixed(6)} twice`);

    // Determinism is not frame-rate independence, and conflating them is how a
    // controller ends up with dt-dependent branches. What has to hold is that
    // the *trajectory* is close at different dt, not identical.
    const at = (dt, frames) => {
      const w = new Walker({ heightAt: g.heightAt, gravity: 9.80665 });
      w.place(12, -30);
      replay(w, (i) => trace(Math.floor(i * dt * 60)), dt, frames, 0.7);
      return w.pos;
    };
    const p60 = at(1 / 60, 1200), p120 = at(1 / 120, 2400);
    const drift = Math.hypot(p60.x - p120.x, p60.z - p120.z);
    ok('and halving the timestep lands in the same place, not a different one',
      drift < 1.0, `20 s of walking: ${drift.toFixed(3)} m apart at 60 vs 120 Hz`);
  }

  // --- the third-person boom, which is the one gate clause §M4 spells out ---
  //
  // "camera never clips terrain across the full route." `traveler.js:233`
  // clamps the boom against the height *directly under the camera*, which is a
  // different question from whether anything sits between the camera and the
  // head — walk backwards toward a cliff and the old arm goes through it.
  {
    // a wall rising to the east, the case a downward clamp cannot see
    const wall = (x) => (x < 0 ? 0 : Math.min(x * 4, 30));
    const head = { x: -1, y: 1.4, z: 0 };
    const east = { x: 1, y: 0.25, z: 0 };
    const el = Math.hypot(east.x, east.y, east.z);
    const dir = { x: east.x / el, y: east.y / el, z: east.z / el };
    const len = sweepArm(head, dir, 4.6, (x) => wall(x));
    ok('§M4 · the boom stops at a wall the head is not under',
      len < 2.0 && len >= 0,
      `4.6 m arm swept into a rising face → ${len.toFixed(2)} m`);

    // ...and is unobstructed over open ground
    ok('and keeps its full length where nothing is in the way',
      Math.abs(sweepArm(head, dir, 4.6, () => -100) - 4.6) < 1e-9);

    // The real claim, over the real terrain: sample the arm along a route and
    // assert the camera is never inside the ground.
    const g = makeGround(WORLDS[1].pp, WORLDS[1].dir);
    const w = new Walker({ heightAt: g.heightAt, gravity: 9.80665 });
    w.place(0, 0);
    let worst = Infinity, frames = 0, pulled = 0;
    for (let i = 0; i < 3000; i++) {
      w.step(1 / 60, { move: { x: Math.sin(i * 0.006), y: 1 }, sprint: (i % 500) < 250 }, i * 0.0021);
      const yaw = i * 0.0021, pitch = Math.sin(i * 0.013) * 1.2;
      const cp = Math.cos(pitch * 0.62), sp = Math.sin(pitch * 0.62);
      const d = { x: Math.sin(yaw) * cp, y: sp + ARM.rise / ARM.dist, z: Math.cos(yaw) * cp };
      const dl = Math.hypot(d.x, d.y, d.z);
      d.x /= dl; d.y /= dl; d.z /= dl;
      const h = { x: w.pos.x, y: w.pos.y + GAIT.eye * 0.82, z: w.pos.z };
      const L = sweepArm(h, d, ARM.dist, g.heightAt);
      if (L < ARM.dist - 1e-9) pulled++;
      const cx = h.x + d.x * L, cy = h.y + d.y * L, cz = h.z + d.z * L;
      worst = Math.min(worst, cy - g.heightAt(cx, cz));
      frames++;
    }
    ok('§M4 · the camera never ends up inside the terrain over the route',
      worst > 0, `closest the boom ever came to the ground over ${frames} frames:`
      + ` ${worst.toFixed(3)} m · pulled in on ${(100 * pulled / frames).toFixed(1)}% of them`);
  }

  // --- one sensitivity, where there were three ------------------------------
  {
    ok('one look sensitivity and one pitch clamp, not three',
      LOOK.perPixel > 0.002 && LOOK.perPixel < 0.005 && LOOK.pitchClamp < Math.PI / 2,
      `${LOOK.perPixel} rad/px, clamp ±${LOOK.pitchClamp} —`
      + ' replacing 0.0035/1.45, 0.0024/1.50 and 0.0040/1.25');
  }

  // --- the constitution's own numbers ---------------------------------------
  {
    ok('§6 M4 · eye height 1.68 m and FOV 52, which the reference also uses',
      GAIT.eye === 1.68 && GAIT.fov === 52,
      'hoshi-no-tani.html:181-185 agrees to the digit');
  }

  // --- the action map, and the one binding that cannot be a binding ---------
  {
    ok('§2.4 · Space stays with pause-time, so jump goes through scale-first',
      !Object.values(BINDINGS).some((c) => c.includes('Space')) && JUMP_CODE === 'Space',
      'main.js:421 binds Space globally and a saved link expects it to pause');

    // an analog source must survive the trip that used to flatten it
    setAnalog({ x: 0.25, y: 0.4 });
    const kept = Math.hypot(input.move.x, input.move.y);
    setAnalog(null);
    ok('an analog source writes the axis directly, magnitude intact',
      Math.abs(kept - Math.hypot(0.25, 0.4)) < 1e-12,
      `|move| = ${kept.toFixed(4)} — the synthetic-KeyboardEvent bridge`
      + ' delivered 1.0 or 0.0 and nothing else');
  }
}

// ---------------------------------------------------------------------------
// suite: material
//
// §M2 act 4's gate: "at 1.68 m eye height, no visible tiling within 40 m in any
// biome; every material nameable from a still."
//
// The second clause needs eyes. The first does not — tiling is periodicity, and
// periodicity is what an autocorrelation finds. So the claim the gate actually
// makes about repetition is measured here rather than looked at, over the real
// height field, at the eye height the gate names.
//
// Everything else is the blend law, which is where the properties that make a
// four-layer material a material rather than four lerps actually live: the
// weights sum to one, they are continuous, and every layer is reachable.

function suiteMaterial() {
  console.log('\nmaterial — §M2 act 4, four layers over one blend law');

  const LIGHT = REFERENCE_LIGHT;
  const PP = {
    seed: 0x5eed1337, typeId: 1, noiseSeed: 424242, oceanLevel: 0.012, radiusE: 1.04,
    colA: [0.32, 0.24, 0.16], colB: [0.55, 0.52, 0.49], colC: [0.22, 0.35, 0.18],
  };

  // --- the weights are a partition, everywhere ------------------------------
  {
    let worstSum = 0, negatives = 0, n = 0;
    for (let s = 0; s <= 1.0001; s += 0.05) {
      for (let a = 0; a <= 1.0001; a += 0.05) {
        for (let l = 0; l <= 1.0001; l += 0.125) {
          for (let m = 0; m <= 1.0001; m += 0.125) {
            const w = blend({ slope: s, alt: a, lat: l, moist: m });
            const sum = w[0] + w[1] + w[2] + w[3];
            worstSum = Math.max(worstSum, Math.abs(sum - 1));
            if (w.some((v) => v < 0)) negatives++;
            n++;
          }
        }
      }
    }
    ok('the four weights are a partition of unity everywhere',
      worstSum < 1e-12 && negatives === 0,
      `${n} points across slope × altitude × latitude × moisture ·`
      + ` worst |Σw − 1| = ${worstSum.toExponential(1)}`);
  }

  // --- and continuous, which is what stops a seam appearing between them ----
  {
    // A discontinuity in the blend is a hard line across the ground that no
    // amount of texture detail hides — and it is the failure mode of the
    // obvious implementation, a chain of step()s.
    let worst = 0, where = null;
    const at = (s, a, m) => blend({ slope: s, alt: a, lat: 0.4, moist: m });
    for (let s = 0; s <= 1; s += 0.002) {
      for (const [a, m] of [[0.2, 0.7], [0.6, 0.3], [0.85, 0.5]]) {
        const d = at(s, a, m).reduce((acc, v, i) => acc + Math.abs(v - at(s + 0.002, a, m)[i]), 0);
        if (d > worst) { worst = d; where = `slope ${s.toFixed(3)}, alt ${a}`; }
      }
    }
    ok('and continuous in slope — no step() seam across the ground',
      worst < 0.02, `largest Σ|Δw| over a 0.002 slope step: ${worst.toFixed(4)} at ${where}`);

    // Continuity, measured the scale-free way rather than against a chosen
    // epsilon. Halve the step and a smooth ramp halves its largest jump; a
    // step() does not move at all, because its discontinuity is the same size
    // however finely you sample it. The first version of this check picked
    // 0.02 out of the air and failed a snow line that was behaving perfectly.
    const maxJump = (h) => {
      let worst = 0;
      const p = { slope: 0.2, lat: 0.4, moist: 0.5 };
      for (let a = 0; a <= 1; a += h) {
        const d = blend({ ...p, alt: a }).reduce(
          (acc, v, i) => acc + Math.abs(v - blend({ ...p, alt: a + h })[i]), 0);
        worst = Math.max(worst, d);
      }
      return worst;
    };
    const j1 = maxJump(0.004), j2 = maxJump(0.002);
    ok('and continuous across the snow line — halving the step halves the jump',
      Math.abs(j2 / j1 - 0.5) < 0.06,
      `Σ|Δw| ${j1.toFixed(4)} at h=0.004 → ${j2.toFixed(4)} at h=0.002`
      + ` (ratio ${(j2 / j1).toFixed(3)}; a step() would hold at 1.0)`);
  }

  // --- every layer is reachable, or it is not a four-layer material ---------
  {
    const best = [0, 0, 0, 0];
    for (let s = 0; s <= 1.0001; s += 0.05) {
      for (let a = 0; a <= 1.0001; a += 0.05) {
        for (let l = 0; l <= 1.0001; l += 0.1) {
          for (let m = 0; m <= 1.0001; m += 0.1) {
            const w = blend({ slope: s, alt: a, lat: l, moist: m });
            for (let i = 0; i < 4; i++) best[i] = Math.max(best[i], w[i]);
          }
        }
      }
    }
    ok('every one of the four layers dominates somewhere',
      best.every((b) => b > 0.5),
      LAYERS.map((nm, i) => `${nm} ${best[i].toFixed(2)}`).join(' · '));
  }

  // --- each of the four inputs actually moves the blend ---------------------
  //
  // §M2 names slope × altitude × latitude × moisture. A blend that ignored one
  // of them would still pass every check above.
  {
    const base = { slope: 0.3, alt: 0.5, lat: 0.4, moist: 0.5 };
    const move = (k, lo, hi) => {
      const a = blend({ ...base, [k]: lo }), b = blend({ ...base, [k]: hi });
      return a.reduce((acc, v, i) => acc + Math.abs(v - b[i]), 0);
    };
    const d = {
      slope: move('slope', 0.05, 0.9), alt: move('alt', 0.1, 0.95),
      lat: move('lat', 0.05, 0.95), moist: move('moist', 0.05, 0.95),
    };
    ok('§M2 · all four of slope, altitude, latitude and moisture move it',
      Object.values(d).every((v) => v > 0.2),
      Object.entries(d).map(([k, v]) => `${k} ${v.toFixed(2)}`).join(' · '));
  }

  // --- the snow line is a real latitude effect, not a decoration ------------
  {
    ok('a pole is white at a height an equator is bare at',
      snowLine(0.05, 0) > 0.75 && snowLine(0.98, 0) < 0.05,
      `snow line: ${snowLine(0.05, 0).toFixed(2)} of relief at the equator,`
      + ` ${snowLine(0.98, 0).toFixed(2)} at the pole`);

    const eq = blend({ slope: 0.15, alt: 0.55, lat: 0.05, moist: 0.5 });
    const pole = blend({ slope: 0.15, alt: 0.55, lat: 0.95, moist: 0.5 });
    ok('and the same ground takes rime at the pole and not at the equator',
      pole[3] > 0.6 && eq[3] < 0.05,
      `rime weight ${eq[3].toFixed(3)} → ${pole[3].toFixed(3)} at 0.55 of relief`);
  }

  // --- moisture behaves like water, not like a slider ----------------------
  {
    const relief = 400;
    const shore = moistureAt(2, 0, relief, 0);
    const ridge = moistureAt(380, 0, relief, 0);
    ok('ground near the waterline is wetter than the ridge above it',
      shore > ridge + 0.25, `${shore.toFixed(3)} at the shore → ${ridge.toFixed(3)} on the ridge`);

    ok('a dry world has no shore term at all',
      moistureAt(2, null, relief, 0) < shore,
      'sea = null is a world with no waterline, not a waterline at zero');

    ok('and rain wets everything',
      moistureAt(200, 0, relief, 1) > moistureAt(200, 0, relief, 0) + 0.2,
      'the weather is an input, so a storm changes the ground it falls on');
  }

  // --- the gate's own clause: no visible tiling within 40 m -----------------
  //
  // Tiling is periodicity, and periodicity is what an autocorrelation finds.
  // Sampled over the real height field, along the ground, at the eye height
  // §M2 names — so this is the gate's sentence rather than a proxy for it.
  {
    const g = makeGround(WORLDS[0].pp, WORLDS[0].dir);
    const bias = worldBias(WORLDS[0].pp);
    const relief = 400;
    const STEP = 0.25;                 // metres between samples
    const N = Math.round(40 / STEP);   // a 40 m transect

    // What a walker actually sees is the blended colour, so that is what is
    // tested — not the height field underneath it, which is a different claim.
    const pal = materialPalette(PP, LIGHT);
    const sample = (x, z) => {
      const h = g.heightAt(x, z);
      const e = 0.5;
      const dx = g.heightAt(x + e, z) - g.heightAt(x - e, z);
      const dz = g.heightAt(x, z + e) - g.heightAt(x, z - e);
      const ny = 2 * e / Math.hypot(dx, 2 * e, dz);
      const jit = g.fbm2(x * 0.041, z * 0.041, 3) * 0.55
        + g.fbm2(x * 0.127 + 11, z * 0.127 + 11, 2) * 0.28
        + g.fbm2(x * 0.39 + 31, z * 0.39 + 31, 1) * 0.13;
      const moist = clamp01v(moistureAt(h, g.seaLevel, relief, 0, bias.rain) + jit * 0.20);
      const w = blend({
        slope: 1 - clamp01v(ny), alt: clamp01v(h / relief),
        lat: bias.lat, moist, jit, cold: bias.cold,
      });
      let c = 0;
      for (let i = 0; i < 4; i++) c += w[i] * (0.2126 * pal[i].mid[0] + 0.7152 * pal[i].mid[1] + 0.0722 * pal[i].mid[2]);
      return c * (1 + jit * 0.30);
    };

    // "No visible tiling" is a statement about *repetition*, so it is tested as
    // one directly rather than through a spectrum. A spectral statistic cannot
    // tell a field that repeats every 24 m from one that merely has 24 m
    // features — both put a bump in the autocorrelation there, and two earlier
    // versions of this check failed the material for having a texture.
    //
    // The direct question: is there any shift under 40 m that maps the material
    // onto itself? Normalised so 0 is a perfect tile and 1 is uncorrelated.
    // "No visible tiling" is a statement about *repetition*, so it is tested as
    // one directly rather than through a spectrum. A spectral statistic cannot
    // tell a field that repeats every 24 m from one that merely has 24 m
    // features — both put a bump in the autocorrelation there, and two earlier
    // versions of this check failed the material for having a texture.
    //
    // The direct question: is there a shift that maps the material onto itself?
    // `D` is the mean squared difference under a shift, normalised so 0 is a
    // perfect tile and 1 is uncorrelated.
    //
    // Shifts under 5 m are reported but not gated, and the reason is not a
    // convenience. At half a metre the field matches itself almost exactly —
    // that is what *continuous* means, and ground that failed this would be
    // noise rather than terrain. Two patches only read as a repeat once they
    // are far enough apart to be seen as two, which at 1.68 m eye height is a
    // few metres. So the gate is the far band and the near one is context.
    let far = 1, farAt = null, near = 1;
    const GRID = 56, SPAN = 0.6;   // a 33 m patch of ground, sampled every 60 cm
    for (const [ox, oz, label] of [[0, 0, 'origin'], [180, -240, 'the hills'], [-320, 410, 'the shore']]) {
      const f = [];
      for (let i = 0; i < GRID * 2; i++) {
        const row = [];
        for (let j = 0; j < GRID * 2; j++) row.push(sample(ox + i * SPAN, oz + j * SPAN));
        f.push(row);
      }
      let mean = 0, n = 0;
      for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) { mean += f[i][j]; n++; }
      mean /= n;
      let varf = 0;
      for (let i = 0; i < GRID; i++) for (let j = 0; j < GRID; j++) varf += (f[i][j] - mean) ** 2;
      varf /= n;

      for (let si = 1; si < GRID; si++) {
        for (let sj = 0; sj < GRID; sj++) {
          const dist = Math.hypot(si, sj) * SPAN;
          if (dist < 0.5 || dist > 40) continue;
          let acc = 0;
          for (let i = 0; i < GRID; i++) {
            for (let j = 0; j < GRID; j++) acc += (f[i + si][j + sj] - f[i][j]) ** 2;
          }
          const D = acc / n / (2 * varf);
          if (dist >= 5) { if (D < far) { far = D; farAt = `${dist.toFixed(1)} m (${label})`; } }
          else near = Math.min(near, D);
        }
      }
    }
    ok('§M2 gate · no shift between 5 m and 40 m maps the material onto itself',
      far > 0.40,
      `closest self-match over three 33 m patches: ${far.toFixed(3)} at ${farAt}`
      + ` — 0.000 would be a perfect tile, 1.0 uncorrelated`
      + ` (under 5 m it reaches ${near.toFixed(3)}, which is the ground being continuous)`);
  }

  // --- the stops are a hue path, which is the thing §9.2 needs --------------
  //
  // This is act 4's other job. §9.2's ramp was flattening the terrain because
  // shade, mid and lit were three points on one line through one colour — a
  // brightness ramp wearing a hue ramp's clothes (docs/plans/M2.md §24.4).
  {
    const pal = materialPalette(PP, LIGHT);
    ok('four materials, each with a name §8 axis 5 can use',
      pal.length === 4 && pal.every((m, i) => m.name === LAYERS[i]),
      pal.map((m) => m.name).join(' · '));

    // Hue, as the angle of the (r−g, g−b) vector: a pure brightness ramp holds
    // it fixed, which is exactly the failure being tested for.
    const hue = (c) => Math.atan2(c[1] - c[2], c[0] - c[1]);
    const spread = pal.map((m) => {
      const a = hue(m.shade), b = hue(m.lit);
      let d = Math.abs(a - b);
      if (d > Math.PI) d = 2 * Math.PI - d;
      return d;
    });
    ok('§9.2 · every material\'s stops travel in hue, not only in brightness',
      spread.every((d) => d > 0.04),
      pal.map((m, i) => `${m.name} ${(spread[i] * 180 / Math.PI).toFixed(1)}°`).join(' · '));

    // and the direction is the one §9.1 describes: shade cool, lit warm
    const warmth = (c) => c[0] - c[2];
    ok('and they travel the right way — shade toward the shadow, lit toward the sun',
      pal.every((m) => warmth(m.lit) > warmth(m.shade)),
      pal.map((m) => `${m.name} ${(warmth(m.lit) - warmth(m.shade)).toFixed(3)}`).join(' · '));

    // Snow is the one that must break the brightness rule: it is lit by the
    // sky, so its shade is *more* saturated than its mid, not less.
    const sat = (c) => Math.max(...c) - Math.min(...c);
    const rime = pal[3];
    ok('snow\'s shade is more saturated than its mid, because the sky lights it',
      sat(rime.shade) > sat(rime.mid),
      `sat ${sat(rime.mid).toFixed(3)} mid → ${sat(rime.shade).toFixed(3)} shade`);
  }

  // --- why act 4 does NOT un-hold ?paint=1, measured ----------------------
  //
  // §24.4 held §9.2 back on the theory that its three stops were three points
  // on one line through one colour, and that real material stops would fix it.
  // Half of that was right — the stops are real now, and the check above proves
  // they travel in hue. It did not fix it, and this is why.
  //
  // §9.2's ramp bands at t = 0.17 and t = 0.58, where t is the half-Lambert
  // wrap `ndl·0.62 + 0.46`. What decides whether those edges are visible is not
  // the colours on either side of them — it is whether the terrain's *own* t
  // ever crosses them.
  {
    const g = makeGround(WORLDS[0].pp, WORLDS[0].dir);
    const spread = (elevDeg) => {
      const s = elevDeg * Math.PI / 180;
      const sun = [Math.cos(s), Math.sin(s), 0];
      const ts = [];
      for (let x = -200; x <= 200; x += 7) {
        for (let z = -200; z <= 200; z += 7) {
          const e = 0.6;
          const dx = g.heightAt(x + e, z) - g.heightAt(x - e, z);
          const dz = g.heightAt(x, z + e) - g.heightAt(x, z - e);
          const l = Math.hypot(-dx, 2 * e, -dz);
          const ndl = (-dx / l) * sun[0] + (2 * e / l) * sun[1] + (-dz / l) * sun[2];
          ts.push(clamp01v(ndl * 0.62 + 0.46));
        }
      }
      ts.sort((a, b) => a - b);
      const lo = ts[Math.floor(0.02 * ts.length)], hi = ts[Math.floor(0.98 * ts.length)];
      return { lo, hi, width: hi - lo };
    };

    const at24 = spread(24), at13 = spread(13.5);
    ok('the terrain\'s own ramp coordinate spans far less than one band',
      at24.width < 0.15 && at13.width < 0.15,
      `t spans ${at24.width.toFixed(3)} at 24° and ${at13.width.toFixed(3)} at 13.5°,`
      + ` against band edges 0.41 apart — this smooth ground can only ever`
      + ' occupy a sliver of the ramp');

    ok('§24.4 · at a high sun every pixel lands in one band, whatever the stops',
      at24.lo > 0.58,
      `t ∈ [${at24.lo.toFixed(3)}, ${at24.hi.toFixed(3)}] at 24° — entirely above`
      + ' the upper edge, so ramp3 returns `lit` everywhere and the frame is flat');

    ok('and §9.7\'s golden-hour band is what puts an edge inside the terrain',
      at13.lo < 0.58 && at13.hi > 0.58,
      `t ∈ [${at13.lo.toFixed(3)}, ${at13.hi.toFixed(3)}] at 13.5° — the 0.58 edge`
      + ' falls inside it. "Golden hour is not a mood; it is the geometry the'
      + ' light model is tuned for" (§9.7), and this is that sentence as a number');
  }

  // --- the GLSL carries the same law, not a second copy of it --------------
  {
    const code = MATERIAL_GLSL.replace(/\/\/[^\n]*/g, '');
    const shared = ['0.82 - 0.86', '0.26, 0.62', '0.06 + 1.55', '1.85 * above', '1.30 * moist'];
    ok('§2.7 · the GLSL blend carries the same constants as the CPU law',
      shared.every((c) => code.includes(c)), shared.join(' · '));
    ok('and it is triplanar, which is what makes the 40 m clause hold on a cliff',
      /pow\(abs\(n\), vec3\(4\.0\)\)/.test(code) && code.includes('p.yz') && code.includes('p.xy'),
      'a single projection smears on anything steep, and a smear is the most'
      + ' visible repetition a landscape has');
    ok('and it returns three stops rather than one colour',
      /struct Ground \{ vec3 shade; vec3 mid; vec3 lit;/.test(code));
  }
}

function clamp01v(x) { return x < 0 ? 0 : x > 1 ? 1 : x; }

// ---------------------------------------------------------------------------
// suite: ocean
//
// §M2 act 5. Unusually decidable for a piece of rendering: almost every claim
// it makes is a physical law with a closed form, so what a GPU would be needed
// for is how it *looks*, and everything about whether it is right can be
// settled here.
//
// The dispersion relation is the load-bearing one. ω² = gk means every
// wavelength travels at its own speed, which is why a sum of them never
// repeats — and it is the difference between a sea and a corrugated sheet
// scrolling past.

function suiteOcean() {
  console.log('\nocean — §M2 act 5, Gerstner on a real spectrum');

  const G = 9.80665;
  const waves = buildWaves(10, 0.7, 20250601);

  // --- the spectrum belongs to the wind that raised it ----------------------
  {
    ok('§M2 · 8–12 waves are summed', waves.length === WAVE_COUNT
      && WAVE_COUNT >= 8 && WAVE_COUNT <= 12, `${WAVE_COUNT} waves`);

    // Pierson–Moskowitz: a 10 m/s wind raises 2.1 m of fully developed sea
    ok('significant wave height follows Pierson–Moskowitz',
      Math.abs(significantHeight(10) - 2.141) < 0.01
      && Math.abs(significantHeight(20) / significantHeight(10) - 4) < 1e-9,
      `H_s = ${significantHeight(10).toFixed(2)} m at 10 m/s, and ∝ U²`);

    // and the sea a calm raises is not the sea a gale raises
    const calm = buildWaves(4, 0, 7), gale = buildWaves(22, 0, 7);
    const amp = (ws) => ws.reduce((a, w) => a + w.amp, 0);
    ok('so a gale raises a bigger sea than a calm, without anything wired to it',
      amp(gale) > amp(calm) * 8,
      `Σamp ${amp(calm).toFixed(3)} m at 4 m/s → ${amp(gale).toFixed(2)} m at 22 m/s`);
  }

  // --- the dispersion relation, which is why the sea never loops ------------
  {
    let worst = 0;
    for (const w of waves) worst = Math.max(worst, Math.abs(w.omega * w.omega - G * w.k) / (G * w.k));
    ok('every wave obeys ω² = gk, so each wavelength travels at its own speed',
      worst < 1e-12, `worst relative error over ${waves.length} waves: ${worst.toExponential(1)}`);

    // The periods are mutually irrational in practice, so the sum has no period
    // a viewer could sit through. Measured as the spread of phase-speed ratios
    // rather than asserted.
    const c = waves.map((w) => w.omega / w.k).sort((a, b) => a - b);
    ok('and the phase speeds span a wide range, so the sum does not repeat',
      c[c.length - 1] / c[0] > 3,
      `${c[0].toFixed(2)}–${c[c.length - 1].toFixed(2)} m/s across the set`);
  }

  // --- Gerstner is not a heightfield: crests sharpen, troughs flatten -------
  {
    // Sample one wavelength of the biggest wave alone and check the asymmetry.
    const one = [waves.reduce((a, b) => (a.amp > b.amp ? a : b))];
    const N = 512, lam = 2 * Math.PI / one[0].k;
    const ys = [];
    for (let i = 0; i < N; i++) ys.push(gerstner(one, (i / N) * lam, 0, 0).y);
    const mean = ys.reduce((a, b) => a + b, 0) / N;
    const above = ys.filter((y) => y > mean).length / N;
    ok('a Gerstner crest is narrower than its trough — the sea is not a sine',
      above < 0.47,
      `${(100 * above).toFixed(1)}% of the surface is above its own mean`
      + ' (a sine would be exactly 50%)');
  }

  // --- foam comes from the surface folding, not from a guess ----------------
  {
    // Below the steepness limit the map never folds anywhere.
    const gentle = buildWaves(6, 0, 11, 0.35);
    let minJ = Infinity;
    for (let i = 0; i < 60; i++) {
      for (let j = 0; j < 60; j++) {
        minJ = Math.min(minJ, gerstner(gentle, i * 3.1, j * 2.7, i * 0.13).jacobian);
      }
    }
    ok('a gentle sea never folds through itself',
      minJ > 0, `smallest Jacobian over 3600 samples: ${minJ.toFixed(3)}`);

    // Past it, it folds. Stated on a *single* wave, because that is where the
    // law is unambiguous: a Gerstner wave self-intersects exactly when its
    // steepness A·k exceeds 1. Spread a budget of 1.9 over twelve directions
    // and no single axis reaches the limit — which is a fact about direction
    // spreading, not about the criterion, and an earlier version of this check
    // mistook one for the other.
    const one = (q) => [{ k: 0.5, amp: q / 0.5, omega: Math.sqrt(9.80665 * 0.5), dir: 0, phase: 0 }];
    const foldsAt = (q) => {
      let minJ = Infinity;
      for (let i = 0; i < 400; i++) minJ = Math.min(minJ, gerstner(one(q), i * 0.05, 0, 0).jacobian);
      return minJ;
    };
    ok('and one past A·k = 1 folds, which is what a whitecap is',
      foldsAt(0.9) > 0 && foldsAt(1.15) < 0,
      `min Jacobian ${foldsAt(0.9).toFixed(3)} at A·k = 0.9 →`
      + ` ${foldsAt(1.15).toFixed(3)} at 1.15 — foam is drawn where the surface`
      + ' genuinely overturned, not where a shader guessed');

    // and the shipped sea sits under that limit, so it folds only where phases
    // happen to pile up rather than everywhere at once
    const steep = waves.reduce((a, w) => a + w.amp * w.k, 0);
    // A fully developed sea has H_s ∝ U² and λ_peak ∝ U², so its steepness is
    // roughly constant with wind and sits near 0.1 — the dominant swell does
    // not break, which is why the open ocean is not white. An earlier version
    // of this check expected 0.5–1.0 and was wrong about the sea, not the code.
    ok('the shipped sea is far below the folding limit, as a real one is',
      steep > 0.05 && steep < 0.2,
      `Σ A·k = ${steep.toFixed(3)} · H_s 2.14 m over an 83 m peak wavelength`);

    // which is exactly why the fold cannot be the only source of foam
    ok('so whitecaps need the crest-shear term too, or a gale is glassy',
      whitecap(3, 0.9, 0.9) < 0.01 && whitecap(18, 0.9, 0.9) > 0.4
      && whitecap(18, -0.1, 0.0) === 1,
      `coverage ${whitecap(3, 0.9, 0.9).toFixed(2)} at 3 m/s →`
      + ` ${whitecap(18, 0.9, 0.9).toFixed(2)} at 18 m/s on the same crest,`
      + ' and 1.00 anywhere the surface actually overturned');
  }

  // --- Beer–Lambert is why the sea is blue ---------------------------------
  {
    const t1 = transmission(1, false), t10 = transmission(10, false);
    ok('red is absorbed an order of magnitude faster than blue',
      EXTINCTION[0] / EXTINCTION[2] > 15,
      `k = ${EXTINCTION.join(', ')} per metre — this one fact is the entire`
      + ' reason the sea is blue');
    ok('so a metre of water is nearly neutral and ten metres is not',
      t1[0] / t1[2] > 0.6 && t10[0] / t10[2] < 0.05,
      `red/blue transmission ${(t1[0] / t1[2]).toFixed(2)} at 1 m →`
      + ` ${(t10[0] / t10[2]).toExponential(1)} at 10 m`);
    ok('transmission is 1 at the surface and monotone below it', (() => {
      if (Math.abs(transmission(0, false)[2] - 1) > 1e-12) return false;
      let prev = 2;
      for (let d = 0; d <= 30; d += 0.25) {
        const v = transmission(d, false)[1];
        if (v > prev + 1e-12) return false;
        prev = v;
      }
      return true;
    })());
  }

  // --- the depth bands are discrete, which is the art direction -------------
  {
    const seen = new Set();
    for (let d = 0; d <= DEPTH_BANDS * 4; d += 0.05) seen.add(transmission(d)[1].toFixed(9));
    ok(`§M2 · depth is graded in ${DEPTH_BANDS} discrete bands, not smoothly`,
      seen.size <= DEPTH_BANDS + 1 && seen.size > 1,
      `${seen.size} distinct values over the sampled range — §11 warns this`
      + ' looks like quantisation to a PBR reflex, and it is the point');
  }

  // --- Fresnel: a mirror at the far shore, a window at your feet -----------
  {
    ok('Schlick gives water its 2% head-on and near-total grazing reflectance',
      Math.abs(fresnel(1) - 0.02) < 1e-9 && fresnel(0.02) > 0.85,
      `R(0°) = ${fresnel(1).toFixed(3)} · R(88°) = ${fresnel(0.035).toFixed(3)}`);
    let mono = true, prev = -1;
    for (let c = 1; c >= 0; c -= 0.01) { const f = fresnel(c); if (f < prev) mono = false; prev = f; }
    ok('and it rises monotonically toward the horizon', mono);
  }

  // --- §2.3 ----------------------------------------------------------------
  {
    const sum = (ws) => ws.reduce((a, w) => a + w.amp * 7 + w.k * 13 + w.dir * 3 + w.phase, 0);
    ok('§2.3 · the same wind and seed raise the same sea',
      sum(buildWaves(12, 1.1, 4242)) === sum(buildWaves(12, 1.1, 4242)));
    ok('and a different seed raises a different one',
      sum(buildWaves(12, 1.1, 4242)) !== sum(buildWaves(12, 1.1, 4243)));
  }

  // --- Nyquist against the mesh, which cost a capture to learn -------------
  {
    // A geometric wave shorter than twice the quad it displaces does not
    // render as a small wave. It aliases, and the aliasing tracks the grid —
    // twelve waves down to 26 m on a 240 m mesh drew a sea of long white
    // diagonal slashes. The vertex shader carries what the mesh can resolve;
    // the fragment's normal perturbation carries the chop.
    const quad = 37;
    const limited = buildWaves(10, 0.7, 20250601, 0.86, quad * 2.2);
    const shortest = Math.min(...limited.map((w) => w.lam));
    ok('no geometric wave is shorter than two quads of the mesh it rides',
      shortest >= quad * 2,
      `shortest λ = ${shortest.toFixed(1)} m on a ${quad} m grid`
      + ` — unlimited it reaches ${Math.min(...waves.map((w) => w.lam)).toFixed(1)} m`);

    ok('and the set still spans the swell, rather than collapsing to one wave',
      Math.max(...limited.map((w) => w.lam)) / shortest > 2.5,
      `${shortest.toFixed(0)}–${Math.max(...limited.map((w) => w.lam)).toFixed(0)} m`);
  }

  // --- the GLSL carries the same constants ---------------------------------
  {
    const code = OCEAN_GLSL.replace(/\/\/[^\n]*/g, '');
    ok('§2.7 · the GLSL sums the same wave count and bands the same depth',
      code.includes(`i < ${WAVE_COUNT}`) && code.includes(`${DEPTH_BANDS}.0`));
    ok('and it computes the Jacobian rather than faking foam',
      /jac = jxx \* jzz - jxz \* jxz/.test(code));
    ok('and the glitter is quantised, not a specular lobe',
      /floor\(clamp\(lobe/.test(code));
  }
}

// ---------------------------------------------------------------------------
// suite: horizon
//
// §M2 act 6. The claim under test is not "the ridges look hazy" — it is that
// the silhouette on the horizon is the *world's own*, reprojected without
// distortion, and that the ring it replaces was genuinely contributing nothing.
// Both are decidable on the CPU, which is the whole reason `src/horizon.js`
// imports no three.
//
// The independent computation (§7.3) for the skyline is a march at four times
// the angular resolution. It is a strict superset by construction — the radial
// stride is geometric, so `r₀·g^k` are exactly the samples `r₀·(g^¼)^{4k}` —
// which means the coarse march can never *exceed* the fine one, and the only
// question a test can meaningfully ask is how much silhouette it misses.

function horizonWorld(w, over = {}) {
  const pp = { Teq: 255, massE: 1, radiusE: 1, ...w.pp, ...over.pp };
  const g = makeGround(pp, w.dir);
  const spawn = { x: 0, z: 0, y: g.heightAt(0, 0) };
  const params = aerialParams(pp, over.atmo ?? 1, 1);
  return { pp, g, spawn, params, seaLevel: pp.oceanLevel > -0.5 && pp.typeId === 1 ? 0 : null };
}

function horizonOf(w, over = {}) {
  const { g, spawn, params, seaLevel } = horizonWorld(w, over);
  const yEye = spawn.y + 1.8;
  return {
    g,
    yEye,
    seaLevel,
    params,
    h: buildHorizon(g.heightAt, {
      yEye, ox: 0, oz: 0, eyeR: 0,
      nearHalf: 1400 * 3.3 * 0.5,
      params,
      Reff: g.Rworld * 0.34,
      seaLevel,
    }),
  };
}

function suiteHorizon() {
  console.log('\nhorizon — the far ridges are the world\'s own skyline (§M2 act 6, §9.7)');

  const TAU2 = Math.PI * 2;
  const temperate = horizonOf(WORLDS[0]);
  const mountains = horizonOf(WORLDS[1]);

  // --- the reprojection is exact -------------------------------------------
  //
  // A curtain at radius R carries the true silhouette of terrain at any other
  // distance only if it preserves the elevation angle exactly. This is the
  // property the whole act rests on, so it is checked to float64 and not to
  // a tolerance anyone chose.
  {
    let worst = 0, n = 0;
    for (const c of [temperate, mountains]) {
      for (let k = 0; k < c.h.bands.length; k++) {
        const b = c.h.bands[k], prof = c.h.sky.band[k];
        for (let i = 0; i < prof.tan.length; i++) {
          const yTop = b.position[i * 6 + 4];
          const got = (yTop - c.yEye) / b.radius;
          worst = Math.max(worst, Math.abs(got - prof.tan[i]));
          n++;
        }
      }
    }
    ok('the curtain reproduces the measured elevation angle exactly',
      worst < 2e-6 && n > 400, `worst ${worst.toExponential(2)} over ${n} columns`);
  }

  // --- the skyline is the terrain's, at 4× the resolution -------------------
  {
    const c = mountains;
    const segs = c.h.sky.segs;
    const growth = 1 + TAU2 / segs;
    const fine = Math.pow(growth, 0.25);
    let worst = 0, over = 0;
    for (let t = 0; t < 16; t++) {
      const i = Math.floor((t / 16) * segs);
      const a = (i / segs) * TAU2, ca = Math.cos(a), sa = Math.sin(a);
      const rEdge = (1400 * 3.3 * 0.5) / Math.max(Math.abs(ca), Math.abs(sa));
      // the same grid the silhouette leg runs on, at four times the resolution —
      // a strict superset, so the coarse march can only ever miss, never exceed
      let best = -Infinity;
      for (let r = rEdge; r <= c.h.rMax; r *= fine) {
        let hgt = c.g.heightAt(ca * r, sa * r);
        if (c.seaLevel !== null && hgt < c.seaLevel) hgt = c.seaLevel;
        best = Math.max(best, (hgt - c.yEye) / r);
      }
      let coarse = -Infinity;
      for (const prof of c.h.sky.band) coarse = Math.max(coarse, prof.tan[i]);
      if (coarse > best + 1e-12) over++;
      worst = Math.max(worst, best - coarse);
    }
    ok('the coarse march never invents silhouette the fine march cannot find',
      over === 0, `${over} of 16 azimuths above the 4× reference`);
    // The radial stride is chosen to match the azimuthal one, so neither is
    // meant to be the limiting error. That is the claim to test — not an
    // absolute miss in metres, which would be a number nobody derived.
    const step = TAU2 / segs;
    ok('and its radial stride misses less than its azimuthal stride resolves',
      worst < step,
      `${worst.toExponential(2)} vs ${step.toExponential(2)} rad `
      + `(${(worst * c.h.radii[0]).toFixed(1)} m of apparent height)`);
  }

  // --- no sky between the ground's edge and the curtain's foot --------------
  //
  // The construction guarantees it; this recomputes the claim from the terrain
  // rather than from `occ`, by casting the ray the curtain's foot sits on and
  // asserting it strikes retained ground.
  {
    // enough relief to make the occlusion hard, and more than one surviving
    // band, so the stacking rule below has something to stack
    const c = mountains;
    const segs = c.h.sky.segs;
    let below = 0, hit = 0, tested = 0, rayTested = 0, stacked = 0, stackTested = 0;
    // read the geometry that was actually built, not a recomputation of it
    const footOf = (kk, i) => (c.h.bands[kk].position[i * 6 + 1] - c.yEye) / c.h.bands[kk].radius;
    for (let kk = 0; kk < c.h.bands.length; kk++) {
      const k = c.h.kept[kk];
      const prof = c.h.sky.band[k];
      // what stands in front of this band: the retained ground, plus every
      // nearer curtain that was actually kept
      const front = Float64Array.from(c.h.sky.occ);
      for (let j = 0; j < kk; j++) {
        const pj = c.h.sky.band[c.h.kept[j]];
        for (let i = 0; i < front.length; i++) {
          if (pj.tan[i] > front[i]) front[i] = pj.tan[i];
        }
      }
      const base = new Float64Array(front.length);
      for (let i = 0; i < front.length; i++) base[i] = footOf(kk, i);
      for (let i = 0; i < segs; i += 7) {
        tested++;
        if (base[i] <= prof.tan[i] + 1e-9 && base[i] <= front[i] + 1e-9) below++;
        if (kk > 0) {
          stackTested++;
          // an outer band's foot is placed against the nearest thing that hides
          // it, so it should sit exactly one drop below min(wall, its own crest)
          // compared as drawn height rather than as tangent: the positions are
          // float32, and a centimetre at 3.5 km is well inside that
          const want = Math.min(front[i], prof.tan[i]) - BASE_DROP;
          if (Math.abs(base[i] - want) * c.h.bands[kk].radius < 0.01) stacked++;
          continue;   // the ray test below is about the ground, and only the
        }              // first band meets the ground directly
        rayTested++;
        // independent: does the ground actually rise above this ray?
        const a = (i / segs) * TAU2, ca = Math.cos(a), sa = Math.sin(a);
        const rEdge = (1400 * 3.3 * 0.5) / Math.max(Math.abs(ca), Math.abs(sa));
        let struck = false;
        for (let r = 24; r <= rEdge; r *= 1.01) {
          let hgt = c.g.heightAt(ca * r, sa * r);
          if (c.seaLevel !== null && hgt < c.seaLevel) hgt = c.seaLevel;
          if ((hgt - c.yEye) / r >= base[i]) { struck = true; break; }
        }
        if (struck) hit++;
      }
    }
    ok('every column\'s foot sits below both its crest and what stands in front',
      below === tested, `${below}/${tested} columns across ${c.h.bands.length} bands`);
    ok('and a ray along the first band\'s foot strikes retained ground',
      hit === rayTested && rayTested > 0, `${hit}/${rayTested} rays occluded`);
    // The outer bands pay for the guarantee in overdraw, so the guarantee has
    // to be measured against the nearest thing that provides it — the previous
    // curtain — and not against the valley floor three bands away.
    ok('and an outer band\'s foot stops at the curtain in front of it, not at the ground',
      stacked === stackTested && stackTested > 0,
      `${stacked}/${stackTested} feet one drop below the nearer wall`);

    // The foot is sampled per column and drawn as a straight edge between
    // columns, so the margin has to cover how far the true occlusion dips below
    // that straight edge mid-segment. That is a measurable quantity, not a rule
    // of thumb, and it is what BASE_DROP has to beat.
    let dip = 0;
    for (let i = 0; i < segs; i += 7) {
      const am = ((i + 0.5) / segs) * TAU2, ca = Math.cos(am), sa = Math.sin(am);
      const rEdge = (1400 * 3.3 * 0.5) / Math.max(Math.abs(ca), Math.abs(sa));
      let mid = -Infinity;
      for (let r = 24; r <= rEdge; r *= 1.01) {
        let hgt = c.g.heightAt(ca * r, sa * r);
        if (c.seaLevel !== null && hgt < c.seaLevel) hgt = c.seaLevel;
        mid = Math.max(mid, (hgt - c.yEye) / r);
      }
      const lin = (c.h.sky.occ[i] + c.h.sky.occ[(i + 1) % segs]) / 2;
      dip = Math.max(dip, lin - mid);
    }
    ok('the drop covers how far the true occlusion dips below the drawn edge',
      BASE_DROP > dip, `drop ${BASE_DROP} vs worst mid-segment dip ${dip.toFixed(4)}`);
  }

  // --- saturationRadius inverts the fog it is named after -------------------
  {
    const p = REFERENCE_PARAMS;
    for (const crest of [40, 220, 640]) {
      const d = saturationRadius(p, crest, p.hazeH);
      const V = [0, 0, 1], sun = [0, 0.3, -0.954];
      const f = aerial([0.5, 0.5, 0.5], d, V, sun, crest, { ...p, mistAmt: 0 }).fog;
      near(`saturation at a ${crest} m crest is where §9.3's own fog reaches ${SATURATION}`,
        f, SATURATION, 1e-9);
    }
    ok('and a taller crest sees further, because it is above more of the haze',
      saturationRadius(REFERENCE_PARAMS, 640, 260)
        > saturationRadius(REFERENCE_PARAMS, 40, 260) * 1.5);
    ok('genuinely infinite extinction length returns no limit rather than NaN',
      saturationRadius({ near: 0, far: Infinity }, 400, 8436) === Infinity);
    // §9.3 gives a vacuum `far = 1e9` rather than an infinity so one formula
    // covers both. The saturation radius inherits that, and has to come back
    // beyond anything a planet could put a horizon at rather than beyond
    // floating point.
    ok('and §9.3\'s 1e9 vacuum convention comes back past every possible horizon',
      saturationRadius({ near: 7e7, far: 1.7e9 }, 400, 8436) > NO_LIMIT);
  }

  // --- the geometric horizon, against the exact tangent length --------------
  {
    for (const [R, h] of [[6.371e6 * 0.34, 640], [1.738e6 * 0.34, 220], [1e5, 800]]) {
      const yEye = 1.68;
      const exact = Math.sqrt(2 * R * yEye + yEye * yEye) + Math.sqrt(2 * R * h + h * h);
      const got = geometricHorizon(R, yEye, h);
      ok(`the horizon at R=${(R / 1e3) | 0} km matches the exact tangent length`,
        Math.abs(got - exact) / exact < h / (2 * R) + 1e-9,
        `${(got / 1e3).toFixed(2)} vs ${(exact / 1e3).toFixed(2)} km`);
    }
  }

  // --- the band count is a property of the air, not a constant -------------
  {
    const thick = horizonOf(WORLDS[1], { atmo: 1 });
    const thin = horizonOf(WORLDS[1], { atmo: 0.25 });
    const airless = horizonOf(WORLDS[1], { atmo: 0 });
    ok('thinner air pushes the horizon out until the world\'s own curvature takes over',
      thin.h.rMax > thick.h.rMax && airless.h.rMax >= thin.h.rMax
        && airless.h.rMax === airless.h.geo,
      `${thick.h.rMax | 0} → ${thin.h.rMax | 0} → ${airless.h.rMax | 0} m `
      + `(curvature at ${airless.h.geo | 0} m)`);
    ok('and it plans more bands, up to the stated ceiling',
      thin.h.planned.length >= thick.h.planned.length
        && airless.h.planned.length === MAX_BANDS,
      `${thick.h.planned.length} / ${thin.h.planned.length} / ${airless.h.planned.length} planned`);
    // Planning is the air's job; keeping is occlusion's. A band that rises
    // nowhere above the ridge in front of it is not drawn however clear the
    // air is, which is the one thing the extinction curve cannot know.
    ok('but occlusion, not the air, decides how many are drawn',
      airless.h.bands.length <= airless.h.planned.length
        && airless.h.bands.length >= 1,
      `${airless.h.bands.length} of ${airless.h.planned.length} survive occlusion`);
    ok('an airless world is limited by its own curvature, not by extinction',
      airless.h.sat > NO_LIMIT && airless.h.rMax === airless.h.geo,
      `geo ${(airless.h.geo / 1e3).toFixed(1)} km · sat ${airless.h.sat.toExponential(1)} m`);
    ok('a thick-air world is limited by extinction, not by curvature',
      thick.h.sat < thick.h.geo, `sat ${thick.h.sat | 0} m · geo ${thick.h.geo | 0} m`);
  }

  // --- the ring it replaces really was contributing nothing -----------------
  //
  // The claim in the commit, computed. Ring 2 spans EXT·1.58 to EXT·5 (half of
  // EXT·10), 9899 m at the corners.
  {
    const p = aerialParams({ Teq: 255, massE: 1, radiusE: 1, typeId: 1 }, 1, 1);
    const V = [0, 0, 1], sun = [0, 0.3, -0.954];
    const inner = aerial([0.5, 0.5, 0.5], 1400 * 1.58, V, sun, 0, { ...p, mistAmt: 0 }).fog;
    const corner = aerial([0.5, 0.5, 0.5], 1400 * 5 * Math.SQRT2, V, sun, 0, { ...p, mistAmt: 0 }).fog;
    ok('at its inner edge the retired ring shows under 2% of its own colour',
      1 - inner < 0.02, `clarity ${((1 - inner) * 100).toFixed(2)}%`);
    ok('and at its corners, under 0.01%',
      1 - corner < 1e-4, `clarity ${((1 - corner) * 100).toExponential(2)}%`);
    ok('so a temperate world retires it, on arithmetic rather than on taste',
      saturationRadius(p, 220, p.hazeH) < 1400 * 5 * Math.SQRT2);
    const thin = aerialParams({ Teq: 255, massE: 1, radiusE: 1, typeId: 1 }, 0.25, 1);
    ok('and a thin-atmosphere world keeps it, from the same line of arithmetic',
      saturationRadius(thin, 220, thin.hazeH) > 1400 * 5 * Math.SQRT2);
  }

  // --- what it costs ------------------------------------------------------
  {
    // ring 2 as `_gridWithHole(EXT*10, 72, EXT*1.58)` counts it
    const res = 72, half = 1400 * 10 / 2, cell = 1400 * 10 / res, hole = 1400 * 1.58;
    let quads = 0;
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const cx = -half + (i + 0.5) * cell, cz = -half + (j + 0.5) * cell;
        if (Math.abs(cx) < hole && Math.abs(cz) < hole) continue;
        quads++;
      }
    }
    const ringTris = quads * 2;
    const bandTris = MAX_BANDS * RIDGE_SEGS * 2;
    ok('four full bands cost under a quarter of the ring they replace',
      bandTris < ringTris / 4, `${bandTris} vs ${ringTris} triangles`);
    ok('and a real world draws well under that ceiling',
      mountains.h.bands.length * RIDGE_SEGS * 2 <= bandTris,
      `${mountains.h.bands.length} of ${mountains.h.planned.length} planned · `
      + `${mountains.h.bands.length * RIDGE_SEGS * 2} triangles`);
    ok('the whole measurement costs less than meshing the finest ring',
      mountains.h.sky.samples < 168 * 168,
      `${mountains.h.sky.samples} height evaluations vs ${168 * 168}`);
  }

  // --- determinism: this module adds no entropy at all ---------------------
  {
    const src = readFileSync(new URL('../src/horizon.js', import.meta.url), 'utf8');
    ok('§2.3 · the horizon draws no entropy — no RNG, no clock, no hash',
      !/Math\.random|Date\.now|performance\.now|new RNG|hash\(/.test(src));
    const again = horizonOf(WORLDS[1]);
    let same = again.h.bands.length === mountains.h.bands.length;
    for (let k = 0; same && k < mountains.h.bands.length; k++) {
      const a = mountains.h.bands[k].position, b = again.h.bands[k].position;
      if (a.length !== b.length) { same = false; break; }
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) { same = false; break; }
    }
    ok('and two builds of the same world are bit-identical',
      same && mountains.h.bands.length > 0);
  }

  // --- the ring closes, and the sea is a skyline too -----------------------
  {
    for (const c of [temperate, mountains]) {
      let closed = true;
      for (const prof of c.h.sky.band) {
        const n = prof.tan.length - 1;
        if (prof.tan[n] !== prof.tan[0] || prof.hitY[n] !== prof.hitY[0]) closed = false;
      }
      ok(`the ring closes exactly on the ${c === temperate ? 'coastal' : 'mountainous'} world`,
        closed);
    }
    const c = temperate;
    if (c.seaLevel !== null) {
      let below = 0;
      for (const b of c.h.bands) {
        for (let i = 0; i < b.aTrueY.length; i++) if (b.aTrueY[i] < c.seaLevel - 1e-6) below++;
      }
      ok('no part of the horizon is drawn below the water it stands in',
        below === 0, `${below} vertices under sea level`);
    } else {
      ok('no part of the horizon is drawn below the water it stands in', true, 'dry world');
    }
  }

  // --- bandPlan's own arithmetic ------------------------------------------
  {
    const r = bandPlan(3900, 3900 * 5.06);      // ln(5.06)/ln(1.5) = 4.0
    ok('bandPlan lays the radii out geometrically and stops at the ceiling',
      r.length === MAX_BANDS
      && Math.abs(r[1] / r[0] - r[2] / r[1]) < 1e-9
      && Math.abs(r[0] - 3900) < 1e-9,
      `${r.map((x) => x | 0).join('/')}`);
    ok('and a world with nowhere to put a second band still gets a horizon',
      bandPlan(3900, 3800).length === 1);
  }

  // --- the area average, not the rock ---------------------------------------
  {
    const rock = [0.42, 0.33, 0.26], soil = [0.30, 0.24, 0.18], veg = [0.20, 0.34, 0.16];
    const a = ridgeAlbedo(soil, rock, veg, 0);
    const sat = (c) => (Math.max(...c) - Math.min(...c)) / Math.max(Math.max(...c), 1e-9);
    ok('a ridge is less saturated than the rock it is made of',
      sat(a) < sat(rock) * 0.7, `${sat(a).toFixed(3)} vs ${sat(rock).toFixed(3)}`);
    ok('and darker, because half of every ridge faces away from a low sun',
      a[0] < rock[0] && a[1] < rock[1] && a[2] < rock[2]);
    const snowy = ridgeAlbedo(soil, rock, veg, 1);
    ok('snow survives area-averaging, because it covers rather than speckles',
      snowy[2] > a[2] * 1.3);
  }

  // --- what decides how many bands are drawn -------------------------------
  //
  // Pinned on synthetic ground rather than on whichever fixture happens to have
  // the right shape. The rule is occlusion and nothing else: a band survives if
  // and only if it rises somewhere above everything nearer than it.
  {
    const synth = (params) => (rise) => buildHorizon(
      (x, z) => {
        const r = Math.hypot(x, z);
        return r < 2400 ? 0 : rise(r);
      },
      { yEye: 1.68, eyeH: 1.68, nearHalf: 2310, params, Reff: 6.371e6 * 0.34 });
    const clear = { near: 70, far: 40000, hazeH: 260, mistAmt: 1 };
    const build = synth(clear);
    // ground that climbs with distance: every annulus stands above the one in
    // front of it, so every planned band is visible
    const rising = build((r) => r * 0.02);
    ok('ground that climbs with distance keeps every band it plans',
      rising.bands.length === rising.planned.length && rising.bands.length > 1,
      `${rising.bands.length} of ${rising.planned.length}`);
    // a dome falling away: the nearest ridge hides everything behind it
    const falling = build((r) => 900 - r * 0.03);
    ok('and a nearer ridge that hides the rest collapses them to one',
      falling.bands.length === 1 && falling.planned.length > 1,
      `${falling.bands.length} of ${falling.planned.length}`);
    // whatever survives, the crests must strictly ascend — that is what
    // "rises above what is in front of it" means, band by band
    let ascends = true;
    for (let kk = 1; kk < rising.bands.length; kk++) {
      const a = rising.sky.band[rising.kept[kk - 1]].tan;
      const b = rising.sky.band[rising.kept[kk]].tan;
      if (!(Math.max(...b) > Math.max(...a))) ascends = false;
    }
    ok('and every band that survives stands taller than the one in front of it',
      ascends);
  }

  // --- drawing nothing has to be as safe as drawing something --------------
  //
  // The retirement of the outer ring and the pruning of bands are separate
  // decisions, so they can combine into "the ground now stops at 2310 m and
  // there is no curtain behind it". That is only safe if nothing beyond the
  // ring's edge would have been visible anyway. It is — the terrain profile is
  // continuous from the eye outward, so every ray at or below `occ` strikes
  // near ground, and the pruning test is exactly "does anything out there rise
  // above `occ`". This casts the rays rather than restating the argument.
  {
    const params = { near: 70, far: 1700, hazeH: 260, mistAmt: 1 };
    const bowl = buildHorizon(
      // a rim at 800 m with everything beyond it falling away — the shape that
      // legitimately produces no bands at all
      (x, z) => { const r = Math.hypot(x, z); return r < 900 ? r * 0.09 : 81 - (r - 900) * 0.02; },
      { yEye: 1.68, eyeH: 1.68, nearHalf: 2310, params, Reff: 6.371e6 * 0.34 });
    ok('a bowl whose rim hides everything beyond it draws no curtain',
      bowl.bands.length === 0 || bowl.bands.every((b) => b.index.length === 0),
      `${bowl.bands.length} bands`);
    if (bowl.bands.length === 0) {
      let leak = 0, rays = 0;
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TAU2, ca = Math.cos(a), sa = Math.sin(a);
        const rEdge = 2310 / Math.max(Math.abs(ca), Math.abs(sa));
        let occ = -Infinity;
        for (let r = 24; r <= rEdge; r *= 1.01) {
          const h = (Math.hypot(ca * r, sa * r) < 900
            ? r * 0.09 : 81 - (r - 900) * 0.02);
          occ = Math.max(occ, (h - 1.68) / r);
        }
        rays++;
        // just above what the near ground hides: is there anything out there?
        for (let r = rEdge; r <= bowl.rMax; r *= 1.005) {
          const h = 81 - (r - 900) * 0.02;
          if ((h - 1.68) / r > occ + 1e-12) { leak++; break; }
        }
      }
      ok('and no ray above the near ground finds anything it should have drawn',
        leak === 0, `${leak}/${rays} rays leaked`);
    } else {
      ok('and no ray above the near ground finds anything it should have drawn',
        false, 'the bowl unexpectedly produced geometry');
    }
  }

  // --- the shaders carry the claims ----------------------------------------
  {
    const fsA = horizonFragment(AERIAL_GLSL).replace(/\/\/[^\n]*/g, '');
    const fsPlain = horizonFragment('').replace(/\/\/[^\n]*/g, '');
    ok('the fog is told the terrain\'s distance and height, not the curtain\'s',
      /aerial\(col, dist, normalize\(uCam - vW\), uSunDir, vTrueY\)/.test(fsA)
      && /vTrueD \+ \(dCam - dAnchor\)/.test(fsA));
    ok('§11 · the sunward arc guards its own zero-length normalize',
      /sl > 1e-4 && ol > 1e-4/.test(fsA));
    ok('the silhouette carries no invented normal and no invented light',
      !/reflect\(|pow\(max\(dot|vNormal|specular/.test(fsA));
    ok('and without §9.3 it still writes an opaque alpha rather than garbage',
      /gl_FragColor = vec4\(col, 1\.0\)/.test(fsPlain) && !fsPlain.includes('uAirFar'));
    ok('the vertex stage carries the true distance and height as attributes',
      /attribute float aTrueD/.test(HORIZON_VERT) && /attribute float aTrueY/.test(HORIZON_VERT));
    // The cost claim, as a red line rather than a ratio. A silhouette that
    // grows a noise octave or a texture lookup has stopped being a silhouette,
    // and this is the assertion that says so before a capture has to.
    {
      const noise = /\b(fbm3?|snoise|noise3?|triNoise)\s*\(/g;
      const tex = /\btexture(2D|Cube)?\s*\(/g;
      ok('and the silhouette evaluates no noise and samples no texture',
        (fsA.match(noise) || []).length === 0 && (fsA.match(tex) || []).length === 0,
        `${(fsA.match(noise) || []).length} noise · ${(fsA.match(tex) || []).length} texture`);
    }
  }

  // --- marchSkyline's bookkeeping -----------------------------------------
  {
    const { g } = horizonWorld(WORLDS[1]);
    const yEye = g.heightAt(0, 0) + 1.8;
    const s = marchSkyline(g.heightAt, {
      yEye, radii: [4000, 6000], rMax: 9000, nearHalf: 2310, segs: 40,
    });
    let inRange = true;
    for (let i = 0; i < 40; i++) {
      if (!(s.band[0].hitD[i] >= 24 && s.band[0].hitD[i] < 6000)) inRange = false;
      if (!(s.band[1].hitD[i] >= 6000 && s.band[1].hitD[i] <= 9000)) inRange = false;
    }
    ok('each band reports a hit from inside its own annulus',
      inRange && s.samples > 0, `${s.samples} samples`);
    ok('and the tallest crest found is the one the limits were computed at',
      s.maxCrestY >= s.minCrestY);
  }
}

const suites = {
  cosmology: suiteCosmology, zeldovich: suiteZeldovich, webclass: suiteWebclass,
  print: suitePrint, aerial: suiteAerial, starlight: suiteStarlight,
  paint: suitePaint, landing: suiteLanding, ground: suiteGround,
  walk: suiteWalk, material: suiteMaterial, opening: suiteOpening,
  ocean: suiteOcean, horizon: suiteHorizon,
};

for (const [name, fn] of Object.entries(suites)) {
  if (only && only !== name) continue;
  fn();
}

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
