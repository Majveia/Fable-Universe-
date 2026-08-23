// Aerial perspective — CLAUDE.md §9.3. M2 act 2, steps 3 and 4.
//
// Fog is what makes a valley read as depth rather than as a texture, and §9.3
// is specific that it is not one colour: it lerps toward the horizon-sun tint on
// a Mie term and toward the anti-solar tint away from it, with valley mist
// pooling separately in height *and* distance.
//
// The function also produces the one number the whole act exists for. §9.3:
//
//   "The fog fraction is written to the **alpha channel** so the post chain
//    knows each pixel's distance. That one trick enables §9.4's distance-graded
//    softening. Adopt it."
//
// The reference writes that fraction to a mutable GLSL global (`gFogAmt`) and
// returns only the colour. That is a convenience rather than a design, and it
// makes the value act 2 exists to produce the easiest thing in the function to
// forget — so this returns `vec4`: colour in `rgb`, fog fraction in `a`.
//
// ---------------------------------------------------------------------------
// The convention that a still cannot tell you about
//
// **`V` points from the surface toward the camera** — `normalize(uCamPos - P)`,
// which is what the reference uses at all ten of its call sites. Reversed, the
// Mie term inverts and the fog goes *cold* toward the sun and warm away from it.
// That still looks like fog. It is the wrong image, and nothing in a single
// frame would tell you which one you were looking at.
//
// ---------------------------------------------------------------------------
// What is AEON's rather than the reference's, and why
//
// The reference is one valley under one star, so each of its constants is a
// measurement of that place. §2 says the physics is never negotiable, so three
// of them cannot port as literals — `docs/plans/M2.md` §16.3 ruled on all three
// and `aerialParams()` below is that ruling:
//
//   a · `fogNear 70` / `fogFar 1700` are **extinction lengths**. They are a
//       property of the air, not of the world's size, so they scale with how
//       much air there is rather than with AEON's 1400 m surface extent. An
//       airless world takes `atmoAmt -> 0`, `fogFar -> huge`, and the fog
//       vanishes rather than needing a special case — which is the check that
//       this is the right parameterisation and not a fitted one.
//
//   b · The four air colours come **from the star**, through §9.6's transfer in
//       `starlight.js`, not from four hex literals. The reference's values are
//       the G-type fixture the transfer is pinned against.
//
//   c · The `260 m` height falloff is a **haze** scale height, not an
//       atmospheric one — Earth's atmospheric scale height is about 8.4 km, and
//       260 m is the shallow boundary-layer haze that pools in a valley, which
//       is exactly what the term is for. So it is a fixed fraction of the
//       world's own `H = RT/(Mg)`, and the fraction is set *by* the reference
//       rather than guessed.

import { airColours, hexToLinear } from './starlight.js';
import { SHAFTS_ON } from './cloudshade.js';

// ---------------------------------------------------------------------------
// the shape of the curve — the reference's, and not negotiable

/** §9.3's exponent. The curve is `1 - exp(-(d/far)^1.28 * 3.1 * heightFalloff)`. */
export const FOG_EXP = 1.28;
/** the depth of the curve at `fogFar`; 3.1 puts it at about 0.955 */
export const FOG_GAIN = 3.1;
/** how much of the fog the height falloff is allowed to remove */
export const HEIGHT_MIX = 0.72;

// ---------------------------------------------------------------------------
// the air, from the world's own numbers

const R_GAS = 8.314462618;          // J/(mol·K)
const G_EARTH = 9.80665;            // m/s²

/**
 * Earth, as the fixture. §9.1's anchor values are *"a temperate world"*, and
 * every constant below is anchored so that a temperate world reproduces the
 * reference exactly rather than approximately.
 *
 * `T` is the **surface** temperature, not the equilibrium one: Earth's
 * equilibrium temperature is 255 K and its surface is 288 K, and the 33 K
 * between them is the greenhouse effect, which `surfaceTemp()` restores.
 */
export const EARTH_AIR = { T: 288.15, M: 0.02896, g: G_EARTH };

/** dry-air scale height, `H = RT/(Mg)`. Earth comes out at 8436 m. */
export function scaleHeight(T, M, g) {
  return (R_GAS * T) / Math.max(M * g, 1e-12);
}

/**
 * The reference's 260 m, as a fraction of the scale height that produced it.
 *
 * §16.3 gives the coefficient as `260/8500`. Using the *computed* Earth scale
 * height instead of the rounded one is the same discipline taken one digit
 * further: the fraction is defined so that an Earth-like world reproduces the
 * reference's 260 m by construction, not to two significant figures.
 */
export const HAZE_FRACTION = 260 / scaleHeight(EARTH_AIR.T, EARTH_AIR.M, EARTH_AIR.g);

/**
 * Mean molar mass of the air, in kg/mol. AEON's generator carries no
 * composition, so this is the one place a world's chemistry is inferred — and
 * it is inferred from the only thing that actually decides it, which is whether
 * the world was massive and cold enough to keep hydrogen.
 */
export function molarMass(typeId) {
  return typeId >= 5 ? 0.00230 : 0.02896;   // H₂/He · N₂-O₂-CO₂
}

/**
 * Surface temperature from equilibrium temperature. A one-parameter greenhouse,
 * anchored on Earth: at `atmo = 1` it returns 288.2 K for Earth's 255 K
 * equilibrium, which is the measured 33 K of warming. A world with no air gets
 * no greenhouse, which is both correct and what makes the airless case fall out
 * of the same formula instead of needing a branch.
 */
export function surfaceTemp(Teq, atmo = 1) {
  return Math.max(Teq, 1) * (1 + 0.13 * Math.min(Math.max(atmo, 0), 3));
}

// ---------------------------------------------------------------------------
// how far you can see — the number this file was quietly getting wrong
//
// `fogFar 1700` is not a constant of nature. It is a **weather**, and naming it
// as one is the single largest correction this module has taken.
//
// Koschmieder's law puts meteorological visibility at `V = 3.912/β` for a 2%
// contrast threshold. §9.3's curve is not Beer–Lambert — the 1.28 exponent
// sees to that — but `far` carries the same meaning operationally: it is the
// distance at which the air has eaten about 95% of the contrast. At 1700 m
// that is, by the WMO's own scale, **mist** (1–2 km). The reference is one
// hand-composed valley 2400 m across, and it wanted its far wall dissolved, so
// mist is the correct choice *there*. AEON inherited the number without the
// composition that justified it.
//
// The cost was measurable and it was not where anyone expected. A ray-march of
// 5184 view rays against the real height field at the surface station put
// **100% of solid pixels below fog 0.1** — because at a 1.68 m eye height over
// flat ground everything visible is inside 200 m, and §9.3's curve has barely
// started there. So the near field was never the victim. The victims were the
// far ridges: `horizon.js` draws a skyline at 3–20 km, and at 1700 m of
// visibility every one of those pixels is fog = 1.000 — the flat haze colour,
// against a sky that was also a flat pale grey-blue. The hills did not read as
// hazy. They did not read at all.
//
// Naming the weather fixes both ends at once, and it is checkable: at 6 km the
// near field is untouched (fog 0.012 at 200 m), the middle ground keeps its
// colour (0.23 at 1 km), and the skyline sits in real haze without vanishing
// (0.83 at 4 km, 0.95 at 6 km). That is the benchmark's three planes, arrived
// at by choosing a visibility rather than by tuning a look.

/**
 * Meteorological visibility, in metres, by the WMO's own vocabulary.
 *
 * `mist` is the reference's fixture and stays reachable — a morning valley
 * genuinely looks like that, and a world's weather should be able to ask for
 * it. It is simply not what a clear day is.
 */
export const VISIBILITY = {
  fog: 700,        // WMO: below 1 km
  mist: 1700,      // 1–2 km — the reference's own air
  haze: 6000,      // 2–10 km — a clear temperate day with blued hills
  clear: 22000,    // above 10 km — desert, high altitude, thin air
};

/** the fixture's visibility, so nothing that omits the argument moves */
export const REFERENCE_VISIBILITY = VISIBILITY.mist;

/**
 * §16.3's rulings, applied to one world. Returns the numbers the shader needs,
 * in metres.
 *
 * `world` wants `{ Teq, massE, radiusE, typeId }` — the fields `system.js`
 * already puts on every planet — plus how much air it has (`atmo`, the same
 * 0.25 / 0.4 / 1.0 `surface.js` computes) and the resonance's `hazeX`, which is
 * a mood multiplier on the air and the one term here that is art rather than
 * physics.
 *
 * `opts.visibility` is the weather (see `VISIBILITY`). It defaults to the
 * reference's mist so that the three-argument call this function has always
 * had returns exactly what it always returned — `tools/verify.js` pins that to
 * 70 m and 1700 m and it should keep doing so. A caller that knows what the
 * weather is says so.
 *
 * `opts.mistBase` is the altitude the valley-mist band is measured *from*.
 * §9.3's `smoothstep(46 → 8)` is a height above the valley floor, and the
 * reference could write it as an absolute because its world has exactly one
 * floor, at y ≈ 0. AEON's `worldY` is metres above the planet's datum, so on a
 * world whose land happens to sit below 46 m the term stops being "mist in the
 * hollows" and becomes "mist everywhere past 420 m" — which is +0.16 of fog
 * and a 45% pull toward `#D6DDD4` over the entire distance, i.e. precisely the
 * pale mint wash this pass was sent to find. Defaults to 0, which is the
 * reference's own datum.
 */
export function aerialParams(world, atmo = 1, hazeX = 1, opts = {}) {
  const { visibility = REFERENCE_VISIBILITY, mistBase = 0 } = opts;
  const thickness = Math.max(atmo * hazeX, 0);
  const g = G_EARTH * (world.massE ?? 1) / Math.max((world.radiusE ?? 1) ** 2, 1e-6);
  const H = scaleHeight(surfaceTemp(world.Teq ?? 255, atmo), molarMass(world.typeId ?? 1), g);

  // The near plane is a fixed fraction of the far one, not a fixed distance.
  // 70/1700 is the reference's ratio, and holding it keeps the *shape* of the
  // curve identical at every visibility — so changing the weather changes how
  // far you can see and nothing else about how the air looks.
  const NEAR_RATIO = 70 / REFERENCE_VISIBILITY;

  // Thickness zero is a vacuum, and a vacuum has no extinction length at all.
  // Rather than a branch, the length goes to a number so large that
  // `(d/far)^1.28` underflows to nothing over any distance a surface can span —
  // which is the same answer, arrived at by the same formula.
  const k = thickness > 1e-4 ? 1 / thickness : 1e6;
  return {
    near: Math.min(visibility * NEAR_RATIO * k, 1e9),
    far: Math.min(visibility * k, 1e9),
    hazeH: Math.max(H * HAZE_FRACTION, 1e-3),
    mistBase,
    // Valley mist is condensate suspended in the boundary layer, so it needs
    // air to be suspended in. Scaling the extinction length alone left an
    // airless world with 0.16 of pooled fog in its valleys — a moon with mist
    // in it, which is what the §16.3a check was written to catch. Saturating
    // at 1 keeps a temperate world at the reference's own value exactly.
    // (How *wet* the air is belongs to the ocean and the weather, which are
    // acts 4 and 5; this is only the necessary condition.)
    mistAmt: Math.min(thickness, 1),
  };
}

/**
 * The four air colours §9.3 mixes between, for a given star. Linear RGB.
 *
 * `airColours()` derives all ten of §9.1's stops; this names the four the fog
 * reads, so a caller does not have to know which entries of the table are air.
 */
export function airFor(T, elev) {
  const a = airColours(T, elev);
  return { haze: a.haze, mist: a.mist, horizonSun: a.skyHorizonSun, anti: a.skyAnti };
}

/** the fixture's air — §9.1's four values exactly, for a temperate world */
export const REFERENCE_AIR = {
  haze: hexToLinear('#A9BCC7'),
  mist: hexToLinear('#D6DDD4'),
  horizonSun: hexToLinear('#FBE2AE'),
  anti: hexToLinear('#C8D4D6'),
};

/** the reference's own constants, for the world it was measured in */
export const REFERENCE_PARAMS = { near: 70, far: 1700, hazeH: 260, mistAmt: 1 };

// ---------------------------------------------------------------------------
// the function, twice

const clamp = (x, lo, hi) => Math.min(Math.max(x, lo), hi);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * §9.3 on the CPU — the reference §7.3 requires before any of this reaches a
 * fragment shader, and the same arithmetic `AERIAL_GLSL` performs.
 *
 * `V` points from the surface **toward the camera**; `sun` points at the sun;
 * both unit. `worldY` is metres above the datum. Returns the composited colour,
 * the fog fraction that belongs in alpha, and the fog colour itself (which the
 * suite reads to tell a hue shift from a brightness one).
 */
export function aerial(col, dist, V, sun, worldY,
  { near, far, hazeH, mistAmt = 1, mistBase = 0 } = REFERENCE_PARAMS, air = REFERENCE_AIR) {
  // §9.3: guard the NaN — a poisoned depth must not poison the colour. NaN
  // fails all three comparisons, so it lands on "maximally distant", which
  // resolves to the fog colour: wrong, but in gamut and finite.
  const d0 = (dist < 0 || dist > 0 || dist === 0) ? Math.min(dist, 1e6) : 1e6;

  const d = Math.max(d0 - near, 0);
  const hf = 1 + (Math.exp(-Math.max(worldY - 6, 0) / hazeH) - 1) * HEIGHT_MIX;
  let f = 1 - Math.exp(-Math.pow(d / far, FOG_EXP) * FOG_GAIN * hf);

  // the fog is not one colour: warm toward the sun on a Mie term, cool away
  const vs = -(V[0] * sun[0] + V[1] * sun[1] + V[2] * sun[2]);
  const mie = Math.pow(clamp(vs, 0, 1), 3.4);
  let fc = mix3(air.haze, air.horizonSun, mie * 0.88);
  fc = mix3(fc, air.anti, clamp(vs, -1, 0) * -0.32);

  // valley mist pools separately — low *and* far, never one without the other,
  // and "low" is measured from the valley floor rather than from the datum
  const pool = (1 - smoothstep(8, 46, worldY - mistBase)) * smoothstep(120, 420, d0) * mistAmt;
  fc = mix3(fc, air.mist, pool * 0.45);
  // The mist composes with the haze rather than adding to it. Extinction along
  // a ray is multiplicative — two layers of air leave `(1-f₁)(1-f₂)` of the
  // original contrast, not `1 - f₁ - f₂` — and the additive form let a distance
  // that was already at 0.95 be pushed to a hard 1.000, which is the one value
  // at which a depth cue stops being a depth cue.
  f = clamp(f + pool * 0.16 * (1 - f), 0, 1);

  return { col: mix3(col, fc, f), fog: f, fc };
}

/**
 * The same arithmetic as GLSL, for injection into any surface-scale fragment
 * shader. Include once, call per fragment, write the `.a` straight through to
 * `gl_FragColor` — that alpha is the distance the print reads in §9.4 step 5.
 *
 * It declares its own uniforms, all prefixed `uAir`, so it collides with
 * nothing already in a shader.
 */
export const AERIAL_GLSL = /* glsl */`
  uniform vec3 uAirHaze;
  uniform vec3 uAirMist;
  uniform vec3 uAirHorizonSun;
  uniform vec3 uAirAnti;
  uniform float uAirNear;     // extinction lengths, metres — a property of the
  uniform float uAirFar;      // air, not of the world's size
  uniform float uAirHazeH;    // boundary-layer haze scale height, metres
  uniform float uAirMistAmt;  // 0 on an airless world — mist needs air to hang in
  // The altitude the valley-mist band is measured from. A shader whose host
  // never sets it gets 0, which is the reference's datum and this module's
  // previous behaviour — so the uniform is safe to add ahead of its callers.
  uniform float uAirMistBase;

  // §9.3's NaN guard. A NaN fails all three comparisons, so it resolves to
  // "maximally distant" rather than smearing a NaN through the colour — and a
  // NaN that survives to the bloom pyramid comes back as a solid block (§11).
  float aerialDepth(float d) {
    return (d < 0.0 || d > 0.0 || d == 0.0) ? min(d, 1e6) : 1e6;
  }

  // rgb: the composited colour. a: clarity, 1 - fog — see the note on
  // AERIAL_ALPHA_IS_CLARITY in this module for why it is stored inverted.
  // Overloaded rather than replaced: §9.3 is threaded into two dozen materials
  // and a signature change would have been two dozen edits to give six surfaces
  // a shaft. GLSL has overloading; this is what it is for.
  //
  // The shaft arrives as a *value*, not as a call into cloudshade.js. The
  // first version forward-declared cloudShaft() here and let this chunk call
  // it, and every prop material in the world stopped compiling: painted.js
  // injects §9.3 into a MeshStandardMaterial that has no reason to carry a
  // ray march, and a forward declaration with no definition is a link error
  // rather than a missing feature. Whoever has the march computes it; whoever
  // does not passes 1.0 and gets exactly the air they had before.
  vec4 aerial(vec3 col, float dist, vec3 V, vec3 sunDir, float worldY,
              float shaft) {
    float d0 = aerialDepth(dist);
    float d = max(d0 - uAirNear, 0.0);

    // the air thins with altitude, which is what stops a valley floor and a
    // ridge top at the same distance from reading identically
    float hf = 1.0 + (exp(-max(worldY - 6.0, 0.0) / uAirHazeH) - 1.0) * ${HEIGHT_MIX.toFixed(2)};
    float f = 1.0 - exp(-pow(d / uAirFar, ${FOG_EXP.toFixed(2)}) * ${FOG_GAIN.toFixed(1)} * hf);

    // V points surface -> camera, so looking INTO the sun is vs -> +1.
    // Reversed, this term inverts and the fog goes cold toward the sun.
    float vs = -dot(V, sunDir);
    // §M-shafts · the air the sun reaches, against the air it does not.
    //
    // This is the whole of the effect and it is one multiply, because the Mie
    // term is *already* the in-scattered sunlight: it is what turns the haze
    // warm when you look toward the sun. Scaling it by how much of that column
    // of air the sun actually gets to is not an addition to the model, it is
    // the correction the model was missing — the haze had been lit through the
    // deck as though the deck were not there.
    //
    // So a gap in the cloud is a bright column and the cloud beside it is a
    // dark one, and both are the same function that darkened the meadow. You
    // can follow the beam down and stand in the lit patch at the bottom of it.
    float mie = pow(clamp(vs, 0.0, 1.0), 3.4) * clamp(shaft, 0.0, 1.0);
    vec3 fc = mix(uAirHaze, uAirHorizonSun, mie * 0.88);
    fc = mix(fc, uAirAnti, clamp(vs, -1.0, 0.0) * -0.32);

    // Valley mist: low AND far, never one without the other. Written as an
    // inverted ascending smoothstep rather than smoothstep(46.0, 8.0, y) —
    // the two are algebraically identical, and GLSL leaves a descending
    // smoothstep undefined.
    float pool = (1.0 - smoothstep(8.0, 46.0, worldY - uAirMistBase))
               * smoothstep(120.0, 420.0, d0) * uAirMistAmt;
    fc = mix(fc, uAirMist, pool * 0.45);
    // multiplicative, not additive — see the CPU port's note
    f = clamp(f + pool * 0.16 * (1.0 - f), 0.0, 1.0);

    return vec4(mix(col, fc, f), 1.0 - f);
  }

  vec4 aerial(vec3 col, float dist, vec3 V, vec3 sunDir, float worldY) {
    return aerial(col, dist, V, sunDir, worldY, 1.0);
  }
`;

/**
 * §9.3 says to write the fog fraction to alpha. AEON writes `1 - fog`, and the
 * difference is not cosmetic.
 *
 * The reference can store fog directly because every surface in it goes through
 * `aerial()`. AEON has dozens of surface-scale materials — rocks, trees, ruins,
 * a whole city generator, three.js's own built-ins — and every one of them
 * writes `a = 1` for an opaque fragment, because that is what alpha has always
 * meant. Under "alpha *is* fog", each of those reads as **maximally distant**,
 * and §9.4 step 5 answers by pouring its heaviest watercolour wash over the
 * nearest tree in the frame. The failure is silent, it is worst on the objects
 * closest to the camera, and it looks like a bug in the blur rather than like
 * an unported material.
 *
 * Inverted, `a = 1` means *clear*, which is what an opaque material already
 * means by it. An unported surface then reads as "no fog" — sharp, untouched,
 * exactly as it renders today — and porting one is a visible improvement rather
 * than the removal of a defect. The only surface that has to opt in explicitly
 * is the sky, which writes `a = 0` because it genuinely is at infinity.
 *
 * Same information, same one channel, same single trick. The encoding is chosen
 * so that the default is correct and the omission is safe.
 */
export const AERIAL_ALPHA_IS_CLARITY = true;

/**
 * The uniform block `AERIAL_GLSL` expects, built from a world. Spread into a
 * material's `uniforms` — the values are plain arrays and numbers, so a caller
 * that wants to share one object across materials can hold these and mutate
 * `.value` as the sun moves.
 */
export function aerialUniforms(world, atmo = 1, hazeX = 1, starT = 5778, elev = 13.5, opts = {}) {
  const p = aerialParams(world, atmo, hazeX, opts);
  const a = airFor(starT, elev);
  return {
    uAirHaze: { value: a.haze },
    uAirMist: { value: a.mist },
    uAirHorizonSun: { value: a.horizonSun },
    uAirAnti: { value: a.anti },
    uAirNear: { value: p.near },
    uAirFar: { value: p.far },
    uAirHazeH: { value: p.hazeH },
    uAirMistAmt: { value: p.mistAmt },
    uAirMistBase: { value: p.mistBase ?? 0 },
  };
}

/**
 * The weather a world actually has, from the world.
 *
 * Two things decide how far you can see through air, and AEON knows both. Air
 * that is *thin* scatters less per metre, so a Mars-like world sees for tens of
 * kilometres. Air that is *cold* holds less water, and water is what most
 * boundary-layer aerosol is made of, so a frozen world is clearer than a warm
 * humid one at the same pressure. Both terms are anchored so an Earth-like
 * temperate world lands on `VISIBILITY.haze` — a clear day with blued hills,
 * which is what §9.7's golden-hour spawn is composed for.
 *
 * A world's *mood* still gets the last word through `hazeX`: that is the
 * resonance's knob and it is deliberately art, which is why it is a separate
 * multiplier rather than a term in here.
 */
export function visibilityFor(world = {}, atmo = 1) {
  if (atmo <= 1e-4) return VISIBILITY.clear * 40;    // vacuum: you see forever
  const T = surfaceTemp(world.Teq ?? 255, atmo);
  // Saturation vapour pressure roughly doubles every 10 K (August–Roche–Magnus,
  // linearised about 288 K), so a warm world can hold far more water. But the
  // aerosol *optical depth* does not follow the vapour column linearly — the
  // measured AOD–precipitable-water relations go as roughly its cube root,
  // because most of the extra water ends up as cloud rather than as haze. Using
  // the vapour pressure raw gave a 34× swing across the habitable band and put
  // a merely warm world into WMO fog, which is a formula overreaching its data.
  const humid = Math.pow(Math.pow(2, (T - 288.15) / 10), 0.35);
  const load = Math.min(Math.max(atmo * humid, 0.15), 6);
  return Math.min(Math.max(VISIBILITY.haze / load, VISIBILITY.fog), VISIBILITY.clear * 40);
}

/**
 * Aerial perspective, injected into a material three.js owns.
 *
 * `uniforms` is `aerialUniforms()` (or `surface.js`'s shared block) plus
 * `uSunDir` and `uCam`. Sharing one object across every material is the point:
 * the sun moves once per frame and forty-six materials follow.
 *
 * `bucket` is `solid` or `veil`. A solid writes clarity into alpha, which is
 * what the print reads for distance. A veil — anything transparent or additive
 * — composites its colour and leaves alpha alone, because there alpha is
 * already carrying coverage and overwriting it would make a glow opaque.
 *
 * Idempotent, and returns the material, so it can be dropped into an existing
 * expression.
 */
export function applyAerial(material, uniforms, { bucket = 'solid', enabled = true } = {}) {
  if (!enabled || !material || !uniforms) return material;
  // A ShaderMaterial owns its own source: injecting into one would be editing
  // somebody's shader from the outside, and every such material in this repo
  // already calls `aerial()` itself.
  if (material.isShaderMaterial || material.isRawShaderMaterial) return material;
  if (material.userData?.aerial) return material;
  (material.userData ||= {}).aerial = bucket;

  const prev = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    if (prev) prev.call(material, shader, renderer);
    Object.assign(shader.uniforms, uniforms);

    // `mvPosition` exists as a local inside project_vertex, but world space is
    // what the air is measured in, so the world position is rebuilt here the
    // same way three builds the view one.
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vAirW;\nvoid main() {')
      .replace('#include <project_vertex>', /* glsl */`#include <project_vertex>
        vec4 airWorld = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
          airWorld = instanceMatrix * airWorld;
        #endif
        vAirW = (modelMatrix * airWorld).xyz;`);

    const composite = bucket === 'veil'
      // a veil keeps its coverage: only the colour goes through the air
      ? 'gl_FragColor.rgb = aerialOut.rgb;'
      : 'gl_FragColor = aerialOut;';

    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', /* glsl */`varying vec3 vAirW;
        uniform vec3 uSunDir;
        uniform vec3 uCam;
${AERIAL_GLSL}
        void main() {`)
      // Immediately after opaque_fragment, which is where gl_FragColor first
      // exists — and before three's own tonemapping and colorspace chunks,
      // because the air scatters linear light. three applies its built-in fog
      // after both, which is a compromise this does not have to inherit.
      .replace('#include <opaque_fragment>', /* glsl */`#include <opaque_fragment>
        {
          vec3 airToCam = uCam - vAirW;
          float airDist = length(airToCam);
          vec4 aerialOut = aerial(gl_FragColor.rgb, airDist,
            airDist > 1e-5 ? airToCam / airDist : vec3(0.0, 1.0, 0.0),
            uSunDir, vAirW.y);
          ${composite}
        }`);
  };

  // three hashes programs by material configuration and knows nothing about
  // onBeforeCompile — see the header. Without this an injected material can
  // silently receive an uninjected material's program, and which one wins
  // depends on render order.
  const prevKey = material.customProgramCacheKey;
  material.customProgramCacheKey = function key() {
    return (prevKey ? prevKey.call(this) : '') + '|aerial:' + bucket;
  };
  material.needsUpdate = true;
  return material;
}
