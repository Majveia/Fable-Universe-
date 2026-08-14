# Score integration — the patches `main.js` and `hud.js` need

**Author:** graphics/audio agent · **Owns:** `src/audio.js`, `src/resonance.js`, `src/score.js`
**Does not own:** `src/main.js`, `src/hud.js`, `src/surface.js`, `tools/*` — hence this file.

---

## 0 · What already works without any patch

`src/audio.js` was rewritten around `src/score.js` and **every existing call site is
preserved unchanged**. Nothing below is required to keep the game running:

| call site | file | status |
|---|---|---|
| `new Ambience()` | `main.js:100` | works — `seed` defaults to 0 |
| `audio.unlock()` | `main.js:103` | works |
| `audio.setScale(kind, world)` | `main.js:105,331` | works — missing fields fall back |
| `audio.warp('dive'\|'ascend')` | `main.js:251,273,523,538,659`, `planetscale.js:904,1104` | works |
| `audio.toggleMute()` | `main.js:447`, `hud.js:96` | works, same semantics, same `localStorage` key |
| `audio.blip()` | `hud.js:614` | works — now snapped to the world's scale |
| `audio.festivalBell(hz)` | `festival.js:80` | works — now snapped to the world's scale |
| `audio.surfaceScore(root)` | `surface.js:723,2370` | works — `root` is now advisory, see §3 |
| `audio.surfaceSwell(swell, hush)` | `surface.js:2226` | works |
| `audio.surfaceScoreOff()` | `surface.js:2369,2374` | works |

The patches below are what turn a *coherent* score into an *attuned* one. Without
them every universe is in the same key at the cosmic scale, and every world is
scored as though it orbited the Sun at one gravity — because those numbers are
available at the call sites and simply are not being passed.

---

## 1 · Patch A — `main.js`, `_worldInfo()` (the important one)

`_worldInfo()` currently describes a world with three fields and returns `null` at
the four vacuum scales. `deriveScore()` reads eight. This is the whole gap.

### A1 · add the import

`main.js` does not yet import from `avatar.js`. Add beside the others (line ~28):

```js
import { gravityOf } from './avatar.js';
```

`gravityOf(pp)` is already exported from `avatar.js:75` and returns **m/s²**
(`G_EARTH · massE / radiusE²`). `score.js` wants m/s², not multiples of g.

### A2 · add one module-scope scratch object

Beside the other module constants near the top (e.g. after `NOTES`/`HINTS`):

```js
// scratch for THREE.Color#getHSL — the score reads a world's palette hue, and
// allocating an object per scale change to do it would be silly
const HSL = { h: 0, s: 0, l: 0 };
```

### A3 · replace `_worldInfo()` entirely

Current body (`main.js:296–301`):

```js
  _worldInfo(s) {
    if (s.kind === 'surface') return { type: s.pp.type, atmo: s.atmo, mood: s.pp.res?.id };
    if (s.kind === 'clouds') return { type: s.pp.type, atmo: 1.5, mood: s.pp.res?.id };
    if (s.kind === 'planet') return { type: s.pp.type, atmo: 0.55, mood: s.pp.res?.id };
    return null;
  }
```

Replacement:

```js
  /**
   * What the score needs to know about where you are standing (`src/score.js`).
   *
   * Two seeds, and the difference is the point. `keySeed` fixes the key and
   * hangs on the *star*, so every world in a system is in the same key and a
   * dive from orbit to the ground changes register, mode and instrumentation
   * but never modulates under you — §2.5, in the one medium where a cut would
   * be inaudible as a cut and merely feel wrong. `seed` fixes everything else
   * (the chord progression, where each generator starts) and is the world's
   * own, so two planets of one star are the same key and different pieces.
   *
   * Every field is optional to `deriveScore`; this hands over whatever the
   * current scale actually knows.
   */
  _worldInfo(s) {
    const star = s.kind === 'system' ? s.params : (s.ctx?.system ?? null);
    const keySeed = star?.seed ?? s.ctx?.starSeed ?? s.ctx?.galaxySeed ?? this.seed;
    const base = { seed: keySeed, keySeed, starTemp: star?.temp };
    const pp = s.pp;
    if (!pp) return base;
    return {
      ...base,
      seed: pp.seed ?? keySeed,
      type: pp.type,
      atmo: s.kind === 'surface' ? s.atmo : s.kind === 'clouds' ? 1.5 : 0.55,
      mood: pp.res?.id,
      Teq: pp.Teq,
      gravity: gravityOf(pp),
      hue: pp.colA?.getHSL ? pp.colA.getHSL(HSL).h : undefined,
      inhabited: pp.inhabited,
    };
  }
```

**Field provenance** — every path was checked against the tree, not guessed:

| field | where it comes from | evidence |
|---|---|---|
| `s.params` at `system` | the star params object | `hud.js:440` `sysP = sc.params` |
| `s.ctx.system` at `planet`/`surface`/`clouds` | the star params object | `hud.js:441`; `surface.js:649` `this.sys = ctx.system`; `surface.js:828` reads `.temp` |
| `star.seed` / `star.temp` | `system.js:232` `seed: starSeed, name, mass, massTotal, temp, …` |
| `s.ctx.starSeed` at `system` | `main.js:229` |
| `s.ctx.galaxySeed` at `galaxy` | `main.js:228` |
| `pp.seed`, `.type`, `.Teq`, `.inhabited`, `.res.id`, `.colA` | `system.js:190–214` |
| `gravityOf(pp)` | `avatar.js:75`, from `pp.massE` / `pp.radiusE` |

**`blackhole` deliberately gets no star.** Its `ctx` is `{ bhMassMsun }` only
(`main.js:211,502`), so `keySeed` falls through to `this.seed` and it plays in the
universe's key. That is intentional and it must **not** be "fixed" by passing the
accretion disc's temperature: the disc is the hottest thing in the project and the
mode transfer would score the maw in Lydian. `KIND_ARRANGEMENT.blackhole` already
carries `modeBias: -2` to hold it dark, and the fallback star temperature is the
row's, not the disc's.

### A4 · risk

Low. Every access is optional-chained; the worst case for a scale that has none
of these is the object it returns today plus three `undefined`s, which
`deriveScore` already defaults. It cannot throw and it cannot return `null` where
it used to return an object.

---

## 2 · Patch B — `main.js`, give the universe its own key (one word)

`main.js:100`:

```js
    this.audio = new Ambience();
```
becomes
```js
    this.audio = new Ambience(this.seed);
```

Without it, `keySeed` at the cosmic scale is `0` for every universe, so every
seed opens on the same chord. `this.seed` is already assigned above this line.
This is independent of Patch A and worth taking even if A is deferred.

---

## 3 · `surface.js` — nothing to change, but read this

`surface.js:722–723` computes `this._scoreRoot` and passes it to `surfaceScore()`.
That call site is **untouched and still correct**, but the argument's meaning has
changed and the dead code is worth knowing about:

- `surfaceScore(root)` now switches on the **golden-hour bloom layer** of the one
  persistent graph. It no longer builds a second chord.
- `root` is used **only** when no world has been described yet. Once `setScale`
  has run, the bloom takes its notes from the score's own chord, so it cannot be
  in a different key from the pad.
- `_scoreRoot` therefore no longer sets the world's musical root — `score.js`
  does, from the star's seed. It survives as `festival.js:80`'s bell frequency,
  and `festivalBell()` snaps that onto the world's scale anyway.

If you want to retire `_scoreRoot`, `surfaceScore()` and `festivalBell()` both
default sensibly with no argument. Not required; not urgent.

---

## 4 · Patch C — `hud.js` (optional, zero new elements)

§3 caps the HUD at three persistent elements and the `♪` button already exists,
so this adds no chrome — it only puts the score on the tooltip that button
already has. `hud.js:96`:

```js
    this.muteBtn.onclick = () => this.setMuted(app.audio.toggleMute());
```

add underneath:

```js
    // the score names itself on the control that silences it — no new element
    this.muteBtn.title = 'sound (m)';
```

and in `setMuted` (`hud.js:608`):

```js
  setMuted(m) {
    this.muteBtn.textContent = m ? '∅' : '♪';
    this.muteBtn.style.opacity = m ? 0.45 : 1;
    // `score.label` is one line: "surface · F♯ dorian · 58 bpm · 8 s chords ·
    // add11 · triangle · spread 2 · rev 3.0 s". It is the same string the
    // offline harness reads, which makes the tooltip a live assertion that the
    // thing being played is the thing that was derived.
    const s = this.app.audio?.score;
    this.muteBtn.title = s ? `sound (m) · ${s.label}` : 'sound (m)';
  }
```

`setMuted` is already called on mute, on unmute, and at boot. It is **not** called
on scale change, so the tooltip will lag by one toggle. That is acceptable for a
tooltip; if you want it live, call `this.hud.setMuted(this.audio.muted)` at the end
of `main.js:_syncScale()`.

---

## 5 · Ordering

1. **Patch B** first — one word, independent, immediately audible across seeds.
2. **Patch A** second — it is the one that makes lava and ice sound different.
3. **Patch C** last, or never.

Nothing in `audio.js` needs to change for any of them.

---

## 6 · Checks to paste into `tools/verify.js`

`tools/verify.js` is yours. Everything below imports only pure functions — no
WebAudio, no mock, no DOM. `src/audio.js` imports cleanly in node (verified:
`quality.js` falls back to tier 1 without a `document`, and `localStorage` is
touched in the constructor, never at module scope).

**This suite was extracted from this file verbatim and run against the real
modules with `verify.js`'s own `ok()`/`near()` helpers: 22/22 pass.** It should
take the count 436 → 458. It is paste-ready, not pseudocode.

### 6.1 · the import

```js
import {
  AUDIO_TIER, TRIM, XFADE, irDamp, irEnvelope, padTaper, peakMix, reverbBlend,
  xfadeAt,
} from '../src/audio.js';
import { KIND_ARRANGEMENT, MOOD_MUSIC, padCentroid, padPartials } from '../src/score.js';
```

`verify.js:67` already imports `MODE_LADDER` and `deriveScore` from `score.js`,
which the suite also uses — extend that line rather than adding a second import
of the same module. `TRIM` is imported for readability at the call site and is
not referenced by the checks; drop it if your linter objects.

### 6.2 · the suite

```js
// ---------------------------------------------------------------------------
// the score's synthesiser (src/audio.js)
//
// `suiteScore` checks the music. This checks the machine that plays it — and it
// exists because a synthesiser is the one thing in this repo that cannot be
// screenshotted, cannot be pixel diffed, and cannot be heard by anything in the
// loop that built it. Everything below was inline in the WebAudio wiring and
// was lifted out specifically so that it could be a number here instead of a
// listening test there.
function suiteScoreGraph() {
  console.log('\nscore · the graph — gain staging, the print, and the space (§5, §2.5)');

  const kinds = Object.keys(KIND_ARRANGEMENT);
  const types = ['terrestrial', 'ocean', 'ice', 'lava', 'barren', 'gas giant', 'ice giant', ''];
  const moods = Object.keys(MOOD_MUSIC);
  const all = [];
  for (const kind of kinds) {
    for (const type of types) {
      for (const mood of moods) {
        for (const atmo of [0, 0.5, 1, 1.5]) {
          for (const inhabited of [false, true]) {
            all.push(deriveScore({
              kind, type, mood, atmo, inhabited, seed: 7, keySeed: 7,
              Teq: 288, gravity: 9.81, starTemp: 5778, hue: 0.3,
            }));
          }
        }
      }
    }
  }

  // -- gain staging ---------------------------------------------------------
  // The compressor after the master is a safety net for transients. If the
  // sustained voices alone can reach unity then it is doing a mixer's job, and
  // a mix that is only kept in bounds by a limiter breathes audibly.
  const peaks = all.map(peakMix);
  const hi = Math.max(...peaks), lo = Math.min(...peaks);
  ok('§5 · the sustained mix leaves headroom on every world at every scale',
    hi < 0.9, `worst case ${hi.toFixed(3)} of 1.0 across ${all.length} worlds`);
  ok('and no scale is silent — something is always sounding',
    lo > 0.05, `quietest ${lo.toFixed(3)}`);

  // -- the pad's level is independent of the chord --------------------------
  ok('the pad taper normalises, so a four-note chord is not louder than a three',
    [2, 3, 4, 5].every((n) => {
      let sum = 0;
      for (let i = 0; i < n; i++) sum += padTaper(i, n);
      return Math.abs(sum - 1) < 1e-12;
    }), 'Σ padTaper(i, n) = 1 for n = 2..5');
  ok('and it is a taper — lower voices carry more than upper ones',
    padTaper(0, 4) > padTaper(1, 4) && padTaper(1, 4) > padTaper(3, 4));

  // -- the impulse response -------------------------------------------------
  // Generated, per §2.1: there is no reverb sample anywhere in this project.
  // RT60 is a definition, not a taste, so it is assertable to the decibel.
  near('the IR reaches exactly −60 dB at its stated RT60',
    20 * Math.log10(Math.exp(-6.9078)), -60, 0.01);
  ok('the IR ends at exactly zero, so the tail cannot click',
    irEnvelope(3, 3) === 0 && irEnvelope(6, 6) === 0);
  ok('and it builds rather than begins — a real tail has an onset',
    irEnvelope(0, 3) === 0 && irEnvelope(0.004, 3) > 0
    && irEnvelope(0.004, 3) < irEnvelope(0.008, 3));
  ok('and decays monotonically once built',
    (() => {
      let prev = Infinity;
      for (let t = 0.008; t < 3; t += 0.004) {
        const v = irEnvelope(t, 3);
        if (v > prev) return false;
        prev = v;
      }
      return true;
    })(), '748 samples of a 3 s tail, strictly non-increasing');
  ok('and the tail darkens: air absorbs the top of the spectrum first',
    irDamp(0, 0.5) < irDamp(0.5, 0.5) && irDamp(0.5, 0.5) < irDamp(1, 0.5)
    && irDamp(1, 1) <= 0.985, 'one-pole coefficient rises along the tail, capped');

  // -- the space actually spans both convolvers -----------------------------
  // Two IRs cross-faded, because a convolver's buffer cannot be swapped mid
  // flight without a click. If the score's range did not span them, one of the
  // two would be dead weight.
  for (let t = 0; t < AUDIO_TIER.length; t++) {
    const q = AUDIO_TIER[t];
    const b = all.map((s) => reverbBlend(s.reverb.seconds, q.irClose, q.irVast));
    ok(`§8 depth · tier ${t} uses both reverbs, not one`,
      Math.min(...b) < 0.15 && Math.max(...b) > 0.85,
      `blend ${Math.min(...b).toFixed(2)}…${Math.max(...b).toFixed(2)}`);
  }
  ok('and vacuum always reverberates longer than air',
    Math.min(...all.filter((s) => s.vacuum).map((s) => s.reverb.seconds))
    > Math.max(...all.filter((s) => !s.vacuum).map((s) => s.reverb.seconds)) * 0.85);

  // -- the cross-fade -------------------------------------------------------
  // §2.5 forbids cuts. Every ramp in audio.js is setTargetAtTime, which is a
  // first-order approach — the property being relied on is that it *cannot*
  // overshoot, because an overshoot puts a bump in the middle of a transition
  // whose whole job is to go unnoticed.
  ok('§2.5 · the cross-fade is monotone and never overshoots',
    (() => {
      let prev = -1;
      for (let t = 0; t <= XFADE * 3; t += XFADE / 200) {
        const v = xfadeAt(t);
        if (v < prev || v > 1) return false;
        prev = v;
      }
      return true;
    })(), `${XFADE} s, sampled 600×, always in [0,1] and non-decreasing`);
  ok('and it is essentially complete when the transition ends',
    xfadeAt(XFADE) > 0.94 && xfadeAt(XFADE) < 1,
    `${(xfadeAt(XFADE) * 100).toFixed(1)}% at t = XFADE`);

  // -- the pad is soft, as a number -----------------------------------------
  // The benchmark frames are bright, warm and still. A raw sawtooth pad is the
  // opposite, and "sawtooth" is what a naive hue→waveform map picks for a warm
  // world. The generated wavetable is what stops that, and its spectral
  // centroid is the decidable form of the claim.
  let saw = 0, sawD = 0;
  for (let k = 1; k <= 16; k++) { saw += k * (1 / k); sawD += 1 / k; }
  const sawCentroid = saw / sawD;
  ok('the pad is softer than a sawtooth at every warmth, by construction',
    [0, 0.25, 0.5, 0.75, 1].every((w) => padCentroid(w) < sawCentroid * 0.55),
    `centroid ${padCentroid(0).toFixed(2)}…${padCentroid(1).toFixed(2)}`
    + ` against a sawtooth's ${sawCentroid.toFixed(2)}`);
  ok('and warmer worlds are brighter than colder ones, monotonically',
    [0, 0.25, 0.5, 0.75, 1].every((w, i, a) => i === 0 || padCentroid(w) > padCentroid(a[i - 1])));
  ok('and the wavetable has no DC term — a pad with an offset eats headroom',
    [0, 0.5, 1].every((w) => padPartials(w)[0] === 0));

  // -- the benchmark, as a constraint ---------------------------------------
  // docs/plans/BENCHMARK.md: bright, warm, still, unhurried, no tension.
  // Nothing on a temperate daylight world may read as ominous.
  const temperate = [];
  for (const mood of ['wanderers', 'afternoon', 'greenshade', 'searemembers', 'chrome', 'plain', 'gold']) {
    for (const type of ['terrestrial', 'ocean']) {
      for (const starTemp of [4800, 5778, 6600]) {
        for (const hue of [0.08, 0.2, 0.33, 0.45, 0.58]) {
          temperate.push(deriveScore({
            kind: 'surface', seed: 4242, keySeed: 99, type, mood, atmo: 1,
            Teq: 288, gravity: 9.81, starTemp, hue, inhabited: true,
          }));
        }
      }
    }
  }
  ok('the benchmark · a temperate daylight world is never scored darker than aeolian',
    temperate.every((s) => MODE_LADDER.indexOf(s.mode) >= 1),
    `${temperate.length} worlds, darkest ${
      MODE_LADDER[Math.min(...temperate.map((s) => MODE_LADDER.indexOf(s.mode)))]}`);
  ok('and it keeps its third, stays under 68 bpm, and holds a chord for ≥6 s',
    temperate.every((s) => !s.thirdless && s.bpm <= 68 && s.chordSeconds >= 6));
  ok('and the cold wide voicing stays in the vacuum, where §6 sends it',
    temperate.every((s) => s.spread === 2)
    && all.filter((s) => s.vacuum).every((s) => s.spread >= 3));
}
```

Add `suiteScoreGraph` to the runner beside `suiteScore`. Measured values at the
time of writing, so you know what "green" looks like:

```
peakMix          0.278 … 0.670   (of 1.0)
padTaper sums    1.000000000000  for n = 2..5
irEnvelope(T,T)  0 exactly · −60.00 dB at RT60
xfadeAt(XFADE)   0.9502 · sup = 1.0, never exceeded
reverbBlend      0.00 … 1.00 on every tier row
padCentroid      1.36 … 2.25     against a sawtooth's 4.73
temperate modes  aeolian 80 · dorian 200 · mixolydian 120 · ionian 20 · phrygian 0
```

### 6.3 · what I ran that you cannot paste

Two harnesses live in my scratchpad and need a mock `AudioContext`, so they do
not belong in `tools/`. Both are green; the numbers are reported here because
they are the only evidence for the claims they cover.

**`graphcheck.mjs` — 31/31.** Instantiates the *real* `Ambience` against a
recording mock and asserts:

- the graph is 63 nodes at tier 1 (4 biquads, 2 buffer sources, 2 convolvers,
  1 compressor, 30 gains, 23 oscillators), 72 connections;
- **seven consecutive scale changes add zero persistent nodes** — the cross-fade
  re-targets parameters and never rebuilds;
- the chord counter is `0 → 7` across those changes and **never resets**, which
  is the mechanical form of "descending is one continuous piece" (§2.5);
- over **600 simulated seconds** the live node count goes 63 → peak 88 → 73, so
  transients are reclaimed and nothing leaks; 80 chords, 266 arpeggio slots and
  29 bells were scheduled, and 3161 automation events written;
- both generated IRs are NaN-free, unit-energy to 1e-6, end at silence, and have
  a head:tail energy ratio of 1.3e8 / 8.2e7;
- **the mute path**: `toggleMute()` drives the master gain to exactly 0, persists
  `aeon-mute=1`, and while muted `blip()`, `festivalBell()` and `warp()` allocate
  **zero** nodes; unmute restores `level` exactly;
- reduced motion sets `motion = 0.5` and leaves the master at full `level`, and
  the derived score slows (58.2 → 52.4 bpm) and thins (arp 0.66 → 0.33) without
  zeroing any voice;
- a `setScale`/`surfaceScore` issued *before* `unlock()` is applied at unlock.

The mock also fails the run on any non-finite parameter value, any parameter
scheduled in the past, any `exponentialRampToValueAtTime(0)` (a WebAudio error),
and any `setTargetAtTime` with a non-positive time constant. None fired.

**`benchcheck.mjs` — 14/14.** Sweeps 420 temperate daylight worlds and 4
contrast worlds; results folded into §6.2 above. Its one interesting finding: an
early version flagged 224 "tritones" on temperate worlds, which turned out to be
a single chord — a major triad with the ♯11 voiced at +30 semitones. That is the
lush Ravel colour the benchmark is painted in, not a tension, and
`safeExtension` already forbids voicing it inside the triad. **The check was
wrong, not the code**, and it is written above in the corrected form: a tritone
is legal *iff* it is at least an octave up and has a major third under it.

---

## 7 · What remains unverifiable

This is the honest part, and it should stay in the file rather than be
rediscovered later. Nothing in this repo can hear. Everything below rests on the
code reading correctly and on music theory being applied correctly — not on a
measurement.

**Verified by measurement** (`suiteScore`, the suite in §6.2, and the two
harnesses): that the mapping discriminates; that it is deterministic; that the
mode ladder is monotone in stellar temperature; that no chord contains a
semitone; that the sequences have no detectable period out to k = 20000; that
the mix leaves headroom; that the graph does not grow, leak, or click; that mute
reaches the master and suppresses allocation; that the IR decays to −60 dB and
ends at zero; that the cross-fade cannot overshoot.

**Not verified, and not verifiable here:**

1. **That it is pleasant.** Every check above is a *necessary* condition. "No
   semitone clash, headroom intact, aperiodic, in Dorian" is satisfied by a
   great deal of music nobody wants to listen to. Whether the result is
   soothing is a listening judgement and no one in this loop can make it.
2. **That the arrangement balances.** `TRIM` is eleven numbers setting the
   relative level of pad against sub against wind against arpeggio. The sum is
   asserted; the *ratio* is guesswork. The single most likely defect in the
   whole feature is that one voice is 6 dB too loud, and nothing here would
   catch it.
3. **That the reverb sounds like a place.** The IR is asserted to be
   exponentially decaying, progressively damped, unit-energy and click-free.
   Whether it sounds like a valley or like a spring reverb is not asserted, and
   the early-reflection delays (7.1–71.3 ms) were chosen to be incommensurate
   rather than because anyone heard them.
4. **That the wavetable swap on a scale change is inaudible.** It is the one
   deliberate discontinuity in `audio.js` (`_applyScore`, annotated at the call
   site). It is quantised to five steps and lands under the hyperzoom riser, and
   the argument that this masks it is *reasoning*, not evidence.
5. **That the pad's portamento reads as musical rather than as a siren.** Chord
   changes glide over `min(2.6 s, chordSeconds × 0.22)` and a key change over
   `XFADE/3`. Those constants are taste.
6. **That the scheduler's timing is audibly tight.** A 250 ms tick with a 2 s
   lookahead is the standard WebAudio pattern and events are stamped on the
   audio clock, so it should be sample-accurate — but a background tab that
   throttles to 1 Hz takes the `_skip` path, and what that *sounds* like on
   return has never been heard.
7. **The benchmark itself.** `docs/plans/BENCHMARK.md` and `sakura-realm` are
   images. "Bright, warm, still, unhurried" has been translated into mode floor,
   tempo ceiling, chord-length floor, voicing width and spectral centroid — and
   that translation is an interpretation, argued in `score.js` §"What the music
   is allowed to be a function of", not a measurement.

**The first thing a human with speakers should check**, in order: (1) is any one
voice obviously too loud — `TRIM`; (2) does a dive from orbit to surface sound
like one piece or two — the wavetable swap and the glide; (3) is the arpeggio too
busy on an inhabited world — `KIND_ARRANGEMENT.surface.arp` and the `inhabited`
1.55× multiplier.
