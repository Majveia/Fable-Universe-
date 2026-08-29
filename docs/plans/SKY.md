# The sky reaches the ground

**Three flags:** `?cshade=1` · `?wetline=1` · `?shafts=1`. All default-off (§7.4).
**Written after the fact for the first act and alongside the other two** — said
plainly here because `docs/plans/M4.md` and `M7.md` had to be marked the same way
and a retrospective plan pretending to be a prospective one is a lie in the
repository's own record.

---

## 0 · Why

The universe has more life in it than a reading of the module list suggests. The
day turns (`surface.js` — `sunPhase += dayRate·dt`). Night has a palette built
around airglow at 0.0006 lux. Squalls cross the country and mist pools in the
folds at dawn. Herds graze the high ground, a caravan walks the road out of
town, sky-lanterns go up on festival nights, and every world's people drew their
own constellations.

And a cumulus deck hung over all of it, drifting on the same wind that moves the
grass, casting **nothing**. `clouds.js` had written down that this was a hole and
exported `CLOUD_FIELD_GLSL` to fill it:

> One field decides two things: whether a puff is drawn at all, and — when
> `surface.js` grows a shadow pass — where its shadow falls. The reference makes
> that identity explicit and it is the right invariant: **a shadow must always
> belong to a cloud you can point at.**

Nothing ever took the field.

Three acts, and they are one system rather than three features. The couplings
are the argument for doing all of them:

1. A cloud shadow crossing a **wet seam** snuffs a silver thread and relights
   it, because the sheen on wet ground is specular and dies when the beam
   leaves. Neither act does that alone.
2. A **shaft** and the bright patch at the bottom of it are one function, so the
   gap that made the beam is overhead where you can look at it.
3. The **star** sets all of it: one angle, `atan(rStar/a)`, decides the softness
   of the shadow, the softness of the shaft, and how much of the field survives
   into either.

---

## 1 · Act I — the deck touches the ground

`src/cloudfield.js` (new) · `src/cloudshade.js` (new) · `clouds.js` ·
`surface.js` · `flora.js` · `horizon.js` · `life.js` · `traveler.js`

**One field, shared by reference.** `surface.js` owns `uCloudDrift`,
`uCloudAmount` and `uCloudThick` and hands the same objects to `makeCumulus` and
to every ground shader. There is no second field that could drift out of sync,
because there is no second field.

**The field moved to a three-free module** so `cloudshade.js` can be tested in
Node — the property `material.js` and `meadow.js` have, bought the same way.
`clouds.js` re-exports it. `cloudFieldRaw()` exposes the field before its
transition, so the deck and its shadow can disagree about the edge while
agreeing about everything else.

**The penumbra belongs to the star.** `surface.js` already computed this star's
true angular radius and then tripled it for the painted disc (§9.6 draws the
disc oversize on purpose); a penumbra is measured rather than drawn, so it takes
the un-exaggerated angle.

| star | θ | penumbra at 900 m | octaves | blur |
|---|---|---|---|---|
| Sun, 1 AU | 0.2665° | 8.4 m | 3·4·3 (all) | 0.14 |
| M dwarf 0.3 R☉, 0.1 AU | 0.80° | 25 m | 3·4·3 | 0.15 |
| white dwarf, 0.1 AU | 0.035° | 1.1 m | 3·4·3 | 0.006 |
| red giant 25 R☉, 1 AU | 6.63° | 209 m | 2·2·1 | 1.00 — no edge at all |

**The blur blends toward the mean; it does not widen the smoothstep.** Widening
was the first version and it was a bias wearing a penumbra's clothes: the
transition is centred on 0.1325 and the field's mean is 0, so a wider transition
raised coverage everywhere and a red-giant world came out uniformly 35% darker
with no shadow in it. A low-pass converges on the local mean, so that is what it
does, and the mean is preserved at every blur.

**It composes into `sunShadow()`**, at the definition rather than at a dozen call
sites. Every lit surface already asks one question — how much of the beam reaches
this point — and a deck overhead is an answer to it. Terrain, grass, foliage,
bark, props, figures, herds and the far ridges got the deck without one call site
changing. A shadow that stopped at the grass line because a consumer was
forgotten would be worse than no shadow; this makes that impossible rather than
merely unlikely.

**On grass** the shadow moves the blade *down its own ramp* onto the shade stop —
a hue change, not a brightness drop, which is what §9.2 means. The wind flash
needs a sun to flash, so a gust crossing a shadowed stretch still lays the blades
over and simply does not glint. The skylight rises as the beam falls, because an
overcast dome scatters more down than a clear one.

---

## 2 · Act II — the ground remembers the water

`src/drainage.js` (new) · `material.js` · `surface.js`

`matMoisture()` knew height above sea, distance to shore, and one global rain
scalar. All three are functions of altitude, so between them they cannot tell a
hollow from the shoulder above it — the one pair a valley is made of.

`hydrology.js` already solves this globally at a couple of hundred kilometres a
cell. `drainage.js` runs the same algorithm — priority flood, then D8 — on the
landing tile, off `ground.js:heightAt()`, which is the field the shader draws.

Four channels, each a physical quantity:

- **flow** — log-normalised contributing area
- **wetness** — the topographic wetness index `ln(a / tan β)`, which is the one
  that knows a broad flat hollow draining a hillside stays wet while a steep
  gully draining the same hillside does not
- **silt** — with flow, against gradient; a stream drops what it carries when it
  slows
- **wash** — a channel that is *steep for this landscape*: water passes through
  a steep channel and lingers in a flat one, so gradient is what separates a
  scoured gully floor from a boggy bottom draining the same hillside

`material.js`'s sward weight already rose with moisture, so the green follows the
water by itself. `uWet` stopped being a scalar — after rain the entire visible
world used to go slick at once and dry at once.

**Cost, measured:** 153 ms in the browser on Orir, 177–360 ms across five
worlds in Node on a loaded machine. The sampling is the cost, not the solve —
`heightAt` is about 136 ms of it and the flood plus D8 is 48. The resolution
table is in the module.

**Two defects the measurement found, both of which read fine.** The wetness
index was normalised min-to-max, and `ln(a/tan β)` is long-tailed — one cell at
the tile's outflow carries every drop on it — so a single extreme set the top of
the range and left 0.1% to 2.4% of a tile above 0.7. A wet line one cell wide,
or none. Clipping to the 2nd and 98th percentiles puts it at 11.7% to 30.9%
above 0.5.

And the braid never fired once. "High flow, low wetness" is self-contradictory,
because the wetness index *rises* with flow; a fixed gradient band then fired on
one world in four, because channel-slope medians run from 0.002 on a dry plain
to 0.578 in upland country — a factor of nearly three hundred. Percentiles of
this tile's own channel network, and every world now has some and none has
many.

---

## 3 · Act III — the light made visible

`cloudshade.js` · `aerial.js` · `godrays.js` · `quality.js`

God rays were dust motes and an additive corona the bloom smeared into something
shaft-shaped. A good cheat with one problem: no gap up there made them.

A shaft is a cloud shadow seen edge-on. The march samples `cloudShade()` — what
darkened the ground — so the three agree because there is nothing to keep in
agreement.

**The effect is one multiply.** The Mie term in `aerial.js` already *is* the
in-scattered sunlight, so scaling it by how much of that column of air the sun
reaches is not an addition to the model but the correction it was missing: the
haze had been lit through the deck as though the deck were not there.

**§5 first.** `shaftTaps` is a quality row that existed before the march did —
12 ultra, 8 desktop, **0 on low and mobile**, where zero means the loop is not
compiled. Three more things keep it affordable and all three are physical: the
march returns without a tap when you are not looking toward the sun; it asks for
two octaves rather than nine, because an integral averages the rest away; and
the taps are dithered by §9.4's ordered pattern, because eight undithered taps
band into slabs.

---

## 4 · Evidence

| gate | result |
|---|---|
| `tools/parse.js` | 128/128 |
| `tools/verify.js` | 950/950, including 67 in `cloudshade` and 29 in `drainage` |
| `tools/invariants.js` | clean; the ratchet told about two build timings by name |
| `tools/shadercheck.js --stations` | 192 shaders, 0 failed, all six scales, `?cshade=1` |

**The silhouette test** is the one that matters, because it is `clouds.js`'s
invariant turned into a number. The shadow evaluates fewer octaves than the deck
draws; the question is whether that moved the outline further than the penumbra
it was traded for. Under a red giant, 4.14% of samples move and **99.4% of them
are within one penumbra of the deck's own edge**. Under a Sun-like star nothing
moves at all — the shadow is the cloud, bit for bit.

**Two real bugs the suites found rather than confirmed:**

1. The wet sheen reached for the cheap path's `sh`, which is declared inside the
   `?paint=` branch. Compiled under `?paint=0`, not at all under `?paint=1`. One
   lookup, hoisted out.
2. §9.3 forward-declared `cloudShaft()` and called it, and every prop material
   stopped compiling, because `painted.js` injects §9.3 into a
   `MeshStandardMaterial` that has no reason to carry a ray march. The shaft
   arrives as a value now.

---

## 5 · What is not done

- **§5 is unmeasured on real silicon.** Chromium here is SwiftShader, which
  §14 says proves the pipeline and never gates §5. The in-container A/B is a
  relative fragment-cost signal and is labelled as one everywhere it appears.
- **No blind capture.** Every claim in this file about how something *looks* is
  a claim about the code, not about a frame. §8's rubric has not been run on any
  of it.
- **The three flags are default-off**, so none of this is shipped. Flipping any
  of them wants the numbers above from a real GPU first.

---

# Part two · green grass, a real sky, an ultra row

A second session, from five reference frames and
`github.com/Leonxlnx/sakura-realm` — which turned out to be **already vendored**
at `docs/reference/sakura-realm/`, with `tree.js`, `blossom.js`, `foliage.js`,
`scatter.js` and `precip.js` already ports of its methods. What was never ported
was its sky, its grass colour and its quality ceiling.

## Act 1 · Grass is chlorophyll

**The defect.** `_buildMeadow` took its base from `pp.colC`. On a terrestrial
world that is the vegetation; **on an ocean world it is the water**, and
`isBiosphere()` is true for ocean worlds. Every one of them grew a lawn out of
its own sea — base `#5a9eba`, root `#2854a3`, tip `#a1d7ff`. `material.js`'s
sward layer and `ground-cover.js` read the same colour and had the same bug.

One colour was doing two jobs with nothing saying which. `pp.vegetation` is the
green now; `colC` keeps its per-type meaning.

**§3's weirdness moved rather than died.** `exoticHSL()` is the same draw, the
same 5%, the same teal and violet — read by whatever *stands in* the grass. A
strange world is a strange wood in green grass.

**The ramp was flat.** The reference ships a 4.36× base-to-tip luminance ramp;
AEON shipped 2.10. The stops are solved rather than typed — a sweep minimising
RGB distance to `#82a552` and `#b3ad6a`, landing 10/255 and 8/255.

Two measurements moved the design mid-flight. The chlorophyll band started at
72° because the reference's *tip* is 74° — the same double-rotation error the
file already recorded at the cool end; 85° is where all fourteen stops stay
green. And "the straw is red-dominant" is false and unreachable: swept over `k`
in [3.4, 5.6] and `rot` in [0.60, 1.00], nothing turns a 117° base red before
green. Dried grass on a deep-green world is olive, and only a yellow-green world
dries to gold.

**The gate:** 104,026 palette stops across 4,001 draws — not one blue.

## Act 2 · Height is what closes the mat

Not a count. AEON's near ring is 1,099 blades/m² against the reference's ~167 —
six times as many — and read sparse, because it capped blades at 1.00 m where
the reference's tall mode reaches 1.48. The reference states the law:

> A blade hides ground roughly in proportion to its own projected area.

The three sward modes are ported with their reasoning. `chunkScale` is
deliberately **not**: the reference needs it because its per-chunk count is
capped; AEON's density is one continuous law and the dial is `RINGS[r].blades`.

They interpolate continuously in wetness — largest step 0.44 cm — and what
drives them is `drainage.js`. The `swale` term was 23 m of noise: a swale that
was not anywhere, drawn over ground with real hollows in it.

## Act 3 · The sky the planet already had

`planetscale.js` builds real Rayleigh + Mie LUTs and renders the atmosphere from
orbit. Land, and a four-stop gradient got painted instead. **The one scale you
spend the most time in was the one without a sky in it.**

The march is forty lines ported from `ATMO2_FRAG`, which is position-independent
— standing on the ground puts the camera inside the shell. One line changed:
looking down from inside, the near root of the ground sphere is behind you.

The medium is Earth's real coefficients scaled by this world's pressure, scale
height and composition. **Earth's 8.5 km falls out at 8.43 without being fitted
to it.** The star arrives as a spectrum at the *top* of the air — `beamXYZ()`
would have reddened the sunset twice.

The painted wash and the painted Mie halo go together; the disc and the cirrus
stay, because those are art direction and an integral has no opinion about them.

## Act 4 · The ultra row

`chooseTier()` graded a *class* and let `hardwareConcurrency` pick between two
rows, so **an RTX 3060 in a six-core desktop was graded desktop, not ultra** —
the tier of a fill-rate-bound scene decided by the CPU. It reads the model
number now, over seventeen real renderer strings.

`shadowRes` 4096, `atmoSteps` 26, `shaftTaps` 16. `grass` deliberately did not
move: the sward's height rose 48% in the same session and a blade covers pixels
in proportion to its height.

## Still owed

- **SMAA, cascaded shadows, the volumetric cloud march.** Features, not knobs.
  Each needs its own measurement.
- **§5 is unmeasured.** Chromium here is SwiftShader. The 60 fps hold is a
  standing instruction, not a result.
- **No blind capture.** §8 has not scored any of this.

## Three bugs the work found rather than confirmed

1. `drainAt()` hard-coded `texture2D`, which three aliases for ES 1.00 and
   deliberately does not for 3.00. The terrain compiled; the blade's *vertex*
   shader did not. **The meadow was silently absent while the ground looked
   right.** Both chunks carry a version-safe macro now.
2. `_buildSky` reads `this.pp`; the atmosphere block used a bare `pp`.
3. An over-broad regex in my own edit ate `QUALITY` and `SAT_AMOUNT` from
   `verify.js`'s imports, and I reported 1019/1019 for a run that threw.

## The teal, found afterwards

`?veg=1` shipped and the meadow still read teal in the shade. It was not the
atmosphere and not the density: an isolation render with the painted sky,
`?paint=0` and desktop density held it. It was one line.

`grassPalette()` mixes each stop toward one of two poles, and the cool pole was

```
[base.r * 0.40, base.g * 0.95, base.b * 4.5]
```

with `root` rotating 62% of the way onto it. That is an **11.3× spread** between
the red and blue coefficients, and it was ported from `hoshi-no-tani`, whose
grass is teal on purpose — its own root stop is `#2B564F`, **170°**. Against a
green base it manufactures blue no leaf reflected, and it took AEON's root to
**175°** and its hollow to **164°**, on every world. `bladeColour()` builds
*both* of its shade bands out of those two stops, so every blade not facing the
sun was shaded cyan.

`sakura-realm`, the reference this was pointed at, has no cool stop at all —
`#3a5630` / `#82a552` / `#b3ad6a`, all green-to-straw — and its skylight enters
as `albedo * skyColour`, which cannot leave the green band because the albedo
does not.

**The fix is the physics the old coefficients were standing in for.** Skylight
*is* blue and it *is* nearly all a root gets, but it reaches the eye having been
reflected off chlorophyll. So the pole is the base modulated by the sky's own
spectrum at the ratio Rayleigh gives — `1/λ⁴` at the sRGB primaries' dominant
wavelengths, 612 / 549 / 465 nm:

```
SKY_TINT = [0.648, 1.000, 1.943]      a 3.0× spread, against 11.3×
```

Derived in `meadow.js` from the wavelengths rather than written down. The root
goes `#1b312f` → `#1e3222`, **175° → 133°**, and the coolest stop anywhere in
the whole hue draw is **136.4°**. The warm pole is untouched, so the tip and dry
stops still land on the reference's own `#82a552` and `#b3ad6a`.

### The gate was the other half of the bug

`?veg=1` shipped with a check that read *"no stop, on any world, comes out
blue"*, and it passed — 104,026 stops across 4,001 draws. It was testing
**channel dominance**: `g > r && g > b`. `#223f36` is R34 G63 B54, so green wins
by nine in both directions and it passes — and it is 161°, and it is the colour
that was on the screen. **The entire cyan quadrant, 150°–180°, is green-dominant
by construction.** Dominance cannot separate a leaf from a lagoon.

The guarantee is now stated in the space the eye judges it in: every stop but
the straw inside **60°–150°**, chartreuse to emerald, measured as hue. Dominance
is kept alongside it — it was insufficient, not wrong.

Three other clauses moved, and each was pinning the defect as a requirement:

- `§9.2 · the root is blue-shifted` was one-sided, `> mid × 1.8`. A one-sided
  bound on a blue shift rewards more blue without limit, which is exactly what
  happened. The direction is right and is kept; a **ceiling** was added at 1.8×,
  and the shipped ramp runs 1.59×.
- `the transfer reproduces the reference's own blade ramp` held all five stops
  to `hoshi-no-tani` within 12/255. Its two darkest stops are 170° and 146°, so
  the clause and the ask are in direct conflict. It now holds the warm half —
  mid, upper, tip, where both references agree and the transfer lands within
  9/255 — and **asserts the two cool stops diverge toward green**: root 114°
  against its 170, low 102° against 137.
- The pole moved into the `RAMP` table rather than into the function, so
  `?veg=0` restores the frame the old captures were shot with, pole included.
  Otherwise the A/B compares two halves of one frame instead of two frames.

### One thing I got wrong along the way

I read `BLADE_FRAG` and claimed `b.lit` was unreachable — that `wrap` sat near
0.46 and `smoothstep(0.52, 0.86, wrap)` never fired. That is wrong. A blade is a
ribbon whose face normal is roughly horizontal, the sun at 8–18° is also roughly
horizontal, and `if (!gl_FrontFacing) N = -N;` two-sides it, so a blade turned
toward the sun reaches `ndl ≈ 0.9` and `wrap ≈ 1.0`. `b.lit` is reached by every
blade facing the light. The one real consequence is at distance, where `N` is
flattened 66% toward vertical and a low sun gives `wrap ≈ 0.55` — the toe of the
upper band, which is correct: far grass should not sparkle. There was one bug
here, not two.
