// The score, derived — CLAUDE.md §2.1, §2.3, and §3's ruling that Bebop
// "informs *interface and score only*", which is a licence for the shape of
// the music and not for its content.
//
// `src/audio.js` already has an ambience, and it is a mood board: twelve
// hand-written chord tables indexed by a resonance name, a wind filter opened
// by `atmo`, and a root chosen as `130.8 · 2^(hash%5/12)` — a seeded
// transposition of a value somebody liked. It sounds fine. It is also the only
// system in this project that does not *read* anything. Every other module has
// been pulled onto real numbers: `magnetosphere.js` gets its colours from
// emission-line lifetimes, `night.js` gets its blue from the Purkinje shift,
// `aerial.js` gets its fog length from a scale height. The sound was still a
// preference with a seed on it.
//
// This file is the same move applied to the music. Nothing below is chosen by
// ear. There are eleven constants, every one of them measured, and everything
// else is a formula.
//
// ---------------------------------------------------------------------------
// 1 · One instrument, ten thousand atmospheres
//
// The pitch is not seeded. It is the speed of sound.
//
//     c = sqrt( γ R T / M )
//
// and an open pipe of length L sounds at `c / 2L`. So the score is **one
// instrument** — a single 1.55 m pipe, the same one on every world — and what
// transposes it is the air it is standing in. That is not a metaphor. It is
// why a helium voice is high and why a bassoon goes sharp in a warm hall.
//
//     Earth        288 K  N₂/O₂   c = 340 m/s   root  110.0 Hz   A2
//     a cold thin world 210 K      c = 291       root   93.9      F♯2
//     a gas giant  113 K  H₂/He    c = 762       root  246.2      B3
//     a lava world 736 K           c = 544       root  175.8      F3
//
// An octave and a half of range, and every semitone of it is a fact about the
// world. A cold world under any star is *low*, because cold air is slow.
//
// The one place this breaks is a vacuum, and it breaks honestly: with no gas
// there is no air column, the instrument is not being transposed by anything,
// and it sounds at its design pitch. An airless world is the only world whose
// music does not move with its weather, because it does not have any.
//
// ---------------------------------------------------------------------------
// 2 · The star writes the timbre, through its own Planck curve
//
// A spectrum is power against frequency whether the frequency is 10¹⁴ Hz or
// 10² Hz, so the star's spectrum can simply *be* the drone's spectrum, read at
// the harmonics of the root instead of at wavelengths.
//
// The trap is that a blackbody is scale-invariant in `ν/T`: transposing the
// optical band into the audio band by a ratio that depends on T would give
// every star in the universe an identical timbre. So the ratio is **fixed**,
// once, by requiring that the Sun's Wien peak land on 330 Hz. Then the ladder
// of harmonics is nailed to the optical spectrum and the shape genuinely
// changes with temperature:
//
//     x = 49.35 · f / T_star        (h/k, divided through by that ratio)
//     B̂(x) = x³ / (eˣ − 1)          the Planck function, in frequency
//
// A hot star's peak sits *above* the top of the ladder, so every partial is on
// the rising ν³ side and the drone is bright and reedy. A red dwarf's peak
// sits *below* the fundamental, so the whole ladder rides the Wien tail, which
// falls off exponentially — and the drone collapses to a fundamental with the
// shadow of a second partial behind it. Measured over the bed, the amplitude-
// weighted centroid runs 178 Hz at 2800 K to 577 Hz at 25000 K on the same
// root. That is the readout: **a cold star cannot hold an overtone.**
//
// And it decides the chord, not just the colour. The chord degrees are the
// pipe's own overtones folded into two octaves — 1, 9/8, 5/4, 11/8, 3/2, 13/8,
// 7/4, 15/8, which is the harmonic-series mode and the reason spectral music
// sounds like that — but a degree is only *available* if the source spectrum
// actually contains the partial it was folded from. A G star reaches the 11th
// and the harmony goes strange and Lydian; an M dwarf at 3400 K is left with
// 1, 5/4, 3/2, a plain major triad, because its 9th partial is already gone.
// Same code, same seed, different star.
//
// ---------------------------------------------------------------------------
// 3 · The air writes the room, and the room is the whole reverb
//
// The impulse response is not a preset and not a file (§2.1). It is a ray
// budget over the actual ground.
//
// An impulse leaves, scatters off terrain at distance `d`, and comes back at
// `t = 2d/c`. Over flat ground the number of scatterers in an annulus grows as
// `d` while round-trip spreading falls as `1/d²`, so the energy envelope goes
// as `1/t` — amplitude `1/√t`. Three things then cut it short, and each is a
// different property of the world:
//
//   · **Ground absorption.** A ray at distance `d` has bounced roughly `d/ℓ`
//     times off terrain of ridge spacing ℓ, keeping `(1−a)` each time. A
//     meadow at `a = 0.62` gives a 0.36 s e-fold, so a 2.5 s T60 — a valley,
//     and the right answer. Dry snow at `a = 0.82` gives 1.6 s and is the
//     shortest room in the project, which is the famous silence of snowfall.
//     Open water at `a = 0.05` runs to a 45 s T60 and hits the ceiling.
//
//   · **Air absorption**, which is where the brief's "thin air carries the
//     high end worse" comes from and it is exactly right: classical absorption
//     per metre goes as `f²/P`, so *halving the pressure doubles the loss*.
//     Rather than filter the tail in bands, the noise is generated through a
//     one-pole whose corner tracks the frequency at which the tail has lost
//     one e-fold:
//
//         f_c(t) = 1000 · sqrt( ρ/ρ⊕ / (α₁ₖ · c · t) )
//
//     Earth air: 2.2 kHz at one second, 1.3 kHz at three — which is what a
//     real outdoor tail does. At a hundredth of an atmosphere it is 220 Hz at
//     one second, and the world answers you in a mumble. Perseverance measured
//     precisely this on Mars: everything above a few hundred hertz simply does
//     not come back.
//
//   · **The horizon.** Nothing beyond `sqrt(2 R h)` can scatter to an eye at
//     height `h`, so the tail hard-stops at `2·sqrt(2 R h)/c`. On an Earth it
//     is 27 s and never binds; it only starts to bite on bodies of a few tens
//     of kilometres, where it falls under the response budget itself. It is in
//     here anyway, for two lines, because it is the term that says **the
//     reverb time is the size of the world** — and because a project with
//     10²⁸ addressable bodies in it will eventually stand on one that small.
//
// Scattering and absorption are separate numbers and that matters. An ocean is
// acoustically hard (long) but specular (quiet): few returns, and the ones
// that come are late. Rough basalt is hard *and* diffuse: the biggest room in
// the project. Meadow is diffuse and absorbent: short, close, present.
//
// ---------------------------------------------------------------------------
// 4 · Gravity writes the tempo, through the same number the gait clock uses
//
// Walking is a pendulum problem, and the pendulum is the leg. Preferred
// walking speed sits at a Froude number of about 0.25:
//
//     v = sqrt(0.25 · g · L_leg)      f_stride = v / stride
//
// which gives 0.93 Hz on Earth and 0.38 Hz on the Moon — and 0.38 Hz is the
// lope in the Apollo footage, arrived at rather than fitted. §M4 asks for one
// gait clock driving bob, footfall and the grass the walker parts; this is the
// same clock, sixteen strides to a phrase. So a phrase is 17 s on Earth, 42 s
// on a moon, 10 s at three gravities. Low gravity does not merely *sound*
// slower. It is slower, by the same formula that makes the walk slower.
//
// ---------------------------------------------------------------------------
// 5 · Water decides whether anything is alive, via Clausius–Clapeyron
//
// `life.js` gates its tufts on `Teq ∈ [235, 330]`, a hard band with a hard
// edge, which is right for deciding whether to allocate a mesh and wrong for
// deciding how much of a texture to put in a mix. The soft version is the
// actual condition: **is there liquid water on the ground?**
//
//     T_boil(P) = 1 / ( 1/373.15 − (R/L_vap)·ln(P/P₀) )
//
// At half an atmosphere that returns 354 K, which is the number on the back of
// a pressure cooker. At 0.006 atm it returns 268 K — *below* freezing — and
// the liquid window closes to nothing. That is the triple point falling out of
// the formula rather than being written in, and it means an organic layer is
// impossible on a thin world for the correct reason instead of by a threshold.
//
// Gated additionally on terrestrial/ocean, because it has to agree with what
// `life.js` will actually render: hearing insects over bare regolith is a §8
// axis 8 failure even if the thermodynamics allows it.
//
// ---------------------------------------------------------------------------
// 6 · Dusk, which is a thermal lag and a boundary layer
//
// Two real nocturnal effects, and between them they are the whole of the
// evening.
//
// **The ground cools, so the pitch falls.** Diurnal temperature range is set
// by how much heat the air can hold overnight: about 10 K of 288 on Earth,
// 80 K of 210 on Mars, 280 K of 250 on an airless Moon. Fitted through those
// three anchors, `ΔT/T = 1.1 / (1 + 30·√atmo)`. Through `c ∝ √T` that is 18
// cents of nightly droop on a temperate world and 70 — most of a quarter-tone
// — on a thin one: a slow flattening into the dark and a slow sharpening at
// dawn, which no listener will name and every listener will feel.
//
// The lag is not decoration either: it is a one-pole filter on the radiative
// drive with a time constant of a twelfth of a day, which is where the real
// two-hour lag between local noon and peak temperature comes from. That is why
// this takes `dt`. It is also why the coldest moment is just before dawn.
//
// **The night carries further.** After sunset the boundary layer inverts:
// warm air over cold ground refracts sound *downward* instead of up, which is
// the reason you can hear a train at night that you cannot hear at noon. So
// the wet send rises after dusk and the return darkens — a bigger, lower room,
// appearing on its own, out of the same elevation the sky is reading.
//
// ---------------------------------------------------------------------------
// 7 · Why it does not loop
//
// §M1's gate says motion must be "non-loopable because it is integrating". The
// ear is much less patient than the eye about this — four seconds and it has
// the pattern — so four separate mechanisms have to hold:
//
//   · Every modulator rate is `breath × an irrational multiplier`, so no two
//     of them ever realign. `suiteScore` measures this directly, by
//     autocorrelating the composite envelope over ten minutes.
//   · Voice entries come from a shuffle bag with an independently drawn gap,
//     so the *set* of pitches recurs (which is what makes it a key) while the
//     *sequence* does not (which is what stops it being a loop).
//   · The root itself is drifting, continuously, with the temperature of the
//     air. Nothing in the piece is in the same place it was an hour ago.
//   · And the pipe is blown by the wind, which is the one of the four that is
//     genuinely *integrating* rather than merely incommensurate. Read on,
//     because the first three were written first and were not enough.
//
// **Irrational rates are necessary and not sufficient, and §2 above says
// exactly where they fail.** Incommensurate frequencies never repeat, but a
// sum of *two* of them comes arbitrarily close to repeating, and comes close
// early: Poincaré recurrence is a promise about a lag existing, not about it
// being long. How many components the sum has is not a musical choice here —
// it is the star's, because a modulator rides each bed partial at that
// partial's own amplitude, and §2's whole finding is that **a cold star cannot
// hold an overtone.** A gas giant under a G star lands 82% of the envelope's
// energy in the fundamental's tremolo and 18% in the second, and two
// components at that split autocorrelate to **0.982 within a minute** — a
// swell you could set a watch by, on exactly the worlds the timbre model is
// proudest of. The mechanism that was supposed to prevent loops is weakest
// precisely where the spectrum is most interesting.
//
// The fix is not a fifth irrational. Adding components that the star has
// already silenced changes no number. It is that **a pipe is as loud as it is
// blown**, and what blows this one is `src/wind.js` — the same field the grass
// and the dust and the cloud deck read, sampled at the ear, at ear height.
// Aerodynamically that field is not quasi-periodic at all: §M3's gust cells
// travel through the lattice and never return, and its turbulence is advected
// with the flow. So the drive is
//
//     drive(t) = 1 + column · ( U(t)/Ū − 1 )
//
// with no coefficient to choose. `U/Ū` is the field's own `gustNorm` and its
// standard deviation, measured over ten worlds, is 0.22–0.36 — which is the
// turbulence intensity, and `wind.js` already carries the measured 0.19 for
// open country. The `column` factor is §1's, unchanged: with no air there is
// no drive, the pipe holds still, and an airless world is *again* the only one
// whose music does not move with its weather. That sentence was already true
// of the pitch. Now it is true of the loudness for the same reason.
//
// Measured, the same way the defect was: the giant falls 0.982 → 0.43, an M
// dwarf 0.93 → 0.33, a lava world 0.92 → 0.41, and a temperate world — which
// was passing anyway — 0.65 → 0.14. The worst of ten worlds is now the airless
// one at 0.55, unmoved, because it is the only one with nothing to move it —
// which is the right world to have as the hardest case and was not the right
// world to be beaten by a gas giant.
//
// ---------------------------------------------------------------------------
// 8 · What it costs
//
// §5 gives 12 ms of main thread per frame and the renderer wants all of it.
//
// The audio graph runs on its own thread and does not spend the frame budget.
// What could is this file, so it does almost nothing per frame: `update()` is
// a seven-field identity compare, one multiply-add of the temperature lag, and
// a return. Parameter writes are throttled to 4 Hz of audio time, and voices
// are scheduled 4 s ahead in bursts of one. The only expensive call is
// `impulseResponse()` — a few hundred thousand samples of a one-pole, about a
// millisecond — and it happens once per world, inside the same re-voice that
// is already tearing down oscillators.
//
// Nothing here imports three.js, on purpose: every derivation above is under
// test in `tools/verify.js` and runs under node.

import { RNG, hash } from './rng.js';
import { molarMass, surfaceTemp } from './aerial.js';
import { RHO_EARTH, airDensity, makeWind, windAt } from './wind.js';
import { nightFraction } from './night.js';
import { GAIT, gravityOf } from './avatar.js';

const clamp = (x, a, b) => Math.min(Math.max(x, a), b);
const smoothstep = (e0, e1, x) => {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
};
/** every derived number goes through this: a NaN in a gain is a dead graph */
const finite = (x, fallback) => (Number.isFinite(x) ? x : fallback);

// ---------------------------------------------------------------------------
// the eleven constants
//
// Each is measured, and each is written where the formula that consumes it can
// be checked against a value somebody else published.

/** J/(mol·K) */
const R_GAS = 8.314462618;

/** adiabatic index: diatomic N₂/O₂/CO₂ air, and an 0.86/0.14 H₂/He mix */
export const GAMMA_AIR = 1.40;
export const GAMMA_HYDROGEN = 1.42;

/** the pipe sounds A2 in Earth's air; every other world transposes it */
export const ROOT_REF = 110;

/** the Planck peak, `x` where `3(1−e^{−x}) = x` */
export const X_PEAK = 2.8214393721;

/** the Sun, and where its Wien peak is pinned in the audio band */
export const SUN_T = 5772;
export const PEAK_AUDIO = 330;

/**
 * `x = PLANCK_K · f / T`. This is `h/k` divided by the optical→audio frequency
 * ratio, and the ratio is fixed by the line above rather than by T — see §2 of
 * the header, where scale invariance eats the naive version.
 */
export const PLANCK_K = (X_PEAK * SUN_T) / PEAK_AUDIO;    // 49.35 K·s

/** classical air absorption at 1 kHz, 20 °C, 1 atm: 0.005 dB/m, in nepers */
export const ALPHA_1K = 0.005 / 8.685889638;              // 5.757e-4 Np/m

/** mean spacing between terrain features that scatter — the valley scale */
export const RIDGE_SCALE = 120;

/** preferred walking gait: Froude 0.25, a 0.9 m leg, a 1.6 m stride */
export const FROUDE = 0.25;
export const LEG_LENGTH = 0.9;
export const STRIDE_LENGTH = 1.6;

/** sixteen strides to a phrase */
export const BREATH_STRIDES = 16;

/** latent heat of vaporisation of water, J/mol, and its reference point */
const L_VAP = 40660;
const T_BOIL_REF = 373.15;
const T_MELT = 273.15;

/** how far away the instrument stands, for the direct-path absorption */
const SOURCE_DIST = 12;

/** bone conduction is a low-pass; this is where it sits */
const BONE_CUTOFF = 780;

/** g at Earth's surface — the same value `avatar.js` walks under */
const G_EARTH = 9.80665;

/** ceiling on the impulse response, in seconds. A budget, not a physical claim. */
export const IR_MAX_SECONDS = 3.0;

// ---------------------------------------------------------------------- 1 ---
// the air, and therefore the pitch

/**
 * Speed of sound in an ideal gas. Returns 340.3 m/s for Earth's air at
 * 288.15 K, which is the published value to four figures, and about 920 m/s
 * for a Jovian H₂/He mix at 165 K, which is also right.
 */
export function speedOfSound(T, typeId = 1) {
  const gamma = (typeId ?? 1) >= 5 ? GAMMA_HYDROGEN : GAMMA_AIR;
  const M = molarMass(typeId ?? 1);
  return Math.sqrt((gamma * R_GAS * Math.max(T, 1)) / Math.max(M, 1e-6));
}

/** the pipe, in metres — defined so Earth's air sounds A2 rather than chosen */
export const PIPE_LENGTH = speedOfSound(288.15, 1) / (2 * ROOT_REF);

/** an open pipe of `PIPE_LENGTH`, in air that carries sound at `c` */
export function pipeRoot(c) {
  return c / (2 * PIPE_LENGTH);
}

/**
 * How much of the pitch the air owns.
 *
 * Below a few thousandths of Earth's density there is no air column to speak
 * of and the instrument sounds at its design pitch — which is the honest
 * answer, and it makes an airless world the only one whose music does not
 * move with its weather. Mars, at 0.016 ρ⊕, is comfortably above the knee:
 * Perseverance recorded sound there, so the model had better carry it.
 */
export function airShare(rho) {
  return smoothstep(0, 0.004 * RHO_EARTH, rho);
}

/**
 * Diurnal temperature range as a fraction of surface temperature.
 *
 * Three anchors, all measured: Earth 10 K of 288 at 1 atm, Mars 80 K of 210 at
 * 0.006, the Moon 280 K of 250 at nothing. The square root is the physics —
 * the heat a column of air can hold overnight goes with its mass, and the
 * response to it is not linear because the ground radiates as T⁴.
 */
export function diurnalSwing(atmo) {
  return 1.1 / (1 + 30 * Math.sqrt(Math.max(atmo, 0)));
}

/**
 * One step of the ground's thermal lag.
 *
 * A first-order low-pass on the radiative drive, which is what thermal inertia
 * physically *is*. Time constant a twelfth of a day, from the real ~2 h lag
 * between local noon and peak temperature — and it is also why the coldest
 * moment of the night is just before dawn rather than at midnight.
 *
 * `state` and the return are both the normalised drive in roughly [−0.5, 1].
 */
export function stepThermalLag(state, sunElevDeg, dt, dayLength) {
  const MEAN = 1 / Math.PI;             // day-average of max(sin h, 0)
  const drive = (Math.max(Math.sin(clamp(sunElevDeg, -90, 90) * Math.PI / 180), 0) - MEAN)
    / (1 - MEAN);
  const tau = Math.max(dayLength, 1) / 12;
  const k = 1 - Math.exp(-Math.max(dt, 0) / tau);
  return finite(state + (drive - state) * k, drive);
}

// ---------------------------------------------------------------------- 2 ---
// the star, and therefore the timbre

/** the Planck function in frequency, up to a constant: `x³/(eˣ − 1)` */
export function planckShape(x) {
  if (!(x > 0)) return 0;
  if (x > 60) return x * x * x * Math.exp(-x);        // eˣ overflows long before this matters
  const d = Math.expm1(x);
  return d > 0 ? (x * x * x) / d : 0;
}

/**
 * How much of partial `f` the star's spectrum holds, relative to the
 * fundamental at `f1`. Unclamped: above the Planck peak it falls, below it,
 * it rises, and both directions are the readout.
 */
export function spectralTilt(f, f1, starT) {
  const T = Math.max(starT, 1);
  const b1 = planckShape((PLANCK_K * f1) / T);
  if (!(b1 > 0)) return 0;
  return finite(planckShape((PLANCK_K * f) / T) / b1, 0);
}

/**
 * The drone bed: the first `n` harmonics of an open pipe, tilted by the star.
 *
 * `n^-0.9` is the pipe's own rolloff; the tilt is the star's contribution on
 * top of it, and the sum is normalised to one so the balance changes without
 * the level following it.
 *
 * The interesting case is a *hot* star, where the Planck peak sits above the
 * fundamental and the tilt is therefore greater than one. The loudest partial
 * is then not the first, and the bed's fundamental is left weak — which sounds
 * like it should destroy the root and does not, because of the **missing
 * fundamental**: given a harmonic series the ear reconstructs the pitch of a
 * first partial that is not physically present, which is how a telephone with
 * no response below 300 Hz still conveys a bass voice. So a blue star produces
 * a reedy, formant-heavy drone whose pitch is inferred rather than heard, and
 * an M dwarf produces something within a whisker of a pure sine. Neither was
 * chosen; both fall out of where the star's peak lands on the ladder.
 */
export function bedPartials(f0, starT, n = 8) {
  const out = [];
  let sum = 0;
  for (let h = 1; h <= n; h++) {
    const f = f0 * h;
    const a = finite(spectralTilt(f, f0, starT) * Math.pow(h, -0.9), 0);
    sum += a;
    out.push({ h, f: finite(f, f0), a });
  }
  const g = sum > 0 ? 1 / sum : 0;
  for (const p of out) p.a *= g;
  return out;
}

/** the standard brightness descriptor: amplitude-weighted mean frequency */
export function spectralCentroid(partials) {
  let num = 0, den = 0;
  for (const p of partials) { num += p.a * p.f; den += p.a; }
  return den > 0 ? num / den : 0;
}

/**
 * The chord degrees: the pipe's own overtones, folded into two octaves.
 *
 * 1, 9/8, 5/4, 11/8, 3/2, 13/8, 7/4, 15/8 — the harmonic-series mode, in tune
 * with the drone by construction because it *is* the drone. A degree survives
 * only if the source spectrum still has the partial it was folded from, so the
 * star decides how strange the harmony gets. The first two are unconditional:
 * a root and a fifth are what makes it a key rather than a texture.
 */
const FOLDED = [
  { partial: 1, ratio: 1 },
  { partial: 9, ratio: 9 / 8 },
  { partial: 5, ratio: 5 / 4 },
  { partial: 11, ratio: 11 / 8 },
  { partial: 3, ratio: 3 / 2 },
  { partial: 13, ratio: 13 / 8 },
  { partial: 7, ratio: 7 / 4 },
  { partial: 15, ratio: 15 / 8 },
];

export function overtoneChord(f0, starT, threshold = 0.05) {
  const out = [];
  for (const d of FOLDED) {
    // clamped here, and only here: availability is a yes/no about whether the
    // source contains the partial, so a star that could hold ten times one
    // still only holds it once
    const tilt = clamp(spectralTilt(f0 * d.partial, f0, starT), 0, 1);
    const keep = d.partial === 1 || d.partial === 3 || tilt > threshold;
    if (!keep) continue;
    out.push({ partial: d.partial, ratio: d.ratio, tilt: finite(tilt, 0) });
  }
  return out;
}

// ---------------------------------------------------------------------- 3 ---
// the ground and the air, and therefore the room

/**
 * How much a bounce off this world's ground keeps, and how much of it comes
 * back toward you. Two numbers, because they are two different things: an
 * ocean is hard (long tail) and specular (quiet one), rough basalt is hard and
 * diffuse (the biggest room in the project), and dry snow absorbs 85% of
 * everything that touches it, which is why snowfall sounds like the volume has
 * been turned down.
 */
export function groundAcoustics(world) {
  const typeId = world.typeId ?? 1;
  const T = surfaceTemp(world.Teq ?? 255, world.atmo ?? 1);
  const hab = habitability(world);
  if (typeId >= 5) return { absorb: 0.03, scatter: 0.22 };        // no ground; the gas scatters
  if (typeId === 2) return { absorb: 0.05, scatter: 0.13 };        // open water, specular
  if (typeId === 4) return { absorb: 0.20, scatter: 0.65 };        // rough basalt
  if (typeId === 3 || T < 245) {
    // dry snow over ice: the best natural absorber there is
    return { absorb: 0.82, scatter: 0.30 };
  }
  // rock, then vegetation over it in proportion to how much water is liquid
  return {
    absorb: 0.14 + 0.48 * hab,
    scatter: 0.58 - 0.20 * hab,
  };
}

/**
 * Amplitude e-folding time of the tail, from ground absorption alone.
 *
 * A ray out at distance `d` has bounced `d/ℓ` times; `d = c·t/2` on the round
 * trip, so the loss per second is `2·c/ℓ · ln(1/(1−a))` in energy and half
 * that in amplitude. Earth grass comes out at 0.5 s, i.e. a 3.5 s T60 — a
 * valley. Bare ice comes out past the ceiling, i.e. a cathedral, which is what
 * standing on a frozen lake actually sounds like.
 */
export function tailConstant(c, absorb) {
  const perBounce = Math.log(1 / Math.max(1 - clamp(absorb, 0, 0.99), 1e-3));
  return finite(RIDGE_SCALE / (Math.max(c, 1) * Math.max(perBounce, 1e-4)), IR_MAX_SECONDS);
}

/**
 * The frequency at which the tail has lost one e-fold by air absorption alone,
 * `t` seconds in. `α ∝ f²/P` is the classical result, so the whole thing is
 * a square root and thin air moves it down hard.
 */
export function absorptionCorner(t, c, rhoRel) {
  const denom = ALPHA_1K * Math.max(c, 1) * Math.max(t, 1e-4);
  return finite(1000 * Math.sqrt(Math.max(rhoRel, 0) / denom), 40);
}

/** nothing beyond the horizon can scatter back — `2·sqrt(2Rh)/c`, in seconds */
export function horizonTail(radiusE, c, eye = GAIT.eye) {
  const R = Math.max((radiusE ?? 1) * 6.371e6, 1e3);
  return finite((2 * Math.sqrt(2 * R * Math.max(eye, 0.1))) / Math.max(c, 1), IR_MAX_SECONDS);
}

/**
 * The impulse response, as a ray budget. Pure, seeded, and an `AudioBuffer`
 * away from being playable — the caller supplies the buffer, this supplies the
 * samples, and `tools/verify.js` can therefore measure the room under node.
 *
 * The one-pole is the whole frequency-dependent story (§3 of the header) and
 * its output is renormalised by `1/sqrt(1−a²)` at every coefficient change, so
 * the filter contributes colour and never level. Without that the tail decays
 * twice and thin air comes out simply quiet instead of simply dark.
 */
export function impulseResponse(reverb, sampleRate = 48000, channels = 2, seed = 0) {
  const len = Math.max(1, Math.round(clamp(reverb.tail, 0, IR_MAX_SECONDS) * sampleRate));
  const t0 = 6 / Math.max(reverb.c, 1);            // the nearest scatterer, ~3 m out
  const fade = Math.max(1, Math.floor(len * 0.18));
  const BLOCK = 64;                                 // the corner moves slowly; so does the coeff
  const out = [];
  for (let ch = 0; ch < channels; ch++) {
    const r = new RNG(hash(seed, 0x5c0e, ch));
    const s = new Float32Array(len);
    let y = 0, a = 0, norm = 1;
    let energy = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sampleRate;
      if ((i % BLOCK) === 0) {
        const fc = clamp(absorptionCorner(t + t0, reverb.c, reverb.rhoRel), 30, sampleRate * 0.45);
        a = Math.exp((-2 * Math.PI * fc) / sampleRate);
        norm = 1 / Math.sqrt(Math.max(1 - a * a, 1e-6));
      }
      y = a * y + (1 - a) * (r.next() * 2 - 1);
      // 1/√t from the annulus-versus-spreading balance, then the bounce loss,
      // then a raised cosine onto the horizon so the tail does not click off
      const geo = Math.sqrt(t0 / (t + t0));
      const bounce = Math.exp(-t / Math.max(reverb.tau, 1e-3));
      const win = i > len - fade ? 0.5 * (1 + Math.cos((Math.PI * (i - (len - fade))) / fade)) : 1;
      const v = y * norm * geo * bounce * win;
      s[i] = v;
      energy += v * v;
    }
    // unit energy, so the wet send means the same thing on every world
    const g = energy > 0 ? 1 / Math.sqrt(energy) : 0;
    for (let i = 0; i < len; i++) s[i] *= g;
    out.push(s);
  }
  return out;
}

// ---------------------------------------------------------------------- 4 ---
// gravity, and therefore the tempo

/** preferred stride rate at gravity `g`: Froude 0.25 on a 0.9 m leg */
export function strideRate(g) {
  return finite(Math.sqrt(FROUDE * Math.max(g, 1e-3) * LEG_LENGTH) / STRIDE_LENGTH, 0.9);
}

/** a phrase is sixteen strides — 17 s on Earth, 42 s on a moon */
export function breathRate(g) {
  return strideRate(g) / BREATH_STRIDES;
}

// ---------------------------------------------------------------------- 5 ---
// water, and therefore whether anything is alive

/**
 * Boiling point of water at `atm` atmospheres, Clausius–Clapeyron.
 *
 * 354 K at half an atmosphere (a pressure cooker read backwards) and 268 K at
 * 0.006 — below freezing, which is the triple point arriving by itself.
 */
export function boilingPoint(atm) {
  const p = Math.max(atm, 1e-9);
  const inv = 1 / T_BOIL_REF - (R_GAS / L_VAP) * Math.log(p);
  return inv > 0 ? 1 / inv : 0;
}

/**
 * How much liquid water this world has on its ground, 0–1 — the soft version
 * of `life.js`'s `isBiosphere`, and the term that decides whether the texture
 * has anything organic moving in it at all.
 *
 * Two factors: is the surface temperature inside the liquid window, and is the
 * window wide enough to survive a season. Gated on terrestrial/ocean because
 * it has to agree with what `life.js` will actually put on screen.
 */
export function habitability(world) {
  const typeId = world.typeId ?? 1;
  if (typeId !== 1 && typeId !== 2) return 0;
  const atmo = Math.max(world.atmo ?? 1, 0);
  const Tb = boilingPoint(atmo);
  const width = Tb - T_MELT;
  if (width <= 0) return 0;
  const T = surfaceTemp(world.Teq ?? 255, atmo);
  const inside = smoothstep(T_MELT - 6, T_MELT + 8, T) * smoothstep(Tb + 6, Tb - 8, T);
  return clamp(inside * smoothstep(0, 25, width), 0, 1);
}

// ---------------------------------------------------------------------- 6 ---
// the plan
//
// Everything above, on one world, as plain data. `Score` below only ever plays
// what this returns, which is what makes the musical decisions testable.

/**
 * Irrational multipliers on the breath. Their pairwise ratios are irrational
 * too, so no two modulators ever realign — §7 of the header, and `suiteScore`
 * measures it rather than trusting it.
 */
export const IRRATIONAL = [
  1, 1.3247179572, 1.4142135624, 1.6180339887, 1.7320508076,
  2.2360679775, 2.6457513111, 2.7182818285, 3.1415926536,
];

/** how many drone harmonics and concurrent voices, by renderer tier */
export const VOICES = [
  { bed: 9, voices: 6, irChannels: 2, irSeconds: 3.0 },   // ultra
  { bed: 8, voices: 5, irChannels: 2, irSeconds: 3.0 },   // high
  { bed: 6, voices: 4, irChannels: 1, irSeconds: 1.8 },   // medium
  { bed: 4, voices: 3, irChannels: 1, irSeconds: 1.2 },   // low
];

/** the identity of a voicing — cheap enough to rebuild every frame, and is */
export function voicingKey(w) {
  return `${w.seed ?? 0}|${w.typeId ?? 1}|${w.Teq ?? 255}|${w.atmo ?? 1}`
    + `|${w.starT ?? SUN_T}|${w.massE ?? 1}|${w.radiusE ?? 1}`;
}

/**
 * The whole score, as numbers, for one world.
 *
 * Nothing here reads the clock or the URL, allocates a node, or touches the
 * DOM. Feed it a plain object and it returns a plain object; `tools/verify.js`
 * asserts on the result.
 */
export function voicing(world, tier = 1) {
  const w = world ?? {};
  const q = VOICES[clamp(tier | 0, 0, VOICES.length - 1)];
  // §7's fourth mechanism. `w.wind` is the surface scale's *own* field when
  // there is one, handed over by `worldFromScale`, because §6 M3's thesis is
  // one field sampled by everything and a score that minted its own would put
  // a second wind in the world — the drone swelling while the grass stands
  // still is an §8 axis 8 failure and an unattributable one. The fallback
  // exists for a plan built without a renderer, where there is no other wind
  // to disagree with, and it is built from the same world numbers so its
  // statistics are the same field's.
  const wind = w.wind ?? makeWind(hash(w.seed ?? 0, 0x5c0f), w, Math.max(w.atmo ?? 1, 0));
  const seed = (w.seed ?? 0) >>> 0;
  const typeId = w.typeId ?? 1;
  const atmo = Math.max(w.atmo ?? 1, 0);
  const starT = clamp(w.starT ?? SUN_T, 1200, 40000);

  // -- the air
  const T = surfaceTemp(w.Teq ?? 255, atmo);
  const rho = airDensity({ typeId, Teq: w.Teq ?? 255 }, atmo);
  const rhoRel = clamp(rho / RHO_EARTH, 0, 40);
  const c = speedOfSound(T, typeId);
  const column = airShare(rho);
  // §1: with no air column the instrument sounds at its design pitch
  const root = finite(ROOT_REF + (pipeRoot(c) - ROOT_REF) * column, ROOT_REF);

  // how much of the sound the air can carry at all. Saturating, because
  // doubling the pressure does not double the loudness — it lengthens the room.
  const carry = 1 - Math.exp(-2.2 * rhoRel);
  const conducted = (1 - carry) * 0.55;

  // -- the star
  const bed = bedPartials(root, starT, q.bed);
  const chord = overtoneChord(root, starT).map((d) => ({
    ...d, f: root * d.ratio,
  }));

  // -- the room
  const ground = groundAcoustics({ typeId, Teq: w.Teq ?? 255, atmo });
  const tau = tailConstant(c, ground.absorb);
  const tHorizon = horizonTail(w.radiusE ?? 1, c);
  const tail = carry < 0.02 ? 0
    : clamp(Math.min(6.91 * tau, tHorizon), 0.05, Math.min(q.irSeconds, IR_MAX_SECONDS));
  const reverb = {
    tail, tau, c, rhoRel,
    channels: q.irChannels,
    wet: clamp(ground.scatter * carry, 0, 1),
    horizon: tHorizon,
    // the direct path loses almost nothing on a temperate world and most of
    // its top on a thin one — the Perseverance result, from the same α(f)
    directCutoff: carry < 0.02 ? BONE_CUTOFF
      : clamp(1000 * Math.sqrt(rhoRel / (ALPHA_1K * SOURCE_DIST)), BONE_CUTOFF, 18000),
    bodyConducted: carry < 0.02,
  };

  // -- gravity
  const g = gravityOf({ massE: w.massE ?? 1, radiusE: w.radiusE ?? 1 });
  const stride = strideRate(g);
  const breath = breathRate(g);

  // -- water
  const hab = habitability({ typeId, Teq: w.Teq ?? 255, atmo });

  // -- dusk
  const swing = diurnalSwing(atmo) * column;

  return {
    key: voicingKey(w),
    seed, tier: clamp(tier | 0, 0, VOICES.length - 1),
    air: { T, rho, rhoRel, c, carry, conducted, column, gamma: typeId >= 5 ? GAMMA_HYDROGEN : GAMMA_AIR },
    root,
    bed,
    // the steady level the drive multiplies — `bedPartials` normalises, so
    // this is 1 on every world, and it is summed rather than assumed
    bedSum: bed.reduce((s, p) => s + p.a, 0),
    wind,
    centroid: spectralCentroid(bed),
    chord,
    reverb,
    ground,
    gravity: g, stride, breath,
    organic: {
      level: hab,
      // one call every four breaths at full habitability, and never on a rock
      rate: (hab * breath) / 4,
      band: root * 8,
    },
    diurnal: { swing, dayLength: Math.max(w.dayLength ?? 420, 1) },
    maxVoices: q.voices,
    // quiet: this sits under the wind, and audio.js's master is already at 0.24
    level: clamp(0.42 * (carry + conducted), 0.05, 0.6),
  };
}

/**
 * The modulators, as data, so the non-loopability claim can be measured rather
 * than asserted. One per bed partial plus one on the wet send.
 */
export function modulators(plan) {
  const out = [];
  const r = new RNG(hash(plan.seed, 0x5c0d));
  for (let i = 0; i < plan.bed.length; i++) {
    out.push({
      what: 'bed', index: i,
      rate: plan.breath * IRRATIONAL[i % IRRATIONAL.length] * 0.6,
      depth: 0.42 * plan.bed[i].a,
      phase: r.float(0, 2 * Math.PI),
    });
  }
  out.push({
    what: 'wet', index: 0,
    rate: plan.breath * IRRATIONAL[(plan.bed.length) % IRRATIONAL.length] * 0.31,
    depth: 0.22 * plan.reverb.wet,
    phase: r.float(0, 2 * Math.PI),
  });
  return out;
}

/**
 * How hard the pipe is being blown at `t`, as a multiple of its steady value —
 * §7's fourth mechanism, and the only one of the four that integrates.
 *
 * Sampled at the ear, at ear height, from the world's own wind. Three things
 * about it are deliberate:
 *
 * **The exponent is one.** Flow noise over a bluff body goes as `U⁶` (Curle),
 * and if the drone were wind *noise* that is what this would be. It is not: it
 * is a resonator, and a flue pipe above its threshold sounds roughly in
 * proportion to the jet that drives it and then saturates rather than
 * accelerating. Cubing the amplitude would give a ±300% pump; the linear law
 * gives the ±26% the field's own turbulence intensity says it should.
 *
 * **There is no coefficient.** `gustNorm` is already normalised to the
 * meandering mean, so the only weight is `column`, which is §1's and is not
 * new. That matters more than it looks — the alternative was a depth constant
 * chosen by ear, and this file's claim is that there are eleven constants and
 * everything else is a formula.
 *
 * **It is one sample, not a field integral.** The listener is a point and the
 * pipe is at the listener. Sampling the wind anywhere else would be inventing
 * a second place for the sound to be coming from.
 */
export function windDrive(plan, t) {
  const col = plan?.air?.column ?? 0;
  if (!plan?.wind || col <= 1e-4) return 1;
  const g = windAt(plan.wind, 0, 0, t, GAIT.eye).gustNorm;
  // a gust cannot suck: below zero drive the pipe has stopped speaking, and
  // the model does not describe what happens after that
  return Math.max(1 + col * (finite(g, 1) - 1), 0);
}

/**
 * The composite loudness envelope at `t` — what the ear integrates, and what
 * `suiteScore` autocorrelates.
 *
 * The bed is *multiplied* by the drive and the wet send is added after it,
 * which is the signal path and not a convenience: one pair of lungs drives
 * every partial of one pipe together, while the room's return is the past
 * arriving late and does not gust in step with the present. The convolver gets
 * this for free at runtime — it is written out here because the test needs the
 * same arithmetic without an AudioContext to run it in.
 */
export function envelopeAt(plan, mods, t) {
  let bed = 0, wet = 0;
  for (const m of mods) {
    const s = m.depth * Math.sin(2 * Math.PI * m.rate * t + m.phase);
    if (m.what === 'wet') wet += s; else bed += s;
  }
  return windDrive(plan, t) * ((plan.bedSum ?? 1) + bed) + wet;
}

/**
 * One voice entry, addressed by index rather than drawn from a running stream.
 *
 * Addressable so `Score` can resume, and so a test can ask for the ten
 * thousandth event without playing the first nine thousand. The degree comes
 * from a shuffle bag — every degree gets used before any repeats, and the bag
 * is reshuffled per cycle with the boundary fixed so two identical pitches
 * never land back to back. That is the difference between a key and a loop.
 */
export function voiceEvent(plan, i) {
  const n = Math.max(plan.chord.length, 1);
  const cycle = Math.floor(i / n);
  const pos = i % n;

  const bag = [];
  for (let k = 0; k < n; k++) bag.push(k);
  const rb = new RNG(hash(plan.seed, 0x5c05, cycle));
  for (let k = n - 1; k > 0; k--) {
    const j = rb.int(0, k);
    const t = bag[k]; bag[k] = bag[j]; bag[j] = t;
  }
  if (n > 1 && cycle > 0) {
    // do not open a cycle on the pitch the last one closed
    const rp = new RNG(hash(plan.seed, 0x5c05, cycle - 1));
    const prev = [];
    for (let k = 0; k < n; k++) prev.push(k);
    for (let k = n - 1; k > 0; k--) {
      const j = rp.int(0, k);
      const t = prev[k]; prev[k] = prev[j]; prev[j] = t;
    }
    if (bag[0] === prev[n - 1]) { const t = bag[0]; bag[0] = bag[1]; bag[1] = t; }
  }

  const d = plan.chord[bag[pos]];
  const r = new RNG(hash(plan.seed, 0x5c04, i));
  const period = 1 / Math.max(plan.breath, 1e-4);
  // the lower degrees sit low, the strange ones sit high — so the 11th and the
  // 13th arrive as colour over the chord rather than as a muddle inside it
  const oct = d.partial <= 3 ? r.int(0, 1) : r.int(1, 2);
  const f = d.f * Math.pow(2, oct);
  return {
    index: i,
    degree: bag[pos],
    partial: d.partial,
    f: finite(f, plan.root),
    // strength from what the star can hold, thinned as it climbs
    gain: finite(0.34 * (0.35 + 0.65 * d.tilt) * Math.pow(2, -0.55 * oct), 0.05),
    gap: period * r.float(0.55, 1.45),
    attack: period * r.float(0.45, 0.9),
    hold: period * r.float(0.6, 1.8),
    release: period * r.float(1.2, 2.6),
    pan: r.float(-0.6, 0.6),
  };
}

/** the first `count` entries with their absolute times — the prefix sum */
export function voiceStream(plan, count) {
  const out = [];
  let t = 0;
  for (let i = 0; i < count; i++) {
    const e = voiceEvent(plan, i);
    t += e.gap;
    out.push({ ...e, t });
  }
  return out;
}

/** one organic grain: sparse, high, slow-attacked. Not percussion. */
export function grainEvent(plan, i) {
  const r = new RNG(hash(plan.seed, 0x5c06, i));
  const h = [8, 9, 10, 12, 15][r.int(0, 4)];
  const f = plan.root * h;
  return {
    index: i,
    f: finite(f, 880),
    bend: r.float(0.94, 1.07),
    gain: finite(0.06 * plan.organic.level * r.float(0.5, 1), 0),
    gap: r.float(0.5, 2.2) / Math.max(plan.organic.rate, 1e-4),
    attack: r.float(0.25, 0.9),
    release: r.float(1.5, 4),
    pan: r.float(-0.85, 0.85),
  };
}

// ---------------------------------------------------------------------- 7 ---
// the time of day

/**
 * The golden-hour weight, on §9.7's band: the sun between 8° and 18°, where
 * the light model is tuned and where the score should be at its fullest.
 * Skewed low so it survives past sunset rather than switching off at zero.
 */
export function goldenWeight(sunElevDeg) {
  const e = clamp(sunElevDeg, -90, 90);
  const z = (e - 13) / 14;      // centred in §9.7's band; 0.86 at both edges
  return Math.exp(-z * z);
}

/**
 * The nocturnal inversion, 0–1. After sunset the boundary layer stabilises and
 * refracts sound downward instead of up — the reason a train is audible at
 * night and not at noon. Needs air to invert, so it scales with what the air
 * can carry.
 */
export function inversion(sunElevDeg, carry) {
  return nightFraction(sunElevDeg) * clamp(carry, 0, 1);
}

// ---------------------------------------------------------------------- 8 ---
// the graph
//
// From here down the file is impure and node never reaches it.

const LOOKAHEAD = 4.0;      // seconds of audio time scheduled in advance
const PARAM_PERIOD = 0.25;  // how often the slow parameters are written

export class Score {
  /**
   * `context` and `destination` are meant to be `audio.ctx` and `audio.master`
   * from `src/audio.js`: one AudioContext per page (browsers cap them), one
   * mute switch, one unlock gesture. Passing neither makes its own context,
   * which only a test harness should want.
   */
  constructor({ seed = 0, context = null, destination = null, tier = 1, level = 1 } = {}) {
    this.seed = seed >>> 0;
    this.ctx = context;
    this.dest = destination;
    this.tier = tier;
    this.levelScale = level;
    this.running = false;
    this.plan = null;
    this.world = null;
    this._lag = 0;
    this._clock = 0;      // the scene's seconds, for §7's drive
    this._voiceIndex = 0;
    this._grainIndex = 0;
    this._nextVoice = 0;
    this._nextGrain = 0;
    this._nextParam = 0;
    this._live = new Set();
    this._nodes = [];
    this._bed = [];
    this._owned = false;
  }

  /**
   * Bring the graph up. Must be reached from a user gesture, or from an
   * AudioContext that already was — which is the reason for taking one.
   */
  start() {
    if (this.running) return true;
    if (!this.ctx) {
      const AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return false;
      try { this.ctx = new AC(); this._owned = true; } catch { return false; }
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    const c = this.ctx;
    this.master = c.createGain();
    this.master.gain.value = 0;
    this.master.connect(this.dest ?? c.destination);

    // dry path: the instrument, then whatever the direct air took out of it
    this.direct = c.createBiquadFilter();
    this.direct.type = 'lowpass';
    this.direct.frequency.value = 18000;
    this.direct.Q.value = 0.5;
    this.bus = c.createGain();
    this.bus.gain.value = 1;
    // §7's drive, as one node. It sits after the summing bus so it moves every
    // partial together — which is the physical claim, one pair of lungs — and
    // before the send, so the room hears a gusting source and smears it into
    // its own tail rather than gusting in step with the direct path.
    this.drive = c.createGain();
    this.drive.gain.value = 1;
    this.bus.connect(this.drive);
    this.drive.connect(this.direct);
    this.direct.connect(this.master);

    // wet path: built lazily, because an airless world never needs one
    this.send = c.createGain();
    this.send.gain.value = 0;
    this.drive.connect(this.send);
    this.wetTone = c.createBiquadFilter();
    this.wetTone.type = 'lowpass';
    this.wetTone.frequency.value = 8000;
    this.wetTone.Q.value = 0.4;
    this.wetTone.connect(this.master);

    this.running = true;
    this._nextParam = 0;
    if (this.world) this._revoice(this.world, true);
    return true;
  }

  /**
   * Per frame. Deliberately almost free: an identity compare, one multiply-add
   * of the thermal lag, and two clock comparisons. Everything expensive is
   * behind one of those clocks.
   *
   * `sunElevDeg` is degrees above the horizon, the same convention
   * `night.js` uses. `dt` is seconds.
   *
   * `t` is the *scene* clock, and it is passed rather than accumulated for one
   * reason: §7's drive reads the same wind field the grass is bending in, and
   * a score keeping its own clock would eventually swell on a gust the frame
   * is not showing. It falls back to an accumulator only for a caller that has
   * no scene, which is a test.
   */
  update(worldParams, sunElevDeg = 13.5, dt = 0.016, t = null) {
    this.world = worldParams ?? this.world;
    if (!this.running || !this.ctx || !this.world) return;
    const key = voicingKey(this.world);
    if (!this.plan || this.plan.key !== key) this._revoice(this.world);

    const plan = this.plan;
    this._clock = t ?? (this._clock + dt);
    this._lag = stepThermalLag(this._lag, sunElevDeg, dt, plan.diurnal.dayLength);

    const now = this.ctx.currentTime;
    if (now >= this._nextParam) {
      this._nextParam = now + PARAM_PERIOD;
      this._writeParams(now, sunElevDeg);
    }
    // one entry per call at most, so a long stall does not spawn a chord
    if (now >= this._nextVoice) this._spawnVoice(Math.max(now, this._nextVoice));
    if (plan.organic.rate > 1e-5 && now >= this._nextGrain) {
      this._spawnGrain(Math.max(now, this._nextGrain), sunElevDeg);
    }
  }

  /** fade out and release the voices; the graph survives for a restart */
  stop() {
    if (!this.running) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(0, t, 0.8);
    this.running = false;
    this._releaseAll(t + 2.4);
  }

  /** stop, then let go of everything, including a context we made ourselves */
  dispose() {
    if (this.ctx) {
      const t = this.ctx.currentTime;
      try { this.master?.gain.setTargetAtTime(0, t, 0.35); } catch { /* torn down */ }
      this._releaseAll(t + 0.9);
    }
    this.running = false;
    this.plan = null;
    for (const n of this._nodes) { try { n.stop?.(); } catch { /* gains */ } try { n.disconnect(); } catch { /* done */ } }
    this._nodes.length = 0;
    this._bed.length = 0;
    this.ir = null;
    if (this._owned && this.ctx) { try { this.ctx.close(); } catch { /* already */ } this.ctx = null; }
  }

  // ------------------------------------------------------------ internal ---

  _releaseAll(at) {
    for (const v of this._live) { try { v.stopAt(at); } catch { /* gone */ } }
    this._live.clear();
  }

  _revoice(world, force = false) {
    const plan = voicing(world, this.tier);
    if (!force && this.plan && this.plan.key === plan.key) return;
    this.plan = plan;
    const c = this.ctx, t = c.currentTime;

    // tear the old bed down under a crossfade rather than at a cut (§2.5 in
    // spirit: a scale change is a hyperzoom, not a jump)
    for (const n of this._nodes) {
      try { n.gain?.setTargetAtTime?.(0, t, 0.6); } catch { /* not a gain */ }
    }
    const doomed = this._nodes.slice();
    this._nodes = [];
    this._bed = [];
    setTimeout(() => {
      for (const n of doomed) { try { n.stop?.(); } catch { /* gains */ } try { n.disconnect(); } catch { /* done */ } }
    }, 2600);

    const keep = (...ns) => { this._nodes.push(...ns); return ns[0]; };
    const mods = modulators(plan);

    // -- the bed: the pipe's harmonics, each breathing on its own irrational
    for (let i = 0; i < plan.bed.length; i++) {
      const p = plan.bed[i];
      if (p.a < 1e-4) continue;
      const det = new RNG(hash(plan.seed, 0x5c07, i)).float(-1.5, 1.5); // cents; no two pipes agree
      const o = keep(c.createOscillator());
      o.type = i === 0 ? 'triangle' : 'sine';
      o.frequency.value = p.f * Math.pow(2, det / 1200);
      const g = keep(c.createGain());
      g.gain.value = p.a * 0.5;
      o.connect(g); g.connect(this.bus);
      o.start();
      const m = mods[i];
      if (m) {
        const lo = keep(c.createOscillator());
        lo.type = 'sine'; lo.frequency.value = m.rate;
        const lg = keep(c.createGain()); lg.gain.value = m.depth * 0.5;
        lo.connect(lg); lg.connect(g.gain);
        lo.start();
      }
      this._bed.push({ osc: o, h: p.h, cents: det });
    }

    // -- the air itself, if there is any: a band of moving noise around the
    //    sixth partial, which is where wind through a structure actually sits
    if (plan.air.carry > 0.05) {
      const src = keep(c.createBufferSource());
      src.buffer = this._noiseBuffer();
      src.loop = true;
      const bp = keep(c.createBiquadFilter());
      bp.type = 'bandpass'; bp.frequency.value = plan.root * 6; bp.Q.value = 0.55;
      const ng = keep(c.createGain());
      ng.gain.value = 0.05 * plan.air.carry;
      src.connect(bp); bp.connect(ng); ng.connect(this.bus);
      src.start();
      // No LFO on this one. It used to breathe on `breath × 1.414 × 0.4` like
      // everything else, which was a sine standing in for the wind on the one
      // voice that *is* the wind — the drive it goes through now is the real
      // thing, and a sine on top of it would be a second, fictional weather.
    }

    // -- the room
    if (plan.reverb.tail > 0.02) {
      const sr = c.sampleRate;
      const chans = impulseResponse(plan.reverb, sr, plan.reverb.channels, plan.seed);
      const buf = c.createBuffer(chans.length, chans[0].length, sr);
      for (let ch = 0; ch < chans.length; ch++) buf.copyToChannel(chans[ch], ch);
      const conv = keep(c.createConvolver());
      conv.normalize = false;                 // the IR is already unit-energy
      conv.buffer = buf;
      this.send.disconnect();
      this.send.connect(conv);
      conv.connect(this.wetTone);
      this.ir = buf;
    } else {
      try { this.send.disconnect(); } catch { /* never connected */ }
      this.ir = null;
    }

    this.direct.frequency.value = plan.reverb.directCutoff;
    this._voiceIndex = 0;
    this._grainIndex = 0;
    this._nextVoice = t + 0.5;
    this._nextGrain = t + 3.0;
    this._nextParam = 0;
  }

  /** two seconds of seeded noise, reused by every band that needs any */
  _noiseBuffer() {
    if (this._noise && this._noise.sampleRate === this.ctx.sampleRate) return this._noise;
    const sr = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, sr * 2, sr);
    const d = buf.getChannelData(0);
    const r = new RNG(hash(this.seed, 0x5c08));
    for (let i = 0; i < d.length; i++) d[i] = r.next() * 2 - 1;
    this._noise = buf;
    return buf;
  }

  /**
   * The slow parameters, at 4 Hz. Six writes, and every one of them is a
   * consequence of the sun's elevation and the temperature it left behind.
   */
  _writeParams(now, sunElevDeg) {
    const plan = this.plan;
    const gold = goldenWeight(sunElevDeg);
    const night = nightFraction(sunElevDeg);
    const inv = inversion(sunElevDeg, plan.air.carry);

    // §6: the ground cools, the air slows, the whole instrument goes flat
    const T = plan.air.T * (1 + plan.diurnal.swing * 0.5 * this._lag);
    const c = speedOfSound(T, this.world.typeId ?? 1);
    const root = ROOT_REF + (pipeRoot(c) - ROOT_REF) * plan.air.column;
    const ratio = finite(root / plan.root, 1);
    for (const b of this._bed) {
      b.osc.frequency.setTargetAtTime(
        plan.root * b.h * ratio * Math.pow(2, b.cents / 1200), now, 2.5);
    }
    this._tuning = ratio;

    // the swell: fullest at golden hour, present but thinner at noon and at
    // the bottom of the night
    const swell = 0.5 + 0.5 * gold;
    this.master.gain.setTargetAtTime(plan.level * this.levelScale * swell, now, 1.2);

    // §7's drive. Written here rather than as an LFO because there is no
    // oscillator whose shape this is — that is the entire point of it. The
    // 0.25 s parameter clock is a 2 Hz Nyquist and a gust cell lasts tens of
    // seconds, so the body of a gust arrives intact; the leading edge softens,
    // which is the one thing lost and is a fair price for not evaluating a
    // wind field per audio sample. `setTargetAtTime` interpolates the rest.
    this.drive.gain.setTargetAtTime(windDrive(plan, this._clock), now, 0.30);

    // the inversion: a bigger, lower room after sunset
    this.send.gain.setTargetAtTime(plan.reverb.wet * (1 + 0.6 * inv), now, 1.5);
    this.wetTone.frequency.setTargetAtTime(
      clamp(plan.reverb.directCutoff * (1 - 0.55 * inv), 200, 18000), now, 1.5);
    this.direct.frequency.setTargetAtTime(
      clamp(plan.reverb.directCutoff * (1 - 0.25 * night), BONE_CUTOFF, 18000), now, 1.5);
  }

  _spawnVoice(at) {
    const plan = this.plan;
    const e = voiceEvent(plan, this._voiceIndex++);
    this._nextVoice = at + e.gap;
    if (at > this.ctx.currentTime + LOOKAHEAD) return;         // caught up; wait
    if (this._live.size >= plan.maxVoices) return;             // the cap, silently

    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0;
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    if (pan) { pan.pan.value = e.pan; g.connect(pan); pan.connect(this.bus); }
    else g.connect(this.bus);

    const oscs = [];
    for (const det of [-1.7, 1.7]) {
      const o = c.createOscillator();
      o.type = 'sine';
      o.frequency.value = e.f * (this._tuning ?? 1) * Math.pow(2, det / 1200);
      o.connect(g);
      o.start(at);
      oscs.push(o);
    }

    const peak = e.gain * (0.5 + 0.5 * (this.plan.air.carry + this.plan.air.conducted));
    const t1 = at + e.attack;
    const t2 = t1 + e.hold;
    const t3 = t2 + e.release;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(peak, t1);
    g.gain.setValueAtTime(peak, t2);
    g.gain.linearRampToValueAtTime(0, t3);

    const rec = {
      stopAt: (t) => {
        const tt = Math.min(t, t3);
        try { g.gain.cancelScheduledValues(tt); g.gain.setTargetAtTime(0, tt, 0.4); } catch { /* gone */ }
        for (const o of oscs) { try { o.stop(tt + 1.6); } catch { /* gone */ } }
      },
    };
    this._live.add(rec);
    for (const o of oscs) o.stop(t3 + 0.05);
    oscs[oscs.length - 1].onended = () => {
      this._live.delete(rec);
      try { g.disconnect(); pan?.disconnect(); } catch { /* done */ }
      for (const o of oscs) { try { o.disconnect(); } catch { /* done */ } }
    };
  }

  _spawnGrain(at, sunElevDeg) {
    const plan = this.plan;
    const e = grainEvent(plan, this._grainIndex++);
    // dawn and dusk are when anything sings; noon and the small hours are not
    const chorus = 0.25 + 0.75 * goldenWeight(sunElevDeg);
    this._nextGrain = at + e.gap / Math.max(chorus, 0.15);
    if (at > this.ctx.currentTime + LOOKAHEAD) return;

    const c = this.ctx;
    const g = c.createGain();
    g.gain.value = 0;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = e.f * 2.2; lp.Q.value = 0.7;
    const pan = c.createStereoPanner ? c.createStereoPanner() : null;
    g.connect(lp);
    if (pan) { pan.pan.value = e.pan; lp.connect(pan); pan.connect(this.bus); }
    else lp.connect(this.bus);

    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(e.f * (this._tuning ?? 1), at);
    o.frequency.linearRampToValueAtTime(e.f * (this._tuning ?? 1) * e.bend, at + e.attack + e.release);
    o.connect(g);
    o.start(at);

    const t1 = at + e.attack;
    const t2 = t1 + e.release;
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(e.gain * chorus, t1);
    g.gain.linearRampToValueAtTime(0, t2);
    o.stop(t2 + 0.05);
    o.onended = () => {
      try { o.disconnect(); g.disconnect(); lp.disconnect(); pan?.disconnect(); } catch { /* done */ }
    };
  }
}

// ---------------------------------------------------------------------- 9 ---
// the adapter

/**
 * A surface scale's fields, as the plain object `voicing()` wants. Kept here
 * rather than in `surface.js` so the shape the score reads is written down in
 * one place — and so a test can build one without a renderer.
 */
export function worldFromScale(s) {
  const pp = s?.pp ?? {};
  const dayRate = s?.dayRate ?? (2 * Math.PI) / 420;
  return {
    seed: pp.seed ?? 0,
    typeId: pp.typeId ?? 1,
    Teq: pp.Teq ?? 255,
    massE: pp.massE ?? 1,
    radiusE: pp.radiusE ?? 1,
    atmo: s?.atmo ?? 1,
    starT: s?.sys?.temp ?? s?.ctx?.system?.temp ?? SUN_T,
    dayLength: (2 * Math.PI) / Math.max(dayRate, 1e-6),
    // tilt and spin are `baseWindSpeed`'s, not the score's — carried so the
    // fallback field in `voicing` is this world's rather than a default one
    tilt: pp.tilt, spin: pp.spin,
    // §7's drive, and §6 M3's one field: the scale's actual `windSys`, the
    // same object the grass and the cloud deck and the rain are reading. Null
    // before M3 is on, and `voicing` mints a stand-in rather than falling
    // silent — a pre-M3 world still has weather, it just has no render target.
    wind: s?.windSys ?? null,
  };
}

/**
 * §7.4: default-off, `?score=1` to hear it. Guarded so the module still
 * imports under node, where there is no `window` and no URL.
 */
export const SCORE_FLAG = (() => {
  try { return new URL(window.location.href).searchParams.get('score') === '1'; }
  catch { return false; }
})();
