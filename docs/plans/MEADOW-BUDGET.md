# MEADOW-BUDGET — spend the meadow where it can be seen

**Ask, verbatim:** *"Spend the meadow where it can be seen. Get §5 green AND
make blades legible in the near field. These are the same change, not competing
ones."*

**Governing document:** `CLAUDE.md`. This is §7.2's artefact for the work.

---

## 0 · Reproduced first, before anything was changed

```
node tools/drawcensus.js --seed 1337146641 \
  --at "g=2248432278&s=51574389&p=1" --preset none --frames 2
```

| ring | chunks | blades | tri/blade | triangles | reach |
|---|---|---|---|---|---|
| 0 | 36 | 413,654 | 6 | 2,481,924 | 26 m |
| 1 | 38 | 741,896 | 2 | 1,483,792 | 84 m |
| 2 | 41 | 1,277,569 | 2 | 2,555,138 | 290 m |
| 3 | 44 | 958,743 | 2 | 1,917,486 | 1250 m |
| **total** | | **3,391,862** | | **8,438,340** | |

**§5 · 10,740,531 triangles/frame against 2,200,000 — RED, 4.9× over.**
Draw calls 240 against 900 — green. Matches the brief to the digit.

### …and what the other 21% is, which turns out to matter

`10,740,531 − 8,438,340 = 2,302,191` of non-meadow, per frame:

| subsystem | triangles/frame | of §5 |
|---|---|---|
| terrain tiles | 1,085,270 | 49% |
| **tree wood + foliage, in the shadow pass** (`MeshDepthMaterial USE_INSTANCING`, 132,506 instances) | 783,140 | **36%** |
| ground cover (`painted.js`) | 350,302 | 16% |
| other depth | 56,448 | 3% |

**Non-meadow alone is 1.05× of §5.** A meadow of exactly zero blades leaves this
frame over budget. That is not a reason to leave the meadow at 4.9×; it is the
reason §5 green is not this milestone's to deliver alone, and §7 below says so
rather than quietly redefining the target.

---

## 1 · The diagnosis — it is not the blade count, it is the coverage

The contradiction `drawcensus.js` was written for still stands in its own header:

> In the frame, there is no grass. Visually confirmed at magnification.
> In the CPU's bookkeeping, there are 3.5 M blades across 162 chunks.

Here is the reconciliation, and it is one quantity.

**Ground overdraw** — how many times over the ground is hidden by the blades
standing on it. Frontal area per m² of ground is `density · width · height`; the
ground's own screen area per m² is `sin θ ≈ eye/d`. The ratio is how many blades
deep you are looking.

Evaluated on the shipped low row, at each ring's own quoted distance:

| ring | dn | ground overdraw |
|---|---|---|
| 0 | 7 m | **17.2×** |
| 1 | 22 m | **36.1×** |
| 2 | 76 m | **108.1×** |
| 3 | 260 m | **201.8×** |

The reference states its own target in words, and it comes out to a number:
`docs/reference/sakura-realm/src/world/grass.js` puts 26,000 blades over an
11.25 m chunk — 205/m² — and calls it *"the density at which the ground stops
being visible between blades"*, noting that the previous 53/m² *"left the soil
showing through everywhere."* At its blade dimensions that is **≈ 2× overdraw**.

**AEON is looking through 17 to 202 layers of blade where the reference looks
through 2.** That is the flat acid-green wash, and it is also the 8.4 M
triangles: they are the same fact counted two ways. Both halves of the brief's
milestone are therefore one change, exactly as it says.

### Why more blades made it worse rather than better

The law is `blades/m²(d) = B·min(1, (dn/d)^1.5)` and it does what it says. But
**coverage is not density** — it is density × width × height ÷ sin θ, and three
of those four grow with distance:

- inside `dn` the density is *flat* by design (*"nearer than that a blade is
  already wider than a pixel"*), so coverage climbs as `d²` — 1.7× at 2 m to
  20.6× at 10 m, on the same ring, from the same constant;
- `wpx` and `hs` both step *up* outward (1.70→4.00 px, 1.00→1.95), so every ring
  boundary is a jump in coverage;
- and `sin θ` falls as `1/d`, which is the grazing incidence a floor has and a
  wall does not.

Nothing in the law bounds the product. `density()`'s own note reasons about
count per steradian against `d^-2` — the neutral exponent for a **wall**. For a
floor seen from a fixed eye height the patch subtending one steradian has area
`d³/e`, so the neutral exponent is **3**, and the law is one and a half powers
under it. Hence 202× at the far edge.

---

## 2 · The design, and it is the reference's

The reference solves this in three moves, and it says so in its own comments:

1. **A tight falloff and a short reach.** `1/(1+(d/13)²)` out to **90 m** — not
   1250 m — because *"the old curve was spending most of the budget on chunks
   40–70 m out that occupy a handful of pixels each."* Its total instance count
   **dropped** while its near density tripled. That is this milestone in one
   sentence, already executed once, by someone else, with the numbers recorded.
2. **A long dissolve, not an edge.** *"the field ends at 72 m and the fade is
   deliberately long so it dissolves into the terrain colour instead of ending
   on a visible edge."* It fades blade **height** (`H *= fade`), not alpha —
   everything stays opaque.
3. **The ground carries the distance.** Past the field, `terrain.js`'s
   earth→meadow blend *is* the grass.

Ported as laws rather than as constants (§9.6's rule):

### Act 1 · A coverage cap — one number, not four

`grass[]` is four hand-picked multipliers per tier. Replace what they *mean*:
the tier row carries **one** number, a target ground overdraw, and `meadow.js`
solves each ring's multiplier from it. That is more of §5's *"one row change
reconfigures the entire renderer"*, not less, and the number is physical — it
depends on `pxPerRadian`, so a 4K display automatically earns more blades,
which is correct because they resolve there.

The solve is a bisection over the shipped `bladeWidth` clamp (width depends on
density through the spacing cap, so it does not close in one step).

### Act 2 · A physical bound on blade width

The spacing cap `1/√density` grows without limit as density falls: at ring 3's
far edge it already makes a "blade" **3.45 m wide**. Thinning the far field
without bounding width would make that worse, not better — the marks would grow
to fill what they no longer cover.

The bound is the reference's own, stated in its source: *"Real meadow grass is
4–10 mm across."* A blade may be widened toward its neighbour's spacing **up to
a physical maximum** and no further; past that the ground shows through, which
is what a thinning sward actually looks like and what makes the hand-off honest.

### Act 3 · The far dissolve

Ring density collapses to near nothing under the cap — by construction, since
the far rings are the ones at 108× and 202×. That leaves an edge where the
blades run out. So blade **height** fades to zero over a long band, exactly as
the reference does, and the mechanism already exists: `BLADE_VERT` multiplies
height by `live` for thinning and can multiply by a fade the same way.

**What it dissolves *into* is not mine.** The terrain's earth→meadow band lives
in `surface.js`, which is hands-off this session. AEON's terrain does already
paint a meadow band from `uColC` — the same colour `grassPalette()` derives the
sward from — so the substrate exists. Whether the hand-off reads is a claim
about a frame and §7 says how it will be settled.

---

## 3 · The collision, stated plainly (§12)

Three clauses of the constitution cannot all hold on this frame:

| clause | demands | costs |
|---|---|---|
| §5 | ≤ 2,200,000 triangles/frame | — |
| §6 M3 gate | ≥ 800,000 blades | **4,800,000 triangles** at ring 0's shipped 6 tri/blade — 2.2× §5 on its own |
| measured non-meadow | — | **2,302,191** — 1.05× §5 before a single blade |

§12: *"Stop and ask me if … a budget in §5 goes red and cannot be paid back."*
It is red, and the meadow cannot pay it back alone — §M3's blade floor and §5's
triangle ceiling are 2.2× apart before the terrain, the trees or the shadow pass
are counted.

**This plan does not resolve that, and does not pretend to.** It takes the
meadow from 8,438,340 to the region of 400–800 k — a 10–20× cut that also fixes
the wash — and names what is left standing between the frame and green.

---

## 4 · Acts

Behind **`?cover=1`**, default-off, per §7.4. The flip is a separate commit.

| # | Act | Files | Gate |
|---|---|---|---|
| 1 | Ground overdraw as a law, and the multiplier solved from it | `src/meadow.js` | `verify.js meadow`: the solve hits its target on every ring; monotone in target; the shipped rows reproduce their measured overdraw |
| 2 | A physical bound on blade width | `src/meadow.js`, `src/flora.js` | no blade exceeds the bound at any distance on any row; `glslcheck` compiles |
| 3 | The far dissolve | `src/flora.js` | height reaches zero before the ring's far edge; no discontinuity at the boundary |
| 4 | The tier row carries the target | `src/quality.js` | one number per row; `?grass=` still overrides (§2.4) |
| 5 | Capture and critique | — | `?cover=1` A/B, §8 axes 5 and 6 named by region |
| 6 | Flip | one commit, alone | §7.4 |

Separately, and not behind that flag:

| # | Act | Files | Gate |
|---|---|---|---|
| T | Weeping limbs stop closing into arches | `src/tree.js` | a limb's total turn is bounded by the wood; the bound is derived, not picked |

---

## 5 · Budgets (§5)

Modelled by scaling the measured per-ring counts (linear in the multiplier;
ring 0 is unsaturated at the low row), non-meadow held at its measured 2,302,191:

| design | blades | meadow triangles | frame | of §5 |
|---|---|---|---|---|
| shipped | 3,391,862 | 8,438,340 | 10,740,531 | **4.88×** |
| overdraw ≤ 4 | 178,400 | 741,398 | 3,043,589 | **1.38×** |
| overdraw ≤ 3 | 133,800 | 556,049 | 2,858,240 | **1.30×** |
| overdraw ≤ 2 | 89,200 | 370,699 | 2,672,890 | **1.21×** |

The meadow falls by **11× to 23×**. The frame stops being 4.9× over and becomes
1.2–1.4× over, all of the remainder being the four subsystems in §0 that this
plan does not touch.

Which target to ship is **not** decided here. The model narrows it to 2–4; a
capture picks inside that, because "does the ground read as a sward or as bare
soil" is a claim about a frame (§16 rule 1).

---

## 6 · Risks and rollback

- **A visible grass line.** The failure §11 names as un-grassed annuli, from the
  other side. Act 3 is the mitigation and a capture is the only test.
- **A sward that reads as bare soil.** The reference measured this exact failure
  at 53/m² and fixed it at 205/m². If the capture shows soil, the target moves
  up, and the model says what that costs.
- **Rollback:** `?cover=0` for acts 1–4; act T is one bound in one function.

---

## 7 · Evidence

Nothing here is a claim about a frame unless it cites a capture (§16 rule 1).

- **Reproduced**, two instruments, exact: §0.

### The baseline frame

`docs/captures/meadow-budget/m3-1.png` — **UNIVERSE 144 · KORORA**,
terrestrial, 1.04 g, 286 K, `FIRST BLOSSOM`, low tier, meadow at shipped
density. 1280×720.

Both defects are visible in one frame, and neither needed magnification.

1. **The wash.** The lower ~48% of the frame is one flat saturated chartreuse.
   There is a faint vertical grain but **no individual blade resolves anywhere**,
   and none of `bladeColour()`'s features — tussock at two scales, the
   four-patch mosaic, dry shoulders, per-blade variation — is legible. This is
   17.2× to 36.1× overdraw, seen rather than computed.
2. **The arches.** Six pale tan closed loops stand on the skyline between
   x ≈ 50 and x ≈ 1210, each running from a crown back down to the ground.
   Croquet hoops, in the brief's word, and unmistakable at 1×.

§8, on the axes this milestone touches: **Materials 2** (one surface nameable,
and the frame is more than half that surface) · **Colour 2** (a single hue
family occupying half the frame, at a saturation nothing else in the frame
carries) · **Silhouette 2** (the only shapes on the skyline are broken).

**This frame predates the tree bound** — the page loaded before that commit — so
it is the "before" for the arches. The "after" for them is arithmetic and not a
picture: 3,989 → 0 limb ends returning to the ground, over 96 trees, held by
`suiteTree`. The `?cover=1` frame lands beside this one when it finishes
rendering.

### The `?cover=1` frame

`docs/captures/meadow-budget/cover-1.png` — same world, same seed, same tier,
same landing solve (0.642, to three decimals). Two things fixed and one
uncovered.

**The trees are trees.** Every croquet hoop is gone. Six trunks with crowns
stand where six closed arcs stood — at x ≈ 180, 300, 440, 545, 1180, 1230 —
and the silhouette is now a tree's. This is the rupture bound, seen rather than
counted, and it is the visual half of `suiteTree`'s 3,989 → 0.

**The blades resolve.** The lower field carries visible individual strokes where
the baseline carried a flat grain. It is the same 205 blades/m² the reference
converged on, and it reads as a sward rather than as a colour.

**And the hand-off does not land — for a reason that is not the meadow's.**
Between roughly y ≈ 370 and y ≈ 400, from x ≈ 0 to x ≈ 700, a pale sand band
stands where the fade hands over. The dissolve works exactly as designed — the
blades lie down over the last 45% of the field — but **what they lie down into
is not meadow-coloured.**

Reading `surface.js`'s bands (read, not touched): `col = mix(meadow, uColA,
smoothstep(0.02, 0.45, hgt))`, then `mix(col, uColB, smoothstep(0.35, 0.85,
hgt) · 0.8)`. **The terrain's meadow colour lives only in a narrow band just
above sea level.** Rising ground is soil, then rock, within a normalised height
of 0.45. The crest in this frame is outside that band, so the substrate under
the sward is sand-and-soil coloured, and it always was.

**Which reframes what the 1250 m reach was for.** The blades were not extending
to a kilometre because a meadow needs blades at a kilometre. They were covering
ground the terrain has no material for. §5's 4.9× overrun was, in part, the
price of concealing `RECKONING.md` §0's oldest open defect — *"the ground has no
material … it is more than half of every frame, and it is the single defect
behind both failing axes."* Take the concealment away and the defect is visible
in one frame.

**This is not fixable from this session's files.** The band is in `surface.js`,
hands-off. `ground-cover.js` is mine and reaches 420 m, so a sward-coloured
ground cover through the hand-off band is a real option — but it is a third
change, it cannot be scored here, and building it blind on top of two others is
how a session stops being reviewable.

§8 on the axes this milestone touches, against the baseline's 2/2/2:
**Materials 3** (blades nameable; the sand band is nameable and wrong) ·
**Colour 3** (the single-hue dominance is broken, the accent is now unintended) ·
**Silhouette 4** (trees are trees).

### The census, and one thing it says that the frame cannot

`drawcensus --preset none` on the captured world (seed 144), with and without
the flag. It renders **320×180** — remember that, because it turns out to
matter.

| | shipped | `?cover=1` |
|---|---|---|
| frame | 10,568,367 · **4.8× §5** | 3,509,549 · **1.6× §5** |
| meadow | 8,445,378 | **1,386,560** |
| blades | 3,378,441 | **464,524** |
| draw calls | 230 | 155 |
| chunks | 412 | 243 |
| ring 3 | 45 chunks · 1,016,616 blades | **0 · 0** |
| ring 2 | 36 chunks | 6 — its first 8 m only |

**The model predicted ring 0 would keep 27.1% of its blades. It kept 27.1%.**

**But the flag's number does not transfer between viewports, and the shipped
one does.** That is not a caveat, it is the law working: the cap depends on
`pxPerRadian`, so a 320×180 census earns fewer blades than a 720p frame earns,
because at 320×180 fewer blades genuinely resolve. The shipped law has no such
term, so its 8.4 M is the same at any size.

Scaled to the rows that actually ship — same measured baseline, each row's own
projection and tessellation:

| row | ring 0 kept | meadow triangles | vs shipped |
|---|---|---|---|
| low @ 720p | 62% | 1,957,227 | **4.3×** |
| mobile @ 844p·2 | 45% | 2,947,830 | **6.6×** |
| desktop @ 1440p | 26% | 6,660,872 | **7.6×** |
| ultra @ 1440p | 18% | 9,552,368 | **12.4×** |

The cap bites hardest on the rows that were most over-drawn, which is the
property it was built to have.

**And it exposes a second lever this plan does not pull.** Desktop's meadow is
still 6.66 M *after* the cap, because ring 0 there is **16 triangles a blade** —
`blades: [4,…]` with `curvedRings: 1`, a curved cross-section on a blade that
§9.5's own pixel rule retires. Density and tessellation are independent
multipliers and this plan moves only the first. The second is worth roughly
another 2× on desktop and is not measured here.

### Determinism, and the branch that nearly broke it

The tree bound changed a generation path, so `docs/captures/digest.json` had to
move with it — CI's `§2 holds` said so in the tool's own words (*"moved · tree ·
§M2"*, and *"the generators changed — then update the baseline in the same
commit"*), and it was right.

Two things worth keeping from that.

**The engines agree.** All nine per-suite hashes are identical between this
container's v22.22.2 (V8 node.39) and CI's v22.23.2 (V8 node.56), and after the
update CI's `every machine agrees (§2.3)` passes on **ubuntu, windows and
macos** alike. §2.3's per-architecture clause is not carrying any weight here.

**But regenerating alone would have been wrong.** `turnLimit` is
`breakCurvature(r) · lengthOf(r)`, and `lengthOf` is `k·r^p` — a `pow`. The
growth loop *branches* on it. §11 is explicit:

> …one that reaches a *count*, an *index*, or a *branch* must not. Quantise
> before it crosses that line.

Unquantised, one bit of disagreement in `pow` on arm64 is not a tree a fraction
of a degree different — it is a tree with a **different number of branches**.
`turnLimit` now lands on a micro-radian grid, held by perturbing the radius one
and two ULPs in both directions across 364 samples from 2 mm to 90 cm: none
moves the threshold. The baseline was regenerated *after* that, so what is
committed is the shipped law's.

- Offline gates: `parse` 136/136 · `invariants` 709 clean · `verify` 1153/1153 ·
  `glslcheck` clean · `digest` matches on three platforms.

**This container has no GPU.** Chromium runs under `--enable-unsafe-swiftshader`
and `chooseTier()` returns tier 0 on every capture. No frame *time* is measured
anywhere in this plan; triangles and draw calls are.

---

## 8 · Notes for the sessions this one is not

- **`SAKURA.md` §§12–13 have since arrived** with #88's merge into the base, and
  they are now read. §13 is this plan's brief, near-verbatim, and it reaches the
  same diagnosis independently — the far cutoff, and *"the reference solves the
  same problem by making distant grass a ground colour rather than blades."*
  (When this plan was written they existed on no branch; that note is superseded
  rather than wrong.)

  **Two places this plan departs from §13, both deliberate.**

  §13 says ring 0 *"gets 413 k"* while rings 2–3 take 2.24 M, and calls the near
  field *"starved relative to what it could afford."* That is true of the split
  between rings and it is **not** true of ring 0 in absolute terms: at its own
  quoted distance ring 0 sits at **17.2× ground overdraw** against the
  reference's ~2.4×, so the cap takes blades *away* from it too — 62% kept at
  720p. What the near field gains is legibility, not count, and the number it
  lands on (205.7 blades/m²) is the reference's own.

  §13 also says a ring-0 blade is *"nine pixels wide."* It is **1.70 px**, and
  1.70 at 4, 8, 12, 18 and 26 m alike, because `meadowWidth()` returns a width
  *defined in pixels*. That is the same estimate `quality.js`'s `curvedRings`
  note made, and #85 — now merged into this branch's base — disproved it and put
  `bladePixels()` in the repository so it cannot be made a third time. The 9 px
  figure is what you get at half a metre.
- **`tools/shot.js` has no `--want meadow`** (`WANT` is `{any, life, aurora}`,
  and an unknown key falls through to `any`) and **`tools/lib.js` has no `thumb`
  tier** (`TIERS` is `{desktop, mobile, low}`). Both are hands-off; this plan
  captures around them and says which world it is on.
- **`--builds` splits on `,`**, so a build string containing `grass=a,b,c,d` is
  torn into fragments. Captures here avoid commas in build strings.
