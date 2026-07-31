// Aerial perspective — CLAUDE.md §9.3. M2 act 2, step 3.
//
// The depth cue that makes a valley read as a valley. Without it a far ridge is
// a near ridge that happens to be small, and §8's third axis — three separable
// depth planes — cannot be scored at all.
//
// Ported from `docs/reference/hoshi-no-tani.html` lines 686–700, per §9: when
// §9.3's summary and the file disagree, the file wins. The CPU reference came
// first (§7.3) and is the twin at the bottom of this comment block; it has been
// green for two commits under `node tools/verify.js aerial`.
//
// ---------------------------------------------------------------------------
// The one convention that has to be right, and cannot be checked by looking
//
// **`V` points from the surface toward the camera.** That is the reference's
// convention at all ten of its call sites. Reversed, the Mie term inverts and
// the fog goes *cold* toward the sun and warm away from it. That still looks
// like fog. It is the wrong image, and nothing in a still would tell you.
//
// So `aerial()` does not take `V`. It takes the two **positions** and computes
// the direction itself, which makes the reversal unrepresentable rather than
// merely documented. A call site cannot get this wrong.
//
// ---------------------------------------------------------------------------
// Three constants that cannot port as literals, and the one idea that ports
// all three
//
// The reference is one valley under one star, so each of its numbers is a
// measurement of that place. §2 says the physics is never negotiable, and
// docs/plans/M2.md §16.3 ruled on each:
//
//   a · `fogNear 70` / `fogFar 1700` are extinction lengths — a property of the
//       air, not of the world's size. They scale with how much air there is.
//   b · The four air colours must come from the star (§9.6's ruling, which
//       `starlight.js` already implements as a transfer rather than a table).
//   c · `260 m` is a *haze* scale height — the shallow boundary layer that pools
//       in a valley — not the atmospheric one. It scales with `kT/(mg)`.
//
// (a) and (c) are the same idea twice: **normalise the coordinate frame and the
// reference's constants apply verbatim.**
//
//     dn = dist · thickness      horizontal, in fixture metres
//     yn = (y − base) / hazeScale    vertical, in fixture metres
//
// Two numbers per world, both of them ratios to the reference's own world, and
// the function between them is the reference's line for line. It also disposes
// of the airless case without a special case: `thickness → 0` sends `dn → 0`,
// which is inside `fogNear`, so the fog vanishes and the mist with it. §16.3
// names that as the check that this is the right parameterisation rather than a
// fitted one, and it is why the scaling is a multiply here and a divide in the
// plan — `1700 / thickness` needs an epsilon at zero and this does not.
//
// ---------------------------------------------------------------------------
// One deviation from the signed-off plan, and why
//
// §16.3(c) signed off `H_haze = 0.0306 · H_atm`, the coefficient being 260/8500.
// 8500 m is Earth's scale height at a **surface** temperature of 288 K. The
// only temperature AEON computes is `Teq`, the equilibrium temperature — 255 K
// for Earth, because equilibrium temperature knows nothing about a greenhouse.
// Applying a coefficient derived at 288 K to a scale height computed at 255 K
// shortens every world's haze layer by 12% for no physical reason.
//
// So the coefficient is gone and `hazeScale` is a pure ratio to the fixture's
// own scale height. The reference supplies 260 m; physics supplies only how far
// a given world departs from the world that measurement was taken in. Same
// discipline as `thickness`, and an Earth-like world now reproduces the
// reference's 260 m exactly rather than to within 12%.
//
// ---------------------------------------------------------------------------
// Alpha
//
// §9.3's other half: the fog fraction goes in the alpha channel so the post
// chain knows each pixel's distance, which is what §9.4 step 5 spends on
// distance-graded watercolour softening. `aerial()` returns it — the reference
// smuggles it out through a mutable global `gFogAmt`, which is a GLSL
// convenience rather than a design, and it makes the one value this function
// exists to produce the easiest thing in it to forget.

import { airColours, airColoursQuantised, hexToLinear } from './starlight.js';

// --------------------------------------------------------------- physics ---

const KB = 1.380649e-23;      // Boltzmann, J/K
const G_EARTH = 9.80665;      // m/s²
/**
 * Mean molecular mass of Earth air, kg. AEON does not model atmospheric
 * composition, so this is fixed across worlds and the *stated* limit of how far
 * the scale height below is a physical number: it tracks a world's temperature
 * and gravity honestly and assumes everyone breathes nitrogen.
 */
const M_AIR = 28.964e-3 / 6.02214076e23;

/** the reference's own world — §9.1's anchor values are measurements of it */
export const FIXTURE_AIR = {
  /** Earth's equilibrium temperature, the quantity AEON actually computes */
  Teq: 255,
  gravity: G_EARTH,
  /** the reference's measured haze scale height, in metres */
  hazeH: 260,
};

/** kT/(mg) — the height an isothermal atmosphere falls by a factor of e */
export function scaleHeight(Teq, gravity) {
  return (KB * Teq) / (M_AIR * Math.max(gravity, 1e-3));
}

/** 7465 m. The fixture's, so `hazeScale` can be a ratio and not a coefficient */
const H_FIXTURE = scaleHeight(FIXTURE_AIR.Teq, FIXTURE_AIR.gravity);

/**
 * The air of a world, as the two normalising numbers §9.3 needs.
 *
 * `thickness` is optical depth relative to the fixture's air: the world's own
 * atmosphere strength times the resonance's haze multiplier. The first is
 * physical and the second is art direction, which §3 permits in that order —
 * *"the numbers are never negotiable; the palette always is."* Haze thickness
 * is a mood knob that was already in the codebase; what it must not do is
 * change the *shape* of the curve, and it cannot, because it only rescales an
 * axis.
 *
 * `hazeScale` is the boundary layer's depth relative to the fixture's 260 m,
 * from the world's own temperature and surface gravity.
 *
 * `base` is the world's datum in world-space metres — sea level where there is
 * a sea. Height in §9.3 is height above the valley floor, and a world whose
 * terrain sits at y = +400 would otherwise never pool any mist at all.
 */
export function airFor({ massE = 1, radiusE = 1, Teq = FIXTURE_AIR.Teq } = {},
  { atmo = 1, hazeX = 1, base = 0 } = {}) {
  const gravity = (G_EARTH * massE) / Math.max(radiusE * radiusE, 1e-6);
  const hazeScale = scaleHeight(Teq, gravity) / H_FIXTURE;
  return {
    thickness: Math.max(atmo * hazeX, 0),
    hazeScale: Math.max(hazeScale, 1e-3),
    base,
    gravity,
    /** in metres, for anything that wants to report it */
    hazeH: FIXTURE_AIR.hazeH * hazeScale,
  };
}

/**
 * The four colours §9.3 mixes between, for a star. §9.6's transfer, so a world
 * around an M dwarf gets warmer haze the same way it gets a warmer sun.
 *
 * `T` in kelvin, `elev` the sun's elevation in degrees.
 *
 * `quantised` shares `paint.js`'s memo — which is the point of putting the memo
 * in `starlight.js` rather than in either caller: the light model and the air
 * ask for the same table at the same elevation on the same frame, so a bucket
 * change costs one spectral integral between them and not two. Off by default,
 * for the reason `lightFor` gives.
 */
export function airPalette(T = 5778, elev = 13.5, quantised = false) {
  const a = quantised ? airColoursQuantised(T, elev) : airColours(T, elev);
  return { haze: a.haze, mist: a.mist, horizonSun: a.skyHorizonSun, anti: a.skyAnti };
}

/** the fixture's four, which are §9.1's painted values exactly */
export const REFERENCE_PALETTE = {
  haze: hexToLinear('#A9BCC7'),
  mist: hexToLinear('#D6DDD4'),
  horizonSun: hexToLinear('#FBE2AE'),
  anti: hexToLinear('#C8D4D6'),
};

// ------------------------------------------------------------------ §9.3 ---

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * §9.3, on the CPU. The twin of `AERIAL_GLSL` below — same arithmetic in the
 * same order, which is what makes the pixel diff in `tools/pixeldiff.js` a test
 * of the port rather than of two independent guesses.
 *
 * `P` is the shaded point, `camPos` the camera, `sun` a unit vector pointing at
 * the sun, all in world metres. Returns the composited colour and the fog
 * fraction §9.3 puts in alpha.
 */
export function aerial(col, P, camPos, sun, height = null, air = {}, palette = REFERENCE_PALETTE) {
  const { thickness = 1, hazeScale = 1, base = 0 } = air;

  const dx = camPos[0] - P[0], dy = camPos[1] - P[1], dz = camPos[2] - P[2];
  const raw = Math.sqrt(dx * dx + dy * dy + dz * dz);

  // §9.3's one defensive line, and the whole of it. NaN fails every comparison,
  // so a single bound catches a poisoned position and a numeric overflow
  // together — and every branch off it is a *select*, never arithmetic, because
  // `NaN · 0` is NaN and a guard that multiplies by zero does not guard.
  //
  // Deriving `V` from the two positions is what makes the reversal in the header
  // unrepresentable, and it is also what puts `V` on the poisoned path: the old
  // signature took `V` as a parameter, so a bad depth could not reach it. One
  // flag now covers both, and the failure mode is the right one — `V = 0` gives
  // `vs = 0`, which is neutral haze at full fog. A bad pixel becomes distant
  // air: the least wrong thing it can look like, and flat, so the bloom
  // downsample chain has nothing to smear (§11).
  const finite = raw < 1e6;
  const dRaw = finite ? raw : 1e6;
  const inv = finite && raw > 1e-6 ? 1 / raw : 0;
  const V = finite ? [dx * inv, dy * inv, dz * inv] : [0, 0, 0];

  // normalise both axes into the fixture's frame (see the header)
  const dn = dRaw * thickness;
  const h = height === null ? P[1] - base : height;
  const yn = finite ? h / hazeScale : 0;

  const d = Math.max(dn - 70, 0);
  const hf = 1 + (Math.exp(-Math.max(yn - 6, 0) / 260) - 1) * 0.72;
  let f = 1 - Math.exp(-Math.pow(d / 1700, 1.28) * 3.1 * hf);

  // Mie: warm toward the sun, cool away. `vs` is +1 looking straight at it.
  const vs = -(V[0] * sun[0] + V[1] * sun[1] + V[2] * sun[2]);
  const mie = Math.pow(clamp(vs, 0, 1), 3.4);
  let fc = mix3(palette.haze, palette.horizonSun, mie * 0.88);
  fc = mix3(fc, palette.anti, clamp(vs, -1, 0) * -0.32);

  // mist pools in the valley floor — low *and* far, never one without the other
  const pool = smoothstep(46, 8, yn) * smoothstep(120, 420, dn);
  fc = mix3(fc, palette.mist, pool * 0.45);
  f = clamp(f + pool * 0.16, 0, 1);

  return { col: mix3(col, fc, f), fog: f, fc, dist: dRaw };
}

/**
 * The same arithmetic as GLSL, for injection into any surface-scale fragment
 * shader at the point it currently does its own fog.
 *
 * It declares its own uniforms, all prefixed `uAir`, and takes positions rather
 * than directions, so it collides with nothing and cannot be called with the
 * view vector backwards. Include once per shader; call per fragment:
 *
 *     vec4 air = aerial(lit, vW, uCam, uSunDir);
 *     gl_FragColor = vec4(air.rgb, air.a);   // §9.3: fog fraction into alpha
 */
export const AERIAL_GLSL = /* glsl */`
  uniform vec3 uAirHaze;
  uniform vec3 uAirMist;
  uniform vec3 uAirHorSun;
  uniform vec3 uAirAnti;
  uniform float uAirThickness;   // optical depth, relative to the fixture's air
  uniform float uAirHazeScale;   // boundary-layer depth, relative to 260 m
  uniform float uAirBase;        // the world's datum in world y, metres

  // height is metres above the world's datum — sea level where there is a sea.
  // It is a parameter and NOT P.y, because AEON has two surface scales and only
  // one of them is flat: at planet scale the camera sits at the origin and up
  // is radial, so a tile's world y is its latitude rather than its altitude.
  // Deriving it here would put a pole 6371 km above the haze layer. Every
  // caller knows its own geometry; this function should not have to guess.
  vec4 aerial(vec3 col, vec3 P, vec3 camPos, vec3 sunDir, float height) {
    vec3 toCam = camPos - P;
    float raw = length(toCam);

    // A poisoned depth must not poison the colour, and NaN fails every
    // comparison — so one bound catches NaN and overflow together. Every branch
    // off it is a ternary, which is a genuine select: mix() is arithmetic, and
    // NaN * 0.0 is NaN, so a guard that multiplies by zero does not guard.
    // V = 0 gives vs = 0, which is neutral haze at full fog — a bad pixel
    // becomes distant air, flat, with nothing for the bloom chain to smear.
    bool finite = raw < 1.0e6;
    float dist = finite ? raw : 1.0e6;
    vec3 V = (finite && raw > 1.0e-6) ? toCam / raw : vec3(0.0);

    // both axes into the fixture's frame, so the constants below are the
    // reference's verbatim
    float dn = dist * uAirThickness;
    float yn = finite ? height / max(uAirHazeScale, 1.0e-3) : 0.0;

    float d = max(dn - 70.0, 0.0);
    float hf = 1.0 + (exp(-max(yn - 6.0, 0.0) / 260.0) - 1.0) * 0.72;
    float f = 1.0 - exp(-pow(d / 1700.0, 1.28) * 3.1 * hf);

    // Mie: warm toward the sun, cool away from it. Fog is not one colour.
    float vs = -dot(V, sunDir);
    float mie = pow(clamp(vs, 0.0, 1.0), 3.4);
    vec3 fc = mix(uAirHaze, uAirHorSun, mie * 0.88);
    fc = mix(fc, uAirAnti, clamp(vs, -1.0, 0.0) * -0.32);

    // mist pools in the valley floor: low AND far, never one without the other
    float pool = smoothstep(46.0, 8.0, yn) * smoothstep(120.0, 420.0, dn);
    fc = mix(fc, uAirMist, pool * 0.45);
    f = clamp(f + pool * 0.16, 0.0, 1.0);

    return vec4(mix(col, fc, f), f);
  }
`;

/**
 * The uniform block `AERIAL_GLSL` declares, as three.js uniforms.
 *
 * `Vec3` is passed in rather than imported so this module stays free of three —
 * it is imported by `tools/verify.js` and `tools/pixeldiff.js`, which have no
 * renderer, and by four shaders, which do.
 */
export function aerialUniforms(Vec3, air, palette = REFERENCE_PALETTE) {
  const v = (c) => ({ value: new Vec3(c[0], c[1], c[2]) });
  return {
    uAirHaze: v(palette.haze),
    uAirMist: v(palette.mist),
    uAirHorSun: v(palette.horizonSun),
    uAirAnti: v(palette.anti),
    uAirThickness: { value: air.thickness },
    uAirHazeScale: { value: air.hazeScale },
    uAirBase: { value: air.base },
  };
}

/** re-point an existing uniform block at a new palette, as the sun moves */
export function syncAerialPalette(uniforms, palette) {
  uniforms.uAirHaze.value.set(...palette.haze);
  uniforms.uAirMist.value.set(...palette.mist);
  uniforms.uAirHorSun.value.set(...palette.horizonSun);
  uniforms.uAirAnti.value.set(...palette.anti);
}
