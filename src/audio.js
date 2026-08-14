// The sound of the universe, synthesised from nothing.
//
// §2.1 forbids audio files as flatly as it forbids textures, so there is not a
// byte of recorded sound anywhere in this project and there never will be.
// Everything below is oscillators, seeded noise written into an `AudioBuffer`,
// biquads, and a reverb whose impulse response is *generated* — the same
// doctrine as `paint.js` and `material.js`, one sense across.
//
// ---------------------------------------------------------------------------
// The split, and why it is where it is
//
// `score.js` decides the music: key, mode, tempo, voicing, density, timbre, all
// as pure functions of the world you are standing on. This file decides
// nothing. It is a synthesiser that is handed a `Score` and plays it.
//
// That line exists because of §7.3. New maths gets a CPU reference and an
// offline check "before it enters the render loop", and a synthesiser is the
// worst case in the repo for that rule — it cannot be screenshotted, cannot be
// pixel diffed, and cannot be heard by whoever is writing it. Splitting the
// decisions out means the half that carries the claim ("the score is attuned to
// the world") is a pure function `node` can interrogate, and the half that is
// left here is oscillators and gain nodes, where the failure modes are "no
// sound" and "one node too many" rather than "wrong music".
//
// ---------------------------------------------------------------------------
// One graph, built once
//
// §5 makes the frame budget a correctness property. The old ambience built a
// fresh bed of oscillators per scale and cached seven of them in a `Map`; this
// builds **one** graph at unlock and never adds a persistent node again. A
// scale change re-targets parameters — it does not allocate, does not
// disconnect, and does not rebuild. The only nodes created after init are the
// transient ones: a plucked note, a bell, a riser, each of which stops itself
// and disconnects on `onended`.
//
// Node count is fixed by the tier row below and is between 55 and 80. All of it
// lives on the browser's audio thread, so none of it is on the frame's critical
// path — but the *allocation* would have been, which is what this avoids.
//
// ---------------------------------------------------------------------------
// Continuity (§2.5)
//
// §2.5 forbids cuts, and a soundtrack that restarts when you dive is a cut. So
// the piece never restarts. `chordPlan(score, k)` is pure in `k`, and `k` is a
// counter this file owns and *never resets* — descending cosmic → galaxy →
// system → orbit → cloud deck → ground continues the same piece at the chord it
// had reached, in the same key (`score.js` hangs the key on the star's seed, so
// every world in a system shares one), while the arrangement cross-fades
// underneath over `XFADE` seconds and the pad glides to its new voicing.
//
// The one thing that changes discontinuously is the pad's wavetable, and it is
// annotated at the call site.

import { RNG, hash } from './rng.js';
import { TIER } from './quality.js';
import {
  LFO_RATIOS, arpNote, bellNote, chordPlan, deriveScore, hz, padPartials,
  snapToScale,
} from './score.js';

// ---------------------------------------------------------------------------
// the tier row (§5)
//
// One row per quality tier, every knob on the row, chosen once at init and
// never moved again (§11). The costs that scale are oscillator count and
// impulse-response length — the two things in a WebAudio graph that actually
// show up in a profile. A low-tier machine gets three pad voices in unison-of-
// one and a 3.2 s tail; ultra gets five in pairs and 7 s.

export const AUDIO_TIER = [
  { padSlots: 3, unison: 1, shimmer: 1, irVast: 3.2, irClose: 1.4, arp: true },
  { padSlots: 4, unison: 2, shimmer: 2, irVast: 4.0, irClose: 1.8, arp: true },
  { padSlots: 5, unison: 2, shimmer: 3, irVast: 6.0, irClose: 2.4, arp: true },
  { padSlots: 5, unison: 2, shimmer: 3, irVast: 7.0, irClose: 2.8, arp: true },
];

/** how long a scale change takes to complete, in seconds. A cross-fade, not a cut. */
export const XFADE = 3.2;
/** how far ahead the scheduler writes events. Comfortably over the 1 s a background tab throttles to. */
const LOOKAHEAD = 2.0;
/** how often the scheduler wakes. Not on the render loop, and not a rAF. */
const TICK_MS = 250;
/** the pad's wavetable is quantised to this many warmth steps, cached at init */
const WAVE_STEPS = 5;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------------------------------------------------------------------
// gain staging, as a table rather than as literals
//
// These were inline in `_applyScore` and there is one good reason to lift them
// out: they are the only thing standing between the score and a clipped mix,
// and inline they could not be added up by anything but a person. As a table,
// `peakMix()` below can total them and a check can assert the sum, which turns
// "does it clip?" from a listening test into arithmetic.
//
// Every number is a *peak* contribution — voice gain at its LFO's maximum —
// against a `score.voices.*` value that is already ≤ ~1.3. The compressor after
// the master is a safety net for the transients, not a mixer; if it is doing
// real work on the sustained voices then this table is wrong.

export const TRIM = {
  pad: 0.10, padLfo: 0.022,     // the harmonic body
  sub: 0.16,                    // gravity, under everything
  shimmer: 0.9, shimmerOsc: 0.012,
  air: 0.13,                    // wind / starlight wash
  body: 0.16,                   // swell, roar, rumble
  bloom: 0.05,                  // the golden-hour layer
  arp: 0.05, bell: 0.028,       // transients, one at a time
  wet: 0.9,                     // reverb send scale
};

/**
 * The worst case the mix can reach on a given score, summing every sustained
 * voice at its LFO peak plus one transient. Pure, so a check can sweep every
 * scale and every world type and assert the total leaves headroom.
 */
export function peakMix(score) {
  const v = score.voices;
  return v.pad * (TRIM.pad + TRIM.padLfo)
    + v.sub * TRIM.sub
    + v.shimmer * TRIM.shimmer * TRIM.shimmerOsc * 3
    + v.air * TRIM.air * (1 + score.air.gustDepth)
    + v.body * TRIM.body * (1 + score.body.swellDepth)
    + TRIM.bloom + TRIM.arp;
}

/**
 * The impulse response's amplitude envelope at time `t` in a tail of `seconds`.
 *
 * `exp(−6.9078·t/T)` is −60 dB exactly at `T`, which is the definition of RT60,
 * and the `(1 − t/T)` factor forces the last sample to be exactly zero. Without
 * it the buffer ends on a non-zero value and the convolution's tail terminates
 * in a step — a click on every impulse, which in a reverb means a click on
 * everything.
 */
export function irEnvelope(t, seconds) {
  if (!(seconds > 0) || t < 0 || t > seconds) return 0;
  const build = t < 0.008 ? t / 0.008 : 1;   // a tail builds, it does not begin
  return Math.exp(-6.9078 * t / seconds) * (1 - t / seconds) * build;
}

/** the one-pole coefficient at fraction `u` through the tail — air absorbs the top first */
export function irDamp(u, damping) {
  return Math.min(0.985, 0.12 + damping * 0.86 * clamp(u, 0, 1));
}

/** which of the two convolvers the score's tail length asks for, 0 = close, 1 = vast */
export function reverbBlend(seconds, close, vast) {
  return clamp((seconds - close) / Math.max(vast - close, 1e-3), 0, 1);
}

/** the per-voice level of an `n`-note chord, normalised so the pad's total is 1 */
export function padTaper(i, n) {
  if (i >= n) return 0;
  let sum = 0;
  for (let k = 0; k < n; k++) sum += Math.pow(0.86, k);
  return Math.pow(0.86, i) / sum;
}

/**
 * How far a cross-fade has travelled `t` seconds in.
 *
 * `setTargetAtTime` with a time constant of `XFADE/3` is a first-order approach
 * that reaches 95% at `XFADE`. It is used for every ramp in this file precisely
 * because it cannot overshoot — a cross-fade that overshot would momentarily
 * push a voice above its target and put a bump in the middle of a transition
 * whose entire job is to be unnoticeable (§2.5).
 */
export function xfadeAt(t, seconds = XFADE) {
  return t <= 0 ? 0 : 1 - Math.exp(-3 * t / seconds);
}


export class Ambience {
  /**
   * `seed` is the universe's, and it is optional only so that the existing
   * `new Ambience()` in `main.js` keeps working unchanged. Passing it gives the
   * cosmic web its own key — see `docs/notes/score-integration.md`.
   */
  constructor(seed = 0) {
    this.ctx = null;
    this.seed = seed >>> 0;
    this.current = null;
    this.muted = localStorage.getItem('aeon-mute') === '1';
    this.level = 0.24;
    this.score = null;
    this._pendingScale = null;
    this._pendingScore = null;
    this._scaleKey = null;
    this.q = AUDIO_TIER[clamp(TIER, 0, AUDIO_TIER.length - 1)];

    // §9.8: reduced motion *reduces*, it never silences — "this is a moving
    // universe, and stillness would be a lie about it." The scalar reaches
    // `deriveScore`, which halves LFO depth, slows the harmonic rhythm and
    // thins the arpeggio. It does not touch a single gain.
    let reduced = false;
    try { reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false; }
    catch { /* no matchMedia; assume motion is wanted */ }
    this.motion = reduced ? 0.5 : 1;
  }

  /** must be called from a user gesture (autoplay policy) */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._build();
      if (this._pendingScale) { const p = this._pendingScale; this._pendingScale = null; this.setScale(...p); }
      else this.setScale('cosmic', null);
      if (this._pendingScore != null) { const r = this._pendingScore; this._pendingScore = null; this.surfaceScore(r); }
    } catch (e) {
      console.warn('AEON: audio unavailable —', e.message);
      this.ctx = null;
    }
  }

  toggleMute() {
    this.muted = !this.muted;
    localStorage.setItem('aeon-mute', this.muted ? '1' : '0');
    if (this.ctx) this.master.gain.linearRampToValueAtTime(
      this.muted ? 0 : this.level, this.ctx.currentTime + 0.4);
    return this.muted;
  }

  /** stop the scheduler and release the context — for a harness, not for the game */
  dispose() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    try { this.ctx?.close(); } catch { /* already gone */ }
    this.ctx = null;
  }

  // ------------------------------------------------------------- helpers ----

  _gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }

  _filter(type, freq, q = 0.9) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }

  _osc(type, freq) {
    const o = this.ctx.createOscillator();
    if (type) o.type = type;
    o.frequency.value = freq;
    o.start();
    return o;
  }

  /**
   * An LFO into an `AudioParam`. Returned rather than discarded so that
   * `_applyScore` can re-target its rate and depth on a scale change instead of
   * building a new one — which is the whole reason the graph never grows.
   */
  _lfo(rate, depth, param, offset) {
    const o = this._osc('sine', rate);
    const g = this._gain(depth);
    o.connect(g); g.connect(param);
    if (offset !== undefined) param.value = offset;
    return { osc: o, gain: g, param };
  }

  /** re-aim an LFO without rebuilding it */
  _aim(lfo, rate, depth, offset) {
    const t = this.ctx.currentTime, tc = XFADE / 3;
    lfo.osc.frequency.setTargetAtTime(Math.max(1e-4, rate), t, tc);
    lfo.gain.gain.setTargetAtTime(depth, t, tc);
    if (offset !== undefined) lfo.param.setTargetAtTime(offset, t, tc);
  }

  /** a param ramp that is always the same shape, so nothing anywhere steps */
  _to(param, value, seconds = XFADE) {
    param.setTargetAtTime(Number.isFinite(value) ? value : 0,
      this.ctx.currentTime, Math.max(0.02, seconds / 3));
  }

  // ----------------------------------------------------------- the noise ----

  /**
   * Seeded noise, and a determinism fix worth naming.
   *
   * The previous version filled this buffer from `arand()` — the *shared*
   * ambient stream. That stream is consumed in program order by everything from
   * spark velocities to which way a car turns at a junction, and `unlock()`
   * fires on the first pointer or key event, which is a wall-clock moment. So
   * two loads of the same URL pulled 96,000 draws out of the shared stream at
   * different points and every later draw in the whole program shifted. §11
   * calls that out by name ("determinism leaks... silently breaks shareable
   * URLs") and §7.3's pixel diff is exactly what it would have broken.
   *
   * A private stream costs nothing and removes the coupling entirely. The noise
   * is not part of the universe's shape, so it does not need the universe's
   * seed — it needs its own.
   */
  _makeNoise() {
    const sr = this.ctx.sampleRate;
    const len = Math.floor(sr * 4);
    const buf = this.ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const r = new RNG(hash(0x9051e, ch));
      for (let i = 0; i < len; i++) d[i] = r.next() * 2 - 1;
    }
    return buf;
  }

  /**
   * A generated impulse response.
   *
   * Exponentially decaying noise with a one-pole lowpass whose coefficient
   * *climbs with time*, so the tail darkens the way a real one does — air and
   * soft surfaces absorb the top of the spectrum first, and a reverb whose tail
   * stays as bright as its attack is the single most synthetic-sounding thing a
   * naive implementation produces.
   *
   * `early` adds discrete reflections in the first 80 ms at incommensurate
   * delays (no two a small-integer ratio apart, or they comb into a flutter
   * echo). The vast IR gets none, and that is physics rather than economy: the
   * long tail at the vacuum scales is standing in for *distance*, and distance
   * has no walls. §8's depth axis has no other instrument in this medium.
   *
   * Normalised to unit energy rather than unit peak, and `normalize` is turned
   * off on the convolver, so the wet level means the same thing whether the tail
   * is 1.4 s or 7 s. That is what lets `reverb.wet` be a single number the score
   * can set.
   */
  _makeIR(seconds, damping, early, salt) {
    const sr = this.ctx.sampleRate;
    const len = Math.max(64, Math.round(sr * seconds));
    const buf = this.ctx.createBuffer(2, len, sr);
    const ER = [0.0071, 0.0113, 0.0177, 0.0229, 0.0311, 0.0431, 0.0577, 0.0713];
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const r = new RNG(hash(0x1287, ch, salt));
      let lp = 0, energy = 0;
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        const env = irEnvelope(t, seconds);
        lp += ((r.next() * 2 - 1) - lp) * (1 - irDamp(i / len, damping));
        d[i] = lp * env;
      }
      if (early) {
        for (let k = 0; k < ER.length; k++) {
          const i = Math.round((ER[k] + (r.next() - 0.5) * 0.002) * sr);
          if (i < len) d[i] += (k % 2 ? -1 : 1) * 0.42 * Math.exp(-ER[k] * 11);
        }
      }
      for (let i = 0; i < len; i++) energy += d[i] * d[i];
      const norm = energy > 1e-12 ? 1 / Math.sqrt(energy) : 0;
      for (let i = 0; i < len; i++) d[i] *= norm;
    }
    return buf;
  }

  // ------------------------------------------------------------- the graph --

  /**
   * The whole topology, once.
   *
   *   pad ─┐
   *   shimmer ─┼─ padBus ─ toneLP ─┐
   *   bloom ─┘                     │
   *   arp / bell / blip ───────────┤
   *   air  ─ bandpass ─────────────┼─ voiceBus ─┬─ dry ──────────────────┐
   *   body ─ lowpass ──────────────┘            ├─ sendClose ─ convClose ─┤
   *                                             └─ sendVast  ─ convVast  ─┤
   *   sub ─ subLP ──────────────────────────────────────────────────────  ┼─ master ─ comp ─ out
   *
   * The sub bypasses both the tone filter and the reverb. Bass in a long tail
   * is mud, and the one voice that must stay defined is the one carrying the
   * world's gravity.
   */
  _build() {
    const c = this.ctx, q = this.q;

    this.master = this._gain(this.muted ? 0 : this.level);
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -24; comp.knee.value = 12; comp.ratio.value = 6;
    comp.attack.value = 0.02; comp.release.value = 0.4;
    this.master.connect(comp);
    comp.connect(c.destination);

    this.voiceBus = this._gain(1);
    this.dry = this._gain(1);
    this.voiceBus.connect(this.dry);
    this.dry.connect(this.master);

    this.convClose = c.createConvolver();
    this.convVast = c.createConvolver();
    this.convClose.normalize = false;
    this.convVast.normalize = false;
    this.sendClose = this._gain(0);
    this.sendVast = this._gain(0);
    this.voiceBus.connect(this.sendClose); this.sendClose.connect(this.convClose);
    this.voiceBus.connect(this.sendVast); this.sendVast.connect(this.convVast);
    this.convClose.connect(this.master);
    this.convVast.connect(this.master);

    // The two impulse responses are the only expensive thing here — roughly a
    // million samples of one-pole filtering — so they are built on the next
    // macrotask rather than inside the click handler. The sends are at zero
    // until they land, so there is nothing to click and nothing to hear
    // missing; the space simply arrives about a frame later than the notes.
    setTimeout(() => {
      if (!this.ctx) return;
      try {
        this.convClose.buffer = this._makeIR(q.irClose, 0.55, true, 1);
        this.convVast.buffer = this._makeIR(q.irVast, 0.30, false, 2);
        this._irReady = true;
        if (this.score) this._applyReverb(this.score);
      } catch (e) { console.warn('AEON: reverb unavailable —', e.message); }
    }, 0);

    // -- the tonal bus -------------------------------------------------------
    this.padBus = this._gain(1);
    this.toneLP = this._filter('lowpass', 1800, 0.62);
    this.padBus.connect(this.toneLP);
    this.toneLP.connect(this.voiceBus);

    // -- noise, and why there are two sources --------------------------------
    // A looping noise buffer has a period, and at four seconds the ear finds it
    // within a minute — which is the same failure §M1's gate calls out for the
    // cosmic web. Two copies of the same buffer at playback rates 1 and 1/√2
    // sum to something with no period at all, for the same reason two LFOs at
    // an irrational frequency ratio never re-align. It costs one extra node.
    this._noiseBuf = this._makeNoise();
    this.noiseBus = this._gain(0.5);
    for (const rate of [1, Math.SQRT1_2]) {
      const src = c.createBufferSource();
      src.buffer = this._noiseBuf; src.loop = true; src.playbackRate.value = rate;
      src.connect(this.noiseBus); src.start();
    }

    // -- air: the wind, and the starlight wash -------------------------------
    this.airBP = this._filter('bandpass', 520, 0.62);
    this.airGain = this._gain(0);
    this.noiseBus.connect(this.airBP); this.airBP.connect(this.airGain);
    this.airGain.connect(this.voiceBus);

    // -- body: swell, roar, rumble — one pair of nodes for all of them --------
    this.bodyLP = this._filter('lowpass', 300, 0.6);
    this.bodyGain = this._gain(0);
    this.noiseBus.connect(this.bodyLP); this.bodyLP.connect(this.bodyGain);
    this.bodyGain.connect(this.voiceBus);

    // -- the pad -------------------------------------------------------------
    // `WAVE_STEPS` wavetables cached at init, one per quantised warmth. Built
    // here rather than per score so a scale change never allocates.
    this.waves = [];
    for (let i = 0; i < WAVE_STEPS; i++) {
      const a = padPartials(i / (WAVE_STEPS - 1));
      const imag = new Float32Array(a.length);
      this.waves.push(c.createPeriodicWave(Float32Array.from(a), imag, { disableNormalization: false }));
    }
    this._waveIndex = -1;

    this.padGain = this._gain(0);
    this.padGain.connect(this.padBus);
    this.pad = { slots: [], osc: [] };
    for (let i = 0; i < q.padSlots; i++) {
      const g = this._gain(0);
      g.connect(this.padGain);
      const osc = [];
      for (let u = 0; u < q.unison; u++) {
        const o = this._osc(null, 220);
        o.setPeriodicWave(this.waves[2]);
        o.detune.value = q.unison === 1 ? 0 : (u === 0 ? -1 : 1) * 6;
        o.connect(g);
        osc.push(o);
        this.pad.osc.push(o);
      }
      this.pad.slots.push({ gain: g, osc });
    }

    // -- sub: the world's gravity, held under everything ---------------------
    this.subGain = this._gain(0);
    this.subLP = this._filter('lowpass', 160, 0.7);
    this.subLP.connect(this.subGain);
    this.subGain.connect(this.master);
    this.sub = { osc: [this._osc('sine', 55), this._osc('sine', 55.11)] };
    for (const o of this.sub.osc) o.connect(this.subLP);

    // -- shimmer: the top of the chord, breathing on its own clock -----------
    this.shimmerGain = this._gain(0);
    this.shimmerGain.connect(this.padBus);
    this.shimmer = [];
    for (let i = 0; i < q.shimmer; i++) {
      const o = this._osc('sine', 880);
      const g = this._gain(0);
      o.connect(g); g.connect(this.shimmerGain);
      this.shimmer.push({ osc: o, gain: g });
    }

    // -- bloom: the golden-hour layer, driven from outside -------------------
    this.bloomGain = this._gain(0);
    this.bloomGain.connect(this.padBus);
    this.bloom = [];
    for (let i = 0; i < 3; i++) {
      const o = this._osc('sine', 660);
      const g = this._gain(0.5 / (i + 1));
      o.connect(g); g.connect(this.bloomGain);
      this.bloom.push({ osc: o, gain: g });
    }
    this._bloomOn = false;
    this._swell = 0;

    // -- the LFOs ------------------------------------------------------------
    // Rates are `lfoBase × √p` for distinct primes p (`LFO_RATIOS`), so no two
    // of them ever come back into phase and the combined envelope is
    // quasi-periodic. That is the whole non-loopability argument for the
    // *continuous* motion; `score.js` owns it for the discrete motion.
    const r = LFO_RATIOS, b = 0.021;
    this.lfo = {
      cutoff: this._lfo(b * r[0], 300, this.toneLP.frequency, 1800),
      pad: this._lfo(b * r[1], 0.03, this.padGain.gain, 0),
      gust: this._lfo(b * r[2], 0.2, this.airGain.gain, 0),
      sweep: this._lfo(b * r[3], 160, this.airBP.frequency, 520),
      swell: this._lfo(b * r[4], 0.15, this.bodyGain.gain, 0),
      detune: this._lfo(b * r[5], 5, this.pad.osc[0].detune, 0),
    };
    // one detune LFO feeds every pad oscillator; the gain node is shared, so
    // this is one extra connection each rather than one extra oscillator each
    for (let i = 1; i < this.pad.osc.length; i++) this.lfo.detune.gain.connect(this.pad.osc[i].detune);
    for (let i = 0; i < this.shimmer.length; i++) {
      this.lfo['sh' + i] = this._lfo(b * r[(i + 2) % r.length] * 1.37, 0.01, this.shimmer[i].gain.gain, 0.01);
    }

    // -- the scheduler -------------------------------------------------------
    // A lookahead scheduler on `setInterval`, deliberately not on `rAF` and not
    // on the render loop: it must keep playing when the tab is hidden and the
    // frame loop has stopped, and it must never be a frame's problem.
    this._chordK = 0; this._arpK = 0; this._bellK = 0;
    this._chordAt = 0; this._arpAt = 0; this._bellAt = 0;
    this._timer = setInterval(() => { try { this._tick(); } catch { /* never take the page down */ } }, TICK_MS);
  }

  // ------------------------------------------------------------ the score ---

  /**
   * The world changed. Nothing is rebuilt — every number below is re-aimed at a
   * new target over `XFADE` seconds, and the pad glides to its new chord on the
   * next scheduler tick. That is the cross-fade §2.5 asks for.
   */
  setScale(kind, world) {
    if (!this.ctx) { this._pendingScale = [kind, world]; return; }
    const d = { ...(world || {}), kind, motion: this.motion };
    if (d.seed == null) d.seed = this.seed;
    if (d.keySeed == null) d.keySeed = d.seed;
    const key = [kind, d.seed, d.keySeed, d.type, d.mood, d.atmo, d.Teq,
      d.gravity, d.starTemp, d.hue, d.inhabited].join('|');
    if (this._scaleKey === key) return;
    this._scaleKey = key;
    this.score = deriveScore(d);
    this.current = { key, score: this.score };
    this._applyScore();
  }

  _applyScore() {
    const s = this.score;
    if (!s || !this.ctx) return;

    // The one discontinuity in the file. `setPeriodicWave` cannot be scheduled
    // and takes effect the instant it is called, so a wavetable swap is a step
    // in the waveform (the phase is continuous; the value is not). It is
    // quantised to five steps and only fires when a scale change lands on a
    // materially different warmth, which is a moment already covered by the
    // hyperzoom riser. Every other parameter here ramps.
    const wi = Math.round(clamp(s.warm, 0, 1) * (WAVE_STEPS - 1));
    if (wi !== this._waveIndex) {
      this._waveIndex = wi;
      for (const o of this.pad.osc) o.setPeriodicWave(this.waves[wi]);
    }

    const v = s.voices;
    this._to(this.padGain.gain, v.pad * TRIM.pad);
    this._to(this.subGain.gain, v.sub * TRIM.sub);
    this._to(this.shimmerGain.gain, v.shimmer * TRIM.shimmer);
    this._to(this.toneLP.frequency, s.cutoffHz);
    this._to(this.toneLP.Q, 0.62 + 0.5 * s.brightness);
    this._to(this.subLP.frequency, clamp(s.tonicHz * 3.2, 90, 320));

    // air and body: one pair of nodes carries wind, swell, roar and rumble, and
    // the score's table is what makes a lava world and an ocean world different
    // objects rather than different code paths
    this._to(this.airBP.frequency, s.air.centerHz);
    this._to(this.airBP.Q, s.air.q);
    this._to(this.airGain.gain, v.air * TRIM.air);
    this._to(this.bodyLP.frequency, s.body.lowpassHz);
    this._to(this.bodyLP.Q, s.body.q);
    this._to(this.bodyGain.gain, v.body * TRIM.body);

    for (let i = 0; i < this.pad.osc.length; i++) {
      const sign = this.q.unison === 1 ? 0 : (i % 2 === 0 ? -1 : 1);
      this._to(this.pad.osc[i].detune, sign * s.detuneCents * 0.5);
    }

    const b = s.lfoBase, r = LFO_RATIOS;
    this._aim(this.lfo.cutoff, b * r[0], s.cutoffHz * 0.22 * s.motion);
    this._aim(this.lfo.pad, b * r[1], v.pad * TRIM.padLfo * s.motion);
    this._aim(this.lfo.gust, b * r[2] + s.air.gustRate * 0.5, v.air * s.air.gustDepth * TRIM.air);
    this._aim(this.lfo.sweep, b * r[3] + s.air.gustRate * 0.3, s.air.centerHz * 0.34 * s.motion);
    this._aim(this.lfo.swell, s.body.swellRate, v.body * s.body.swellDepth * TRIM.body);
    this._aim(this.lfo.detune, b * r[5], 4 + 5 * s.warm * s.motion);
    for (let i = 0; i < this.shimmer.length; i++) {
      this._aim(this.lfo['sh' + i], b * r[(i + 2) % r.length] * 1.37, TRIM.shimmerOsc * s.motion, TRIM.shimmerOsc);
    }

    this._applyReverb(s);

    // Force the next tick to re-voice immediately rather than waiting out the
    // rest of a chord that can be half a minute long at the cosmic scale. `k`
    // is *not* reset — the piece continues; only the arrangement moved.
    //
    // `_retuning` makes that one chord glide over `XFADE` rather than over the
    // score's own `glide`, because this is the chord that may be crossing into
    // a different key: a dive from one star system to another is a modulation,
    // and a modulation taken at a chord-change speed is a lurch. It is cleared
    // by the chord that consumes it, so only the first one is slow.
    this._retune = true;
    this._retuning = true;
  }

  /**
   * The space. Two impulse responses, blended by the score's tail length, so
   * the room grows and shrinks continuously — you cannot swap a convolver's
   * buffer mid-flight without a click, but you can cross-fade two of them.
   */
  _applyReverb(s) {
    if (!this._irReady) return;
    const q = this.q;
    const t = reverbBlend(s.reverb.seconds, q.irClose, q.irVast);
    this._to(this.sendClose.gain, s.reverb.wet * (1 - t) * TRIM.wet);
    this._to(this.sendVast.gain, s.reverb.wet * t * TRIM.wet);
  }

  // -------------------------------------------------------- the scheduler ---

  _tick() {
    const s = this.score;
    if (!this.ctx || !s) return;
    const now = this.ctx.currentTime;
    const horizon = now + LOOKAHEAD;

    if (this._chordAt === 0) { this._chordAt = now + 0.05; this._arpAt = now + s.beat; this._bellAt = now + s.beat * 8; }
    if (this._retune) { this._retune = false; this._chordAt = Math.min(this._chordAt, now + 0.05); }

    // A hidden tab throttles `setInterval` to about 1 Hz and a suspended one
    // stops it entirely, so the schedule can wake up minutes behind. Rather
    // than catch up by firing hundreds of events into the past — which the
    // WebAudio clock would collapse into one instant — the counters skip
    // forward. The piece kept playing while you were away; you just did not
    // hear that part.
    this._chordAt = this._skip(this._chordAt, now, s.chordSeconds, 'chord');
    this._arpAt = this._skip(this._arpAt, now, s.beat * 2, 'arp');
    this._bellAt = this._skip(this._bellAt, now, s.beat * 18, 'bell');

    for (let guard = 0; this._chordAt < horizon && guard < 32; guard++) {
      const plan = chordPlan(s, this._chordK);
      this._issueChord(this._chordAt, plan);
      this._chordAt += Math.max(1.5, plan.seconds);
      this._chordK++;
    }
    if (this.q.arp) {
      for (let guard = 0; this._arpAt < horizon && guard < 64; guard++) {
        const n = arpNote(s, this._arpK);
        if (!n.rest && s.voices.arp > 0.01) this._pluck(this._arpAt, n.hz, n.vel * TRIM.arp, 2.4, 5.5);
        this._arpAt += Math.max(0.2, n.gap);
        this._arpK++;
      }
      for (let guard = 0; this._bellAt < horizon && guard < 32; guard++) {
        const n = bellNote(s, this._bellK);
        if (!n.rest && s.voices.bell > 0.01) this._pluck(this._bellAt, n.hz, n.vel * TRIM.bell, 5.5, 2.6);
        this._bellAt += Math.max(1, n.gap);
        this._bellK++;
      }
    }
  }

  _skip(at, now, step, which) {
    if (at >= now - 0.05) return at;
    const missed = Math.floor((now - at) / Math.max(step, 0.05));
    if (which === 'chord') this._chordK += missed;
    else if (which === 'arp') this._arpK += missed;
    else this._bellK += missed;
    return now;
  }

  /**
   * Move the pad to a chord. Every oscillator glides — `setTargetAtTime` on a
   * frequency is a portamento — so a chord change is a slow bend rather than a
   * step, and a *key* change on a scale dive is the same mechanism at a longer
   * time constant. There is no note-off anywhere in the pad; it never stops.
   */
  _issueChord(when, plan) {
    const s = this.score;
    const tc = Math.max(0.08, (this._retuning ? XFADE : s.glide) / 3);
    this._retuning = false;
    const n = plan.hz.length;
    for (let i = 0; i < this.pad.slots.length; i++) {
      const sl = this.pad.slots[i];
      const f = plan.hz[i];
      if (i < n && Number.isFinite(f) && f > 0) {
        for (const o of sl.osc) o.frequency.setTargetAtTime(f, when, tc);
        sl.gain.gain.setTargetAtTime(padTaper(i, n), when, tc);
      } else {
        sl.gain.gain.setTargetAtTime(0, when, tc);
      }
    }

    const subHz = clamp(hz(plan.root - 12), 24, 140);
    this.sub.osc[0].frequency.setTargetAtTime(subHz, when, tc * 1.6);
    // the second sub is detuned by a fixed *ratio*, so the beat rate stays
    // proportional to pitch instead of vanishing in the low register
    this.sub.osc[1].frequency.setTargetAtTime(subHz * 1.0022, when, tc * 1.6);

    for (let i = 0; i < this.shimmer.length; i++) {
      const f = plan.hz[Math.min(n - 1, n - 1 - i)] * (s.vacuum ? 4 : 2);
      if (Number.isFinite(f) && f > 0 && f < 12000) this.shimmer[i].osc.frequency.setTargetAtTime(f, when, tc * 2);
    }
    for (let i = 0; i < this.bloom.length; i++) {
      const f = plan.hz[Math.min(i, n - 1)] * 2;
      if (Number.isFinite(f) && f > 0 && f < 9000) this.bloom[i].osc.frequency.setTargetAtTime(f, when, tc * 2);
    }
  }

  /**
   * One plucked note — arpeggio, bell, blip, festival. A soft attack and a long
   * exponential tail, with a lowpass tracking the pitch so a high note is not
   * brighter than a low one. Three nodes, and they disconnect themselves on
   * `onended`: nothing here is ever polled, swept or garbage-collected by hand.
   */
  _pluck(when, freq, peak, dur, bright = 5) {
    if (!Number.isFinite(freq) || freq <= 0 || this.muted) return;
    const c = this.ctx;
    const t = Math.max(when, c.currentTime);
    const o = this._osc('sine', freq);
    const o2 = this._osc('sine', freq * 2.004);
    const g = this._gain(0);
    const f = this._filter('lowpass', clamp(freq * bright, 200, 11000), 0.9);
    const g2 = this._gain(0.22);
    o.connect(g); o2.connect(g2); g2.connect(g);
    g.connect(f); f.connect(this.padBus);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.014);
    g.gain.exponentialRampToValueAtTime(1e-4, t + dur);
    o.stop(t + dur + 0.05);
    o2.stop(t + dur + 0.05);
    o.onended = () => {
      for (const nd of [o, o2, g, g2, f]) { try { nd.disconnect(); } catch { /* gone */ } }
    };
  }

  // ------------------------------------------------------------ events ------

  /**
   * The hyperzoom riser. The noise sweep is the original and still carries the
   * movement; what is new is that it now sweeps *in key* — a pitched fifth
   * riding the noise, taken from the chord that is actually sounding, so a dive
   * is a musical gesture rather than an effect laid over one.
   */
  warp(direction = 'dive') {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const dive = direction === 'dive';
    const src = c.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true; src.start();
    const bp = this._filter('bandpass', dive ? 160 : 1800, 1.1);
    const g = this._gain(0);
    src.connect(bp); bp.connect(g); g.connect(this.voiceBus);
    bp.frequency.setValueAtTime(dive ? 160 : 1800, t);
    bp.frequency.exponentialRampToValueAtTime(dive ? 2400 : 120, t + 1.1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.36, t + 0.45);
    g.gain.linearRampToValueAtTime(0, t + 1.35);
    src.stop(t + 1.4);
    src.onended = () => { for (const nd of [src, bp, g]) { try { nd.disconnect(); } catch { /* gone */ } } };

    if (this.score) {
      const base = this.score.tonicHz * (dive ? 1 : 2);
      const o = this._osc('sine', base);
      const og = this._gain(0);
      o.connect(og); og.connect(this.voiceBus);
      o.frequency.exponentialRampToValueAtTime(dive ? base * 3 : base * 0.5, t + 1.1);
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(0.05, t + 0.5);
      og.gain.exponentialRampToValueAtTime(1e-4, t + 1.4);
      o.stop(t + 1.45);
      o.onended = () => { try { o.disconnect(); og.disconnect(); } catch { /* gone */ } };
    }
  }

  /**
   * The golden-hour layer.
   *
   * `surface.js` has called this since long before there was a score, handing
   * it a root frequency it derived itself. That call site is untouched and the
   * argument is now advisory: if a score exists, the bloom takes its chord from
   * the score so it cannot be in a different key from everything else, and the
   * root is used only as a fallback for a caller that arrives before any world
   * has been described. `surfaceSwell()` drives it; `surfaceScoreOff()` stops it.
   */
  surfaceScore(root = 146.8) {
    if (!this.ctx) { this._pendingScore = root; return; }
    this._bloomOn = true;
    this._bloomRoot = root;
    if (!this.score) {
      for (let i = 0; i < this.bloom.length; i++) {
        this.bloom[i].osc.frequency.setTargetAtTime(root * (i === 0 ? 2 : i === 1 ? 3 : 4), this.ctx.currentTime, 0.5);
      }
    }
  }

  /** drive it: swell 0..1 (golden-hour intensity), hush 0..1 (standing in a ruin) */
  surfaceSwell(swell, hush) {
    if (!this.ctx || !this._bloomOn) return;
    const target = clamp(swell * (1 - clamp(hush, 0, 1) * 0.82), 0, 1);
    // Called every frame from `surface.js`, so it must be cheap and must not
    // schedule. A dead band keeps it from writing an automation event per frame
    // for a value that has not meaningfully moved.
    if (Math.abs(target - this._swell) < 0.02) return;
    this._swell = target;
    this.bloomGain.gain.setTargetAtTime(target * TRIM.bloom, this.ctx.currentTime, 0.7);
    // the light opens the filter as well as the chord — §9.7's golden hour, in
    // the one place the score gets to agree with the grade
    if (this.score) {
      this.toneLP.frequency.setTargetAtTime(this.score.cutoffHz * (1 + 0.35 * target),
        this.ctx.currentTime, 0.9);
    }
  }

  surfaceScoreOff() {
    this._pendingScore = null;
    if (!this.ctx) return;
    this._bloomOn = false;
    this._swell = 0;
    this.bloomGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.5);
  }

  /**
   * A festival bell. `festival.js` passes a frequency derived from the old
   * per-world root; it is pulled onto this world's scale so a festival on a
   * Phrygian world rings in Phrygian. The call site does not change.
   */
  festivalBell(root = 261.6) {
    if (!this.ctx || this.muted) return;
    const f = this.score ? snapToScale(this.score, root) : root;
    this._pluck(this.ctx.currentTime, f, 0.06, 2.8, 3.2);
  }

  /** soft ping when something is selected — also in key */
  blip() {
    if (!this.ctx || this.muted) return;
    const f = this.score ? snapToScale(this.score, 740) : 740;
    this._pluck(this.ctx.currentTime, f, 0.085, 0.5, 6);
  }
}
