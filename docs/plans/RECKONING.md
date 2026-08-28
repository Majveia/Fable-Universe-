# The reckoning — what comes before M6

**Governing document:** `CLAUDE.md`. This does not supersede it; it enforces the
parts of it that five milestones of forward motion quietly stopped enforcing.

> **Do not begin M6 until every act here is closed or explicitly waived in a
> commit that says so.**

---

## 0 · Why this file exists

Five milestones were built to a high standard of proof and a low standard of
evidence. Every module has an offline suite; the frame has no witness.

The failure was not any single decision. Every deferral was locally defensible
and was defended, in a careful paragraph, at the point it was made. **Nobody
ever summed them.** That is the actual defect, and it is a process defect, so
the fix is a process one: the sum gets read out loud at the start of every
session from now on.

Here is the sum, as of M5.

| debt | §  | state |
|---|---|---|
| ~~The §9.2 light model is off by default~~ | 9.2 | **CLOSED** — flipped on. Both withdrawal causes were fixed by later work (act 3b's detail normal; `visibilityFor` making fog a weather) and nobody re-tested. Re-measured: ground luma 0.581 → 0.608, saturation and sky unchanged, 0.6% blown either way. The old "flattens to a pale wash" is gone. A small win, and `SAKURA.md` §13 says why — that frame's lower half is grass, and `paint()` shades terrain |
| Four-layer materials off | M2 act 4 | `?mat=1` |
| The Gerstner ocean off | M2 act 5 | `?sea=1` |
| Far ridges as silhouette off | M2 act 6 | `?ridge=1` |
| **All of M3 — wind and grass — off** | 6 M3 | `?m3=1` |
| **All of M5 — traversal — off** | 6 M5 | `?m5=1` |
| The composition solver off | 9.7 | `?solve=1` |
| §5's budgets measured with the grass off | 5 | Still open, and for a *second* reason: `capture.js` benched the wrong software (`--extra` reached the stations, not the bench URL). Fixed; not yet re-run |
| **M1's gate clause (b) still fails** | 6 M1 | **3** hue families of 4 (not 2 — ledger was stale); nine iterations; the fourth is blocked behind Act C. Needs a decision, see Act D |
| ~~No plan for M4 or M7~~; none for M6 | 7.2 | **Act E closed** — `M4.md`, `M7.md` backfilled, marked retrospective |
| ~~**The critic has never run**~~ | 8 | **Act A closed** — scored blind on an RTX 3060, all-flags **3.00** vs default **2.43**. §8's gate still FAILS (needs ≥4/≥4.5) |
| **The ground has no material** | 8 · 6 M3 | **NEW, and now the blocking axis.** Near-ground gradient 1.07/255; featureless at 5× magnification. Materials scored 1 and 2 |
| **`planet-orbit` never reaches true black** | 2.8 | **NEW.** rgb(13,7,0), 0.0% of the frame at #000, both flag sets. `star-system` is correct, so it is specific to the planet scale |
| **§9 names one art reference; the code now has an axis between two** | 9 · 3 | **NEW, and it is a debt in the constitution rather than in the code.** `src/register.js` makes hoshi-no-tani and sakura-realm the two ends of one axis chosen by `visibilityFor()`, and §9 still reads as though there is one north star. `docs/plans/SAKURA.md` §10 states the exact edit. **It needs a human**, per §7.2 — an agent rewriting the clause it is being judged against is the one edit no agent should make |
| **The register and the aperture have never been captured** | 8 · 16.1 | **NEW.** `registerFor()` and `apertureFor()` are proved arithmetically — 1000/1000 offline, R=1 bit-identical to the shipped print — and **not one frame has been rendered through either**. Twelve of `PHOTOGRAPHIC`'s fourteen knobs are transcriptions of intent that only a blind §8 score can settle |
| The cabin, the seat and the piloted descent are off | 2.4 · 2.5 | **NEW, and honestly declared.** `?cab=1`. Half of §5 is now measured (`tools/cabincost.js`: **6 draw calls, 3.2 k triangles, no textures** — 0.7% and 0.15% of budget). Flipping it still needs a frame-time number from real silicon and a scored capture; see `docs/plans/LONG-SILENCE.md` §§9–10 |

A visitor who opens the page gets the print, aerial perspective, a body, a
camera and a mobile layer. They do not get the light model, the materials, the
sea, the far ridges, the wind, the grass, the craft, the composition, or —
as of `descent.js` — the ship they could have flown down in. **The
project's entire visual thesis is unshipped**, and each flag has a good reason
that is true individually and indefensible in aggregate.

**Act A has now answered the question this file was written around**, and the
answer is two-sided. The flags *do* make the frame better — four hue families
against two, 0.57 of a mean point, decided blind. And the frame they make is
still not good enough: **3.00 against a gate of 4.5.**

So the ledger's conclusion changes. Flipping the defaults is no longer the
highest-value commit in the repo, because it would ship a frame that fails §8.
The highest-value commit is whatever gives the ground a material — it is more
than half of every frame, it carries neither texture nor directional light, and
it is the single defect behind both failing axes.

---

## 1 · The prompt

Paste this. It is the whole thing.

```
Read CLAUDE.md and §9 in full, then docs/plans/RECKONING.md.

Before anything else, report the debt ledger in RECKONING.md §0 as it stands
today — what is still default-off, which gates are still open, and what §5
measures with which flags. If the ledger is stale, correct it first and say so.

Milestone: RECKONING — evidence before more construction.
Goal this session: <one act from §2 below, named>.

Do not begin M6. Do not begin any new milestone. If the act you are on
finishes early, do the next act in §2, not the next milestone.

Follow §7 exactly. Additionally, and overriding §7 where they conflict:

  · Any claim about how something LOOKS must cite a capture or say plainly
    that it is unverified. "The suite passes" is not evidence about a frame.
  · Before proposing any new feature, state what it costs against §5 measured
    WITH the grass on. If that number does not exist, get it first.
  · A flag that is default-off is not shipped. When you finish work behind
    one, say in the same message what it would take to flip it and what the
    flip would cost.

Stop and ask me if: an invariant in §2 would have to bend, a budget in §5 goes
red and cannot be paid back, the critic fails the same axis three times, or a
gate for an earlier milestone is still open. The last one is new, and it is
new because it was violated four times.
```

---

## 2 · The acts, in order

Two of these need a human with a GPU. The rest do not, and are ordered so the
machine-only work can proceed while the human work is pending.

### Act A — Look at it *(needs a GPU and a human)*

The only act that can be done by nobody else, and everything downstream depends
on its answer.

On real silicon, capture three sets on the same route and same seed:

1. the **default** frame — no flags;
2. the **all-flags** frame — `?m2=1&paint=1&mat=1&sea=1&ridge=1&m3=1&m4=1&m5=1&solve=1`;
3. **the reference** — `docs/reference/hoshi-no-tani.html`, served by
   `tools/serve.js` so its importmap resolves offline.

Score all three **blind** against §8's eight axes — shuffled, without knowing
which is which. §8's rule holds: one sentence per axis naming the specific pixel
region that lost the point. *"Looks good"* is a failed review, and so is
*"not AAA."*

**Gate:** three scored sheets, and an answer to one question — *is the
all-flags frame better than the default frame?* Everything in Act B turns on it.

### Act B — Decide the defaults *(needs Act A)*

Not "flip the defaults." **Decide** them, per flag, with the evidence in hand.

For every flag in §0's ledger, one of exactly two outcomes, both written down:

- **flipped**, in a commit that does only that (§7.4), with the §5 cost stated;
- **held**, with a named blocking reason and the condition that would release it.

A flag with neither is a decision nobody made. `?m2=0`-style escapes stay, so
§2.4's saved URLs keep resolving to the frame they always did.

### Act C — Re-measure §5 honestly *(needs a GPU)*

`?bench=1`, three tiers, **with the grass on**. The current 0.19 M triangles p95
and its 11.6× headroom describe a frame with no meadow in it, and M3 instances
about 3.33 M blades against a 2.2 M triangle cap.

If it goes red: §12 says stop and ask, and this time actually stop. §5's rule is
*any change that costs frames must pay for them* — the LOD comes before the
feature, not after the measurement.

**Gate:** a perf JSON per tier whose flag set matches whatever Act B decided,
and a plain statement of whether §5 is green for the frame we intend to ship.

### Act D — Close or waive M1 (b) *(offline)* — **needs one decision**

§6 says strict order: no M(n+1) until M(n) passes its gate. M1's clause (b) —
four distinguishable hue families in the cosmic web, all within 0.02–0.85
luminance — has been stepped over four milestones.

**The ledger understated this act, and the correction matters.** The clause does
not read FAIL-2 any more and it is not waiting on a palette tweak. Reading
`docs/plans/M1.md` §9–§13 end to end, it has had **nine iterations across four
independent lines of attack**, each of which produced a measurement rather than
an opinion:

| attempt | § | result |
|---|---|---|
| five palette and luminance treatments | 9 | 2 families |
| the slab — shorten the ray so local hue survives | 10 | 2 families, **but restored §2.8's true black, 0% → 31.7%** |
| signed-log divergence transfer | 11 | 2 families; clause (c) 50.7% → **95.7%**, true black → 49.9% |
| `?comp=1` depth rejection — kill additive summing | 12 | **96.3% of pixels changed, 0% of the hue distribution.** Refuted its own hypothesis |
| `?web=1` — a second physical channel (void/sheet/filament/knot) | 13 | **2 → 3 families** |

So four of the five attempts fixed something real and none of them was the
thing. The clause is at **3 of 4**, and what blocks the fourth is now measured
rather than guessed: voids are sparse *by construction* — a void is a region
with few particles, so amber lands at 0.9% of lit pixels however bright each
tracer is — knots are 2.5–4.2% of elements, and the frame is 40.5% achromatic
because soft additive points still sum to a desaturated mean even after whole
tracers are depth-rejected.

**The remaining fix is a dominant-class resolve — a rendering change of its own
size. §5 says add the LOD before the feature, and nobody knows this project's
frame cost yet, so that work is blocked behind Act C.** Which means "just fix
it" is not currently one of the options.

What is actually on the table:

1. **Amend the measurement.** §6 M1 asks for *"≥4 distinguishable hue families"*;
   §8 axis 6 asks for *"≤3 hue families plus one accent."* Together they pin it
   at exactly four, and the disagreement is what a *family* is. As four modes in
   a pixel histogram it is unreachable from two physical channels. As four hues
   a viewer can point at, the frame already has violet, blue, teal, amber and
   cream, all selected by physics. Changing `tools/gate.js`'s operationalisation
   is a one-line honesty question, not a fudge — but it is a human's call
   because it changes what the gate *means*.
2. **Amend §6's ordering** to tolerate this one named open clause, with the
   condition that releases it — i.e. revisit after Act C prices the compositor.
3. **Wait**, and leave the ladder formally blocked until Act C lands.

**Recommendation: (2), then revisit (1) or the compositor after Act C.** It is
the only option that keeps the gate honest — the clause stays open, named, and
carrying its release condition — without either faking a pass or blocking five
milestones of finished work behind a rendering change §5 forbids costing yet.

Whichever is chosen, it goes in a commit that says so. An open gate everyone
steps over is worse than a constitution amended in the open.

### Act E — Backfill the plans *(offline)* — **CLOSED**

`docs/plans/` had M0, M1, M2, M3, M5. M4 and M7 shipped without one, against
§7.2. `M4.md` and `M7.md` are now written and **marked as written after the
fact**, because a retrospective plan that pretends to be a prospective one is a
lie in the repository's own record. Their job is to give §7.7's re-score
something to score against.

Three things surfaced in the writing that the ledger did not have:

- **M4 and M7 were both built out of ladder order**, pulled forward by
  `WORLDS.md` §2. That was a human decision and is now recorded in both files
  rather than living only in a session transcript.
- **M7 has never run on a phone.** Every clause of its gate was measured in a
  desktop Chromium pretending to be one at 390 × 844. Emulation gets the layout
  right and says nothing about whether a thumb reaches the fan.
- **M4's two constants — eye 1.80 → 1.68 m, FOV 62 → 52 — moved every existing
  capture, and no milestone was re-shot against them**, which §7.7 requires.
  Act A inherits it.

`M6.md` is still unwritten, and M6 is still not started. That is correct: §3
says it waits.

### Act F — Run the critic, properly *(needs Act A's captures)*

§7 gives the critic its own role and says it is *adversarial by design* and
writes no code. It has never run. Run it, on the frame Act B decided to ship,
against all eight axes.

**Gate:** ≥4 on every axis and ≥4.5 mean, or a written account of the blocking
axis. Max five iterations, then escalate — §7.6, which also has never been
exercised.

---

## 3 · Then, and only then

M6 · civilisation. It is the milestone the original ask cared most about —
cities, buildings, a place with people in it — and it is where §9.7's
composition solver finally lands. It deserves to be built on a frame someone has
looked at, on budgets measured with the grass on, and on a ladder with no rungs
missing.

---

## 4 · The standing rule this file leaves behind

One sentence, and it is the whole lesson:

> **A locally defensible deferral is still a deferral, and deferrals sum.**

So: the ledger in §0 is read at the start of every session and corrected if
stale. Not as ceremony — as the only mechanism that would have caught any of
this, because every individual decision here would survive review on its own,
and only the total does not.
