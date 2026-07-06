// The sound of the universe, synthesized from nothing.
//
// No samples, no files: every scale gets a bed of oscillators, filtered
// noise and slow LFOs — a deep two-tone drone for the cosmic web, an airy
// shimmer inside galaxies, a warm hum for star systems, a breathing sub for
// the black hole, and wind shaped by each world's actual atmosphere on its
// surfaces. Hyperzooms get a riser; selections get a soft blip. The whole
// thing idles near silence — it is felt more than heard.

export class Ambience {
  constructor() {
    this.ctx = null;
    this.beds = new Map();
    this.current = null;
    this.muted = localStorage.getItem('aeon-mute') === '1';
    this.level = 0.24;
    this._pendingScale = null;
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
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
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
    } else if (kind === 'surface') {
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
      if (type === 'lava') {
        const r = keep(this._noise());
        const rlp = keep(this._filter('lowpass', 55, 1.2));
        const rg = keep(this._gain(0.5));
        r.connect(rlp); rlp.connect(rg); rg.connect(out);
        keep(...this._lfo(0.19, 0.22, rg.gain, 0.5));
      }
    }
    return { out, nodes };
  }

  setScale(kind, world) {
    if (!this.ctx) { this._pendingScale = [kind, world]; return; }
    const key = kind + '|' + (world?.type ?? '') + '|' + (world?.atmo?.toFixed?.(2) ?? '');
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
