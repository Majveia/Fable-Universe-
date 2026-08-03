// Ground materials — CLAUDE.md §M2 act 4.
//
//   "Four-layer triplanar procedural materials blended by slope × altitude ×
//    latitude × moisture. Analytic noise mid/far; generated detail arrays
//    inside 30 m."
//
// and the gate:
//
//   "at 1.68 m eye height, no visible tiling within 40 m in any biome; every
//    material nameable from a still (§8 axis 5)."
//
// What is there today is a slope/altitude colour ramp with two noise octaves,
// inline in `surface.js`'s terrain shader. It has no material identity at all:
// there is nothing in it you could point at and say "that is rock and that is
// soil", because the same lerp produces both and neither has a name.
//
// ---------------------------------------------------------------------------
// The second job
//
// §9.2's light model is held back (`docs/plans/M2.md` §24.4) because its
// three-stop ramp collapses to a single band and flattens the terrain. Half of
// that is the sun's elevation, which belongs to §9.7's solver. The other half
// is this file: `paint()` takes `shade`, `mid` and `lit` as *material*
// properties, and what feeds them today is a derivation from one base colour —
//
//     sf.shade = mix(col * 0.55, uPaintShadowTint * dot(col, vec3(0.33)), 0.28);
//     sf.mid   = col;
//     sf.lit   = mix(col * 1.22, uPaintSun * dot(col, vec3(0.42)), 0.20);
//
// — three points on one line through one colour, which is a brightness ramp
// wearing a hue ramp's clothes. §9.1 describes the real thing as a hue *path*,
// and §9.5 spells out what one looks like: teal at the root, yellow-green at
// the tip. Four layers, each carrying its own three stops, is what lets the
// ramp have somewhere to go.
//
// ---------------------------------------------------------------------------
// Why the blend law is a pure function of scalars
//
// The GLSL samples simplex noise; the CPU twin cannot, without porting simplex
// to JS to no purpose. So the noise is an *input* to the blend rather than
// something the blend reaches for: both sides compute the same algebra over
// whatever their noise gave them, and `tools/verify.js` tests the algebra —
// which is where every property the gate names actually lives. §2.7's parity
// rule is about the height field, and this does not touch it.

import { hash } from './rng.js';

/**
 * The four layers, in blend order, and their names.
 *
 * The names are load-bearing rather than decorative: §8 axis 5 asks whether
 * every surface is nameable from a still, and a scoring pass that cannot say
 * what it is looking at has already failed. These are the answers it is
 * allowed to give.
 */
export const LAYERS = ['rock', 'soil', 'sward', 'rime'];

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/**
 * Where the snow line sits, as a fraction of the local relief.
 *
 * Latitude is the other half of altitude: the same height is bare at the
 * equator and white at the pole, which is why §M2 lists both. `lat` is
 * |sin(latitude)|, so 0 at the equator and 1 at a pole.
 */
export function snowLine(lat, cold = 0) {
  // A pole's snow line is at sea level; the equator's is near the top of the
  // relief. Squared because the cold does not arrive linearly with latitude —
  // most of a world's temperate band is in its first half.
  return clamp01(0.82 - 0.86 * lat * lat - cold);
}

/**
 * Moisture, from the fields a world already has.
 *
 * Three terms, and all three are the reasons real ground is wet: it is near
 * water, it is low enough for water to collect in it, and the weather brought
 * some. `sea` is the height of the waterline in the same units as `h`, or
 * `null` on a dry world.
 */
export function moistureAt(h, sea, relief, wet, rain = 0.5) {
  // near the waterline, and falling off over a quarter of the relief
  const shore = sea === null ? 0 : 1 - smoothstep(0, Math.max(relief * 0.25, 1), h - sea);
  // orographic: the high ground is drier because the air arrived wrung out
  const dry = 1 - smoothstep(0.35, 0.95, clamp01(h / Math.max(relief, 1)));
  return clamp01((0.22 + 0.55 * rain) * (0.35 + 0.65 * dry) + shore * 0.42 + wet * 0.30);
}

/**
 * The blend law. Four affinities, normalised, continuous everywhere.
 *
 * Normalising rather than layering-with-alpha is what makes the weights sum to
 * one by construction — an alpha stack loses that the moment one layer's mask
 * is edited, and the failure is a frame that quietly darkens where the masks
 * do not quite cover.
 *
 *   `slope`  0 flat .. 1 vertical
 *   `alt`    height as a fraction of local relief
 *   `lat`    |sin(latitude)|
 *   `moist`  0 desert .. 1 saturated
 *   `jit`    a noise sample in −1..1, the patch breakup
 */
export function blend({ slope, alt, lat, moist, jit = 0, cold = 0 }) {
  const line = snowLine(lat, cold);

  // Rock is what is left when nothing else can hold on. It wins on steep
  // ground, and it is never quite zero — bare stone shows through everything.
  const steep = smoothstep(0.26, 0.62, slope + jit * 0.06);
  const rock = 0.06 + 1.55 * steep;

  // Snow and ice sit above the line, and slide off anything sheer.
  const above = smoothstep(line - 0.10, line + 0.12, alt + jit * 0.05);
  const rime = 1.85 * above * (1 - steep * 0.88);

  // Sward needs water, gentle ground and somewhere below the snow.
  const sward = 1.30 * moist * (1 - steep) * (1 - above) * (0.35 + 0.65 * moist);

  // Soil is the default: what gentle, unwatered, unfrozen ground is made of.
  const soil = 0.90 * (1 - steep * 0.75) * (1 - above) * (1.05 - 0.75 * moist);

  const w = [rock, soil, sward, rime];
  let s = 0;
  for (let i = 0; i < 4; i++) { if (w[i] < 0) w[i] = 0; s += w[i]; }
  // s is bounded below by rock's 0.06 floor, so this can never divide by zero
  // — which is the reason the floor is there as well as the reason it is right.
  for (let i = 0; i < 4; i++) w[i] /= s;
  return w;
}

/**
 * Four layers × three stops, from the world's own colours and its star's light.
 *
 * §9.1 says every colour lives in one table, derived per world and never
 * defaulted. `pp` supplies the three palette colours the generator already
 * rolled; `light` supplies the sun and shadow tints `starlight.js` derived from
 * the star's spectrum. The stops are a *hue path* between them, not three
 * brightnesses of one colour: shade leans toward the shadow tint, lit leans
 * toward the sun, and the mid is the material's own colour.
 */
export function materialPalette(pp, light) {
  const rgb = (c) => [c.r ?? c[0], c.g ?? c[1], c.b ?? c[2]];
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const lum = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];

  const soilC = rgb(pp.colA);
  const rockC = rgb(pp.colB);
  const vegC = rgb(pp.colC);
  // Rime is the world's own white: snow on a temperate world, ash on a volcanic
  // one, salt on a dry one. Keyed off the rock so it belongs to the palette.
  const rimeC = pp.typeId === 4
    ? mix3(rockC, [0.30, 0.28, 0.27], 0.75)
    : mix3(rockC, [0.94, 0.96, 1.0], 0.86);

  /**
   * One material's three stops. `warm` and `cool` are how far the lit and shade
   * ends travel toward the light and the shadow — a mineral surface barely
   * shifts hue, a leaf shifts a great deal, and that difference is most of what
   * makes one nameable against the other.
   */
  const stops = (base, { warm, cool, range }) => ({
    shade: mix3(scale(base, 1 - range), light.shadowTint, cool),
    mid: base,
    lit: mix3(scale(base, 1 + range), light.sun, warm),
  });

  return [
    // Stone is nearly achromatic and stays that way: it takes a lot of light to
    // make granite look warm, which is exactly why it reads as stone.
    { name: 'rock', ...stops(rockC, { warm: 0.10, cool: 0.16, range: 0.30 }), rough: 1.0, grain: 1.35 },
    { name: 'soil', ...stops(soilC, { warm: 0.18, cool: 0.22, range: 0.26 }), rough: 0.82, grain: 0.85 },
    // Vegetation transmits, so its lit end runs toward yellow-green rather than
    // toward the base colour brightened — §9.5's root-to-tip hue path, one
    // material down.
    {
      name: 'sward',
      shade: mix3(scale(vegC, 0.62), light.shadowTint, 0.20),
      mid: vegC,
      lit: mix3(scale(vegC, 1.18), [lum(vegC) * 1.9, lum(vegC) * 2.1, lum(vegC) * 0.75], 0.42),
      rough: 0.55, grain: 0.55,
    },
    // Snow is the one material whose shade is more saturated than its mid: it
    // is lit almost entirely by the sky, and the sky is blue.
    {
      name: 'rime',
      shade: mix3(scale(rimeC, 0.80), light.shadowTint, 0.34),
      mid: rimeC,
      lit: mix3(rimeC, light.sun, 0.14),
      rough: 0.30, grain: 0.35,
    },
  ];
}

/** a per-world scalar that shifts every blend a little, so no two worlds match */
export function worldBias(pp) {
  const h = hash(pp.seed ?? 1, 0x4a71) >>> 0;
  return {
    cold: ((h & 0xff) / 255 - 0.5) * 0.22,
    rain: ((h >>> 8 & 0xff) / 255) * 0.9 + 0.05,
    lat: ((h >>> 16 & 0xff) / 255),
  };
}

// ---------------------------------------------------------------------------
// GLSL

/**
 * Triplanar sampling, the blend law, and the four-layer resolve.
 *
 * **Triplanar is not a style choice here, it is the anti-tiling mechanism.**
 * A single planar projection stretches to smears on anything steep, and those
 * smears are the most visible repetition in a landscape — the gate's "no
 * visible tiling within 40 m" fails on a cliff face long before it fails on
 * flat ground. Three projections weighted by the normal cost three samples and
 * make the stretch impossible by construction.
 *
 * The frequencies are deliberately incommensurate. Octaves at exact powers of
 * two share every zero crossing of the coarsest one, and the eye finds that
 * lattice immediately; 3.07 and 7.13 between octaves means the pattern does not
 * close on itself inside any window a walker can see.
 */
export const MATERIAL_GLSL = /* glsl */`
  uniform vec3 uMatShade[4];
  uniform vec3 uMatMid[4];
  uniform vec3 uMatLit[4];
  uniform float uMatGrain[4];
  uniform float uMatLat;      // |sin(latitude)| at the landing site
  uniform float uMatCold;     // per-world shift of the snow line
  uniform float uMatRain;     // per-world wetness
  uniform float uMatRelief;   // metres of local relief, for the altitude term

  // Triplanar simplex, one octave. The exponent on the blend weights decides
  // how wide the seam between projections is: 4.0 is narrow enough that a
  // 45 degree face is nearly all one projection, which is what keeps the
  // detail from doubling along the diagonals.
  float triNoise(vec3 p, vec3 n, float f) {
    vec3 w = pow(abs(n), vec3(4.0));
    w /= max(w.x + w.y + w.z, 1e-4);
    return w.x * snoise(vec3(p.yz * f, 0.37))
         + w.y * snoise(vec3(p.xz * f, 1.71))
         + w.z * snoise(vec3(p.xy * f, 2.93));
  }

  // Four octaves at incommensurate ratios. \`near\` fades the finest one out by
  // 30 m, which is §M2's "generated detail arrays inside 30 m" done as a
  // coherent branch instead of a texture upload: past 30 m the octave is
  // sub-pixel and every instruction spent on it is spent on nothing.
  float matDetail(vec3 p, vec3 n, float near) {
    float v = triNoise(p, n, 0.041) * 0.55
            + triNoise(p, n, 0.127) * 0.28;
    if (near > 0.004) v += triNoise(p, n, 0.39) * 0.13 * near;
    if (near > 0.35)  v += triNoise(p, n, 1.63) * 0.07 * near;
    return v;
  }

  // The blend law, identical in shape to blend() in this module's JS half.
  vec4 matWeights(float slope, float alt, float moist, float jit) {
    float line = clamp(0.82 - 0.86 * uMatLat * uMatLat - uMatCold, 0.0, 1.0);
    float steep = smoothstep(0.26, 0.62, slope + jit * 0.06);
    float above = smoothstep(line - 0.10, line + 0.12, alt + jit * 0.05);

    vec4 w;
    w.x = 0.06 + 1.55 * steep;                                        // rock
    w.y = 0.90 * (1.0 - steep * 0.75) * (1.0 - above) * (1.05 - 0.75 * moist); // soil
    w.z = 1.30 * moist * (1.0 - steep) * (1.0 - above) * (0.35 + 0.65 * moist); // sward
    w.w = 1.85 * above * (1.0 - steep * 0.88);                        // rime
    w = max(w, vec4(0.0));
    return w / max(dot(w, vec4(1.0)), 1e-4);
  }

  float matMoisture(float h, float sea, float relief, float wet) {
    float shore = sea < -1e8 ? 0.0
      : 1.0 - smoothstep(0.0, max(relief * 0.25, 1.0), h - sea);
    float dry = 1.0 - smoothstep(0.35, 0.95, clamp(h / max(relief, 1.0), 0.0, 1.0));
    return clamp((0.22 + 0.55 * uMatRain) * (0.35 + 0.65 * dry)
      + shore * 0.42 + wet * 0.30, 0.0, 1.0);
  }

  // The three stops for this point on the ground, blended across the four
  // layers. Returning all three rather than one colour is the whole point:
  // §9.2's ramp needs somewhere to go, and one colour gives it nowhere.
  struct Ground { vec3 shade; vec3 mid; vec3 lit; float grain; vec4 w; };

  Ground groundAt(vec3 P, vec3 n, float sea, float wet, float near) {
    float slope = 1.0 - clamp(n.y, 0.0, 1.0);
    float alt = clamp(P.y / max(uMatRelief, 1.0), 0.0, 1.0);
    float d = matDetail(P, n, near);
    float moist = clamp(matMoisture(P.y, sea, uMatRelief, wet) + d * 0.20, 0.0, 1.0);
    vec4 w = matWeights(slope, alt, moist, d);

    Ground g;
    g.shade = uMatShade[0] * w.x + uMatShade[1] * w.y + uMatShade[2] * w.z + uMatShade[3] * w.w;
    g.mid   = uMatMid[0]   * w.x + uMatMid[1]   * w.y + uMatMid[2]   * w.z + uMatMid[3]   * w.w;
    g.lit   = uMatLit[0]   * w.x + uMatLit[1]   * w.y + uMatLit[2]   * w.z + uMatLit[3]   * w.w;
    g.grain = uMatGrain[0] * w.x + uMatGrain[1] * w.y + uMatGrain[2] * w.z + uMatGrain[3] * w.w;
    g.w = w;

    // Within-material variation, on top of the between-material blend. Without
    // it a patch of pure soil is a flat colour no matter how many layers the
    // blend has, because the blend only varies where two materials meet.
    float tone = 1.0 + d * 0.30 * g.grain;
    g.shade *= tone; g.mid *= tone; g.lit *= tone;
    return g;
  }
`;
