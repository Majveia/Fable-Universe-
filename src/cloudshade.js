// The deck's shadow on the ground — CLAUDE.md §9.2, and `clouds.js`'s own note.
//
// `clouds.js:452` states the invariant this file exists to satisfy:
//
//   "One field decides two things: whether a puff is drawn at all, and — when
//    surface.js grows a shadow pass — where its shadow falls. The reference
//    makes that identity explicit and it is the right invariant: a shadow must
//    always belong to a cloud you can point at."
//
// It exported `CLOUD_FIELD_GLSL` for that and nothing ever took it. The sun
// crossed the sky, the deck drifted under it on the shared wind, and the ground
// never once went dark.
//
// ---------------------------------------------------------------------------
// 1 · One field, two readouts, shared by reference
//
// The field is not re-derived here and the uniforms are not copied. `surface.js`
// builds one uniform bag and hands the same objects to `makeCumulus` and to
// every ground shader, so `uCloudDrift` is the *same* `Vector2` for the cloud
// and for its shadow. There is no second field that could drift out of sync,
// because there is no second field.
//
// What differs between the two readouts is only where the smoothstep sits, and
// that difference is the sun's angular size — §2.
//
// ---------------------------------------------------------------------------
// 2 · The penumbra belongs to the star
//
// `surface.js:2091` already computes this star's true angular radius from this
// orbit — `atan(rStarAU / a)` — and then multiplies it by three for a cinematic
// sun disc (§9.6 paints the disc oversize on purpose). The penumbra takes the
// **un-exaggerated** angle, because this one is geometry rather than art
// direction: a shadow edge cast from `h` metres up by a source of angular
// radius `θ` is smeared across
//
//     w = 2·h·tan θ
//
// metres of ground. Earth under a 900 m cumulus base: about 8.4 m, which is why
// terrestrial cloud shadows have an edge you can stand on. `system.js:115–128`
// gives this universe red giants at 12–45 R☉, white dwarfs at 0.013 and a
// pulsar at 1.7e-5 — twelve kilometres of star — so:
//
//   · around a white dwarf the edge is cut paper;
//   · under a close red giant subtending several degrees `w` runs to hundreds of
//     metres, the field's own contrast is smeared below the smoothstep's range,
//     and there is no edge at all — the ground just dims and brightens;
//   · Sun-like stars land where Earth lands, which is why Earth's look right.
//
// The same `w` also decides how much of the field survives into the shadow: an
// octave whose wavelength is shorter than the penumbra has already been blurred
// away by the sun's own disc, so evaluating it would be arithmetic in service
// of a detail physics has removed. On a Sun-like world that removes nothing —
// the finest octave in the field is about 89 m against 8 m of penumbra — and
// saying so is more honest than pretending the octave cut pays for the feature
// everywhere. It pays for it on big-star worlds, where it is also the only
// thing keeping a soft shadow from costing what a hard one does.
//
// ---------------------------------------------------------------------------
// 3 · Why it multiplies into `sunShadow()` rather than into every caller
//
// Every lit surface in the scale already asks one question — `sunShadow(wp,
// ndl)`, "how much of the beam reaches this point" — and a deck overhead is an
// answer to exactly that question. So `shadow.js` composes the two at the
// *definition*, and terrain, grass, foliage, bark, props, figures, herds and
// the far ridges get the deck without a single call site changing.
//
// That is not a shortcut. A shadow that stopped at the grass line because one
// consumer was forgotten would be worse than no shadow at all, and this makes
// that failure structurally impossible instead of carefully maintained.

import { CLOUD_FIELD_GLSL } from './cloudfield.js';

// ---------------------------------------------------------------------------
// the field's own numbers, read off CLOUD_FIELD_GLSL
//
// Mirrored here rather than imported because they are baked into a GLSL string
// there. `tools/verify.js`'s cloudshade suite asserts they still match, so a
// change to the field that this file has not been told about fails a check
// rather than silently desynchronising a shadow from its cloud.

/** metres⁻¹ — `vec2 p = (q - uCloudDrift) * 0.00071` */
export const FIELD_SCALE = 0.00071;
/** `p = p * 2.07 + 11.3` in `cfFbm` */
export const FIELD_LACUNARITY = 2.07;
/** `a *= 0.5` in `cfFbm` */
export const FIELD_GAIN = 0.5;
/** `return 1.4 * mix(...)` in `cfNoise` */
export const FIELD_NOISE_GAIN = 1.4;
/** the domain-warp chain runs at `p * 1.55`, the detail chain at `p * 3.7` */
export const WARP_SCALE = 1.55;
export const DETAIL_SCALE = 3.7;
/** `smoothstep(-0.035, 0.30, f)` — the coverage transition the deck itself uses */
export const COVER_EDGE = [-0.035, 0.30];
/** octave counts in the shipped field: warp, body, detail */
export const FIELD_OCTAVES = { warp: 3, body: 4, detail: 3 };

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);

/**
 * This star's true angular radius seen from this orbit, in radians.
 *
 * `radiusSun` is in solar radii (`system.js` carries it on every star) and
 * `orbitAU` is the planet's semi-major axis. 0.004650467 is one solar radius in
 * AU — `system.js:87`'s `R_SUN_AU`, the constant that makes a stellar radius and
 * an orbital radius the same kind of number.
 *
 * **No cinematic factor.** `surface.js` triples this for the painted disc
 * because §9.6 says the disc is drawn oversize; a penumbra is not drawn, it is
 * measured, and tripling it here would soften every shadow in the universe by
 * three times the amount the star actually justifies.
 */
export const R_SUN_AU = 0.004650467;
export function angularRadius(radiusSun = 1, orbitAU = 1) {
  const r = Math.max(radiusSun, 0) * R_SUN_AU;
  const a = Math.max(orbitAU, 1e-4);
  // atan rather than asin: the small-angle regime is everything here, the two
  // agree to 1e-9 across it, and atan cannot return NaN for a star larger than
  // its own orbit — which `system.js`'s red giants at 45 R☉ can genuinely be.
  return Math.atan(r / a);
}

/** the ground-level width of a shadow edge cast from `h` metres up */
export function penumbraMetres(theta, h) {
  return 2 * Math.max(h, 0) * Math.tan(clamp(theta, 0, 1.5533));
}

/** wavelength in metres of octave `i` of a chain running at `scale · p` */
export function octaveWavelength(i, scale = 1) {
  return 1 / (FIELD_SCALE * scale * Math.pow(FIELD_LACUNARITY, i));
}

/**
 * How many octaves of each chain survive the sun's disc.
 *
 * An octave is kept while its wavelength is longer than twice the penumbra —
 * below that the source's own angular size has already averaged it out, and the
 * shadow would be spending arithmetic on a detail that cannot appear in it.
 *
 * Never below one octave in any chain: the structure of the field is the three
 * chains, and a chain at zero octaves is a different function rather than a
 * cheaper one. Under a star big enough to want that, `edgeSoftness()` has
 * already flattened the result to a wash anyway.
 */
export function fieldOctaves(penumbra) {
  const keep = (max, scale) => {
    let n = 0;
    while (n < max && octaveWavelength(n, scale) > 2 * penumbra) n++;
    return Math.max(1, n);
  };
  return {
    warp: keep(FIELD_OCTAVES.warp, WARP_SCALE),
    body: keep(FIELD_OCTAVES.body, 1),
    detail: keep(FIELD_OCTAVES.detail, DETAIL_SCALE),
  };
}

/**
 * How far the penumbra widens the coverage transition, in field units.
 *
 * The edge is soft on the ground because the field changes slowly across the
 * penumbra, so the question is how much `f` moves over `w` metres. For an fbm
 * with gain `g` and lacunarity `l` the slope is dominated by its finest octave:
 *
 *     |∇f| ≈ (noiseGain / λ₀) · Σ (g·l)^i
 *
 * summed over the octaves actually evaluated. Multiply by `w` and the result is
 * in the same units as `COVER_EDGE`, which is what lets it simply widen the
 * smoothstep rather than needing a second transfer.
 *
 * The body and detail chains both contribute, at the weights the field mixes
 * them with (0.78 / 0.22).
 */
export function edgeSoftness(penumbra, oct = FIELD_OCTAVES) {
  const chain = (n, scale) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Math.pow(FIELD_GAIN * FIELD_LACUNARITY, i);
    return (FIELD_NOISE_GAIN * FIELD_SCALE * scale) * s;
  };
  const grad = 0.78 * chain(oct.body, 1) + 0.22 * chain(oct.detail, DETAIL_SCALE);
  return grad * penumbra;
}

/**
 * Where a ground point's light came through the deck.
 *
 * `sunDir` points from the surface toward the star, so travelling `+t·sunDir`
 * from `P` with `t = (deck − P.y) / sunDir.y` lands on the cloud base. For flat
 * ground that is a pure translation — a planar field lit by parallel rays
 * projects without stretch, and any "shadow stretching at low sun" would be a
 * lie about a field that has no thickness. The `P.y` term is where it earns its
 * keep: the shadow climbs the terrain, and that distortion is the depth cue.
 *
 * Returns null below the horizon fade, where there is no deck shadow to speak
 * of because the terminator already owns the valley.
 */
export const SUN_FADE = [0.02, 0.10];   // sin(elevation): ~1.1° to ~5.7°
export const MAX_THROW = 40000;         // metres, the float-precision guard

export function deckPoint(P, sunDir, deck) {
  const sy = sunDir.y;
  if (sy <= SUN_FADE[0]) return null;
  const t = Math.min((deck - P.y) / sy, MAX_THROW);
  if (!(t > 0)) return null;
  return [P.x + t * sunDir.x, P.z + t * sunDir.z];
}

/** the horizon fade, as a 0..1 weight on the whole term */
export function sunFade(sunY) {
  const t = clamp((sunY - SUN_FADE[0]) / (SUN_FADE[1] - SUN_FADE[0]), 0, 1);
  return t * t * (3 - 2 * t);
}

/**
 * Coverage → how much of the beam survives, and how much sky replaced it.
 *
 * Beer's law on the deck's own optical depth, which `clouds.js:552` already
 * carries as `uCloudThick` and describes in its own comment as "the optical
 * depth of a puff seen through its middle". A cumulus at τ = 3.4 passes about
 * 3% of the beam, which is right — what keeps a cloud shadow from being a black
 * hole in the meadow is not the beam, it is the sky, and §9.2 handles that: the
 * fill is not attenuated and `paint()` never lets a shadow reach zero.
 *
 * The second return is why overcast reads *flat* rather than *dark*: a covered
 * sky is a brighter dome than a clear one, so the hemispheric fill goes up as
 * the beam goes down. Small — it is a redistribution, not a gain.
 *
 * `f` is the raw field value; the noise is an **input** to this transfer rather
 * than something the transfer reaches for, which is the same split `material.js`
 * makes and for the same reason: it lets the CPU twin and the shader compute one
 * algebra over whatever their noise gave them.
 */
export const AMBIENT_LIFT = 0.18;

/**
 * How much of the transition the penumbra covers, 0 (sharp) .. 1 (a wash).
 *
 * Against the *whole* transition rather than half of it, because that is what
 * the number means: `COVER_EDGE` spans 0.335 field units, and on a Sun-like
 * world the field crosses that in about 80 metres of ground. The sun's 8 metres
 * of penumbra is a small correction on an edge the cloud itself already draws
 * softly — which is the honest answer, and not the one a "physically-based sun
 * disc" instinct expects.
 */
export function blurFraction(soft) {
  return clamp(soft / (COVER_EDGE[1] - COVER_EDGE[0]), 0, 1);
}

/**
 * Coverage → how much of the beam survives, and how much sky replaced it.
 *
 * **The penumbra blends toward the mean, it does not widen the smoothstep.**
 * Widening was the first version and it was wrong: the transition is centred on
 * 0.1325 and the field's mean is 0, so a wider transition does not soften an
 * edge, it raises coverage everywhere — a red-giant world came out uniformly
 * 35% darker with no shadow in it, which is a bias wearing a penumbra's
 * clothes. A blur is a low-pass, and what a low-pass does as its width passes
 * the feature size is converge on the local mean. So that is what this does,
 * and the mean is preserved exactly at every blur.
 *
 * Beer's law on the deck's own optical depth, which `clouds.js` already carries
 * as uCloudThick and describes as "the optical depth of a puff seen through its
 * middle". A cumulus at tau = 3.4 passes about 3% of the beam, which is right —
 * what keeps a cloud shadow from being a black hole in the meadow is not the
 * beam, it is the sky, and §9.2 handles that: the fill is not attenuated and
 * paint() never lets a shadow reach zero.
 *
 * The ambient return is why overcast reads *flat* rather than *dark*: a covered
 * sky is a brighter dome than a clear one, so the hemispheric fill rises as the
 * beam falls. Small — a redistribution, not a gain.
 *
 * `f` is the raw field value; the noise is an **input** to this transfer rather
 * than something the transfer reaches for, which is the same split material.js
 * makes and for the same reason: it lets the CPU twin and the shader compute one
 * algebra over whatever their noise gave them.
 */
export function cloudShadeTransfer({
  f, blur = 0, mean = COVER_MEAN, amount = 1, tau = 3.4, fade = 1,
}) {
  const t = clamp((f - COVER_EDGE[0]) / (COVER_EDGE[1] - COVER_EDGE[0]), 0, 1);
  const sharp = t * t * (3 - 2 * t);
  const b = clamp(blur, 0, 1);
  const cover = clamp(sharp + (mean - sharp) * b, 0, 1)
    * clamp(amount, 0, 1) * clamp(fade, 0, 1);
  return {
    beam: Math.exp(-tau * cover),
    cover,
    ambient: 1 + AMBIENT_LIFT * cover,
  };
}

// ---------------------------------------------------------------------------
// the shader
//
// `cloudFieldRaw()` comes from CLOUD_FIELD_GLSL, which is the same chunk the
// deck itself compiles — include this and you have included the cloud.

/**
 * @param {object} o
 * @param {number} o.warp   octaves of the domain-warp chain
 * @param {number} o.body   octaves of the body chain
 * @param {number} o.detail octaves of the detail chain
 */
export function cloudShadeGLSL({ warp = 3, body = 4, detail = 3 } = {}) {
  return /* glsl */`
${CLOUD_FIELD_GLSL}
uniform vec3  uSunDir;
uniform float uCsDeck;     // cloud base, metres above the datum
uniform float uCsSoft;     // penumbra, in field units — see edgeSoftness()
uniform float uCsTau;      // optical depth of the deck, shared with the puffs

// x: how much of the beam survives · y: coverage, for the ambient lift
vec2 cloudShade(vec3 wp) {
  float sy = uSunDir.y;
  float fade = smoothstep(${SUN_FADE[0].toFixed(3)}, ${SUN_FADE[1].toFixed(3)}, sy);
  if (fade <= 0.0) return vec2(1.0, 0.0);
  // Guarded before the divide, not after: a poisoned t would reach the noise
  // and come back as a NaN smeared over a neighbourhood by the bloom pyramid
  // (§11), and a firewall downstream of the divide is a firewall in the wrong
  // place. MAX_THROW also keeps q inside the range where a float32 world
  // coordinate still resolves metres.
  float t = min((uCsDeck - wp.y) / max(sy, ${SUN_FADE[0].toFixed(3)}), ${MAX_THROW.toFixed(1)});
  if (!(t > 0.0)) return vec2(1.0, 0.0);
  vec2 q = wp.xz + t * uSunDir.xz;
  float f = cloudFieldRaw(q, ${warp}, ${body}, ${detail});
  float cover = clamp(smoothstep(${COVER_EDGE[0].toFixed(3)} - uCsSoft,
                                 ${COVER_EDGE[1].toFixed(3)} + uCsSoft, f)
                      * uCloudAmount, 0.0, 1.0) * fade;
  return vec2(exp(-uCsTau * cover), cover);
}
`;
}

/**
 * Everything the shader above needs, derived from a star, an orbit and a deck.
 *
 * `drift`, `amount` and `thick` are the deck's own uniform objects, passed in by
 * reference so there is exactly one of each in the scale. `deck` is the lifting
 * condensation level `surface.js` already computes for `makeCumulus` — every
 * cloud in the field shares it, which is why a real cumulus sky looks ruled
 * along its bases and why one scalar is enough here.
 */
export function cloudShadeUniforms({
  radiusSun = 1, orbitAU = 1, deck = 900, sunDir, drift, amount, thick,
} = {}) {
  const theta = angularRadius(radiusSun, orbitAU);
  const w = penumbraMetres(theta, deck);
  const oct = fieldOctaves(w);
  return {
    theta, penumbra: w, octaves: oct,
    glsl: cloudShadeGLSL(oct),
    uniforms: {
      uSunDir: sunDir,
      uCloudDrift: drift,
      uCloudAmount: amount,
      uCsDeck: { value: deck },
      uCsSoft: { value: edgeSoftness(w, oct) },
      uCsTau: thick,
    },
  };
}

/** the compile-time stub: no deck, full beam, no lift */
export const CLOUD_SHADE_STUB = /* glsl */`
vec2 cloudShade(vec3 wp) { return vec2(1.0, 0.0); }
`;

// ---------------------------------------------------------------------------
// the field, computed the way a GPU computes it
//
// A port of cloudfield.js's three functions, in float32 via `Math.fround` at
// every step. `tools/pixeldiff.js` is the reason for the frounds: the shader
// works in float32 and JS works in float64, and `cfHash2` is built out of
// `fract` — a function whose whole job is to throw away the high bits, which is
// exactly where two precisions stop agreeing. The same argument
// `tools/pixeldiff.js` already makes for Ashima's `mod289`, one field over.
//
// This is not a second field. It is the same algebra, and the suite in
// `tools/verify.js` exists to keep saying so.

const f32 = Math.fround;
const fract = (x) => f32(x - Math.floor(x));

/** cfHash2 — two gradients from a lattice point */
export function cfHash2(px, py) {
  let x = fract(f32(px * 0.1031));
  let y = fract(f32(py * 0.1030));
  let z = fract(f32(px * 0.0973));
  const d = f32(f32(x * f32(y + 33.33)) + f32(f32(y * f32(z + 33.33)) + f32(z * f32(x + 33.33))));
  x = f32(x + d); y = f32(y + d); z = f32(z + d);
  return [
    f32(f32(fract(f32(f32(x + y) * z)) * 2) - 1),
    f32(f32(fract(f32(f32(x + z) * y)) * 2) - 1),
  ];
}

/** cfNoise — gradient noise, gain 1.4 */
export function cfNoise(px, py) {
  const ix = Math.floor(px), iy = Math.floor(py);
  const fx = f32(px - ix), fy = f32(py - iy);
  const ux = f32(f32(fx * fx) * f32(3 - f32(2 * fx)));
  const uy = f32(f32(fy * fy) * f32(3 - f32(2 * fy)));
  const dot2 = (g, ax, ay) => f32(f32(g[0] * ax) + f32(g[1] * ay));
  const a = dot2(cfHash2(ix, iy), fx, fy);
  const b = dot2(cfHash2(f32(ix + 1), iy), f32(fx - 1), fy);
  const c = dot2(cfHash2(ix, f32(iy + 1)), fx, f32(fy - 1));
  const d = dot2(cfHash2(f32(ix + 1), f32(iy + 1)), f32(fx - 1), f32(fy - 1));
  const mix = (p, q, t) => f32(p + f32(f32(q - p) * t));
  return f32(1.4 * mix(mix(a, b, ux), mix(c, d, ux), uy));
}

/** cfFbm — lacunarity 2.07, gain 0.5, offset 11.3, hard-capped at four octaves */
export function cfFbm(px, py, oct) {
  let v = 0, a = 0.5, x = px, y = py;
  for (let i = 0; i < 4; i++) {
    if (i >= oct) break;
    v = f32(v + f32(a * cfNoise(x, y)));
    x = f32(f32(x * 2.07) + 11.3);
    y = f32(f32(y * 2.07) + 11.3);
    a = f32(a * 0.5);
  }
  return v;
}

/** cloudFieldRaw — the field before its transition */
export function cloudFieldRaw(qx, qz, { driftX = 0, driftZ = 0,
  warp = 3, body = 4, detail = 3 } = {}) {
  const px = f32(f32(qx - driftX) * FIELD_SCALE);
  const pz = f32(f32(qz - driftZ) * FIELD_SCALE);
  const wx = cfFbm(f32(f32(px * WARP_SCALE) + 11.3), f32(f32(pz * WARP_SCALE) + 4.7), warp);
  const wz = cfFbm(f32(f32(px * WARP_SCALE) + 37.1), f32(f32(pz * WARP_SCALE) + 19.2), warp);
  const fv = cfFbm(f32(px + f32(wx * 0.62)), f32(pz + f32(wz * 0.62)), body);
  const gv = cfFbm(f32(f32(px * DETAIL_SCALE) + f32(wx * 1.1)),
                   f32(f32(pz * DETAIL_SCALE) + f32(wz * 1.1)), detail);
  return f32(f32(fv * 0.78) + f32(gv * 0.22));
}

/**
 * The mean of the sharp coverage transition over the field.
 *
 * Baked rather than measured at runtime: it is a property of the field, not of
 * a world, so a world that computed it would spend a hundred thousand noise
 * evaluations at load — about 300 ms measured — to arrive at a number that is
 * the same every time. It is also nearly independent of how many octaves
 * survive the penumbra: 0.1674 at (3,4,3), 0.1616 at the (2,2,1) a red giant
 * leaves, which is well inside the tolerance a blur this wide can carry.
 * `tools/verify.js` re-measures it and fails if the field has moved under it.
 */
export const COVER_MEAN = 0.1655;

/** re-measure it — the check `tools/verify.js` runs, and how the constant was got */
export function measureCoverMean(oct = {}, n = 240, span = 24000) {
  let sum = 0, k = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const f = cloudFieldRaw((i / n - 0.5) * span, (j / n - 0.5) * span, oct);
      const t = clamp((f - COVER_EDGE[0]) / (COVER_EDGE[1] - COVER_EDGE[0]), 0, 1);
      sum += t * t * (3 - 2 * t); k++;
    }
  }
  return sum / k;
}
