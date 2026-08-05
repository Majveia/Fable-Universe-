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
| The §9.2 light model is off by default | 9.2 | `?paint=1` |
| Four-layer materials off | M2 act 4 | `?mat=1` |
| The Gerstner ocean off | M2 act 5 | `?sea=1` |
| Far ridges as silhouette off | M2 act 6 | `?ridge=1` |
| **All of M3 — wind and grass — off** | 6 M3 | `?m3=1` |
| **All of M5 — traversal — off** | 6 M5 | `?m5=1` |
| The composition solver off | 9.7 | `?solve=1` |
| §5's budgets measured with the grass off | 5 | 0.19 M tri p95 — of a frame nobody wants |
| **M1's gate clause (b) still fails** | 6 M1 | 2 hue families of 4, rolled past four times |
| No plan for M4 or M7; none for M6 | 7.2 | shipped without sign-off |
| **The critic has never run** | 8 | not once, in five milestones |

A visitor who opens the page gets the print, aerial perspective, a body, a
camera and a mobile layer. They do not get the light model, the materials, the
sea, the far ridges, the wind, the grass, the craft, or the composition. **The
project's entire visual thesis is unshipped**, and each flag has a good reason
that is true individually and indefensible in aggregate.

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

### Act D — Close or waive M1 (b) *(offline)*

§6 says strict order: no M(n+1) until M(n) passes its gate. M1's clause (b) —
four distinguishable hue families in the cosmic web, all within 0.02–0.85
luminance — reads **FAIL, 2**, and has been stepped over four times.

Exactly two honest ways out:

- **fix it** — `docs/plans/M1.md` §12 says this needs a decision about the
  palette rather than a commit, so make the decision;
- **amend §6** — in a commit that says the ladder now tolerates a named open
  clause, and why.

An open gate everyone steps over is worse than a constitution amended in the
open. Pick one.

### Act E — Backfill the plans *(offline)*

`docs/plans/` has M0, M1, M2, M3, M5. M4 and M7 shipped without one, against
§7.2. Write `M4.md` and `M7.md` **marked as written after the fact**, because a
retrospective plan that pretends to be a prospective one is a lie in the
repository's own record. Their job is to give §7.7's re-score something to score
against.

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
