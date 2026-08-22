# Why the worlds looked like that

A record of one session's findings, because most of them were not bugs anyone
had introduced — they were things that had been true since the code was
written, and every one of them was visible in any surface screenshot.

The prompt was three phone screenshots and the question *"why does our worlds
look like this?"* What follows is the answer.

---

## 1 · The art direction was switched off

`src/surface.js` gates its features on a `PARAM()` helper. Most read
`!== '0'` — on unless disabled. Two read `=== '1'`:

```js
const PAINT = PARAM('paint') === '1';   // §9.2, the entire light model
const SOLVE = PARAM('solve') === '1';   // §9.7, the composition solver
```

§7.4 says to build behind a flag, default-off, and to flip the default in a
separate commit. Both features landed. Neither flag was ever flipped. **The
shipped build had none of §9.2 or §9.7 in it** — the terrain ran a plain
wrapped-Lambert fallback and the landing site came from the old
height-above-waterline heuristic.

`docs/plans/M2.md` §24.4 records exactly why `?paint=1` was held back, and names
the two things that had to exist first:

> - **§9.7's landing solver** puts the spawn sun in an 8–18° band, which is the
>   geometry the ramp is tuned for. It is `?solve=1`, also default-off.
> - **Act 4's four-layer triplanar materials** supply real `shade`/`mid`/`lit`
>   stops.

Both exist now. `?mat=` has been default-on since M2's flip; `?solve=` flips in
the same commit as `?paint=`, because they are one change — §24.4's arithmetic
shows the hue ramp collapses to a single band on *flat ground*, and not
spawning you on flat ground is the solver's entire job.

## 2 · Every prop was outside the light model

§9.2 opens: *"Every lit surface goes through one function."*

It reached the terrain, the ocean, the sky, the grass, the trees and the
figure. It reached nothing else. Twelve modules and 42 materials — every
boulder, every plant, every wall, roof, animal and ruin — were lit by three's
stock `MeshStandardMaterial`.

That is the "grey props on a painted ground" reading, and it is also the
`achromatic-dark` failure §M2's own gate names. §24.4 recorded it and left it
open, in these words:

> **Still visible in the default frame, and not fixed here:** the rocks read as
> near-black silhouettes, which §M2's own gate calls a failure in those words.
> §9.2 is the thing that fixes it, and §9.2 is what just got held back.

`src/painted.js` is the bridge: `PAINT_GLSL` injected into an ordinary
`MeshStandardMaterial` through `onBeforeCompile`, which keeps instancing, the
shadow map and depth sorting and replaces only the step where the colour is
decided. `SurfaceScale.paintWiring()` hands a module everything it needs in one
call, so joining the light model is a three-line change rather than a
negotiation with `surface.js`.

**A note for whoever wires up the next module:** `getShadowMask()` does not
exist in a standard material. It is a lambert/phong chunk, and calling it is a
shader compile error, not a fallback — the props render with a broken program
and nothing in the console connects it to your change. Use the terrain's own
`sunShadow(worldPos, ndl)`, which is what `paintWiring()` hands over, and which
has the better property anyway: one shadow pass for the ground and everything
standing on it.

## 3 · The alpha that was never generated

The one that accounts for most of the ugliness in a still.

`ground-cover.js` builds every plant as a card and says so:

```js
// Plants are cards, per the reference — a card is four vertices
// whatever it is a picture of.
```

`scatter.js` says the rest: the shape *"lives in alpha, not in geometry."* The
material was:

```js
transparent: true, alphaTest: 0.35,   // and no alphaMap, and no map
```

Alpha was uniformly 1.0. The test passed at every texel. **Every plant on every
world in the universe rendered as an opaque rectangle** — a few hundred
hard-edged dark quads per frame, at every angle. The intent was in the comments
and the picture was never in the repo.

`src/silhouette.js` generates the six species analytically (§2.1: on-device,
from `hash(seed, …)`), plus one for `ripple` — a 2.6 m quad lying flat on the
ground, which as an opaque rectangle is a sheet of card on the floor with a
straight edge no landform has.

It is a module of its own, with no `three` in it, so `tools/verify.js` can test
it. That matters more than it sounds: **a mask that comes back uniformly opaque
is, in code, indistinguishable from the bug it was written to fix**, and no
capture-based gate would flag it either — it would just look like the picture
everyone had got used to.

Two of that suite's assertions turned out to be wrong rather than the shapes,
and both are worth keeping written down:

- *"a blade tapers toward the tip"* — false for a **tuft**, whose envelope is
  widest at the top because the blades fan. It still caught a real defect
  (`reed` was a solid column) so it was corrected to the property that actually
  separates a clump from a rectangle: density, not width.
- *"…so does a bloom"* — false for a **flower**, which is a stem carrying a head
  at the top and is meant to be heaviest exactly where the others thin out. It
  now asserts the opposite for that one species.

The temptation on a red gate is to flatten the flower.

## 4 · The minerals were five hardcoded colours

```js
shard: rock(0.55, 0.16, 0.72),   // hue 0.55 — blue, on every world, always
```

§9.1 is explicit that there is no default palette and every colour is derived
per world. Five HSL literals nailed to the file are the thing it forbids, and a
pale blue cone on an ochre desert is what it looks like. They are tints of the
world's own `colB` now.

## 5 · The composition solver had nothing to find

With `?solve=1` on, seed 700181046 reported its own terms — the app's log, not
a model of it:

```
[§9.7] landing solved in 183 ms · score 0.298
       lowHorizon 0.98  offCentre 0.65  band 1.00
       hero 0.06  lead 0.02  walls 0.04
```

The two clauses about *where you are standing* passed. The three about **what
there is to look at** — a hero landmark, a leading line, a valley cross-section
— were essentially zero. §9.7 asks for all five.

The question that number could not answer on its own was whether the solver was
starving or the world was empty. §4's prominence census answered it: the world
was empty. After the landform fix, same seed, same app:

```
[§9.7] landing solved in 196 ms · score 0.773
       lowHorizon 0.58  offCentre 0.50  band 1.00
       hero 0.71  lead 0.63  walls 1.00
```

`walls` — §9.7's valley cross-section, which the reference's own comments call
the thing that *"makes the whole composition"* — went from 0.04 to **1.00**.
The score went 0.298 → 0.773 for thirteen extra milliseconds of solve.

`lowHorizon` fell from 0.98 to 0.58, and that is the change working rather than
a regression: a featureless plain scores that clause trivially, because there is
nothing above the eye line to fail it. Trading it for a valley is the trade
§9.7 is asking for.

One thing this does **not** show is a picture. A 420x240 frame of the fixed
scene does not render inside two minutes on a software rasteriser — the build
completes and logs cleanly, `[ground]` places 16 462 objects across 9 kinds, and
the screenshot call times out. §M0 says it: real GPU, not CI SwiftShader. Every
number on this page is measured; none of them is a substitute for looking.

## 6 · What the solve actually costs

`?solve=` was held off on a perf argument: 127–337 ms of main thread, *"10–28×
§5's 12 ms frame budget in the frame it lands."* The comparison is the wrong
one — §5's 12 ms is a steady-state per-frame budget and this is a one-time
construction cost. Measured, one surface build:

| step | ms |
|---|---|
| `[§M3]` meadow · 4 rings · 412 chunks · 160² wind field | 207 |
| `[§9.7]` landing solve | 183 |
| `[§M2.6]` horizon · 15 876 height samples | 48 |

The solve is second of three and smaller than the meadow, which has shipped on
by default since M3. §2.5 is satisfied for the same reason it already is for the
rest of the build: the scale change is a hyperzoom under a passing snapshot, so
the stall is behind a transition that exists rather than a cut this introduces.
