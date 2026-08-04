// The wind — CLAUDE.md §6 M3, §9.5. Act 1: the field, and nothing that draws it.
//
//   "One global wind field sampled by *everything*: grass, foliage, dust,
//    spores, cloth, water ripple, cloud advection, smoke."
//
// This module is the field. It renders nothing, imports no three, and exists in
// two forms that must agree: a CPU mirror that the audio, the dust, the camera
// and the walker read, and a GLSL chunk that the render target evaluates. A
// mirror that has drifted from the field is §2.7's failure wearing a new
// costume, so the parity between them is a test rather than an intention.
//
// ---------------------------------------------------------------------------
// Why this is stateless, and why that is not a stylistic choice
//
// The reference's `updateWind` is an integrator. It holds `tgtSpeed`, `tgtDir`
// and six live cells, and it advances them with `Math.random()` in eight
// places. Two consequences, and both are disqualifying here:
//
//   · §2.3. Any un-seeded entropy in a generation path silently breaks the
//     promise that a seed is a place. Weather is generation.
//
//   · It is **frame-rate dependent**. `tgtSpeed += (Math.random() - 0.5)·dt·2.4`
//     accumulates a random walk whose variance goes as the number of *steps*,
//     not as elapsed time, so a 30 fps machine and a 120 fps machine drift into
//     different weather within a minute. That is a bug in the reference, not a
//     constraint AEON inherits.
//
// Both die to the same change: every quantity here is a pure function of
// `(seed, t, position)`. Nothing accumulates. The meander is smooth seeded
// noise sampled at `t / τ` rather than an Ornstein–Uhlenbeck integrator with
// relaxation time `τ` — the same autocorrelation, evaluated instead of stepped.
//
// The gust cells go further. The reference keeps six and recycles them past the
// camera, which makes the field depend on where the observer has been. Here
// they live on an **infinite lattice** in the along-wind coordinate: cell `j`
// sits at `j·LANE` plus a hash-derived jitter, with every parameter drawn from
// `hash(seed, j)`. There is no recycling, no camera dependence and no state —
// and because a cell's influence spans only about 400 m, evaluating a point
// touches three lanes. Same statistics as six recycled cells, strictly less
// machinery, and two observers a kilometre apart genuinely share one sky.

// ---------------------------------------------------------------------------
// portable hashing
//
// The CPU mirror and the GLSL must produce the *same bits*, not similar
// numbers, or the parity test is measuring the interpolation error of two
// different fields. `fract(sin(dot(…)))` cannot do that — its result depends on
// the driver's `sin`. This is integer arithmetic, which is exact everywhere:
// `Math.imul` is int32 multiplication, GLSL's `uint` multiply wraps the same
// way, and `>>> 0` and GLSL's implicit wrap agree on the bit pattern.

const u32 = (x) => x >>> 0;

/** 32-bit integer mix — the same one `WIND_GLSL` declares */
export function hashi(x, y, z) {
  let h = u32(Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)
    + Math.imul(z | 0, 1442695041));
  h = u32(Math.imul(h ^ (h >>> 13), 1274126177));
  return u32(h ^ (h >>> 16));
}

/** the mix, as a float in [0,1) */
export const hashf = (x, y, z) => hashi(x, y, z) / 4294967296;

const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (e0, e1, x) => {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
};

/** 1-D value noise in [-1,1], seeded — the meander's only entropy */
export function noise1(seed, x) {
  const i = Math.floor(x), f = fade(x - i);
  const a = hashf(i, seed, 0), b = hashf(i + 1, seed, 0);
  return lerp(a, b, f) * 2 - 1;
}

/** 3-D value noise in [-1,1], seeded — the turbulence potential */
export function noise3(seed, x, y, z) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const c = (dx, dy, dz) => hashf(ix + dx, iy + dy, (iz + dz) * 9781 + seed);
  const x00 = lerp(c(0, 0, 0), c(1, 0, 0), fx);
  const x10 = lerp(c(0, 1, 0), c(1, 1, 0), fx);
  const x01 = lerp(c(0, 0, 1), c(1, 0, 1), fx);
  const x11 = lerp(c(0, 1, 1), c(1, 1, 1), fx);
  return lerp(lerp(x00, x10, fy), lerp(x01, x11, fy), fz) * 2 - 1;
}

// ---------------------------------------------------------------------------
// the constants, and which of them are physics

/** where a mean wind speed is quoted, by meteorological convention */
export const REF_HEIGHT = 10;
/** aerodynamic roughness length for grassland, metres. The reference's 0.06. */
export const Z0 = 0.06;
/** displacement in the log law — the reference's 0.015 floor on z */
export const Z_FLOOR = 0.015;

/**
 * Gust-cell lattice period, metres.
 *
 * Not the reference's `i*430`, which is only where its six cells *start*. In
 * steady state each one travels from about −940 m to +620 m before being
 * recycled — a 1560 m span shared by six cells, so the density it actually
 * runs at is 260 m per cell. Porting the 430 gave a field that was gusty 3% of
 * the time instead of the reference's roughly 10%, which reads as still air
 * with occasional events rather than as wind.
 */
export const LANE = 260;
/** jitter within a lane — the reference's 260 on 430, in proportion */
export const LANE_JITTER = 156;
/** cells outrun the mean flow. Real gust fronts do; this is why they arrive. */
export const CELL_ADV = 1.25;
/**
 * A cell's influence reaches `6.5 · len` behind its head, and `len` tops out at
 * 60 m — so 390 m, which is two lanes back at 260 m spacing plus one for the
 * jitter. Cheap, and the bound is derived rather than picked.
 */
export const LANE_REACH = 3;

/** Kolmogorov: E(k) ~ k^(-5/3) is a velocity amplitude ~ k^(-1/3) per octave */
export const TURB_FALLOFF = Math.pow(2, -1 / 3);
export const TURB_OCTAVES = 4;
export const TURB_K0 = 0.0118;
/** finite-difference step for the curl, in the noise's own units */
export const TURB_EPS = 0.021;
export const TURB_INTENSITY = 0.19;

/** the render target's coverage, metres */
export const WIND_SPAN = 440;

/** meander time constants, seconds — the reference's OU relaxation times */
export const TAU_SPEED = 25;
export const TAU_DIR = 40;
/** and how far it is allowed to wander, from the reference's own clamps */
export const SWING_SPEED = 0.42;      // ±42% — its [0.62, 1.45] band
export const SWING_DIR = 0.34;        // ±0.34 rad, exactly its clamp

// ---------------------------------------------------------------------------
// the boundary layer

/**
 * Logarithmic wind profile, normalised so that `windProfile(10) === 1`.
 *
 * This is what makes roots barely move while tips whip, and it is the single
 * cheapest thing in the whole system that reads as *real*. The normalising
 * constant is not free-floating: it is `1 / log((REF_HEIGHT + Z0) / Z0)`, so
 * changing the roughness length keeps the 10 m reference exact rather than
 * needing the constant re-fitted. The reference hard-codes 0.19523, which is
 * this expression evaluated — and the suite checks the two agree.
 */
export const PROFILE_NORM = 1 / Math.log((REF_HEIGHT + Z0) / Z0);

export function windProfile(z) {
  return Math.log((Math.max(z, Z_FLOOR) + Z0) / Z0) * PROFILE_NORM;
}

// ---------------------------------------------------------------------------
// how hard the wind blows on this world

const R_GAS = 8.314462618;
const G_EARTH = 9.80665;
const P_EARTH = 1.01325e5;            // Pa
const OMEGA_EARTH = 7.292115e-5;      // rad/s
/** the midpoint of `system.js`'s own `pr.float(0.02, 0.12)` spin range */
export const SPIN_EARTH = 0.07;

/**
 * Surface wind speed at 10 m, from the world's own numbers.
 *
 * §9.6's discipline, applied to the wind: *"not the values, the function that
 * produced them."* The chain is the textbook one and every term is a quantity
 * AEON already carries.
 *
 *   1 · A pole-to-equator temperature contrast makes a pressure gradient:
 *       `|∇p| ≈ p_s · (ΔT/T) / L`, with `L` a quarter of the world's
 *       circumference.
 *   2 · Balanced against Coriolis, that gradient sets the geostrophic wind:
 *       `U_g = |∇p| / (ρ f)`, `f = 2Ω sin 45°`.
 *   3 · Friction with the ground takes a fixed fraction off at the surface.
 *
 * The check that this is a transfer rather than a fit: **for Earth it returns
 * 4.12 m/s against the reference's 4.2**, with `SURFACE_FRACTION = 0.37` — the
 * textbook land value (0.3–0.4), not a number chosen to make the answer come
 * out. Within 2% from an independent chain is evidence; tuning the fraction to
 * land on 4.2 exactly would destroy the only thing that makes it evidence, so
 * it is left where the textbook puts it and the suite pins the 2%.
 *
 * ---------------------------------------------------------------------------
 * One result worth stating because it is surprising and it is correct
 *
 * The geostrophic speed is **independent of surface pressure**. Both the
 * pressure gradient and the density are proportional to `p`, so it cancels:
 * thinning the air does not slow the wind. Mars is the demonstration — thin
 * air, respectable wind speeds, and almost no force behind them.
 *
 * That is why speed is not the whole answer. What bends a blade of grass is
 * dynamic pressure, `½ρU²`, and *that* does vanish with the air. So the
 * pressure dependence lives in `windForceScale()` where it physically belongs,
 * rather than being smuggled into the speed to make an airless world look
 * still. An airless world has a nominal wind and nothing to push with.
 *
 * The one place a threshold is honest: below roughly a hundredth of Earth's
 * density the mean free path exceeds the scale of a grass blade and the flow
 * stops being a fluid at all. That is the Knudsen transition, and it is a ramp
 * rather than a branch.
 */
export const SURFACE_FRACTION = 0.37;

/** air density at the surface, kg/m³ */
export function airDensity(world, atmo = 1) {
  const thickness = Math.max(atmo, 0);
  const M = (world.typeId ?? 1) >= 5 ? 0.00230 : 0.02896;
  const T = Math.max(world.Teq ?? 255, 1) * (1 + 0.13 * Math.min(thickness, 3));
  return (P_EARTH * thickness * M) / (R_GAS * T);
}

/** Earth's surface air density under the same formula, so the ratio is exact */
export const RHO_EARTH = airDensity({ typeId: 1, Teq: 255 }, 1);

/**
 * What the wind can actually push with, relative to Earth: dynamic pressure
 * `½ρU²` normalised, so a blade's bend is `windForceScale · (U/U_earth)²`.
 * This is the term that vanishes in a vacuum — the speed does not.
 */
export function windForceScale(world, atmo = 1) {
  const rho = airDensity(world, atmo);
  const knudsen = smoothstep(0, 0.01 * RHO_EARTH, rho);   // fluid, or not
  return (rho / RHO_EARTH) * knudsen;
}

export function baseWindSpeed(world, atmo = 1) {
  const thickness = Math.max(atmo, 0);

  const g = G_EARTH * (world.massE ?? 1) / Math.max((world.radiusE ?? 1) ** 2, 1e-6);
  const M = (world.typeId ?? 1) >= 5 ? 0.00230 : 0.02896;
  // surface temperature, the same one-parameter greenhouse `aerial.js` anchors
  const T = Math.max(world.Teq ?? 255, 1) * (1 + 0.13 * Math.min(thickness, 3));
  const p = P_EARTH * thickness;
  const rho = (p * M) / (R_GAS * T);
  if (!(rho > 0)) return 0;

  // The equator-to-pole contrast. High obliquity mixes the seasons and flattens
  // the annual mean, which is real and is the only thing `pp.tilt` can honestly
  // be used for here.
  const tilt = Math.min(Math.max(world.tilt ?? 0.41, 0), 1.4);
  const dTOverT = 0.139 * Math.exp(-Math.max(tilt - 0.41, 0) * 0.9);

  const R = Math.max(world.radiusE ?? 1, 0.02) * 6.371e6;
  const L = (Math.PI / 2) * R;

  // `pp.spin` is a *drawing* rate, not an angular velocity — it is all the
  // rotation information the generator carries, so it is mapped rather than
  // read, anchored on the midpoint of its own generated range.
  const spin = Math.abs(world.spin ?? SPIN_EARTH);
  const omega = OMEGA_EARTH * (spin / SPIN_EARTH);
  // f at 45°, and floored: a tidally locked world does not get infinite wind,
  // it gets a different circulation this model does not claim to describe.
  const f = Math.max(2 * omega * Math.SQRT1_2, 2 * OMEGA_EARTH * 0.02);

  const gradP = (p * dTOverT) / L;
  const geostrophic = gradP / Math.max(rho * f, 1e-12);
  return Math.min(geostrophic * SURFACE_FRACTION, 120);
}

// ---------------------------------------------------------------------------
// the field

const TAU = Math.PI * 2;

/**
 * A world's wind. Holds no evolving state — only the constants that make this
 * world's weather this world's, so two calls at the same `t` cannot disagree.
 */
export function makeWind(seed, world = {}, atmo = 1) {
  const s = u32(seed);
  const base = baseWindSpeed(world, atmo);
  // The prevailing direction is the world's, not 292°. It is the one place a
  // seed may choose freely, because nothing physical fixes it at this scale.
  const dir = (hashf(s, 0x1e, 0) * TAU);
  return {
    seed: s,
    base,
    baseDir: dir,
    // what the wind can push with, which is not the same as how fast it blows
    force: windForceScale(world, atmo),
    gustiness: 1,
    turbIntensity: TURB_INTENSITY,
  };
}

/** the mean flow at time `t` — meandering, and evaluated rather than stepped */
export function meanFlow(W, t) {
  const speed = W.base * (1 + SWING_SPEED * noise1(W.seed ^ 0x5eed, t / TAU_SPEED));
  const dir = W.baseDir + SWING_DIR * noise1(W.seed ^ 0xd16, t / TAU_DIR);
  // the direction the air travels *toward*
  const fx = Math.sin(dir), fz = Math.cos(dir);
  return {
    speed: Math.max(speed, 0),
    dir,
    fwd: [fx, fz],
    side: [-fz, fx],
    vec: [fx * Math.max(speed, 0), fz * Math.max(speed, 0)],
  };
}

/** one lattice cell's parameters — a pure function of its lane index */
export function cellAt(W, j) {
  const h0 = hashf(W.seed, j, 1);
  const h1 = hashf(W.seed, j, 2);
  const h2 = hashf(W.seed, j, 3);
  const h3 = hashf(W.seed, j, 4);
  const h4 = hashf(W.seed, j, 5);
  const h5 = hashf(W.seed, j, 6);
  return {
    s: j * LANE + h0 * LANE_JITTER,
    c: (h1 - 0.5) * 900,
    len: 26 + h2 * 34,
    wid: 70 + h3 * 130,
    amp: 0.85 + h4 * 1.35,
    veer: (h5 - 0.5) * 0.42,
  };
}

/**
 * The coherent gust cells at a point.
 *
 * §6 M3 names the shape: *"a sharp leading edge (`exp(−|u|·9)`), an exponential
 * body, and a cross-wind Gaussian falloff. This is what makes wind read as
 * weather rather than as noise."*
 *
 * `gust` and `front` are different quantities and conflating them is the way
 * this stops working. `gust` is how hard it is blowing; `front` is a thin ridge
 * riding the leading edge, which is what the grass's wind-flash keys off and
 * what makes a gust *arrive* rather than merely be present.
 */
export function gustAt(W, along, cross, t) {
  // the lattice is fixed in the air, and the air moves
  const drift = W.base * CELL_ADV * t;
  const a = along - drift;
  const j0 = Math.floor(a / LANE);
  let gust = 0, veer = 0, front = 0;
  for (let d = -LANE_REACH; d <= 1; d++) {
    const c = cellAt(W, j0 + d);
    const u = (a - c.s) / c.len;
    if (u > 0.18 || u < -6.5) continue;
    const head = smoothstep(0.15, 0, u);
    const body = Math.exp(u * 2.05);
    const cw = Math.exp(-Math.pow(Math.abs(cross - c.c) / (c.wid * 0.5), 2.3));
    const g = c.amp * head * body * cw;
    gust += g;
    veer += g * c.veer;
    front += c.amp * Math.exp(-Math.abs(u) * 9) * cw;
  }
  return { gust: gust * W.gustiness, veer, front: front * W.gustiness };
}


/**
 * Inertial-subrange turbulence: four octaves of curl noise, advected with the
 * flow (Taylor's frozen-turbulence hypothesis).
 *
 * Curl rather than plain noise because `∇ × ψ` is divergence-free by
 * construction, and air does not pile up. The per-octave amplitude falloff is
 * `2^(-1/3)`, which is Kolmogorov's `E(k) ~ k^(-5/3)` expressed as a velocity
 * amplitude — a physical constant, not a taste knob, and the suite asserts the
 * fitted spectral slope rather than the constant alone.
 *
 * Advected with the **base** flow rather than the meandering mean. Taylor's
 * hypothesis is stated about the mean flow, and using the instantaneous
 * meander would make the advection an integral of a quantity that is itself
 * being evaluated rather than stepped — reintroducing the state this module
 * exists to avoid, for a correction of a few per cent.
 */
export function turbulenceAt(W, x, z, t) {
  const bx = Math.sin(W.baseDir) * W.base, bz = Math.cos(W.baseDir) * W.base;
  let vx = 0, vz = 0, mag = 0;
  let k = TURB_K0, amp = 1;
  for (let i = 0; i < TURB_OCTAVES; i++) {
    const qx = (x - bx * t) * k, qz = (z - bz * t) * k;
    const tt = t * (0.055 * Math.pow(2, i * 0.667));
    const n0 = noise3(W.seed + i, qx, qz, tt);
    const nx = noise3(W.seed + i, qx + TURB_EPS, qz, tt);
    const ny = noise3(W.seed + i, qx, qz + TURB_EPS, tt);
    const cx = (ny - n0) / TURB_EPS;
    const cz = -(nx - n0) / TURB_EPS;
    vx += amp * cx;
    vz += amp * cz;
    mag += amp * Math.hypot(cx, cz);
    k *= 2;
    amp *= TURB_FALLOFF;
  }
  return { x: vx, z: vz, mag };
}

/**
 * Terrain coupling — §6 M3's third ingredient.
 *
 * Wind speeds up over a crest because the streamlines are squeezed, shelters in
 * a lee because they separate, and turns along a contour because a slope is
 * cheaper to go around than over. All three are real and all three are what
 * makes wind belong to a place rather than to a scene.
 *
 * `heightAt` is passed in rather than imported: on the CPU it is
 * `ground.heightAt`, and in the shader it is a bake over the render target's
 * own span. One definition, sampled two ways (§2.7).
 */
export const GRAD_STENCIL = 15;

export function coupleTerrain(heightAt, x, z, fwd) {
  const h = heightAt(x, z);
  const hs = 0.25 * (heightAt(x + 58, z) + heightAt(x - 58, z)
    + heightAt(x, z + 58) + heightAt(x, z - 58));
  const crest = (h - hs) / 24;
  let speedup = 1 + 0.92 * Math.min(Math.max(crest, 0), 1.1);

  const hUp = heightAt(x - fwd[0] * 48, z - fwd[1] * 48);
  const shelter = Math.exp(-Math.max(hUp - h, 0) / 23);
  speedup *= lerp(0.42, 1, shelter);

  // The gradient, by central difference. The reference uses ±7 m; here the
  // stencil is one texel of the height bake, because a finer difference on a
  // 14.6 m table reads interpolation rather than terrain.
  const e = GRAD_STENCIL;
  const gx = (heightAt(x + e, z) - heightAt(x - e, z)) / (2 * e);
  const gz = (heightAt(x, z + e) - heightAt(x, z - e)) / (2 * e);
  const slope = Math.hypot(gx, gz);
  const nl = slope || 1;
  return { speedup, upslope: [gx / nl, gz / nl], slope, crest, shelter };
}

/**
 * Deflect a flow direction around a slope.
 *
 * The reference picks a *signed* contour — `contour = perp(grad)`, flipped so
 * it points downwind — and mixes the flow toward it. That has a defect: a
 * contour line has no sign, and the `dot(contour, fwd) < 0` test is bistable
 * exactly where the slope faces along the wind, which is common. Two texels
 * with nearly identical gradients then deflect 180° apart, and the field grows
 * a seam wherever a hillside happens to face upwind.
 *
 * Damping the up-slope *component* has no sign to choose. Air prefers to go
 * around a slope rather than over it, so remove the part of the flow that
 * climbs, in proportion to how steep it is:
 *
 *     dir' = normalize(dir − w · n · (dir · n))
 *
 * At `w = 0` nothing happens; at `w = 1` the flow is purely along the contour,
 * and which way along it follows from the flow rather than from a coin toss.
 * Continuous everywhere, one fewer branch, and the same physics the reference
 * was reaching for.
 */
export function deflect(dirX, dirZ, upslope, slope) {
  const w = Math.min(Math.max(slope * 2.1, 0), 0.58);
  const d = dirX * upslope[0] + dirZ * upslope[1];
  let ox = dirX - w * upslope[0] * d;
  let oz = dirZ - w * upslope[1] * d;
  const l = Math.hypot(ox, oz) || 1;
  return [ox / l, oz / l, w];
}

// ---------------------------------------------------------------------------
// the ground, as the shader can read it
//
// The coupling above wants `heightAt` inside a fragment shader, and AEON has no
// GLSL height function at surface scale — heights live in vertex positions and
// in `ground.heightAt` on the CPU. So the ground is baked once into a texture.
//
// Two things make that honest rather than a shortcut. It is the **same
// function**, tabulated: `ground.js` owns the one definition of walkable ground
// and this samples it rather than re-deriving it, so there is nothing else for
// it to disagree with. And the resolution is chosen against what the coupling
// varies by rather than against what looks generous — the crest filter is a
// ±58 m stencil and the shelter lookup is 48 m upwind, so a 14.6 m texel is a
// quarter of the finest term.
//
// It also bounds the gradient stencil. The reference reads its contour
// deflection off a ±7 m difference; on a 14.6 m table that is reading
// interpolation rather than terrain, so the stencil widens to one texel. Stated
// here because it is a real loss of detail accepted for a real reason.

/** height-bake resolution over ±extent — see the note above on why not higher */
export const HEIGHT_RES = 192;

/**
 * Bake the walkable ground into a table the wind can read.
 *
 * The cost is why the resolution is not higher: `heightAt` runs at roughly
 * 4.6 µs in the browser (measured — `src/horizon.js` does 16k samples in 74 ms),
 * so 192² is about 170 ms at load. 512² would be 1.2 s against §5's 2.5 s to
 * interactive, for detail the coupling cannot use.
 */
export function bakeHeight(heightAt, extent, res = HEIGHT_RES) {
  const data = new Float32Array(res * res);
  const step = (extent * 2) / (res - 1);
  for (let j = 0; j < res; j++) {
    const z = -extent + j * step;
    for (let i = 0; i < res; i++) {
      data[j * res + i] = heightAt(-extent + i * step, z);
    }
  }
  return { data, res, extent, texel: step };
}

/** the same bilinear lookup the shader performs — the CPU mirror of the bake */
export function sampleBake(bake, x, z) {
  const { data, res, extent } = bake;
  const u = ((x + extent) / (extent * 2)) * (res - 1);
  const v = ((z + extent) / (extent * 2)) * (res - 1);
  const cu = Math.min(Math.max(u, 0), res - 1);
  const cv = Math.min(Math.max(v, 0), res - 1);
  const i0 = Math.floor(cu), j0 = Math.floor(cv);
  const i1 = Math.min(i0 + 1, res - 1), j1 = Math.min(j0 + 1, res - 1);
  const fx = cu - i0, fz = cv - j0;
  const a = data[j0 * res + i0], b = data[j0 * res + i1];
  const c = data[j1 * res + i0], d = data[j1 * res + i1];
  return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
}

/** a `heightAt` backed by a bake, so the coupling can be tested as it renders */
export const bakedHeight = (bake) => (x, z) => sampleBake(bake, x, z);

/**
 * The whole field at a point — the CPU mirror `WIND_GLSL` must match.
 *
 * `height` is metres above the ground; omit it for the 10 m reference value.
 * `heightAt` is optional: without it the terrain coupling is skipped, which is
 * what a caller far above the ground (cloud advection) actually wants.
 */
export function windAt(W, x, z, t, height, heightAt = null) {
  const m = meanFlow(W, t);
  const along = x * m.fwd[0] + z * m.fwd[1];
  const cross = x * m.side[0] + z * m.side[1];
  const g = gustAt(W, along, cross, t);

  const turb = turbulenceAt(W, x, z, t);
  let vx = m.vec[0] + turb.x * m.speed * W.turbIntensity;
  let vz = m.vec[1] + turb.z * m.speed * W.turbIntensity;

  let speedup = 1;
  let dirX = vx, dirZ = vz;
  const dl0 = Math.hypot(dirX, dirZ) || 1;
  dirX /= dl0; dirZ /= dl0;
  if (heightAt) {
    const c = coupleTerrain(heightAt, x, z, m.fwd);
    speedup = c.speedup;
    const d = deflect(dirX, dirZ, c.upslope, c.slope);
    dirX = d[0]; dirZ = d[1];
  }

  const spd = Math.hypot(vx, vz) * speedup * (1 + g.gust * 1.35);
  const a = g.veer * 0.85;
  const ca = Math.cos(a), sa = Math.sin(a);
  const rx = dirX * ca - dirZ * sa;
  const rz = dirX * sa + dirZ * ca;

  const prof = height === undefined ? 1 : windProfile(height);
  return {
    x: rx * spd * prof,
    z: rz * spd * prof,
    speed: spd * prof,
    gust: g.gust,
    front: g.front,
    gustNorm: spd / Math.max(m.speed, 0.4),
    excite: Math.min(Math.max(g.front * 1.35 + turb.mag * 0.22, 0), 3),
  };
}

// ---------------------------------------------------------------------------
// the same arithmetic, as GLSL
//
// GLSL ES 3.00 — the integer hash needs `uint`, which ES 1.00 does not have,
// and a hash that is not bit-exact makes the parity test meaningless.

/** the hash and the two noises, shared by the RT pass and the samplers */
export const WIND_NOISE_GLSL = /* glsl */`
  uint aeonHashi(int x, int y, int z) {
    uint h = uint(x) * 374761393u + uint(y) * 668265263u + uint(z) * 1442695041u;
    h = (h ^ (h >> 13u)) * 1274126177u;
    return h ^ (h >> 16u);
  }
  float aeonHashf(int x, int y, int z) {
    return float(aeonHashi(x, y, z)) / 4294967296.0;
  }
  float aeonFade(float t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

  float wNoise1(int seed, float x) {
    float fi = floor(x);
    int i = int(fi);
    float f = aeonFade(x - fi);
    return mix(aeonHashf(i, seed, 0), aeonHashf(i + 1, seed, 0), f) * 2.0 - 1.0;
  }

  float wNoise3(int seed, vec3 p) {
    vec3 fi = floor(p);
    ivec3 i = ivec3(fi);
    vec3 f = vec3(aeonFade(p.x - fi.x), aeonFade(p.y - fi.y), aeonFade(p.z - fi.z));
    // the z lane is folded by 9781 so a seed offset cannot alias into a
    // neighbouring slice — the CPU mirror folds it identically
    float c000 = aeonHashf(i.x,     i.y,     (i.z    ) * 9781 + seed);
    float c100 = aeonHashf(i.x + 1, i.y,     (i.z    ) * 9781 + seed);
    float c010 = aeonHashf(i.x,     i.y + 1, (i.z    ) * 9781 + seed);
    float c110 = aeonHashf(i.x + 1, i.y + 1, (i.z    ) * 9781 + seed);
    float c001 = aeonHashf(i.x,     i.y,     (i.z + 1) * 9781 + seed);
    float c101 = aeonHashf(i.x + 1, i.y,     (i.z + 1) * 9781 + seed);
    float c011 = aeonHashf(i.x,     i.y + 1, (i.z + 1) * 9781 + seed);
    float c111 = aeonHashf(i.x + 1, i.y + 1, (i.z + 1) * 9781 + seed);
    float x00 = mix(c000, c100, f.x);
    float x10 = mix(c010, c110, f.x);
    float x01 = mix(c001, c101, f.x);
    float x11 = mix(c011, c111, f.x);
    return mix(mix(x00, x10, f.y), mix(x01, x11, f.y), f.z) * 2.0 - 1.0;
  }
`;

/**
 * The field itself, as the render-target pass evaluates it. Declares its own
 * uniforms, all prefixed `uWind`, and expects a `wTerrainH(vec2)` to exist —
 * supplied by the height bake (act 2) or stubbed to a constant, which disables
 * the coupling exactly as passing no `heightAt` does on the CPU.
 */
export const WIND_MEAN_GLSL = /* glsl */`
  uniform int   uWindSeed;
  uniform float uWindBase;       // 10 m mean speed, m/s
  uniform float uWindBaseDir;    // radians, the direction the air travels toward
  uniform float uWindTime;
  uniform float uWindGustiness;
  uniform float uWindTurb;
  uniform float uWindCouple;     // 1 when a height field is bound, else 0

  const float W_LANE = ${LANE.toFixed(1)};
  const float W_JIT = ${LANE_JITTER.toFixed(1)};
  const float W_ADV = ${CELL_ADV.toFixed(4)};
  const float W_K0 = ${TURB_K0.toFixed(6)};
  const float W_EPS = ${TURB_EPS.toFixed(4)};
  const float W_FALL = ${TURB_FALLOFF.toFixed(8)};
  const float W_TAU_S = ${TAU_SPEED.toFixed(1)};
  const float W_TAU_D = ${TAU_DIR.toFixed(1)};
  const float W_SWING_S = ${SWING_SPEED.toFixed(3)};
  const float W_SWING_D = ${SWING_DIR.toFixed(3)};
  const float W_Z0 = ${Z0.toFixed(4)};
  const float W_ZFLOOR = ${Z_FLOOR.toFixed(4)};
  const float W_PNORM = ${PROFILE_NORM.toFixed(9)};

  float windProfile(float z) {
    return log((max(z, W_ZFLOOR) + W_Z0) / W_Z0) * W_PNORM;
  }

  struct WindMean { float speed; float dir; vec2 fwd; vec2 side; vec2 vec; };

  WindMean windMean(float t) {
    // evaluated, never stepped — see the note in src/wind.js on why
    float sp = uWindBase * (1.0 + W_SWING_S * wNoise1(uWindSeed ^ 0x5eed, t / W_TAU_S));
    float dr = uWindBaseDir + W_SWING_D * wNoise1(uWindSeed ^ 0xd16, t / W_TAU_D);
    sp = max(sp, 0.0);
    WindMean m;
    m.speed = sp; m.dir = dr;
    m.fwd = vec2(sin(dr), cos(dr));
    m.side = vec2(-m.fwd.y, m.fwd.x);
    m.vec = m.fwd * sp;
    return m;
  }

`;

/**
 * The evaluator: the gust lattice, the turbulence cascade, the terrain
 * coupling, and `windField()` itself. Only the render-target pass includes
 * this — a blade *samples* the field and does not evaluate one, and putting
 * four octaves of curl noise into a shader that runs on every vertex of every
 * blade would be a hundred and fifty lines of dead code on twelve million
 * invocations. It expects `wTerrainH(vec2)` to exist; supply it from a height
 * bake, or stub it and set `uWindCouple` to 0.
 */
export const WIND_PASS_GLSL = /* glsl */`
  // one lattice cell — a pure function of its lane index, so there is no state
  // to recycle and no dependence on where the observer has been
  void windCell(int j, out float s, out float c, out float len,
                out float wid, out float amp, out float veer) {
    s   = float(j) * W_LANE + aeonHashf(uWindSeed, j, 1) * W_JIT;
    c   = (aeonHashf(uWindSeed, j, 2) - 0.5) * 900.0;
    len = 26.0 + aeonHashf(uWindSeed, j, 3) * 34.0;
    wid = 70.0 + aeonHashf(uWindSeed, j, 4) * 130.0;
    amp = 0.85 + aeonHashf(uWindSeed, j, 5) * 1.35;
    veer = (aeonHashf(uWindSeed, j, 6) - 0.5) * 0.42;
  }

  // gust: how hard it blows. front: the thin ridge on the leading edge that
  // makes it *arrive*. They are different quantities; conflating them is how
  // this stops reading as weather.
  vec3 windGust(float along, float cross, float t) {
    float a = along - uWindBase * W_ADV * t;
    int j0 = int(floor(a / W_LANE));
    float gust = 0.0, veer = 0.0, front = 0.0;
    for (int d = -${LANE_REACH}; d <= 1; d++) {
      float s, c, len, wid, amp, vr;
      windCell(j0 + d, s, c, len, wid, amp, vr);
      float u = (a - s) / len;
      if (u > 0.18 || u < -6.5) continue;
      float head = smoothstep(0.15, 0.0, u);
      float body = exp(u * 2.05);
      float cw = exp(-pow(abs(cross - c) / (wid * 0.5), 2.3));
      float g = amp * head * body * cw;
      gust += g;
      veer += g * vr;
      front += amp * exp(-abs(u) * 9.0) * cw;
    }
    return vec3(gust * uWindGustiness, veer, front * uWindGustiness);
  }

  // four octaves of curl noise; amplitude falls as 2^(-1/3) per octave, which
  // is Kolmogorov's -5/3 spectrum written as a velocity
  vec3 windTurb(vec2 p, float t) {
    vec2 b = vec2(sin(uWindBaseDir), cos(uWindBaseDir)) * uWindBase;
    vec2 v = vec2(0.0);
    float k = W_K0, amp = 1.0, mag = 0.0;
    for (int i = 0; i < ${TURB_OCTAVES}; i++) {
      vec2 q = (p - b * t) * k;
      float tt = t * (0.055 * pow(2.0, float(i) * 0.667));
      int sd = uWindSeed + i;
      float n0 = wNoise3(sd, vec3(q, tt));
      float nx = wNoise3(sd, vec3(q + vec2(W_EPS, 0.0), tt));
      float ny = wNoise3(sd, vec3(q + vec2(0.0, W_EPS), tt));
      vec2 curl = vec2(ny - n0, -(nx - n0)) / W_EPS;
      v += amp * curl;
      mag += amp * length(curl);
      k *= 2.0; amp *= W_FALL;
    }
    return vec3(v, mag);
  }

  // rgb/a: velocity.xy, gust normalised to the mean, and the excitement the
  // grass's wind flash keys off
  vec4 windField(vec2 p, float t) {
    WindMean m = windMean(t);
    vec3 g = windGust(dot(p, m.fwd), dot(p, m.side), t);
    vec3 turb = windTurb(p, t);

    vec2 v = m.vec + turb.xy * m.speed * uWindTurb;
    vec2 dir = normalize(v + vec2(1e-6));
    float speedup = 1.0;

    if (uWindCouple > 0.5) {
      float h = wTerrainH(p);
      float hs = 0.25 * (wTerrainH(p + vec2(58.0, 0.0)) + wTerrainH(p - vec2(58.0, 0.0))
                       + wTerrainH(p + vec2(0.0, 58.0)) + wTerrainH(p - vec2(0.0, 58.0)));
      float crest = (h - hs) / 24.0;
      speedup = 1.0 + 0.92 * clamp(crest, 0.0, 1.1);
      float hUp = wTerrainH(p - m.fwd * 48.0);
      speedup *= mix(0.42, 1.0, exp(-max(hUp - h, 0.0) / 23.0));

      float e = ${GRAD_STENCIL.toFixed(1)};
      vec2 grad = vec2(wTerrainH(p + vec2(e, 0.0)) - wTerrainH(p - vec2(e, 0.0)),
                       wTerrainH(p + vec2(0.0, e)) - wTerrainH(p - vec2(0.0, e))) / (2.0 * e);
      float slope = length(grad);
      // Damp the up-slope component rather than mixing toward a signed contour.
      // A contour line has no sign, and choosing one on dot(contour, fwd) is
      // bistable exactly where a hillside faces upwind — see deflect() in
      // src/wind.js for the seam that produces.
      vec2 n = grad / max(slope, 1e-6);
      float w = clamp(slope * 2.1, 0.0, 0.58);
      dir = normalize(dir - w * n * dot(dir, n) + vec2(1e-9));
    }

    float spd = length(v) * speedup * (1.0 + g.x * 1.35);
    float a = g.y * 0.85;
    vec2 rot = vec2(dir.x * cos(a) - dir.y * sin(a), dir.x * sin(a) + dir.y * cos(a));

    return vec4(rot * spd,
                spd / max(m.speed, 0.4),
                clamp(g.z * 1.35 + turb.z * 0.22, 0.0, 3.0));
  }
`;

/**
 * The sampler every other system reads — §6 M3's *"analytic fallback beyond its
 * edge so gust bands still roll over the far hills, blended on an edge mask."*
 *
 * The early-out is the point, and it is quoted in §6 M3 for a reason: inside
 * the render target the simulated field *is* the answer, so evaluating the
 * fallback there is pure waste. Because all of a blade's vertices sample one
 * point, the branch is perfectly coherent across a warp — which is what makes
 * a gust band 900 m away cost almost nothing.
 */
export const WIND_SAMPLE_GLSL = /* glsl */`
  uniform sampler2D uWindTex;
  uniform vec2 uWindOrigin;
  const float W_SPAN = ${WIND_SPAN.toFixed(1)};

  vec4 windSample(vec2 p, float t) {
    vec2 uv = (p - uWindOrigin) / W_SPAN + 0.5;
    vec4 w = texture(uWindTex, clamp(uv, vec2(0.003), vec2(0.997)));
    float edge = 1.0 - smoothstep(0.40, 0.498, max(abs(uv.x - 0.5), abs(uv.y - 0.5)));
    if (edge >= 0.999) return w;
    // beyond the target: the same travelling wave, evaluated analytically
    WindMean m = windMean(t);
    vec2 q = p - m.vec * (t * 1.22);
    float band = clamp(wNoise3(uWindSeed, vec3(q * 0.0052, 0.0)) * 1.30
                     + wNoise3(uWindSeed + 7, vec3(q * 0.0168, 13.0)) * 0.55
                     + wNoise3(uWindSeed + 13, vec3(q * 0.055, 41.0)) * 0.22, -1.2, 1.4);
    float gust = clamp(0.80 + band * 0.95, 0.05, 2.3);
    vec4 fb = vec4(m.vec * gust, gust, clamp(band, 0.0, 1.0) * 0.85);
    return mix(fb, w, edge);
  }
`;

/** the whole thing, for the parity suite — a *consumer* wants less (see below) */
export const WIND_GLSL = WIND_NOISE_GLSL + WIND_MEAN_GLSL + WIND_PASS_GLSL + WIND_SAMPLE_GLSL;

/** what a material that only *reads* the field needs */
export const WIND_CONSUMER_GLSL = WIND_NOISE_GLSL + WIND_MEAN_GLSL + WIND_SAMPLE_GLSL;

/** the uniform block `WIND_FIELD_GLSL` expects, from a wind and a time */
export function windUniforms(W, t = 0, couple = false) {
  return {
    uWindSeed: { value: W.seed | 0 },
    uWindBase: { value: W.base },
    uWindBaseDir: { value: W.baseDir },
    uWindTime: { value: t },
    uWindGustiness: { value: W.gustiness },
    uWindTurb: { value: W.turbIntensity },
    uWindCouple: { value: couple ? 1 : 0 },
  };
}
