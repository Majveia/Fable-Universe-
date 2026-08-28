// Precomputed scattering tables, built on the CPU at approach time.
//
// Two small textures carry the atmosphere's memory:
//   T(h, μ)  — transmittance from a point at height h along a ray with
//              cosine μ to the top of the atmosphere (zero through the
//              planet), sqrt-encoded into RGBA8 so twilight doesn't band.
//   Ψ(h, μs) — Hillaire's multiple-scattering factor: the 2nd scattering
//              order integrated over the sphere with an isotropic phase,
//              closed into the full geometric series by 1/(1−f_ms).
// The sky shader trades its nested sun-march for two lookups — faster and
// brighter where it matters: the blue that hangs on after the sun is gone.

import * as THREE from 'three';
import {
  SKY_EXPOSURE, atmosphereGLSL, mediumFor, starIrradiance,
} from './atmosphere.js';

const MU_LO = -0.3, MU_RANGE = 1.3;

export function buildScatterLUTs(P) {
  const { R, Ra, betaR, betaM, Hr, Hm } = P;
  const atmH = Ra - R;
  const NH = 32, NM = 128;

  // ray/sphere along (o at radius r, direction cosine mu) — 2D sufficient
  const exitDist = (r, mu, rad) => {
    const b = r * mu;
    const disc = b * b - (r * r - rad * rad);
    if (disc < 0) return -1;
    return -b + Math.sqrt(disc);
  };
  const hitsGround = (r, mu) => {
    const b = r * mu;
    const disc = b * b - (r * r - R * R);
    return disc >= 0 && (-b - Math.sqrt(disc)) > 0;
  };

  // optical depths from (h, mu) to the top — the shared integrator
  const odTo = (h, mu) => {
    const r0 = R + Math.max(h, 0);
    if (hitsGround(r0, mu)) return null;
    const t1 = exitDist(r0, mu, Ra);
    if (t1 <= 0) return [0, 0];
    const N = 40, dt = t1 / N;
    let odR = 0, odM = 0;
    for (let i = 0; i < N; i++) {
      const t = (i + 0.5) * dt;
      const r = Math.sqrt(r0 * r0 + t * t + 2 * r0 * t * mu);
      const hh = r - R;
      odR += Math.exp(-hh / Hr) * dt;
      odM += Math.exp(-hh / Hm) * dt;
    }
    return [odR, odM];
  };

  const Traw = new Float32Array(NH * NM * 3);
  const Tof = (h, mu, out) => {
    const od = odTo(h, mu);
    if (!od) { out[0] = out[1] = out[2] = 0; return out; }
    out[0] = Math.exp(-betaR.x * od[0] - betaM * 1.1 * od[1]);
    out[1] = Math.exp(-betaR.y * od[0] - betaM * 1.1 * od[1]);
    out[2] = Math.exp(-betaR.z * od[0] - betaM * 1.1 * od[1]);
    return out;
  };
  const tmp = [0, 0, 0];
  for (let iy = 0; iy < NH; iy++) {
    const h = (iy + 0.5) / NH * atmH;
    for (let ix = 0; ix < NM; ix++) {
      const mu = MU_LO + (ix + 0.5) / NM * MU_RANGE;
      Tof(h, mu, tmp);
      const k = (iy * NM + ix) * 3;
      Traw[k] = tmp[0]; Traw[k + 1] = tmp[1]; Traw[k + 2] = tmp[2];
    }
  }
  const Tlut = (h, mu, out) => {
    const fy = Math.min(Math.max(h / atmH * NH - 0.5, 0), NH - 1);
    const fx = Math.min(Math.max((mu - MU_LO) / MU_RANGE * NM - 0.5, 0), NM - 1);
    const k = ((fy | 0) * NM + (fx | 0)) * 3;   // nearest is plenty here
    out[0] = Traw[k]; out[1] = Traw[k + 1]; out[2] = Traw[k + 2];
    return out;
  };

  // ---- Ψ: isotropic multiple scattering (Hillaire 2020) ----------------
  const NS = 32;
  const psi = new Float32Array(NS * NS * 3);
  // 64 directions on a golden spiral
  const dirs = [];
  for (let i = 0; i < 64; i++) {
    const z = 1 - (2 * i + 1) / 64;
    const th = i * 2.399963;
    const q = Math.sqrt(1 - z * z);
    dirs.push([q * Math.cos(th), z, q * Math.sin(th)]);
  }
  const ISO = 1 / (4 * Math.PI);
  const dOmega = 4 * Math.PI / dirs.length;
  const ts = [0, 0, 0];
  let psiMax = 1e-9;
  for (let iy = 0; iy < NS; iy++) {
    const h = (iy + 0.5) / NS * atmH;
    const r0 = R + h;
    for (let ix = 0; ix < NS; ix++) {
      const mus = MU_LO + (ix + 0.5) / NS * MU_RANGE;
      const sun = [Math.sqrt(Math.max(1 - mus * mus, 0)), mus, 0]; // local frame: up = +y
      let L2r = 0, L2g = 0, L2b = 0, fr = 0, fg = 0, fb = 0;
      for (const w of dirs) {
        const mu = w[1]; // cos to local up
        const grounded = hitsGround(r0, mu);
        const t1 = grounded
          ? -(r0 * mu) - Math.sqrt(r0 * mu * r0 * mu - (r0 * r0 - R * R))
          : exitDist(r0, mu, Ra);
        if (t1 <= 0) continue;
        const N = 20, dt = t1 / N;
        let odR = 0, odM = 0;
        for (let i2 = 0; i2 < N; i2++) {
          const t = (i2 + 0.5) * dt;
          const r = Math.sqrt(r0 * r0 + t * t + 2 * r0 * t * mu);
          const hh = r - R;
          const dR = Math.exp(-hh / Hr) * dt, dM = Math.exp(-hh / Hm) * dt;
          odR += dR * 0.5; odM += dM * 0.5;
          const Tvr = Math.exp(-betaR.x * odR - betaM * 1.1 * odM);
          const Tvg = Math.exp(-betaR.y * odR - betaM * 1.1 * odM);
          const Tvb = Math.exp(-betaR.z * odR - betaM * 1.1 * odM);
          // sun transmittance at the sample — the local up tilts as we march:
          // position in local frame is (t·wx, r0 + t·wy, t·wz)
          const px = t * w[0], py = r0 + t * w[1], pz = t * w[2];
          const pr = Math.sqrt(px * px + py * py + pz * pz);
          const musY = (px * sun[0] + py * sun[1] + pz * sun[2]) / pr;
          Tlut(pr - R, musY, ts);
          const sR = dR * ISO, sM = dM * ISO;
          L2r += Tvr * ts[0] * (betaR.x * sR + betaM * sM);
          L2g += Tvg * ts[1] * (betaR.y * sR + betaM * sM);
          L2b += Tvb * ts[2] * (betaR.z * sR + betaM * sM);
          fr += Tvr * (betaR.x * sR + betaM * sM);
          fg += Tvg * (betaR.y * sR + betaM * sM);
          fb += Tvb * (betaR.z * sR + betaM * sM);
          odR += dR * 0.5; odM += dM * 0.5;
        }
      }
      L2r *= dOmega; L2g *= dOmega; L2b *= dOmega;
      fr *= dOmega; fg *= dOmega; fb *= dOmega;
      const k = (iy * NS + ix) * 3;
      psi[k] = L2r / Math.max(1 - fr, 0.05);
      psi[k + 1] = L2g / Math.max(1 - fg, 0.05);
      psi[k + 2] = L2b / Math.max(1 - fb, 0.05);
      psiMax = Math.max(psiMax, psi[k], psi[k + 1], psi[k + 2]);
    }
  }

  // ---- encode --------------------------------------------------------
  const tData = new Uint8Array(NH * NM * 4);
  for (let i = 0; i < NH * NM; i++) {
    tData[i * 4] = Math.sqrt(Traw[i * 3]) * 255;
    tData[i * 4 + 1] = Math.sqrt(Traw[i * 3 + 1]) * 255;
    tData[i * 4 + 2] = Math.sqrt(Traw[i * 3 + 2]) * 255;
    tData[i * 4 + 3] = 255;
  }
  const texT = new THREE.DataTexture(tData, NM, NH, THREE.RGBAFormat);
  texT.magFilter = texT.minFilter = THREE.LinearFilter;
  texT.needsUpdate = true;

  const mData = new Uint8Array(NS * NS * 4);
  for (let i = 0; i < NS * NS; i++) {
    mData[i * 4] = psi[i * 3] / psiMax * 255;
    mData[i * 4 + 1] = psi[i * 3 + 1] / psiMax * 255;
    mData[i * 4 + 2] = psi[i * 3 + 2] / psiMax * 255;
    mData[i * 4 + 3] = 255;
  }
  const texMS = new THREE.DataTexture(mData, NS, NS, THREE.RGBAFormat);
  texMS.magFilter = texMS.minFilter = THREE.LinearFilter;
  texMS.needsUpdate = true;

  return { texT, texMS, psiScale: psiMax };
}

// ---------------------------------------------------------------------------
// the surface sky's block, assembled

/**
 * Everything the chunk reads, built from a world, a star and a tier.
 *
 * The LUTs come from `scatterlut.js` unchanged — the two expensive tables are
 * already there and already correct, and this is the third caller rather than a
 * second implementation. That is the whole reason this file is short.
 *
 * `camPos` is handed in as a uniform object rather than a value: the eye moves
 * every frame and the integral starts from wherever it is, so a copy would be
 * the sky lagging the walker by a frame.
 */
export function makeAtmosphere({
  pp = {}, atmo = 1, gravity = 9.81, starT = 5778, steps = 12,
  sunDir, camPos, intensity = SKY_EXPOSURE,
} = {}) {
  const m = mediumFor(pp, atmo, gravity);
  const irr = starIrradiance(starT);
  const luts = buildScatterLUTs({
    R: m.R,
    Ra: m.Ra,
    betaR: { x: m.betaR[0], y: m.betaR[1], z: m.betaR[2] },
    betaM: m.betaM,
    Hr: m.Hr,
    Hm: m.Hm,
  });
  return {
    medium: m,
    glsl: atmosphereGLSL(steps),
    uniforms: {
      uAtmoCam: camPos || { value: new THREE.Vector3(0, m.R, 0) },
      uAtmoSun: sunDir || { value: new THREE.Vector3(0, 1, 0) },
      uAtmoBetaR: { value: new THREE.Vector3(...m.betaR) },
      uAtmoSunCol: { value: new THREE.Vector3(...irr) },
      uAtmoBetaM: { value: m.betaM },
      uAtmoR: { value: m.R },
      uAtmoRa: { value: m.Ra },
      uAtmoHr: { value: m.Hr },
      uAtmoHm: { value: m.Hm },
      uAtmoI: { value: intensity },
      uAtmoT: { value: luts.texT },
      uAtmoMS: { value: luts.texMS },
      uAtmoPsi: { value: luts.psiScale },
    },
  };
}
