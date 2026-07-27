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
