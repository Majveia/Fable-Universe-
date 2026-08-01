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
git pull                       # or: git checkout <default branch> && git pull

npm i -g playwright && npx playwright install chromium

node tools/check.js --milestone M1 --extra "slab=1"
```

**On Windows PowerShell, `&&` is not a statement separator** — use `;`, or run
the two commands on separate lines:

```powershell
git checkout <default branch>
git pull
git status                     # must be clean, or the run cannot score a gate
```

That `git status` is not a formality. A run taken from a tree with local edits
under `src/` or `tools/` measures those edits, not the branch — see run three.

Nothing is installed into the repo — Playwright is global on purpose, so the
project never grows a build step (§2.2). If `node` is missing, any 18+ will do.

Expect **20–40 minutes**. Most of it is the 600-frame bench, three times.

---

## What it does, in order

| step | what it proves |
|---|---|
| `parse` | every module the browser loads, parsed — plus the lint for backticks inside GLSL templates, which has caught five real defects |
| `verify` | the maths, against independent references — quadrature, finite differences, an eigen-decomposition (§7.3) |
| `pixeldiff` | §7.3's other half: the GLSL computes the same function as its CPU twin, 4096 cases on six worlds, gate ≥97% within 2/255 |
| `shaders` | every shader compiles *as the driver receives it*, all six scales (§M0) |
| `capture` | the numbered frame set + a perf JSON per tier (§7.5) |
| `repeat` | the same URL renders the same frame twice, to §7.3's tolerance |
| `alphaudit` | §9.3's fog fraction survives compositing into the print (§16.6) |
| `gate` | the measurable M1 clauses (§8) |

`verify` and `pixeldiff` answer different questions and neither implies the
other: a shader chunk can be a perfect port of a wrong reference, or a wrong
port of a right one.

**A step may report `open` rather than `pass` or `FAIL`.** That is a gate which
fails today for a reason already written down — §7.6 asks for "a written account
of the blocking axis", and it belongs in the instrument rather than in somebody's
memory. An open step does not set the exit code. When one starts *passing*, the
verdict says so and tells you to delete the entry, so the list cannot rot into a
record of things that were fixed years ago. Today `alphaudit` is the only one.

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

**Run from the default branch, and do not commit the PNGs onto a branch you
intend to leave.** An earlier version of this page said to `git add -f
docs/captures/M1/*.png` and push them to a `gpu-run-M1` branch. Doing that makes
them tracked; the next `capture` run modifies them; and a modified tracked file
blocks every `git checkout` after it. Three consecutive real-GPU runs measured
stale code because of that single instruction.

The JSON alone closes the numeric gates and is a few kilobytes:

```bash
git add -f docs/captures/M1/*.json
git commit -m "M1 perf, real GPU"
git push
```

If you want the frames themselves, copy them out of the repo rather than
committing them:

```powershell
Copy-Item docs/captures/M1/*.png $HOME/Desktop/aeon-M1/
git checkout -- docs/captures        # leave the tree clean
```

Either way, paste the final verdict block. That is the part I cannot produce —
and since the provenance banner landed it also says, in its own output, whether
what it measured was the branch or your working tree.

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


---

## The second run — same hardware, stale checkout

Run two came back with `draws p95 1 · tris p95 0.00M` and `fps 60.2/55.6` —
identical to run one, and identical to the two defects run one had already
found. The reason was not that the fixes failed. It was that the run was taken
from the `gpu-run-M1` branch, which predated them.

Nothing in the output said so. The only clue was a missing word: this project's
gate prints `· quality desktop ·` in its header since the tier table landed, and
run two's header did not have it.

`tools/check.js` now prints the commit it measured, whether the tree is dirty,
and whether the checkout is behind its upstream — and says outright that the
numbers describe code that has moved on. Same discipline as `gateValid`: an
artefact that cannot be trusted should say why, in its own output, without
anybody having to notice a missing word.

**What run two did establish**, and neither this container nor run one could:

- **98 shaders compile on a real NVIDIA D3D11 driver**, all six scales. The
  shader gate's own caveat is that it checks against *a* driver; ANGLE over
  SwiftShader is not the same compiler as ANGLE over D3D11, and now both agree.
- **Frames are bit-identical on hardware where dt genuinely varies** — 100.00%,
  worst channel delta 0/255. That is the determinism fix proven where it
  actually needed proving. On a software rasteriser every frame exceeds the
  0.1 s dt clamp, so the timestep is fixed by accident and the test cannot
  discriminate. Here it can, and it passes.

---

## The third run — same hardware, a mixed tree

The banner did its job and the run still could not be scored, because the tree
it measured was **incoherent**: `HEAD` read `cf1cb65`, but the code that ran was
older than `d29bd9b`, two commits before it. Two independent proofs, neither
requiring access to the machine:

- the gate printed `a reached 0.852 (z = 0.173), still advancing`. That string
  was **deleted** in `d29bd9b`, which replaced the wall-clock deep-time clause
  with one driven from `a = 0.985`. No committed version at or after `cf1cb65`
  can print it.
- the bench reported `draws p95 1 · tris p95 0.00M` — the exact pre-`d29bd9b`
  signature. Re-measured here after the fix, one frame of the cosmic scale
  reports **83 draw calls and 133 triangles**; with `autoReset` left alone it
  reports **1 and 1**. The fix works, so the code that ran did not have it.

`git status` would have shown it in one line. The verdict block would not: it
printed `⚠ 3 commits behind` and `✓ real GPU — these numbers count against §5
and the milestone gates` in the same breath, which is a contradiction the tool
should never have been able to utter.

**Fixed.** `tools/check.js` now names the specific files under `src/` or
`tools/` that differ from the commit, and the hardware verdict is gated on
provenance: a real GPU with a dirty or behind tree reports *"real GPU, but not
this commit — fine for iterating; it cannot score §5 or a milestone gate."*
Editing and re-running is the normal loop, so a dirty tree is not a failure; it
just is not a gate score.

### The `repeat` failure, and why it was uninterpretable

Run three reported 11.90% bit-identical, worst channel delta 49/255 — against
run two's 100.00% on the same hardware. That is not a regression report,
because the test could not say **which frame** it photographed.

`repeat.js` settled 90 `requestAnimationFrame` ticks *after `window.AEON`
appeared*. But the render loop starts when `App` constructs, and how many frames
it completes before an external observer attaches is a property of the machine.
Measured in this container: the observer consistently attaches at app frame 5,
so both runs land on frame 186 and the test passes at 100%. On hardware where
that race is live, the two runs photograph different moments and the test
reports the difference as nondeterminism.

A determinism test that cannot name its own frame cannot distinguish a
nondeterministic universe from a fast one. So `App` now counts frames, and
`repeat.js` waits for **app frame N** rather than for a number of ticks — and if
the two runs somehow still land on different frames, it says so and refuses to
print a percentage, because a percentage would be believed.

This does not prove run three's failure was the race. It makes the next run's
answer mean something either way: pass, or a failure with both photographs
provably at the same frame — which would be a real §2.3 violation worth hunting.

### One genuine determinism leak, found and not fixed

Grepping every wall-clock read in `src/` turned up exactly one inside a
generation path: `city.js`'s `step(budgetMs = 4)` pumps its build generator
`while (performance.now() - t0 < budgetMs)`. The finished city is deterministic —
the generator is seeded — but *how much of it exists at frame N* is a property
of the machine, so a capture taken mid-build differs between machines. §7.7 asks
every previous milestone to be re-shot; this is a way for that to quietly fail.

`clock.js` already considered this and gave it a pass: *"a frame budget that
ignored the frame would not be a budget."* That is right for interactive play
and wrong under `?dt=`, where the frame loop has already stopped being a
real-time thing. The fix is to pump a fixed iteration count when a fixed
timestep is in force, with the count living in §5's quality table — but the
count has to be *measured*, not guessed, or capture gains a hitch that poisons
the p99 it exists to record. Left for M6, where `city.js` becomes
`civilization.js`, with the reasoning recorded so it is a one-session job.

Not their bug: cities are unreachable from the cosmic scale that `repeat` uses.

---

## The fourth run — and why the checkout kept losing

Run four was taken from `gpu-run-M1` again, because the branch switch never
happened:

```
git checkout claude/interactive-3d-universe-n6suwb
error: Your local changes to the following files would be overwritten:
        docs/captures/M1/01-desktop-cosmic-web.png
        ... and seven more
```

**This page caused that.** "What to send back" tells you to `git add -f
docs/captures/M1/*.png` and commit them to a branch — so the frames became
tracked, and every subsequent `capture` run modifies them, and a modified
tracked file blocks every checkout after it. Three runs in a row measured stale
code for that reason. The instructions below now say to run from the default
branch and copy frames out rather than committing them where they will fight the
next checkout.

To get unstuck:

```powershell
git checkout -- docs/captures       # discard the regenerated frames
git checkout claude/interactive-3d-universe-n6suwb
git pull
git status                          # must be clean
```

**What run four established anyway**, and it is the most useful thing any run
has produced:

- **`repeat` passes at 100.00%**, worst channel delta 0/255, on the RTX. That
  retires run three's 11.90% — it was the mixed tree, not the universe. §2.3
  holds on hardware where `dt` genuinely varies.
- **`capture` failed at one station**, and this is a real defect:
  `05-desktop-surface.png FAILED — Protocol error (Page.captureScreenshot):
  Unable to capture screenshot`, between two stations that shot cleanly on
  either side of it. A capture set with a hole in it fails §M0's gate, which
  asks for a *complete* numbered set, so one transient compositor hiccup costs
  the whole run. `capture.js` now retries three times with a settle between
  attempts and records `screenshotAttempts` in the manifest — a retried frame
  should never be filed silently next to a clean one.
- **GPU memory 197 MB** against §5's 400 MB, again. That number has been stable
  across every run and is the one §5 clause that is genuinely green.
- **Vacuum reaches true `#000` on 24.6%** of the cosmic frame (24.8% with the
  dither off), so the dither is not lifting it. On this container the same
  measurement reads 50%, which is worth knowing: real hardware is stricter, and
  M2 act 1's bloom-pedestal finding matters more than the software numbers
  suggested.
- **Hue families: 2**, peaked at 260° with 32% achromatic. Run three's stale
  build reported 3. The clause stays open either way.

Everything else in run four — `draws p95 1`, `fps 59.9/56.8/55.6`, the deep-time
FAIL, `verify 25/25`, and the absence of a `parse` step or a provenance banner —
is the same stale build as runs two and three.

---

## The fifth run — the first one that counted

Clean tree at `4427395`, RTX 3060 Laptop, D3D11. `parse` 55/55 · `verify` 64/64
· `shaders` green on both flag passes, 98 shaders across all six scales each ·
`capture` clean, all six stations, no retry needed.

### §5 is green, and this is the first time anyone could say so

```
fps p50/p95/p99 1428.6/344.8/285.7 · draws p95 98 · tris p95 0.19M · gpu 212.6MB
```

| | measured | §5 desktop | margin |
|---|---|---|---|
| fps p95 / p99 | **344.8 / 285.7** | ≥ 60 / ≥ 50 | 5.7× |
| draw calls p95 | **98** | ≤ 900 | 9.2× |
| triangles p95 | **0.19 M** | ≤ 2.2 M | 11.6× |
| GPU memory | **212.6 MB** | ≤ 400 MB | 1.9× |

**§M1 clause (e) — "budgets unchanged" — is closed.** M1 put a symmetric
deformation tensor into a shader running on 314k vertices a frame and paid for
it by deleting 64 square roots from the same loop; the trade came out level with
room to spare. Every earlier run reported this clause failing, and every one of
those was measuring vsync, a broken draw counter, or a stale tree.

§M0's gate — *"one command produces a complete numbered capture set from cold
start"* — is met on hardware whose numbers count.

### The determinism test failed for the second time, for the second reason

```
repeat · app frame 90
  both runs at frame   : 94
  bit-identical pixels : 14.54%
  worst channel delta  : 68/255
```

Run three's fix made the test *say which frame it photographed*. This run shows
that was only half the problem: it waited for `App.frames >= 90`, found 94 in
both runs — and then took the screenshot **while the loop kept running**.

On a software rasteriser that window holds zero or one extra frames and nothing
has moved, which is why the test passes at 100% here every time. At 1400 fps it
holds dozens. Two honest photographs of two different moments, twice over, and
both times the software rasteriser called it fine.

`App.haltAt(n)` now stops the render loop inside the frame loop itself, so the
pixels on the canvas *are* frame n. `repeat.js` halts before the shutter and
`capture.js` does the same — §7.7 asks every previous milestone to be re-shot
and compared, which is not possible against a frame nobody can name.

Whether any real nondeterminism remains underneath is still open. What is
settled is that the next answer will be about the universe rather than about
the shutter.

### §2.8 failed on hardware, and the dither was tipping it

```
FAIL (2.8) vacuum reaches true #000, and the dither does not lift it
       39.0% exactly #000 (42.2% with the dither off)
```

The clause allows 0.5% and the dither cost 3.2 points. Its luma gate opened at
zero, which still hands a small dither to a pixel sitting at 0.4/255 — a value
that quantises to black — and half of those round up. The gate now opens at
**half a display step**, in `post.js` and `print.js` both: below half a step
there is nothing to dither between. Banding is unaffected, measured here at the
same 10 px run as the reference frame.

What put so many pixels in that band is the bloom pedestal — M2 act 1 measured
it directly (`docs/plans/M2.md` §7), and this is the same defect arriving
through M1's gate. On this container the same clause reads 50.1% against 49.8%,
which is why it took real hardware to surface.

### Still open

- **(b) ≥4 hue families — 2.** Peaks at 200° with 62.7% achromatic. `M1.md` §12
  says this needs a decision rather than a commit, and nothing in this run
  changes that.
- **The bloom rebuild**, M2 act 2 step 5, which is what actually fixes §2.8 in
  vacuum rather than stopping the dither from making it worse.
