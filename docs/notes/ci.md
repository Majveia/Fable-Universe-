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
| **gates** | PR touching `src/` | ~2 min ×3 | §2.7 height-field parity · §M7 the thumb layer · §M4 the stance foot |
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
| §2.3 determinism (across machines) | `determinism.yml` | the clause's actual wording, and the only one that needs more than one runner |
| §2.7 GLSL↔JS parity | `pixeldiff.js` | §2.7 specifies it in numbers; §11 says the drift "will look like a rendering bug and cost a day" |
| §4 no meteor mechanic | `invariants.js` | `_carveCrater` may be reached from generation and nowhere else |
| §5 nothing accumulates | `perfgrow.js` | counts, not milliseconds — see below |
| §7.3 the maths | `verify.js` | each claim computed a second, independent way |
| §M0 shaders as assembled | `shadercheck.js`, `glslcheck.js` | the gate that cannot be replaced by a linter |
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
| **§9.3** alpha survives to the print | `alphaudit.js` does not reach the surface scale inside its 60 s wait on a software rasteriser, and dies on the timeout | a GPU, or a longer wait somebody has decided is honest rather than convenient |

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
`TextureLoader`, one byte appended to the art reference. So has the digest, with
a one-ulp change to a single constant in `zeldovich.js`, which it localised to
the suite. So has the cross-machine comparison, with a fabricated third digest.

**One job per question.** Three steps in one job report as one red X and
whichever failed first. Three jobs report *which*, which is the entire content
of the message.

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
