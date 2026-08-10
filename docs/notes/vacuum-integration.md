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
