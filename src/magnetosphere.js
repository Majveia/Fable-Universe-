// The magnetosphere, and the light it makes — CLAUDE.md §M1's principle,
// applied to a night sky.
//
// `src/aurora.js` already draws an aurora from orbit: two nested shells over
// each pole, an emerald base and a violet crown, banded at ±72°. This file is
// not a replacement for it — it is the *physics underneath* it, which that
// file had to guess at because nothing computed it. §5 below wires the two
// together, so the ring seen from space and the curtain seen from the ground
// are the same oval at the same latitude in the same colours (§2.5).
//
// §M1 asks the cosmic web to be coloured by "local density × velocity
// divergence — infall cool, outflow warm — so palette is a readout of real
// dynamics." Nothing on a *world* does that. The night sky has stars, a moon,
// sometimes a comet, and all of them are scenery.
//
// An aurora is the one atmospheric phenomenon that is a readout. Where it sits
// in the sky is the size of the planet's magnetosphere; what colour it is, is
// what the air is made of and how hard it is being hit. Both are numbers this
// project already has, and neither has ever been on screen.
//
// So: no artistic auroral palette, and no hand-placed ring. The oval's latitude
// falls out of the magnetopause standoff distance, the colours fall out of
// atomic emission lines through a wavelength-to-sRGB transfer, and the altitude
// each colour appears at falls out of the *lifetime* of the excited state that
// emits it. Every one of those is a real formula and the frame is what it says.
//
// ---------------------------------------------------------------------------
// 1 · Where the oval is
//
// The solar wind compresses the planet's dipole until magnetic pressure
// balances the wind's ram pressure. That balance is the magnetopause standoff:
//
//     R_mp / R_p = ( B0² / (2 μ0 ρ v²) ) ^ (1/6)
//
// The exponent is 1/6 and not a fitted number: a dipole falls off as r⁻³, its
// energy density as r⁻⁶, and the balance inverts that.
//
// A dipole field line that crosses the equator at L·R_p comes down at
// colatitude θ with sin²θ = 1/L. The last closed field line crosses at the
// magnetopause, so the particles that follow it precipitate at
//
//     θ_oval = asin( sqrt( R_p / R_mp ) )
//
// For Earth — B0 = 31 µT, ρv² at 1 AU ≈ 2 nPa — that gives R_mp ≈ 10 R_E and
// θ ≈ 18°, an oval at **magnetic latitude 72°**. The real one sits at 65–70°
// and drops to 60° in a storm. The formula is not tuned to that; it lands there.
//
// Two consequences that make the sky a readout rather than a decoration:
//
//   · A weak dynamo cannot hold the wind off, so the oval sits far from the
//     pole and the aurora is visible from temperate latitudes. A strong one
//     pins it to the cap, where almost nobody stands.
//   · An active star pushes it equatorward. Same planet, hotter star, lower
//     aurora — which is exactly the substorm behaviour, driven by the star
//     rather than by a timer.
//
// ---------------------------------------------------------------------------
// 2 · Why the colours are stacked, and why nobody guesses this
//
// An aurora is green in the middle, red on top and violet-pink along the
// bottom edge, and the reason is **the lifetime of the excited state**, not the
// energy of the particle.
//
//     O I  557.7 nm  green   ¹S → ¹D    lifetime 0.7 s
//     O I  630.0 nm  red     ¹D → ³P    lifetime 110 s
//     N₂⁺  427.8 nm  violet  1NG        lifetime ~1e-8 s (prompt)
//     N₂   661   nm  pink    1PG        prompt
//
// A metastable state only radiates if it survives long enough to do so, and
// down where the air is thick it does not — a collision de-excites it first.
// The 110-second red state is quenched below about 200 km; the 0.7-second green
// state survives down to about 100 km; the prompt N₂ bands radiate wherever
// they are excited, which is the very bottom where the hardest particles stop.
//
// So the vertical colour order is a map of atmospheric density, read upward.
// That is the single most beautiful thing about an aurora and it is invisible
// in any implementation that picks the colours by eye.
//
// And it means an atmosphere of a different composition gets a different
// aurora, for free and correctly. `speciesFor()` below reads the world's air.
//
// ---------------------------------------------------------------------------
// 3 · The geometry is computed, not painted
//
// What makes a real aurora look *enormous* is perspective: the near edge of the
// oval towers overhead while the far edge lies along the horizon, because it is
// a sheet a hundred kilometres up and a thousand kilometres long.
//
// AEON's surface scale is a 1400 m tile under a sky dome, so the curtain cannot
// be placed a thousand kilometres away in world space. It does not need to be.
// For every point on the oval the *apparent* elevation is computable from the
// real ground distance and the real emission altitude, with the planet's own
// curvature in it, and the ribbon is built at those angles on the dome. The
// perspective is therefore the true perspective; only the radius is a
// convenience.
//
// ---------------------------------------------------------------------------
// 4 · What it costs
//
// One ribbon, 96 × 24 vertices, one additive draw, no texture, no readback. The
// folds, the rays and the flicker are all in the fragment shader as functions
// of two varyings. It is the cheapest thing in the night sky and the only one
// that is telling you something.

import { RNG, hash } from './rng.js';

const DEG = Math.PI / 180;
const clamp = (x, a, b) => Math.min(Math.max(x, a), b);

// ---------------------------------------------------------------------- 1 ---
// the magnetosphere

/** vacuum permeability, and Earth's numbers, so the formula can be checked */
const MU0 = 4 * Math.PI * 1e-7;
export const EARTH_B0 = 31e-6;          // T, equatorial surface field
export const EARTH_PDYN = 2.0e-9;       // Pa, quiet solar wind ram pressure at 1 AU

/**
 * A planetary dynamo, in one number: the equatorial surface field.
 *
 * A dynamo needs three things — a conducting fluid, rotation to organise it,
 * and a heat flux to drive convection. The scaling law that actually holds
 * across the solar system (Christensen & Aubert 2006) makes the field depend on
 * the *buoyancy flux* rather than on rotation rate, which was the twentieth
 * century's guess and is wrong: Earth and Jupiter differ in spin by a factor of
 * 2.4 and in field by 14, the wrong way round for a rotation law.
 *
 * So the proxy here is mass (bigger core, more available heat), a tidal-locking
 * penalty (a locked world spins slowly enough that the Coriolis force stops
 * organising the flow into columns), and a seeded factor for how much of the
 * core is still liquid — which is a genuine coin-flip of a world's history and
 * the reason Mars has no field and Earth does.
 */
export function dynamoField(pp) {
  const r = new RNG(hash(pp.seed ?? 0, 0xa17a));
  const massE = pp.massE ?? 1;
  // a solidified core is not a small field, it is no field — and it is common
  const alive = r.float(0, 1) > (massE < 0.3 ? 0.75 : massE < 0.8 ? 0.4 : 0.12);
  if (!alive) return 0;
  const locked = pp.tidallyLocked ? 0.18 : 1;
  return EARTH_B0 * Math.pow(massE, 0.55) * locked * r.float(0.45, 2.1);
}

/**
 * Stellar wind ram pressure at the planet, relative to Earth's.
 *
 * The wind is driven by the star's corona, so it scales with activity, and it
 * falls off as the inverse square of orbital distance because the flux does.
 * Hot stars have weak winds and strong radiation; cool M dwarfs have violent
 * ones, which is most of why their planets are thought to lose atmospheres.
 */
export function windPressure(starT = 5778, auDist = 1) {
  const activity = starT < 4000 ? 6.0 : starT < 5200 ? 2.2 : starT > 7500 ? 0.35 : 1;
  return (EARTH_PDYN * activity) / Math.max(auDist * auDist, 1e-4);
}

/**
 * The magnetosphere: how far the wind is held off, and where that puts the oval.
 *
 * `colat` is degrees from the *magnetic* pole. `openFlux` is how much of the
 * cap is connected to the wind, which is what sets brightness — a planet whose
 * field is barely holding on has a huge, bright, low-latitude oval, and one
 * with a strong field has a tight faint one.
 */
export function magnetosphere(pp, { starT = 5778, auDist = 1, storm = 0 } = {}) {
  const B0 = dynamoField(pp);
  const p = windPressure(starT, auDist) * (1 + storm * 4);
  if (B0 <= 0) {
    // No field is not a small aurora. Particles hit the day side directly and
    // there is no oval at all — Venus and Mars have induced aurorae with no
    // structure, and this returns the honest answer rather than a faint ring.
    return { B0: 0, standoff: 1, colat: 90, openFlux: 0, hasOval: false };
  }
  // R_mp/R_p = (2 B0^2 / (mu0 p))^(1/6). The exponent inverts a dipole's r^-6
  // energy density and is not a fitted number; the factor of 2 is the
  // **Chapman-Ferraro current sheet**, which flows on the magnetopause and
  // doubles the field just inside it, so the magnetic pressure available is
  // (2B)^2/2mu0 rather than B^2/2mu0 — a factor of 4, or 4^(1/6) = 1.26 in the
  // standoff.
  //
  // Leaving it out is not a rounding error and the suite caught it: Earth came
  // back at 7.6 R_E against a measured 10-11. The oval's latitude still landed
  // in the right band, because a sixth root forgives a lot, which is exactly
  // why a check on the *intermediate* was worth writing.
  const standoff = Math.max(Math.pow((2 * B0 * B0) / (MU0 * p), 1 / 6), 1.02);
  // a dipole field line crossing the equator at L reaches the surface where
  // sin^2(theta) = 1/L
  const colat = Math.asin(Math.min(Math.sqrt(1 / standoff), 1)) / DEG;
  return {
    B0, standoff, colat, hasOval: true,
    // the polar cap's solid angle, normalised to Earth's — the driver of how
    // much power precipitates per unit length of oval
    openFlux: (1 - Math.cos(colat * DEG)) / (1 - Math.cos(18.4 * DEG)),
  };
}

// ---------------------------------------------------------------------- 2 ---
// the light

/**
 * Wavelength to linear sRGB.
 *
 * Dan Bruton's piecewise fit to the CIE observer, which is the standard
 * approximation and is accurate enough that 557.7 nm comes out the exact green
 * of an aurora rather than a green somebody chose. Returned **linear**, because
 * everything downstream of here is linear until §9.4's print.
 *
 * The intensity roll-off at the ends of the visible band is not decoration
 * either: it is why the 427.8 nm N₂⁺ band reads as a dim violet fringe rather
 * than as a bright blue, even when it is energetically strong.
 */
export function wavelengthRGB(nm) {
  let r = 0, g = 0, b = 0;
  if (nm >= 380 && nm < 440) { r = -(nm - 440) / 60; b = 1; }
  else if (nm < 490) { g = (nm - 440) / 50; b = 1; }
  else if (nm < 510) { g = 1; b = -(nm - 510) / 20; }
  else if (nm < 580) { r = (nm - 510) / 70; g = 1; }
  else if (nm < 645) { r = 1; g = -(nm - 645) / 65; }
  else if (nm <= 780) { r = 1; }
  // the eye's own falloff at the band edges
  const f = nm < 420 ? 0.3 + (0.7 * (nm - 380)) / 40
    : nm > 700 ? 0.3 + (0.7 * (780 - nm)) / 80 : 1;
  // sRGB gamma 0.8 is Bruton's; undo it to get back to linear radiance
  const lin = (c) => Math.pow(Math.max(c * f, 0), 1 / 0.8);
  return [lin(r), lin(g), lin(b)];
}

/**
 * Which lines this world's air can emit, and at what altitude.
 *
 * `peak` and `width` are kilometres, and they come from the physics in the
 * header: a long-lived state only radiates where collisions are rare enough to
 * let it, so its emission floor is set by the density at which it is quenched.
 *
 * The altitudes scale with the atmosphere's **scale height**, which is the
 * right coupling — a thin cold atmosphere is compressed, so its whole auroral
 * stack sits lower, and a puffy hot one spreads it out. Same physics, and it
 * means no world needs a special case.
 */
export function speciesFor(pp, hScale = 1) {
  const t = pp.typeId ?? 1;
  const k = clamp(hScale, 0.35, 3);
  const line = (nm, peak, width, w) => ({ nm, peak: peak * k, width: width * k, weight: w, rgb: wavelengthRGB(nm) });

  // CO₂ worlds: O I survives (CO₂ photodissociates to O), N₂ bands do not.
  // Mars' real aurora is the 630 nm line and a CO₂⁺ doublet in the UV, so what
  // reaches the eye is red — which is what this returns, without a special case
  // for "Mars".
  if (t === 4 || (pp.co2 ?? 0) > 0.5) {
    return [line(630.0, 230, 90, 1.0), line(557.7, 130, 45, 0.35), line(589, 105, 30, 0.15)];
  }
  // Ice worlds: thin N₂, so the stack is compressed and the violet band, which
  // needs the hardest particles to reach the deepest air, is prominent.
  if (t === 3) {
    return [line(630.0, 215, 80, 0.55), line(557.7, 118, 40, 1.0), line(427.8, 96, 16, 0.5)];
  }
  // N₂/O₂ — the terrestrial stack, and the one every photograph is of.
  return [
    line(630.0, 240, 95, 0.62),   // ¹D oxygen, quenched below ~200 km
    line(557.7, 122, 42, 1.0),    // ¹S oxygen, the dominant line
    line(427.8, 100, 14, 0.30),   // N₂⁺ 1NG, prompt, the violet lower fringe
    line(661.0, 94, 10, 0.22),    // N₂ 1PG, the pink hem on a hard event
  ];
}

// ---------------------------------------------------------------------- 3 ---
// where it lands in the sky

/**
 * Apparent elevation of a point at altitude `hKm` whose ground-track is
 * `dKm` away over a sphere of radius `RKm`.
 *
 * The curvature term is what makes a distant curtain sit *below* where flat
 * geometry would put it, and eventually below the horizon — which is why an
 * aurora a thousand kilometres away is a glow on the horizon rather than a
 * curtain in the sky. Dropping it would make every display look equally close.
 */
export function apparentElevation(hKm, dKm, RKm) {
  const a = dKm / RKm;                       // central angle to the ground track
  // observer at (0, R), target at (R+h)·(sin a, cos a)
  const x = (RKm + hKm) * Math.sin(a);
  const y = (RKm + hKm) * Math.cos(a) - RKm;
  return Math.atan2(y, Math.hypot(x, 1e-9)) / DEG;
}

/**
 * The observer's own magnetic latitude, and how far the oval is from them.
 *
 * The dipole is tilted off the spin axis by a seeded angle — Earth's is 11°,
 * Uranus' is 59°, and the tilt is what makes the oval a ring the world turns
 * underneath rather than a cap. That, in turn, is why an aurora at a fixed site
 * comes and goes with the planet's rotation rather than being permanent.
 */
export function auroralGeometry(pp, latDeg, mag, { RKm = 6371 } = {}) {
  const r = new RNG(hash(pp.seed ?? 0, 0xa17b));
  const tilt = r.float(4, 26);
  // the nearer magnetic pole, in degrees of great circle from the observer
  const magLat = Math.abs(latDeg) + (latDeg >= 0 ? -1 : 1) * 0 + 0;
  const toPole = Math.abs(90 - Math.min(Math.abs(magLat) + tilt * 0.5, 90));
  // distance from the observer to the oval, along the ground, in km
  const gapDeg = toPole - mag.colat;
  return { tilt, toPoleDeg: toPole, gapDeg, gapKm: (gapDeg * DEG) * RKm };
}

// ---------------------------------------------------------------------- 4 ---
// the curtain

export const AURORA_VERT = /* glsl */`
  in float aAlong;             // 0..1 around the visible arc of the oval
  in float aAlt;               // altitude in km, the physical one
  out float vAlong;
  out float vAlt;
  out float vHoriz;            // how close this vertex is to the horizon
  void main() {
    vAlong = aAlong;
    vAlt = aAlt;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vHoriz = normalize(w.xyz - cameraPosition).y;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

// GLSL3, and for the same reason src/windfield.js is: the exact gradient path
// is written in integers, and GLSL ES 1.00 has no `%` and no ivec arithmetic.
// three supplies no gl_FragColor shim in this mode, so the output is declared
// here — write to gl_FragColor instead and it compiles to "undeclared
// identifier", three logs it and carries on, and the mesh renders as nothing.
export const AURORA_FRAG = (noise, species, loKm, hiKm) => /* glsl */`
  precision highp float;
  uniform float uTime;
  uniform float uPower;        // 0..1, how hard the wind is driving it
  uniform float uNight;        // 0 by day, 1 well after dusk
  in float vAlong;
  in float vAlt;
  in float vHoriz;
  out vec4 frag;
${noise}

  // The curtain is a *sheet of field lines*, so everything structural varies
  // along it and almost nothing varies across it. That asymmetry is the whole
  // look: folds and rays are functions of vAlong alone, and the vertical axis
  // carries only altitude, which carries only colour.
  float rays(float s, float t) {
    // Three octaves at incommensurate rates, so the pattern never repeats, and
    // each one *rectified* rather than centred: a ray is a place where more
    // electrons came down, so the field is bright spikes on a dim floor and not
    // a sine about a mean. Centred octaves multiplied together average out to a
    // wash, which is what the first version of this looked like.
    float a = abs(snoise(vec3(s * 190.0, t * 0.09, 0.0)));
    float b = abs(snoise(vec3(s * 43.0, t * 0.16, 3.7)));
    float c = abs(snoise(vec3(s * 8.5, t * 0.031, 8.1)));
    return pow(a, 0.7) * (0.35 + 0.85 * b) * (0.45 + 0.75 * c) * 1.9;
  }

  void main() {
    float t = uTime;

    // Folds: the sheet is draped, so it presents more depth where it turns
    // edge-on to the viewer. That is why a real curtain has bright vertical
    // seams — it is column density, not extra emission.
    float fold = snoise(vec3(vAlong * 6.3, t * 0.045, 0.0))
               + 0.5 * snoise(vec3(vAlong * 15.1, t * 0.07, 4.2));
    float edgeOn = 0.35 + 0.65 * pow(abs(fold), 1.6);

    float ray = rays(vAlong, t);

    // The bottom edge is sharp and the top is not, because the bottom is where
    // the particles stop and the top is where they came in. Getting that the
    // wrong way round is the commonest tell of a painted aurora.
    float lower = smoothstep(0.0, 14.0, vAlt - ${loKm.toFixed(1)});
    float upper = 1.0 - smoothstep(${(hiKm * 0.55).toFixed(1)}, ${hiKm.toFixed(1)}, vAlt);

    // Emission: each line is a Gaussian in altitude, weighted by how hard the
    // precipitation is. Hard events push the stack down and light the prompt
    // bands, which is what makes a storm aurora go violet along its hem.
    vec3 col = vec3(0.0);
    float total = 0.0;
${species}

    // col carries the mix; total carries the brightness. Separating them is
    // what stops the emission being squared where two lines overlap.
    col /= max(total, 1e-4);

    float body = clamp(total, 0.0, 1.6) * lower * upper * edgeOn * ray;
    // a soft glow below the curtain — scattered light in the air beneath it,
    // and the thing that makes an aurora light a landscape
    // Scattered light near the base -- the part of an aurora that lights a
    // landscape. It decays *upward from the bottom edge*, which is where the
    // scattering air is.
    //
    // This read exp(-max(lo - vAlt, 0) / 22) at first. The ribbon never goes
    // below lo, so the max clamped to zero and the term was a flat 0.20 on
    // every fragment: the curtain rendered as a featureless wedge with a hard
    // straight edge, which is precisely what it was.
    float bloom = exp(-max(vAlt - ${loKm.toFixed(1)} , 0.0) / 26.0) * 0.30 * ray;

    float a = (body + bloom) * uPower * uNight;

    // The ends of the ribbon are a modelling boundary, not a physical one --
    // the oval continues past them and over the horizon. Without this fade the
    // boundary is a straight line across the sky, and a straight line in a sky
    // is the one thing that can never be weather.
    a *= smoothstep(0.0, 0.10, vAlong) * smoothstep(1.0, 0.90, vAlong);

    // A curtain seen edge-on is extinguished by the whole atmosphere long
    // before geometry says it should vanish.
    a *= smoothstep(-0.02, 0.06, vHoriz);

    if (a < 0.002) discard;
    // three's AdditiveBlending is (SRC_ALPHA, ONE), so what lands is col * a.
    // Premultiplying here as well would square the brightness.
    frag = vec4(col, a);
  }
`;

/**
 * Build the emission-stack GLSL for a world's species list.
 *
 * Unrolled at build time rather than looped over a uniform array, because the
 * list is known when the material is made and a loop here would cost a
 * dependent read per fragment for a value that never changes.
 */
export function speciesGLSL(lines) {
  return lines.map((l, i) => /* glsl */`
    {
      float w${i} = exp(-pow((vAlt - ${l.peak.toFixed(1)}) / ${l.width.toFixed(1)}, 2.0))
                  * ${l.weight.toFixed(3)}
                  * ${i === 0 ? '(0.45 + 0.55 * uPower)' : '(1.35 - 0.35 * uPower)'};
      col += vec3(${l.rgb.map((c) => c.toFixed(4)).join(', ')}) * w${i};
      total += w${i};
    }`).join('\n');
}

/**
 * The ribbon. Vertices are placed at *computed* apparent elevations, so the
 * perspective is the real one — see the header, §3.
 */
export function ribbonMesh(mag, geom, lines, { RKm, seg = 96, rows = 24, skyR = 12000 }) {
  const loKm = Math.min(...lines.map((l) => l.peak - l.width * 1.6));
  const hiKm = Math.max(...lines.map((l) => l.peak + l.width * 1.8));
  const pos = new Float32Array(seg * rows * 3);
  const along = new Float32Array(seg * rows);
  const alt = new Float32Array(seg * rows);

  // The visible arc: the oval is a full circle, but only the part within a few
  // thousand kilometres is above the horizon. 140° of azimuth centred on the
  // pole is generous and keeps the ribbon cheap.
  const arc = 140 * DEG;
  for (let i = 0; i < seg; i++) {
    const u = i / (seg - 1);
    const az = (u - 0.5) * arc;
    // ground distance to the oval along this bearing: the gap grows as the
    // bearing swings away from the pole, which is what curves the ribbon down
    // toward the horizon at both ends
    const d = Math.hypot(geom.gapKm, Math.tan(clamp(Math.abs(az), 0, 1.35)) * geom.gapKm * 1.9)
      + Math.abs(az) * RKm * 0.06;
    for (let j = 0; j < rows; j++) {
      const v = j / (rows - 1);
      const h = loKm + (hiKm - loKm) * v;
      const el = apparentElevation(h, d, RKm) * DEG;
      const k = (j * seg + i) * 3;
      const ce = Math.cos(el);
      pos[k] = Math.sin(az) * ce * skyR;
      pos[k + 1] = Math.sin(el) * skyR;
      pos[k + 2] = -Math.cos(az) * ce * skyR;
      along[j * seg + i] = u;
      alt[j * seg + i] = h;
    }
  }

  const idx = [];
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < seg - 1; i++) {
      const a = j * seg + i, b = a + 1, c = a + seg, d2 = c + 1;
      idx.push(a, c, b, b, c, d2);
    }
  }

  return { pos, along, alt, index: new Uint32Array(idx), loKm, hiKm, seg, rows };
}
