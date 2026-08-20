// Rain, snow, and what decides which.
//
// `weather.js` is 153 lines and draws a curtain of points that falls at a
// constant speed on every world. The reference's `weather/precipitation.js` is
// 1 929, and the gap is not polish — it is four ideas, each of which fixes
// something that reads as wrong rather than as plain.
//
// Method from `docs/reference/sakura-realm/src/weather/precipitation.js`
// (MIT, © 2026 Leonxlnx). Per §10 the method ports and the file does not.
//
// ---------------------------------------------------------------------------
// The four
//
// **1 · Wrap, do not respawn.** A box centred on the camera, particles wrapped
// modulo the box. That keeps density exactly constant while you walk or fly and
// costs one `mod()`. Respawning always produces visible density waves trailing
// a moving camera — which is the tell that says "particle system" out loud.
//
// **2 · Rain is analytic.** `position = f(seed, t)` evaluated in the vertex
// shader, so the largest particle count in the scene never touches the CPU.
// Snow is CPU-integrated *because it has to be*: it is slow enough that the
// wind actually carries it, and the wind field is a CPU function (§6 M3's one
// field, which everything here samples rather than growing a second).
//
// **3 · A minimum pixel footprint, with alpha scaled by the inverse.** Every
// primitive here goes sub-pixel at distance, and thin sub-pixel quads are the
// worst shimmer source in any weather effect. Widening the primitive and
// dimming it by the same factor is energy-conserving anti-aliasing and is
// effectively free. This one generalises well beyond rain.
//
// **4 · Splashes are camera-local.** Nobody sees a splash at 80 m, so nothing
// is spent there.
//
// ---------------------------------------------------------------------------
// What AEON adds: precipitation is a readout of the air
//
// The reference falls at one speed because it has one world. Here a drop
// reaches **terminal velocity**, where drag balances weight:
//
//     v_t = sqrt( 2·m·g / (ρ · C_d · A) )
//
// and AEON knows `g` and can derive `ρ` from the world's atmosphere. Both are
// already on the planet record, so this costs nothing and it means:
//
//   · a thin-atmosphere world's rain falls fast and nearly straight, because
//     there is little air to slow it and little wind pressure to lean it;
//   · a thick one's drifts down slowly and leans hard, and on Venus-like air it
//     is closer to falling through water than through sky;
//   · a low-gravity world's rain hangs, which is the same law that made its
//     trees tall (`src/tree.js`).
//
// And **whether it is rain at all** follows from surface temperature rather
// than from a flag: below freezing it is snow, above it is rain, and in the
// band between they mix — which is sleet, and is a real thing that happens at a
// real temperature.
//
// No THREE, no clock: the physics is arithmetic, so `tools/verify.js` measures
// it without a GPU.

const G_EARTH = 9.80665;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);

/** Earth sea-level air density, kg/m³ */
export const RHO_EARTH = 1.225;
/** water, kg/m³ — a raindrop is water wherever it falls */
const RHO_WATER = 1000;
/** a falling sphere, in the Reynolds range a raindrop actually occupies */
const CD_DROP = 0.47;
/** a snowflake is a plate, not a sphere, and that is most of why it is slow */
const CD_FLAKE = 1.35;
/** fresh snow, kg/m³ — two orders below water, which is the rest of the reason */
const RHO_SNOW = 90;

/**
 * Terminal velocity of a falling particle, m/s.
 *
 * `v_t = sqrt(2mg / (ρ_air · C_d · A))`, and for a sphere of radius `r` the
 * mass-over-area ratio collapses to `(4/3)·r·ρ_body`, so the whole thing is
 * four numbers and no table.
 *
 * Against Gunn & Kinzer (1949), who dropped real water down a real tower:
 *
 *     diameter   measured   this model
 *     1.0 mm      4.0 m/s     4.8
 *     2.5 mm      7.2         7.5
 *     5.0 mm      9.1        10.7
 *
 * Within ~15% up to 2.5 mm and 17% high at 5. The error is all in one place and
 * it is worth naming rather than tuning away: **a large raindrop is not a
 * sphere.** Above about 2 mm it flattens into a shape with a much higher drag
 * coefficient, which is why the real curve *saturates* near 9 m/s while a
 * sphere model keeps climbing as √r. A constant `C_d` cannot reproduce that and
 * should not pretend to; what it gets right is the part this file exists for,
 * which is how the answer moves with gravity and air density.
 *
 * `rhoAir` of zero is a vacuum, where there is no terminal velocity at all —
 * the particle just accelerates. Returning the free-fall speed after one second
 * is a stated stand-in rather than an infinity, and nothing falls in a vacuum
 * anyway because there is nothing to condense.
 */
export function terminalVelocity(radius, gravity = G_EARTH, rhoAir = RHO_EARTH, {
  rhoBody = RHO_WATER, cd = CD_DROP,
} = {}) {
  const r = Math.max(num(radius, 1e-3), 1e-6);
  const g = Math.max(num(gravity, G_EARTH), 0);
  const rho = Math.max(num(rhoAir, RHO_EARTH), 0);
  if (rho <= 1e-6) return g;                    // see above
  return Math.sqrt((8 * r * rhoBody * g) / (3 * rho * Math.max(cd, 1e-3)));
}

/**
 * Air density at the surface, kg/m³, from the world's atmosphere in bars.
 *
 * Linear in pressure at fixed temperature, which is the ideal gas law with the
 * temperature term folded into the reference: `ρ = ρ⊕ · P · (288/T)`. Good
 * enough for how fast a drop falls, and honest about where it came from.
 */
export const airDensity = (atmo = 1, surfaceK = 288) =>
  RHO_EARTH * clamp(num(atmo, 1), 0, 200) * (288 / clamp(num(surfaceK, 288), 40, 2000));

/**
 * What falls here: `rain`, `snow`, `sleet` or `none`, and the mix.
 *
 * Temperature decides, not a flag. The 0–4 °C band is where both phases
 * genuinely coexist in a real column of air, which is why sleet exists at all.
 * No air means no precipitation whatever the temperature — the same gate
 * `scatter.js` uses, and for the same reason.
 */
export function phaseOf(surfaceK = 288, atmo = 1) {
  if (!(num(atmo, 1) >= 0.05)) return { kind: 'none', snow: 0, rain: 0 };
  const T = num(surfaceK, 288);
  // 273.15 K is freezing; by 277 K the flakes have melted on the way down
  const snow = clamp((277.15 - T) / 4, 0, 1);
  if (snow >= 0.999) return { kind: 'snow', snow: 1, rain: 0 };
  if (snow <= 0.001) return { kind: 'rain', snow: 0, rain: 1 };
  return { kind: 'sleet', snow, rain: 1 - snow };
}

/**
 * Everything the renderer needs for one world's weather, derived once.
 *
 * `lean` is how far the fall tilts from vertical for a given wind speed —
 * `atan(u/v_t)`, which is just the velocity triangle, and it is why snow blows
 * sideways in a breeze that barely moves rain.
 */
export function precipFor({
  surfaceK = 288, atmo = 1, gravity = G_EARTH, dropR = 0.0012, flakeR = 0.0025,
} = {}) {
  const rho = airDensity(atmo, surfaceK);
  const phase = phaseOf(surfaceK, atmo);
  const vRain = terminalVelocity(dropR, gravity, rho);
  const vSnow = terminalVelocity(flakeR, gravity, rho, { rhoBody: RHO_SNOW, cd: CD_FLAKE });
  return {
    ...phase,
    rhoAir: rho,
    vRain,
    vSnow,
    /** radians off vertical at a given horizontal wind speed */
    leanAt: (u) => ({
      rain: Math.atan2(Math.abs(num(u, 0)), Math.max(vRain, 1e-6)),
      snow: Math.atan2(Math.abs(num(u, 0)), Math.max(vSnow, 1e-6)),
    }),
  };
}

/**
 * Wrap a coordinate into a box centred on the camera — idea 1, as arithmetic.
 *
 * The whole point is that this is a *function of position*, not a respawn: a
 * particle leaving the far face re-enters at the near one with its phase
 * intact, so density is exactly constant and nothing trails the camera.
 */
export function wrap(p, camera, size) {
  const s = Math.max(num(size, 1), 1e-6);
  const d = num(p, 0) - num(camera, 0);
  return num(camera, 0) + (d - Math.floor(d / s + 0.5) * s);
}

/**
 * Idea 3: widen a sub-pixel primitive to a floor and dim it by the same factor.
 *
 * Returns the multiplier for width and for alpha. Their product is 1 by
 * construction — that is what "energy-conserving" means here, and it is the
 * reason this does not brighten distant rain into a fog.
 */
export function subpixel(widthPx, minPx = 1.4) {
  const w = Math.max(num(widthPx, 1), 1e-6);
  const m = Math.max(num(minPx, 1.4), 1e-6);
  if (w >= m) return { width: 1, alpha: 1 };
  const k = m / w;
  return { width: k, alpha: 1 / k };
}
