// The sound of the universe, synthesized from nothing.
//
// No samples, no files: every scale gets a bed of oscillators, filtered
// noise and slow LFOs — a deep two-tone drone for the cosmic web, an airy
// shimmer inside galaxies, a warm hum for star systems, a breathing sub for
// the black hole, and wind shaped by each world's actual atmosphere on its
// surfaces. Hyperzooms get a riser; selections get a soft blip. The whole
// thing idles near silence — it is felt more than heard.

// Each resonance's score: [frequency, amplitude, waveform, breath-rate] per
// partial. Tuned quiet — these sit under the wind, not over it.
import { arand } from './rng.js';
import { Score } from './score.js';

const MOOD_SCORES = {
  counsel: [[73.4, 0.10, 'sawtooth', 0.028], [110, 0.06, 'sine', 0.041]],                       // D–A, monumental
  wanderers: [[261.6, 0.028, 'sine', 0.05], [329.6, 0.022, 'sine', 0.062], [392, 0.02, 'sine', 0.043], [587.3, 0.012, 'sine', 0.071]], // Cmaj add9 shimmer
  chrome: [[110, 0.07, 'triangle', 0.033], [130.8, 0.05, 'triangle', 0.047], [164.8, 0.04, 'triangle', 0.058], [246.9, 0.02, 'sine', 0.07]], // Am9, nocturne
  afternoon: [[146.8, 0.06, 'sine', 0.024], [147.9, 0.06, 'sine', 0.031]],                       // detuned unison hush
  pale: [[220, 0.025, 'sine', 0.055], [277.2, 0.02, 'sine', 0.066], [440, 0.01, 'sine', 0.08]],  // chalk pastel
  gold: [[146.8, 0.05, 'sine', 0.04], [220, 0.035, 'sine', 0.052], [246.9, 0.02, 'sine', 0.063], [329.6, 0.014, 'sine', 0.075]], // D pentatonic dunes
  vault: [[98, 0.05, 'sine', 0.021], [196, 0.02, 'sine', 0.034]],                                 // bare octave
  winterlight: [[880, 0.012, 'sine', 0.019], [1318.5, 0.007, 'sine', 0.027]],                     // two high, far apart
  greenshade: [[196, 0.04, 'sine', 0.045], [246.9, 0.03, 'sine', 0.055], [293.7, 0.024, 'sine', 0.065]], // G major, overgrown
  searemembers: [[87.3, 0.08, 'sine', 0.026], [130.8, 0.05, 'sine', 0.038]],                      // F–C tide
  forge: [[55, 0.10, 'sawtooth', 0.05], [58.3, 0.07, 'sawtooth', 0.062]],                         // minor-second rub
  procession: [[65.4, 0.07, 'sine', 0.02], [98, 0.045, 'sine', 0.03]],                            // slow giants
};

export class Ambience {
  constructor() {
    this.ctx = null;
    this.beds = new Map();
    this.current = null;
    this.muted = localStorage.getItem('aeon-mute') === '1';
    this.level = 0.24;
    this._pendingScale = null;
    /** `?score=1`'s derived score, or null — see `beginScore` */
    this.derived = null;
    this._pendingDerived = null;
  }

  /** must be called from a user gesture (autoplay policy) */
  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : this.level;
      const comp = this.ctx.createDynamicsCompressor();
      comp.threshold.value = -28; comp.ratio.value = 8;
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      this._noiseBuf = this._makeNoise();
      if (this._pendingScale) this.setScale(...this._pendingScale);
      if (this._pendingScore != null) { const r = this._pendingScore; this._pendingScore = null; this.surfaceScore(r); }
      if (this._pendingDerived) { const d = this._pendingDerived; this._pendingDerived = null; this.beginScore(...d); }
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

  _makeNoise() {
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = arand() * 2 - 1;
    return buf;
  }

  _noise() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuf; src.loop = true; src.start();
    return src;
  }
  _osc(type, freq) {
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq; o.start();
    return o;
  }
  _lfo(freq, depth, param, offset = null) {
    const o = this._osc('sine', freq);
    const g = this.ctx.createGain(); g.gain.value = depth;
    o.connect(g); g.connect(param);
    if (offset !== null) param.value = offset;
    return [o, g];
  }
  _gain(v) { const g = this.ctx.createGain(); g.gain.value = v; return g; }
  _filter(type, freq, q = 0.9) {
    const f = this.ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    return f;
  }

  // -------------------------------------------------------------- beds ----
  _buildBed(key, kind, world) {
    const c = this.ctx;
    const out = this._gain(0);
    out.connect(this.master);
    const nodes = [out];
    const keep = (...ns) => { nodes.push(...ns); return ns[0]; };

    if (kind === 'cosmic') {
      // the void: two barely-detuned deep sines, beating once per ~8s
      const a = keep(this._osc('sine', 52));
      const b = keep(this._osc('sine', 52.13));
      const g = keep(this._gain(0.5));
      a.connect(g); b.connect(g); g.connect(out);
      const n = keep(this._noise());
      const lp = keep(this._filter('lowpass', 90));
      const ng = keep(this._gain(0.05));
      n.connect(lp); lp.connect(ng); ng.connect(out);
    } else if (kind === 'galaxy') {
      // starlight wash: swept bandpass air + faint inharmonic shimmer
      const n = keep(this._noise());
      const bp = keep(this._filter('bandpass', 340, 0.7));
      const ng = keep(this._gain(0.16));
      n.connect(bp); bp.connect(ng); ng.connect(out);
      keep(...this._lfo(0.043, 130, bp.frequency, 340));
      for (const [f, amp] of [[721, 0.012], [1082, 0.009], [1519, 0.006]]) {
        const o = keep(this._osc('sine', f));
        const og = keep(this._gain(0));
        o.connect(og); og.connect(out);
        keep(...this._lfo(0.05 + f * 1e-5, amp, og.gain, amp));
      }
    } else if (kind === 'system') {
      // machinery of orbits: warm detuned triads, very low
      const a = keep(this._osc('triangle', 110));
      const b = keep(this._osc('triangle', 110.8));
      const lp = keep(this._filter('lowpass', 260));
      const g = keep(this._gain(0.16));
      a.connect(lp); b.connect(lp); lp.connect(g); g.connect(out);
      keep(...this._lfo(0.07, 0.05, g.gain, 0.16));
    } else if (kind === 'blackhole') {
      // the maw: beating subs + a slow breathing roar
      const a = keep(this._osc('sine', 36));
      const b = keep(this._osc('sine', 33.4));
      const g = keep(this._gain(0.65));
      a.connect(g); b.connect(g); g.connect(out);
      const n = keep(this._noise());
      const lp = keep(this._filter('lowpass', 220, 1.4));
      const ng = keep(this._gain(0.1));
      n.connect(lp); lp.connect(ng); ng.connect(out);
      keep(...this._lfo(0.06, 160, lp.frequency, 260));
      keep(...this._lfo(0.11, 0.06, ng.gain, 0.1));
    } else if (kind === 'surface' || kind === 'clouds' || kind === 'planet') {
      const atmo = world?.atmo ?? 1;
      const type = world?.type ?? '';
      // wind, thickness set by the actual atmosphere
      const n = keep(this._noise());
      const lp = keep(this._filter('lowpass', 140 + 420 * atmo, 0.6));
      const ng = keep(this._gain(0.10 + 0.2 * atmo));
      n.connect(lp); lp.connect(ng); ng.connect(out);
      keep(...this._lfo(0.09, 90 * atmo, lp.frequency, 140 + 420 * atmo)); // gusts
      keep(...this._lfo(0.031, 0.07 * atmo, ng.gain, 0.10 + 0.2 * atmo));
      if (type === 'ocean' || type === 'terrestrial') {
        // long swells breaking somewhere below
        const w = keep(this._noise());
        const wlp = keep(this._filter('lowpass', 480, 0.5));
        const wg = keep(this._gain(0));
        w.connect(wlp); wlp.connect(wg); wg.connect(out);
        keep(...this._lfo(0.08, 0.085, wg.gain, 0.09));
      }
      if (type === 'gas giant' || type === 'ice giant') {
        // deep atmosphere: heavier wind + a sub-band groan
        const s = keep(this._osc('sine', 44));
        const sg = keep(this._gain(0.22));
        s.connect(sg); sg.connect(out);
        keep(...this._lfo(0.05, 0.12, sg.gain, 0.22));
      }
      if (type === 'lava') {
        const r = keep(this._noise());
        const rlp = keep(this._filter('lowpass', 55, 1.2));
        const rg = keep(this._gain(0.5));
        r.connect(rlp); rlp.connect(rg); rg.connect(out);
        keep(...this._lfo(0.19, 0.22, rg.gain, 0.5));
      }
      // the resonance scores the world: each mood carries its own slow
      // chord of partials, breathing on long LFOs — felt more than heard
      const score = MOOD_SCORES[world?.mood];
      if (score) {
        for (const [freq, amp, type2, rate] of score) {
          const o = keep(this._osc(type2 ?? 'sine', freq));
          const lp = keep(this._filter('lowpass', Math.max(freq * 2.2, 200)));
          const og = keep(this._gain(0));
          o.connect(lp); lp.connect(og); og.connect(out);
          keep(...this._lfo(rate ?? 0.05, amp, og.gain, amp));
        }
      }
    }
    return { out, nodes };
  }

  setScale(kind, world) {
    if (!this.ctx) { this._pendingScale = [kind, world]; return; }
    const key = kind + '|' + (world?.type ?? '') + '|' + (world?.atmo?.toFixed?.(2) ?? '') + '|' + (world?.mood ?? '');
    if (this.current?.key === key) return;
    const t = this.ctx.currentTime;
    if (this.current) {
      this.current.bed.out.gain.cancelScheduledValues(t);
      this.current.bed.out.gain.setTargetAtTime(0, t, 0.8);
    }
    let bed = this.beds.get(key);
    if (!bed) { bed = this._buildBed(key, kind, world); this.beds.set(key, bed); }
    bed.out.gain.cancelScheduledValues(t);
    bed.out.gain.setTargetAtTime(1, t, 1.2);
    this.current = { key, bed };
  }

  // ------------------------------------------------------------ events ----
  /** hyperzoom riser: a filtered rush that climbs on dives, falls on ascents */
  warp(direction = 'dive') {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const n = this._noise();
    const bp = this._filter('bandpass', direction === 'dive' ? 160 : 1800, 1.1);
    const g = this._gain(0);
    n.connect(bp); bp.connect(g); g.connect(this.master);
    const f0 = direction === 'dive' ? 160 : 1800;
    const f1 = direction === 'dive' ? 2400 : 120;
    bp.frequency.setValueAtTime(f0, t);
    bp.frequency.exponentialRampToValueAtTime(f1, t + 1.1);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.45);
    g.gain.linearRampToValueAtTime(0, t + 1.35);
    setTimeout(() => { n.stop(); n.disconnect(); bp.disconnect(); g.disconnect(); }, 1600);
  }

  /**
   * The living surface score: a warm chord that lives above the wind and
   * breathes with the light — swelling as the sun rides the horizon (the
   * golden hour), falling to a hush when you stand within a ruin's memory.
   * Built once per world root, driven each frame by surfaceSwell().
   */
  surfaceScore(root = 146.8) {
    if (!this.ctx) { this._pendingScore = root; return; }
    if (this._score) this.surfaceScoreOff();
    const out = this._gain(0);
    out.connect(this.master);
    const nodes = [];
    // a gentle add-9 chord: root, fifth, octave, ninth — detuned to shimmer
    const ratios = [1, 1.5, 2, 2.25, 3];
    const amps = [0.06, 0.045, 0.03, 0.02, 0.012];
    ratios.forEach((rt, i) => {
      for (const det of [-0.4, 0.4]) {
        const o = this._osc(i < 2 ? 'triangle' : 'sine', root * rt + det);
        const g = this._gain(amps[i] * 0.5);
        o.connect(g); g.connect(out);
        nodes.push(o, g);
        const [lo, lg] = this._lfo(0.03 + i * 0.011, amps[i] * 0.3, g.gain, amps[i] * 0.5);
        nodes.push(lo, lg);
      }
    });
    // a far, high bell shimmer for the top of the swell
    const bell = this._osc('sine', root * 6);
    const bellF = this._filter('lowpass', root * 8, 1.2);
    const bellG = this._gain(0);
    bell.connect(bellF); bellF.connect(bellG); bellG.connect(out);
    nodes.push(bell, bellF, bellG);
    const [blo, blg] = this._lfo(0.07, 0.006, bellG.gain, 0.007);
    nodes.push(blo, blg);
    this._score = { out, nodes };
  }

  /** drive the score: swell 0..1 (golden-hour intensity), hush 0..1 (ruin) */
  surfaceSwell(swell, hush) {
    if (!this._score) return;
    const t = this.ctx.currentTime;
    const target = Math.max(0, swell * (1 - hush * 0.82));
    this._score.out.gain.setTargetAtTime(target, t, 0.7);
  }

  // ------------------------------------------------------- the derived ----
  //
  // `?score=1` — `src/score.js` instead of the chord above. Same context, same
  // master, same mute, so the two are interchangeable at the call site and the
  // rest of the mix does not learn which one is playing.
  //
  // The chord above is a good chord and it is the same chord on every world:
  // an add-9 on a root the seed transposed. What replaces it is an open pipe
  // whose pitch is the speed of sound in *this* air, whose timbre is the star's
  // own Planck curve read at the pipe's harmonics, whose reverb is a ray budget
  // over the actual ground, and whose tempo is the gait clock. Both are kept
  // until the derived one has been heard on enough worlds to retire the other
  // (§7.4: flipping the default is a separate commit).

  /** stand the derived score up for a world. Silent until `unlock()`. */
  beginScore(world, tier = 1) {
    if (!this.ctx) { this._pendingDerived = [world, tier]; return; }
    if (this.derived) this.endScore();
    this.derived = new Score({
      seed: world?.seed ?? 0, context: this.ctx, destination: this.master, tier,
    });
    this.derived.start();
    this.derived.update(world, 13.5, 0.016, 0);
  }

  /**
   * Per frame. `hush` is the ruin duck the hand-written score already had — it
   * is a property of where you are standing rather than of the world, so it
   * rides on the outside as a level rather than entering the voicing.
   */
  updateScore(world, sunElevDeg, dt, t, hush = 0) {
    if (!this.derived) return;
    this.derived.levelScale = 1 - 0.82 * (hush ?? 0);
    this.derived.update(world, sunElevDeg, dt, t);
  }

  endScore() {
    if (!this.derived) { this._pendingDerived = null; return; }
    const s = this.derived;
    this.derived = null;
    s.stop();
    setTimeout(() => { try { s.dispose(); } catch { /* torn down */ } }, 2600);
  }

  surfaceScoreOff() {
    if (!this._score) { this._pendingScore = null; return; }
    const s = this._score; this._score = null;
    const t = this.ctx.currentTime;
    s.out.gain.setTargetAtTime(0, t, 0.5);
    setTimeout(() => {
      for (const n of s.nodes) { try { n.stop?.(); } catch { /* gains */ } try { n.disconnect(); } catch { /* done */ } }
      try { s.out.disconnect(); } catch { /* done */ }
    }, 1400);
  }

  /** a festival bell: a soft struck tone from a pentatonic scale, ringing out */
  festivalBell(root = 261.6) {
    if (!this.ctx || this.muted) return;
    const c = this.ctx, t = c.currentTime;
    const scale = [1, 1.125, 1.25, 1.5, 1.667, 2];
    const f = root * scale[(arand() * scale.length) | 0];
    const o = this._osc('sine', f);
    const o2 = this._osc('sine', f * 2.01);
    const g = this._gain(0);
    o.connect(g); o2.connect(g); g.connect(this.master);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.08, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    setTimeout(() => { o.stop(); o2.stop(); o.disconnect(); o2.disconnect(); g.disconnect(); }, 2600);
  }

  /** soft ping when something is selected */
  blip() {
    if (!this.ctx) return;
    const c = this.ctx, t = c.currentTime;
    const o = this._osc('sine', 740);
    const g = this._gain(0);
    o.connect(g); g.connect(this.master);
    o.frequency.exponentialRampToValueAtTime(495, t + 0.09);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    setTimeout(() => { o.stop(); o.disconnect(); g.disconnect(); }, 400);
  }
}
