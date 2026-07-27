// ΛCDM background cosmology (Planck 2018): expansion history and the linear
// growth factor D(a) that drives structure formation in the cosmic web scale.
//
//   E(a)  = H(a)/H0 = sqrt(Ωm a^-3 + ΩΛ)          (flat, radiation ignored, a >> 1e-3)
//   D(a)  ∝ E(a) ∫₀^a da' / (a' E(a'))³            (linear growth, normalized D(1)=1)
//   t(a)  = (1/H0) ∫₀^a da' / (a' E(a'))            (cosmic time)

const OMEGA_M = 0.315;
const OMEGA_L = 0.685;
const H0_INV_GYR = 14.51; // 1/H0 in Gyr for h = 0.674

// The table runs well past the present day: M1 asks the cosmic web for a
// continuous slow drift rather than a freeze at a = 1, and a clock that clamps
// is a frozen clock. a = 8 is roughly 20 Gyr hence, far beyond any session.
// N_TAB rises with the range so resolution below a = 1.5 is not traded away —
// tools/verify.js checks that against adaptive quadrature rather than trusting
// the arithmetic here.
const N_TAB = 4096;
const A_MIN = 1e-3;
const A_MAX = 8;

function E(a) { return Math.sqrt(OMEGA_M / (a * a * a) + OMEGA_L); }

// --- tabulate integrands once at module load (trapezoid, log-spaced) -------
const tabA = new Float64Array(N_TAB);
const tabD = new Float64Array(N_TAB);
const tabT = new Float64Array(N_TAB);

(function build() {
  const lnMin = Math.log(A_MIN), lnMax = Math.log(A_MAX);
  let accD = 0, accT = 0;
  let prevA = 0, prevFD = 0, prevFT = 0;
  for (let i = 0; i < N_TAB; i++) {
    const a = Math.exp(lnMin + (lnMax - lnMin) * (i / (N_TAB - 1)));
    const e = E(a);
    const fD = 1 / Math.pow(a * e, 3); // dD-integrand
    const fT = 1 / (a * e);            // dt-integrand
    if (i > 0) {
      const da = a - prevA;
      accD += 0.5 * (fD + prevFD) * da;
      accT += 0.5 * (fT + prevFT) * da;
    } else {
      // early matter domination closed form for the missing [0,a] piece:
      // D-integrand ∫ ≈ (2/5) a^{5/2} / Ωm^{3/2},  t ≈ (2/3) a^{3/2} / √Ωm
      accD = (2 / 5) * Math.pow(a, 2.5) / Math.pow(OMEGA_M, 1.5);
      accT = (2 / 3) * Math.pow(a, 1.5) / Math.sqrt(OMEGA_M);
    }
    tabA[i] = a;
    tabD[i] = 2.5 * OMEGA_M * e * accD;
    tabT[i] = accT * H0_INV_GYR;
    prevA = a; prevFD = fD; prevFT = fT;
  }
})();

function lookup(tab, a) {
  a = Math.min(Math.max(a, A_MIN), A_MAX);
  const lnMin = Math.log(A_MIN), lnMax = Math.log(A_MAX);
  const x = (Math.log(a) - lnMin) / (lnMax - lnMin) * (N_TAB - 1);
  const i = Math.min(Math.floor(x), N_TAB - 2);
  const f = x - i;
  return tab[i] * (1 - f) + tab[i + 1] * f;
}

const D_TODAY = lookup(tabD, 1);

export const COSMO = {
  OmegaM: OMEGA_M,
  OmegaL: OMEGA_L,
  H0: 67.4, // km/s/Mpc

  /** linear growth factor, normalized to D(a=1) = 1 */
  growth(a) { return lookup(tabD, a) / D_TODAY; },

  /** cosmic time in Gyr since the big bang */
  age(a) { return lookup(tabT, a); },

  /** redshift */
  z(a) { return 1 / a - 1; },

  /** growth rate f = dlnD/dlna ≈ Ωm(a)^0.55 */
  growthRate(a) {
    const om = OMEGA_M / (OMEGA_M + OMEGA_L * a * a * a);
    return Math.pow(om, 0.55);
  },

  E,
};
