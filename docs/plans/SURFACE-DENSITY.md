# SURFACE-DENSITY — the surface scale gets a subject and a floor

**Ask, verbatim:** *"Our worlds look empty next to sakura-realm. That reference's
frame is carried by ONE dominant sakura tree plus a meadow dense enough to fill
the lower third with individually legible blades. AEON's surface frame has no
comparable subject. Your milestone: the surface scale gets a subject and a
floor."*

**Governing document:** `CLAUDE.md`. This plan is §7.2's artefact for the work.
It touches `life.js`, `tree.js`, `blossom.js`, `flora.js`, `meadow.js`,
`grass.js`, `scatter.js`, `ground-cover.js`, `foliage.js` and the tier table in
`quality.js`, and nothing else.

---

## 0 · What was measured before anything was proposed

Three questions were asked in order and all three are answered from the bytes
and from arithmetic over the shipped law. **None of the numbers below is a claim
about how a frame looks** (§16 rule 1); the ones that are appear in §5.

### 0.1 · The flags, verified from `src/`, not from a ledger

```
grep -rhoP "PARAM\('[a-z0-9]+'\)\s*(!==|===)\s*'[01]'" src/*.js | sort -u
```

`m1 m2 m3 m4 m5 m7 web mat sea ridge sky shadow aerial solve dither ae propair`
are all `!== '0'` — shipped. The only default-off member of the visual set is
`paint` (§9.2's light model). `RECKONING.md` §0's table is stale; `CLAUDE.md`
§16 is right. Everything below is measured with the meadow **on**.

### 0.2 · The container cannot measure a frame time

Chromium runs under `--enable-unsafe-swiftshader`, so `chooseTier()` returns
tier 0 on every capture. Every capture in this plan forces `?q=desktop` for
content parity. **No frame-time number in this document is measured**, and none
is asserted. Triangle and draw-call counts *are* measured, because
`tools/drawcensus.js` records what was submitted rather than what came back and
therefore runs at full speed on a software rasteriser.

---

## 1 · Q1 — how many blades reach the frame

The law is in `src/meadow.js`; the wiring is `GrassRing` in `src/flora.js`. The
`uChunkNear` defect that produced the empty meadow in `docs/captures/blind/`
**is fixed** — `chunkNear` is now derived in `BLADE_VERT` from the model matrix,
which is the one per-object channel three uploads on every draw.

Two thinnings run in series, so there are two different counts and they answer
different questions.

**Submitted** — what `chunkInstances()` asks for, camera at a chunk centre,
counted over the 81.9° horizontal frustum a 52° vertical FOV gives at 16:9:

| tier | ring 0 (0–26 m) | ring 1 (22–84 m) | ring 2 (76–290 m) | ring 3 (260–1250 m) | total | draws |
|---|---|---|---|---|---|---|
| low | 232,506 | 420,242 | 687,704 | 702,205 | **2,042,657** | 82 |
| mobile | 449,510 | 825,461 | 1,375,406 | 1,404,398 | **4,054,775** | 82 |
| desktop | 775,012 | 1,500,822 | 2,645,005 | 2,925,812 | **7,846,651** | 82 |
| ultra | 883,467 | 1,667,573 | 2,885,908 | 3,233,770 | **8,670,718** | 82 |

**Rendered** — what survives `meadowKeep()`, which converges to the law's own
integral over each ring's band:

| tier | ring 0 | ring 1 | ring 2 | ring 3 | total |
|---|---|---|---|---|---|
| low | 54,331 | 72,652 | 125,595 | 204,342 | **456,920** |
| mobile | 105,040 | 142,709 | 251,190 | 408,684 | **907,624** |
| desktop | 181,103 | 259,471 | 483,058 | 851,426 | **1,775,059** |
| ultra | 262,600 | 358,070 | 627,976 | 1,021,711 | **2,270,357** |

**So the answer is: the law is right, the wiring is right, and the *allocation*
is wrong.** §M3's gate asks for ≥800 k blades and desktop renders 1.78 M — the
count is not the problem. What the count is spent on is:

- **10%** of desktop's blades stand in ring 0, where a blade is 56–270 px tall
  at 720p and individually legible;
- **48%** stand in ring 3, 260–1250 m out, where a blade is **2.2 px tall at
  720p and 4.4 px at 1440p** — under §9.5's own retirement threshold
  (*"once a blade is two or three pixels wide, everything varying across its
  width is sub-pixel"*), and in the band §M2 rules should read as *"pure haze,
  pure shape"*.

That is not a hole in the near field — at 5 m the law puts 1,098 blades/m² at
3.0 cm spacing, 8× frontal overdraw, which fills. It is half the meadow's whole
vertex budget spent behind the haze line, and it is what pays for §2 below.

### 1.1 · …and what that costs, which is the number §5 has never had

Triangles per blade are `seg × (curved ? 4 : 2)`. Grass **alone**, in frustum,
against §5's whole-frame surface ceiling of 2.2 M triangles and 900 draw calls:

| tier | instances | draws | triangles | of §5's 2.2 M |
|---|---|---|---|---|
| low | 2,042,657 | 82 | 5,015,338 | **228%** |
| mobile | 4,054,775 | 82 | 11,558,512 | **525%** |
| desktop | 7,846,651 | 82 | 29,545,114 | **1343%** |
| ultra | 8,670,718 | 82 | 55,691,388 | **2531%** |

Draw calls are comfortable — 82 against 900. **Triangles are 2.3× to 25× over,
on every row, before a single triangle of terrain, wood, foliage, blossom,
furniture or settlement is counted.**

**Cross-checked against `tools/drawcensus.js`**, which records what was
submitted rather than what came back and so runs at full speed on a software
rasteriser. Directly measured, no model: at `grass=0.012,0.010,0.006,0.006` —
1.2% density, with the terrain also cheapened to `qd=10&qr=17&vc=0` — the frame
is **2,942,376 triangles, 1.3× over §5 already**. The census counts 100,314
blades over 164 chunks where the model predicts 57,765 over 104, so the model
**undercounts by 1.74× at identical settings** and every figure in the table
above is a floor.

This is not a new defect discovered here; it is one the repository had already
measured and not summed. `src/quality.js`'s own note records *"ring 0 spent
5,368,656 triangles — 40% of the entire frame — on the 447,388 blades inside 26
metres"*, which puts the whole low-tier frame at ≈13.4 M against a 2.2 M budget.
The model above reproduces that measurement to 3%. The sentence was written to
justify the `curvedRings` column and the conclusion beside it was never drawn.

**§16 rule 3 is therefore closed, and the answer is worse than "unmeasured".**

### 1.2 · …and *why*, which is one arithmetic slip, thirty years old in optics

`density()`'s own note justifies the exponent like this:

> The falloff is *slower* than the `d^-2` that would keep the count per
> steradian constant, which is the whole trick: at 1.5 the count per steradian
> rises slightly with distance, and that is what makes the horizon read as a
> meadow rather than as a green plane.

**`d^-2` is the neutral exponent for a fronto-parallel surface — a wall.** Ground
is a floor. Seen from a fixed eye height `e`, the patch of ground subtending one
steradian at distance `d` has area `d³/e`; the extra power is the grazing
incidence, and it is the entire difference between a wall and a floor. The
neutral exponent for a floor is **3**, and the law is not half a power over it,
it is one and a half powers *under* it.

Measured over the bands the rings actually occupy:

| | 26 m (ring 0's edge) | 1250 m (ring 3's edge) | ratio |
|---|---|---|---|
| blades per steradian | 1.61 M | 407.6 M | **254×** |
| ground overdraw | 6× at 2 m | 610× | **~100×** |

"Rises slightly" is 254×. And the outcome is precisely the thing the sentence
was written to prevent: at ring 3's far edge the spacing cap has grown a "blade"
to **1.69 m wide and 1.38 m tall**, with no ground visible between them
anywhere. §M3's gate asks that *"grass reads as meadow at the horizon, not as a
green plane"*; at 1250 m it is a green plane, made of four million billboards,
and it is where roughly half the grass budget goes.

**The exponent is not the dial.** §6 M3 pins it at exactly 1.5 so the shader can
evaluate `x·x·inversesqrt(x)`, and §3 forbids re-litigating settled rulings
mid-build. What is *not* pinned is where the rings stop: `RINGS[3].far` is
1250 m because the reference's valley is 2400 m across, and `horizon.js` already
draws past the haze line as silhouette (§M2). **The band is the dial, and moving
it needs a scored frame this container cannot render** — see §7.

---

## 2 · Q2 — is there a hero? No.

§9.7 asks for *"at least one hero landmark in the opening frustum, with scale
legible against a human-height reference."* Four separate facts say the surface
scale has none.

1. **No size hierarchy.** Every tree on a world is `r.float(5, 13)` m
   (`life.js:265`), or `r.float(6,12)` / `r.float(8,16)` for a promoted grove
   stand. One uniform draw, ~400 samples. Nothing dominates because nothing is
   allowed to.
2. **No heading awareness.** 58% of trees cluster on spawn at `r.gauss() * 130`
   in x *and* z — an **isotropic** Gaussian. The opening frustum is 81.9° of
   360°, so it gets ~23% of that cluster by chance and is guaranteed nothing.
3. **The distances are wrong for a subject.** Radial distance is Rayleigh with
   σ = 130 m, median ≈ 153 m. A 9 m tree at 153 m subtends 3.4° — 47 px tall at
   720p, next to a 1.68 m walker at 8.7 px. That is a speck with a speck beside
   it, not a scale reference.
4. **The blossom cannot make one either.** `life.js:514` shares the flower cap
   equally: `per = max(24, floor(cap / grown.length))` — ~110 flowers per tree
   across ~400 trees. The reference's frame is carried by one crown holding
   thousands.

And the solver agrees, in the one way that matters: on the world captured for
this plan (`seed 1337146641`, galaxy 2248432278, star 1611053056) it reported
`hero 0.96` — a near-perfect score. `landing.js`'s `hero` term scores **terrain
prominence** against a 200 m collar at 180–1000 m. It found a hill. Nothing in
the pipeline ever promised a *subject*, so scoring 0.96 and having none is not a
contradiction — it is the term measuring a different noun.

**Conclusion: yes, `life.js` should guarantee a hero tree in the opening
frustum, and it already has everything it needs to.** `_buildTerrain()` runs at
`surface.js:1119` and `addLife(this)` at `:1127`, so `s.landingSolution.heading`
and `s.spawn` are both settled before life is placed. `growTree()` takes an
explicit `height` (clamped to 90 m) and an explicit `habit`. `blossomsFor()` is
already per-tree and takes its own `budget`.

**The widened landing solver is explicitly out of scope** — 6× the search scores
flat-to-slightly-worse over eight worlds, and the composition terms are already
at what the terrain offers. The hero is a thing to *place*, not a thing to
search harder for.

---

## 3 · Q3 — is `?q=low`'s austerity right?

`grass: [0.30, 0.28, 0.26, 0.24]`, `cities: false`, `volumetrics: false`.

**The question inverts once §1.1 is on the table.** Low is not too austere. Low
is **2.3× over §5's whole-frame triangle ceiling with grass alone**, and it is
the *least* wrong row in the table. The austerity was a budget decision made
before the meadow's cost was known, and it was not austere enough — but the
remedy is not to make it harsher, because the multiplier is the wrong dial.

`grass[]` scales the whole law uniformly per ring. Halving it halves the near
field, which is the 10% that is individually legible and the only part that
fills the lower third, in order to save on the 48% that is sub-pixel. That is
the trade backwards. The dial that is *right* is the one §9.5 already names —
retire the marks that no longer resolve, and let the near field keep its
density — and that is a change to the **ring bands**, not to the multipliers.

`cities: false` is a separate question and is not this plan's (`city.js` is not
in scope). It is noted and left.

---

## 4 · Acts, in order

Everything is behind **`?subj=1`**, default-off, per §7.4. The flip is a
separate commit and does not happen in this plan without a scored capture.

| # | Act | Files | Gate |
|---|---|---|---|
| 1 | **The hero, as a law** — `heroSite()`: where a subject stands given a spawn, a heading and a ground | `src/life.js` | `verify.js --suite hero`: in-frustum on 100% of worlds; off-centre per §9.7; on dryland; never inside the settlement; deterministic |
| 2 | **The hero, as wood** — grow it at hero scale and hand it a proportionate share of the wood, leaf and flower budget | `src/life.js`, `src/tree.js` | the tree grows; §5 cost stated per tier; blossom cap unchanged in total |
| 3 | **The floor, where it resolves** — retire the sub-pixel far band and pay the near field with what it refunds | `src/meadow.js`, `src/quality.js` | `verify.js --suite meadow` green; triangles/frame against §5 stated per tier |
| 4 | **Capture and critique** | — | `?q=desktop` shots before/after; §8 axes 1, 3, 5 named by region |
| 5 | **Flip** | one commit, on its own | §7.4 |

Acts 1 and 3 are independent — one is the subject, one is the floor — and are
committed separately so either can be reverted without the other.

---

## 5 · Budgets (§5)

§16 rule 2 asks for a feature's cost against §5 *before* it is proposed. Here it
is, grown with the real `growTree()` and counted over 40 worlds — a wood segment
is ten triangles, a leaf clump twenty, a petal five:

| tier | height | segments | wood | clumps | leaves | flowers | **net added** | of §5 |
|---|---|---|---|---|---|---|---|---|
| low / mobile | 19.8 m | 720 | 7,200 | 505 | 10,096 | 554 | **11,705** | **0.53%** |
| desktop / ultra | 19.8 m | 1,343 | 13,429 | 1,128 | 22,554 | 1,277 | **27,383** | **1.24%** |

"Net added" is against the ordinary tree that site would have grown anyway. The
flowers are **moved, not added** — 22% off an unchanged cap — which is why the
net is wood and leaves only. `suiteHero` holds both numbers.

For scale: the hero is **1.24% of §5's triangle budget** and the grass is
**1343%** of it. The two questions are genuinely separate, and only one of them
is this milestone's to answer without a frame.

Act 3's built half (`curvedRings` 2 → 1 on ultra) is a **refund** of 20.0 M
triangles. Its unbuilt half is in §1.2.

No frame *time* is measured in this container (§0.2).

---

## 6 · Risks and rollback

- **A hero tree is a wall if it is too close.** `life.js` already refuses a
  trunk within 14 m of spawn for exactly this reason; the hero's distance band
  is bounded well outside it and the suite asserts it.
- **Retiring the far band could read as a shrinking world.** It is the failure
  §11 names as un-grassed annuli, approached from the other side. The band that
  goes is the one `horizon.js` already draws as silhouette, and the gate for act
  3 is that no ring boundary becomes visible — the density law stays continuous
  across every boundary that remains.
- **Rollback:** `?subj=0` for acts 1–2. Act 3 is a table edit plus a band edit;
  reverting is reverting two literals.

---

## 7 · Evidence

Nothing here is a claim about a frame unless it cites a capture (§16 rule 1).

### Offline, and therefore settled

| gate | result |
|---|---|
| `parse.js` | 137/137 modules · 3 raw shaders · 369 import edges |
| `invariants.js` | 709 checks clean — §2.1 assets, §2.2 deps, §2.3 entropy, §4, §10 |
| `verify.js` | **1156/1156**, including 26 in the new `hero` suite and 12 added to `meadow` |
| `digest.js` | `d33f6d933f1642d35a2921df814e9d194ad45a9a8eb8e5428dc65e7cf0bb73bf` · 7521 samples · linux/x64 |

The `curvedRings` gate was seen to go **red before it went green**, per
`docs/notes/ci.md`'s rule that a gate nobody has watched fail is not evidence:
it failed on ultra's `curvedRings: 2` (ring 1 never reaches 3 px anywhere in its
22–84 m band) and passes on 1.

### On a frame — and what this container could not do

**This container cannot render a `?q=desktop` surface frame on a land world.**
Established the hard way: a capture at `--seed 144 --builds "q=desktop"` ran
**over forty minutes** without reaching a first frame and was killed. The one
`?q=desktop` capture that *did* complete (seed 1337146641) completed because it
landed on a 240 K ocean world with no dryland and therefore no meadow to build —
which is how `tools/meadowseed.js` came to exist.

So the A/B below runs at `grass=0.06,0.05,0.03,0.02, blades=2,1,1,1` — about 5%
of the desktop row — because that is what will render here. **It is evidence
about the hero and it is not evidence about the meadow's density.** The meadow's
density is settled by `drawcensus.js` above, which needs no frame.

- `docs/captures/density-baseline/q-desktop.png` — the ocean world, kept
  deliberately: it is the picture that shows why `--want life` is not a meadow
  predicate.
- `docs/captures/subject/` — seed 144, star 1933272655, planet 2, G star
  5749 K, Teq 286 K. Landing solved 0.642 (`lowHorizon 0.00 offCentre 0.65
  hero 1.00 lead 0.72 walls 1.00 band 1.00`). A/B on `?subj=1`.

### §8, scored on the baseline frame

`docs/captures/subject/q-desktop-grass-0-06.png` — **UNIVERSE 144 · KORORA**,
terrestrial, 1.04 g, 286 K, `FIRST BLOSSOM · NO SEASON, ALWAYS`, print
`PAINTED`, sun +12°. Ring 0 at 6% density, rings 1–3 at the full desktop row.
This is the **first frame this project has of a temperate land world with grass
in it**, and it settles two arguments and opens a third.

One sentence per axis, naming the region, per §8:

1. **Silhouette — 1.** The only vertical objects in 1280×720 are eight thin pale
   arcs sitting exactly *on* the horizon line between x≈150 and x≈650, and one
   low blue-grey mass at x≈850. Nothing reads as a subject at any of the three
   distances the axis asks about; the lower half of the frame is one texture.
2. **Light — 3.** A dominant sun is legible in the upper-left wash and the sward
   carries a broad vertical gradient, but no surface in frame shows a second
   term — no rim on the tree arcs, no bounce under them.
3. **Depth — 2.** Two planes: sward and sky. The trees are *on* the horizon
   rather than in front of it, so there is no middle ground; the whole 84–1250 m
   band reads as one continuous green.
4. **Motion — n/a on a still.**
5. **Materials — 2, and this score is not admissible against the material
   law.** The sward is nameable as grass and nothing else in frame is nameable
   at all. But `?grass=0.06` is a *short list*, and `qArr()` pads a short list
   from the row — so this frame ran **ring 0 at 6% and rings 1–3 at the full
   desktop row**, which is the near field thinned to a sixteenth while the far
   field runs at 100%. That is the opposite of a real frame. Roughly the bottom
   43% of the lower half is ring 0 at 6%, and everything above it is the
   84–1250 m band at full density. So the flatness in the lower half is partly
   §1.2's green plane — which this frame does confirm, at the scale predicted —
   and partly an artefact of the thinning, and this capture cannot separate
   them. **The axis-5 number stands as an observation about this frame and not
   as a finding about `bladeColour()`.**
6. **Colour — 3.** Two hue families (chartreuse, sky-cream) plus the pale
   blossom accent; nothing clips; the lift holds, correctly for an atmosphere.
7. **Chrome — 4.** Deleting the HUD loses nothing.
8. **Honesty — 4.** Nothing contradicts the physics the HUD asserts.

**Mean 2.7, against §8's gate of ≥4 on every axis and ≥4.5 mean. It fails, and
the blocking axis is 1.** Axis 1 is admissible — a thinned near field cannot
remove a subject that was never placed — and so are 2, 3, 6, 7 and 8. Axis 5 is
not, for the reason given above.

What it settles:

- **The floor is not empty.** The meadow fills the lower ~55% of the frame and
  the blades are individually legible as strokes — **at a sixteenth of the near
  ring's density**, which is a stronger result than a full-density frame would
  have been. The problem was never that there is too little grass.
- **There is no subject.** Axis 1 confirms §2 from the frame rather than from
  the code.

And what it opened: **the eight arcs are trees in full bloom, and they are the
defect this frame found.** At ~300 m the foliage LOD keeps 16% of a crown's
clumps while the blossom kept its full even share — so the petals outnumber the
leaves and a tree reads as a wire with specks on it. That is fixed under
`?subj=1` (`blossomShares()`), and it is the third time `coverDensity` has had
to be carried to an object class that was missed.

### One more line, measured in passing and not acted on

`tools/drawcensus.js`'s attribution shows a `MeshDepthMaterial USE_INSTANCING`
pass carrying **152,604 instances and 1,901,780 triangles** — 86% of §5's whole
frame budget, in the shadow pass alone, at 1.2% grass and with the shadow map
already wrecked down to `shres=512, shtaps=1`. It is the tree wood and foliage:
`life.js` calls `markCaster()` on both, and both are single `InstancedMesh`es
spanning the whole 1400 m tile.

`SHADOW_SPAN` is **480 m**. The tile is 1400 m. So a large fraction of those
instances stand outside the light camera's box and cannot contribute a texel —
but a world-spanning instanced mesh has one bounding sphere, so three submits
every instance to the depth pass every frame regardless.

**Not fixed here, and the reason is that the obvious fix is wrong.** A static
near/far split around the spawn works for the opening frame and breaks the
moment you walk 300 m, because the shadow box follows the view and the mesh is
built once. Doing it properly means spatial buckets, which is a design decision
and not a tweak — and, like the ring bands, its payoff is a §5 line that cannot
be scored here. It is written down so the next session starts from the number.

### The next act, and what it needs

Act 3's remaining half — bringing `RINGS[3].far` in from 1250 m to where
`meadowSettle()` has already converged the far field toward the sward mean
(90–430 m) and `horizon.js` takes over — is **specified in §1.2 and not built**.
It is the change that would pay most of §5's bill, and it is exactly the change
that must not be made blind: on a clear-air world (`visibilityFor()` reaching
22 km) a grass line at 500 m would be visible, and no gate here can tell me
whether it is. It needs one capture on real silicon.

---

## 8 · Notes for the sessions this one is not

- **`docs/plans/SAKURA.md` has no §12.** The brief for this session cites
  "§12, measured negatives"; the file on this branch ends at §10. If §12 exists
  it is in the working tree of the session that owns that file. Nothing in this
  plan depends on it.
- **`tools/shot.js` on this branch has no `--want meadow`** — `WANT` is
  `{any, life, aurora}` and an unknown key falls through to `any`, which would
  have photographed a lifeless world. This plan's captures use `--want life`.
  Likewise `--tier thumb` is not in `TIERS` (`{desktop, mobile, low}`) and
  resolves to the 1280×720 low viewport. Both are in the hands-off set and were
  not touched.
- **`src/print.js`, `register.js`, `exposure.js`, `post.js` were not opened.**
  If the ground still reads flat after this plan's acts, the light model
  (`?paint=1`, §9.2, still default-off) is the next suspect and it is theirs,
  not this one's.
