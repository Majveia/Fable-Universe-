# SAKURA — the print is the weather

**Ask, verbatim:** *"Make our worlds look identical to
[sakura-realm](https://github.com/Leonxlnx/sakura-realm) with your twist on it
to spice things up."*

**Governing document:** `CLAUDE.md`. This plan is §7.2's artefact for the work.

---

## 0 · The concern, stated once, before the work

`CLAUDE.md` §9 names `hoshi-no-tani.html` the art north star and defers to it
outright. §3 settles six tensions in its favour. Making every world look like
sakura-realm instead — a photographic, high-key, clear-air register — is a
change to §9, not a change under it.

So this plan does not delete the painted print. It makes **painted and
photographic the two ends of one axis**, and hands the choice to physics rather
than to taste. That is §3's standing method: *"the numbers are never
negotiable; the palette always is"*, and §3 row 1's own resolution of the
true-black argument — *split by medium, not by taste* — is the same move one
rung further out.

The consequence for the ask is the one the ask wanted: on a clear-air world the
axis lands on the photographic end, and the frame is sakura-realm's.
`CLAUDE.md` §9 still needs a human edit to say so; §11 of this file states
exactly what that edit is.

---

## 1 · What actually separates the two references

Both are zero-asset, both are three.js, both grow their trees and their grass.
Put their frames side by side and the difference is not the geometry. It is
four things, and only four:

| | hoshi-no-tani | sakura-realm |
|---|---|---|
| **the air** | mist, 1700 m visibility — its own valley is 2400 m across and it wants the far wall dissolved | clear, tens of km — hills read as *hills* at 5 km |
| **the print** | watercolour: wet-in-wet softening, chroma bleed, paper tooth, warm-dark vignette | photographic: clean, bloomed, no paper, a lens vignette at most |
| **the exposure** | fixed. One sun, at 13.5°, forever | photometric auto-exposure across all 24 hours, adapting asymmetrically |
| **the highlights** | the rational print curve, which clips at 12.4 | ACES, which never clips — the sun is a disc with a shoulder, not a white hole |

Every one of those is already a **named, measured quantity in this repo**, and
three of the four are already wired:

- `src/aerial.js` already has `VISIBILITY` and `visibilityFor()`, and its own
  header already records the diagnosis: *"`fogFar 1700` is not a constant of
  nature. It is a **weather**."*
- `src/print.js` already carries every watercolour step behind one number
  (`uPaint`), because §3 row 1 needed a cross-fade.
- `src/system.js` already publishes `lum` in L☉ and `pp.au`, which is every term
  of a real photometric exposure.

There is no rewrite here. There is one missing axis and one missing feedback
loop.

---

## 2 · The axis — `src/register.js`

One scalar, `R`.

```
R = 1   painted        the watercolour print, unchanged, to the digit
R = 0   photographic   sakura-realm's register
```

Fourteen knobs interpolate between two named rows (`PAINTED`, `PHOTOGRAPHIC`),
in the four-row-quality-table shape §5 asks for: one row change reconfigures
the whole print.

**`R = 1` must be bit-identical to what ships today.** That is not a courtesy —
it is what makes the axis reviewable. Every new term in the shader is written so
that at `R = 1` it collapses to the expression already there, and
`tools/verify.js`'s `register` suite holds it to that over a 4096-colour sweep.

### The law: `registerFor(visibility)`

`R` is not a preference. It is a readout of **how much air is between you and
the thing you are looking at**, which is the physical difference between the two
references and is already the quantity `visibilityFor()` computes:

```
R = smoothstep( ln 10000, ln 2000, ln V )
```

Anchored on the WMO's own vocabulary, not on taste: 2 km is the top of *mist*,
10 km is the bottom of *clear*. The two references land where they belong —
hoshi-no-tani's 1700 m gives `R = 1`, sakura-realm's clear air gives `R = 0` —
and neither number was chosen to make that happen.

A temperate Earth-like world, whose `visibilityFor()` returns 6 km, lands at
**R = 0.238**. Mostly photographic, with a quarter of a paper. That is the
answer the ask wants and the answer the physics gives, and they agree by
construction rather than by tuning.

---

## 3 · The twist — the print is the weather

This is the spice, and it is the one idea neither reference has.

Because `R` reads the air and the air is a live quantity, **the register moves
while you stand there**. Rain rolls in, visibility collapses, and the frame
walks from photograph toward watercolour over the same seconds the cloud takes
to cross. Clear again and the paper dries.

Nobody has to choose a look. The world does, continuously, out of a variable it
already had to compute for the fog.

Three corollaries fall out of it for free:

1. **Six scales already work.** `paintForScale()` puts vacuum at `uPaint = 0`,
   where every grade step is already zero — the register multiplies terms that
   are already off, so vacuum is untouched by construction. §2.8 holds without
   a second branch.
2. **A world is characterised by its register.** A thin, cold, dry world prints
   photographic; a warm wet one prints painted. The HUD can say which, and it
   is a fact about the planet rather than a slider.
3. **§9's two references stop competing.** They are the endpoints of a measured
   axis, and each is correct about its own air.

---

## 4 · The exposure — `src/exposure.js`

Sakura-realm's 24-hour cycle works because of auto-exposure, and AEON has none:
`print.js`'s `uExposure` has been pinned at `1` since it was written.

The reference drives it from an **eighteen-key hand-authored curve** anchored to
sunrise, noon, sunset and midnight. That cannot port — it is one world's art
direction, and AEON has 10²⁸.

So the twist here is the same shape as §9.6's ruling on the sky stops: *port the
function that produced the values, not the values.* The target exposure is
computed from the **irradiance actually arriving at the ground**:

```
E_top   = 1361 · L☉ / au²                        inverse square, real orbit
m       = Kasten–Young air mass at this elevation
E_dir   = E_top · exp(−τ·m) · sin(elev)          Beer–Lambert through the air
E_sky   = E_top · diffuse hemisphere + twilight  the sky is lit when the sun is not
EV      = log2( (E_dir + E_sky) · albedo / π  /  L_ref )
exposure= 2^(−k · EV),  k = 0.82
```

`k < 1` is deliberate and is the reference's own note in its own words: the
compensation *"is deliberately NOT a full compensation"* — a sunset that
exposed perfectly would not read as a sunset.

`L_ref` is the same expression evaluated for the fixture — a G2 star, 1 AU, sun
at 45°, albedo 0.18 — so **the reference case returns exactly 1** and the
existing frame does not move. Same discipline as `starlight.js`, where
`airColours(5778, 13.5)` is the identity by construction rather than by fitting.

Adaptation is ported as a mechanism, since it is a fact about eyes rather than
about a world: asymmetric exponential damping in log2 space — fast to stop down,
slow to open up — with a hard slew ceiling in stops per second.

**What this buys, concretely:** a world at 0.4 AU around an F star genuinely
stops down; a world around an M dwarf at 0.1 AU opens up; and on every one of
them the night is dark and the eye takes its time getting there. None of it is
authored.

---

## 4b · The second twist — a spring is a property of an orbit

The plan above makes the *print* sakura-realm's. It ran straight into a second
problem on the way, and the fix is the better half of the ask.

Sakura-realm's tree is in bloom because it was built in bloom. AEON's is in
bloom when its world's orbit says so — `blossom.js` opens a window across 32% of
a year, so **two visits in three arrive to bare wood.** "Make our worlds look
like sakura-realm" is not satisfiable while that is true, and widening the
window for everyone would answer it by deleting the best idea in that module:
*a season you can miss is the only kind worth catching.*

The answer was already on the planet record, unread.

**A spring is not a property of life. It is a property of an orbit.** A world's
year only has seasons if something modulates the light around that year, and
only two things can: the axis being tilted, and the orbit not being a circle.
Both are already generated — `system.js` needed `tilt` to lean the rings and `e`
to draw the ellipse.

```
S = √( sin²ε + (2e)² )          0.398 and 0.033 on Earth
window half-width = 0.16 · S_earth / S
```

In quadrature because the forcings are orthogonal: obliquity makes hemispheres
take turns, eccentricity makes the whole world do it together. Inverse because
the window is the interval over which the cue is unambiguous, and ambiguity goes
as one over amplitude.

A world with neither gives its flora **no annual cue to synchronise to**, so it
does not synchronise. It has no long spring — it has no spring, and is always in
flower.

Measured over `system.js`'s own draws for `tilt` and `e`, in its own order,
across 20,000 worlds:

| | |
|---|---|
| Earth-like window | **0.160**, the constant the file shipped with, to twelve places |
| worlds that never leave flower | **17.9%** |
| visits that arrive to flowers | **29.6% → 52.5%** |

Half of all landings now find blossom and the other half still has a season to
miss. Nothing was chosen: the numbers fall out of an obliquity distribution
drawn years before anybody asked about cherry trees.

And it is *findable*. A low tilt and a round orbit are visible on the system
diagram before you land, so a hanami world is something you learn to recognise
rather than something you roll for.

---

## 5 · Acts, in order

| # | Act | Files | Gate |
|---|---|---|---|
| 1 | The axis | `src/register.js` **new** | `register` suite: `R=1` reproduces today over a 4096-colour sweep; the law hits both references' anchors |
| 2 | The print takes it | `src/print.js` | `glslcheck` compiles it; `print` suite unchanged at `R=1` |
| 3 | Photometric exposure | `src/exposure.js` **new** | `exposure` suite: fixture returns 1.000; adaptation is monotone, asymmetric, and slew-bounded |
| 4 | Wiring | `src/post.js`, `src/surface.js`, `src/main.js` | `parse`, `invariants`, `digest` |
| 4b | The orbit's spring | `src/blossom.js`, `src/life.js` | `blossom` suite: Earth-like returns 0.16 to twelve places; the distribution is measured, not asserted |
| 5 | Flip | one commit, on its own | §7.4 — the flip is separate from the build |

---

## 6 · Budgets (§5)

Act 1 is arithmetic, off the frame — it runs when the weather changes, not per
pixel. Act 3 is one `Math.pow` per frame on the main thread.

Act 2 is the only one that touches a fragment, and it adds **no taps and no
branches**: every knob replaces a literal that was already in the expression.
The one arithmetic addition is the halation tint on the bloom composite — one
`mix` on a `vec3` already fetched. Call it under 0.05 ms at 1440p, and it is
paid back several times over by `uWash` going to 0.05 on a clear world, which
**skips the four-tap softening branch entirely** on the pixels that used to take
it.

Net expectation is negative cost on a clear world. Unmeasured on real silicon in
this container (CI is SwiftShader, §14) — stated as an expectation, per §16 rule 1.

---

## 7 · What is *not* in this plan

- **The tree's geometry.** Already ported — `src/tree.js` grows it under four
  laws and `petalHue()` already derives a flower's colour from the leaf it
  advertises against. §4b changes *when* it flowers, not how.
- **The grass.** `src/meadow.js`'s density law and `grassPalette()` are already
  the reference's shape. What made sakura-realm's meadow read chartreuse is
  exposure and saturation, both of which this plan moves.
- **The clouds.** `src/clouds.js` already cites sakura-realm's raymarcher.
- **ACES.** §9.4 says *"Not ACES. Not Reinhard."* and this plan does not
  introduce it. The photographic end gets its shoulder from the **same rational
  family**, by moving one denominator coefficient from 0.34 to 0.3735 — which
  drops the asymptote to 0.964, so highlights roll off forever and never clip.
  A sun disc stays a disc, which was the whole reason the reference reached for
  ACES, and §9.4's letter is kept.

---

## 8 · Evidence, and what is not evidence

Per §16 rule 1: **nothing in this document is a claim about how a frame looks.**
The offline suites decide the arithmetic. The look needs
`node tools/capture.js` on real silicon and a blind §8 score, and neither has
been run for this change.

What *is* established here, offline:

- `R = 1` reproduces the shipped print **exactly** — worst |Δ| 0.00e+0 over
  61,440 channels, at five points across §2.8's cross-fade.
- The law hits `R = 1.000` at 1700 m and `R = 0.000` at 22 km.
- The aperture fixture returns 1.000000000000, and the 24-hour range is 1.81
  stops against the reference's measured 1.78.
- An Earth-like bloom window returns 0.160000000000; 17.9% of worlds never leave
  flower; arriving to flowers goes 29.6% → 52.5%.

---

## 9 · Rollback

Acts 1–4 are two flags. `?reg=1` pins the painted register, `?ae=0` pins
exposure at 1, and both together are the previous build, byte for byte.

Act 4b has no flag and does not need one: it is a **law replacing a constant**,
and the constant is what the law returns for an Earth-like world. `?bloom=` and
`?season=` still override it as they always did. Reverting it is reverting one
argument at one call site in `life.js`.

---

## 10 · The edit `CLAUDE.md` needs

Not made here — this file is `architect`'s output and §7 says plans only.

§9's opening line should read that the art north star is an **axis** with two
vendored endpoints, `hoshi-no-tani.html` at the painted end and `sakura-realm`
at the photographic one, and that `registerFor()` chooses between them from the
air. §3's third row already almost says this: *"they are not competing
tonemaps — the reference's is a grade, and grades belong to atmospheres."*
This generalises that sentence from one grade to the whole print.
