---
name: gpu-run
description: Run AEON's GPU evidence pass on real silicon — the three capture sets, the blind §8 scoring, and §5's budgets measured with the grass on. Use when the user asks to run the GPU test, benchmark AEON, score the frame, do Act A or Act C of the reckoning, or find out whether it actually looks good. Requires a machine with a real GPU; refuses to produce evidence on SwiftShader.
---

# The GPU run

This is the one thing the build container cannot do. Everything in `tools/`
executes anywhere; only some of it *means* anything without a GPU, and §M0 is
specific: **"Real GPU, not CI SwiftShader."**

Two acts of `docs/plans/RECKONING.md` live here — **Act A** (look at it) and
**Act C** (re-measure §5 honestly). They are the two the rest of the reckoning
depends on.

---

## 0 · Refuse to fake it

Before anything else, confirm there is a real GPU. Every artefact this skill
produces carries the renderer string, and a run on a software rasteriser is
worse than no run: it produces perfectly valid numbers about the wrong machine,
and nothing downstream would say so.

```bash
node -e "console.log(process.platform, process.arch)"
```

Then, after the first capture, read `renderer` out of any `perf-*.json`. If it
contains **SwiftShader**, **llvmpipe**, or **ANGLE … Vulkan … Subzero**, stop
and tell the user the run is invalid. Do not score anything. Do not fill in a
scoring sheet. Say plainly which machine it ran on and that a real GPU is
needed.

`docs/GPU-RUN.md` records four earlier runs that lost most of their value to
exactly this class of problem — three to a stale checkout, one to a broken
shutter. Read its "runs" sections before starting; they are a list of the ways
this goes wrong.

---

## 1 · Setup

```bash
git clone https://github.com/Majveia/Fable-Universe-.git
cd Fable-Universe-
git checkout claude/interactive-3d-universe-n6suwb    # the default branch
git pull
git status                                            # MUST be clean

npm i -g playwright && npx playwright install chromium
```

**`git status` is not a formality.** A run from a tree with local edits under
`src/` or `tools/` measures those edits, not the branch. `tools/check.js` prints
provenance for this reason — if it says the tree is dirty under `src/` or
`tools/`, stop and clean it before continuing.

Nothing is installed into the repo. Playwright is global on purpose so the
project never grows a build step (§2.2). Any Node 18+ works.

Expect **40–70 minutes** end to end. Most of it is the bench, three tiers, twice.

---

## 2 · Act A — the three capture sets

The question this act answers is one sentence long: **is the all-flags frame
better than the default frame?** Everything in RECKONING Act B turns on it.

```bash
# 1 · the DEFAULT frame — what a visitor actually sees today
node tools/capture.js --milestone RECK-default --tiers desktop

# 2 · the ALL-FLAGS frame — what the project is actually about,
#     and what nobody has ever looked at
node tools/capture.js --milestone RECK-allflags --tiers desktop \
  --extra "m2=1&paint=1&mat=1&sea=1&ridge=1&m3=1&m4=1&m5=1&solve=1"
```

Both write numbered PNGs plus `manifest.json` into `docs/captures/<milestone>/`.
The manifest records the `extra` query, so the two sets can never be confused
for photographs of the same software.

### The reference

§8 is explicit that the art north star is *executable*: you cannot play the
commercial games it forbids, but you **can** run
`docs/reference/hoshi-no-tani.html` and capture from it.

```bash
node tools/serve.js            # swaps its CDN importmap for the vendored three
```

Then open `http://localhost:8080/docs/reference/hoshi-no-tani.html`, let it
settle, and save a screenshot as
`docs/captures/RECK-reference/01-desktop-surface.png`.

Match the surface station's framing as closely as you can — eye height, a low
horizon, a valley across the frame. It does not need to be exact. It needs to be
the same *kind* of shot, because §8 scores composition and light, not registration.

---

## 3 · Blind scoring — §8

§8's rule, verbatim: score 0–5 on eight axes, **gate ≥4 every axis and ≥4.5
mean**, and **one sentence per axis naming the specific pixel region that lost
the point.** *"Looks good"* is a failed review. So is *"not AAA."*

Blind means blind. Use the tool rather than promising to be fair:

```bash
node tools/blind.js --sets RECK-default,RECK-allflags,RECK-reference
```

It matches stations across the sets, shuffles each station's images into
`A.png` / `B.png` / `C.png`, writes a `SCORE.md` template, and seals the mapping
in `key.json`.

**Do not open `key.json` until `SCORE.md` is filled in.** If you are an agent
doing the scoring, you must not read it — announce that you are not reading it,
and score from the images alone. Then:

```bash
node tools/blind.js --reveal
```

which prints the mapping and rewrites `SCORE.md` with the labels attached.

### The eight axes

1. **Silhouette** — readable subject at three distances?
2. **Light** — a dominant light with direction *and* a secondary bounce or rim? Any surface receiving no light information at all?
3. **Depth** — aerial perspective present? Three separable depth planes?
4. **Motion** — at least one element moving with coherent, non-loopable motion? *(needs the live page, not a still — note it as unscoreable from a capture if so)*
5. **Materials** — every surface nameable without labels?
6. **Colour** — ≤3 hue families plus one accent; nothing clipping; **in vacuum blacks at true 0, in atmosphere no pixel below the lift** (§2.8).
7. **Chrome** — delete the HUD entirely and lose no orientation?
8. **Honesty** — does anything on screen contradict the physics the HUD asserts?

---

## 4 · Act C — §5's budgets, measured with the grass on

The number in `docs/GPU-RUN.md` — 0.19 M triangles p95 against a 2.2 M cap,
11.6× headroom — describes a frame **with no meadow in it**. M3 instances about
3.3 M blades. That figure is not a measurement of the frame we intend to ship.

```bash
node tools/capture.js --milestone RECK-budget --tiers desktop,mobile,low \
  --extra "m2=1&paint=1&mat=1&sea=1&ridge=1&m3=1&m4=1&m5=1"
```

Read `perf-desktop.json`, `perf-mobile.json`, `perf-low.json` against §5:

| tier | p95 / p99 |
|---|---|
| Desktop ref — M-series or RTX 3060 class @ 1440p | ≥ 60 / ≥ 50 fps |
| Mobile ref — iPhone 13 class, DPR capped 2.0 | ≥ 30 / ≥ 25 fps |
| Low — Intel Iris / Adreno 6xx | ≥ 30 / ≥ 24 fps |

Per-frame at surface scale: **≤ 900 draw calls · ≤ 2.2 M triangles · ≤ 12 ms CPU.**
GPU memory: ≤ 400 MB desktop, ≤ 220 MB mobile.

**If it is red, say so and stop.** §12 says stop and ask when a §5 budget goes
red and cannot be paid back, and §5's rule is *any change that costs frames must
pay for them* — the LOD comes before the feature. Do not propose optimisations
in the same message; report the number first and let the human decide.

---

## 5 · M5's three questions

M5's speed governor is derived and its arithmetic is closed offline. What is not
closed is whether it *works*. `?m5=1` turns it on.

1. **No pop-in on a traverse.** Fly the globe low and fast with `?m5=1`, then
   `?m5=0` on the same seed. Without the governor the prediction is specific:
   the ground under you stays a level coarse and then snaps when the stream
   catches up. **If you cannot tell the difference, say so** — that is a real
   result and it means the bound is solving a problem this hardware does not
   have.
2. **Does it read as air thickening or as a wall?** It is soft by construction —
   inert below 0.72 of the bound — and the HUD prints `throttle · held at …`
   when it engages. Whether that lands as honest or as the ship fighting you is
   a judgement, and §8 axis 8 is where it would fail.
3. **Should it govern at orbital altitude at all?** The bound comes out below
   the existing speed clamp up there, because crossing the planet in four
   seconds genuinely churns the whole tile set — but an unrefined tile subtends
   a few pixels at that range. Fly an orbit-to-ground descent and say whether
   the transit feels throttled.

### The one number to bring back

**The HUD's `throttle` row prints the measured tile-build time τ for that
machine.** It is 8.6–11.6 ms on a container CPU. The entire speed bound scales
inversely with it, so one figure from a real GPU and one from a phone say more
about M5 than any screenshot.

---

## 6 · What to send back

Commit the artefacts and open a PR. They are evidence, and evidence belongs in
version control (§7.5):

- `docs/captures/RECK-default/`, `RECK-allflags/`, `RECK-reference/`, `RECK-budget/`
- the filled `SCORE.md` and, after `--reveal`, the key
- a new section appended to `docs/GPU-RUN.md` in the style of the five runs
  already there — **including what went wrong**, because four of the five
  previous runs are mostly a record of that

And answer these four in the PR body, in plain words:

1. Is the all-flags frame better than the default frame?
2. Is §5 green with the grass on? Which tier fails first?
3. What is τ on this machine?
4. Do §9.2's band edges read as art or as a bug? *(§11 lists deleting them as
   the archetypal physically-based reflex — if they look like a defect to you,
   they are one.)*

---

## 7 · Rules that hold for the whole run

- **Never present a SwiftShader number as evidence.** Say which machine it was.
- **Never score an axis you could not see.** Motion cannot be judged from a
  still; say it is unscoreable rather than guessing.
- **Never open `key.json` before `SCORE.md` is filled.** A blind test you peeked
  at is an unblinded test with extra steps.
- **Report the failure, not the fix.** If a budget is red or an axis fails, that
  is the deliverable. §7.6 allows five iterations and then demands escalation
  with a written account of the blocking axis — it does not allow quietly
  tuning until the number passes.
