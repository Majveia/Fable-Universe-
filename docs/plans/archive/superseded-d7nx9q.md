# Archive · superseded by the merge with `claude/interactive-3d-universe-n6suwb`

This is work from `claude/aaa-3d-universe-threejs-d7nx9q` that a merge on
2026-08-06 superseded. It is kept for two reasons and not out of sentiment:

1. **§27 below is the design for `applyAerial`**, which put §9.3's aerial
   perspective into all twelve non-terrain surface-scale materials —
   settlements, herds, ruins, ships, rivers, wildlife and the rest. The merged
   branch applies aerial to terrain and sky only, so that is owed as a
   follow-up port onto its `aerial(col, dist, V, sun, worldY)` signature and its
   **clarity** alpha convention (this branch wrote **fog** to alpha — the two
   are inverses, and a naive port renders the fog inside out).

2. **The M3 record below diagnosed a fault that outlived the code.** Its wind
   field failed its own GLSL↔JS parity gate at 74%, identically at every moment,
   and the cause was §28.5's seven zero-`h` gradient cells rather than anything
   about wind. That diagnosis, and the three defects it turned up in
   `tools/pixeldiff.js`, are why the integer gradient path is pinned wherever a
   CPU mirror has to agree with a shader.

Neither implementation below survives. `src/wind.js` and `src/windfield.js` were
replaced by the merged branch's `src/wind.js` and `src/flora.js`, which put gust
cells on an infinite lattice instead of recycling six, derive wind speed from
real air density, add Coriolis, and couple to terrain through a baked height
texture.

---

## 24 · Act 2 step 3 · `aerial()` as GLSL, and step 4 · the fog into alpha

`src/aerial.js`, wired into `surface.js` behind `?m2=1` (and `?aerial=1` on its
own, per §7.4). Verified by `node tools/verify.js aerial` — 22 checks — and by
`node tools/pixeldiff.js`, which is new and is §7.3's gate for this act.

### One idea, applied to all three of §16.3's constants

§16.3 ruled that `fogNear`/`fogFar`, the four air colours and the 260 m haze
height are each a *measurement of one valley* and cannot port as literals. Two
of the three turn out to be the same idea:

```
dn = dist · thickness             horizontal, in fixture metres
yn = (y − base) / hazeScale       vertical, in fixture metres
```

Normalise both axes into the reference's own frame and its constants apply
verbatim — the function between them is line-for-line the reference's. Two
numbers per world, both ratios to the reference's world, and the port stops
being a re-derivation.

It also disposes of the airless case without a special case, which §16.3(a)
named as the check that this is the right parameterisation rather than a fitted
one: `thickness → 0` sends `dn → 0`, which is inside `fogNear`, so the fog
vanishes and the mist with it. Note that this is why the scaling is a
**multiply** here where the plan wrote a divide — `1700 / thickness` needs an
epsilon at zero and this does not. `tools/pixeldiff.js` asserts the strong form:
over 4096 cases an airless world returns the input colour **bit-for-bit** and a
fog of exactly 0.

### The deviation from the signed-off coefficient, and why

§16.3(c) signed off `H_haze = 0.0306 · H_atm`, the coefficient being 260/8500.
8500 m is Earth's scale height at a **surface** temperature of 288 K, and the
only temperature AEON computes is `Teq` — 255 K for Earth, because equilibrium
temperature knows nothing about a greenhouse. Applying a coefficient derived at
288 K to a scale height computed at 255 K shortens every world's haze layer by
12% for no physical reason.

So the coefficient is gone. `hazeScale` is a pure ratio to the fixture's own
scale height, the reference supplies 260 m directly, and physics supplies only
how far a world departs from the world that measurement was taken in. Same
discipline as `thickness`. An Earth-like world now reproduces 260 m exactly
rather than to within 12%, and that is a check rather than a claim:

```
  mars g 3.71  → 566 m      super-earth g 21.07 → 138 m      fixture g 9.81 → 260 m
```

### The convention that cannot be checked by looking, made unrepresentable

§16.2 records that `V` must point surface → camera, and that reversed *"the fog
goes cold toward the sun … that still looks like fog. It is the wrong image,
and nothing in a still would tell you."*

So `aerial()` does not take `V`. It takes the two **positions** and computes
the direction itself. The suite asserts that this would have mattered — swapping
the arguments moves the fog's `r − b` from +0.456 to −0.076 — which is the
justification for the signature rather than a test of the arithmetic.

It has one cost, and it is the only thing the old signature was better at: `V`
now sits on the poisoned path, where a caller-supplied `V` could not be reached
by a bad depth. One flag covers both, every branch off it is a *select* rather
than arithmetic (`NaN · 0` is NaN, so a guard that multiplies by zero does not
guard), and the failure mode is the right one — `V = 0` gives neutral haze at
full fog, so a bad pixel becomes distant air: the least wrong thing it can look
like, and flat, so §11's downsample chain has nothing to smear.

### Night, which the reference never had to answer

The reference is one valley at one hour. AEON has a day. The old fog dimmed its
single colour by `max(dusk, 0.08)`; §9.3's split between the fraction and the
colour gives a better answer for free — **extinction does not care whether it is
night.** The air is just as thick and occludes just as much, so the fog
*fraction* is untouched; what goes to zero after dark is in-scattering, because
there is no beam left to scatter. So night dims the four colours and leaves
alpha alone. The floor is not zero because a night sky is not black.

### §7.3's gate · `tools/pixeldiff.js`

The chunk is imported from `src/aerial.js` and handed to `shaderSource`
verbatim — §M0's rule, one level down — and run against its CPU twin over 4096
cases on six worlds chosen because each is a place the parameterisation could
break. Inputs arrive as RGBA32F and results leave as RGBA32F, so the comparison
is float-against-float and 2/255 is a *gate* rather than the instrument's own
noise floor. A half-float target would have spent a quarter of the tolerance on
the measurement.

```
  gate: >=97% within 2/255
  fixture / mars / venusian / heavy / m-dwarf / airless
  colour 100.00%   fog 100.00%   max 0.0001/255
```

### §5, paid before the feature and not after

`_syncPaintLight()` runs **every frame** and calls a spectral integral —
fourteen stops over 201 wavelengths and three colour-matching functions —
measured at **1.73 ms**, or 14% of §5's 12 ms CPU budget. Act 2 needed a second
caller for the same table. §5's rule is that any change that costs frames must
pay for them, so:

`starlight.js` gains `airColoursQuantised`, memoised in **airmass** rather than
elevation. Elevation is the wrong variable — airmass goes as `1/sin(h)`, so a
quarter-degree step near the horizon moves `skyHorizon` by 6.2/255 while five
degrees at noon move nothing. Equal *relative* steps in airmass are equal steps
in how much air the beam crossed, which is what every stop is a function of.

At 1% per bucket the worst step over all fourteen stops and 0.5°–75° is
**0.574/255** — half a display step, under the ±0.5/255 dither §9.4 step 8
applies over the top. So it needs no interpolation to be invisible, and stays a
memo rather than becoming a resampler. Measured: **5073× cheaper**, 61.4 s of
CPU per simulated day down to 0.01 s.

Two details are load-bearing. The bucket is evaluated at *its own* elevation
rather than at the caller's — keyed on the caller's, the cache would return
whichever elevation asked first, and the error would depend on arrival order,
which is a determinism leak (§2.3) that no test would catch because every
individual answer is inside tolerance. And `quantised` is a **parameter, not a
default**: §19's fixture check pins the transfer to §9.1's painted hexes at
1e-6, three orders of magnitude tighter than the bucket, and a default would
have quietly turned that check into a test of the cache. It did, for one run,
which is how the parameter got there.

### Step 4 · the audit, and what it found · `tools/alphaudit.js`

§16.6 asks whether anything drawn *without* `aerial()` writes garbage into
alpha, and notes that a sky dome's value *"has to be a decision, not an
accident."*

**The sky writes alpha 1, on purpose.** A painted sky is the furthest thing in
frame and should take the full wet-in-wet softening — that is how a watercolour
wash behaves — and the far terrain asymptotes to fog 1 at the horizon, so a sky
writing 0 would put a step discontinuity in the post chain's idea of distance
exactly along the horizon line, which is the most looked-at edge in the frame.
It was already 1.0 by accident. Now it is 1.0 for a reason.

The audit cannot live behind a debug flag in `surface.js`, because the materials
that would corrupt alpha are exactly the ones that do not have the flag. So it
reads the **composited** channel back from a float target, from outside.
Measured on the surface scale, `?m2=1`:

| | |
|---|---|
| alpha range | [0.00000, **1.55191**] |
| NaN | 0 |
| below 0 | 0 |
| above 1 | 203 px, **0.039%**, in one 8×8 cell |

**Two findings, and only one of them is fixed here.**

1. *Additive blending overshoots.* Three's preset `AdditiveBlending` is
   `(SRC_ALPHA, ONE)` on the **alpha** channel too, so an additive sprite adds
   its own alpha to the scene's. That is the 0.039% and the 1.55. Clamped in
   `print.js` at the one place the value is read, rather than at each of the
   dozens of places it is written; `alphaudit.js` still reports the raw channel,
   so the clamp bounds the damage without hiding it.

2. *Everything that is not terrain, ocean or sky writes 1.0 by default* — which
   reads as maximally distant. A near tree would take full watercolour
   softening. **Not fixed, and deliberately not fixed here.** The right answer
   is a shared `applyAerial(material)` that injects the chunk into any material
   via `onBeforeCompile`, and it is worth more than the alpha: `scene.fog` is
   unset, so those objects are not fogged *at all* today, and a distant conifer
   stands at full contrast against hazed ground behind it — a §8 axis-3 defect
   that predates this act. That is a step with its own validation and its own
   risk across four material types (`Points`, `Sprite`, `Basic`, `Standard`,
   each a different shader structure), and §7.2 says it gets planned before it
   gets written.

   Its consumer does not exist yet either: §9.4 steps 5 and 5b are what read
   this value, and they are still owed. Landing the fix before the thing that
   reads it would be tuning against nothing.

So **step 4 is met for the background and open for the foreground**, and the
gate is a committed tool that says so on every run rather than a claim in a
commit message.

### The trap that bit twice in one session, now in the instrument

`tools/parse.js` exists for exactly one defect — a backtick inside a `//`
comment inside a GLSL template, which ends the string and turns the rest of the
shader into JavaScript. Its header says so.

It only caught half of it. The defect is caught when the corruption produces
*invalid* JavaScript. Often it does not:

```js
float dist = (raw < 1.0e6) ? raw : 1.0e6;
// so `< 1e6` catches NaN and overflow in one step
         ^ ends the template            ^ starts a tagged template
```

That parses clean. `node --check` passed it, the tool reported 61/61, and the
module threw `1000000 is not a function` on import — a runtime error bearing no
relationship to the line that caused it. The same mistake then landed in
`print.js` an hour later, that time invalidly.

So `parse.js` gains a text-level pass: **inside a GLSL template, a `//` comment
containing a backtick is the defect.** A legitimate closing backtick is never
inside a comment, and this repo's prose convention is to quote identifiers in
backticks, which is precisely why the two keep colliding. Verified against both
real defects and against a file with backticks in ordinary comments, which it
leaves alone.

### Where it stands

```
node tools/parse.js       61/61 modules, plus the new lint
node tools/verify.js      114/114 across five suites
node tools/pixeldiff.js   6/6 worlds, 100% within 2/255
node tools/alphaudit.js   FAILs, with the number, by design
```

`shadercheck` reported `INCOMPLETE` when this section was written — it could not
reach the surface scale inside a 600 s timeout on a software rasteriser, which
is the honest outcome and not a pass. Raised to 2400 s it completes and is
**green**: 94 shaders, 0 failed, 0 warnings, all six scales reached including
`surface`. The count is worth reading rather than skipping — 90 for `m2=1`
alone, and the four added are exactly the wash chain's downsample and blur, one
vertex and one fragment each. A shader count that moves for a reason you can
name is evidence; one that moves for a reason you cannot is §23's false alarm
all over again.

### The sun-facing bands: more evidence, still not root-caused

§23 recorded hard-edged bands and a washout on sun-facing frames and scheduled
them here. Three frames at 1280×720 on seed 1337146641 — legacy, `?m2=1`, and
`?m2=1&airdebug=1` — show a large arc across the sky in **all three**, which
confirms §23's finding that it is neither the solver nor the post chain, and
adds that it is not the aerial port either.

A bisect by hiding each of the 70 top-level scene children and differencing the
sky region did not isolate it: the metric is dominated by the sky dome and the
cloud points, which are simply most of the sky. A second attempt to render the
scene with individual children hidden failed for an instrument reason worth
recording — `App.haltAt` stops the frame loop, so toggling `visible` on a
halted app changes nothing that is drawn, and the "before" and "after" frames
come back identical. Any future bisect has to drive the renderer directly
rather than through the app loop.

Still SwiftShader-observed. Still not caused by this act.

---

## 25 · Act 2 step 6 · §9.4 steps 5 and 5b, built, verified, and left switched off

`src/wash.js` (the arithmetic, JS and GLSL), `src/soft.js` (the wash on the
GPU), wired into `print.js`. `node tools/verify.js soften` — 9 checks.

This is the last of §9.4, and the two steps that made §9.3's alpha channel worth
writing.

### Wet-in-wet is not a small blur

"A blurred tap" reads like a few-pixel softening, and a few-pixel softening is
what a *camera* does — it says out of focus, which is a lens, which is the one
thing §9.4 rules out by name. Pigment moving through damp paper travels far
while the tonal structure stays put. The reference sizes it accordingly, and
the sizing is the port: one 13-tap downsample straight to **an eighth**, then a
separable 5-tap Gaussian at that eighth. The wash reaches thirty to forty
full-resolution pixels and costs three blits over 1/64 of the frame.

The width is what makes step 5b work. The bleed keeps the pixel's own luminance
and takes the *wash's* chrominance, and the wash's chroma has zero luminance by
construction — so **no amount of bleed can move a pixel's brightness.** Colour
runs a long way; every edge stays exactly where it was. That is "paint runs,
pixels do not" as algebra rather than as an intention, and the suite asserts it
to 5.55e-17 across the whole fog range. A tight blur would have made it a
smudge instead.

Two more properties worth having in a test rather than in a comment. The 0.09
bleed floor is deliberate — the reference's own note records that this was a
flat 20% everywhere and that putting it on *distance* was the fix, not deleting
it — so a little chroma runs even in the foreground. And the 0.85 is a
**ceiling**, not a saturation point: `fog · 0.85` never reaches 1, so the
strongest wash the print can apply is 0.357 and the furthest ridge still keeps
64% of itself. Bled, never erased, which is what leaves §8 axis 1 a silhouette
to find at the horizon.

### And then the measurement, which is why it ships switched off

The steps are correct. Their input is not. Only terrain, ocean and sky write a
real distance into alpha; §24 recorded that everything else writes 1.0, and
that finding was filed as future work because its consumer did not exist yet.
Its consumer now exists, so the cost is measurable. Local contrast, mean
`|∇luma|` on a 0–255 scale, seed 1337146641, `?m2=1` against `?m2=1&wash=1`:

| region | true distance | no wash | wash | change |
|---|---|---|---|---|
| near grass | ~2–30 m | 2.388 | 2.145 | −10.2% |
| the shrine | ~300 m | 6.684 | 4.675 | −30.1% |
| **the colossus** | ~400 m | 6.958 | 3.866 | **−44.4%** |
| far ridge | horizon, fog ≈ 1 | 1.447 | 1.232 | −14.9% |
| open sky | fog 1 | 0.590 | 0.562 | −4.8% |

**The depth cue is running backwards.** The two objects that should soften least
soften most, and the far ridge — the one thing in frame that genuinely is at
fog 1 — loses a third of what the colossus loses. Ordered by contrast, which is
what happens when every object reports the same distance, rather than ordered by
depth.

The colossus is not an incidental object either. §9.7 requires *"at least one
hero landmark in the opening frustum, with scale legible against a human-height
reference"*, and the landing solver of §23 exists to put one there. Losing 44%
of its local contrast is a §8 axis-1 failure aimed squarely at the thing the
previous two commits built.

So: `?wash=1`, default off **even under `?m2=1`**. §7.4 says build behind a
flag and make flipping the default a separate commit; this is the case that
shows why the rule is not ceremony. The step is finished, its suite is green,
and it waits for the input to become true rather than shipping a correct
transform over a wrong distance.

One guard came out of the same reasoning. `print.js` samples `uSoft`
unconditionally, and an unbound sampler reads as **white** in three — white
through the chroma bleed would drain the frame. `uWash` is 0 unless a chain is
bound, which makes the off state exactly nothing, by the same argument the
suite already proves for `uPaint = 0`.

### What this reorders

§24 filed the material fix — inject the aerial chunk into every surface-scale
material via `onBeforeCompile` — as worthwhile future work. It is now a
**prerequisite**, and it has two payoffs rather than one: it lets §9.4 step 5's
default flip, and it fogs objects that are not fogged at all today, which is a
§8 axis-3 defect that predates all of act 2. That is the next step, and it is
the last thing standing between M2 and its gate.

---

## 26 · Act 2 step 4's other half · why `planetscale.js` is not a wiring job

§16.5 lists step 4 as *"fog fraction into alpha; `planetscale.js` onto the same
function"*, which reads like two call sites and an afternoon. The first half is
done (§24). The second is not a port — it is a physics extension — and this
section is the argument, with the measurements, ahead of the code (§7.2).

### What `aerial()` assumes, and where planet scale breaks it

§9.3's horizontal axis is **distance**, and its vertical term reads only the
*shaded point's* height. Both are correct for the world the reference is:
a valley, a camera at eye height, a ray that spends its whole length inside the
boundary layer. Neither survives a camera in orbit.

The numbers, for `planetscale.js` as it stands — `R = 2600` render units for an
Earth-radius world:

| | |
|---|---|
| 1 render unit | **2450 m** |
| the haze layer, 260 m | 0.106 render units |
| `fogFar`, 1700 m | 0.694 render units |

So §9.3's curve saturates inside **one render unit**. Dropped in as written,
every tile more than about a unit from the camera returns fog 1, and the planet
renders as a flat disc of haze from any altitude at all. That is not a tuning
problem; the model is being asked a question about geometry it does not
represent.

The existing code already knows this, in its way: `uHazeK` carries an
`exp(−alt/(R·0.012))` factor that thins the fog as the camera climbs. It is
an approximation of the right thing, arrived at empirically, and it is why the
current fog looks acceptable from orbit.

### The fix is the same idea as the other two, a third time

§24's whole argument was that the horizontal axis is not distance, it is **how
much air the ray crossed**, and that at ground level those happen to be the same
number. Planet scale is where they stop being the same number.

For a straight ray whose altitude runs linearly from `y0` (camera) to `y1`
(surface) through an exponential atmosphere of scale height `H`, the mean of
`exp(−y/H)` along the path has a closed form:

```
mean = (exp(−y1/H) − exp(−y0/H)) / ((y0 − y1)/H)          y0 ≠ y1
     = exp(−y0/H)                                         otherwise
```

and the effective air path becomes `dn = dist · thickness · mean`. One
subtraction and two exponentials, no Chapman function, no divergence at the
horizon, and no special case — the `y0 = y1` branch is a removable singularity,
not a guard.

Measured, with `H = 260 m`:

| ray | mean density factor | effective air path |
|---|---|---|
| eye height (1.68 m) → ground | 0.9968 | 1689 m over 1700 m — **unchanged** |
| 100 m up | 0.8301 | |
| 2 km up | 0.1299 | |
| orbit, 400 km | 6.500e-4 | **260 m** over a 400 km ray |

Two of those rows are the argument.

The first says **surface scale does not move**: the factor is 0.9968 at eye
height, so §18's twelve pinned numbers change in the fourth decimal. Whether
that is inside the 2/255 gate is a measurement to take, not an assumption to
make, and it is the first thing to check if this is built.

The last says the model becomes *right* rather than merely bounded. Looking
straight down from orbit through the entire boundary layer, the effective path
comes out at 260 m — which is exactly `H`, because the column density of an
exponential atmosphere is `∫exp(−y/H)dy = H`. The formula reproduces the
textbook result without being told it, which is the check that it is the correct
integral rather than a curve that happens to fall off.

### What needs deciding before it is built

1. **`hf` would then be double-counting.** The reference's height term already
   attenuates by the *shaded point's* altitude. The two-endpoint mean subsumes
   it and does so more correctly. Removing `hf` is a change to a §9.3 literal,
   which §9 says the reference wins on — so this needs an explicit ruling, not
   a quiet deletion. My recommendation: keep `hf` at surface scale where it is
   the reference's own, and let the mean factor replace it only above some
   altitude, cross-fading — which is ugly, and is why this wants a human.
2. **The unit conversion has to live somewhere.** `thickness` is currently
   dimensionless because both scales happened to work in metres. Planet scale
   works in render units, so either `thickness` absorbs `metresPerUnit` or
   `aerial()` grows a unit. The former keeps the signature; it also makes
   `thickness` mean two things.
3. **It changes the surface scale's output.** Small, but §2.3 and §18 both have
   pinned numbers over it, and §7.7 re-scores every previous milestone.

### Status

`planetscale.js` keeps its existing fog. `aerial()` gained the one change this
needs and that stands on its own — **`height` is now an explicit parameter
rather than `P.y`**, because at planet scale the camera sits at the origin and
up is radial, so a tile's world y is its *latitude*. Deriving height from `P.y`
there would put a pole 6371 km above the haze layer. Every caller knows its own
geometry and this function should not have to guess; `surface.js` passes
`vW.y − uAirBase` and nothing else changed.

The parity gate caught the one place that mattered while this landed. The probe
in `tools/pixeldiff.js` was passing raw `P.y` where a real call site passes
`vW.y − uAirBase`, which agreed on five worlds and diverged on the sixth — the
only one with a non-zero datum — at **174.9/255**. A gate that only ever agrees
is not measuring anything.

---

## 27 · Act 2 step 4's foreground · a real distance for every surface-scale material

**Plan only. §7.2 — designed here, ahead of the code, and it needs a sign-off
before any of it is written.**

§24 closed step 4 for the background and left it open for the foreground, with
the reason: *"everything that is not terrain, ocean or sky writes 1.0 by
default."* §25 then measured what that costs and found the depth cue running
**backwards** — the wash softens the colossus at 400 m by 44.4% and the horizon
by 14.9%. That is the §8 axis-1 failure that keeps `?wash=1` switched off.

The alpha channel is the smaller half of this. The larger half is that
`scene.fog` is unset at surface scale — the string `.fog` does not occur
anywhere in `src/` — so **nothing except terrain, ocean and sky is fogged at
all**. A conifer at 900 m stands at full contrast against ground behind it that
has gone 87% to haze. That is a §8 axis-3 defect and it predates all of act 2.

### 27.1 · What is actually there, counted

Surface scale, seed 1337146641, `?m2=1`, 1280×720 — **166 drawable objects**,
against §5's ≤ 900 draw calls:

| material class | objects | instances | tris | alpha today |
|---|---|---|---|---|
| `MeshStandardMaterial` opaque — `Mesh` 65 + `InstancedMesh` 11 | 76 | 1 715 | 50 542 | **1.0** |
| `ShaderMaterial` opaque — `Mesh` 7 + `InstancedMesh` 2 | 9 | 42 | 128 262 | 2 call `aerial()`; 7 write **1.0** |
| `SpriteMaterial` — 25 additive, 20 normal | 45 | 45 | 90 | coverage |
| `ShaderMaterial` transparent — `Mesh` 10 + `InstancedMesh` 1 | 11 | 6 734 | 42 160 | coverage |
| `Points` — `PointsMaterial` 11 + `ShaderMaterial` 1 | 12 | 12 | 1 816 | coverage |
| `MeshBasicMaterial` — all transparent | 8 | 1 116 | 3 754 | coverage |
| `LineBasicMaterial` transparent, additive | 4 | 4 | 14 | coverage |
| `MeshStandardMaterial` transparent | 1 | 1 | 2 | coverage |
| **total** | **166** | | **226 640** | |

And the channel those write into, read back composited by `tools/alphaudit.js`:

```
alpha range [0.00000, 1.55191] · above 1: 203 px (0.039%) · NaN 0 · below 0: 0

  0.00-0.05  35.003% #########################
  0.05-0.95   3.087% ##                        ← 18 bins, all of them together
  0.95-1.00  61.864% ############################################
```

Bimodal, and the middle is where every mid-distance object in the frame ought to
be. `1.0` is not a small error either — it is the *largest possible* one:

| true distance | true fog | written today | error |
|---|---|---|---|
| 60 m | 0.0000 | 1.0000 | **1.0000** |
| 200 m | 0.1371 | 1.0000 | 0.8629 |
| 400 m — the colossus | 0.4743 | 1.0000 | 0.5257 |
| 900 m | 0.8701 | 1.0000 | 0.1299 |
| 1400 m | 1.0000 | 1.0000 | 0.0000 |

The wash is not misbehaving. It is reading this table.

### 27.2 · Two mechanisms, because there are two kinds of shader

**`applyAerial(material, uniforms)` — for three's built-in materials**, by
`onBeforeCompile`. `MeshStandardMaterial`, `MeshBasicMaterial`, `PointsMaterial`
and `SpriteMaterial` are assembled from `#include` chunks, and the hooks are the
tokens rather than the chunk text — so nothing of three's is reproduced and
nothing has to be kept in step with it.

**The existing include-and-call — for hand-written `ShaderMaterial`s.** Those
have no `#include` tokens to hook, and `surface.js` already shows the pattern:
paste `AERIAL_GLSL`, call `aerial()`, merge `aerialUniforms()`. Of the ten
distinct `ShaderMaterial`s at surface scale, two already do this — terrain and
ocean — and the other eight need it by hand at their own call site. Two
mechanisms, each simple, rather than one that has to cover both.

`onBeforeCompile( parameters, renderer )` is called at `three.module.js:30552`,
*before* `acquireProgram`, so `parameters.vertexShader` and
`parameters.fragmentShader` are the raw `ShaderLib` strings with every
`#include` intact. The hooks:

| | token | why this one |
|---|---|---|
| vertex | `#include <fog_vertex>` | the **last** include in all four vertex shaders, so everything each one computes is in scope |
| fragment | `#include <opaque_fragment>` | where `gl_FragColor` is first assigned, and it is *before* `tonemapping_fragment` and `colorspace_fragment` — so the mix is in linear light whatever the renderer's tonemap is set to |

Both are appended after, never replaced:

```js
shader.fragmentShader = shader.fragmentShader.replace(
  '#include <opaque_fragment>', '#include <opaque_fragment>\n' + AERIAL_CALL);
```

`#include <fog_fragment>` was the obvious candidate and is the wrong one: it
sits *after* `colorspace_fragment`, so it is only linear by the accident that
this pipeline's render target does not convert. `opaque_fragment` is linear by
construction.

### 27.3 · Where a world position comes from, per material class

Three provides one for **none** of the four. `worldpos_vertex` is included in
`meshbasic`, `meshphysical` and `points`, but its whole body is behind

```glsl
#if defined( USE_ENVMAP ) || defined( DISTANCE ) || defined( USE_SHADOWMAP ) || defined( USE_TRANSMISSION ) || NUM_SPOT_LIGHT_COORDS > 0
```

and AEON satisfies none of those — `shadowMap` does not appear in `src/` at all,
because §22's sun shadow is its own pass with its own sampler. So `worldPosition`
does not exist in any of these programs, which is both the problem and a small
mercy: there is no name to collide with.

One varying, `vAirW`, four bodies, all at the same token:

| class | body at `#include <fog_vertex>` | note |
|---|---|---|
| `MeshStandardMaterial` | `worldpos_vertex`'s own arithmetic, replicated: `transformed` → `batchingMatrix` → `instanceMatrix` → `modelMatrix` | after `skinning_vertex`/`morphtarget_vertex`, so deformation is included |
| `MeshBasicMaterial` | identical | |
| `PointsMaterial` | identical — `begin_vertex` runs, so `transformed` exists | one position per *point*, §27.5 |
| `SpriteMaterial` | `modelMatrix[3].xyz` | there is no `transformed`; §27.4 |

Height is `vAirW.y − uAirBase`, which is what `surface.js` passes and what the
new fifth parameter is for. No second varying.

`cameraPosition` is already in three's fragment prefix (`three.module.js:20065`),
so `aerial()`'s third argument costs nothing. The sun does not exist there, so
the injected preamble declares `uniform vec3 uAirSun;` — inside the `uAir`
namespace `aerial.js`'s header reserves, and **not** added to `AERIAL_GLSL`,
whose signature is fixed because `surface.js` and `planetscale.js` both call it.

### 27.4 · The billboard question, answered with numbers

Three builds a sprite's quad in **view space**:

```glsl
vec4 mvPosition = modelViewMatrix[ 3 ];     // the sprite's origin, view space
...
mvPosition.xy += rotatedPosition;           // the quad, expanded in view space
gl_Position = projectionMatrix * mvPosition;
```

`position.xy` is a screen-space extent, not a model-space offset. The corners of
a billboard therefore **have no world position at all** — they are an angular
size standing in for an object. The only world point a billboard denotes is its
origin, `modelMatrix[3].xyz`, and that is what it should be given. This is a
structural fact about billboards, not a shortcut.

The question that remains is how wrong a *constant* fog over the quad is, and
AEON's sprites are not small — measured, world radius against distance:

```
  r = 60.0 m  d =  60 m  r/d = 1.00        r = 119.4 m  d = 331 m  r/d = 0.36
  r = 96.2 m  d = 166 m  r/d = 0.58        r = 221.5 m  d = 15.5 km
```

So the bound has to be measured rather than asserted. Running the shipped
`aerial()` over the quad's true extent and putting both ends through §9.4:

| billboard | r | worst printed error | at |
|---|---|---|---|
| settlement lamp | 0.8 m | **1**/255 | 70 m |
| traveler lantern | 1.6 m | **2**/255 | 990 m |
| megafauna eye | 2.4 m | **1**/255 | 100 m |
| largest object sprite in frame | 3.8 m | **3**/255 | 570 m |
| a hypothetical 6 m billboard | 6 m | 5/255 | 1050 m |
| a hypothetical 10 m billboard | 10 m | 7/255 | 930 m |

The error is dominated by the *height* term, not the distance one — §9.3's mist
pool runs `smoothstep(46 → 8)` in height, so a tall sprite has genuinely more
mist at its feet than at its head, and a constant fog cannot express that.

**Ruling.** A sprite takes the fog of its origin, and `applyAerial` enforces a
world-radius bound, throwing when a call site exceeds it rather than looking
slightly wrong. Recommended bound: **4 m**, because that is where the curve
crosses this repo's own 2/255 gate, and because every sprite in the scene that
represents an *object* is under it — the largest is 3.8 m.

That bound is affordable only because of a second measurement: **every
larger-radius billboard in the scene is either atmosphere or outside the
atmosphere.**

| | r | what it is | ruling |
|---|---|---|---|
| `weather.js:63` veils | 60–120 m | rain and mist curtains | **not fogged** — it *is* the air |
| `_buildClouds` points | 150–260 m | the cloud deck | **not fogged**, and above the haze layer |
| `_buildCityGlow` | 450 m | a glow already standing in for haze | **not fogged** |
| `godrays.js` corona | 700 m | shafts in air | out of scope, another agent |
| `flare.js` | 3–60 m, camera-locked | a lens, not a place | **not fogged** |
| constellations, night stars | 1300 m at 13 km | outside the atmosphere | **not fogged** |

Fogging air with air double-counts. The large-radius case does not arise, and
the bound makes that a rule the next module inherits rather than a coincidence
this one enjoys.

### 27.5 · `Points`, and why one position per splat is the right answer here

A `Points` cloud has one position per *point* and one vertex per splat, so
`vAirW` is warp-coherent across the whole splat — the same property §M3 credits
for making the wind field's analytic fallback nearly free. There is no
per-fragment world position to be had without reconstructing one from
`gl_PointCoord`, which would be inventing geometry the primitive does not have.

With `sizeAttenuation: true`, `size` is in world units, so §27.4's bound applies
unchanged. Measured sizes at surface scale: `0.32, 0.5, 1.1, 1.1, 3.5, 220 ×4,
300, 520`. Everything at or under 3.5 (radius 1.75 m, **≤ 1/255**) is fogged;
the 220s are festival and beacon glows and the 300/520 are the cloud deck, all
of which §27.4 already excludes.

### 27.6 · Alpha, where coverage and distance collide

This is the part with no free answer, and the plan should say so.

**Opaque draws — alpha is free.** `opaque_fragment` is
`#ifdef OPAQUE diffuseColor.a = 1.0; #endif`, and `OPAQUE` is set when
`transparent === false && blending === NormalBlending && alphaToCoverage === false`
(`three.module.js:20852`) — exactly the materials for which blending is
*disabled*. Nothing downstream reads that alpha as coverage, so writing the fog
fraction into it costs nothing and is simply correct. **76 of the 166 objects**,
and they are the ones that occupy real screen area: buildings, trees, rock,
creatures, the colossus.

**Transparent draws — alpha is coverage, and it cannot be both.** Three blends
`NormalBlending` as
`blendFuncSeparate(SRC_ALPHA, ONE_MINUS_SRC_ALPHA, ONE, ONE_MINUS_SRC_ALPHA)`:
the alpha channel's source factor is `ONE`, so `a_dst = a_src + a_dst(1 − a_src)`.
Writing a fog fraction there does not merely mislabel the pixel, it changes the
composite. So transparent draws get their **colour** fogged and leave alpha
alone.

**Additive draws — the 0.039%.** `AdditiveBlending` is `blendFunc(SRC_ALPHA, ONE)`,
non-separate, so an additive sprite adds `a·a` to the channel; that is the
1.55191. §24 clamped it in `print.js`, at the one place the value is read. The
source fix is one line per call site: `CustomBlending` with the same colour
factors and `blendSrcAlpha = ZeroFactor, blendDstAlpha = OneFactor`, which
leaves alpha exactly as the geometry behind wrote it. Identical colour output,
and it is the right semantics — **a glow adds light; it does not change how far
away the thing behind it is.** The clamp in `print.js` stays as the belt.

So three buckets, and the classification is by *what the draw is*, not by which
flag it happens to carry:

| bucket | colour | alpha | who |
|---|---|---|---|
| **solid** | fogged | fog fraction | 76 opaque meshes, opaque `ShaderMaterial`s |
| **veil** | fogged | untouched (`ZERO, ONE`) | transparent foliage, creature sprites, lamps, motes |
| **lens / sky / air** | untouched | untouched | flare, godrays, clouds, weather, city glow, constellations |

### 27.7 · §5, counted before the feature

**Draw calls affected: ~120 of 166** — 76 opaque `MeshStandard` plus 1
transparent, 8 `MeshBasic`, 10 `Points` (12 less the two cloud layers), ~6
object sprites (45 less 7 flare, 20 weather, 3 city glow, 4 constellation and
the five at 15 km), and the 18 `ShaderMaterial` draws that need hand-wiring.
§5's ceiling is 900 and **none of this adds a draw** — it adds work inside draws
that already happen.

**Per fragment:** `aerial()` is one `length`, one `pow`, two `exp`, two
`smoothstep`, four `mix` and a `dot` — call it ~40 ALU and three transcendentals.
The two draws that already pay it, terrain and sky, are also the two that cover
most of the frame, so the marginal coverage is the foreground's — a minority of
the frame at 1280×720. **Per vertex:** one `vec4` transform and one varying.

**Programs: 33 today.** `getProgramCacheKey` folds in
`material.customProgramCacheKey()`, which defaults to
`onBeforeCompile.toString()` — so every material sharing one hook function
shares a key, and the four classes already differ by `shaderID`. At most one
extra program per class. **The rule that keeps it there: every option goes in a
uniform, never into the emitted source.** A hook that interpolates a per-site
constant would mint a program per site.

None of this is a measurement. The measurement is `?bench=1` before and after,
and `perf` has veto.

### 27.8 · Risks

1. **Token drift.** The hooks are vendored-`three`-r170 strings. `applyAerial`
   throws if a token is absent, so a re-vendor fails loudly at init rather than
   silently not fogging. `tools/shadercheck.js` compiles post-assembly (§M0).
2. **Double fogging.** Terrain and ocean already call `aerial()`. `applyAerial`
   refuses any material whose fragment source already contains `aerial(`.
3. **Transparent sort order.** Fogging a veil changes its colour, not its depth,
   so sorting is untouched — but the `CustomBlending` swap in §27.6 changes a
   material's blending *identity*, and three sorts transparent draws by depth
   rather than by blend mode, so this should be inert. To be verified, not
   assumed.
4. **Night.** §24 ruled that extinction does not care whether it is night and
   only in-scattering goes to zero. The foreground inherits that for free; the
   thing to watch is emissive windows at dusk, which are §M6's best moment and
   must not be washed out by haze they are only 300 m into.
5. **`?wash=1` is the consumer.** If this lands and the wash ordering is still
   backwards, the fault is elsewhere and the change should not be defended on
   its own numbers.

### 27.9 · Validation (§7.3), and the gate

Offline first, in this order:

1. **`tools/verify.js` — a new `airmat` suite.** The billboard bound table of
   §27.4 as assertions with the printed-step numbers reported; that the bucket
   classification of §27.6 is *total* (every surface-scale material class lands
   in exactly one bucket); and that a solid writes fog while a veil preserves.
2. **`tools/pixeldiff.js`, extended.** Its existing probe hands `AERIAL_GLSL` to
   `shaderSource` verbatim. The new risk is not the arithmetic, it is the
   *injection* — so the probe grows a mode that assembles a real
   `MeshStandardMaterial` through `applyAerial` and compares the readback
   against the same CPU twin. Same 2/255 gate, 4096 cases, six worlds.
3. **`tools/alphaudit.js`** — the before/after in §27.1. Pass conditions:
   **0 pixels above 1**, and the 0.05–0.95 middle carrying the frame's
   mid-distance geometry rather than 3.087%.
4. **The contrast measurement of §25, re-run with `?wash=1`.** The ordering must
   invert: near grass softened least, the horizon most, and the colossus between
   them rather than above them.
5. **`?bench=1`** before and after, all three tiers.

Built behind **`?airmat=1`**, default off, per §7.4 — and flipping the default
is a separate commit, as is flipping `?wash=1`'s.

**Rollback** is one flag and one import per call site; with the flag off,
`applyAerial` returns the material untouched and no `onBeforeCompile` is
installed, so the program cache key is unchanged and the build is bit-identical.

### 27.10 · What this plan does not decide, and wants a human on

- **The 4 m billboard bound** (§27.4). Derived from the 2/255 gate, but it is a
  policy: it says a future module may not add a large object billboard without
  coming back here. Confirm or move it.
- **Whether the cloud deck should haze.** §27.4 excludes it because a 260 m
  splat cannot carry a fog gradient, not because distant clouds should stand at
  full contrast. The right answer is probably per-vertex fog on a real cloud
  mesh, which is cloud work and not this.
- **The `CustomBlending` swap** in §27.6 touches the look of every additive
  element by changing nothing about its colour — but it is a change to
  forty-one draws to fix 0.039% of one channel, and `print.js` already clamps.
  It may be worth doing later, separately, or not at all.

---

---

# M3 · Wind and grass

**Scale:** atmosphere — surface, and everything standing on it.
**Modules:** new `wind.js`, new `flora.js`; `grass.js`, `life.js`, `weather.js`, `settlement.js`, `clouds.js`, `godrays.js`, `festival.js` become consumers.
**Flag:** `?wind=1`, default-off (§7.4).

§M3 calls this *"the milestone the reference exists to teach."* That is not
decoration. Everything §9 asks for — the light, the print, the air — is about
how a still frame looks. This is the one about whether the place is *happening*.

---

## 0 · Sequencing, and the M2 clause this steps over

§6 says do not begin M(n+1) until M(n) passes its gate, and M2 has not. Its
materials half was never built: §M2 asks for four-layer triplanar procedural
materials and an 8–12 wave Gerstner ocean, and neither exists. What M2 delivered
was the print (act 1), the air (act 2) and the light model (act 3) — the three
things that change how everything else is *lit*, not what it is *made of*.

Starting M3 anyway is a deliberate call, made on a request, and there is a real
argument for it beyond the request:

**It is the same argument M2 made about its own ordering.** M2's plan put the
print ahead of §9.2 and §9.3 because *"everything downstream gets tuned against
the viewing transform"* — land it last and the light model is tuned twice. Wind
has the same relationship to materials. A material is judged by how it behaves
under moving light and moving geometry; tuning a four-layer blend against a
static frame and then setting the whole meadow in motion means tuning it twice.

**And the measurement says so.** §30 found global contrast has fallen 37% across
M2 and could not say how much of that is intended compression versus a defect,
because the frame it measured is a *still*. Grass in motion changes the
statistics of every frame it appears in. Building materials against numbers that
are about to move is building against the wrong numbers.

What this does **not** license: regressing M2. §7.7 still applies — every
previous milestone gets re-scored before M3's gate, and the four M2 gates that
do hold (§2.7 parity, the aerial suite, the print suite, the shadow-hue clause)
stay green throughout.

---

## 1 · What is there now, measured

A surface world builds **seventeen** systems and **fifteen** of them animate. The
worlds are not empty; that was the first hypothesis and it is wrong.

Every one of those fifteen `update()` calls receives the same two arguments:
`dt`, and the sun's height. Nothing else. Fifteen loops, sharing exactly one
variable — what time of day it is.

There *is* a wind, and it is better shared than expected: `grass.js`,
`festival.js`, `godrays.js`, `weather.js` and the ocean shader all sample it.
But it is this:

```js
const windAng = new RNG(hash(pp.seed, 0x817d)).float(0, 6.28);
this.wind = new THREE.Vector2(Math.cos(windAng), Math.sin(windAng));
```

**One constant vector.** One direction, one strength, everywhere on the world,
for the whole of time. No gusts, no spatial variation, no temporal variation, no
terrain interaction. And what the grass does with it is a travelling sine:

```glsl
float front = sin(dot(aRoot.xz, uWind) * 0.045 - uTime * 1.9 + aPh * 0.4);
```

Periodic, therefore learnable, and the eye learns it in about four seconds —
after which it stops reading as weather and starts reading as a screensaver.
§M1's gate demands "no perceptible loop" of the cosmic web and the surface has
no equivalent clause, which is how this survived.

Meanwhile the trees flap on `sin(uTime * 6.5 + phase)` — a private oscillator,
unrelated to the wind bending the grass at their feet. Ten of the fifteen
systems do not sample wind at all.

**That is the whole diagnosis.** Not "too little is happening" but "everything
is happening independently." A world where fifteen things move on fifteen clocks
is a diorama; a world where one gust crosses the frame and *everything* leans is
a place.

---

## 2 · The port · one field, three ingredients

From the reference's §5, which is the model §M3 describes. Ported as technique,
not as file (§10).

**The mean flow meanders.** An Ornstein–Uhlenbeck process on speed and
direction, `k = 1 − exp(−dt/25)` and `1 − exp(−dt/40)`, bounded to ±34% of speed
and ±0.34 rad of direction. Not a sine — an integrating random walk that pulls
toward a base. It is what makes the wind never quite repeat.

**Six gust cells ride downwind at 1.25× the mean.** Each is three profiles
multiplied:

```
head = smoothstep(0.14, 0.0, u)              a sharp leading edge
body = exp(u · 2.05)                         an exponential tail behind it
cw   = exp(−(|cross − c| / (wid/2))^2.3)     cross-wind falloff
```

`u` is the along-wind station in cell lengths, so the cell is a *front* — it
arrives, it passes, it leaves. §M3 names this as the ingredient that makes wind
read as weather rather than as noise, and the sharp edge is the reason: a gust
you can see coming across the meadow before it reaches you.

Each cell also carries a `veer`, so the direction rotates as it arrives. A gust
that only changes magnitude reads as a volume knob.

**Turbulence, advected with the flow.** Two octaves sampled at
`(x − v·t)` — Taylor's frozen-turbulence hypothesis, eddies carried along by the
mean rather than wobbling in place. Cheap, and the difference between "the air
is moving" and "the air is textured".

**A logarithmic boundary layer**, normalised to 10 m:
`log((max(h, 0.015) + 0.06) / 0.06) · 0.19523`. Roots barely move, tips whip.
Everything that stands up gets this for free and it is what makes a blade look
rooted rather than floating.

---

## 3 · What cannot port: `Math.random()`

The reference's `updateWind` calls `Math.random()` five times per cell
respawn. §2.3 forbids it outright — *"No `Math.random()`, no `Date.now()`, no
un-seeded `performance.now()` in any generation path."*

The obvious reading is that wind is animation rather than generation and the
clause does not reach it. That reading is wrong here, for two reasons:

1. **§2.4 says every place is a URL.** A shared link should land on the same
   world in the same weather. "Same seed, different gusts" is a smaller break
   than a different coastline, but it is the same kind of break.
2. **It would poison the instrument.** This session has already lost real time
   twice to frames that were not reproducible — once to an unpinned `dt`, once
   to a bisect that could not re-render. Adding a genuinely random field to the
   one system that touches every other system would make every future capture
   comparison unreliable, permanently.

**Ruling: the wind is a pure function of `(seed, t)`.** Cell respawns draw from
`RNG(hash(seed, 0x77d, cellIndex, generation))`, and the OU meander is driven by
a deterministic value noise in `t` rather than by a random walk. Same seed and
same elapsed time gives the same air on every machine, forever. It is stricter
than the reference and it costs nothing.

---

## 4 · Two faces, and the parity between them

The field has to exist in two places at once, exactly as the reference has it:

- **On the GPU**, as a 256² render target over a 440 m span, so twelve million
  grass vertices can each read it in one texture fetch.
- **On the CPU**, so smoke, birds, herds, the camera and audio can ask what the
  wind is at a point without a readback.

That is the same two-implementations-of-one-function shape as §2.7's height
field, and §2.7's history is the reason to take it seriously: that pair drifted,
was never tested, and when finally tested failed by 46×. §11 calls it out by
name — *"will look like a rendering bug and cost a day."*

**So the parity test comes first, not last.** `tools/pixeldiff.js` already has
the harness and two suites; the wind gets a third, comparing `WIND_GLSL` against
`windAt()` over 10⁴ points at a spread of heights and times, to the same 2/255
gate. Written before either implementation is wired to anything.

Beyond the render target's edge, an **analytic fallback** blended on an edge
mask, so gust bands still roll over the far hills. §M3 notes the fallback branch
is warp-coherent — all of a blade's vertices sample one point — which is what
makes it nearly free.

---

## 5 · Who drinks from it

The fifteen animating systems, in the order they should be converted:

| system | today | after |
|---|---|---|
| `grass.js` | travelling sine on a constant vector | the field, per blade, with the boundary layer |
| `life.js` foliage | private `sin(uTime · 6.5)` | the field at the canopy's height |
| `settlement.js` smoke | own timer | leans and disperses downwind |
| `weather.js` rain | constant vector | the field, so squalls arrive with the gusts |
| `clouds.js` | own drift | the cloud wind — 2.35× and veered 0.19 rad |
| `festival.js` lanterns | constant + sine | the field |
| `godrays.js` motes | constant | the field |
| ocean | constant `uWind` | the field's mean, for the swell direction |
| herds, wildlife, megafauna, caravan | nothing | drift downwind; scatter on a strong gust |

The last row is where "alive" actually comes from and it is the cheapest: a herd
that drifts downwind and a flock that lifts when a front arrives cost almost
nothing and are *causality*, which is the thing fifteen independent loops cannot
fake.

---

## 6 · Budgets at risk (§5)

`perf` has veto and this is the milestone most likely to trip it.

| | |
|---|---|
| the field itself | one 256² pass per frame — trivial |
| grass | §M3's gate is ≥800k blades at ≥60 fps desktop, ≥30 fps mobile |
| per-blade sampling | one texture fetch in the vertex shader, warp-coherent in the fallback |
| the CPU mirror | called per creature per frame, not per vertex — bounded by herd counts |

§M3's density law is the load-bearing optimisation and it is not optional:
`blades/m²(d) = B·min(1, (dn/d)^1.5)` with `K = B·dn^1.5` held constant between
rings, so there is no density step anywhere and rings only switch tessellation.
Exponent **1.5** exactly — the shader evaluates it as `x·x·inversesqrt(x)`,
three single-cycle instructions against roughly ten for a general `pow()`, on
~12M vertices per frame.

And §30's measurement gets re-run: 12M vertices of moving grass will change
every frame's statistics, and `tools/tone.js` exists now precisely so that the
change has to be stated rather than absorbed.

---

## 7 · Sequence

| step | gate before the next | |
|---|---|---|
| 1 · `windAt()` on the CPU, with the suite | properties: gust fronts arrive and pass, the boundary layer is monotone in height, the field is deterministic in `(seed, t)` | **done** |
| 2 · `WIND_GLSL` + the 256² target | §7.3 pixel diff against step 1, ≥97% within 2/255 | **done, §10** |
| 3 · the analytic fallback and its edge mask | continuous across the target's border — no seam | **done, §11** |
| 4 · `grass.js` onto the field | §M3's gate: no density step, a legible front, blades ringing after it passes | |
| 5 · foliage, smoke, rain, cloud, lantern, mote | each a few lines; `tools/tone.js` re-run at the end | |
| 6 · creatures respond | drift downwind, scatter on a front | |

---

## 8 · Risks, and rollback

| risk | standing |
|---|---|
| the CPU and GPU fields drift | §2.7's exact failure. The parity suite is step 2's gate and runs in `check.js` from then on |
| §5 goes red on grass | `perf` has veto; the density law lands *before* the blade count rises, per §5's "add the LOD before the feature" |
| the field makes captures irreproducible | prevented by §3's determinism ruling; `&dt=` pinning stays mandatory |
| wind changes every frame's tone | measured by `tools/tone.js`, stated in the commit |
| M2's materials still owed | tracked, not forgotten; §7.7 re-scores M2 before M3's gate |

**Rollback** is the flag: `?wind=1` off restores the constant vector exactly, and
every consumer keeps its current code path until step 5 converts it. No consumer
is converted before the field it reads is green.

---

## 9 · Gate (§M3)

Verbatim from §6, with how each clause is measured:

- **≥800k blades ≥60 fps desktop, proportionate ≥30 fps mobile** — `?bench=1`, and it needs the real-GPU run.
- **No visible density step at any ring boundary** — the continuous density law makes this structural; verified by a radial histogram of blade counts.
- **A gust crosses frame as a coherent front with a legible leading edge** — a capture sequence, and the front's arrival visible as a step in `tools/tone.js`'s per-frame statistics.
- **Blades ring at their own frequency after the front passes** — per-blade phase, visible in a difference sequence.
- **The walker parts grass within 1.2 m** — already partly in `grass.js`; re-verified against the field.
- **Grass reads as meadow at the horizon, not a green plane** — §8 axis 1, scored on a still.

---

## 10 · Step 2, measured — and what the gate found on the way

### 10.1 · The seam moved, so that less of it can drift

§4 said the field has to exist twice and that §2.7's history is the reason to
take that seriously. Building it made a better move available than testing the
pair harder: **cut the field so that less of it is a pair.**

| half | where it runs | can it drift? |
|---|---|---|
| which lap each cell is on, its drawn parameters, the meandered mean flow | CPU only, once per frame, uploaded as 38 floats | no — one implementation |
| projections, three gust profiles, four octaves of advected noise, a rotation | both sides | yes — and this is what the suite gates |

`hash` and `RNG` never reach a shader. `windAt` became a two-line composition of
`windUniforms` and `windSample`, so the CPU path is not a reimplementation of
anything — it is the same `windSample` the shader mirrors, fed the same
uniforms the shader receives.

The advection product `v·t` is formed on the CPU too, in doubles. It reaches
fifteen kilometres after an hour, and a shader asked to form it would multiply
two large float32s on every one of twelve million vertices.

### 10.2 · The first run failed at 74%, and it was not the wind

```
FAIL t = 0      s 72.14% within 2/255  max 13.1758/255 = 1.74e+0 m/s
FAIL t = 86400  s 73.32% within 2/255  max 16.5642/255 = 2.18e+0 m/s
```

Time-independent, which rules out the float32 shelf life the sweep was built to
find, and the size of the whole turbulence term, which points at `snoise`. It is
**§28.5's seven zero-`h` gradient cells**: float32 and float64 land on opposite
sides of all seven, so the two faces of *any* field that samples this noise
disagree on about 18% of points by up to the noise's full range. Confirmed
directly — `snoise` against a float32 emulation of itself disagrees by >0.05 on
17–20% of samples at every coordinate magnitude from 1 to 4000.

§28.7 closed it on the integer path and left the default-off flip to a human,
because flipping `?intnoise=1` moves every world once and re-takes the `ground`
goldens.

**The wind pays none of that price.** It is new: no worlds to move, no goldens
to re-take. So it pins the exact gradient path on both sides — `snoise(…, true)`
in `wind.js`, `noiseGLSL(true)` in `windfield.js` — and `planet.js`'s chunk
became a builder taking the path as a parameter instead of reading the flag as a
module constant.

It is also the right place to insist. §3 refused a wind that differs between
machines when the cause was `Math.random()`; accepting the same thing from
`step(0.0, 0.0)` would be an odd place to stop.

### 10.3 · The gate, green

`node tools/pixeldiff.js --suite wind`, 10⁴ points × 6 moments, gate ≥97% within
2/255 of full scale (33.6 m/s):

| t | within 2/255 | worst | worst in m/s |
|---|---|---|---|
| 0 s | 100.00% | 0.0124/255 | 1.6e-3 |
| 7.3 s | 100.00% | 0.0108/255 | 1.4e-3 |
| 60 s | 100.00% | 0.0108/255 | 1.4e-3 |
| 600 s | 100.00% | 0.0046/255 | 6.1e-4 |
| 3600 s | 100.00% | 0.0121/255 | 1.6e-3 |
| 86400 s | 100.00% | 0.0510/255 | 6.7e-3 |

160× inside the gate at its worst, and the shelf life is visible rather than
asserted: the error grows 4× across five decades of elapsed time, because the
advected coordinate `x − v·t` grows linearly and float32 resolves a simplex cell
less finely as it goes. At a full day it reaches 4536, where the lattice is
resolved to about 1e-3 of a cell. That is the curve, and it is why the sweep is
in the suite rather than a single moment.

Observed peak |v| 10.14 m/s against the declared full scale of 33.6 — 3.3× of
headroom, measured rather than assumed.

The cases are chosen against the *branch*, not spread for the sake of spread:
the gust loop early-outs at `u > 0.16` and `u < -6.0`, which is the one place
two implementations can disagree by a finite amount rather than by rounding, so
four points sit exactly on those edges for every cell at every moment.

### 10.4 · Three defects the gate found in the instrument itself

None of them are the wind, and all three were live in `HEAD`.

1. **`pixeldiff`'s aerial runner sized its output target with `W, H`** —
   variables that exist in the *terrain* runner and nowhere near it. The whole
   default run died with `W is not defined` before printing a line, and the two
   suites that take an explicit `--suite` skipped past it, which is why it
   survived. Now `count, 1`, matching the viewport two lines below. The aerial
   suite is 6/6 again at 0.0001/255.

2. **The terrain suite's breakdown columns ignored `--int`**, comparing an
   integer GPU against a float CPU and reporting ~1.7 of disagreement in the
   same rows whose totals agreed to 1e-5. A diagnostic that contradicts the
   measurement it exists to explain is worse than no diagnostic. They now read
   1.7e-5 to 3.6e-3, consistent with the headline.

3. **Seed 913.25 failed the exit code, which §28.6 said in words it should
   not** — *"that stress row stays in the suite and stays failing"*, because
   `system.js` draws `noiseSeed` in 0..100 and 913.25 is deliberately outside
   it. The code never implemented the sentence, so a run behaving exactly as the
   plan describes still exited 1. It reports `open` now and carries its reason
   on the line below.

`tools/check.js` gains a `parity` step that runs `--suite terrain` on the
shipped float path as **known-open**, with §28.7's account attached. Split out
rather than folded into `pixeldiff`, because folding it in would take the aerial
and wind gates down with it and one `open` would be covering three questions —
which is how a known-open entry stops being an account of anything.

### 10.5 · The render target

`src/windfield.js`: 256² half-float, 440 m window, linear filtered, one pass per
frame, behind `?wind=1` with no consumers yet.

- **1.72 m per texel is not arbitrary.** The finest thing in the field is a gust
  front's leading edge — `smoothstep(0.14, 0, u)` over a cell length of 26 to
  60 m, so 3.6 to 8.4 m wide, two to five texels. Coarser and the fronts §M3's
  gate wants *legible* arrive as a step.
- **The window snaps to the texel lattice.** A sliding lattice makes a blade
  standing still read a different point every frame, which reads as a shimmer no
  filter removes because the error is in the sampling. `shadow.js` snaps its own
  centre for the same reason.
- **Half float, linear.** The dominant error is interpolation across a 1.72 m
  lattice, orders above 16-bit storage, and full-float linear filtering costs an
  extension mobile does not reliably have.
- **The pass writes metres per second, unnormalised.** No encoding to get wrong.
- **GLSL3, because the exact gradient path is written in integers** and GLSL ES
  1.00 has no `%`, no `ivec4` arithmetic, no integer division.

And a trap that cost a round: **three.js supplies no `gl_FragColor` shim in
GLSL3 mode.** It defines `varying` and `texture2D` unconditionally
(`vendor/three.module.js:20271-20279`) but suppresses the `pc_fragColor`
output and its `#define` exactly when `glslVersion === GLSL3`. Writing to
`gl_FragColor` compiles to `undeclared identifier`, three.js logs it and carries
on, and the target reads back as a field of **exact zeros** — which presents as
0% agreement and looks precisely like an addressing bug, the thing the check was
built to find. `collision.js` and `nbody.js` declare their own `out vec4` and
were the answer sitting in the repo the whole time. §11's "shader strings" trap,
one layer up: the string compiled fine in isolation and failed under the prefix
three.js wraps it in.

### 10.6 · And the target is gated, not just compiled

`--suite wind` now ends by constructing a real `WindField` through three.js,
rendering one pass with the camera 4.8 km off the origin, reading the target back
and comparing 2704 texels against `windSample`:

```
ok   the 256² target holds the same field — 100.00% of 2704 texels within 2/255
     max 0.0148/255 = 1.95e-3 m/s
```

That gates everything between the function and a texel — the GLSL3 compile, the
uniform upload, the half-float format, and above all the addressing, which is
written in two files that must be exact inverses. `verify.js` checks that
inverse arithmetically; only this checks that the pass and the sampler agree
about which world point a texel *is*.

It also covers a real gap rather than duplicating one. `shadercheck.js` compiles
every shader the bench route reaches, and on SwiftShader that route does not
reach the surface scale inside its 600 s timeout — 64 shaders, 0 failed, scales:
`planet`. On this machine nothing else would ever compile the wind pass.

---

## 11 · Step 3, measured — the fallback, and the seam that is not there

`windAny(vec2 P)` in `WINDTEX_GLSL`: the target inside the window, the analytic
field outside, a mask across the border.

```glsl
float m = windInside(P);
if (m <= 0.0) return windField(P);     // outside — analytic, warp-coherent
if (m >= 1.0) return windTex(P);       // inside — one fetch
return mix(windField(P), windTex(P), m);
```

§M3 says the fallback branch is warp-coherent — all of a blade's vertices sample
one point — *"which is what makes it nearly free."* Here that coherence is
structural rather than hoped for: a blade is comfortably inside, comfortably
outside, or in a 15 m band, and only the band evaluates both.

**The seam cannot show, and not because the width was tuned.** The target holds
`windField` sampled on a lattice, so the two sides of the mask are a function
and its own bilinear interpolant. The blend is very nearly a no-op.

The mask fades over the outer 3.5% of the window — about 15 m, the outermost
nine texels. That width is not margin for its own sake: bilinear filtering at
the very edge clamps, so the last half-texel is a repeat of the field rather
than the field, and the fade has to finish before it.

### 11.1 · The gate

A ray from the window centre outward past the border to 420 m, at 0.4 rad —
off-axis on purpose, because a 45° ray leaves through a corner and crosses both
edge masks at once, which is the easy case.

```
ok   and the fallback leaves no seam — 1024 samples along 420 m,
     out through the border at 223.3 m
     largest step between adjacent samples 5.57e-2 m/s at 166.1 m,
     against a median of 1.81e-2  (3.08x, gate 6x)
     and windAny tracks the field the whole way: max 0.0853/255 = 1.12e-2 m/s
```

The measure is deliberately **relative**. A seam is a step that stands out from
the field's own variation, so an absolute threshold cannot tell a seam from a
gust; the gate is the largest adjacent step against the median adjacent step on
the same ray.

And the strongest line in that output is the location: the biggest step is at
**166 m**, inside the window, nowhere near the border at 223 m. The border does
not appear in the ranking at all.

The addressing lives in `wind.js` rather than `windfield.js` so `verify.js` can
reach it without a browser, and three checks hold it: the window is a whole
number of texels centred on the camera, a sub-texel step does not move the
lattice, and the pass's `origin + uv·span` and the sampler's `(P − origin)/span`
are exact inverses at every texel centre tried. An offset here would look like
the wind blowing from the wrong bearing and would be chased in the wrong module.

**Not yet built:** the analytic fallback beyond the window's edge and its blend
mask — step 3, gated on the seam. Sampling outside currently clamps to the edge,
which is invisible with no consumers and would be very visible with them. Step 4
is the first step that may read this.
