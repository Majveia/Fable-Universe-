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


---

# The empty meadow, and the shape of the defect behind it

A later session, and the same shape three more times. Recorded together because
the pattern is the finding, not any one instance.

`docs/captures/blind/SCORE.md` had stood for four milestones on two facts that
contradicted each other:

> **In the frame, there is no grass.** Visually confirmed at magnification.
> **In the CPU's bookkeeping, there are 3.5 M blades across 162 chunks.**
> Both are facts and they do not agree. The reconciliation is *not* known.
> **Naming the cause needs a draw-call inspection, not another still.**

`tools/drawcensus.js` did the inspection. **3.5 M instances genuinely reach the
driver** — 328 draw calls, 7.02 M instances across two passes, 9.8 vertices
each. The bookkeeping was right, the frame was right, and the loss is entirely
downstream of the draw. Two causes, both in `src/flora.js`, both the same shape:

| the thing | where it lives | who calls it |
|---|---|---|
| `uChunkNear` | declared in `MEADOW_GLSL` | **nobody, ever** |
| `meadowWidth()` | defined in `MEADOW_GLSL`, `wpx` in `RINGS` | **nobody, ever** |

**The shape: a function or value that exists, that a test exercises, and that
the renderer never calls.**

- `uChunkNear` was a uniform nothing set. An unset uniform is 0, so the
  denominator became the density at point-blank range and the absolute density
  law ran twice. 1.7x too few blades — measured over the real chunk grid, not
  estimated.
- `meadowWidth()` is §9.5's angular width floor, the mechanism that lets far
  rings *"trade count for width one-for-one."* `flora.js` used a flat 2.8 cm
  instead, at every distance. That is **0.04 px** at ring 3's far edge. Coverage
  at ring 3 was **0.0007** — seven hundredths of one per cent of the ground.
  That is the bare ground, and it is the larger of the two by a wide margin.

## Why every instrument missed both

Not neglect. Each one was aimed at whether the arithmetic was *right* rather
than whether it *ran*:

- `tools/verify.js` asserted the shader's **text** — that it divides by
  `meadowFalloff(uChunkNear)`. It did. Green.
- `tools/pixeldiff.js` **set `uChunkNear` itself** in its fixture and checked
  parity to 1.3e-7. Green. A parity test that supplies an input the application
  forgets to supply passes forever on a broken renderer.
- `?bladedbg=` — the instrument built for exactly this question, with the
  decision tree written into its own comment — had never been run.

That last one settled it in twenty seconds once there was a tool that could
render a frame: `?bladedbg=2` (eight times tall, sixty times wide) took frame
saturation from 0.337 to 0.673. The blades were there, correctly placed, and
too thin to register — which is the branch the comment says means *"the fault
is a dimension."*

## The guard that generalises

Both fixes make the value an **argument** or a **called function**, so a caller
that forgets one no longer compiles. And `verify.js` now asserts the shape
rather than the spelling:

- a per-chunk quantity may not be a uniform on a ring-shared material — three
  uploads a material's uniforms only when it thinks the material changed, and
  411 of every 412 writes are dropped;
- `meadowWidth()` must actually appear in `flora.js`.

The same audit is worth running against every shared GLSL chunk in `src/`. The
existing `suitePaintUniforms` already does it for `PAINT_GLSL` — read the
uniforms off the chunk, require every consumer to supply them by name — and
that pattern, pointed at `MEADOW_GLSL`, would have caught `uChunkNear` on the
day it was orphaned.

## Still open

- **1.7x more blades and a real width floor is not yet proven to be a meadow.**
  Measured coverage says it should be (0.0007 to 0.58 at ring 3), and nobody
  has looked at it on a GPU.
- The width floor is capped at the mean blade spacing, because past that width
  buys overdraw and nothing else. That cap is derived, not tuned, and also
  unlooked-at.
- §5 is red and this is the second measurement saying so: **80.4 M vertices in
  one frame** at the low row, against a 2.2 M *triangle* budget. `RECKONING.md`
  Act C called it and it is still open.


---

# The haze does not reach the feet

`docs/plans/BENCHMARK.md` §2 property 3 is the strongest claim in the project's
own analysis of why its frames look washed out:

> **Our haze reaches the player's feet**, which flattens the near field into the
> same wash as the distance and costs §8 axis 3 its third plane, axis 5 its
> materials, and axis 6 its colour, all from one cause.
>
> Property 3 is the highest-value single measurement open in the project.

It was open because nobody had taken it. `?fogview=1` has existed the whole
time — `src/print.js` outputs `1.0 - alpha` as the picture instead of the
picture — and `tools/glimpse.js` can now read it in bands down the frame.

Seed 700181046, surface, eye at 1.68 m:

| band | | fog | past 0.8 |
|---|---|---|---|
| 0–2 | sky | 0.82 – 0.93 | 61–95% |
| 3 | horizon | 0.786 | 76% |
| 4 | mid | 0.297 | 21% |
| 5–6 | near | 0.045 / 0.059 | 1–2% |
| 7 | at the feet | **0.000** | **0%** |

**The near field is clear.** That is the shape BENCHMARK.md attributes to the
*reference* frames and says ours does not have.

Two reasons this measurement is trustworthy where the width-floor one was not:

- **Fog fraction is not resolution-dependent.** It is a per-fragment function of
  distance and height, so a 320x180 software frame computes the same number a
  1440p one does. The width floor is the opposite — it is defined in pixels —
  which is why a glimpse can settle this and cannot settle that.
- The analytic curve agrees. `1 - exp(-(d/far)^1.28 · 3.1 · heightFalloff)` at
  `far = 1700` gives 0.002 at 5 m, 0.011 at 20 m, 0.052 at 70 m, 0.18 at 200 m,
  0.91 at 1400 m — a clear near field and a hazed distance, which is what the
  bands show.

## What it does not settle

**One world.** `aerialParams()` derives `far = visibility / (atmo · hazeX)`, so
a thick-atmosphere world genuinely collapses the extinction length: at `atmo=5`,
`far` falls to 340 m and fog at 40 m rises to about 0.20. BENCHMARK's claim may
well hold *there* and not here. The honest statement is that the fog is correct
on a temperate world and that "the haze reaches the feet" is not a property of
the aerial perspective as written.

## So the pale near field has another cause

Which matters more than the result itself, because it redirects the effort
BENCHMARK.md was pointing at the fog. What is left on the table:

- **The ground has no material.** §8 axis 5 scored 1 and 2, and
  `RECKONING.md` already calls this "the blocking axis" and "more than half of
  every frame". §M2 act 4's own gate asks for "generated detail arrays inside
  30 m" and that near-field half does not exist.
- **`?paint=` against `?mat=`.** `docs/plans/DEFAULTS.md` §2 measured
  `paint=1&mat=1` as *paler* than `paint=0&mat=1`, with the mid-ground mottling
  gone, and withdrew the flip on that evidence. It has been flipped back on the
  argument that the solver now supplies the geometry the ramp wants — and **that
  A/B has not been re-taken.** It should be, before anything else is tuned.
- The grass, which was two thirds absent for reasons recorded above and is now
  unmeasured at shipping resolution.
