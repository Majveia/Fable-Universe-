# The GPU run

Everything in `tools/` executes anywhere. Only some of it *means* anything
without a GPU, and §M0 is specific about which: *"Real GPU, not CI
SwiftShader."* This is the run that turns a capture set from documentation into
evidence, and it has to happen on a machine with real silicon.

It is one command. The rest of this page is what to expect from it.

---

## Do this

On a Mac with Apple silicon, or any machine with a discrete GPU:

```bash
git clone https://github.com/Majveia/Fable-Universe-.git
cd Fable-Universe-

npm i -g playwright && npx playwright install chromium

node tools/check.js --milestone M1 --extra "slab=1"
```

Nothing is installed into the repo — Playwright is global on purpose, so the
project never grows a build step (§2.2). If `node` is missing, any 18+ will do.

Expect **20–40 minutes**. Most of it is the 600-frame bench, three times.

---

## What it does, in order

| step | what it proves |
|---|---|
| `verify` | the maths, against independent references — quadrature, finite differences, an eigen-decomposition (§7.3) |
| `shaders` | every shader compiles *as the driver receives it*, all six scales (§M0) |
| `capture` | the numbered frame set + a perf JSON per tier (§7.5) |
| `repeat` | the same URL renders the same frame twice, to §7.3's tolerance |
| `gate` | the measurable M1 clauses (§8) |

It ends by naming the GPU and saying whether the artefacts count:

```
  hardware: Apple M2 Pro
  ✓ real GPU — these numbers count against §5 and the milestone gates.
```

If it says *software rasteriser* instead, the run did not use the GPU —
usually a headless-Chromium fallback. `npx playwright install chromium` and
retry; on Linux you may also need `--enable-gpu` to reach the real driver.

---

## What to send back

The frames are in `docs/captures/M1/`. Per `docs/captures/README.md`, **a
gateValid run's PNGs are worth committing and a software run's are not** — so:

```bash
git checkout -b gpu-run-M1
git add -f docs/captures/M1/*.png            # .gitignore holds these back by default
git add docs/captures/M1/*.json
git commit -m "M1 capture set, real GPU"
git push -u origin gpu-run-M1
```

If you would rather not push 20 MB of frames, the JSON alone is enough to close
the numeric gates — `perf-*.json` and `manifest.json` are a few kilobytes:

```bash
git add docs/captures/M1/*.json && git commit -m "M1 perf, real GPU"
```

Either way, paste the final verdict block. That is the part I cannot produce.

---

## What it will answer

Two gates are waiting on exactly this:

- **§M0's gate** — *"one command produces a complete numbered capture set from
  cold start; perf JSON for all three tiers."* The command exists and runs; what
  it has never done is run on hardware whose numbers count.
- **§M1 clause (e)** — budgets unchanged. M1 added a deformation tensor to a
  shader that runs on 314k vertices a frame, and paid for it by deleting 64
  square roots from the same loop. Whether that trade came out level is a
  measurement, and `perf-*.json` is where it lands.

It may also change what M2 should do first. If the tensor costs frames, §5's
quality table stops being tidy-up and becomes the thing standing between M2 and
its own budget.

---

## Three tiers, honestly

`--tiers desktop,mobile,low` maps §5's three rows onto viewport and device
pixel ratio, because those are the only quality knobs that exist today. §5 also
calls for the reference's **four-row quality table** — every knob in one row,
one row reconfiguring the whole renderer — and that is unbuilt. Until it is, a
tier here is a *device*, not a *configuration*, and the perf JSON should be read
that way.

---

## The first real run — 2026-07-27, RTX 3060 Laptop

`ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Laptop GPU, Direct3D11)` · `gateValid: true`
· desktop tier · 2560×1440 · fixed 16.667 ms timestep.

| | measured | §5 budget | |
|---|---|---|---|
| CPU main thread, p95 | **5.9 ms** (planet 7.4) | ≤ 12 ms | ✓ |
| GPU memory, peak | **196.7 MB** | ≤ 400 MB | ✓ |
| fps p50 / p95 / p99 | **60.2 / 55.6 / 54.1** | ≥ 60 p95 / ≥ 50 p99 | see below |
| draw calls, triangles | *instrumentation was broken* | ≤ 900 / ≤ 2.2 M | — |

**The frame rate was clipped by vsync.** A p50 of 60.2 against a p95 of 55.6 is
the signature: the renderer holds the refresh rate and misses it occasionally.
§5 asks for p95 ≥ 60, which a vsync-capped run cannot report however fast it
is — a budget you cannot exceed is a budget you cannot measure against.
`tools/lib.js` now launches with `--disable-gpu-vsync --disable-frame-rate-limit`
so the next run measures the renderer instead of the display.

**Draw calls and triangles were wrong on every machine.** `renderer.info` resets
itself on each `render()` call and the post chain makes four or five per frame,
so reading it at the tail of the frame reported the last pass only: one draw
call, two triangles. Fixed — the harness owns the counter now and resets it once
per frame.

Three other things this run found, all of them defects in the harness rather
than the universe, and none visible on a software rasteriser:

- the deep-time clause let wall time carry `a` past 1.0, so it passed on a slow
  machine *because* it was slow and failed on a fast one. It is driven now.
- the dither control frame was a second page load settling wherever it landed;
  a fast GPU overshoots the target epoch by a different distance, so the clause
  was comparing two different universes and blaming the dither.
- the gate did not pin a quality row, so it graded whichever tier the runner
  auto-selected.

Which is the argument for this page. A software rasteriser will run every
instrument in `tools/` to completion and tell you almost nothing true.
