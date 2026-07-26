# AEON — Engineering & Art Constitution

**Repo:** `Majveia/Fable-Universe-` · **Stack:** vanilla JS + GLSL, vendored `three@r170`, no build step
**Read this file in full at the start of every session.** It supersedes conversational instruction unless the human explicitly overrides a clause in-session. If you are about to violate anything in §2, stop and ask.

---

## 1 · Thesis

AEON is a deterministic, zero-asset, browser-native universe. One 32-bit seed unfolds into ~10²⁸ addressable star systems across six seamlessly nested scales — cosmic web, galaxy, star system, whole planet, walkable surface, black hole.

Two things are non-negotiable: **the physics is real, and the bytes are few.** Everything else — beauty, density, life, civilisation — must be earned inside those constraints.

The claim this project makes is not *"a game that looks good."* It is *"a universe that is computed, and is beautiful because it is computed."* Every decision routes through that sentence.

---

## 2 · Invariants

Violating any of these is a revert, not a discussion.

1. **Zero runtime assets.** No image files, no GLTF, no audio samples, no web fonts, no network calls. Every texture is generated on-device at init from `hash(seed, …)`. "4K textures" means 4096²-equivalent *generated* detail, not downloaded bytes.
2. **Zero dependencies** beyond vendored `three@r170` in `/vendor`. No npm at runtime, no bundler. `python3 -m http.server 8080` must remain sufficient, forever.
3. **Determinism.** Same seed + same code = same universe on every machine, forever. No `Math.random()`, no `Date.now()`, no un-seeded `performance.now()` anywhere in a generation path. `src/rng.js` is the only entropy source.
4. **Every place is a URL.** Any feature that creates a new kind of location extends the deep-link schema in `main.js` in the same commit.
5. **Continuity.** No cuts, no loading screens, no fades to black. Scale changes are hyperzooms under a passing snapshot (`transition.js`). If a feature can't be entered continuously, it isn't finished.
6. **Precision discipline.** Camera stays at scene origin; the world carries the negated camera position in JS doubles; tile vertices are tile-relative and built in float64 in the worker. Never introduce a float32 world-space position at planet scale.
7. **GLSL↔JS height-field parity.** `src/terrain.js` is an exact port of the orbital height field. If you change the noise in GLSL, you port it to `terrain.js` **in the same commit**, with a numeric parity test over 10⁴ sample points (max abs error < 1e-4 of planet radius). Break this and the coast you saw from space stops being the coast you walk.
8. **OLED-first.** Background is true `#000`. Luminance over black; never lift the blacks for "contrast." HDR half-float pipeline with selective bloom stays. The simulation canvas ignores `prefers-color-scheme` entirely — only HUD chrome adapts.
9. **Frame budget is a correctness property**, not a nice-to-have. See §5.

---

## 3 · Resolved contradictions

These tensions are real and were live across the prompt history. They are now settled. Do not re-litigate them mid-build; raise them with the human between milestones if you disagree.

| Tension | Ruling | Why |
|---|---|---|
| "Minimalist clean interface" vs. cities, vehicles, third-person UI | **Minimalism is a property of the chrome. Maximalism is a property of the world.** HUD: hairline type, ≤3 persistent elements, fades after 4 s, `H` kills it entirely. The world may be as dense as the budget allows. | The two demands were never about the same object. |
| Research-grade physics vs. "Rick and Morty × Cowboy Bebop" | **The numbers are never negotiable; the palette always is.** Style lives in tonemap, palette, framing, and audio. If a stylistic choice requires falsifying a formula, the style loses. Bebop informs *interface and score only.* | The physics is the project's actual claim to originality. |
| Miyazaki / Malick vs. Ghost of Tsushima | **They agree on the only thing that matters: the wind and the light do the acting.** See §9. | Both references are about environmental performance, not asset fidelity. |
| "4K textures, AAA quality" vs. zero-asset architecture | **Fidelity comes from response, not resolution.** A grass blade that bends correctly in a shared wind field, catches rim light, and self-shadows reads as AAA at 64² albedo. Analytic materials for mid/far, generated detail arrays inside ~30 m. Shipped bytes stay near zero. | This was the sharpest conflict in the pile. Resolution wins the screenshot; response wins the minute. |
| Rick-and-Morty biome absurdity | **Weirdness budget: ≤5% of worlds** may break the naturalistic register. Enforce in the seed→biome function. | Rarity is the entire mechanism by which strangeness lands. |
| "Maximum ambition / loop until perfect / never stop" | **Ambition is unbounded in scope, bounded in sequence.** One milestone at a time (§6), each independently shippable, none regressing a predecessor. | An unterminated loop produces thrash and silent regressions, not quality. |

---

## 4 · Non-goals

Say no to these, including to yourself at 3am mid-milestone.

- No multiplayer, no backend, no accounts, no persistence beyond URL + `localStorage` logbook.
- No combat, inventory, quests, XP, or economy. **This is a place, not a game loop.** The verbs are *travel* and *look*.
- **No meteor-strike mechanic.** Remove the `X` impact + runtime crater-baking path from `src/surface.js`. Ancient craters on airless worlds stay — those are generation, not mechanics.
- No build tooling, no TypeScript migration, no framework.
- No photoreal humanoid characters. Figures are silhouettes and scale references.
- No third-party art assets, ever — including "just as reference" checked into the repo.

---

## 5 · Budgets

Measured, not guessed. `?bench=1` runs a fixed 600-frame scripted flight and writes a perf JSON.

**Frame rate (p95 / p99):**

| Tier | Target |
|---|---|
| Desktop ref — M-series laptop or RTX 3060 class @ 1440p | ≥ 60 / ≥ 50 fps |
| Mobile ref — iPhone 13 class, DPR capped at 2.0 | ≥ 30 / ≥ 25 fps |
| Low tier — Intel Iris / Adreno 6xx, reduced quality scale | ≥ 30 / ≥ 24 fps |

**Per-frame ceilings at surface scale:** ≤ 900 draw calls · ≤ 2.2 M triangles · ≤ 12 ms CPU main thread.

**GPU memory:** ≤ 400 MB desktop, ≤ 220 MB mobile. Generated material arrays: 2048² × 4 layers × (albedo, normal, packed-ORM) on desktop; 1024² on mobile. Adaptive quality scale is set **once at init** (0.72 mobile / 0.92 desktop) and never mid-frame.

**Load:** first pixel ≤ 1.2 s · interactive ≤ 2.5 s · total transferred ≤ 2.5 MB including vendored three.

**The rule:** *any change that costs frames must pay for them.* Add the LOD or the quality tier before you add the feature, not after.

---

## 6 · Milestone ladder

Strict order. Do not begin **M(n+1)** until **M(n)** passes its gate (§7.7).

### M0 · Build the instrument
Nothing downstream is measurable without this. Also clears two explicit outstanding requests.

- `tools/capture.js` — headless Playwright, flies a fixed deterministic route across all six scales, writes numbered PNGs + perf JSON to `docs/captures/<milestone>/`. Run on a real GPU, not CI SwiftShader.
- `?bench=1` harness emitting p50/p95/p99 frame times, draw calls, triangle count, GPU memory.
- **Shader compile gate**: extract every shader string *as it is actually passed to `gl.shaderSource`* — not as it reads in the source file — and compile-check it headlessly. String-concatenation and template-interpolation defects only appear post-assembly.
- Delete the meteor-strike mechanic (§4).
- Stop desktop and mobile control layers from ever being mounted simultaneously (pointer-type + viewport detection). Full mobile pass is M7; this is just the collision fix.

**Gate:** capture script produces a complete numbered set from a cold start with one command; perf JSON present for all three tiers.

---

### M1 · The web must breathe
`cosmic.js`, `nbody.js`, `post.js`

The opening scale is the first frame anyone sees and currently the weakest. It reads static and monochrome.

- Colour tracers by **local density × velocity divergence** — infall cool, outflow warm — so the palette is a readout of real dynamics, not decoration.
- Drive shimmer from the actual growth factor `D(a)`, never from a bare sine. Motion must be non-loopable because it's integrating.
- Render filaments through a screen-space anisotropic kernel so structure reads as *thread*, not fog.
- Continuous slow `a`-drift so the field is never frozen; expose scrubbing on the same lever as deep time.

**Gate:** (a) a 20 s capture shows continuous motion with no perceptible loop; (b) ≥4 distinguishable hue families present, all within 0.02–0.85 luminance; (c) the `N` toggle makes the N-body/Zel'dovich difference *more* legible than before, not less; (d) budgets unchanged.

---

### M2 · Ground truth
`terrain.js`, `surface.js`, new `material.js`

- Four-layer triplanar procedural materials blended by slope × altitude × latitude × moisture. Analytic noise for mid/far; generated detail arrays inside 30 m.
- Parallax occlusion on rock. Wet-sand darkening inside the tide band. Sand ripples aligned to the wind field (§M3).
- Ocean: 8–12 summed Gerstner waves driven by the shared wind field, depth-based absorption via Beer–Lambert transmittance, Fresnel sky probe with screen-space refinement where the sky dominates, shoreline foam derived from terrain gradient and wave phase.
- Contact-hardening shadows near the camera.

**Gate:** at 1.7 m eye height, no visible tiling within 40 m in any biome; every material nameable from a still without labels (§8 axis 5); §2.7 parity test green.

---

### M3 · Wind and grass
new `flora.js`, new `wind.js`

**One global wind field** — two octaves of curl noise, one texture — sampled by *everything*: grass, foliage, dust, spores, cloth, water ripple, cloud advection, hair. This single shared source is what makes a world read as one place rather than a pile of effects.

- GPU-instanced grass in three LOD bands: blades → cards → shell/impostor.
- Displacement response to the player body and to vehicles, with recovery easing.
- Gusts propagate as coherent travelling waves across the field.

**Gate:** 250 k blades ≥ 60 fps desktop, 80 k ≥ 30 fps mobile; player displacement visible within 1.2 m; a capture sequence shows a gust crossing the frame as a wave, not as per-blade noise.

---

### M4 · The body
new `avatar.js`, new `camera.js`; rework input in `main.js`

First and third person, switchable without a cut.

- Capsule character controller against the LOD-ring collision mesh; step-up, slope limit, slide, coyote time, variable-height jump, momentum preservation.
- **Third-person rig:** spring arm with collision, velocity-proportional look-ahead, over-the-shoulder offset, auto-align on movement with a dead zone, framing that keeps the horizon low (§9).
- Locomotion blends procedurally — no keyframed animation assets. Antiphase gait already exists in `life.js`; generalise it.
- Gravity per world from real `GM/R²`, so the jump arc on a low-g moon is honest.

**Gate on feel, measured:** input→visible response ≤ 2 frames; camera never clips terrain across the full capture route; a blind viewer of a 30 s third-person capture cannot identify a single frame where control appears to fight the camera.

---

### M5 · Traversal
new `vehicle.js`

- Ground craft (hover/skimmer — no wheel simulation) and a short-hop atmospheric flyer.
- Enter/exit continuous, no cut, camera inherits velocity.
- Terrain interaction: dust plumes, grass displacement, water spray — all sampling the M3 wind field.
- Vehicle speed is bounded by the quadtree streaming rate; if you outrun the tiles, you're going too fast.

**Gate:** a single unbroken capture from standing → vehicle → 40 km traverse → dismount → walking, with no pop-in, no seam, and no frame over budget.

---

### M6 · Civilisation
`settlement.js` → `civilization.js`

Four tiers — outpost, town, city, arcology — selected by world age, atmosphere, and a per-world tech index derived from the seed.

- Street networks by wave-function collapse, conformed to terrain gradient. Settlements sit where a settlement would sit: sheltered, watered, at a confluence or a pass.
- Buildings as parameterised mass models with facade shaders; no meshes on disk.
- Windows light per-window at dusk with stochastic delay — already the best moment in the project, so protect it and extend it.
- Agriculture, roads, and light pollution readable from orbit and continuous with the ground view.

**Gate:** the same city is coherent and legible at 10 km on approach, 500 m in flight, and 1.7 m on foot — verified by three captures at those distances scored independently.

---

### M7 · Mobile
`hud.js`, `main.js`

**Gate:** on a 390 × 844 viewport — touch controls occupy ≤ 14% of screen area, sit entirely within the bottom 30% inside thumb reach, are never co-present with keyboard hints, fade after 3 s of no input, and are reachable one-handed. All six scales controllable. All budgets green on the mobile tier.

---

### M8 · Direction
Final pass. Exposure adaptation, camera drift, subtle lens character, tour-mode recut, audio bed rebalance. This is the milestone where the project stops being a demo.

---

## 7 · Workflow

Per milestone, in order:

1. **Read before writing.** The touched modules, in full. This codebase is dense and load-bearing; the trap in §11 you trip will be one you could have read about.
2. **Plan.** Write `docs/plans/M<n>.md`: modules touched, new files, risks, rollback path, which budgets are at risk. **Human sign-off before any code.**
3. **Validate offline first.** New shader math gets a CPU reference implementation (NumPy or JS, float32) and a pixel diff against the GPU output — ≥97% of pixels within 2/255 — before it goes near the render loop.
4. **Build behind a flag.** New systems land behind a URL param, default-off. Flipping the default is a separate commit.
5. **Capture.** `node tools/capture.js --milestone M<n>`.
6. **Critique.** The critic agent scores captures against §8. Below gate → back to step 4. **Maximum 5 iterations**, then escalate to the human with a written account of the specific blocking axis. Do not silently loop.
7. **Gate.** Re-shoot and re-score *every previous milestone's* captures. No regressions. Budgets green. Then commit.

### Subagent fan-out

| Agent | Owns | Notes |
|---|---|---|
| `architect` | `docs/plans/*` | Plans only. Writes no code. |
| `graphics` | shaders, materials, post | |
| `sim` | physics, cosmology, procgen | Guards §2.3 determinism and §2.7 parity. |
| `interaction` | input, camera, controllers, mobile | |
| `perf` | §5 | **Has veto.** |
| `critic` | §8 | Writes no code. Adversarial by design. |

Parallelise across **modules**, never across the same file. `perf` and `critic` run after every fan-in, not at the end.

---

## 8 · Critic rubric

You cannot play No Man's Sky, Starfield, Outer Wilds, Breath of the Wild, or Pacific Drive, and their screenshots must not be checked into this repo. So judge against this rubric, applied to captures you took yourself.

Score each axis 0–5. **Gate: ≥4 on every axis, ≥4.5 mean.**

1. **Silhouette** — is there a readable subject at three distances in the frame?
2. **Light** — is there a dominant light with clear direction *and* a secondary bounce or rim? Is any surface receiving no light information at all?
3. **Depth** — atmospheric perspective present? At least three separable depth planes?
4. **Motion** — does at least one element move with coherent, non-loopable motion?
5. **Materials** — can you name what each surface is made of, without labels?
6. **Colour** — ≤3 hue families plus one accent; nothing clipping; blacks at true 0.
7. **Chrome** — could you delete the HUD entirely and lose no orientation?
8. **Honesty** — does anything on screen contradict the physics the HUD is asserting?

**The critic must write one sentence per axis naming the specific pixel region that lost the point.** "Looks good" is a failed review. So is "not AAA." Both are unactionable and both will be rejected.

---

## 9 · Art bible

> **North star: the wind and the light do the acting.**

Every named reference reduces to this, which is why they can coexist.

- **Terrence Malick** — magic hour; backlight through foliage; the camera drifts and finds its subject late; horizon sits low; nothing is centred; exposure breathes.
- **Hayao Miyazaki** — cumulus with genuine vertical development; skies saturated but never neon; fields that have a *far edge*; stillness used as a beat; scale communicated by one small figure against one enormous thing.
- **Ghost of Tsushima** — wind is the interface. Foliage answers the body. Leading lines route the eye. Extreme weather is an event, never a default.
- **Cowboy Bebop** — interface and score only. Hairline type, generous negative space, restraint, jazz-adjacent generative beds.

**Technical direction:**

- Palette is derived per world from the seed. **There is no default palette.** Confirm the palette for a biome family before building it.
- Tonemap `1 − exp(−1.32·c)`, gamma 2.2. **Never ACES.** Near-black bottom stop. Sub-perceptible ±1/255 dither.
- Interpolation is branch-free chained `mix` in linear light.
- `prefers-reduced-motion`: hyperzooms shorten to 250 ms, camera drift off, wind amplitude halved. Never disabled outright — this is a moving universe, and stillness would be a lie about it.

---

## 10 · The style reference problem

The CodePen link in the original brief is an `/editor/` URL. Those require the author's session and **cannot be read by any agent, including this one.** Any subagent claiming to have matched that reference is hallucinating.

Before it can be used: open the pen, publish it, and paste the public `codepen.io/<user>/pen/<id>` URL — or, better, write the two or three sentences describing what you actually wanted from it into §9. Verbal art direction that an agent can read beats a link it can't open.

---

## 11 · Known traps in this codebase

- **float32 at planet scale.** Five digits short of walking distance. Never introduce a world-space float32 position below orbit.
- **Tile seams.** Skirts are load-bearing. Parent tiles must keep drawing until all four children have streamed.
- **`terrain.js` drift.** See §2.7. This is the failure that will look like a rendering bug and take a day to find.
- **Determinism leaks.** Any `Math.random()`, wall-clock read, or iteration-order dependency in a generation path silently breaks shareable URLs. Every seeded universe is a permanent public address.
- **Adaptive quality mid-frame.** Set once at init. Changing it live causes visible pumping.
- **Shader strings.** Compile-check post-assembly, not as written in source (§M0).

---

## 12 · Session protocol

Every session opens with:

```
Read CLAUDE.md and §9 in full before doing anything.

Milestone: M<n> — <name>
Goal this session: <one sentence>

Follow §7 exactly: plan → sign-off → offline-validate → build behind a flag →
capture → critique → gate. Fan out per §7; parallelise across modules, never
across a file. Do not start M<n+1>.

Stop and ask me if: an invariant in §2 would have to bend, a budget in §5 goes
red and cannot be paid back, or the critic fails the same axis three times.
```

That is the whole prompt. Everything else lives in this file, in version control, where it can be argued with.
