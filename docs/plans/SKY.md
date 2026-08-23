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
