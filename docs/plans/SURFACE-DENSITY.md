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

This is not a new defect discovered here; it is one the repository had already
measured and not summed. `src/quality.js`'s own note records *"ring 0 spent
5,368,656 triangles — 40% of the entire frame — on the 447,388 blades inside 26
metres"*, which puts the whole low-tier frame at ≈13.4 M against a 2.2 M budget.
The model above reproduces that measurement to 3%. The sentence was written to
justify the `curvedRings` column and the conclusion beside it was never drawn.

**§16 rule 3 is therefore closed, and the answer is worse than "unmeasured".**

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

Act 2 adds **one tree**. Its cost is bounded by its own `budget` argument and
its blossom share, both stated at the call site, and it is the one object in the
frame §9.7 says should be expensive.

Act 3 is a **refund**, and the size of the refund is the whole argument for it.

Neither act is measured for frame *time* in this container (§0.2). Triangles are
measured, per tier, by `tools/drawcensus.js`, before and after, and the numbers
go in this file's §7 as they land.

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

Filled in as it lands. Nothing here is a claim about a frame until it cites a
capture (§16 rule 1).

- `docs/captures/density-baseline/` — `?q=desktop`, seed 1337146641, biosphere
  world, landing solved 0.578 (`lowHorizon 0.59 offCentre 0.95 hero 0.96
  lead 0.58 walls 0.00 band 1.00`).

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
