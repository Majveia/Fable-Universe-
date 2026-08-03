// The sea — CLAUDE.md §M2 act 5.
//
//   "Ocean: 8–12 summed Gerstner waves on the shared wind field, Beer–Lambert
//    depth absorption, Fresnel sky probe. Take the reference's river as the
//    model: **depth-graded body colour in discrete bands**, quantised sun
//    glitter, foam from gradient — not a PBR water shader."
//
// What is there today is two sine waves crossed at right angles. It heaves,
// which is more than nothing, but a sine surface has no crests — it is
// symmetric about its own mean, and the sea is not. Real water piles up at the
// top and flattens in the trough, and that asymmetry is most of what makes a
// wave read as water rather than as a corrugated sheet.
//
// ---------------------------------------------------------------------------
// Why Gerstner rather than a heightfield
//
// A Gerstner (trochoidal) wave displaces a surface point *horizontally* as well
// as vertically — particles move in circles, which is what deep-water particles
// actually do. The consequence on screen is the sharp crest and the broad
// trough, for free, out of the same solution Gerstner published in 1802.
//
// It also hands over the foam criterion. Sum enough steepness and the
// horizontal displacement folds the surface back through itself; the Jacobian
// of the map goes negative exactly where a real wave would break. So whitecaps
// are not painted on where the shader guesses — they are drawn where the
// surface has genuinely overturned, which is both cheaper and true.
//
// ---------------------------------------------------------------------------
// What is physics and what is art
//
// Physics, and not negotiable (§2): the dispersion relation ω² = gk, so every
// wavelength travels at its own speed and the sea never repeats; the
// Pierson–Moskowitz spectrum, so the wave heights belong to the wind that
// raised them; Beer–Lambert extinction per channel, so deep water is blue
// because red is absorbed first and for no other reason.
//
// Art, and deliberate: the depth is quantised into bands rather than graded
// smoothly, and the sun glitter is quantised into steps rather than a specular
// lobe. Both are §M2's instruction and both look like bugs to a PBR reflex —
// §11 lists that reflex by name.

const G = 9.80665;

/** how many waves are summed. §M2 says 8–12; twelve is the top of its range. */
export const WAVE_COUNT = 12;

/** Beer–Lambert extinction of clear sea water, per metre, per channel.
 *
 * Red is absorbed roughly twenty times faster than blue. This one fact is the
 * entire reason the sea is blue, and a water shader that tints it blue by
 * choosing a blue colour has thrown away the reason and kept the result. */
export const EXTINCTION = [0.45, 0.075, 0.021];

/** how many discrete depth bands the body colour is quantised into (§M2) */
export const DEPTH_BANDS = 5;

/** the deepest water the bands resolve, in metres — past this it is all one */
export const DEPTH_RANGE = 22;

const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);

/**
 * Significant wave height for a fully developed sea, Pierson–Moskowitz.
 *
 *     H_s = 0.21 · U² / g
 *
 * A 10 m/s wind raises 2.1 m of sea. The point of carrying this rather than a
 * tuned amplitude is that the weather already knows its own wind speed, so the
 * sea changes when the weather does without anything being wired between them.
 */
export function significantHeight(windSpeed) {
  return 0.21 * windSpeed * windSpeed / G;
}

/** peak angular frequency of that spectrum */
export function peakOmega(windSpeed) {
  return 0.877 * G / Math.max(windSpeed, 0.5);
}

/**
 * Build the wave set for a wind.
 *
 * Wavelengths are spread geometrically either side of the spectral peak, and
 * directions by a cosine-power spread about the wind — a real sea is not
 * unidirectional, and a sum of waves that all travel the same way reads as
 * corduroy.
 *
 * `steepCap` is the total steepness `Σ A·k`. Above 1 the surface self-
 * intersects everywhere; the sea is *supposed* to fold at the crests and only
 * there, so this sits just under 1 and the folding is left to the peaks where
 * the phases happen to align. That is where whitecaps come from.
 */
export function buildWaves(windSpeed, windDir, seed = 1, steepCap = 0.86, minLambda = 0) {
  const hs = significantHeight(windSpeed);
  const wp = peakOmega(windSpeed);
  // λ_peak from the dispersion relation, so the spectrum and the geometry
  // cannot disagree about which wave is the big one
  const lamPeak = 2 * Math.PI * G / (wp * wp);

  const waves = [];
  let steepSum = 0;
  // a deterministic, seeded but cheap sequence — §2.3 forbids Math.random here
  let h = (seed >>> 0) || 1;
  const rnd = () => {
    h ^= h << 13; h >>>= 0; h ^= h >> 17; h ^= h << 5; h >>>= 0;
    return h / 4294967296;
  };

  // Band-limit the set to what the mesh can actually carry.
  //
  // A geometric wave shorter than twice the quad it is displacing does not
  // exist — it aliases, and the aliasing does not look like small waves, it
  // looks like long diagonal slashes tracking the mesh. Measured the hard way:
  // twelve waves down to 26 m on a 240 m grid drew a sea of white streaks.
  //
  // So the vertex shader carries the swell the mesh can resolve and the
  // fragment's normal perturbation carries the chop — which is the same
  // division of labour every other LOD in this project makes.
  const lamLo = Math.max(minLambda, lamPeak / 3.2);
  const lamHi = Math.max(lamPeak * 3.2, lamLo * 1.8);

  for (let i = 0; i < WAVE_COUNT; i++) {
    const u = i / (WAVE_COUNT - 1);                   // 0..1
    const t = u * 2 - 1;                              // −1..1, for the spread
    const lam = lamLo * Math.pow(lamHi / lamLo, u);
    const k = 2 * Math.PI / lam;
    // deep-water dispersion — the whole reason the sea never loops
    const omega = Math.sqrt(G * k);

    // cos² spreading about the wind, widest for the short waves
    const spread = (0.35 + 0.55 * Math.abs(t)) * (rnd() * 2 - 1);
    const dir = windDir + spread;

    // Pierson–Moskowitz amplitude at this wavelength, normalised below
    const wo = omega / wp;
    const S = Math.exp(-1.25 / (wo * wo * wo * wo)) / Math.pow(wo, 5);
    waves.push({ lam, k, omega, dir, amp: S, phase: rnd() * Math.PI * 2 });
    steepSum += S * k;
  }

  // Normalise twice: once so the summed steepness sits under the folding limit,
  // and once so the significant height matches the spectrum's own answer. The
  // tighter of the two wins, because exceeding either is a different kind of
  // wrong — one folds the whole surface, the other lies about the weather.
  const byteep = steepCap / Math.max(steepSum, 1e-9);
  let ampSum = 0;
  for (const w of waves) ampSum += w.amp * byteep;
  const byHeight = ampSum > 1e-9 ? (hs / 2) / ampSum : 0;
  const scale = Math.min(byteep, byteep * byHeight);
  for (const w of waves) w.amp *= scale;
  return waves;
}

/**
 * The Gerstner sum at one point and time, on the CPU.
 *
 * Returns the displaced position, the normal, and the **Jacobian** of the
 * horizontal map — which is the foam criterion: below zero the surface has
 * folded through itself and that is a breaking crest.
 */
export function gerstner(waves, x, z, t) {
  let dx = 0, dy = 0, dz = 0;
  let jxx = 1, jzz = 1, jxz = 0;
  let nx = 0, nz = 0;

  for (const w of waves) {
    const dirx = Math.cos(w.dir), dirz = Math.sin(w.dir);
    const phase = w.k * (dirx * x + dirz * z) - w.omega * t + w.phase;
    const s = Math.sin(phase), c = Math.cos(phase);
    const q = w.amp * w.k;

    dx -= dirx * w.amp * s;
    dz -= dirz * w.amp * s;
    dy += w.amp * c;

    jxx -= q * dirx * dirx * c;
    jzz -= q * dirz * dirz * c;
    jxz -= q * dirx * dirz * c;

    nx -= dirx * w.amp * w.k * s;
    nz -= dirz * w.amp * w.k * s;
  }

  const n = [nx, 1, nz];
  const l = Math.hypot(n[0], n[1], n[2]) || 1;
  return {
    x: x + dx, y: dy, z: z + dz,
    n: [n[0] / l, n[1] / l, n[2] / l],
    // det of [[jxx, jxz], [jxz, jzz]] — the area a patch of surface maps to
    jacobian: jxx * jzz - jxz * jxz,
  };
}

/**
 * Beer–Lambert transmission through `d` metres of water, per channel.
 *
 * Quantised into `DEPTH_BANDS` steps rather than graded, per §M2's reading of
 * the reference's river. The physics decides *what* each band's colour is; the
 * banding decides that you can see where one ends.
 */
export function transmission(d, banded = true) {
  const dd = banded
    ? (Math.floor(clamp(d, 0, DEPTH_RANGE) / DEPTH_RANGE * DEPTH_BANDS) + 0.5)
      / DEPTH_BANDS * DEPTH_RANGE
    : clamp(d, 0, DEPTH_RANGE);
  return EXTINCTION.map((k) => Math.exp(-k * dd));
}

/**
 * Schlick's approximation to the Fresnel reflectance of an air–water interface.
 * n = 1.333 gives R₀ = 0.02 — water reflects 2% of the light striking it head
 * on, and nearly all of it at a grazing angle. That single number is why a lake
 * is a mirror at the far shore and a window at your feet.
 */
export function fresnel(cosTheta, r0 = 0.02) {
  const c = clamp(1 - cosTheta, 0, 1);
  return r0 + (1 - r0) * c * c * c * c * c;
}

/**
 * Whitecap coverage at a point: the fraction of it that is foam.
 *
 * The Jacobian criterion is right and, on its own, almost never fires — which
 * is a fact about the sea rather than a bug. A fully developed sea has H_s ∝ U²
 * *and* λ_peak ∝ U², so its steepness is roughly constant with wind and sits
 * near 0.1: measured on the shipped 10 m/s set, Σ A·k = 0.104 against a folding
 * limit of 1. The dominant swell does not break. That is why the open ocean is
 * not white.
 *
 * Real whitecaps come from the wind tearing the crest off waves far shorter
 * than the ones being summed here — the spectrum's tail, below the resolution
 * of twelve components. So the coverage has two terms and both are physical:
 *
 *   · the fold, where the resolved surface genuinely overturns (rare, and
 *     dramatic when it happens);
 *   · crest shear, which switches on near the 6 m/s that raises the first
 *     whitecaps at sea and grows from there, applied to the top of the crest
 *     where the unresolved short waves ride.
 *
 * Without the second term the sea is glassy in a gale, which is the wrong
 * answer arrived at from the right equation.
 *
 * What this does **not** supply is the *distribution*. Whitecaps are not a
 * ribbon along every crest — a wave breaks where the short waves riding it
 * happen to pile up, so part of a crest goes white and the rest does not.
 * Applied unpatched this drew a continuous white line down every wave in the
 * frame. The criterion was right; the distribution was missing, and it is
 * applied as a noise patch in the fragment where the noise already lives.
 */
export function whitecap(windSpeed, jacobian, heightOverHs) {
  const fold = jacobian < 0 ? 1 : Math.max(0, 1 - jacobian / 0.22);
  // Beaufort 4 is where the sea starts showing white; below it, nothing
  const wind = clamp((windSpeed - 6) / 12, 0, 1);
  const crest = clamp((heightOverHs - 0.55) / 0.5, 0, 1);
  return clamp(Math.max(fold, wind * wind * crest), 0, 1);
}

/** the GLSL half, generated from the same constants */
export const OCEAN_GLSL = /* glsl */`
  uniform vec4 uWave[${WAVE_COUNT}];   // xy: direction·k, z: amplitude, w: omega
  uniform float uWavePhase[${WAVE_COUNT}];
  uniform vec3 uExtinction;
  uniform vec3 uDeepCol;
  uniform vec3 uShallowCol;

  const float DEPTH_BANDS = ${DEPTH_BANDS}.0;
  const float DEPTH_RANGE = ${DEPTH_RANGE.toFixed(1)};

  // Gerstner sum. Returns the displacement; jac comes back as the determinant
  // of the horizontal map, which is negative exactly where the surface has
  // folded through itself — a breaking crest, and the only honest place to put
  // foam.
  vec3 gerstner(vec2 p, float t, out vec3 nrm, out float jac) {
    vec3 d = vec3(0.0);
    float jxx = 1.0, jzz = 1.0, jxz = 0.0;
    vec2 n = vec2(0.0);
    for (int i = 0; i < ${WAVE_COUNT}; i++) {
      vec2 kv = uWave[i].xy;                 // direction * wavenumber
      float kk = length(kv);
      vec2 dir = kv / max(kk, 1e-6);
      float amp = uWave[i].z;
      float phase = dot(kv, p) - uWave[i].w * t + uWavePhase[i];
      float s = sin(phase), c = cos(phase);
      float q = amp * kk;

      d.xz -= dir * amp * s;
      d.y += amp * c;

      jxx -= q * dir.x * dir.x * c;
      jzz -= q * dir.y * dir.y * c;
      jxz -= q * dir.x * dir.y * c;

      n -= dir * amp * kk * s;
    }
    nrm = normalize(vec3(n.x, 1.0, n.y));
    jac = jxx * jzz - jxz * jxz;
    return d;
  }

  // Beer–Lambert, quantised into bands. The exponential decides what each band
  // is; the banding decides that you can see where one ends (§M2, and the
  // reference's river).
  vec3 waterBody(float depth, vec3 skyCol) {
    float dq = (floor(clamp(depth, 0.0, DEPTH_RANGE) / DEPTH_RANGE * DEPTH_BANDS) + 0.5)
      / DEPTH_BANDS * DEPTH_RANGE;
    vec3 T = exp(-uExtinction * dq);
    // what comes back up: the bottom, dimmed by the water it climbed through,
    // over the body colour of the water itself
    return mix(uDeepCol, uShallowCol, T.b) * (0.35 + 0.65 * T.g)
         + skyCol * 0.06 * T.b;
  }

  // Schlick. R0 = 0.02 for water: 2% head on, nearly all at a grazing angle.
  float waterFresnel(float cosTheta) {
    float c = clamp(1.0 - cosTheta, 0.0, 1.0);
    float c2 = c * c;
    return 0.02 + 0.98 * c2 * c2 * c;
  }

  // Whitecaps: the fold where the surface overturned, plus the crest shear
  // that produces every whitecap you have actually seen — see the note on
  // whitecap() in this module for why one term is not enough.
  float whitecap(float windSpeed, float jac, float hOverHs) {
    float fold = jac < 0.0 ? 1.0 : max(0.0, 1.0 - jac / 0.22);
    float wind = clamp((windSpeed - 6.0) / 12.0, 0.0, 1.0);
    float crest = clamp((hOverHs - 0.55) / 0.5, 0.0, 1.0);
    return clamp(max(fold, wind * wind * crest), 0.0, 1.0);
  }

  // Quantised glitter. A specular lobe on moving water resolves to a smear of
  // grey; a real glitter path is thousands of individual facet flashes, and at
  // this distance the honest rendering of "too many to count" is a hard step
  // rather than a soft falloff. §M2 asks for it and §11 warns it will look like
  // a bug to a physically-based reflex.
  float glitter(vec3 n, vec3 v, vec3 l, float rough) {
    vec3 h = normalize(v + l);
    float ndh = max(dot(n, h), 0.0);
    float lobe = pow(ndh, mix(900.0, 120.0, rough));
    return floor(clamp(lobe, 0.0, 1.0) * 4.0 + 0.35) * 0.25;
  }
`;

/** pack a wave set into the uniform arrays `OCEAN_GLSL` expects */
export function waveUniforms(waves) {
  const v = [], ph = [];
  for (const w of waves) {
    v.push(Math.cos(w.dir) * w.k, Math.sin(w.dir) * w.k, w.amp, w.omega);
    ph.push(w.phase);
  }
  return { data: v, phase: ph };
}
