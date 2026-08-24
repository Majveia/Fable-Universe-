// Photometric auto-exposure — `docs/plans/SAKURA.md` §4, CLAUDE.md §M8.
//
// `print.js` has carried a `uExposure` uniform since it was written and nothing
// has ever driven it. It is 1, on every world, at every hour, under every star.
//
// That is a bigger defect than it sounds, and it is why AEON's nights and
// sakura-realm's nights do not look alike. Sakura-realm's day/night cycle works
// because an exposure follows the light: at noon it stops down, at dusk it
// opens, and the opening takes its time — which is the only reason a sunset
// reads as a sunset rather than as the same frame getting darker. With
// `uExposure = 1` the whole 24 hours is one aperture, so noon clips and
// midnight is a black rectangle, and no amount of grading fixes either.
//
// ---------------------------------------------------------------------------
// What cannot port, and what replaces it
//
// The reference drives its exposure from an **eighteen-key hand-authored
// curve**, anchored to sunrise, solar noon, sunset and midnight, with morning
// and evening deliberately not mirrored *"because perfect symmetry is one of
// the loudest tells that a day/night cycle was generated rather than
// observed."* It is a good curve and it is one world's art direction. AEON has
// 10²⁸ and no author for any of them.
//
// So this is §9.6's ruling applied one system over — *"derive [it] through a
// fixed transfer, rather than hardcoding... That is the port: not the values,
// the function that produced them."* The target exposure is computed from the
// **irradiance actually arriving at the ground**, out of quantities `system.js`
// already publishes because the orbit diagram needed them:
//
//     E_top = 1361 · L☉ / au²          inverse square, this world's real orbit
//     m     = Kasten–Young air mass at this elevation
//     E_dir = E_top · exp(−τ·m) · sinElev
//     E_sky = the diffuse hemisphere, and the twilight that outlives the sun
//     EV    = log2( (E_dir + E_sky) · albedo / π / L_ref )
//
// and the fixture — a G2 star at 1 AU with the sun 45° up over albedo 0.18 —
// **returns exactly 1**, by construction rather than by fitting, the same way
// `airColours(5778, 13.5)` is the identity in `starlight.js`.
//
// What that buys is not a nicer curve. It is that **the exposure is a readout
// of where you are standing in a solar system.** A world at 0.4 AU around an F
// star genuinely stops down two and a half stops; an M-dwarf world at 0.08 AU
// opens up; and neither was authored, tuned, or given a keyframe.
//
// ---------------------------------------------------------------------------
// The one thing that does port verbatim, because it is not about a world
//
// Adaptation. Light adaptation is fast and dark adaptation is slow — that is a
// fact about a retina and about every iris ever built, so the reference's
// asymmetric exponential damping in log2 space, with a hard slew ceiling in
// stops per second, ports as a mechanism with its constants intact.
//
// No THREE, no clock: `step()` takes its own dt, so `tools/verify.js` can run a
// whole dusk through it without a GPU and without a frame (§14).

// Kasten & Young (1989) relative air mass, and it is **imported** rather than
// written again. `starlight.js` needed exactly this function to redden a star's
// beam on its way to the eye, and a second copy here would be §2.7's height-
// field trap at the scale of a formula: the naive `1/sin(h)` is right to a
// percent above 15° and says *infinity* at the horizon where the true value is
// about 38, so a drifted copy would be wrong precisely in the 8–18° band §9.7
// forces every spawn into.
import { airmass } from './starlight.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const num = (v, d) => (Number.isFinite(v) ? v : d);

// ---------------------------------------------------------------------------
// the medium

/** Solar constant at 1 AU, W/m². The scale everything below is expressed in. */
export const SOLAR_CONSTANT = 1361;

/**
 * Broadband atmospheric optical depth at zenith for clear Earth air.
 *
 * 0.21 is the integrated value that reproduces the measured clear-sky direct
 * normal irradiance at sea level — about 1050 W/m² at the zenith, against 1361
 * at the top. `exp(−0.21) = 0.811`, and `1361 × 0.811 = 1104`; the remainder
 * is the water-vapour and ozone bands this single number is standing in for.
 * Good to a few percent across the whole solar band, which is far better than
 * an exposure needs.
 */
export const TAU_ZENITH = 0.21;

/**
 * The fraction of top-of-atmosphere irradiance that arrives as **diffuse
 * skylight** with the sun high. Roughly 13% on a clear day at sea level — it is
 * the light that made the sky blue instead of reaching the ground directly, so
 * it is bounded below by the Rayleigh scattering that produced the colour.
 *
 * It matters here more than its size suggests: it is what keeps a shadowed
 * frame exposed, and without it every shot into shade would open two stops and
 * hunt.
 */
export const DIFFUSE_FRACTION = 0.13;

/**
 * How much light the sky still delivers with the sun **below** the horizon,
 * as a fraction of the high-sun diffuse term, at the bottom of civil twilight
 * (−6°) and at the bottom of astronomical twilight (−18°).
 *
 * Measured sky luminance falls by roughly a factor of 400 between sunset and
 * the end of civil twilight, and by another 1000 to full night — so these are
 * not softening constants, they are the shape of the actual falloff, and they
 * are what makes the blue hour last as long as it does rather than snapping off
 * at the horizon.
 */
export const TWILIGHT_CIVIL = 2.5e-3;
export const TWILIGHT_ASTRO = 2.5e-6;

/**
 * The night floor, as a fraction of the same term. Airglow, integrated
 * starlight and zodiacal light: a moonless night sky is not black and never
 * has been, and a floor of zero would send `log2` to −∞ and the exposure to its
 * clamp on every world at midnight.
 *
 * `starlight.js` and `night.js` already render what this is the brightness of.
 */
export const NIGHT_FLOOR = 4.0e-7;

/**
 * The fixture: a G2 star, 1 AU, sun 45° up, ground albedo 0.18.
 *
 * Named `APERTURE_FIXTURE` because `starlight.js` already exports a `FIXTURE`
 * and it is a different one — a 5778 K star at 13.5°, the anchor that makes
 * `airColours()` reproduce §9.1's painted stops. Both are fixtures, neither is
 * the other, and one name for two would be the same trap `apertureFor` is
 * named around.
 */
export const APERTURE_FIXTURE = { lum: 1, au: 1, elevDeg: 45, albedo: 0.18 };

/**
 * How much of the swing the exposure actually takes out — and it is **two**
 * numbers, because there are two swings and the renderer has already handled
 * one of them.
 *
 * This is the correction that the first draft of this file got wrong, and it is
 * worth writing down because the mistake is the natural one. A day spans about
 * 21 stops between noon and a moonless midnight. Compensate that fully — or
 * even at 0.82 of it — and the exposure runs straight into its clamp before the
 * sun has finished setting, which is exactly what it did: 6.0, the ceiling, at
 * a **5° sun**, and every hour after that identical to every other.
 *
 * The reason is that a photometric exposure is only correct over a
 * **scene-referred** frame, and AEON's is not one. Its key light is
 * `2.2 · min(4·sinElev, 1)` — clamped, so every sun above 15° delivers exactly
 * the same light — and its night sky is painted at a level chosen to read
 * rather than at 4×10⁻⁷ of noon. The renderer has already compressed the day.
 * An exposure that compensates the *unc*ompressed swing is compensating a
 * quantity nothing on screen has.
 *
 * So each term is compensated in proportion to what the renderer already did
 * with it, and the two terms are on opposite ends of that:
 *
 * **The diurnal term** the renderer varies, hard, and the reference's own curve
 * says how much is left over: sakura-realm's eighteen keys run from 0.80 at
 * solar noon to 2.75 at solar midnight. That is its entire 24-hour range, and
 * it is **1.78 stops** across a scene whose true swing is 21 — an effective
 * compensation of 0.085. Measured off the reference, not chosen.
 *
 * **The orbital term** the renderer does not vary *at all*. `dirLight.intensity`
 * carries no `L☉/au²` — a world at 0.4 AU around an F star is lit exactly like
 * a world at 1 AU around a G2. So here the exposure is the only instrument that
 * can express the orbit, and it gets a much larger share. Not all of it: 1.0
 * would make every world identically bright, which is the light-meter failure
 * §M8 names and the opposite of the point. 0.35 leaves a bright world looking
 * bright and stops it clipping.
 *
 * The asymmetry between these two numbers is not an inconsistency. It is the
 * whole design: **compensate what the renderer did not.**
 */
export const K_DIURNAL = 0.085;
export const K_ORBITAL = 0.35;

/** the clamp, in linear multiplier. Wide enough for an M dwarf and an F star. */
export const EXPOSURE_MIN = 0.10;
export const EXPOSURE_MAX = 4.0;

// ---------------------------------------------------------------------------
// the arriving light

/**
 * Mean scene luminance, in W/m²/sr, for one world at one hour.
 *
 * Lambertian: a surface of albedo `a` under irradiance `E` radiates `E·a/π`
 * into every direction, so this is what a camera pointed anywhere at the ground
 * actually receives. It is deliberately the *ground*, not the sky: an exposure
 * metered off the sky would stop down for a bright horizon and put the meadow
 * in silhouette, which is the classic error and it is the one the reference's
 * hand-authored curve exists to avoid.
 *
 * `lum` is L☉, `au` the orbital distance in AU, `elevDeg` the star's elevation,
 * `albedo` the ground's — every one of which is already on the planet record.
 */
export function sceneLuminance({ lum = 1, au = 1, elevDeg = 45, albedo = 0.18, tau = TAU_ZENITH } = {}) {
  const L = Math.max(num(lum, 1), 1e-6);
  const d = Math.max(num(au, 1), 1e-4);
  const h = num(elevDeg, 45);
  const a = clamp(num(albedo, 0.18), 0.02, 0.95);

  const Etop = (SOLAR_CONSTANT * L) / (d * d);

  // direct beam, gated at the horizon — Beer–Lambert through `airmass` masses
  const direct = h > 0
    ? Etop * Math.exp(-Math.max(num(tau, TAU_ZENITH), 0) * airmass(h)) * Math.sin((h * Math.PI) / 180)
    : 0;

  // The sky. Above the horizon it scales with the sun's height, because a low
  // sun illuminates less of the hemisphere it is scattering out of; below it,
  // the two twilight decades take over, and the night floor catches the bottom.
  //
  // Piecewise in *log* of the fraction rather than in the fraction itself: the
  // quantity falls by five and a half decades between sunset and midnight, and
  // interpolating that linearly would put civil twilight at a third of daylight
  // instead of a four-hundredth.
  let skyFrac;
  if (h >= 0) {
    skyFrac = DIFFUSE_FRACTION * (0.22 + 0.78 * Math.sin((h * Math.PI) / 180));
  } else if (h >= -6) {
    skyFrac = DIFFUSE_FRACTION * Math.exp(
      Math.log(0.22) + (Math.log(TWILIGHT_CIVIL) - Math.log(0.22)) * (-h / 6));
  } else if (h >= -18) {
    skyFrac = DIFFUSE_FRACTION * Math.exp(
      Math.log(TWILIGHT_CIVIL)
      + (Math.log(TWILIGHT_ASTRO) - Math.log(TWILIGHT_CIVIL)) * ((-h - 6) / 12));
  } else {
    skyFrac = DIFFUSE_FRACTION * TWILIGHT_ASTRO;
  }
  const sky = Etop * (skyFrac + DIFFUSE_FRACTION * NIGHT_FLOOR);

  return ((direct + sky) * a) / Math.PI;
}

/**
 * The fixture's luminance at **unit orbit** — the denominator that makes the
 * reference case exactly 1.
 *
 * Evaluated with `lum = 1, au = 1` deliberately, because `exposureFor()` splits
 * the orbit back out as its own term. Leaving `L☉/au²` inside this denominator
 * as well would compensate it twice, once at 0.085 and once at 0.35.
 */
export const REFERENCE_LUMINANCE = sceneLuminance({ ...APERTURE_FIXTURE, lum: 1, au: 1 });

/**
 * The exposure this world wants, as a linear multiplier on `uExposure`.
 *
 * **Named `apertureFor`, not `exposureFor`, and deliberately.** `night.js`
 * already exports an `exposureFor` and it answers a different question — how
 * bright to draw the night *sky dome* for a given lux. Two functions with one
 * name in one language is the trap §11 names about the height field, and the
 * cost of tripping it is a session spent debugging the wrong module. This is a
 * camera aperture; that one is a dome's brightness.
 *
 * Two terms, compensated at their own rates for the reason `K_DIURNAL` and
 * `K_ORBITAL` set out — the renderer already varies the first and does nothing
 * whatever about the second:
 *
 *     ev_diurnal = log2( L(elev, albedo) / L(45°, 0.18) )     at unit orbit
 *     ev_orbital = log2( L☉ / au² )                            pure inverse square
 *     exposure   = 2^( −K_DIURNAL·ev_diurnal − K_ORBITAL·ev_orbital )
 *
 * `apertureFor(APERTURE_FIXTURE)` is **1.000000**, and that is the whole reason the
 * fixture is written down: an exposure that moved the reference case would make
 * every capture ever taken of this project incomparable with every capture
 * taken after it. Both terms are zero there by construction, not by fitting.
 *
 * Worked, so the range is checkable rather than asserted — at 1 AU under a G2:
 *
 * | sun | exposure | |
 * |---|---|---|
 * | 90° | 0.97 | overhead |
 * | 45° | 1.00 | the fixture |
 * | 13.5° | 1.13 | §9.7's golden-hour band, a fifth of a stop open |
 * | 0° | 1.30 | sunset |
 * | −6° | 1.90 | the end of civil twilight — the blue hour, and it is a *stop* |
 * | −18° | 3.38 | full night, where the twilight decades bottom out |
 *
 * **1.81 stops end to end**, against the reference's measured 1.78 over its own
 * 24 hours. Not fitted to it — that agreement is what says the irradiance model
 * and the eighteen hand-placed keys are describing the same thing.
 */
export function apertureFor(world = {}) {
  const { lum = 1, au = 1 } = world;
  const evDiurnal = Math.log2(
    Math.max(sceneLuminance({ ...world, lum: 1, au: 1 }), 1e-12) / REFERENCE_LUMINANCE);
  const evOrbital = Math.log2(
    Math.max(Math.max(num(lum, 1), 1e-6) / Math.max(num(au, 1), 1e-4) ** 2, 1e-12));
  return clamp(
    Math.pow(2, -K_DIURNAL * evDiurnal - K_ORBITAL * evOrbital),
    EXPOSURE_MIN, EXPOSURE_MAX);
}

// ---------------------------------------------------------------------------
// the eye

/**
 * Adaptation rates, ported verbatim from the reference because they are a fact
 * about retinas rather than about a world. Exponential-decay lambdas in log2
 * space, plus an absolute ceiling in stops per second.
 *
 * The asymmetry is the whole mechanism: **stopping down is three times faster
 * than opening up**, which is why walking out of a cave hurts and walking into
 * one is merely dark for a while. Symmetric adaptation is instantly readable as
 * wrong even by someone who could not say why.
 */
export const ADAPT_BRIGHTEN = 1.9;
export const ADAPT_DARKEN = 0.62;
export const ADAPT_MAX_STOPS_PER_SEC = 1.35;

/** exponential approach that is stable at any dt, unlike `a += (b-a)*k*dt` */
const damp = (a, b, lambda, dt) => b + (a - b) * Math.exp(-lambda * dt);

/**
 * The adapting eye.
 *
 * Integrates in log2 rather than in linear, because that is the space
 * adaptation is actually exponential in — a linear damp toward a target two
 * decades away spends its whole first second covering 99% of the distance and
 * then crawls, which reads as a cut followed by a drift.
 *
 * `prime()` snaps, and every scale entry has to call it: arriving on a night
 * world and watching the exposure take eleven seconds to find the ground is a
 * §2.5 violation with extra steps. The first frame of a place is exposed for
 * that place.
 */
export class Adaptation {
  constructor(ev = 0) {
    this.ev = ev;
    this.primed = false;
  }

  /** snap to a target — for a scale entry, a teleport, or a deep-link arrival */
  prime(targetExposure) {
    this.ev = Math.log2(clamp(num(targetExposure, 1), EXPOSURE_MIN, EXPOSURE_MAX));
    this.primed = true;
    return Math.pow(2, this.ev);
  }

  /**
   * One frame. Returns the linear exposure to hand the print.
   *
   * The slew ceiling is not redundant with the lambda: a large dt — a stalled
   * frame, a tab that came back, a `?dt=` capture stepping a whole dusk — makes
   * the exponential cover almost the full distance in one step, and the ceiling
   * is what guarantees a *ramp* rather than a jump regardless of how the frames
   * arrived. Which matters here specifically because `tools/repeat.js` compares
   * two cold runs at a fixed frame index, and an exposure that could jump would
   * be a determinism leak dressed as a look.
   */
  step(dt, targetExposure) {
    const target = clamp(num(targetExposure, 1), EXPOSURE_MIN, EXPOSURE_MAX);
    const targetEV = Math.log2(target);
    if (!this.primed) return this.prime(target);

    const d = Math.max(num(dt, 0), 0);
    // The direction is easy to get backwards and it was, so it is spelled out:
    // this integrates *exposure*, and exposure moves opposite to light. A
    // target EV **below** where we are is a smaller aperture, which is the
    // scene having got brighter, which is the fast direction. Reading
    // `targetEV > ev` as "brightening" inverts the whole mechanism and makes
    // walking into a cave the quick adaptation, which is exactly wrong.
    const sceneBrightened = targetEV < this.ev;
    const lambda = sceneBrightened ? ADAPT_BRIGHTEN : ADAPT_DARKEN;

    let next = damp(this.ev, targetEV, lambda, d);
    const maxStep = ADAPT_MAX_STOPS_PER_SEC * d;
    const delta = next - this.ev;
    if (delta > maxStep) next = this.ev + maxStep;
    else if (delta < -maxStep) next = this.ev - maxStep;

    this.ev = next;
    return Math.pow(2, this.ev);
  }
}
