# tools — the M0 instrument

Dev-time only. Nothing here is loaded by the universe, imported by `src/`, or
shipped to a browser. `python3 -m http.server 8080` remains sufficient to run
AEON, forever (CLAUDE.md §2.2).

There is deliberately **no `package.json` and no lockfile**. §M0 sanctions
Playwright for headless capture and nothing else, so it is a global install
rather than a project dependency — the moment this directory grows a manifest,
somebody starts believing the repo has a build step.

```bash
npm i -g playwright && npx playwright install chromium
```

## `check.js` — all of it, one command

```bash
node tools/check.js --milestone M1                    # everything
node tools/check.js --milestone M1 --extra "slab=1"   # score an experiment
node tools/check.js --skip capture                    # the fast half
```

Runs `parse` → `verify` → `shadercheck` → `capture` → `gate` in §7's order and
prints one verdict. It ends by naming the GPU it ran on and saying plainly whether the
artefacts count: a software rasteriser gets a warning, real silicon gets a tick.

**This is the command to run on a machine with a GPU.** Everything in `tools/`
executes anywhere; only some of it *means* anything without one, and §M0 is
specific that a real GPU is the difference between a capture set that gates a
milestone and one that merely documents it.

## `parse.js` — the parse gate

```bash
node tools/parse.js             # every module the browser loads
node tools/parse.js --quiet     # only the failures
```

Two seconds, no browser, and it runs first because everything after it launches
Chromium to discover the same thing more slowly.

It exists for one specific defect. A backtick inside a GLSL template literal —
in a *comment*, where nothing looks wrong — ends the template and turns the rest
of the shader into JavaScript. The module then fails to parse, `window.AEON`
never appears, and every tool downstream reports the same useless symptom: the
page did not boot. §11 lists "shader strings" as a trap; this is the layer
below it, where the string is not yet a string.

`node --check` is not this guard. Given a file containing an `import` it detects
ESM, declines to parse, and exits 0 — so a broken module passes. Copying to
`.mjs` makes it check for real, which is the whole trick.

## `verify.js` — the maths, offline

```bash
node tools/verify.js            # every suite
node tools/verify.js zeldovich  # one
```

§7.3: new shader math gets a CPU reference before it goes near the render loop.
These are not snapshots — a snapshot of the implementation under test only
proves it has not changed, which is the least interesting property it has. Each
suite computes the answer a second, independent way: the deformation tensor
against finite differences of the displacement it claims to differentiate, its
invariants against an eigen-decomposition, `cosmology.js` against adaptive
Simpson quadrature.

It has already earned its keep twice — once by rejecting a claim that was
merely plausible ("overdense ⇔ infall" is exact only to first order in D), and
once by pinning down a missing factor of `a` in comoving continuity.

## `gate.js` — the clauses that are numbers

```bash
node tools/gate.js --milestone M1
node tools/gate.js --milestone M1 --extra "slab=1"
```

§8 says "looks good" is a failed review and asks which pixel region lost the
point. Several gate clauses go further and are outright numeric — four hue
families inside a stated luminance band, zero banding at 8-bit, vacuum blacks
at true zero. Those are computed here, from decoded frames, so the judgement
axes have somewhere to stand.

It does not score silhouette, materials, or whether the thing is beautiful.

## `repeat.js` — the same URL twice

```bash
node tools/repeat.js --url "seed=20250601&m1=1" --frames 90
```

Loads one URL twice from cold, waits for each to reach **app frame N**, and
compares the two frames at the tolerance §7.3 names (≥97% of pixels within
2/255). If the two runs somehow land on different frames it says so and refuses
to print a percentage — a percentage would be believed.

App frame N, rather than N `requestAnimationFrame` ticks after the page
appeared, because those are different questions. The render loop starts when
`App` constructs; how many frames it completes before an external observer
attaches is a property of the machine. In this container the observer reliably
attaches at frame 5 and both runs land on frame 186, so the old form passed at
100% — on hardware where that race is live it compares two different moments and
reports the difference as nondeterminism. A determinism test that cannot name
its own frame cannot tell a nondeterministic universe from a fast one.

This was unrunnable until recently. The universe was deterministic but the
*frame* was not: transient motion drew from `Math.random()` and a few
animations read the wall clock, so no two loads of one place agreed exactly.
Both are seeded now — `arand()` in `rng.js`, `now()` in `clock.js` — and `?dt=`
pins the timestep so the draws come out in the same order.

Measured, on the walkable surface (the most transient-heavy scale):

| | bit-identical |
|---|---|
| seeded, fixed timestep | **100.00%** |
| control: `arand()` → `Math.random()` | 99.48% |
| sanity: two *different* seeds | 0.77% |

The control still clears §7.3's bar, which is the point: half a percent of
run-to-run noise passes a 97% threshold and quietly masks any regression
smaller than itself. Exact is worth having.

## `capture.js` — the numbered set

```bash
node tools/capture.js --milestone M0
node tools/capture.js --milestone M0 --tiers desktop,mobile,low
node tools/capture.js --milestone M0 --seed 20250601 --settle 240
```

Writes `docs/captures/<milestone>/`: one PNG per scale per tier, a
`perf-<tier>.json`, and a `manifest.json` tying frames to the deep links that
produced them.

Every station is a URL (§2.4) at a pinned seed, and each settles for a fixed
**frame count** rather than a fixed wall time — a slow machine takes longer and
shoots the same frame. The HUD is hidden before every shot, which is §8 axis 7
("delete the HUD entirely and lose no orientation") asked by construction
rather than from memory.

The route is not written down here. It is resolved in-page from the seed
through `hash`, `galaxyParams` and `systemParams` — the same pure generators
the universe uses — so the itinerary is a property of the seed, and a route
that drifts means the generators drifted, which is exactly the alarm you want.

## `shadercheck.js` — the compile gate

```bash
node tools/shadercheck.js
node tools/shadercheck.js --flags "m1=1,m2=1&slab=1"   # one route per combination
```

Exit 0 green · 1 a shader failed or the page threw · 2 the route did not reach
every scale.

It patches `shaderSource` and `compileShader` before any page script runs and
records every string **as passed to the driver**, then compile-checks it. §M0
is specific about this: shaders here are assembled by template interpolation,
so a defect exists only post-assembly and reading the source file proves
nothing. Link status is checked too — that is where a varying mismatch shows.

Coverage comes from flying the bench route, so all six scales assemble. A run
that fails to reach every scale reports **incomplete**, never *pass*.

It flies the route once **per flag combination**, defaulting to the shipped
build plus `m1=1&m2=1&slab=1`. §7.4 puts milestone work behind a default-off
flag, so a single unflagged pass compiles the build nobody is iterating on and
reports green while every new shader in the repo goes unchecked — the same
failure the gate exists to prevent, one level up.

One limit worth knowing: a shader compiles against *a* driver, not against all
of them. Green here means green on the machine that ran it — ANGLE over
SwiftShader is more permissive than some real drivers and stricter than
others, so this gate catches assembly defects, not vendor-specific rejections.
Run it once on real silicon before believing a milestone.

## `?bench=1` — the harness itself

Lives in `src/bench.js`, because it has to run inside the frame loop. Default
off; without the parameter it reads one URL param at import and returns.

```
http://localhost:8080/?bench=1              # pinned seed, reproducible
http://localhost:8080/?bench=1&seed=1234&tier=mobile
```

600 frames, six stations, one per scale, 40 warm-up frames per station
discarded. Results land on `window.AEON_BENCH` and `window.AEON_BENCH_DONE`
flips true. It reports p50/p95/p99 frame time and its fps inverse, CPU main
thread, draw calls, triangles, and GPU memory.

Three things make its numbers worth quoting:

- **The route is frame-counted, not clock-driven.** Same path on every machine.
- **Adaptive resolution is pinned for the run** (§11). Quality that moves
  mid-flight measures the resolution controller, not the renderer.
- **The GPU is named in the output.** §M0 requires a real GPU, and a software
  rasteriser produces a perfectly-shaped, worthless perf JSON. Every report
  carries `device.renderer` and stamps `gateValid: false` when it sees
  SwiftShader, llvmpipe or friends. Do not quote a run whose `gateValid` is
  false against the §5 budget table.

GPU memory is **accounted, not queried** — WebGL exposes no memory query, so
`bench.js` tracks allocations through the context (textures, buffers,
renderbuffers) and subtracts deletes. It is an estimate, and the JSON says so
in a `method` field rather than in a comment nobody reads.

## Running the art reference

```bash
node tools/serve.js          # prints URLs for the universe and the reference
```

`serve()` makes one documented substitution on the way out: the art
reference's importmap points at a jsdelivr URL, and the server rewrites it to
the r180 vendored beside it in `docs/reference/vendor/three-0.180.0/`.

§8 requires the reference to *run* — its blind side-by-side is the rubric's
only executable comparison — and on a machine with no route to the CDN it
renders nothing. The rewrite lives here rather than in the file because
`docs/reference/hoshi-no-tani.html` is kept byte-exact with the export: §9
gives it the last word, so there has to be exactly one unambiguous thing to
read, and its SHA-256 in `docs/reference/README.md` is the check that nobody
quietly edited it. Six visible lines in a dev server beat an invisible edit to
the source of truth.

Capture the reference on **its own r180**, never on AEON's r170 — §10's
warning about colour management and renderer defaults moving across that range
is exactly why the version is pinned and vendored rather than shared.

## What a tier means today

`TIERS` in `lib.js` maps the three rows of §5 onto the only knobs that exist
right now: viewport and device pixel ratio. §5 also calls for the reference's
**four-row quality table** — one array indexed by tier carrying every knob, so
one row change reconfigures the whole renderer. That does not exist yet. Until
it does, a tier here is a *device*, not a *configuration*, and `lib.js` says so
where the constant is defined so no one mistakes one for the other.
