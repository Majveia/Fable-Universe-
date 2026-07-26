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

`serve()` makes one documented substitution on the way out: the art
reference's importmap points at a jsdelivr URL, and the server rewrites it to
the r180 vendored beside it in `docs/reference/vendor/`.

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
