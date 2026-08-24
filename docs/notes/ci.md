# What CI answers, and what it does not

CLAUDE.md is a list of claims. This is the map of which of them a machine
checks, at what cadence, and — the half that matters more — which of them
nothing checks yet.

The map exists because the failure mode of a green build is not a bug getting
through. It is somebody reading "all checks passed" as "the constitution
holds", when nine of its clauses were never asked about.

---

## The six workflows

| workflow | when | costs | asks |
|---|---|---|---|
| **constitution** | every push, every PR | ~10 s | §2.1 assets · §2.2 dependencies · §2.3 entropy · §4 · §10 provenance · the generators have not drifted |
| **verify** | every push, every PR | ~90 s ∥ ~4 min | the arithmetic (§7.3) · every module parses · every exported shader compiles · every scale builds |
| **gates** | PR touching `src/` | ~2 min ×4 | §2.7 height-field parity · §M3 the density law · §M7 the thumb layer · §M4 the stance foot |
| **shaders** | PR touching the renderer | ~40 min | §M0's compile gate: every shader **as assembled**, all six scales, every world kind |
| **determinism** | PR touching `src/`, weekly | ~13 runner-min | §2.3 across Linux, macOS and Windows · and, reported not gated, across three V8 versions |
| **soak** | weekly | ~15 min | §5: nothing accumulates out to frame 240 · every world kind still boots |

`verify` runs its two jobs in parallel, so the offline suites answer in ninety
seconds whether or not a browser is downloading beside them.

---

## Clause by clause

### Checked

| clause | by | note |
|---|---|---|
| §2.1 zero runtime assets | `invariants.js` | extension **and** magic bytes, so a PNG named `.dat` is caught; plus base64 over 2 KB, `@font-face`, remote `<link>`, and every three loader that could pull bytes at runtime |
| §2.2 zero dependencies | `invariants.js` | a manifest anywhere, `node_modules`, a CDN importmap entry, or any bare specifier the browser cannot resolve |
| §2.3 determinism (code) | `invariants.js` | a ratchet, not a ban — every legitimate clock read is listed with a reason, and a *new* one fails |
| §2.3 determinism (across time) | `digest.js --expect` | 6,181 samples of the pure generation path against a committed baseline |
| §2.3 determinism (across machines) | `determinism.yml` | **gated per architecture**, which is what §2.3 now promises: two machines of one architecture must agree. Cross-architecture divergence is computed and reported. See the footnote below |
| §2.7 GLSL↔JS parity | `pixeldiff.js` | §2.7 specifies it in numbers; §11 says the drift "will look like a rendering bug and cost a day" |
| §M3 the density law's two sides | `pixeldiff.js --suite meadow` | `Math.pow(x, 1.5)` against `x·x·inversesqrt(x)`, 10⁴ samples × 4 rings, plus the structural claim that the keep ratio never exceeds one |
| §4 no meteor mechanic | `invariants.js` | `_carveCrater` may be reached from generation and nowhere else |
| §5 nothing accumulates | `perfgrow.js` | counts, not milliseconds — see below |
| §7.3 the maths | `verify.js` | each claim computed a second, independent way |
| §M0 shaders as assembled | `shadercheck.js`, `glslcheck.js` | the gate that cannot be replaced by a linter |
| §9.2 the light model reaches props | `paintcheck.js` | `painted.js` splices PAINT_GLSL into a stock material, so the program does not exist until three assembles it. Twenty seconds against `shadercheck`'s forty minutes, because it builds five materials instead of six scales |
| §M4 the stance foot | `footplant.js` | invisible to every capture: a screenshot cannot show a slide |
| §M7 the thumb layer | `touchgate.js` | 18 clauses, every one a DOM read |
| §10 the reference is unedited | `invariants.js` | SHA-256 and byte count, read *out of* `docs/reference/README.md` rather than copied |
| — every scale builds | `boot.js` | the black screen that shipped once with CI green |
| — every module parses | `parse.js` | including the backtick-in-a-GLSL-comment defect that cost three runs |

### Not checked, and why

| clause | why not | what would answer it |
|---|---|---|
| **§2.4** every place is a URL | needs the route walked and every deep link round-tripped | a tool that enumerates `main.js`'s schema and asserts each scale round-trips through it. Does not exist. The most tractable gap on this list. |
| **§2.5** continuity — no cuts, no loading screens | needs frames, in sequence, judged | `capture.js` shoots stations, not transitions |
| **§2.6** precision discipline | needs the planet at walking scale and a way to see a float32 that should have been a double | partly static: no world-space `Float32Array` position below orbit. Nobody has written it. |
| **§2.8** black belongs to vacuum | needs frames | `gate.js` computes it from decoded PNGs — it is not in CI because the frames are not |
| **§5** the frame budget | **needs a real GPU** | §M0: "Real GPU, not CI SwiftShader." `docs/GPU-RUN.md` records four runs that lost most of their value to a software rasteriser's numbers being read as evidence. Nothing in CI may be quoted against §5's table. |
| **§8** all eight critic axes | needs an eye, and a blind comparison against the reference | `blind.js` on real silicon, per §7.6 |
| **§9.7** a hero landmark, a leading line, a valley | the solver measures all three and they score 0.06 / 0.02 / 0.04. The landform fix moved the terrain under it; the terms have not been re-measured since | re-run the solve and read its own log |
| **§9.3** alpha survives to the print | `alphaudit.js` does not reach the surface scale inside its 60 s wait on a software rasteriser, and dies on the timeout | a GPU, or a longer wait somebody has decided is honest rather than convenient |

---

## The footnote §2.3 turned out to need

`determinism.yml` answered its own question on its first run, and the answer is
not the one anybody wanted. §2.3 says:

> Same seed + same code = same universe **on every machine, forever**.

That is now tested. It is false, in a small and specific way, and the way it is
false is worth knowing exactly.

### Across machines, on one engine

Same Node, same V8, three architectures:

| machine | node | V8 | digest |
|---|---|---|---|
| linux/x64 | 22.23.2 | `12.4.254.21-node.56` | `fea8833953d8ca97` |
| win32/x64 | 22.23.2 | `12.4.254.21-node.56` | `fea8833953d8ca97` |
| **darwin/arm64** | 22.23.2 | `12.4.254.21-node.56` | **`fc470bc5a2e0a2a1`** |

Linux and Windows agree bit for bit. macOS does not, in three suites:
`zeldovich · §M1`, `starlight · §9.6`, `tree · §M2` — the three that lean
hardest on `sin`, `cos`, `exp` and `pow`. `hash`, `terrain`, `cosmology`,
`ecology` and `meadow` all held.

**It is the architecture, and that took a second run to establish.** The first
one was inconclusive through a mistake worth recording: `node-version: '22'`
resolves to whatever each runner image happens to carry, and it handed macOS
22.23.1 while the other two got 22.23.2. Two variables were in the room —
architecture and a patch release — and a matrix whose entire purpose is to
isolate one variable has to isolate it. The version is pinned exactly now. On
the pinned run, with every machine on the same Node and the same V8 build
string, macOS still diverges and Windows still agrees with Linux. A patch
release is ruled out; `x64` against `arm64` is what is left.

The mechanism is almost certainly fused multiply-add: arm64 has an FMA
instruction, and `a*b + c` computed as a single FMA rounds once where two
separate instructions round twice. V8's fdlibm port is one source tree
compiled per architecture, so its polynomial evaluations can and do land a
last bit apart.

### Across engines, on one machine

Node 24 (V8 13.6) against the Node 22 baseline (V8 12.4) on the same Linux
box — **four of eight suites moved**: the same three, plus `meadow · §M3`.

Read both results precisely: this is **not** a determinism leak in AEON, and it
is **not** "anything using a transcendental moved". `ecology` uses `exp` and
held; `cosmology` uses `pow` and held. A handful of last-bit results at
particular inputs, out of 6,181 samples. ECMA-262 specifies `Math.sin`,
`Math.exp` and `Math.pow` only as "an implementation-approximated result"; V8
carries its own fdlibm port, and that port is compiled per architecture and
versioned with the engine.

### What it costs, in the terms the project cares about

1. **A shared URL survives a laptop; it does not survive an Apple Silicon
   laptop.** §2.4 makes every place a URL and §2.3 makes that address
   permanent. A seed's sky is a colour off, not a different sky — but the
   claim is bit-identity, and bit-identity moved. In the browser the same
   question wears different clothes: it is Chrome's V8, on the visitor's
   architecture.
2. **§M3's density law is the pointed one.** §M3 specifies the exponent as
   exactly `1.5` so the *shader* evaluates it as `x·x·inversesqrt(x)` — three
   single-cycle instructions instead of a general `pow()`. The CPU side calls
   `Math.pow`. Those are two different functions that agree today. `meadow`
   moved across engines, and unlike the height field there was **no GLSL↔JS
   parity test for the meadow** at all. There is now: `pixeldiff.js --suite
   meadow`, 10⁴ samples across all four rings, max |Δ| 1.3e-7 today, plus the
   structural claim `src/meadow.js` states in words and nothing checked — that
   the keep ratio never exceeds one, because "if it ever exceeded 1 the shader
   would be being asked to invent blades it does not have". Made to fail two
   ways before being believed: the CPU exponent nudged to 1.51 (2.4e-3, four
   rings red) and the shader's clamp removed (the ratio reached 28,636).
3. **Nobody introduced this.** It is a standing property of the codebase that
   went unmeasured until there was an instrument. Every gate above it stayed
   green throughout.

### How it was resolved

Asked, per CLAUDE.md §12, and answered: **relax the clause.** §2.3 now promises
bit-identity *per CPU architecture* and says why, and §11 carries the boundary
that goes with it — a quantity reaching the frame through `sin`, `cos`, `exp`
or `pow` may land a last bit apart; one reaching a *count*, an *index* or a
*branch* must not, and must be quantised before it crosses that line. A blade
count decided by a last bit is a visible pop; a hash bucket decided by one is a
different world.

So `compare` is a gate again, on the promise the constitution actually makes:
**two machines of the same architecture must produce one universe.** That is
not the weaker test it sounds like. Every real leak this workflow was built to
catch — an unseeded draw, an iteration-order dependency, a clock in a
generation path — shows up *within* an architecture, because that is where two
runs of the same code are supposed to be identical. What it stopped doing is
failing for the one thing nobody can fix from inside the repo.

Cross-architecture divergence is still computed, still printed, still written
to the summary — as a finding, which is what it is. Both paths were tested
before being believed: today's real digests pass with the split reported, and a
fabricated second x64 machine disagreeing with the first fails with the suite
named.

---

## Three rules this arrangement is built on

**Nothing in CI scores a frame.** Not one workflow produces a capture, and
none may be cited against §5 or §8. The instruments that run here measure
geometry, arithmetic and the DOM — all of which a software rasteriser gets
exactly right — and stop there. `perfgrow.js` prints a `ms/f` column in the
soak run; it is noise, and the tool says so in its own output.

**A gate that has never gone red is not a gate.** Every check in
`invariants.js` has been made to fail on purpose — a PNG in `src/`, a PNG
renamed to `.dat`, a `package.json` at the root, a `Math.random()` in
`terrain.js`, a `fetch()` in `rng.js`, the importmap pointed back at the CDN, a
`TextureLoader`, a bare `import lodash from 'lodash'`, a side-effect
`import 'some-polyfill'`, a dynamic `import()` of a CDN URL, and one byte
appended to the art reference. So has the digest, with a one-ulp change to a
single constant in `zeldovich.js`, which it localised to the suite. So has the
cross-machine comparison, with a fabricated third digest.

That discipline earned its keep immediately. Two of those checks were **green
because they were blind**, and only a deliberate failure found it. `strip()`
blanks a string including its quotes, so `from './rng.js'` reaches the §2.2
check as `from           ;` and the obvious pattern matched nothing on any file
ever; and `sites()` measured a match's line from its first character, so a
pattern opening `(?:^|[\s;}])` consumed the preceding newline and reported the
line *above* — a comment, on which the caller found nothing and moved on. A
gate that has never been made to fail is not a gate, and neither of those was
findable any other way.

**One job per question.** Three steps in one job report as one red X and
whichever failed first. Three jobs report *which*, which is the entire content
of the message.

---

## The packer's two hard stops, and how they were made to go red

`tools/pack.js` is a distribution step rather than a build step (§2.2 is
untouched — see the section below), but it carries two checks that behave like
gates, and both were watched failing before they were trusted.

**The worker subgraph.** An importmap does not reach inside a worker, so
`tilebuild.js` and everything it imports are resolved by hand. The check asserts
that subgraph is exactly `[terrain.js]`, and refuses rather than widening if it
is not. Made to go red by adding an import to `tilebuild.js`; it named the file
it had not been told about.

**Import shapes the rewrite cannot reach.** A side-effect-only `import './x.js'`
has no `from`, so the specifier rewrite steps over it and the browser then tries
to resolve `./x.js` against a `blob:` URL, which has no path. That fails *at the
moment that module is first imported* — which for a surface-scale module is
several minutes and a scale transition after load, and looks nothing like a
packaging fault. Made to go red by appending `import './rng.js';` to
`src/night.js`:

```
Error: tools/pack.js cannot rewrite these, and a packed build would fail at the
moment each module is first imported rather than at load:
  src/night.js: a side-effect-only import
```

The repo contains no import of that shape today. That is exactly why the check
exists: the first one added will be added by someone who has never read this
file.

## The cabin's shader, and the gate that had nowhere to fail

`src/cabin.js` builds its plate seams by injecting GLSL into three's standard
shader through `onBeforeCompile`. §M0 is explicit that shaders are checked as
passed to `gl.shaderSource` rather than as they read in source, and this is
exactly why: the string that gets compiled does not exist anywhere in the file.

The awkward part is that nothing was checking it. `tools/shadercheck.js` walks
the scales the app actually builds, and the cabin is behind `?cab=1` — so a
default-off scale's shaders are outside its reach by construction.
`tools/cabincheck.js` steps the scale but never draws it, and a program is not
compiled until something renders. `tools/cabincost.js` does render, three times,
and was watching the wrong signal: **three does not throw on a shader that fails
to compile.** It logs `THREE.WebGLProgram: Shader Error` through `console.error`
and carries on with a broken program, so a `pageerror` listener watches for the
one symptom this defect does not produce.

`cabincost.js` now fails on any console error, which makes it the post-assembly
shader check for this scale as well as its cost report — and it runs in
`shaders.yml`, before the forty-minute station walk, because a gate nobody runs
is not a gate either. It costs seconds: three cabins rendered, three frames.

Made to go red by deleting one argument from a call in the injected fragment —
`plateSeam(vCabinPos, uGauge)` against a three-parameter function:

```
parse · 134/134 modules parse            ← still green, it is valid JavaScript
§M0 · every shader the cabin submits, compiled → 9 ERROR(S)     exit 1
```

`parse.js` staying green through that is the whole point rather than a
shortcoming: the defect is well-formed JavaScript inside a template literal and
only becomes a shader at runtime. This is the same class as the backtick that
ends a template early, and it turned up in `cabincost.js` itself while this was
being written — a comment in the injected string contained backticks and closed
the literal.

---

## §2.2 is not violated by any of this

> "Zero dependencies... `python3 -m http.server 8080` must remain sufficient,
> forever."

That is an invariant about what it takes to **run** AEON, and it still holds:
no build step, no bundler, no manifest, nothing installed into the repo. CI is
a thing that watches AEON, not a thing AEON needs — and `constitution.yml` is
the job that fails the build if that ever stops being true.

Playwright is installed **globally**, in one place, by
`.github/actions/chromium`. That block used to be forty lines pasted into two
workflows, and it carries more hard-won operational detail than anything else
under `.github/` — the mirror stall, the orphaned `apt-get` holding the dpkg
lock, the nine CJK font packages `--with-deps` was fetching for text this
project never renders. Two copies of a comment that records an incident are one
copy away from disagreeing about what happened.
