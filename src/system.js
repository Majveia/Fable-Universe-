// SCALE 2 — STAR SYSTEM
//
// Every system is seeded from the star you clicked in the galaxy. The star's
// mass sets its temperature, luminosity and color through main-sequence
// scaling relations; planets obey Kepler. Positions come from solving
// Kepler's equation M = E − e·sin E by Newton iteration every frame — real
// two-body mechanics, with periods from Kepler's third law: P² = a³/M★.
// Orbital radii are gently compressed (r^0.62) so worlds stay visible;
// the HUD reports true values.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { hash, RNG, starName, planetName } from './rng.js';
import { applyResonance } from './resonance.js';
import { makeSkyDome, makeGalaxySkyFromWithin } from './starfield.js';
import { softDotTexture, nebulaTexture } from './nebula.js';
// `blackbodyRGB` still lights the *planets*: it is Tanner Helland's fit, it is
// cheap, and a lambertian term does not care about the last percent of
// chromaticity. What it no longer does is decide what the star's own pixels
// look like — that is `starChroma()` below, Planck through the CIE 1931
// observer, the same transfer §9.6 derives the sky stops from. Two functions,
// two jobs, and the one that has to survive §8 axis 8 is the rigorous one.
import {
  makeSurfaceMaterial, makeCloudMaterial, makeAtmosphereMaterial,
  makeRingMaterial, blackbodyRGB, NOISE_GLSL,
} from './planet.js';
import { vegetationHSL } from './meadow.js';
import { planck, spectrumToXYZ, xyzToLinearSRGB, toGamut } from './starlight.js';

const AU_DRAW = 46;      // display units at 1 AU

// deep-time climate tints
const SCORCH_TINT = new THREE.Color(0.3, 0.16, 0.09);
const FREEZE_TINT = new THREE.Color(0.82, 0.86, 0.94);
const MELT_SEA = new THREE.Color(0.06, 0.22, 0.42);
const R_EXP = 0.62;      // orbital compression exponent

/**
 * `?giants=1` — put the gas and ice giants back.
 *
 * They are switched **off** by default at the human's instruction. Beyond the
 * frost line a real disc makes envelopes, so the generator is not wrong; it is
 * being asked to draw a universe of worlds you can stand on. Every downstream
 * consequence follows on its own rather than being suppressed one at a time:
 * the cloud-deck scale simply never opens, `wonder.js`'s eligibility rule stops
 * having anything to exclude, and `craft.js` never has to explain that a giant
 * has no ground.
 */
const GIANTS = (() => {
  try { return new URL(window.location.href).searchParams.get('giants') === '1'; }
  catch { return false; }
})();

const TYPE_IDS = { barren: 0, terrestrial: 1, ocean: 2, ice: 3, lava: 4, 'gas giant': 5, 'ice giant': 6 };

const drawR = (au) => AU_DRAW * Math.pow(Math.max(au, 0.01), R_EXP);

/**
 * …and the way back. **A display radius must never be read into a physical
 * law**, and this constant exists so that no shader has to be tempted.
 *
 * `drawR()` compresses orbital radius by `au^0.62` so the outer worlds stay on
 * screen — a stated, purely visual choice, and the HUD reports the true AU
 * either way (§3: "the numbers are never negotiable; the palette always is").
 * But three separate places had gone on to *do arithmetic* with the compressed
 * number, and an inverse-square law fed a compressed radius is not an
 * inverse-square law:
 *
 *     r_draw ∝ au^0.62   ⇒   1/r_draw² ∝ au^−1.24
 *
 * So the interplanetary dust and the asteroid belt were both falling off as
 * `r^−1.24` while their comments claimed `r^−2`, and the deep-time engulfment
 * test compared a star radius compressed by `√R` against an orbit compressed by
 * `au^0.62` — two different compressions, subtracted as if they were the same
 * quantity, which made a red giant swallow worlds out to about 2.3× the orbit
 * it had actually reached. All three are §8 axis 8: the pixels contradicting
 * the physics the HUD asserts, quietly, in the one direction nobody checks.
 *
 * `drawR()` is now the only thing allowed to compress, and `auOf()` is the only
 * thing allowed to undo it.
 */
const INV_R_EXP = 1 / R_EXP;
const auOf = (rDraw) => Math.pow(Math.max(rDraw, 1e-6) / AU_DRAW, INV_R_EXP);

/** one solar radius, in astronomical units — the constant that makes a stellar
 *  radius and an orbital radius the same kind of number */
const R_SUN_AU = 0.004650467;

function spectralClass(T) {
  return T > 30000 ? 'O' : T > 10000 ? 'B' : T > 7500 ? 'A' : T > 6000 ? 'F'
    : T > 5200 ? 'G' : T > 3700 ? 'K' : 'M';
}

const CIV_NOTES = [
  'Radio chatter on a thousand frequencies. Somebody down there is arguing about sports.',
  'Night side lit like a circuit board. Customs asks that you declare all exotic matter.',
  'An old beacon still loops a lullaby in a dead language.',
  'Orbital lanes are busy tonight. Mind the tug traffic.',
  'They terraformed the coastlines twice and still complain about the weather.',
];
const DEAD_NOTES = [
  'No signals. Just weather, geology, and time.',
  'A world waiting for its first name to matter.',
  'Wind, rock, and a horizon nobody has ever seen.',
];

// ----------------------------------------------------------- generation ----

export function systemParams(starSeed) {
  const r = new RNG(hash(starSeed, 0x5f5));
  const name = starName(starSeed);

  // star from the main sequence (IMF reaches the supernova progenitors)
  let mass = r.power(0.25, 18, 2.2);
  let temp = 5772 * Math.pow(mass, 0.54);
  let lum = Math.pow(mass, 3.6);
  let radiusSun = Math.pow(mass, 0.85);
  let stage = 'main sequence';
  let pulsar = null;
  const roll = r.next();
  if (roll < 0.07) { stage = 'red giant'; temp = r.float(3300, 4300); radiusSun = r.float(12, 45); lum = radiusSun * radiusSun * Math.pow(temp / 5772, 4); }
  else if (roll < 0.10) { stage = 'white dwarf'; temp = r.float(9000, 26000); radiusSun = 0.013; lum = 0.001 * (temp / 10000) ** 4; }
  else if (roll < 0.135) {
    // the corpse of a supernova: a city-sized star spinning like a lighthouse
    stage = 'neutron star';
    temp = r.float(28000, 35000);
    radiusSun = 1.7e-5; // ~12 km
    lum = r.float(0.08, 0.4); // beamed, not thermal
    mass = r.float(1.3, 2.1);
    pulsar = {
      periodMs: r.chance(0.35) ? r.float(1.4, 30) : r.float(80, 900),
      bGauss: r.power(1e8, 5e12, 1.4),
      remnantAge: r.int(3, 90), // kyr
    };
  }

  // ~1 in 5 systems is a close binary; its planets are circumbinary (P-type)
  let binary = null;
  if (stage === 'main sequence' && r.chance(0.22)) {
    const q = r.float(0.3, 0.92);
    const massB = mass * q;
    binary = {
      massB,
      tempB: 5772 * Math.pow(massB, 0.54),
      lumB: Math.pow(massB, 3.6),
      radiusSunB: Math.pow(massB, 0.85),
      aBin: r.float(0.12, 0.4),
      eBin: Math.abs(r.gauss()) * 0.12,
      inc: Math.abs(r.gauss()) * 0.02,
      Omega: r.float(0, Math.PI * 2),
      omega: r.float(0, Math.PI * 2),
      M0: r.float(0, Math.PI * 2),
      q,
    };
    binary.spectralB = spectralClass(binary.tempB);
    lum += binary.lumB;
  }
  const massTotal = mass + (binary ? binary.massB : 0);

  const hz = Math.sqrt(lum);            // habitable-zone center, AU
  const frost = 2.7 * Math.sqrt(lum);   // frost line, AU

  const nPlanets = stage === 'white dwarf' ? r.int(0, 2)
    : stage === 'neutron star' ? r.int(1, 3)   // PSR B1257+12 country
    : r.int(2, 8);
  const planets = [];
  let a = r.float(0.28, 0.5) * Math.max(Math.sqrt(lum), 0.35);
  // circumbinary stability: nothing survives inside ~3.5 binary separations
  if (binary) a = Math.max(a, binary.aBin * r.float(3.5, 5));
  for (let i = 0; i < nPlanets; i++) {
    const pr = new RNG(hash(starSeed, 0x914, i));
    let type, massE, radiusE;
    if (stage === 'neutron star') {
      type = pr.next() < 0.7 ? 'barren' : 'ice'; // second-generation rock
    } else if (a > frost) {
      // §7.4 · `?giants=1` restores them. Beyond the frost line the accretion
      // model says gas and ice giants, and it is right — this universe is
      // simply not drawing them for now, at the human's instruction.
      //
      // The draw is *reweighted*, not filtered, and the difference matters for
      // §2.3: skipping a roll would leave every seed's RNG stream where it was
      // and quietly change nothing, while re-normalising the same `pr.next()`
      // across the remaining outcomes keeps the stream aligned and keeps a
      // shared URL meaning the same place. Beyond the frost line everything is
      // ice, which is what is left when you take the envelopes away.
      const t = pr.next();
      type = GIANTS ? (t < 0.5 ? 'gas giant' : t < 0.78 ? 'ice giant' : 'ice')
        : (t < 0.62 ? 'ice' : 'barren');
    } else if (a > hz * 0.78 && a < hz * 1.6) {
      type = pr.next() < 0.62 ? 'terrestrial' : 'ocean';
    } else if (a < hz * 0.35) {
      type = pr.next() < 0.3 ? 'lava' : 'barren';
    } else {
      type = pr.next() < 0.75 ? 'barren' : 'terrestrial';
    }
    if (type === 'gas giant') { massE = pr.float(40, 380); radiusE = pr.float(8.5, 12.5); }
    else if (type === 'ice giant') { massE = pr.float(10, 30); radiusE = pr.float(3.4, 4.6); }
    else { massE = pr.power(0.1, 3.2, 1.8); radiusE = Math.pow(massE, 0.28); }

    const inhabited = (type === 'terrestrial' || type === 'ocean') && pr.chance(0.45);
    const e = Math.min(Math.abs(pr.gauss()) * 0.055 + 0.004 + (pr.chance(0.06) ? pr.float(0.15, 0.3) : 0), 0.42);
    const albedo = type === 'ice' ? 0.55 : type === 'ocean' ? 0.3 : 0.25;
    const Teq = Math.round(278 * Math.pow(lum, 0.25) / Math.sqrt(a) * Math.pow(1 - albedo, 0.25));

    // palette per species
    const hue = pr.next();
    let colA, colB, colC, atmoColor, oceanLevel = -1, clouds = 0, iceCap = 2.0, ringColor;
    switch (type) {
      case 'terrestrial':
        colA = new THREE.Color().setHSL(0.09 + hue * 0.05, 0.45, 0.32);   // soil
        colB = new THREE.Color().setHSL(0.07, 0.25, 0.55);                 // peaks
        // Vegetation, and it was the wrong colour on every world that has one.
        //
        // The range was `0.32 + hue·0.1` — HSL 115° to 151°, so green at the
        // bottom and spring-green/teal at the top. That alone is only the cool
        // edge of plausible; what made it turquoise on screen is that it
        // compounds with `grassPalette()`, which rotates a blade's root 62%
        // toward a pole with blue at 4.5× because a sward's base is lit by
        // skylight. From a 151° base that lands the root, the hollow and half
        // the mosaic past cyan — which is most of the mass of a distant field.
        // `src/meadow.js` carries the full argument and the arithmetic.
        //
        // §3's weirdness budget is enforced here, which is where the
        // constitution says to enforce it: "in the seed→biome function." The top
        // 5% of the hue draw is not chlorophyll at all — teal, violet, rust —
        // and the other 95% is green, because rarity is the mechanism by which
        // strangeness lands.
        //
        // Taken from the *same* draw rather than a new one on purpose: an extra
        // `pr.next()` here would shift every subsequent draw for the world and
        // move its ocean level, its clouds and its ice caps along with the
        // grass. One number, two readings, no perturbation (§2.3).
        const veg = vegetationHSL(hue, inhabited);
        colC = new THREE.Color().setHSL(veg.h, veg.s, veg.l);
        atmoColor = new THREE.Color(0.28, 0.5, 1.0);
        oceanLevel = pr.float(-0.05, 0.16); clouds = pr.float(0.45, 0.75); iceCap = pr.float(0.72, 0.92);
        break;
      case 'ocean':
        colA = new THREE.Color(0.02, 0.09, 0.28); colB = new THREE.Color(0.5, 0.52, 0.5);
        colC = new THREE.Color(0.1, 0.35, 0.5);
        atmoColor = new THREE.Color(0.25, 0.55, 1.0);
        oceanLevel = pr.float(0.3, 0.5); clouds = pr.float(0.5, 0.85); iceCap = pr.float(0.8, 0.95);
        break;
      case 'ice':
        colA = new THREE.Color(0.75, 0.82, 0.9); colB = new THREE.Color(0.92, 0.96, 1.0);
        colC = new THREE.Color(0.3, 0.55, 0.75);
        atmoColor = new THREE.Color(0.5, 0.75, 1.0).multiplyScalar(0.5);
        clouds = pr.float(0, 0.25); iceCap = 0.0;
        break;
      case 'lava':
        colA = new THREE.Color(0.23, 0.16, 0.13); colB = new THREE.Color(0.1, 0.08, 0.08);
        colC = new THREE.Color(1.0, 0.32, 0.06);
        atmoColor = new THREE.Color(1.0, 0.4, 0.15).multiplyScalar(0.45);
        break;
      case 'gas giant': {
        const warm = pr.chance(0.6);
        colA = warm ? new THREE.Color().setHSL(0.07 + hue * 0.05, 0.5, 0.5) : new THREE.Color().setHSL(0.55 + hue * 0.1, 0.3, 0.45);
        colB = warm ? new THREE.Color().setHSL(0.1 + hue * 0.06, 0.45, 0.34) : new THREE.Color().setHSL(0.6 + hue * 0.08, 0.35, 0.3);
        colC = warm ? new THREE.Color(0.85, 0.5, 0.3) : new THREE.Color(0.8, 0.85, 0.95);
        atmoColor = colA.clone().multiplyScalar(0.55);
        ringColor = new THREE.Color().setHSL(0.08 + hue * 0.04, 0.2, 0.55);
        break;
      }
      case 'ice giant':
        colA = new THREE.Color().setHSL(0.5 + hue * 0.08, 0.55, 0.5);
        colB = new THREE.Color().setHSL(0.55 + hue * 0.08, 0.6, 0.35);
        colC = new THREE.Color(0.85, 0.92, 1.0);
        atmoColor = colA.clone().multiplyScalar(0.6);
        ringColor = new THREE.Color(0.55, 0.6, 0.7);
        break;
      default: // barren
        colA = new THREE.Color().setHSL(0.06 + hue * 0.06, 0.18, 0.32);
        colB = new THREE.Color().setHSL(0.08, 0.1, 0.5);
        colC = new THREE.Color().setHSL(0.05, 0.2, 0.2);
        atmoColor = new THREE.Color(0.4, 0.35, 0.3).multiplyScalar(0.15);
        iceCap = pr.chance(0.4) ? pr.float(0.85, 0.95) : 2.0;
    }

    // every world answers to something: the resonance is chosen at birth,
    // so orbit shader, tiles, weather and HUD all wear the same mood
    planets.push(applyResonance({
      index: i,
      name: planetName(name, i, starSeed),
      type, typeId: TYPE_IDS[type],
      inhabited,
      a, e,
      inc: Math.abs(pr.gauss()) * 0.03,
      Omega: pr.float(0, Math.PI * 2),
      omega: pr.float(0, Math.PI * 2),
      M0: pr.float(0, Math.PI * 2),
      periodYears: Math.sqrt(a * a * a / massTotal),
      massE, radiusE,
      drawRadius: Math.min(1.35 * Math.pow(radiusE, 0.45), 6),
      spin: pr.float(0.02, 0.12) * pr.sign(),
      tilt: Math.abs(pr.gauss()) * 0.3,
      Teq,
      noiseSeed: pr.float(0, 100),
      colA, colB, colC, atmoColor, oceanLevel, clouds, iceCap,
      hasRings: (type === 'gas giant' && pr.chance(0.45)) || (type === 'ice giant' && pr.chance(0.25)),
      ringColor,
      moons: type.includes('giant') ? pr.int(1, 4) : (pr.chance(0.3) ? 1 : 0),
      note: inhabited ? CIV_NOTES[pr.int(0, CIV_NOTES.length - 1)] : DEAD_NOTES[pr.int(0, DEAD_NOTES.length - 1)],
      seed: hash(starSeed, 0x914, i),
    }));
    a *= r.float(1.5, 1.95);
  }

  // asteroid belt in the widest gap (if any)
  let belt = null;
  if (planets.length >= 2 && r.chance(0.75)) {
    let gi = 0, gr = 0;
    for (let i = 0; i < planets.length - 1; i++) {
      const ratio = planets[i + 1].a / planets[i].a;
      if (ratio > gr) { gr = ratio; gi = i; }
    }
    if (gr > 1.7) belt = { a: Math.sqrt(planets[gi].a * planets[gi + 1].a), width: 0.16 };
  }

  return {
    seed: starSeed, name, mass, massTotal, temp, lum, radiusSun, stage, binary, pulsar,
    spectral: spectralClass(temp), hz, frost, planets, belt,
    comet: r.chance(0.55) ? { a: Math.max(frost * 1.6, 3), e: r.float(0.86, 0.96), inc: r.float(0.2, 0.9), Omega: r.float(0, 6.28), omega: r.float(0, 6.28), M0: r.float(0, 6.28) } : null,
  };
}

/** Kepler's equation solver → position in the orbital plane (real AU) */
function keplerPos(el, tYears, massStar, out) {
  const n = (2 * Math.PI) / Math.sqrt(el.a ** 3 / massStar); // rad / yr
  const M = el.M0 + n * tYears;
  let E = M;
  for (let i = 0; i < 6; i++) E -= (E - el.e * Math.sin(E) - M) / (1 - el.e * Math.cos(E));
  const nu = 2 * Math.atan2(Math.sqrt(1 + el.e) * Math.sin(E / 2), Math.sqrt(1 - el.e) * Math.cos(E / 2));
  const rAU = el.a * (1 - el.e * Math.cos(E));
  // perifocal → ecliptic (Ω, i, ω)
  const co = Math.cos(el.omega + nu), so = Math.sin(el.omega + nu);
  const cO = Math.cos(el.Omega), sO = Math.sin(el.Omega);
  const ci = Math.cos(el.inc), si = Math.sin(el.inc);
  const x = cO * co - sO * so * ci;
  const z = sO * co + cO * so * ci;
  const y = so * si;
  const rd = drawR(rAU);
  out.set(x * rd, y * rd, z * rd);
  out.rAU = rAU;
  return out;
}

// ===========================================================================
// THE STAR
//
// What was here before was a white sphere inside a Gaussian sprite ten stellar
// radii across, tinted by `planet.js`'s `blackbodyRGB()`. Measured on the
// capture at `?seed=20250601&g=443188473&s=2309765500`, that frame was **99.2%
// achromatic**, 70.6% of it lit, and the star — a G-class 5,682 K star, which
// the HUD says out loud — arrived as a flat grey egg filling most of the
// screen. §8 axis 6 asks for nothing clipping and §8 axis 8 asks whether the
// pixels contradict the physics the HUD asserts. Both failed, and the second
// one failed hard: the temperature was simply not on screen.
//
// Three separate faults, and it is worth naming each because each has its own
// fix below.
//
//  1. **The colour was never warm.** `blackbodyRGB()` is the Tanner Helland
//     fit, which returns (1.00, 0.944, 0.893) at 5,682 K. The CIE integral of
//     the actual Planck spectrum returns (1.00, 0.870, 0.799) — nearly twice
//     the chroma. `starlight.js` already owns that integral (it is how §9.6's
//     sky stops are derived), so the star now goes through the same transfer
//     the air does. One definition, per §2.7's discipline.
//
//  2. **The glow was a sprite, not a corona.** `dR · 10` at `AU_DRAW = 46`
//     means a halo wider than one astronomical unit, with a Gaussian profile
//     that has no physical referent at all. A real corona is *six orders of
//     magnitude* fainter than the disc and dies inside four stellar radii; the
//     wide halo in any real photograph of a star is the instrument's point
//     spread function, which in AEON is `bloom.js` and is bounded on purpose.
//
//  3. **Everything clipped.** `uColor · granule · limb · 2.6` puts the disc
//     centre near 3.4 in the linear buffer, where `1 − exp(−1.32c)` has no
//     slope left, so granulation, limb darkening and hue all resolved to the
//     same white.

/**
 * A star's chromaticity, from Planck's law through the CIE 1931 observer.
 *
 * Returned at **unit luminance**, because the brightness is a separate physical
 * quantity (Stefan–Boltzmann, below) and mixing the two is what bleaches a
 * palette — §9.2 gives exactly this rule for hemispheric ambient: "normalise
 * the hemi colour to unit luminance so it can rotate hue without ever bleaching
 * the palette."
 */
function starChroma(T) {
  const rgb = toGamut(xyzToLinearSRGB(spectrumToXYZ((l) => planck(l, Math.min(Math.max(T, 900), 60000)))));
  const y = Math.max(0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2], 1e-6);
  return [rgb[0] / y, rgb[1] / y, rgb[2] / y];
}

/** the same thing as a THREE.Color, renormalised so no channel exceeds 1 —
 *  for the places that want a tint rather than a radiance */
function starTint(T) {
  const c = starChroma(T);
  const m = Math.max(c[0], c[1], c[2]);
  return new THREE.Color(c[0] / m, c[1] / m, c[2] / m);
}

// How far either side of T_eff the photosphere ramp has to reach. The low end
// is a sunspot umbra (~0.62 T_eff on the Sun); the high end is the deepest
// layer a grazing sightline reaches plus the hottest granule.
const RAMP_LO = 0.55, RAMP_HI = 1.16, RAMP_N = 12;

/** T/T_eff → chromaticity, sampled for one star, as a GLSL-ready ramp */
function chromaRamp(Teff) {
  const out = [];
  for (let i = 0; i < RAMP_N; i++) {
    const f = RAMP_LO + (RAMP_HI - RAMP_LO) * (i / (RAMP_N - 1));
    const c = starChroma(Teff * f);
    out.push(new THREE.Vector3(c[0], c[1], c[2]));
  }
  return out;
}

/**
 * Exposure, and the one place the photosphere is *not* literal.
 *
 * Surface brightness is σT⁴ and is distance-independent, so an honest render
 * puts a 3,200 K M dwarf at 11% of the Sun's radiance per unit area and a
 * 33,000 K O star at 1,068× it. That range does not fit in a frame, and §3
 * rules that "the numbers are never negotiable; the palette always is" — so the
 * numbers stay in the HUD and the *ordering* is what reaches the pixels, through
 * a monotone compression rather than a lie. Same move `cosmic.js` makes for the
 * divergence in `compressTheta()`, and the same argument §9.6 makes for the sky:
 * derive it through a fixed transfer rather than choose it by eye.
 *
 * Exponent 0.9 on (T/T☉) instead of 4: strictly increasing, so hotter is always
 * brighter, and clamped so neither end of the main sequence can blow the frame
 * or vanish from it.
 */
function starExposure(Teff) {
  return Math.min(Math.max(0.78 * Math.pow(Teff / 5772, 0.9), 0.42), 1.45);
}

// ---------------------------------------------------------------------------
// the photosphere

const PHOTO_VERT = /* glsl */`
  out vec3 vN;
  out vec3 vObj;
  out vec3 vW;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vObj = normalize(position);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const PHOTO_FRAG = /* glsl */`
  precision highp float;
  uniform vec3  uRamp[${RAMP_N}];
  uniform float uExposure;
  uniform float uTime;
  uniform float uSeed;
  uniform float uSpots;      // magnetic activity, 0 = quiet, 1 = heavily spotted
  uniform float uGran;       // granulation contrast, in fractions of T_eff
  uniform vec3  uCamPos;
  in vec3 vN;
  in vec3 vObj;
  in vec3 vW;
  out vec4 fragColor;
  ${NOISE_GLSL}

  /** T/T_eff → chromaticity at unit luminance; the CPU built this ramp from
   *  the same CIE integral src/starlight.js uses for the sky (§9.6) */
  vec3 chroma(float t) {
    float x = clamp((t - ${RAMP_LO.toFixed(3)}) / ${(RAMP_HI - RAMP_LO).toFixed(3)}, 0.0, 1.0)
            * ${(RAMP_N - 1).toFixed(1)};
    int i = int(floor(x));
    return mix(uRamp[i], uRamp[min(i + 1, ${RAMP_N - 1})], x - float(i));
  }

  void main() {
    vec3 n = normalize(vN);
    vec3 viewDir = normalize(uCamPos - vW);
    float mu = clamp(dot(n, viewDir), 0.0, 1.0);

    // ---- limb darkening AND limb reddening, from one relation -------------
    //
    // A grey atmosphere in radiative equilibrium has T⁴(τ) = ¾·T_eff⁴·(τ + ⅔)
    // (Eddington 1926). A sightline at angle μ reaches unit optical depth at
    // vertical τ = μ, so what you see at that point on the disc is a blackbody
    // at
    //
    //     T(μ) = T_eff · [¾·(μ + ⅔)]^¼
    //
    // — 1.057·T_eff at disc centre, 0.841·T_eff at the extreme limb. Its
    // radiance is T⁴, i.e. ¾(μ + ⅔), which *is* the classical Eddington limb
    // darkening law I(μ)/I(1) = (2 + 3μ)/5. So the darkening and the reddening
    // are the same statement made once, and the edge of the disc goes orange
    // because it is genuinely a thousand kelvin cooler — not because a curve
    // was tuned. This is the single thing that puts the HUD's temperature on
    // the screen (§8 axis 8).
    float t4 = 0.75 * (mu + 0.6666667);

    // ---- granulation ------------------------------------------------------
    // Convection cells: hot upwellings a couple of hundred kelvin above the
    // mean, separated by cooler downflow lanes. On the Sun that is ±2–3% in T
    // on a ~1 Mm cell, overturning in minutes. Because colour comes from T, the
    // lanes are perceptibly redder than the granules — which is true, and which
    // no amount of multiplying one tint by a noise field can reproduce.
    vec3 p = vObj * 7.5 + vec3(uSeed);
    float g = fbm(p + vec3(0.0, uTime * 0.035, 0.0));
    float fine = snoise(p * 3.1 - vec3(uTime * 0.02));
    t4 *= 1.0 + uGran * (1.35 * g + 0.45 * fine);

    // ---- starspots --------------------------------------------------------
    // Umbra ~0.62 T_eff, penumbra ~0.85, and coverage rises steeply toward the
    // late types: an M dwarf can be tens of percent spotted, an A star is not
    // spotted at all. Its own noise field, an octave below the granulation.
    float sp = fbm3(vObj * 1.9 - vec3(uSeed * 0.37));
    float spot = uSpots * smoothstep(0.34, 0.62, sp);

    float tRatio = pow(max(t4, 0.02), 0.25) * (1.0 - 0.38 * spot);
    // radiance is T⁴ by Stefan–Boltzmann — the same t4 that set the colour
    float rad = pow(tRatio, 4.0) * uExposure;

    vec3 col = chroma(tRatio) * rad;

    // ---- faculae ----------------------------------------------------------
    // Bright magnetic walls between granules. They are invisible at disc
    // centre and conspicuous near the limb, because that is where you see the
    // hot side wall of the granule rather than its cool floor — so the term is
    // gated on (1 − μ), which is also what stops it from washing the centre.
    col += chroma(1.06) * smoothstep(0.55, 0.95, g) * (1.0 - mu) * 0.34 * uExposure;

    // ---- chromosphere -----------------------------------------------------
    // A thin shell above the photosphere, optically thin except in the Balmer
    // lines, which is why the flash spectrum is red. It is only visible where
    // the sightline grazes: μ → 0.
    col += vec3(0.62, 0.11, 0.13) * pow(1.0 - mu, 6.0) * 1.15 * uExposure;

    // §11: never hand a non-finite texel to the bloom pyramid.
    col = mix(vec3(0.0), col, vec3(equal(col, col)));
    fragColor = vec4(clamp(col, 0.0, 24.0), 1.0);
  }
`;

/** the photosphere of one star, from its effective temperature alone */
function makePhotosphereMaterial(Teff, seed, camPosUniform, timeUniform) {
  // magnetic activity is a strong function of spectral type: late-type stars
  // have deep convective envelopes and dynamos to match, early types do not
  const spots = Math.min(Math.max((6200 - Teff) / 2600, 0), 1) ** 1.4 * 0.85;
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uRamp: { value: chromaRamp(Teff) },
      uExposure: { value: starExposure(Teff) },
      uTime: timeUniform,
      uSeed: { value: seed },
      uSpots: { value: spots },
      // Solar granulation contrast is about 15% in intensity at 500 nm. This
      // uniform perturbs T^4, which *is* intensity, so 0.075 against the
      // 1.35 g + 0.45 fine weighting below lands in that band rather than
      // wherever a number chosen by eye would have.
      uGran: { value: 0.075 },
      uCamPos: camPosUniform,
    },
    vertexShader: PHOTO_VERT,
    fragmentShader: PHOTO_FRAG,
  });
}

// ---------------------------------------------------------------------------
// the corona

const BILLBOARD_VERT = /* glsl */`
  uniform float uScale;
  out vec2 vXY;
  out vec3 vW;
  void main() {
    vXY = position.xy;
    // billboard about the object's own origin, so it turns with the camera and
    // keeps its scale under the parent's transform (a red giant's corona grows
    // with the star, which is right)
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    mv.xy += position.xy * uScale;
    vW = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    gl_Position = projectionMatrix * mv;
  }
`;

const CORONA_OUTER = 4.6;   // stellar radii; van de Hulst is already ~0 by here

const CORONA_FRAG = /* glsl */`
  precision highp float;
  uniform vec3  uChroma;
  uniform float uGain;
  uniform float uTime;
  uniform float uSeed;
  in vec2 vXY;
  in vec3 vW;
  out vec4 fragColor;
  ${NOISE_GLSL}

  void main() {
    // vXY spans ±1 at the billboard edge; uScale was set so that is uOuter R★
    float r = length(vXY) * ${CORONA_OUTER.toFixed(2)};
    if (r < 1.0) discard;          // behind the photosphere

    // ---- van de Hulst (1950), the measured K-corona ----------------------
    //
    //   B_K(r)/B̄☉ = 10⁻⁶ · (0.0532 r^−2.5 + 1.425 r^−7 + 2.565 r^−17)
    //
    // Three terms because the corona is three things: a near-limb cusp, the
    // streamer base, and the extended electron halo. This is the falloff §M's
    // brief asked to be "motivated rather than a fat sprite" — and the honest
    // consequence of the 10⁻⁶ is that a corona is *invisible* beside its own
    // photosphere. What surrounds a star in any real photograph is the
    // instrument's point spread function, and AEON's is src/bloom.js, bounded
    // to about 64 source pixels on purpose (§2.8). So the halo comes from
    // there, and this draws the thing an eclipse would show.
    float ir = 1.0 / r;
    float r2 = ir * ir;
    float r7 = r2 * r2 * r2 * ir;
    // The 1e-6 is part of the formula, not a fudge: van de Hulst's coefficients
    // are quoted against 10^-6 of the mean solar disc brightness. Leaving it
    // out and letting uGain absorb it -- which is what the first version of
    // this shader did -- puts the r = 1.05 rim at 5.7e5 times the disc instead
    // of a bit over half of it, and the result is not a corona, it is a white
    // rectangle the size of the billboard with a faint star in the middle.
    // That capture is the reason this line carries a comment.
    float bK = 1e-6 * (0.0532 * pow(ir, 2.5) + 1.425 * r7 + 2.565 * r7 * r7 * ir * ir * ir);

    // ---- streamers -------------------------------------------------------
    // The corona is not spherical: closed field lines near the equator hold
    // plasma in helmet streamers, open polar field lines let it go. At minimum
    // the equatorial excess is roughly 2×, with structure on ~20° in position
    // angle.
    float ang = atan(vXY.y, vXY.x);
    float lat = abs(vXY.y) / max(length(vXY), 1e-4);
    float belt = mix(1.9, 0.55, smoothstep(0.35, 0.95, lat));
    float fil = 0.62 + 0.75 * fbm3(vec3(cos(ang) * 2.4, sin(ang) * 2.4, uSeed + uTime * 0.012));
    float b = bK * uGain * belt * fil;

    // Electron (Thomson) scattering is achromatic, so the corona wears the
    // star's own colour exactly — which is how the temperature stays legible
    // all the way out (the brief's "carried all the way out through the
    // corona"). Only the F-corona, which is dust, reddens, and that is the
    // ecliptic disc below.
    vec3 col = uChroma * b;
    col = mix(vec3(0.0), col, vec3(equal(col, col)));
    fragColor = vec4(clamp(col, 0.0, 8.0), 1.0);
  }
`;

function makeCorona(Teff, radiusDraw, seed, timeUniform) {
  const c = starChroma(Teff);
  const mat = new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    uniforms: {
      uChroma: { value: new THREE.Vector3(c[0], c[1], c[2]) },
      // The exposure a coronagraph applies, and the only free number in this
      // shader. 1.5e5 puts the r = 1.02 rim at about 0.47 of the disc's own
      // radiance, r = 1.5 at 0.016, r = 3 at 0.0006 — which prints as a bright
      // limb ring dissolving into structure that is gone by four radii. That is
      // an eclipse photograph. Anything larger is a sprite wearing a citation.
      uGain: { value: 1.5e5 * starExposure(Teff) },
      uTime: timeUniform,
      uSeed: { value: seed },
      uScale: { value: radiusDraw * CORONA_OUTER },
    },
    vertexShader: BILLBOARD_VERT,
    // `CORONA_OUTER` is interpolated into the source at definition time, above.
    // An earlier draft also ran a `.replace('${OUTER}', …)` here, which found
    // nothing and did nothing — the placeholder had already been substituted by
    // the template literal itself. Removed rather than left as a no-op: dead
    // string surgery on a shader is exactly the kind of thing that reads as
    // load-bearing during the next debugging session.
    fragmentShader: CORONA_FRAG,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  return mesh;
}

// ---------------------------------------------------------------------------
// the interplanetary dust cloud — the F-corona, continued outward
//
// The same population. Close to the star it is the F-corona; at 90° elongation
// it is the zodiacal light; and it is the reason the plane of a solar system is
// visible at all. Three measured facts carry the whole shader:
//
//   · number density falls as r^−1.3 (Leinert et al. 1998, from Helios)
//   · the cloud is a *fan*: thickness grows linearly with r, so a line of sight
//     in the plane crosses far more of it than one across the plane — which is
//     why it is a band and not a haze
//   · the grains scatter strongly forward, g ≈ 0.6, so the cloud brightens
//     toward the star and toward the far side of the disc
//
// Put together with the 1/r² irradiance, surface brightness goes as
// r^−1.3 · r^−2 · r = r^−2.3, which is the exponent the zodiacal light is
// actually observed to follow. Nothing here is tuned; the only free number is
// one overall gain.

const DUST_VERT = /* glsl */`
  out vec3 vW;
  out float vR;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    vR = length(position.xz);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const DUST_FRAG = /* glsl */`
  precision highp float;
  uniform vec3  uChroma;
  uniform vec3  uStar;
  uniform vec3  uCamPos;
  uniform float uGain;
  uniform float uRefDraw;    // draw units at the reference radius (1 AU)
  uniform float uSubDraw;    // sublimation radius, draw units — no dust inside
  uniform float uFlatDraw;   // where the power law turns over, ~6 r_sub
  uniform float uOuterDraw;
  uniform float uFlatAU;     // the turnover, in *true* AU
  uniform float uBandAU;     // asteroid-belt dust band centre, true AU; 0 = none
  uniform vec3  uEmber;      // the sublimation ring's own colour, ~1500 K
  uniform float uEmberGain;
  uniform float uSeed;
  in vec3 vW;
  in float vR;
  out vec4 fragColor;
  ${NOISE_GLSL}

  void main() {
    float r = max(vR, 1e-3);
    // the dust-free zone: grains sublimate where T > ~1500 K, which for a
    // Sun-like star is 0.03 AU and is a real, sharp inner edge
    // The inner fade runs all the way to the turnover radius rather than
    // stopping at 2.2 r_sub. It used to stop early, which left a constant-
    // brightness plateau between the end of the fade and the start of the
    // power law — a bright annulus with a dark hole punched in it, and in the
    // capture that read as two dark lobes flanking the star rather than as a
    // dust-free zone. One monotone fade from the sublimation radius to where
    // the cloud starts obeying its power law.
    float inner = smoothstep(uSubDraw, uFlatDraw, r);

    // …and the hole that fade leaves is wrong, because the dust-free zone is
    // not where the dust is dimmest — it is the edge of where the dust is
    // *hottest*. Grains just outside the sublimation radius sit at the
    // sublimation temperature itself, around 1500 K, and radiate: this is the
    // inner F-corona, and it is a real, observed, deep-orange ring.
    //
    // The previous commit made the inner fade monotone to stop it reading as
    // two dark lobes flanking the star. It still read as two dark lobes,
    // because a monotone fade to nothing is still nothing — the fade was never
    // the fault. What was missing is the emission that belongs there.
    //
    // Thermal, so it does not go through the phase function or the path length:
    // this is dust glowing, not dust scattering, and it is isotropic. Peaked at
    // the sublimation radius and falling with an e-folding of 1.8 r_sub, which
    // is the scale over which T drops from 1500 K to where σT⁴ stops mattering.
    float ember = exp(-max(r - uSubDraw, 0.0) / max(uSubDraw * 1.8, 1e-4))
                * smoothstep(uSubDraw * 0.62, uSubDraw, r);
    // A long outer fade, because a short one is a *rim*: at 0.72 the cloud was
    // still bright where it started fading, so the edge of the mesh drew a
    // horizon line across the frame and the plane read as a solid table.
    float outer = 1.0 - smoothstep(uOuterDraw * 0.30, uOuterDraw, r);
    // the ember lives where inner is zero by construction, so the early-out
    // has to ask about both or it discards the very thing it was added for
    if ((inner + ember) * outer < 1e-4) discard;

    // True AU, not draw units. drawR() compresses orbital radius by au^0.62
    // for the frame; reading that compressed number into a power law silently
    // changes the exponent, and this shader spent its whole first life claiming
    // r^-2.3 while computing r^-1.43. One pow() buys the exponent back and the
    // comments below become true. See auOf() in this file for the argument.
    float au = pow(max(r / uRefDraw, 1e-4), ${INV_R_EXP.toFixed(6)});
    // Two populations, because a real system has two.
    //
    //   the zodiacal cloud — n ∝ r^−1.3 (Leinert 1998), irradiance 1/r², fan
    //   thickness ∝ r, so surface brightness ∝ r^−2.3, which is the exponent
    //   the zodiacal light is observed to follow. Inside the sublimation zone
    //   the power law turns over rather than running away: there is no dust
    //   left there to be bright.
    //
    //   the debris disc — the collisional cascade off the belt and whatever
    //   Kuiper analogue this system has, spread far more evenly. This is the
    //   component that is actually *imaged* around other stars in scattered
    //   light, and it is what keeps the plane legible past a few AU instead of
    //   collapsing the whole cloud into a cusp at the star.
    float aus = max(au, uFlatAU);
    float col = pow(aus, -2.3) + 0.16 * pow(au, -0.9);

    // the IRAS dust bands: collisional debris from the asteroid families, a
    // real local enhancement at the belt's own radius. Its width is a fraction
    // of that radius, which is a statement about the belt and therefore has to
    // be made in AU rather than in compressed draw units.
    if (uBandAU > 0.0) {
      float d = (au - uBandAU) / (uBandAU * 0.22);
      col *= 1.0 + 0.85 * exp(-d * d);
    }

    // the fan seen edge-on: a sightline nearly in the plane crosses far more
    // dust than one looking down on it. This is why the zodiacal light is a
    // *band* rather than a haze, and why the plane of a system announces
    // itself the moment the camera drops toward it.
    vec3 V = normalize(uCamPos - vW);
    float path = 1.0 / (abs(V.y) + 0.055);

    // Henyey–Greenstein: interplanetary grains scatter forward. g = 0.35 is
    // inside the measured range for the zodiacal cloud and — unlike the 0.6 the
    // inner cloud prefers — keeps the forward lobe to about 4× the 90° value
    // instead of 25×, which is the difference between a bright far side and a
    // clipped one. Normalised at 90 degrees so uGain keeps one meaning here.
    vec3 L = normalize(vW - uStar);
    float ct = clamp(dot(L, V), -1.0, 1.0);
    const float g = 0.35, g2 = 0.1225;
    float hg = ((1.0 - g2) / pow(1.0 + g2 - 2.0 * g * ct, 1.5)) / 0.7379;

    // grains are a little redder than the light they scatter (Mie on ~10 µm
    // silicates), which is measured and is why the zodiacal light is warm
    vec3 tint = uChroma * vec3(1.06, 1.0, 0.90);

    float grain = 0.82 + 0.30 * fbm3(vec3(vW.xz * (0.9 / uRefDraw), uSeed));
    // grain is a texture on the frame, so it stays in draw units on purpose —
    // it is the one term here that is not a physical law
    // one stated ceiling on the geometry terms, so an edge-on sightline through
    // the forward lobe brightens the plane instead of clipping it
    float boost = min(path * hg, 9.0);
    float b = col * boost * grain * uGain * inner * outer;
    // scattered starlight plus the ring's own thermal emission. Two different
    // physical processes, added rather than blended, because that is what they
    // do — and the grain texture rides both so the ring is not a clean annulus.
    vec3 c = tint * b + uEmber * (ember * outer * grain * uEmberGain);
    c = mix(vec3(0.0), c, vec3(equal(c, c)));
    fragColor = vec4(clamp(c, 0.0, 4.0), 1.0);
  }
`;

/** a log-spaced annulus in the ecliptic — linear rings would spend their
 *  vertices where an r^−2.3 profile has nothing left to say */
function dustDiscGeometry(rIn, rOut, radial = 80, around = 200) {
  const pos = new Float32Array((radial + 1) * (around + 1) * 3);
  const idx = [];
  const lnIn = Math.log(rIn), lnOut = Math.log(rOut);
  let p = 0;
  for (let i = 0; i <= radial; i++) {
    const r = Math.exp(lnIn + (lnOut - lnIn) * (i / radial));
    for (let j = 0; j <= around; j++) {
      const th = (j / around) * Math.PI * 2;
      pos[p++] = r * Math.cos(th); pos[p++] = 0; pos[p++] = r * Math.sin(th);
    }
  }
  const row = around + 1;
  for (let i = 0; i < radial; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * row + j, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), rOut);
  return geo;
}

// ---------------------------------------------------------------------------
// the belt
//
// It was 3,200 grey icosahedra on a `MeshBasicMaterial`, which is to say it
// received no light information at all — §8 axis 2's exact failure. Rock is
// lit by the star it orbits: irradiance falls as 1/r², Lambert gives the
// terminator, and a rough regolith backscatters near opposition (the opposition
// surge is why a full moon is more than twice as bright as a half moon, and it
// is what makes a belt read as *rock* rather than as confetti).

const BELT_VERT = /* glsl */`
  out vec3 vN;
  out vec3 vW;
  out vec3 vTint;
  void main() {
    mat4 m = modelMatrix * instanceMatrix;
    vN = normalize(mat3(m) * normal);
    vec4 w = m * vec4(position, 1.0);
    vW = w.xyz;
    #ifdef USE_INSTANCING_COLOR
      vTint = instanceColor;
    #else
      vTint = vec3(1.0);
    #endif
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const BELT_FRAG = /* glsl */`
  precision highp float;
  uniform vec3  uChroma;
  uniform vec3  uStar;
  uniform vec3  uCamPos;
  uniform float uRefDraw;
  uniform float uGain;
  in vec3 vN;
  in vec3 vW;
  in vec3 vTint;
  out vec4 fragColor;

  void main() {
    vec3 d = vW - uStar;
    // true AU: the frame's radii are compressed by au^0.62 (see auOf()), and an
    // irradiance law handed a compressed radius falls off as r^-1.24. A belt at
    // 3 AU was therefore being lit as though it sat at 1.9.
    float au = max(pow(length(d) / uRefDraw, ${INV_R_EXP.toFixed(6)}), 0.02);
    vec3 L = -d / max(length(d), 1e-4);
    vec3 V = normalize(uCamPos - vW);
    vec3 n = normalize(vN);
    float ndl = max(dot(n, L), 0.0);
    // opposition surge: shadow hiding in a porous regolith, sharply peaked
    // within a few degrees of zero phase (Hapke)
    float phase = 1.0 + 0.9 * pow(max(dot(L, V), 0.0), 24.0);
    // §9.2's half-Lambert wrap is an atmosphere-scale rule and this is vacuum,
    // so the terminator stays hard — but airless rock is not black on its night
    // side either: it sees the rest of the belt. One faint achromatic fill,
    // which is the least §8 axis 2 will accept.
    float lit = ndl * phase + 0.035;
    vec3 c = vTint * uChroma * (uGain * lit / (au * au));
    c = mix(vec3(0.0), c, vec3(equal(c, c)));
    fragColor = vec4(clamp(c, 0.0, 6.0), 1.0);
  }
`;

// ------------------------------------------------------------- the scale ----

export class SystemScale {
  constructor(app, ctx) {
    this.app = app;
    this.kind = 'system';
    this.ctx = ctx;
    this.params = systemParams(ctx.starSeed);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 60000);

    this.days = 0;
    this.speedDays = 12;      // sim-days per real second
    this.playing = true;
    this.focusIndex = -1;     // -1 = star
    this.selection = null;

    this.uSunPos = { value: new THREE.Vector3(0, 0, 0) };
    this.uCamPos = { value: this.camera.position };
    this.uTime = { value: 0 };

    this._build();

    const far = this.params.planets.length
      ? drawR(this.params.planets[this.params.planets.length - 1].a) : AU_DRAW * 2;
    this.camera.position.set(far * 0.5, far * 0.42, far * 1.15);

    this.controls = new OrbitControls(this.camera, app.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.rotateSpeed = 0.55;
    // The dolly is taken off `OrbitControls` and implemented in `onWheel()`
    // below, for the reason written out at length in `cosmic.js`: `main.js` and
    // `touch.js` synthesise a pinch into `active().onWheel?.({ deltaY })`, a
    // plain object, and `OrbitControls` binds a real DOM `wheel` listener to
    // the canvas. The two never meet, so pinch-to-zoom did nothing at this
    // scale on any build — invisible on desktop because the wheel event is real
    // there, and the wheel is the only zoom a desktop test ever exercises.
    this.controls.enableZoom = false;
    this.controls.minDistance = 2.2;
    this.controls.maxDistance = far * 4 + 200;
    // exp(k · 100) = 0.95^−1.7, one notch is 9.25% — the same law and the same
    // feel `cosmic.js` and `galaxy.js` use, so the gesture means one thing at
    // every scale. The 2.9× on a coarse pointer is arithmetic, not taste:
    // `touch.js` scales finger travel by 3.2, so a full-screen pinch arrives as
    // |deltaY| ≈ 1,600, and a comfortable one-pinch traverse of this scale's
    // useful range wants about 4,600.
    this._zoomK = 8.845e-4
      * (window.matchMedia && matchMedia('(pointer: coarse)').matches ? 2.9 : 1);
    this._prevTarget = new THREE.Vector3();

    // The threshold used to be 0, which means every lit pixel blooms — and
    // `bloom.js`'s bright pass collapses to `w = 1` there, so the whole frame
    // was being blurred and added back to itself. In vacuum that is a pedestal
    // under a field §2.8 requires to reach zero, and it is half of why the old
    // star capture had 70.6% of the frame lit and 22% true black.
    //
    // 0.30 sits above the dust (which peaks near 0.1 at a normal viewing angle)
    // and below the photosphere (0.5 at the limb, 1.5 at disc centre), so what
    // glows is the star, and what the star glows *into* is a bounded 64-pixel
    // reach rather than the whole frame. §9.4 calls the halo around a light the
    // instrument's point spread function; this is the aperture setting.
    // Measured, twice. At threshold 0.3 / strength 0.45 the blurred copy still
    // landed +0.1 linear across the whole disc, and the limb — which is where
    // the temperature actually lives — printed at 4.4% saturation against the
    // 17.6% the limb-darkening law predicts for it. A bloom whose reach (~64
    // source pixels) is comparable to the disc it is blooming does not make a
    // halo, it makes a fill.
    //
    // 0.55 is above the limb (0.48 linear) and below disc centre (1.04), so
    // only the centre seeds the halo and the limb keeps its own colour.
    this.bloomSettings = { strength: 0.3, radius: 0.8, threshold: 0.55 };
    if (this.params.pulsar) this.noteOverride = PULSAR_NOTE;

    // arriving from another star: come in hot on the old flight vector,
    // still relativistic, and bleed the speed off inside the new system
    if (ctx.arrive) {
      this.rel.on = true;
      this.rel.beta = 0.62;
      this.rel.target = 0.04;
      this.rel.dir.fromArray(ctx.arrive.dir).normalize();
      this.camera.position.copy(this.rel.dir).multiplyScalar(-3600);
      this.camera.position.y += 300;
      this.camera.lookAt(this.camera.position.clone().add(this.rel.dir));
      this.controls.enabled = false;
    }
  }

  /** where this system sits inside its parent galaxy (for the true sky) */
  _galaxyView() {
    const g = this.app.stack.find(s => s.kind === 'galaxy');
    if (!g) return null;
    let pos = this.ctx.galaxyPos;
    if (!pos) {
      // deep link — seat the system somewhere plausible in the disk
      const gr = new RNG(hash(this.ctx.starSeed, 0x6a1a));
      const rad = g.params.radius * (0.2 + 0.65 * gr.next());
      const th = gr.float(0, Math.PI * 2);
      pos = new THREE.Vector3(rad * Math.cos(th), gr.gauss() * g.params.radius * 0.02, rad * Math.sin(th));
    }
    return { starData: g.starData, time: g.time, vrot: g.uniforms.uVrot.value, pos };
  }

  _build() {
    const P = this.params;
    const r = new RNG(hash(P.seed, 0xb01d));

    // -- sky: the actual galaxy, seen from this star's seat inside it
    const gview = this._galaxyView();
    if (gview) {
      const sky = makeGalaxySkyFromWithin(gview.starData, gview.time, gview.vrot, gview.pos, 17000);
      this.scene.add(sky);
      this.skyRel = sky.userData.rel;
      this.skyTargets = sky.userData.targets || [];
    } else {
      this.scene.add(makeSkyDome(P.seed, 18000));
    }
    // deep time: the star's whole life on a lever ([ and ])
    this.deep = {
      on: false,
      eligible: P.stage === 'main sequence' && !P.binary,
      x: 0.3,                                   // where "now" sits on the track
      tMS: 10 * Math.pow(P.mass, -2.5),         // main-sequence lifetime, Gyr
      massive: P.mass >= 8,
      snFired: false,
      flashT: -1,
    };
    // don't advertise the lever on stars that decline it (giants, binaries)
    this.hintOverride = () => 'click a world · land from its card · j to cruise (steer into a star to travel there)'
      + (this.deep.eligible ? ' · hold ] to age the star' : '') + ' · esc to ascend';

    // relativistic cruise state (J to engage)
    this.rel = { on: false, beta: 0, target: 0.5, gamma: 1, dir: new THREE.Vector3(0, 0, -1) };
    this._relKeys = new Set();
    this._relKd = (e) => this._relKeys.add(e.code);
    this._relKu = (e) => this._relKeys.delete(e.code);
    window.addEventListener('keydown', this._relKd);
    window.addEventListener('keyup', this._relKu);

    // -- star (or binary pair)
    //
    // What was here: a `SphereGeometry` wearing `makeStarSurfaceMaterial`, plus
    // an additively-blended soft-dot Sprite scaled to **ten times the star's
    // own draw radius** and tinted with `blackbodyRGB`. At `dR` up to 30 that
    // is a 300-unit disc of additive white over a 46-unit AU, which is why a
    // 5,682 K G-class star — a warm yellow-white object — filled two thirds of
    // the frame as flat, clipped **grey**. Additive blending saturates to
    // white, and a tint applied to something that saturates is a tint you have
    // thrown away. §8 axis 6 says nothing clips; axis 8 asks whether the pixels
    // contradict the physics the HUD asserts. Both failed, on the same sprite.
    //
    // The replacement is two objects and no sprite:
    //
    //   the photosphere — limb-darkened, granulated, and coloured through the
    //   *same* Planck → CIE → sRGB transfer §9.6 derives the sky stops from, so
    //   the temperature in the HUD and the colour on the screen come from one
    //   function rather than two;
    //
    //   the corona — van de Hulst's measured K-corona brightness, which falls
    //   as r^−2.5 + r^−7 + r^−17 and is genuinely gone by a few stellar radii.
    //
    // The wide halo that a photograph of a star actually shows is the
    // *instrument's* point spread function, not the corona, and AEON already
    // has one of those: `src/bloom.js`, bounded to about 64 source pixels on
    // purpose. So the glow is left to the bloom chain, where it is bounded,
    // rather than painted on at ten radii, where it was not.
    const mkStar = (temp, radiusSun) => {
      const color = blackbodyRGB(temp);
      const dR = Math.min(Math.max(5.5 * Math.pow(radiusSun, 0.5), 2.2), 30);
      const seed = r.float(0, 90);
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(dR, 64, 48),
        makePhotosphereMaterial(temp, seed, this.uCamPos, this.uTime));
      // A child, so a binary's second corona tracks its own component without a
      // second update path. Note it inherits the *position* only: the billboard
      // applies its scale in view space, so `uScale` has to be driven by hand
      // when the star's radius changes (see `_updateDeepTime`).
      const corona = makeCorona(temp, dR, seed, this.uTime);
      mesh.add(corona);
      this.scene.add(mesh);
      return { mesh, dR, color, corona };
    };
    this.primary = mkStar(P.temp, P.radiusSun);
    this.starMesh = this.primary.mesh;
    this.starCorona = this.primary.corona;
    this.starColor = this.primary.color;
    this.starDrawR = this.primary.dR;
    this.secondary = null;
    if (P.binary) {
      this.secondary = mkStar(P.binary.tempB, P.binary.radiusSunB);
      this.binEl = {
        a: P.binary.aBin, e: P.binary.eBin, inc: P.binary.inc,
        Omega: P.binary.Omega, omega: P.binary.omega, M0: P.binary.M0,
      };
    }

    // The pulsar's beams keep the soft dot: a neutron star *is* a point source
    // at any drawable scale, so a sprite is the honest primitive there — it was
    // only wrong as a stand-in for a resolved photosphere and its corona.
    if (P.stage === 'neutron star') this._buildPulsar(r, softDotTexture());

    // -- planets
    this.planetNodes = [];
    this.allMoons = [];
    for (const pp of P.planets) {
      const group = new THREE.Group();
      const geo = new THREE.SphereGeometry(pp.drawRadius, 72, 48);
      const mesh = new THREE.Mesh(geo, makeSurfaceMaterial(pp, this.uSunPos, this.uCamPos, this.uTime));
      mesh.rotation.z = pp.tilt;
      mesh.userData.planet = pp;
      group.add(mesh);

      let cloudMesh = null;
      if (pp.clouds > 0.05) {
        cloudMesh = new THREE.Mesh(
          new THREE.SphereGeometry(pp.drawRadius * 1.018, 64, 40),
          makeCloudMaterial(pp, this.uSunPos, this.uTime));
        group.add(cloudMesh);
      }
      const posUniform = { value: group.position };
      const atmoMesh = new THREE.Mesh(
        new THREE.SphereGeometry(pp.drawRadius * 1.07, 48, 32),
        makeAtmosphereMaterial(pp, this.uSunPos, this.uCamPos, posUniform));
      group.add(atmoMesh);
      if (pp.hasRings) {
        const ring = new THREE.Mesh(
          new THREE.RingGeometry(pp.drawRadius * 1.45, pp.drawRadius * 2.6, 128, 1),
          makeRingMaterial(pp, this.uSunPos, posUniform, pp.drawRadius * 1.45, pp.drawRadius * 2.6));
        ring.rotation.x = Math.PI / 2 + pp.tilt * 0.6;
        group.add(ring);
      }
      // moons — small worlds in their own right; every one is landable
      const moons = [];
      const mr = new RNG(hash(pp.seed, 0x30e));
      const icy = pp.a > P.frost;
      for (let m = 0; m < pp.moons; m++) {
        const md = pp.drawRadius * mr.float(2.2, 4.6) + m * pp.drawRadius * 0.9;
        const ms = Math.max(pp.drawRadius * mr.float(0.08, 0.2), 0.12);
        const noiseSeed = mr.float(0, 100);
        const moon = new THREE.Mesh(
          new THREE.SphereGeometry(ms, 20, 14),
          makeSurfaceMaterial({
            typeId: icy ? 3 : 0, noiseSeed, oceanLevel: -1, inhabited: false,
            colA: icy ? new THREE.Color(0.68, 0.74, 0.82) : new THREE.Color(0.38, 0.37, 0.36),
            colB: icy ? new THREE.Color(0.88, 0.92, 0.98) : new THREE.Color(0.55, 0.54, 0.52),
            colC: icy ? new THREE.Color(0.3, 0.45, 0.6) : new THREE.Color(0.25, 0.24, 0.23),
            iceCap: icy ? 0.0 : 2.0,
          }, this.uSunPos, this.uCamPos, this.uTime));
        moon.userData.dist = md;
        moon.userData.rate = 2 * Math.PI / (mr.float(4, 40));        // rad per sim-day
        moon.userData.phase = mr.float(0, Math.PI * 2);
        moon.userData.moonIndex = m;
        moon.userData.planet = pp;
        moon.userData.drawR = ms;
        moon.userData.noiseSeed = noiseSeed;
        moon.userData.icy = icy;
        group.add(moon);
        moons.push(moon);
        this.allMoons.push(moon);
      }
      this.scene.add(group);
      // deep time needs to remember each world as it is today
      const su = mesh.material.uniforms;
      this.planetNodes.push({
        pp, group, mesh, cloudMesh, moons,
        surfU: su,
        cloudU: cloudMesh ? cloudMesh.material.uniforms : null,
        atmoU: atmoMesh.material.uniforms,
        orig: {
          colA: pp.colA.clone(), colB: pp.colB.clone(), colC: pp.colC.clone(),
          ocean: su.uOcean.value, city: su.uCity.value, iceCap: su.uIceCap.value,
          clouds: cloudMesh ? cloudMesh.material.uniforms.uAmt.value : 0,
          atmo: pp.atmoColor.clone(),
          Teq0: pp.Teq,
          albedo: pp.type === 'ice' ? 0.55 : pp.type === 'ocean' ? 0.3 : 0.25,
        },
      });

      // orbit line in draw space
      const seg = 220, lp = new Float32Array(seg * 3);
      const tmp = new THREE.Vector3();
      for (let s = 0; s < seg; s++) {
        // sweep eccentric anomaly for an even line
        const E = (s / seg) * Math.PI * 2;
        const nu = 2 * Math.atan2(Math.sqrt(1 + pp.e) * Math.sin(E / 2), Math.sqrt(1 - pp.e) * Math.cos(E / 2));
        const rAU = pp.a * (1 - pp.e * Math.cos(E));
        const co = Math.cos(pp.omega + nu), so = Math.sin(pp.omega + nu);
        const cO = Math.cos(pp.Omega), sO = Math.sin(pp.Omega);
        const ci = Math.cos(pp.inc), si = Math.sin(pp.inc);
        tmp.set(cO * co - sO * so * ci, so * si, sO * co + cO * so * ci).multiplyScalar(drawR(rAU));
        lp[s * 3] = tmp.x; lp[s * 3 + 1] = tmp.y; lp[s * 3 + 2] = tmp.z;
      }
      const lgeo = new THREE.BufferGeometry();
      lgeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
      const line = new THREE.LineLoop(lgeo, new THREE.LineBasicMaterial({
        color: pp.inhabited ? 0x3a5a7a : 0x2a2f3a, transparent: true, opacity: 0.55,
      }));
      this.scene.add(line);
    }

    // -- asteroid belt
    if (P.belt) this._buildBelt(P.belt, r);
    if (P.comet) this._buildComet(P.comet, r);
    // -- and the dust the whole system is swimming in
    this._buildDust();
  }

  /**
   * The interplanetary dust cloud: the thing that makes a star system a *place*
   * rather than two spheres and an ellipse on black.
   *
   * It is one population and one shader, and it is the same population as the
   * corona above — F-corona near the star, zodiacal light at 1 AU, debris disc
   * further out. Every radius here is derived rather than chosen:
   *
   *   inner edge   grains sublimate at ~1,500 K, and T = 278·L^¼/√r gives
   *                r_sub = (278/1500)²·√L AU. A real, sharp, dust-free zone.
   *   band         the IRAS dust bands — collisional debris from the asteroid
   *                families, sitting at the belt's own radius.
   *   outer edge   past the last planet, where there is nothing left to grind.
   */
  _buildDust() {
    const P = this.params;
    const rSub = Math.max(0.0344 * Math.sqrt(Math.max(P.lum, 1e-4)), 0.004);
    const aMax = P.planets.length ? P.planets[P.planets.length - 1].a : 3;
    // 1.5 rather than 2.4 times the last orbit. The far sheet was still "lit"
    // by the gate's 0.02 cut while carrying only three or four levels of
    // spread between its channels — chromatic in ratio, achromatic in print —
    // so it was spending two thirds of the frame to say nothing, and taking
    // §2.8's true black with it.
    const rOut = aMax * 1.5;
    const geo = dustDiscGeometry(drawR(rSub), drawR(rOut));
    const c = starChroma(P.temp);
    this.dust = new THREE.Mesh(geo, new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uChroma: { value: new THREE.Vector3(c[0], c[1], c[2]) },
        uStar: this.uSunPos,
        uCamPos: this.uCamPos,
        // The cloud is lit by *this* star. Surface brightness carries the
        // irradiance, L/r², and until now it carried only the 1/r² — so an M
        // dwarf's plane was exactly as bright as a blue giant's, which is §8
        // axis 8 twice over (the HUD prints the luminosity right beside it).
        //
        // L spans five decades across the main sequence and a frame spans about
        // one, so L enters through the same kind of monotone compression
        // starExposure() uses on σT⁴, for the same stated reason: the ordering
        // is the physics and it is what has to survive to the pixels. Exponent
        // 1/3, clamped to a factor of ten, and calibrated so a G star's plane is
        // unchanged — this is a correction to the *other* stars, not a retune of
        // the one that was already photographed.
        uGain: { value: 0.0016 * Math.min(Math.max(Math.pow(Math.max(P.lum, 1e-4), 1 / 3), 0.34), 3.4) },
        uRefDraw: { value: AU_DRAW },
        uSubDraw: { value: drawR(rSub) },
        uFlatDraw: { value: drawR(rSub * 6) },
        uOuterDraw: { value: drawR(rOut) },
        // the fades above stay in draw units — they are the shape of the mesh,
        // and monotone either way. These two are physics, so they are AU.
        uFlatAU: { value: rSub * 6 },
        uBandAU: { value: P.belt ? P.belt.a : 0 },
        // The sublimation ring, ~1500 K — the temperature at which silicate
        // grains stop existing, so it is the same number that sets `rSub` and
        // not a colour anyone picked. It is deliberately *not* the star's
        // colour: this is the dust's own light, and a blue giant's inner ring
        // is the same orange as a red dwarf's because both are 1500 K grains.
        uEmber: { value: (() => {
          const c = blackbodyRGB(1500);
          return new THREE.Vector3(c.r, c.g, c.b);
        })() },
        // Scaled by the same compressed luminosity the scattered term uses, so
        // a brighter star drives a brighter ring without either one running away.
        //
        // 0.34 was two hundred times the scattered term's 0.0016, and the frame
        // said so: a 1500 K blackbody at that gain floods two thirds of the
        // system view with deep orange, which is a lifted vacuum black and
        // §2.8 does not allow one. Compare docs/screenshots/4-system.png, shot
        // before this term existed — the same system reads as a white star on
        // true black with a violet nebula lane behind it.
        //
        // The physics is not what was wrong. Grains just outside the
        // sublimation radius really do sit at 1500 K and really do radiate, and
        // the inner F-corona really is a deep-orange ring. A *ring* is the
        // point: this is the brightest few tenths of an AU of the cloud, not a
        // floor under the whole disc, and at 0.34 the ring's own falloff was
        // still leaving enough light at 30 AU to paint the frame.
        uEmberGain: { value: 0.018 * Math.min(Math.max(Math.pow(Math.max(P.lum, 1e-4), 1 / 3), 0.34), 3.4) },
        uSeed: { value: (hash(P.seed, 0xd057) >>> 8) / 65536 },
      },
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }));
    this.scene.add(this.dust);
  }

  /** lighthouse beams, wind glow, and the wreckage shell of the supernova */
  _buildPulsar(r, glowTex) {
    const P = this.params;
    // two opposed beams, misaligned from the spin axis — that's why it pulses
    const L = 150, baseR = 13;
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(0.55, 0.7, 1.0) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: `
        precision highp float; uniform vec3 uColor; varying vec2 vUv;
        void main(){ gl_FragColor = vec4(uColor * pow(vUv.y, 2.2) * 1.6, 1.0); }`,
      blending: THREE.AdditiveBlending, transparent: true,
      depthWrite: false, side: THREE.DoubleSide,
    });
    const cone = new THREE.ConeGeometry(baseR, L, 20, 1, true);
    cone.translate(0, -L / 2, 0); // apex at the star, base far away, uv.y=1 at apex
    this.pulsarBeams = new THREE.Group();
    const b1 = new THREE.Mesh(cone, beamMat);
    const b2 = new THREE.Mesh(cone, beamMat);
    b2.rotation.z = Math.PI;
    const tiltG = new THREE.Group();
    tiltG.rotation.z = r.float(0.35, 0.8); // magnetic misalignment
    tiltG.add(b1); tiltG.add(b2);
    this.pulsarBeams.add(tiltG);
    this.starMesh.add(this.pulsarBeams);
    this.pulsarOmega = 2 * Math.PI * r.float(0.7, 1.9); // visual sweep rate
    this.pulsarPhase = 0;

    this.pulsarFlash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTex, color: new THREE.Color(0.7, 0.85, 1.3),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.pulsarFlash.scale.setScalar(26);
    this.starMesh.add(this.pulsarFlash);

    // supernova remnant: a filamentary shell still sailing outward
    const shellR = this.params.planets.length
      ? drawR(this.params.planets[this.params.planets.length - 1].a) * 1.35
      : 160;
    const tex = nebulaTexture(hash(P.seed, 0x5497), 256);
    this.remnant = new THREE.Group();
    for (let i = 0; i < 30; i++) {
      const z = r.float(-1, 1), th = r.float(0, Math.PI * 2);
      const s = Math.sqrt(1 - z * z);
      const warm = r.chance(0.55);
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({
        map: tex,
        color: warm ? new THREE.Color(0.16, 0.045, 0.05) : new THREE.Color(0.04, 0.1, 0.11),
        blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
        rotation: r.float(0, Math.PI * 2),
      }));
      sp.position.set(s * Math.cos(th), z * 0.8, s * Math.sin(th)).multiplyScalar(shellR * r.float(0.9, 1.1));
      sp.scale.setScalar(shellR * r.float(0.35, 0.7));
      this.remnant.add(sp);
    }
    this.scene.add(this.remnant);
  }

  _buildBelt(belt, r) {
    const N = 3200;
    const geo = new THREE.IcosahedronGeometry(0.16, 0);
    const c = starChroma(this.params.temp);
    // Lit by the star it orbits, rather than by a flat `MeshBasicMaterial`
    // hex. One draw call either way; the difference is that §8 axis 2 —
    // "any surface receiving no light information at all?" — now has an answer.
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uChroma: { value: new THREE.Vector3(c[0], c[1], c[2]) },
        uStar: this.uSunPos,
        uCamPos: this.uCamPos,
        uRefDraw: { value: AU_DRAW },
        // one AU of irradiance is the unit; the 1/r² in the shader does the
        // rest, so a belt around a bright star is genuinely brighter.
        //
        // The constant moved 0.62 → 1.25 when that 1/r² stopped being 1/r^1.24
        // (see auOf()). A belt sits at 2–4 AU, where the compressed radius was
        // about 0.6 of the true one, so the old law was over-lighting it by
        // roughly 2× — the number changed to keep the photographed frame where
        // it was while the law underneath it became the one the comment claims.
        uGain: { value: 1.25 * Math.min(Math.max(this.params.lum, 0.05), 40) ** 0.35 },
      },
      vertexShader: BELT_VERT,
      fragmentShader: BELT_FRAG,
    });
    this.beltMesh = new THREE.InstancedMesh(geo, mat, N);
    this.beltMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beltData = [];
    for (let i = 0; i < N; i++) {
      const a = belt.a * (1 + r.gauss() * belt.width);
      this.beltData.push({
        a: Math.max(a, 0.1),
        phase: r.float(0, Math.PI * 2),
        n: (2 * Math.PI) / (Math.sqrt(a * a * a / this.params.massTotal) * 365.25), // rad/day
        y: r.gauss() * drawR(a) * 0.02,
        s: r.float(0.4, 1.7),
        rot: r.float(0, Math.PI * 2),
      });
    }
    this._dummy = new THREE.Object3D();
    this.scene.add(this.beltMesh);

    const colors = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const b = 0.35 + 0.3 * r.next();
      colors[i * 3] = b; colors[i * 3 + 1] = b * 0.95; colors[i * 3 + 2] = b * 0.88;
    }
    // per-instance color for variety
    this.beltMesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  }

  _buildComet(el, r) {
    this.cometEl = el;
    const tex = softDotTexture(64);
    this.cometHead = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, color: new THREE.Color(0.7, 0.85, 1.0),
      blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    this.cometHead.scale.setScalar(3);
    this.scene.add(this.cometHead);

    const N = 260;
    this.cometTail = new THREE.BufferGeometry();
    this.cometTailPos = new Float32Array(N * 3);
    this.cometTailT = new Float32Array(N);
    this.cometJit = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      this.cometTailT[i] = i / N;
      // gaussian-ish scatter so the tail is a plume, not rays
      this.cometJit[i * 3] = (r.next() + r.next() - 1);
      this.cometJit[i * 3 + 1] = (r.next() + r.next() - 1);
      this.cometJit[i * 3 + 2] = (r.next() + r.next() - 1);
    }
    this.cometTail.setAttribute('position', new THREE.BufferAttribute(this.cometTailPos, 3));
    const pts = new THREE.Points(this.cometTail, new THREE.PointsMaterial({
      color: new THREE.Color(0.4, 0.6, 0.9), size: 1.6, map: tex, transparent: true,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true, opacity: 0.7,
    }));
    this.scene.add(pts);
  }

  // ------------------------------------------------------------- loop ----
  update(dt) {
    // relativistic cruise: your second is γ of everyone else's
    if (this.rel.on) {
      if (this._relKeys.has('KeyW')) this.rel.target = Math.min(this.rel.target + dt * 0.35, 0.985);
      if (this._relKeys.has('KeyS')) this.rel.target = Math.max(this.rel.target - dt * 0.5, 0.02);
      this.rel.beta += (this.rel.target - this.rel.beta) * (1 - Math.exp(-1.6 * dt));
      this._trackDestination(dt);
      // arrival momentum spent — hand the helm back
      if (this.ctx.arrive && this.rel.beta < 0.09) {
        this.ctx.arrive = null;
        this.rel.on = false;
        this.rel.target = 0.5;
        this.controls.enabled = true;
        this.controls.target.copy(this.camera.position).addScaledVector(this.rel.dir, 150);
        this.app.hud.setHint('arrived · ' + this.params.name);
      }
    } else if (this.rel.beta > 0.001) {
      this.rel.beta *= Math.exp(-2.5 * dt);
    } else {
      this.rel.beta = 0;
    }
    this.rel.gamma = 1 / Math.sqrt(Math.max(1 - this.rel.beta * this.rel.beta, 1e-6));
    if (this.skyRel) {
      this.skyRel.uBeta.value = this.rel.beta;
      this.skyRel.uDir.value.copy(this.rel.dir);
    }
    if (this.rel.beta > 0.001) {
      const v = 60 + 2600 * this.rel.beta ** 3;
      this.camera.position.addScaledVector(this.rel.dir, v * dt);
      if (this.camera.position.length() > 13000) this.camera.position.setLength(13000);
      this.camera.lookAt(this.camera.position.clone().add(this.rel.dir));
    }

    this._updateDeepTime(dt);

    if (this.playing) this.days += dt * this.speedDays * this.rel.gamma;
    const tY = this.days / 365.25;
    this.uTime.value += dt;

    if (this.pulsarBeams) {
      this.pulsarPhase += dt * this.pulsarOmega;
      this.pulsarBeams.rotation.y = this.pulsarPhase;
      // the lighthouse flick as each beam sweeps past
      const f = Math.pow(Math.abs(Math.sin(this.pulsarPhase)), 14);
      this.pulsarFlash.material.opacity = 0.3 + 0.7 * f;
      this.remnant.rotation.y += dt * 0.004;
    }

    const v = new THREE.Vector3();

    // binary waltz: split the relative orbit by mass about the barycenter
    if (this.secondary) {
      const P = this.params;
      keplerPos(this.binEl, tY, P.massTotal, v);
      this.primary.mesh.position.copy(v).multiplyScalar(-P.binary.massB / P.massTotal);
      this.secondary.mesh.position.copy(v).multiplyScalar(P.mass / P.massTotal);
      this.uSunPos.value.copy(this.primary.mesh.position);
    }
    for (const node of this.planetNodes) {
      keplerPos(node.pp, tY, this.params.massTotal, v);
      node.group.position.copy(v);
      node.mesh.rotation.y += node.pp.spin * dt * this.speedDays * 0.35;
      if (node.cloudMesh) node.cloudMesh.rotation.y += node.pp.spin * dt * this.speedDays * 0.42;
      for (const moon of node.moons) {
        const th = moon.userData.phase + moon.userData.rate * this.days;
        moon.position.set(Math.cos(th) * moon.userData.dist, 0, Math.sin(th) * moon.userData.dist);
      }
    }

    if (this.beltMesh) {
      const d = this._dummy;
      for (let i = 0; i < this.beltData.length; i++) {
        const b = this.beltData[i];
        const th = b.phase + b.n * this.days;
        const rd = drawR(b.a);
        d.position.set(Math.cos(th) * rd, b.y, Math.sin(th) * rd);
        d.rotation.set(b.rot + this.days * 0.01, th, 0);
        d.scale.setScalar(b.s);
        d.updateMatrix();
        this.beltMesh.setMatrixAt(i, d.matrix);
      }
      this.beltMesh.instanceMatrix.needsUpdate = true;
    }

    if (this.cometEl) {
      keplerPos(this.cometEl, tY, this.params.massTotal, v);
      this.cometHead.position.copy(v);
      const rAU = v.rAU;
      this.cometR = rAU;
      const activity = Math.min(6 / (rAU * rAU), 1);
      this.cometHead.material.opacity = 0.25 + 0.75 * activity;
      const away = v.clone().normalize();
      const N = this.cometTailT.length;
      const len = 10 + 60 * activity;
      const drift = (this.days * 0.05) % 1;
      for (let i = 0; i < N; i++) {
        const f = (this.cometTailT[i] + drift) % 1;
        const spread = f * len * 0.13;
        this.cometTailPos[i * 3] = v.x + away.x * f * len + this.cometJit[i * 3] * spread;
        this.cometTailPos[i * 3 + 1] = v.y + away.y * f * len + this.cometJit[i * 3 + 1] * spread;
        this.cometTailPos[i * 3 + 2] = v.z + away.z * f * len + this.cometJit[i * 3 + 2] * spread;
      }
      this.cometTail.attributes.position.needsUpdate = true;
    }

    // follow focused planet
    if (this.focusIndex >= 0) {
      const p = this.planetNodes[this.focusIndex].group.position;
      const delta = v.copy(p).sub(this._prevTarget);
      this.camera.position.add(delta);
      this.controls.target.copy(p);
      this._prevTarget.copy(p);
    }
    this.controls.update();
  }

  // ------------------------------------------------------------- time ----
  togglePlay() { this.playing = !this.playing; }
  speedUp() { this.speedDays = Math.min(this.speedDays * 1.8, 4000); }
  slowDown() { this.speedDays = Math.max(this.speedDays / 1.8, 0.2); }
  timeReadout() {
    if (this.deep.on) {
      const tau = this.deep.x * this.deep.tMS;
      return `τ ${tau >= 10 ? tau.toFixed(1) : tau.toFixed(2)} Gyr · ${this.deep.phase}`;
    }
    if (this.rel.beta > 0.01) {
      if (this.rel.lock) return `→ ${this.rel.lockName} · ${Math.max(this.rel.dist, 0).toFixed(2)} ly`;
      return `β ${this.rel.beta.toFixed(2)} · γ ${this.rel.gamma.toFixed(2)}`;
    }
    const y = this.days / 365.25;
    const t = y >= 1 ? y.toFixed(2) + ' yr' : this.days.toFixed(0) + ' d';
    return `T+${t} · ${this.speedDays.toFixed(0)} d/s`;
  }

  hudStats() {
    const P = this.params;
    if (this.deep.on) {
      const st = this._stellarState(this.deep.x);
      return [
        ['system', P.name],
        ['stellar age', (this.deep.x * this.deep.tMS).toPrecision(3) + ' Gyr'],
        ['phase', st.phase],
        ['luminosity', st.L >= 100 ? st.L.toFixed(0) + ' L☉' : st.L.toFixed(3) + ' L☉'],
        ['radius', st.R >= 1 ? st.R.toFixed(1) + ' R☉' : st.R.toFixed(3) + ' R☉'],
        ['surface', Math.round(st.T).toLocaleString() + ' K'],
      ];
    }
    if (this.rel.on) {
      const rows = [
        ['system', P.name],
        ['velocity', 'β = ' + this.rel.beta.toFixed(3) + ' c'],
        ['lorentz factor', 'γ = ' + this.rel.gamma.toFixed(2)],
        ['time dilation', '1 s aboard = ' + this.rel.gamma.toFixed(2) + ' s here'],
      ];
      if (this.ctx.arrive) {
        rows.push(['destination', P.name + ' · decelerating']);
      } else if (this.rel.lock) {
        const Tlock = 1500 * Math.pow(20, this.rel.lock.temp);
        rows.push(['destination', `${this.rel.lockName} · ${spectralClass(Tlock)}-class`]);
        rows.push(['distance', Math.max(this.rel.dist, 0).toFixed(2) + ' ly']);
      } else {
        rows.push(['destination', 'steer toward a star to lock']);
      }
      return rows;
    }
    return [
      ['system', P.name],
      ['star', P.pulsar
        ? `pulsar · P = ${P.pulsar.periodMs < 40 ? P.pulsar.periodMs.toFixed(1) : Math.round(P.pulsar.periodMs)} ms`
        : P.binary
          ? `${P.spectral}+${P.binary.spectralB} close binary`
          : `${P.spectral}-class ${P.stage}`],
      ['mass', P.binary
        ? `${P.mass.toFixed(2)} + ${P.binary.massB.toFixed(2)} M☉`
        : P.mass.toFixed(2) + ' M☉'],
      ['temperature', Math.round(P.temp).toLocaleString() + ' K'],
      ['luminosity', P.lum >= 100 ? P.lum.toFixed(0) + ' L☉' : P.lum.toFixed(2) + ' L☉'],
      ['worlds', String(P.planets.length) + (P.belt ? ' + belt' : '')],
    ];
  }

  // ------------------------------------------------------------ input ----
  // steer the flight vector while cruising (controls are off in cruise)
  onPointerDown(e) { if (this.rel.on) this._steer = { x: e.clientX, y: e.clientY }; }
  onPointerUp() { this._steer = null; }
  onPointerMove(e) {
    if (!this.rel.on || !this._steer) return;
    const dx = (e.clientX - this._steer.x) * 0.0022;
    const dy = (e.clientY - this._steer.y) * 0.0022;
    this._steer = { x: e.clientX, y: e.clientY };
    const up = new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(this.rel.dir, up).normalize();
    this.rel.dir.addScaledVector(right, -dx).addScaledVector(up, -dy).normalize();
  }

  /**
   * The dolly, geometric, about whatever the camera is looking at — so it works
   * from a pinch as well as a wheel (see the note beside `enableZoom` above).
   *
   * Geometric because the range is: from 2.2 units, which is inside a planet's
   * own orbit, out past the last world, and a linear step cannot serve both
   * ends. Cruise mode owns the camera outright, so the gesture stands down
   * there rather than fighting the flight vector.
   */
  onWheel(e) {
    if (this.rel.on) return false;
    const dy = Number(e?.deltaY) || 0;
    if (!dy) return true;
    // DOM_DELTA_LINE reports notches rather than pixels; one line is about 16
    const k = this._zoomK * (e.deltaMode === 1 ? 16 : 1);
    const t = this.controls.target;
    const d = this.camera.position.clone().sub(t);
    const len = Math.min(Math.max(d.length() * Math.exp(k * dy),
      this.controls.minDistance), this.controls.maxDistance);
    this.camera.position.copy(t).addScaledVector(d.normalize(), len);
    // a glide in flight would fight the dolly and win, so the gesture cancels it
    this._glideTo = null;
    return true;
  }

  pick(raycaster) {
    const meshes = this.planetNodes.map(n => n.mesh).concat(this.allMoons);
    const hits = raycaster.intersectObjects(meshes, false);
    if (hits.length) {
      const obj = hits[0].object;
      if (obj.userData.moonIndex !== undefined) {
        return { type: 'moon', moon: obj, planet: obj.userData.planet };
      }
      const pp = obj.userData.planet;
      return { type: 'planet', planet: pp, index: pp.index };
    }
    const starMeshes = this.secondary
      ? [this.starMesh, this.secondary.mesh] : [this.starMesh];
    const sHit = raycaster.intersectObjects(starMeshes, false);
    if (sHit.length) return { type: 'sun' };
    return null;
  }

  /** promote a moon mesh to a full landable-world description */
  moonAsWorld(moon) {
    const pp = moon.userData.planet;
    const m = moon.userData.moonIndex;
    const icy = moon.userData.icy;
    const ratio = moon.userData.drawR / Math.max(pp.drawRadius, 0.001);
    const radiusE = Math.max(pp.radiusE * ratio, 0.06);
    const massE = Math.pow(radiusE, 3) * (icy ? 0.55 : 0.72); // ice vs rock density
    return {
      name: pp.name + ' ' + String.fromCharCode(97 + m),
      type: icy ? 'ice moon' : 'moon',
      typeId: icy ? 3 : 0,
      inhabited: false,
      a: pp.a,
      massE, radiusE,
      drawRadius: moon.userData.drawR,
      Teq: pp.Teq,
      noiseSeed: moon.userData.noiseSeed,
      seed: hash(pp.seed, 0x300e, m),
      periodDays: (2 * Math.PI) / moon.userData.rate,
      colA: icy ? new THREE.Color(0.68, 0.74, 0.82) : new THREE.Color(0.4, 0.39, 0.37),
      colB: icy ? new THREE.Color(0.88, 0.92, 0.98) : new THREE.Color(0.58, 0.56, 0.53),
      colC: icy ? new THREE.Color(0.3, 0.45, 0.6) : new THREE.Color(0.27, 0.25, 0.24),
      atmoColor: new THREE.Color(0.05, 0.05, 0.07),
      iceCap: icy ? 0.0 : 2.0,
      oceanLevel: -1,
      clouds: 0,
      moons: 0,
      hasRings: false,
      parent: pp,
    };
  }

  focusPlanet(index) {
    this.focusIndex = index;
    if (index < 0) {
      this.controls.target.set(0, 0, 0);
      this._prevTarget.set(0, 0, 0);
      return;
    }
    const node = this.planetNodes[index];
    const p = node.group.position;
    this._prevTarget.copy(p);
    this.controls.target.copy(p);
    // glide the camera to a close orbit
    const dir = this.camera.position.clone().sub(p).normalize();
    const dist = node.pp.drawRadius * 4.2;
    this._glideTo = p.clone().addScaledVector(dir, dist);
    this._glideT = 0;
  }

  glide(dt) {
    if (this._glideTo == null) return;
    this._glideT += dt;
    const k = 1 - Math.exp(-3.2 * dt);
    this.camera.position.lerp(this._glideTo, k);
    if (this.focusIndex >= 0) {
      const p = this.planetNodes[this.focusIndex].group.position;
      const dir = this.camera.position.clone().sub(p).normalize();
      this._glideTo.copy(p).addScaledVector(dir, this.planetNodes[this.focusIndex].pp.drawRadius * 4.2);
    }
    if (this._glideT > 2.4) this._glideTo = null;
  }

  // ------------------------------------------------------- deep time ----
  /** MS luminosity slowly climbs as hydrogen thins in the core */
  _msBrighten(x) { return 1 + 0.4 * x + 1.1 * Math.pow(x, 6); }

  /**
   * The star's state as a pure function of track position x = τ/t_MS.
   * Scaling-relation stellar evolution: honest shapes, compressed drama.
   */
  _stellarState(x) {
    const P = this.params;
    const L0 = P.lum, T0 = P.temp, x0 = 0.3;
    const norm = this._msBrighten(x0);
    const sb = (L, T) => Math.sqrt(Math.max(L, 1e-6)) * Math.pow(5772 / T, 2); // R☉ from Stefan–Boltzmann

    if (x < 1) {
      const L = L0 * this._msBrighten(x) / norm;
      const T = T0 * (1 + 0.08 * (x - x0));
      return { phase: 'main sequence', L, T, R: sb(L, T) };
    }
    if (this.deep.massive) {
      // core collapse: what remains is the pulsar
      return { phase: 'neutron star', L: 0.25, T: 33000, R: 0.02 };
    }
    const Lend = L0 * this._msBrighten(1) / norm;
    const Tend = T0 * (1 + 0.08 * (1 - x0));
    if (x < 1.12) {
      // the red-giant ascent
      const y = (x - 1) / 0.12;
      const Lgoal = 2500 * P.mass;
      const L = Lend * Math.pow(Lgoal / Lend, y);
      const T = Tend + (3350 - Tend) * Math.min(y * 1.6, 1);
      return { phase: 'red giant', L, T, R: sb(L, T) };
    }
    if (x < 1.16) {
      // envelope ejection: the core lays itself bare
      const y = (x - 1.12) / 0.04;
      const L = 2500 * P.mass * (1 - 0.9 * y);
      const T = 3350 + (70000 - 3350) * y;
      return { phase: 'planetary nebula', L, T, R: sb(L, T), pn: y };
    }
    // white dwarf, cooling forever
    const tau = (x - 1.16) * this.deep.tMS;
    const T = 70000 * Math.pow(1 + tau * 40, -0.35);
    const R = 0.0125;
    const L = R * R * Math.pow(T / 5772, 4);
    return { phase: 'white dwarf', L, T, R };
  }

  _starDrawROf(Rsun) {
    return Math.min(Math.max(5.5 * Math.pow(Math.max(Rsun, 1e-4), 0.5), 1.5), 170);
  }

  _engageDeep() {
    if (this.deep.on) return;
    this.deep.on = true;
    // the habitable zone, made visible so you can watch it migrate
    this.hzRing = new THREE.Mesh(
      new THREE.RingGeometry(1, Math.pow(1.4 / 0.75, 0.62), 96, 1),
      new THREE.MeshBasicMaterial({
        color: 0x1d5c36, transparent: true, opacity: 0.055,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide, depthWrite: false,
      }));
    this.hzRing.rotation.x = Math.PI / 2;
    this.scene.add(this.hzRing);
    this.app.hud.setHint('deep time · hold ] to age the star, [ to rewind');
    this.app.hud.setNote(DEEPTIME_NOTE);
  }

  _updateDeepTime(dt) {
    const D = this.deep;
    if (!D.eligible) return;
    const fwd = this._relKeys.has('BracketRight');
    const back = this._relKeys.has('BracketLeft');
    if (fwd || back) {
      this._engageDeep();
      D.x = Math.min(Math.max(D.x + (fwd ? 1 : -1) * dt * 0.11, 0), 3.5);
    }
    if (!D.on) return;

    const st = this._stellarState(D.x);
    D.phase = st.phase;
    D.L = st.L;

    // -- the star itself
    //
    // The lever moves T_eff over more than a decade — 3,350 K on the red-giant
    // ascent, 70,000 K at envelope ejection — so everything the photosphere is
    // made of has to move with it: the chromaticity ramp, the Stefan–Boltzmann
    // exposure, the spot coverage, and the corona's radius and colour.
    //
    // The ramp is the expensive one. Rebuilding it is twelve CIE integrals over
    // 201 wavelengths, which is nothing once and about 2 ms per frame if it is
    // done every frame while the key is held. It is only *visibly* wrong once
    // the temperature has moved a percent or so, so it is rebuilt on that
    // threshold rather than on the clock — the same "set once, not per frame"
    // discipline §11 asks for, applied to a CPU cost instead of a GPU one.
    // ---- what the star has actually swallowed ---------------------------
    //
    // Decided in **AU**, once, before anything is drawn: a world is engulfed
    // when the photosphere reaches its perihelion. `st.R` is in solar radii and
    // `pp.a·(1−e)` is in AU, so R_SUN_AU is the whole conversion.
    //
    // It used to be `dRdraw · 0.98 > drawR(perihelion)`, comparing a stellar
    // radius compressed by √R against an orbital radius compressed by au^0.62.
    // Those are different functions, so the crossing point was arbitrary: a
    // 148 R☉ giant — 0.69 AU, enough to take Mercury and threaten Venus, which
    // is the fate DEEPTIME_NOTE describes out loud — was swallowing everything
    // inside about 1.6 AU. Earth went, and the note said it would not.
    const rStarAU = st.R * R_SUN_AU;
    let nearestSurvivorAU = Infinity;
    for (const node of this.planetNodes) {
      const peri = node.pp.a * (1 - node.pp.e);
      if (rStarAU < peri) nearestSurvivorAU = Math.min(nearestSurvivorAU, peri);
    }

    // The frame then has to agree with that ruling, and it does not get there
    // for free: the star is drawn oversize on purpose (see `_starDrawROf`), so
    // a disc big enough to *look* like a red giant can cover an orbit it has
    // not reached. The magnification is therefore capped by the innermost world
    // still alive — the star may grow until it touches that orbit and no
    // further, so "the disc has swallowed it" on screen and "the photosphere
    // has reached it" in AU are the same event.
    let dR = this._starDrawROf(st.R);
    if (nearestSurvivorAU < Infinity) dR = Math.min(dR, drawR(nearestSurvivorAU) * 0.94);
    this.starMesh.scale.setScalar(dR / this.starDrawR);
    const su = this.starMesh.material.uniforms;
    if (!(Math.abs(st.T - (this._rampT ?? 0)) < this._rampT * 0.01)) {
      this._rampT = st.T;
      su.uRamp.value = chromaRamp(st.T);
      const c = starChroma(st.T);
      this.starCorona.material.uniforms.uChroma.value.set(c[0], c[1], c[2]);
    }
    const expo = starExposure(st.T);
    su.uExposure.value = expo;
    su.uSpots.value = Math.min(Math.max((6200 - st.T) / 2600, 0), 1) ** 1.4 * 0.85;

    // The corona is a child of the star mesh, so it *follows* the star — but
    // `BILLBOARD_VERT` applies `uScale` in view space, after the model-view
    // transform has been collapsed onto the origin, so the parent's scale never
    // reaches it. A red giant's corona has to be told to grow.
    const cu = this.starCorona.material.uniforms;
    cu.uScale.value = dR * CORONA_OUTER;
    cu.uGain.value = 1.5e5 * expo;

    // A bigger disc covers more of the frame. The radiance itself no longer
    // needs easing — Stefan–Boltzmann already puts a 3,350 K giant at 11% of a
    // G star's surface brightness, which is the honest reason a red giant is
    // not a blowout — but the *bloom* still reads area, so a star that fills the
    // frame gets less of it.
    const cover = Math.min(dR / 40, 1);
    this.bloomSettings.strength = 0.3 - 0.15 * cover;
    if (this.app.active() === this) this.app.post.tune(this.bloomSettings);

    // -- supernova: one violent frame at the crossing
    if (D.massive && D.x >= 1 && !D.snFired) {
      D.snFired = true;
      D.flashT = 0;
      if (!this.pulsarBeams) this._buildPulsar(new RNG(hash(this.params.seed, 0xdee9)), softDotTexture());
    }
    if (D.massive && D.x < 1 && D.snFired) {
      D.snFired = false; // the lever forgives
    }
    const showCorpse = D.massive && D.x >= 1;
    if (this.pulsarBeams && D.eligible) {
      this.pulsarBeams.visible = showCorpse;
      this.pulsarFlash.visible = showCorpse;
      this.remnant.visible = showCorpse;
      // beams live under the (rescaled) star mesh — keep their world size
      const inv = this.starDrawR / dR;
      this.pulsarBeams.scale.setScalar(inv);
      this.pulsarFlash.scale.setScalar(26 * inv);
    }
    if (D.flashT >= 0) {
      D.flashT += dt;
      if (!this.snFlash) {
        this.snFlash = new THREE.Sprite(new THREE.SpriteMaterial({
          map: softDotTexture(), color: new THREE.Color(2.5, 2.4, 2.2),
          blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
        }));
        this.scene.add(this.snFlash);
      }
      const f = D.flashT / 2.6;
      this.snFlash.visible = f < 1 && showCorpse;
      this.snFlash.scale.setScalar(30 + 900 * f);
      this.snFlash.material.opacity = Math.max(1 - f, 0) ** 1.4;
      if (f >= 1) D.flashT = -1;
    }

    // -- the shed envelope of a dying sunlike star
    if (!D.massive) {
      const pnVis = D.x >= 1.12;
      if (pnVis && !this.pnShell) {
        const r = new RNG(hash(this.params.seed, 0x9e11));
        const tex = nebulaTexture(hash(this.params.seed, 7), 256);
        this.pnShell = new THREE.Group();
        for (let i = 0; i < 22; i++) {
          const z = r.float(-1, 1), th = r.float(0, Math.PI * 2);
          const s = Math.sqrt(1 - z * z);
          const sp = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex,
            color: r.chance(0.5) ? new THREE.Color(0.05, 0.14, 0.12) : new THREE.Color(0.13, 0.05, 0.1),
            blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
            rotation: r.float(0, 6.28),
          }));
          sp.position.set(s * Math.cos(th), z * 0.75, s * Math.sin(th));
          sp.scale.setScalar(r.float(0.35, 0.6));
          this.pnShell.add(sp);
        }
        this.scene.add(this.pnShell);
      }
      if (this.pnShell) {
        this.pnShell.visible = pnVis;
        if (pnVis) {
          const grow = Math.min((D.x - 1.12) / 0.1, 1.6);
          this.pnShell.scale.setScalar(30 + 190 * grow);
          this.pnShell.rotation.y += dt * 0.01;
        }
      }
    }

    // -- the habitable zone migrates with the luminosity
    this.hzRing.visible = st.L > 1e-3;
    this.hzRing.scale.setScalar(drawR(0.75 * Math.sqrt(st.L)));

    // -- and every world answers to it
    const sm = (a, b, v) => Math.min(Math.max((v - a) / (b - a), 0), 1);
    for (const node of this.planetNodes) {
      const o = node.orig, pp = node.pp;
      const Teq = 278 * Math.pow(Math.max(st.L, 1e-6), 0.25) / Math.sqrt(pp.a) * Math.pow(1 - o.albedo, 0.25);
      pp.Teq = Math.round(Teq);
      const scorch = Math.max(sm(330, 560, Teq) - sm(330, 560, o.Teq0), 0);
      const freeze = Math.max(sm(200, 110, Teq) - sm(200, 110, o.Teq0), 0);
      const melt = pp.typeId === 3 ? Math.max(sm(235, 290, Teq) - sm(235, 290, o.Teq0), 0) : 0;

      pp.colA.copy(o.colA).lerp(SCORCH_TINT, scorch).lerp(FREEZE_TINT, freeze);
      pp.colB.copy(o.colB).lerp(SCORCH_TINT, scorch * 0.7).lerp(FREEZE_TINT, freeze);
      pp.colC.copy(o.colC).lerp(SCORCH_TINT, scorch)
        .lerp(MELT_SEA, melt * 0.8).lerp(FREEZE_TINT, freeze);
      if (node.surfU.uOcean) node.surfU.uOcean.value = o.ocean - scorch * 0.9;
      node.surfU.uIceCap.value = o.iceCap * (1 - melt) + melt * 0.78
        - freeze * (o.iceCap * (1 - melt) + melt * 0.78);
      node.surfU.uCity.value = o.city * (1 - sm(0.12, 0.5, scorch)) * (1 - sm(0.25, 0.65, freeze));
      if (node.cloudU) node.cloudU.uAmt.value = o.clouds * (1 - scorch) * (1 - freeze * 0.85);
      pp.atmoColor.copy(o.atmo).multiplyScalar((1 - scorch * 0.8) * (1 - freeze * 0.6));

      // the giant star swallows its innermost children — in AU, decided above
      node.group.visible = !(rStarAU >= pp.a * (1 - pp.e));
    }
  }

  /** lock the star nearest the flight vector; close the distance to it */
  _trackDestination(dt) {
    if (!this.skyTargets || !this.skyTargets.length || this._arriving) return;
    if (this.ctx.arrive) return; // still decelerating into this system
    const d = this.rel.dir;
    let best = null, bestDot = 0.9; // must be within ~25° of the bow
    for (const t of this.skyTargets) {
      const dot = t.dir.dot(d);
      if (dot > bestDot) { bestDot = dot; best = t; }
    }
    if (best !== this.rel.lock) {
      this.rel.lock = best;
      this.rel.dist = best ? 4.2 : 0;             // light-years to a neighbor
      this.rel.lockName = best ? starName(best.seed) : '';
    }
    if (best && this.rel.beta > 0.55) {
      // faster & better-aimed → closing quicker
      this.rel.dist -= dt * (this.rel.beta - 0.5) * 3.4 * (bestDot - 0.9) / 0.1;
      if (this.rel.dist <= 0) this._arrive(best);
    }
  }

  _arrive(target) {
    if (this._arriving) return;
    this._arriving = true;
    this.rel.target = 0.985;                       // one last surge, then a veil
    this.app.arriveAtStar(this, target.seed);
  }

  toggleRel() {
    if (!this.skyRel) return;
    this.rel.on = !this.rel.on;
    if (this.rel.on) {
      this.focusPlanet(-1);
      this.camera.getWorldDirection(this.rel.dir);
      this.rel.target = Math.max(this.rel.target, 0.5);
      this.controls.enabled = false;
      this.app.hud.setHint('relativistic cruise · w faster, s slower · j to disengage');
    } else {
      this.controls.enabled = true;
      this.controls.target.copy(this.camera.position).addScaledVector(this.rel.dir, 120);
      this.app.hud.setHint('');
    }
  }

  onKey(code) {
    if (code === 'KeyJ') { this.toggleRel(); return true; }
    return false;
  }
  enter() {}
  exit() { this.controls.enabled = false; }
  resume() { if (!this.rel.on) this.controls.enabled = true; }

  dispose() {
    this.controls.dispose();
    window.removeEventListener('keydown', this._relKd);
    window.removeEventListener('keyup', this._relKu);
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
    });
  }
}

export const DEEPTIME_NOTE = `You are holding the star's whole life. The track is real scaling physics: main-sequence lifetime <em>t = 10·M<sup>−2.5</sup> Gyr</em>, the slow brightening that will end Earth's oceans long before our own sun dies, the red-giant ascent with radius from the Stefan–Boltzmann law — watch it swallow the inner worlds, as ours will swallow Mercury. The green band is the habitable zone migrating outward: frozen moons thaw into late oceans even as the old garden worlds scorch and their city lights go out. Sunlike stars shed a planetary nebula and cool forever as white dwarfs; stars past 8 M☉ go by supernova, and what's left is the pulsar. Slide it back — the lever forgives, though the universe would not.`;

export const PULSAR_NOTE = `This star died in a supernova; you are inside the wreckage. What remains is a <em>neutron star</em> — a couple of solar masses squeezed into a city, spinning with lighthouse beams thrown off its magnetic poles, which is why it pulses. The filament shell around you is the explosion, still coasting outward millennia later. Planets here are second-generation worlds: the very first exoplanets ever discovered (PSR B1257+12, 1992) orbit exactly such a corpse. The period in the readout is honest millisecond-pulsar territory; the beams are slowed a millionfold so your eyes can follow them.`;

export const SYSTEM_NOTE = `Every orbit here is honest mechanics: periods follow Kepler's third law (<em>P² = a³/M★</em>) and positions come from solving Kepler's equation <em>M = E − e·sin E</em> by Newton's method each frame. The star's color is its blackbody spectrum; its temperature and luminosity follow main-sequence scaling from the mass this seed drew. Radial distances are gently compressed for visibility — the numbers in the cards are the true ones. Click a world to read it; click again to enter orbit. And press <em>J</em>: the ship runs relativistic, and the galactic sky obeys special relativity star by star — exact aberration crowds the stars ahead, the Doppler factor walks each one along the blackbody ramp (blue ahead, ember behind), intensity beams as δ³, and the system's clocks visibly outrun yours by γ. Every formula is the real one.`;
