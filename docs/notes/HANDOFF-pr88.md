# Handoff — resolving PR #88's conflicts

**PR:** https://github.com/Majveia/Fable-Universe-/pull/88
**Head:** `claude/the-long-silence-integration-89pvr5`
**Base:** `claude/interactive-3d-universe-n6suwb`
**State:** `mergeable_state: dirty` — six files conflict.

The base moved a long way while this branch was being built (~20 commits,
including PR #85 and #87 merges). Nothing here is subtle or ambiguous; five of
the six are mechanical. **One is a genuine name collision that needs a rename,
and it should be done first because it changes four files.**

---

## 1 · `src/pilot.js` — add/add. **Rename ours.** Do this first.

Both branches independently created `src/pilot.js` and they are unrelated:

| | base's | ours |
|---|---|---|
| what | the crew and the seat — walking a deck, sitting down in it (§2.5, §M4) | the stopping-bound flight governor (§4's "travel") |
| size | 406 lines | ~300 lines |
| imported by | `src/cabin.js`, `src/main.js` | `src/system.js` |
| verify suite | `suitePilot()`, key `pilot:` | `suitePilot()`, key `pilot:` |

**Theirs had the name first — it is on the base. Ours moves.**

Suggested: **`src/governor.js`**, because that is what the file is. The
stopping bound is the whole module and "pilot" was always a loose name for it.

The rename touches exactly four things:

1. `src/pilot.js` → `src/governor.js` (ours only)
2. `src/system.js` — its one import
3. `tools/verify.js` — our `suitePilot` → `suiteGovernor`, and the registry key
   `pilot:` → `governor:` (theirs keeps `pilot:`)
4. The `PILOT` / `PILOT_ON` const names inside are fine to keep or rename to
   taste; nothing outside reads them.

**The `?pilot=` URL flag does NOT collide.** Base uses `?cab=` for its seat
feature. Keep `?pilot=` as-is — it is in `CLAUDE.md` §13 and RECKONING Act F.

---

## 2 · `src/surface.js` — trivial. Both sides flipped the same flag.

Base commit `d386310 "The light model ships"` flipped `paint` on. So did ours.
Both landed on the **identical line**:

```js
const PAINT = PARAM('paint') !== '0';
```

The conflict is only the comment block above it. **Take base's line, keep
whichever comment reads better** — ours carries the §8-scored-3.00 caveat and
the "this is not a claim the frame passes" argument, which is worth preserving
if base's does not already say it.

Also check: our `_platedCraftMats()` and the `GREEBLE`/`paintedStandard` imports
must survive the merge. They are additive and should not conflict, but confirm
`node tools/parse.js` after.

---

## 3 · `src/main.js` — additive both sides. Union the key lists.

Base added a `cab` deep-link key; we added `cr`. Both must survive (§2.4 — a
dropped key silently breaks saved URLs).

Base has **three** delete-lists (it restructured); ours has two. Take base's
structure and add `'cr'` to every list that has `'cab'`:

```js
[..., 'room', 'cab', 'cr']
```

Then keep our write side (the `sc.craftLink?.()` block inside the
`kind === 'system'` branch) and our read side (`applyCraftLink` before anything
deeper is pushed).

---

## 4 · `tools/verify.js` — additive. Rename ours, keep both.

Base added `suitePilot` at ~10429 and registered `pilot:`. Ours collides on
both. After the §1 rename this becomes: keep base's `suitePilot`/`pilot:`, add
our `suiteGovernor`/`governor:`, and fix our import block to point at
`../src/governor.js`.

Expect the merged count to be roughly base's total plus our 21.

---

## 5 · `docs/plans/RECKONING.md` — semantic. Read both, then rewrite.

Both sides edited the §0 ledger table and both struck the `paint` row. Do not
mechanically take one side.

Ours adds **Act F** (the Long Silence port) and four rows: greeble shipped,
pilot shipped, "the thesis is shipped and unscored", and a §2.4 gap (being
aboard the station ring is a place with no URL). Base has its own strikethroughs
from the meadow/subject work.

**The merged table should carry every row that is still true from both.** The
one row that must not be lost is the §2.4 gap — it is a real open defect that
nothing else records.

---

## 6 · `docs/reference/README.md` — additive. Keep both sections.

Ours appends a "The other references" section naming `the-long-silence/` as the
third. Base edited elsewhere in the file. Straight union.

---

## After resolving

```bash
node tools/parse.js        # every module still parses and imports resolve
node tools/invariants.js   # §2 from the bytes
node tools/verify.js       # both suites present, counts add up
node tools/paintcheck.js   # 10 programs — §M0's compile gate
node tools/ringcensus.js   # 68 -> 2 still measurable
node tools/boot.js         # nothing throws on the way in
```

`ringcensus` is the one most likely to break on a bad merge, because it depends
on `_buildRing(dock, plated)` taking the branch as a **parameter**. If that
parameter is lost, both its columns silently become the same builder and the
comparison passes while measuring nothing.

## What must not be lost in the merge

- `_buildRing(dock, plated = GREEBLE)` — the parameter, not just the default.
- `painted.js`'s `detail` layer and its four `gDetail*` globals.
- `Pilot.arrived()` and `release()` zeroing `speed` — both are regression fixes
  with checks behind them.
- `'cr'` in every deep-link key list (§2.4).
- The `aHull` branch in `mergeParts()` — dropping it renders perfectly and
  silently loses all occlusion.
