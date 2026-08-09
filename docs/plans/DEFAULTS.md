# The defaults sweep

**What ships when nobody passes a flag** — and the gap between that and what is
built, gated and green.

§7.4 says a feature lands default-off and that *"flipping the default is a
separate commit."* Followed faithfully for two milestones, that rule
accumulates: every act of M1, M2 and M3 is behind its own flag, each one
measured against a baseline with the others off, and **the combination has
never been rendered.**

This document is that render.

---

## 1 · What is actually off

| flag | what it gates | default |
|---|---|---|
| `m1` | the cosmic web — density × divergence colour, ordered dither | **off** |
| `m3` | the wind field, the meadow density law, grass rings | **off** |
| `m5` | vehicles | **off** |
| `paint` | §9.2's light model — the half-Lambert wrap, the three-stop ramp | **off** |
| `mat` | §M2 act 4 — four-layer triplanar materials | **off** |
| `sea` | §M2 act 5 — twelve Gerstner waves on a Pierson–Moskowitz spectrum | **off** |
| `ridge` | §M2 act 6 — far ridges as measured silhouette | **off** |
| `solve` | §9.7's landing-site composition solver | **off** |
| `airmat` | §9.3 into the 46 materials three.js owns | **off** |
| `aurora` | the curtain from the ground | **off** |
| `intnoise` | §2.7's exact gradient path | **off** |
| `wash` | §9.4 step 5's watercolour softening | **off** |

On by default: `m2`, `m4`, `m7`, and `aerial` (which is `m2 && aerial !== '0'`,
not the bare `=== '1'` a careless grep reports).

**Someone opening the URL sees a build that predates most of the last several
milestones.**

---

## 2 · It is a graph, not a list

Three of these cannot be flipped in isolation, and the reasons are already
written in their own docstrings:

- **`paint` is blocked on `mat`.** §9.2's ramp needs real `shade`/`mid`/`lit`
  stops; what feeds it today is *"a derivation from one base colour, marked in
  the shader below as a placeholder for exactly that reason."* `mat`'s own
  docstring names this as its second job: *"to unblock `?paint=1`."* So `mat`
  first, then `paint`, and never `paint` alone.
- **`solve` is blocked on a hitch**, not on quality: 127–337 ms of main thread
  inside `_buildTerrain`, which is 10–28× §5's 12 ms budget in the frame it
  lands, and §2.5 forbids hiding it behind a cut.
- **`intnoise` moves every world**, so the `ground` goldens are re-taken in the
  same commit. §28.7 leaves that to a human.

---

## 3 · Does the combination even work?

First question, cheapest to answer, and it had never been asked. Boot probe,
cumulative, one route:

```
boots  (default)             7s
boots  mat                   6s
boots  mat+paint             7s
boots  +sea+ridge            7s
boots  +airmat+aurora        7s
boots  everything but m3     8s
boots  everything          110s     mat paint sea ridge airmat aurora m5 intnoise wash m3
```

**No page errors anywhere, including the full stack.** The 110 s for the meadow
is SwiftShader, not a defect — the same probe against the pre-merge branch
behaves identically.

That is a better result than it looks. The two `aerial()` implementations this
repo carried used *opposite* alpha conventions, and a combination that compiles
and renders is not something to assume.

---

## 4 · What it costs, measured

`node tools/tone.js`, seed 1337146641, cumulative, HUD masked:

| build | mean | sd | sat | pixels moved |
|---|---|---|---|---|
| `m2=1` — the default | 143.9 | **35.5** | 0.343 | — |
| `mat=1` | 149.1 | 31.9 | 0.326 | 37.6% |
| `mat&paint` | 160.7 | 29.1 | 0.309 | 40.2% |
| `+sea&ridge` | 160.7 | 29.1 | 0.309 | **0.16%** |
| `+airmat` | 162.1 | **26.0** | 0.295 | 14.3% |

**Every flag lightens and flattens.** Mean climbs 143.9 → 162.1, standard
deviation falls 35.5 → 26.0, saturation falls 0.343 → 0.295. Stacked, that is a
**26.8% loss of the frame's contrast**.

This is docs/plans/M2.md §30 happening again, and §30 already named the
mechanism: *"Nobody was wrong at any single step. There was simply no number
that carried across them."* Each of these was signed off on its own evidence
against its own baseline. `tone.js` exists so that the *sum* has a number too,
and this is the first time it has been pointed at the sum.

Not all of it is a defect. §9.2's half-Lambert wrap exists to lift a grazed
valley floor; §9.3 into the props lifts distant buildings out of black, which is
depth working and a contrast metric penalising it. But 26.8% is too much to wave
through as intent, and **that question now blocks every flip.**

---

## 5 · The methodological catch, which nearly became a wrong conclusion

`sea` and `ridge` together moved **0.16% of pixels**, and every tone statistic
was identical to four significant figures. The obvious reading is a dead flag —
two whole M2 acts doing nothing.

It is wrong. Locating the changed pixels settles it:

```
1463 pixels changed, bounding box x 814..1279  y 369..387
busiest rows: y=375 (181px)  y=376 (177px)  y=377 (179px)
the horizon in this frame sits near y=380
```

A nineteen-pixel band, on the horizon, on one side of the frame. Both features
are working perfectly and **the test world has nothing for them to do**: its far
shore is a low flat sand strip, so a *measured* skyline silhouette is correctly
almost nothing, and its foreground water is shallows rather than open sea.

The finding is about the instrument, not the code: **one world cannot sweep
every flag.** A flag whose feature has no subject in the test frame produces the
same number as a flag that is broken, and only the pixel locations tell them
apart.

---

## 6 · Order of work

| # | | blocked on |
|---|---|---|
| 1 | resolve the 26.8% — how much is intended compression | nothing; it gates everything below |
| 2 | re-measure `sea` and `ridge` on a mountainous, open-ocean world | §5 |
| 3 | flip `mat`, then `paint`, in that order, in two commits | 1 |
| 4 | flip `airmat`, `aurora` | 1 |
| 5 | flip `sea`, `ridge` | 2 |
| 6 | flip `m3` | a real GPU — §M3's gate is ≥800k blades at ≥60 fps and SwiftShader takes 110 s to a first frame |
| 7 | flip `m1`, `m5` | their own captures, not yet taken |
| 8 | `intnoise` | re-taking the `ground` goldens in the same commit |
| 9 | `solve` | slicing the 127–337 ms solve across frames |
| 10 | `wash` | 1 — it was held pending exactly this question |

Six of the ten wait on one measurement, which is why it is first.
