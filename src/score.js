// The score — the musical decisions, and only those.
//
// ---------------------------------------------------------------------------
// STATUS: this is half of a feature, and the half that is missing is the half
// that makes a sound.
//
// `deriveScore()` and everything under it are complete and checked — the
// `score` suite in `tools/verify.js` asserts determinism, that ten worlds do
// not land on the same chord, that the mode ladder is monotone in the star's
// colour temperature, that a heavier world sits lower, that vacuum reverberates
// longer than air, and that no two LFO rates share a period. What does not
// exist yet is the WebAudio graph that plays any of it: **nothing in this file
// is currently imported by `audio.js`, and the game is silent of it.**
//
// It is landed rather than held back because the untestable half is the easy
// half — oscillators, a biquad, a generated impulse response — and the half
// that carries the actual claim ("the score is attuned to the world") is the
// one that had to be decidable without ears. That part is done and provable.
// Wiring it is a separate commit, and it is the next one.
//
// There is no WebAudio in this file and no THREE, which is the entire reason it
// exists apart from `audio.js`. §7.3 requires new maths to have a CPU reference
// and an offline check "before it enters the render loop", and a synthesiser is
// the worst case for that rule: it cannot be screenshotted, cannot be pixel
// diffed, and the agent writing it cannot hear it. The only way to know the
// mapping is right is to be able to *print* it. So everything below is a pure
// function of a plain world descriptor — `node` can ask what a world sounds
// like with no audio device attached, and the answer is the one the browser
// will play.
//
// ---------------------------------------------------------------------------
// What the music is allowed to be a function of
//
// §1's claim is that the universe is beautiful *because* it is computed. A
// soundtrack bolted on as decoration would contradict that in the one medium
// where nobody would check. So every musical dimension here is owned by exactly
// one physical quantity, and no quantity owns two:
//
//   star colour temperature  → mode          the light's spectrum, as tonality
//   surface gravity          → register      how heavy the world is to stand on
//   equilibrium temperature  → tempo         molecular motion, as pulse
//   palette hue              → colour tone + timbre
//   world type               → instrumentation
//   inhabited                → harmonic motion, and the arpeggio
//   scale (§6's six)         → voicing width, density, and space
//   resonance (resonance.js) → one step of bias on the mode: the art
//                              direction's vote, and only a vote
//
// A hot volcanic world and a cold ice world therefore differ on five of those
// eight axes at once, which is what the difference has to be to survive a
// listener who is not paying attention.
//
// ---------------------------------------------------------------------------
// The one thing physics does not choose
//
// Nothing about a star says "F♯". The key comes from the seed — and from the
// *star's* seed, not the planet's. Every world in a system is consequently in
// the same key as its star, so descending cosmic → galaxy → system → orbit →
// cloud deck → ground changes register, mode, density and instrumentation but
// never modulates under you. §2.5 forbids cuts. This is what §2.5 sounds like.
//
// ---------------------------------------------------------------------------
// Why none of it loops
//
// M1's gate language is "no perceptible loop", and that is the standard the
// score is held to as well. Nothing here is a repeating buffer; every sequence
// is a pure function of the event index `k`. Three different generators do it,
// because the three kinds of choice want three different statistics:
//
//   1 · **Which one** — which chord, which voicing, which note of the scale.
//       A van der Corput radical inverse in a small prime base. It is
//       low-discrepancy, so over any window every note gets used and none gets
//       hammered, which is what stops a drifting arpeggio sounding like a
//       broken record without needing a memory of what it just played.
//
//   2 · **Whether, and how hard** — rests, velocities, note spacing. A seeded
//       avalanche hash of `k`. These want to be irregular rather than evenly
//       covered: a rest pattern with low discrepancy is a rhythm, and a rhythm
//       is the one thing the brief rules out.
//
//   3 · **How long** — the harmonic rhythm. A sum of three sinusoids at
//       mutually irrational rates, so the chord lengths *breathe* between long
//       and short instead of jumping. Rates from distinct quadratic fields
//       (Q(√5), Q(√3), Q(√7)); since √p for distinct primes are linearly
//       independent over the rationals, the sum never returns to a previous
//       phase and the pattern of long and short chords has no period.
//
// One trap is recorded here because this file fell into it and the harness
// caught it. The obvious generator for choice 1 is the irrational rotation
// `frac(k·φ)`, φ being "the most irrational number". For a *five*-note scale it
// is the worst possible choice: the convergents of φ are the Fibonacci ratios,
// 3/5 among them, so `floor(frac(k·φ)·5)` repeats on a period of five for
// hundreds of terms before it drifts. The first draft shipped a five-bell
// ostinato. The same trap eats van der Corput when the alphabet size shares a
// factor with the base — base 2 against four chords is *exactly* periodic with
// period four. Hence the rule every call below obeys: **the base and the
// alphabet size must be coprime**, and `tools/` re-measures the period rather
// than trusting the argument.

const VDC_CHORD = 5;   // against progressions of length 2, 3 or 4
const VDC_INV = 2;     // against 3 inversions
const VDC_STEP = 3;    // against the 5-note arpeggio scale
const VDC_OCT = 7;     // against 3 octaves
const VDC_BELL = 7;    // against the 5-note scale, a different sequence
const VDC_BELLOCT = 3; // against 2 octaves

import { RNG, hash } from './rng.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const frac = (x) => x - Math.floor(x);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// pitch

const A4 = 440;
/** equal-tempered frequency of a MIDI note; 69 is A4 */
export const hz = (midi) => A4 * Math.pow(2, (midi - 69) / 12);

const PC_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const pcName = (midi) => PC_NAMES[((Math.round(midi) % 12) + 12) % 12];
export const noteName = (midi) => pcName(midi) + (Math.floor(Math.round(midi) / 12) - 1);

// ---------------------------------------------------------------------------
// the three generators

/**
 * Radical inverse of `k` in `base` — reverse the digits about the point.
 *
 * Deterministic, and injective on the non-negative integers, so no two events
 * are ever handed the same value. Quantising it can still create a period, and
 * does whenever `base` and the alphabet size share a factor; the `VDC_*`
 * constants above are all coprime to the alphabets they index.
 */
export function vdc(k, base) {
  let f = 1 / base, r = 0, i = Math.max(0, Math.floor(k));
  while (i > 0) { r += f * (i % base); i = Math.floor(i / base); f /= base; }
  return r;
}

/** a uniform in [0,1) from the project's avalanche hash — the irregular generator */
export const u01 = (...ns) => hash(...ns) / 4294967296;

// Named rather than inlined because their *independence* is the property being
// relied on: a later edit that replaced one with a decimal that merely looked
// similar would silently reintroduce a period. Each is the fractional part of a
// square root of a distinct prime.
export const PHI = 0.6180339887498949;  // (√5 − 1)/2
export const R3 = 0.7320508075688772;   // √3 − 1
export const R7 = 0.6457513110645906;   // √7 − 2

/**
 * LFO rate multipliers, for `audio.js`. Ratios of √p for distinct primes are
 * irrational, so no two of these oscillators ever come back into phase, and the
 * combined amplitude envelope is quasi-periodic rather than periodic.
 */
export const LFO_RATIOS = [1, Math.SQRT2, 1.7320508075688772, 2.23606797749979,
  2.6457513110645907, 3.3166247903554];

// ---------------------------------------------------------------------------
// the pad's timbre
//
// `wave` above names one of WebAudio's three built-in shapes, and it is kept
// because it is the readable thing to print in a label. It is not what gets
// played. A raw `sawtooth` has every harmonic at 1/n out to Nyquist, and held
// as a ten-second pad that is not warm, it is a buzzer — the opposite of the
// brief, and the opposite of what the reference frames look like. Three
// discrete shapes is also a coarse answer to a continuous input: a hue of 0.33
// and a hue of 0.34 should not step from `triangle` to `sawtooth`.
//
// So the pad is built from a generated harmonic table instead, and `warm` moves
// it continuously:
//
//   · **tilt** — amplitudes fall as `n^-tilt`, tilt 2.7 (a cold world, almost a
//     sine) to 1.5 (a warm world, reedy). A sawtooth is tilt 1.0; nothing here
//     ever gets there, which is the guarantee.
//   · **a Gaussian roll-off** on the top of the series, so the last partials
//     taper to nothing rather than stopping dead. A hard cut-off at partial 16
//     is a rectangular window on the spectrum and rings.
//   · **a slight even-harmonic dip** on warm worlds — an odd-weighted series is
//     hollow, like a stopped pipe, and hollow reads as warm where bright reads
//     as harsh.
//
// The point of putting it here rather than in `audio.js` is that "soothing" then
// becomes a number a harness can check: the amplitude-weighted mean harmonic
// (the spectral centroid) is computable offline, and `padCentroid()` below is
// what a check asserts a bound on.

/** how many harmonics the pad's generated wave carries */
export const PAD_PARTIALS = 16;

/**
 * Harmonic amplitudes for the pad's `PeriodicWave`, index 0 being DC (always
 * zero — a pad with a DC offset eats headroom and moves no air).
 */
export function padPartials(warm, n = PAD_PARTIALS) {
  const w = clamp(warm, 0, 1);
  const tilt = lerp(2.7, 1.5, w);
  const even = 1 - 0.35 * w;
  const a = new Float32Array(n + 1);
  for (let k = 1; k <= n; k++) {
    const taper = Math.exp(-2.2 * (k / n) * (k / n));
    a[k] = Math.pow(k, -tilt) * taper * (k % 2 === 0 ? even : 1);
  }
  return a;
}

/** amplitude-weighted mean harmonic number — the decidable form of "soft" */
export function padCentroid(warm, n = PAD_PARTIALS) {
  const a = padPartials(warm, n);
  let num = 0, den = 0;
  for (let k = 1; k <= n; k++) { num += k * a[k]; den += a[k]; }
  return den > 0 ? num / den : 1;
}

// ---------------------------------------------------------------------------
// modes
//
// Six of the seven diatonic modes, ordered dark to bright by the count of
// raised degrees. Locrian is absent on purpose: its tonic triad is diminished,
// so it has no home chord to rest on, and a piece with nowhere to rest is the
// exact opposite of the brief.

export const MODES = {
  phrygian: [0, 1, 3, 5, 7, 8, 10],
  aeolian: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
};

/** dark → bright. The index into this is what a star's colour temperature buys. */
export const MODE_LADDER = ['phrygian', 'aeolian', 'dorian', 'mixolydian', 'ionian', 'lydian'];

/** a scale degree, allowed to run off either end of the octave */
function at(scale, step) {
  const n = scale.length;
  return scale[((step % n) + n) % n] + 12 * Math.floor(step / n);
}

// ---------------------------------------------------------------------------
// colour tones
//
// The extension is expressed as a number of *scale steps* above the chord root
// rather than as a semitone interval, so it is diatonic by construction in
// every mode and never has to be transposed by hand. `oct` lifts it out of the
// triad's own octave, which is the difference between a 4th and an 11th.

export const EXTENSIONS = [
  { id: 'add9', step: 1, oct: 12 },
  { id: 'sus4', step: 3, oct: 0, replacesThird: true },
  { id: 'add11', step: 3, oct: 12 },
  { id: '6', step: 5, oct: 0 },
  { id: 'add13', step: 5, oct: 12 },
  { id: '7', step: 6, oct: 0 },
  { id: 'open', step: -1, oct: 0 },
];

/**
 * Whether a colour tone can be added to this particular chord without turning
 * a pad into a problem. Diatonic is not the same as consonant: the 9th of a
 * Phrygian tonic is a ♭9, the 6th of an Aeolian tonic is a ♭13 rubbing against
 * the fifth, and an 11th over a major third is the muddiest interval in
 * common practice. Each rejection below is one of those, and the caller walks
 * the list until something passes — so the hue still picks the colour, it just
 * cannot pick a colour this chord does not have.
 */
export function safeExtension(interval, third, fifth, ext) {
  const pc = ((interval % 12) + 12) % 12;
  if (pc === 1) return false;                                      // ♭9 against the root
  // A raised fourth is only ever an eleventh. Left inside the triad's own
  // octave it sits one semitone under the fifth, which is what turned the
  // Lydian tonic's "sus4" into G–C♯–D. Diatonic, and unlistenable.
  if (pc === 6 && (third !== 4 || ext.oct === 0)) return false;
  if (pc === 5 && third === 4 && !ext.replacesThird) return false; // 11 against a major third
  if (pc === 8 && ext.oct === 0) return false;                     // ♭13 a semitone off the fifth
  if (Math.abs(pc - fifth) === 1 && ext.oct === 0) return false;   // anything rubbing the fifth
  return true;
}

// ---------------------------------------------------------------------------
// how each of §6's six scales is arranged
//
// One row per scale, every knob on the row — the shape §5 asks for from the
// quality table, applied to the mix instead of the renderer. `octave` is always
// a multiple of twelve so that changing scale can never change key.
//
// The vacuum rows are sparse, wide and slow because that is what vacuum is: a
// four-octave voicing with the third removed reads as *distance*, and a
// thirty-second chord reads as something that was already sounding before you
// arrived. The atmosphere rows close the voicing up, warm the filter, and let
// the arpeggio in — the difference between looking at a place and standing in
// one.
//
// `reverb` in vacuum is the one deliberate lie in this file, and it is a lie
// about acoustics rather than about physics: there is no air out there to carry
// a tail. It is kept because the tail is how length-scale is heard, and §8's
// depth axis has no other instrument. It is annotated rather than hidden.

// `hue` and `starTemp` are the row's *fallbacks*, used when there is genuinely
// no world to ask — there is no palette and no star at the cosmic scale. They
// are not neutral values: 3600 K is roughly the star an actual galaxy is made
// of, since M dwarfs outnumber everything else by an order of magnitude, and
// the deep field really is blue. Both facts fall out as a dark mode and a pure
// sine, which is the right sound for the void and was not chosen for being it.
//
// `modeBias` is the scale's own vote on the mode ladder, and only the black
// hole uses it. Its accretion disc is genuinely the hottest thing in the
// project, which by the transfer above would score the maw in Lydian; two steps
// down is the one place the art direction overrules the physics, and §3's
// ruling ("the numbers are never negotiable; the palette always is") is why it
// costs a mode and not a temperature.

export const KIND_ARRANGEMENT = {
  cosmic: { vacuum: true, octave: -12, spread: 4, chordScale: 2.6, pad: 0.85, air: 0.42, body: 0.30, sub: 0.95, shimmer: 0.75, arp: 0, bell: 0.05, reverb: 6.0, wet: 0.62, cutoff: 1.15, hue: 0.58, starTemp: 3600, modeBias: 0 },
  galaxy: { vacuum: true, octave: -12, spread: 4, chordScale: 2.2, pad: 0.72, air: 0.72, body: 0.14, sub: 0.55, shimmer: 1.00, arp: 0, bell: 0.14, reverb: 5.4, wet: 0.60, cutoff: 1.60, hue: 0.56, starTemp: 3600, modeBias: 0 },
  system: { vacuum: true, octave: -12, spread: 3, chordScale: 1.8, pad: 0.95, air: 0.34, body: 0.22, sub: 0.70, shimmer: 0.55, arp: 0.10, bell: 0.18, reverb: 4.4, wet: 0.52, cutoff: 1.00, hue: 0.11, starTemp: 5778, modeBias: 0 },
  blackhole: { vacuum: true, octave: -24, spread: 4, chordScale: 3.2, pad: 0.55, air: 0.30, body: 0.85, sub: 1.20, shimmer: 0.30, arp: 0, bell: 0.03, reverb: 7.0, wet: 0.70, cutoff: 0.55, hue: 0.04, starTemp: 5778, modeBias: -2 },
  planet: { vacuum: false, octave: -12, spread: 3, chordScale: 1.5, pad: 0.90, air: 0.66, body: 0.34, sub: 0.55, shimmer: 0.62, arp: 0.14, bell: 0.22, reverb: 3.4, wet: 0.46, cutoff: 1.15, hue: 0.08, starTemp: 5778, modeBias: 0 },
  clouds: { vacuum: false, octave: 0, spread: 3, chordScale: 1.2, pad: 0.80, air: 1.00, body: 0.40, sub: 0.40, shimmer: 0.70, arp: 0.26, bell: 0.26, reverb: 3.0, wet: 0.44, cutoff: 1.25, hue: 0.08, starTemp: 5778, modeBias: 0 },
  surface: { vacuum: false, octave: 0, spread: 2, chordScale: 1.0, pad: 0.78, air: 0.85, body: 0.46, sub: 0.38, shimmer: 0.45, arp: 0.52, bell: 0.38, reverb: 2.3, wet: 0.34, cutoff: 1.00, hue: 0.08, starTemp: 5778, modeBias: 0 },
};

export const SCALE_KINDS = Object.keys(KIND_ARRANGEMENT);

// ---------------------------------------------------------------------------
// instrumentation, by what the world is made of
//
// `body` is one noise source through one lowpass with one slow gain LFO, and
// every entry below is that same pair of nodes at different settings. A lava
// world's roar and an ocean world's swell are the same two objects — 58 Hz at
// 0.19 Hz against 420 Hz at 0.081 Hz — which is why adding a world type costs a
// table row rather than a voice (§5: any change that costs frames must pay for
// them; this one costs none).
//
// `mode` is a bias in ladder steps, `arp`/`bell` are multipliers on the scale
// row's density, and `sub` weights the bottom octave.

const TYPE_VOICE = {
  terrestrial: { mode: 0, body: { hz: 300, q: 0.6, rate: 0.062, gain: 0.30 }, arp: 1.00, bell: 1.00, sub: 1.00 },
  ocean: { mode: 0, body: { hz: 420, q: 0.5, rate: 0.081, gain: 0.62 }, arp: 0.85, bell: 0.90, sub: 1.25 },
  ice: { mode: +1, body: { hz: 900, q: 0.7, rate: 0.037, gain: 0.20 }, arp: 0.80, bell: 1.60, sub: 0.70 },
  lava: { mode: -1, body: { hz: 58, q: 1.2, rate: 0.191, gain: 0.86 }, arp: 0.30, bell: 0.25, sub: 1.35 },
  barren: { mode: 0, body: { hz: 200, q: 0.5, rate: 0.029, gain: 0.16 }, arp: 0.45, bell: 0.55, sub: 0.90 },
  'gas giant': { mode: -1, body: { hz: 120, q: 0.8, rate: 0.047, gain: 0.80 }, arp: 0.35, bell: 0.40, sub: 1.45 },
  'ice giant': { mode: 0, body: { hz: 150, q: 0.8, rate: 0.043, gain: 0.72 }, arp: 0.40, bell: 0.60, sub: 1.35 },
};

const VOID_VOICE = { mode: 0, body: { hz: 110, q: 0.7, rate: 0.023, gain: 0.55 }, arp: 1, bell: 1, sub: 1 };

// ---------------------------------------------------------------------------
// the art direction's vote
//
// `resonance.js` already decides what a world *looks* like, and the two should
// not disagree — a world graded as "chrome and rain" should not be scored in
// Lydian. Each resonance gets one step of bias on the mode ladder and a small
// nudge on density, and that is all it gets: the star's temperature still picks
// the mode, and the resonance only leans on it. §3 ("the numbers are never
// negotiable; the palette always is") puts the physics first and this keeps it
// there, at the cost of one integer.

export const MOOD_MUSIC = {
  counsel: { mode: -1, arp: 0.7, bell: 0.8 },        // the monumental desert
  wanderers: { mode: +1, arp: 1.25, bell: 1.2 },     // the bright pastoral
  chrome: { mode: -1, arp: 1.15, bell: 1.3 },        // the neon nocturne
  afternoon: { mode: 0, arp: 0.85, bell: 0.7 },      // the sepia hush
  pale: { mode: +1, arp: 0.9, bell: 1.4 },           // the chalk pastel
  gold: { mode: 0, arp: 1.1, bell: 1.0 },            // the singing dunes
  vault: { mode: 0, arp: 0.5, bell: 0.6 },           // the stark geometry
  winterlight: { mode: +1, arp: 0.7, bell: 1.7 },    // the near-mono north
  greenshade: { mode: 0, arp: 1.2, bell: 0.9 },      // the overgrown thought
  searemembers: { mode: -1, arp: 0.8, bell: 0.9 },   // the great wave's patience
  forge: { mode: -1, arp: 0.4, bell: 0.4 },          // the fire's ledger
  procession: { mode: -1, arp: 0.5, bell: 0.7 },     // the slow giants
  plain: { mode: 0, arp: 1, bell: 1 },
};

// ---------------------------------------------------------------------------
// the mapping

/** the degrees worth building a progression from, weighted toward home */
const DEGREE_WEIGHT = [4, 2, 1, 3, 2, 3, 2];

/**
 * Which degrees this mode can rest on. Exactly one degree of every diatonic
 * mode carries a diminished fifth; a drone on it is a tritone held for thirty
 * seconds, which is not soothing in any register. It is dropped rather than
 * repaired, because repairing it (raising the fifth) would silently produce a
 * chord that is not in the mode.
 */
export function degreePool(scale) {
  const pool = [];
  for (let d = 0; d < scale.length; d++) {
    if (at(scale, d + 4) - scale[d] !== 6) pool.push(d);
  }
  return pool;
}

function buildProgression(scale, seed, length) {
  const pool = degreePool(scale);
  const bag = [];
  for (const d of pool) for (let i = 0; i < DEGREE_WEIGHT[d]; i++) bag.push(d);
  const r = new RNG(hash(seed, 0x9401));
  const out = [0];                       // it always begins at home
  while (out.length < length) {
    let d = bag[r.int(0, bag.length - 1)];
    for (let guard = 0; d === out[out.length - 1] && guard < 8; guard++) {
      d = bag[r.int(0, bag.length - 1)];
    }
    out.push(d);
  }
  return out;
}

/**
 * The five notes the arpeggio is allowed to touch.
 *
 * A pentatonic subset of the mode, chosen so that no arpeggio note can clash
 * with any chord the progression can produce — which is what lets the arpeggio
 * drift freely (its notes are picked by an irrational rotation, not by the
 * harmony) without ever needing to know what the pad is doing. The dropped
 * degrees are exactly the two that carry the mode's dissonances: the ♭2 and ♭6
 * in the dark modes, the 4th and 7th in the bright ones.
 *
 * Lydian is the exception and keeps its ♯4, because dropping it would leave
 * Lydian's arpeggio indistinguishable from Ionian's — and the whole point of
 * letting a blue-white star buy Lydian is that you can hear that it did.
 */
export function pentatonicOf(scale) {
  if (scale[3] === 6) return [0, 1, 3, 4, 5].map(i => scale[i]);  // lydian: root 9 ♯11 5 13
  const steps = scale[2] === 4 ? [0, 1, 2, 4, 5] : [0, 2, 3, 4, 6];
  return steps.map(i => scale[i]);
}

/**
 * A world descriptor → everything a synthesiser needs to know.
 *
 * Every field of `world` is optional and every default is a real place: Earth
 * under the Sun, seen from the ground. A caller that knows nothing still gets a
 * coherent piece rather than a silence or a crash, which matters because
 * `main.js` legitimately has no planet to describe at the cosmic scale.
 */
export function deriveScore(world = {}) {
  const kind = KIND_ARRANGEMENT[world.kind] ? world.kind : 'cosmic';
  const arr = KIND_ARRANGEMENT[kind];
  const seed = (world.seed ?? 0) >>> 0;
  // the key belongs to the star, so a whole system is one piece of music
  const keySeed = (world.keySeed ?? world.seed ?? 0) >>> 0;
  const type = world.type ?? '';
  const tv = TYPE_VOICE[type] ?? VOID_VOICE;
  const mood = MOOD_MUSIC[world.mood] ?? MOOD_MUSIC.plain;
  const inhabited = !!world.inhabited;
  const atmo = clamp(world.atmo ?? (arr.vacuum ? 0 : 1), 0, 2);
  const motion = clamp(world.motion ?? 1, 0.25, 1);   // §9.8, reduced-motion scalar

  // -- mode, from the star's colour temperature ------------------------------
  // The transfer is logarithmic because stellar colour is: the visible
  // difference between 3000 K and 6000 K is enormous and between 20000 K and
  // 40000 K is nothing, and the ear reads pitch the same way. A red dwarf lands
  // on Phrygian, the Sun on Dorian, an A star on Ionian, anything blue-white on
  // Lydian. §9.6 derives the sky's four stops from the same number through a
  // fixed transfer; this is that idea, one sense across.
  const starTemp = clamp(world.starTemp ?? arr.starTemp, 1500, 60000);
  const bright = clamp((Math.log(starTemp) - Math.log(2800)) / (Math.log(14000) - Math.log(2800)), 0, 1);
  const modeIndex = clamp(Math.round(bright * (MODE_LADDER.length - 1)) + tv.mode + mood.mode + arr.modeBias,
    0, MODE_LADDER.length - 1);
  const mode = MODE_LADDER[modeIndex];
  const scale = MODES[mode];

  // -- register, from surface gravity ---------------------------------------
  //
  // Heavy worlds sit low. `gravity` is in **m/s²**, not multiples of g.
  //
  // The coefficient is 8 semitones per octave of gravity rather than twelve, so
  // the mapping is audible without dragging the pad out of the register a pad
  // belongs in. It was 5, and 5 did not survive the next line: the tonic has to
  // land on a pitch class in *some* octave, so `base` is quantised to 12, and
  // at 5 semitones the whole plausible gravity range — call it a 1.6 m/s²
  // moonlet to a 24 m/s² super-Earth, 3.9 octaves of gravity — spanned 19.5
  // semitones and collapsed onto **two** octaves. `tools/verify.js` caught a 1 g
  // world and a 2.5 g world coming out on the same note.
  //
  // At 8 it spans 31 semitones, the clamp below spans 24, and the three land on
  // three distinct octaves. The quantisation is not a defect to be removed — it
  // is what makes the tonic a note — so the fix is to give it enough range to
  // quantise, which is the general shape of every "the mapping does not come
  // through" bug in this file.
  const g = clamp(world.gravity ?? 9.80665, 0.25, 60);
  const base = clamp(48 - 8.0 * Math.log2(g / 9.80665), 34, 58);
  const tonicPc = hash(keySeed, 0x5c0e) % 12;
  const tonicMidi = tonicPc + 12 * Math.round((base - tonicPc) / 12) + arr.octave;

  // -- tempo, from equilibrium temperature ----------------------------------
  // Temperature *is* rate — it is mean molecular speed by definition — so this
  // is the least arbitrary mapping in the file. It is bounded into 42–68 bpm
  // because the brief is flow state, and a piece is not soothing at 96 bpm no
  // matter how honest its derivation.
  const Teq = clamp(world.Teq ?? 288, 15, 4000);
  const heat = clamp((Math.log(Teq) - Math.log(45)) / (Math.log(900) - Math.log(45)), 0, 1);
  const bpm = (42 + 26 * heat) * (arr.vacuum ? 0.72 : 1) * lerp(0.8, 1, motion);
  const beat = 60 / bpm;
  const chordSeconds = beat * 8 * arr.chordScale;

  // -- colour tone and timbre, from the palette's hue ------------------------
  // `warm` peaks on the orange the terrain palettes cluster around and bottoms
  // out on cyan, which puts a lava world at ~1 and an ice world at ~0 without
  // either being special-cased. It buys two things: the oscillator shape (a
  // warm world is reedy, a cold one is a pure sine) and the detune spread,
  // which is heat shimmer done with pitch.
  const hue = frac(world.hue ?? arr.hue);
  const warm = 0.5 + 0.5 * Math.cos(2 * Math.PI * (hue - 0.07));
  const wave = warm > 0.66 ? 'sawtooth' : warm > 0.34 ? 'triangle' : 'sine';
  const detuneCents = (4 + 9 * warm + (arr.vacuum ? 3 : 0)) * motion;
  const extension = EXTENSIONS[Math.floor(hue * EXTENSIONS.length) % EXTENSIONS.length];

  // -- the empty worlds ------------------------------------------------------
  // No third: a bare root-and-fifth. Airless ground and the deep vacuum get it
  // for the same reason — a third is what tells you whether a chord is happy or
  // sad, and neither of those is a thing an empty place has an opinion about.
  const thirdless = type === 'barren' || kind === 'cosmic' || kind === 'blackhole'
    || (!arr.vacuum && atmo < 0.12);

  const progression = buildProgression(scale, seed,
    inhabited ? 4 : (arr.vacuum || thirdless) ? 2 : 3);

  // -- density ---------------------------------------------------------------
  // People are the only thing on this list that makes a world *busier*. An
  // inhabited world gets a fourth chord, a denser arpeggio and more bells;
  // everything else in the table can only thin it out.
  //
  // The type's opinion and the resonance's opinion combine as a **geometric
  // mean**, not a product. Multiplying them compounds: a lava world scored
  // "what the fire owes" came out at 0.06 arpeggio density — one note every
  // sixteen events, which is not sparse, it is broken. The geometric mean is
  // the right way to average two independent multiplicative votes, and it keeps
  // the lava world at a fifth of a temperate one rather than a sixteenth.
  const agree = (a, b) => Math.sqrt(Math.max(a, 1e-4) * Math.max(b, 1e-4));
  const arp = clamp(arr.arp * agree(tv.arp, mood.arp) * (inhabited ? 1.55 : 1) * motion, 0, 1);
  const bell = clamp(arr.bell * agree(tv.bell, mood.bell) * (inhabited ? 1.3 : 1) * motion, 0, 1);

  // -- air and body ----------------------------------------------------------
  // Air is wind, and an airless world has none: at `atmo = 0` this is silent
  // and you hear only the score, which is both correct and the most distinctive
  // thing standing on an airless world sounds like.
  const airGain = arr.air * (arr.vacuum ? 1 : clamp(0.12 + 0.88 * atmo, 0, 1.3));
  const air = {
    centerHz: 240 + 520 * (arr.vacuum ? 0.55 : clamp(atmo, 0, 1.4)),
    q: 0.62,
    gain: airGain,
    gustRate: 0.09 * lerp(1, 1.35, heat),
    gustDepth: 0.55 * motion,
  };
  const body = {
    lowpassHz: tv.body.hz,
    q: tv.body.q,
    gain: arr.body * tv.body.gain * (arr.vacuum ? 1 : clamp(0.25 + 0.75 * atmo, 0, 1.3)),
    swellRate: tv.body.rate,
    swellDepth: 0.42 * motion,
  };

  // -- the print, for sound --------------------------------------------------
  // Brightness sets one lowpass across the whole tonal bus, and it is the
  // audible twin of §9.3: a thick atmosphere absorbs high frequencies the way
  // it absorbs contrast, so a dense world is *both* hazier and duller, from one
  // number. Warm worlds close further still — heat haze has no top end.
  const brightness = clamp(0.34 + 0.42 * (1 - warm) + 0.24 * (modeIndex / 5)
    - 0.18 * clamp(atmo - 1, 0, 1), 0.12, 1);
  const cutoffHz = clamp(220 * Math.pow(2, 1 + 4.2 * brightness) * arr.cutoff, 180, 9000);

  // -- space -----------------------------------------------------------------
  const reverb = {
    seconds: arr.reverb * (arr.vacuum ? 1 : clamp(0.5 + 0.75 * atmo, 0.35, 1.5)),
    wet: arr.wet * (arr.vacuum ? 1 : clamp(0.45 + 0.6 * atmo, 0.3, 1.2)),
    damping: clamp(0.35 + 0.4 * warm + 0.25 * clamp(atmo - 0.5, 0, 1), 0.2, 1),
  };

  const score = {
    kind, vacuum: arr.vacuum, seed, keySeed, type, mood: world.mood ?? 'plain', inhabited,
    tonicPc, tonicMidi, tonicHz: hz(tonicMidi), tonicName: pcName(tonicPc),
    mode, modeIndex, scale, thirdless,
    pentatonic: pentatonicOf(scale),
    extension, progression,
    bpm, beat, chordSeconds,
    glide: Math.min(2.6, chordSeconds * 0.22),
    spread: arr.spread,
    warm, wave, detuneCents, brightness, cutoffHz, atmo, motion,
    voices: {
      pad: arr.pad, sub: arr.sub * tv.sub, shimmer: arr.shimmer * motion,
      air: air.gain, body: body.gain, arp, bell,
    },
    air, body, reverb,
    lfoBase: 0.021 * lerp(0.75, 1.25, heat) * motion,
    // Where each generator starts along its sequence. Without it every world
    // opens on the same three chords, because a radical inverse always begins
    // 0, 1/b, 2/b — and the low terms of a van der Corput sequence are its
    // most obviously structured. The offset is seeded, so it is still the same
    // opening every time you follow the same link (§2.4).
    offset: {
      chord: hash(seed, 0xc40d) % 4096,
      arp: hash(seed, 0xa2b0) % 4096,
      bell: hash(seed, 0xbe11) % 4096,
    },
  };
  score.label = describeScore(score);
  return score;
}

/** the one line a human (or a harness with no ears) can check the mapping against */
export function describeScore(s) {
  return `${s.kind} · ${s.tonicName} ${s.mode} · ${s.bpm.toFixed(0)} bpm · `
    + `${s.chordSeconds.toFixed(0)} s chords · ${s.thirdless ? 'open' : s.extension.id} · `
    + `${s.wave} · spread ${s.spread} · rev ${s.reverb.seconds.toFixed(1)} s`;
}

// ---------------------------------------------------------------------------
// voicing

/**
 * The k-th chord. Pure in `k`, so the browser and the harness agree on the
 * whole piece without either having to store it, and a scale change can jump to
 * a different `k` without a seam.
 */
export function chordPlan(score, k) {
  const L = score.progression.length;
  const o = score.offset;
  const pos = Math.min(L - 1, Math.floor(vdc(k + o.chord, VDC_CHORD) * L));
  const degree = score.progression[pos];
  const inversion = Math.floor(vdc(k + o.chord, VDC_INV) * 3);
  // three rotations summed to unit amplitude: the harmonic rhythm breathes
  // ±30% and the pattern of long and short chords never comes round again
  const wob = 0.5 * Math.sin(2 * Math.PI * k * PHI)
    + 0.3 * Math.sin(2 * Math.PI * k * R3)
    + 0.2 * Math.sin(2 * Math.PI * k * R7);
  const v = voiceChord(score, degree, inversion);
  return {
    k, pos, degree, inversion,
    seconds: score.chordSeconds * (1 + 0.30 * wob * score.motion),
    root: v.root, notes: v.notes, hz: v.notes.map(hz), name: v.name, ext: v.ext,
  };
}

/** how far each voice of the chord is lifted, by scale row — close to very wide */
const SPREAD_OCT = {
  2: [0, 0, 0, 1, 1],
  3: [0, 0, 1, 1, 2],
  4: [0, 1, 1, 2, 3],
};

export function voiceChord(score, degree, inversion = 0) {
  const s = score.scale;
  const root = score.tonicMidi + at(s, degree);
  const third = at(s, degree + 2) - at(s, degree);
  const fifth = at(s, degree + 4) - at(s, degree);

  // the colour tone the hue asked for, or the nearest one this chord can hold
  let ext = null, extIv = 0;
  const start = EXTENSIONS.indexOf(score.extension);
  for (let i = 0; i < EXTENSIONS.length; i++) {
    const e = EXTENSIONS[(start + i) % EXTENSIONS.length];
    if (e.step < 0) { ext = e; break; }
    const iv = at(s, degree + e.step) + e.oct - at(s, degree);
    if (safeExtension(iv, third, fifth, e)) { ext = e; extIv = iv; break; }
  }
  if (!ext) ext = EXTENSIONS[EXTENSIONS.length - 1];

  const notes = [root];
  if (!score.thirdless && !ext.replacesThird) notes.push(root + third);
  notes.push(root + fifth);
  if (ext.step >= 0) notes.push(root + extIv);

  // Spread first, inversion second, and the order is load-bearing. The spread
  // rows are monotone, so applying them by index to an ascending chord leaves
  // it ascending; inverting first would scramble the order the spread indexes
  // into and turn a "close" voicing into a two-octave one. The first draft did
  // exactly that and put a barren moon's tonic chord across F4–G6.
  const oct = SPREAD_OCT[score.spread] ?? SPREAD_OCT[3];
  const out = notes.map((n, i) => n + 12 * oct[Math.min(i, oct.length - 1)]);

  // Inversion proper: the lowest voices go up an octave, so the span is
  // unchanged and only which note is on the bottom moves. The `sub` voice holds
  // the real root underneath regardless, which is what makes this free.
  for (let i = 0; i < Math.min(inversion, out.length - 1); i++) out[i] += 12;
  out.sort((a, b) => a - b);

  // The last line of defence, and it earns its place: `degreePool` keeps the
  // progression off the one degree per mode that carries a diminished fifth,
  // but `voiceChord` is exported and a caller is entitled to ask for any
  // degree. A minor second held for ten seconds in a pad is the single worst
  // sound this file could make, so any that survives is opened out to a minor
  // ninth — which is the same two pitch classes and an entirely different
  // chord. Bounded: at most one pass per pair, and the array only ever spreads.
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (let i = 0; i + 1 < out.length; i++) {
      if (out[i + 1] - out[i] === 1) { out[i + 1] += 12; moved = true; }
    }
    if (!moved) break;
    out.sort((a, b) => a - b);
  }
  for (let i = 0; i < out.length; i++) out[i] = clamp(out[i], 21, 100);

  return { root, notes: out, ext, name: chordName(root, third, fifth, ext, extIv, score.thirdless) };
}

function chordName(root, third, fifth, ext, extIv, thirdless) {
  const sus = ext.step >= 0 && ext.replacesThird;
  let q = thirdless ? '5' : sus ? '' : third === 3 ? 'm' : '';
  if (fifth === 6 && !thirdless) q += '♭5';
  let tail = '';
  if (ext.step >= 0) {
    const pc = ((extIv % 12) + 12) % 12;
    tail = sus ? 'sus4' : ext.id === '7' ? (pc === 11 ? 'maj7' : '7') : `(${ext.id})`;
  }
  return pcName(root) + q + tail;
}

// ---------------------------------------------------------------------------
// the drifting parts

/**
 * The k-th arpeggio event. `rest` is true for most of them at low density —
 * the arpeggio is thinned by *not playing*, never by getting quieter, because a
 * quiet note still lands on the beat and a missing one does not.
 */
export function arpNote(score, k) {
  const p = score.pentatonic;
  const o = score.offset;
  const step = Math.floor(vdc(k + o.arp, VDC_STEP) * p.length);
  const ou = vdc(k + o.arp, VDC_OCT);
  const oct = ou < 0.42 ? 1 : ou < 0.84 ? 2 : 3;
  const midi = clamp(score.tonicMidi + p[step] + 12 * oct, 36, 104);
  const gu = u01(score.seed, k, 0x9a7);
  const gap = score.beat * (gu < 0.30 ? 1 : gu < 0.74 ? 2 : 4);
  return {
    k, midi, hz: hz(midi), gap,
    vel: 0.30 + 0.70 * u01(score.seed, k, 0x1e1),
    rest: u01(score.seed, k, 0x2e5) > score.voices.arp,
  };
}

/**
 * The k-th bell. Two octaves above the arpeggio and far rarer — this is the
 * distant one, the thing that makes you look up. It borrows the arpeggio's
 * clock so the two can never collide on the same instant.
 */
export function bellNote(score, k) {
  const p = score.pentatonic;
  const o = score.offset;
  const step = Math.floor(vdc(k + o.bell, VDC_BELL) * p.length);
  const oct = vdc(k + o.bell, VDC_BELLOCT) < 0.5 ? 3 : 4;
  const midi = clamp(score.tonicMidi + p[step] + 12 * oct, 48, 108);
  return {
    k, midi, hz: hz(midi),
    gap: score.beat * (6 + 26 * u01(score.seed, k, 0x8e11)),
    vel: 0.25 + 0.55 * u01(score.seed, k, 0x8e12),
    rest: u01(score.seed, k, 0x8e13) > score.voices.bell,
  };
}

/**
 * Snap an arbitrary frequency onto this world's scale.
 *
 * The HUD's selection blip and `festival.js`'s bells both arrive with a
 * hard-coded frequency from before there was a key to be in. Rather than
 * change their call sites (and rather than leave them out of tune with
 * everything else), they are pulled onto the nearest pentatonic degree. A
 * festival on a Phrygian world now rings in Phrygian.
 */
export function snapToScale(score, freq) {
  const midi = 69 + 12 * Math.log2(Math.max(freq, 1) / A4);
  const p = score.pentatonic;
  const rel = midi - score.tonicMidi;
  const octave = Math.floor(rel / 12);
  const within = rel - octave * 12;
  let best = p[0], dist = Infinity;
  for (const s of p) {
    for (const o of [-12, 0, 12]) {
      if (Math.abs(within - (s + o)) < dist) { dist = Math.abs(within - (s + o)); best = s + o; }
    }
  }
  return hz(score.tonicMidi + octave * 12 + best);
}
