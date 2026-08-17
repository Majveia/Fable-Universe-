# Vacuum-scale integration notes

Patches the vacuum work needs in files it does not own (`cosmic.js`, `system.js`,
`nebula.js`, `zeldovich.js`, `nbody.js`, `cosmology.js` are the owned set).
Each entry says what is wrong, what the exact change is, and what it costs to
leave undone.

---

## 1 · `tools/gate.js` — the M1 reference arm now measures M1 against itself

**Severity: the gate silently stops being a comparison.**

`gate.js` scores clause (c) — "the `N` toggle is more legible than it was" — by
shooting two builds and comparing them:

```js
const ref = await pair(q(`seed=${seed}`));          // meant to be the pre-M1 frame
const m1  = await pair(q(`seed=${seed}&m1=1`));     // the M1 frame
```

`cosmic.js`'s flag is now `PARAM('m1') !== '0'`, so the first URL carries no
`m1` and resolves to **M1 on**. Both arms are the same build; clause (c)
compares a frame with itself and reports a difference of ~0%, which reads as a
regression and is not one.

**The change**, in `stations()`/`pair()`'s reference arm only:

```js
const ref = await pair(q(`seed=${seed}&m1=0`));
```

**Workaround available today, no edit needed:** run it as

```
node tools/gate.js --milestone M1 --extra "m1=0"
```

`q(base)` appends `extra` last, and `URLSearchParams.get()` returns the *first*
occurrence — so the M1 arm's `&m1=1` still wins and the reference arm, which has
no earlier `m1`, correctly reads `0`. This is what the measurements in this
session were taken with.

---

## 2 · `main.js` / `touch.js` — the pinch-to-wheel contract (now satisfied, keep it that way)

**Status: fixed on every scale, but the shape of the bug is worth recording.**

`main.js:383` and `touch.js:236` synthesise a pinch as

```js
this.active().onWheel?.({ deltaY: (pinchD - d) * 3.2 });
```

— a **plain object**, not a DOM event. `OrbitControls` binds a real `wheel`
listener to the canvas, which a plain object can never reach. So any scale that
left the dolly to `OrbitControls` swallowed the pinch entirely while the mouse
wheel worked perfectly, and the mouse wheel is the one input a desktop test
exercises and a phone never has.

All five `OrbitControls` scales now implement `onWheel` themselves and set
`controls.enableZoom = false`: `cosmic.js`, `system.js`, `galaxy.js` (plus
`blackhole.js` and `planetscale.js`, which already did). **The invariant to hold
is that those two must move together** — a future scale that sets up
`OrbitControls` and relies on its built-in zoom is unreachable on glass, and
nothing in the tree will say so.

Two cheaper places to make it structural, either of which would remove the trap:

- **`main.js`/`touch.js`**: dispatch a real event instead —
  `cv.dispatchEvent(new WheelEvent('wheel', { deltaY, bubbles: true }))` — after
  which `OrbitControls`' own handler works and no scale needs `onWheel` at all;
- or **`tools/touchgate.js`**: assert that every scale exposing `controls`
  either implements `onWheel` or has `controls.enableZoom === true` *and*
  receives real events. A one-line check that would have caught this.

**Calibrated gain, for whoever touches the `3.2`.** The scales use
`distance *= exp(k · deltaY)` with `k = 8.845e-4`, chosen so one 100-unit wheel
notch is 9.25% — i.e. exactly `OrbitControls`' `zoomSpeed = 1.7`. At the current
`3.2`, a full-screen pinch on a 390-point phone (~500 px of finger travel)
arrives as `|deltaY| ≈ 1600`, which is a **4×** dolly — five pinches to cross
the cosmic scale's 6…3060 range. A comfortable **one-pinch traverse of ~60×**
wants `|deltaY| ≈ 4600`, i.e. a pinch gain near **9** rather than 3.2.

The scales currently multiply `k` by 2.9 when `matchMedia('(pointer: coarse)')`
matches, which reaches the same place from inside the owned files. If the `3.2`
is ever raised to ~9, **drop the 2.9× in the same commit** or the gesture
becomes roughly three times too fast.

---

## 3 · `src/post.js` — the cosmic bloom threshold is now non-zero, and that is load-bearing

No edit requested; recording the coupling.

`bloom.js`'s bright pass collapses to `w = 1` at `threshold = 0`, so an
unthresholded bloom blurs the **entire** frame and adds it back. In vacuum that
is a pedestal under a field §2.8 requires to reach zero. Measured on the cosmic
scale before the change: **0.9%** of pixels at true `#000` and **65%**
achromatic, because a broad grey haze is what an unthresholded bloom of a
multicoloured point field is.

`cosmic.js` now asks for `threshold: 0.06` and `system.js` for `0.3`. If
`post.js` or `bloom.js` ever normalises, rescales or pre-exposes the HDR buffer
before the bright pass, **both numbers become wrong at once** and the symptom
will be a grey vacuum, not an obviously broken bloom.

---

## 4 · `src/planet.js` — `blackbodyRGB()` is not accurate enough for a star's own pixels

No edit requested; `system.js` has routed around it. Recorded because
`starfield.js` still uses it and may care.

`blackbodyRGB()` is the Tanner Helland fit. At 5,682 K it returns
`(1.00, 0.944, 0.893)`. The CIE 1931 integral of the actual Planck spectrum —
which `starlight.js` already computes, and which §9.6 makes the source of truth
for the sky stops — returns `(1.00, 0.870, 0.799)`: **nearly twice the chroma**.

For a lambertian term on a planet that difference is invisible and the fit is
much cheaper. For an object that fills the frame and whose temperature the HUD
prints in kelvin, it is the difference between a warm star and a grey one, and
it is half of why the star capture measured 99.2% achromatic. `system.js` now
uses `starChroma()` (Planck → CIE → `toGamut`) for the photosphere, corona,
dust and belt, and leaves `blackbodyRGB` to light the planets.

If `starfield.js` ever wants its stars to carry real spectral colour, the
function to call is `starChroma()`'s recipe, not this one.

---

## 5 · `src/planetscale.js` — a §2.3 determinism leak that the `Math.random` grep cannot see

**Severity: an invariant violation. Two people opening the same link see
different worlds.**

`_ecoFor()` (around line 1401) reads the wall clock and a `localStorage` blob,
and both reach *visible fauna counts*:

```js
const now = Date.now();
let st = db[key];
if (!st) { st = { s: …, k: …, t: now }; }
else {
  const dtH = Math.min(Math.max((now - st.t) / 3.6e6, 0), 720);
  const grow = (n, cap) => Math.min(cap, Math.round(n + (n + 0.5) * 0.08 * dtH * (1 - n / cap)));
  st.s = grow(st.s, K.s); st.k = grow(st.k, K.k); st.t = now;
}
```

Those two numbers are not decoration. `life.js:229` uses `eco.skimmers` as the
instance count `NB` and `life.js:320` uses `eco.striders` as `NS_WANT`, and
`planetscale.js:1753` prints both to the HUD as *regional fauna*. So the number
of animals standing in the frame, and the number the HUD claims, are a function
of what time it is and of what is in this browser's `localStorage`.

§2.3 is unambiguous — *"Same seed + same code = same universe on every machine,
forever. No `Math.random()`, no `Date.now()`, no un-seeded `performance.now()` in
any generation path."* §2.4 depends on it: a deep link is only an address if it
resolves to one place. And §4 caps persistence at *"URL + `localStorage`
logbook"*; `aeon-eco-v1` is a second store, and it is authoritative rather than
observational.

### The whole sweep, so this is closed rather than patched

Every wall-clock read in `src/` was checked against "does this reach generated
state?":

| site | verdict |
|---|---|
| `planetscale.js:1409` `_ecoFor` | **leak** — reaches fauna counts and the HUD |
| `city.js:290` `step(budgetMs)` | clean — the time budget only decides how many generator iterations run per frame; the generator always runs to completion, so the city is identical |
| `main.js:522`, `input.js:133`, `touch.js:219/252/259` | clean — input and frame timing, no generation |
| `quadtree.js:93/361`, `surface.js:1256/1388/1464` | clean — telemetry, and `surface.js` already says so in a comment |
| `main.js:739` | clean — the logbook's own timestamp, display only |

One site. `city.js` is the near-miss worth keeping in mind: a time budget is
safe exactly as long as it is amortisation and not truncation.

### The change

The visible count has to be a pure function of `(seed, region)`. The growth
model can stay if it is driven by something the URL carries — the planet's own
elapsed simulation time is such a quantity; the visitor's wall clock is not.

Minimal fix, deleting the leak and keeping the carrying capacity that was
already deterministic:

```js
  _ecoFor(a) {
    const q = 28;
    const key = (hash(Math.round(a.x * q), Math.round(a.y * q), Math.round(a.z * q), this.pp.seed) >>> 0).toString(36);
    const rng = new RNG(parseInt(key, 36) >>> 0);
    const veg = 0.4 + 0.6 * rng.next();
    // Carrying capacity is regional and deterministic; standing population is
    // a fixed fraction of it drawn from the same stream. §2.3: the same seed
    // has to put the same herd on the same hillside on every machine, forever,
    // which is what makes §2.4's deep link an address rather than a suggestion.
    const K = { s: Math.round(2 + veg * 7), k: Math.round(10 + veg * 30) };
    return {
      striders: Math.max(1, Math.round(K.s * rng.float(0.45, 1))),
      skimmers: Math.max(1, Math.round(K.k * rng.float(0.45, 1))),
      veg, key,
    };
  }
```

and delete the `aeon-eco-v1` read and write with it.

**If the "come back and the herd has changed" idea is worth keeping** — and it
is a good idea — the honest version drives `dtH` from a simulation clock that
the URL can carry, so the same link still resolves to the same herd:

```js
const dtH = this.simHours;   // advanced by the scale's own time, seeded, shareable
```

That is a design change and a human's call. The leak is not.

**Cost of leaving it:** §2.3 is listed as *"a revert, not a discussion"*, and
`tools/verify.js` cannot see this one — it hunts `Math.random`, not the clock.
