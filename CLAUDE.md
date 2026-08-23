# AEON — Engineering & Art Constitution

**Repo:** `Majveia/Fable-Universe-` · **Stack:** vanilla JS + GLSL, vendored `three@r170`, no build step
**Art north star:** `docs/reference/hoshi-no-tani.html` (vendored, 6,133 lines, self-contained)

**Read this file and §9 in full at the start of every session**, then `docs/plans/RECKONING.md` §0 for the live debt ledger. §§1–12 are the constitution and the art bible; **§§13–16 are the map of the repository as it stands** — modules, commands, CI, and current state.

**Read this file and §9 in full at the start of every session.** It supersedes conversational instruction unless the human explicitly overrides a clause in-session. If you are about to violate anything in §2, stop and ask.

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
3. **Determinism.** Same seed + same code = same universe, forever. No `Math.random()`, no `Date.now()`, no un-seeded `performance.now()` in any generation path. `src/rng.js` is the only entropy source. **Bit-identity is promised per CPU architecture, not universally** — measured, not assumed: `tools/digest.js` reduces the pure generation path to one SHA-256, and `.github/workflows/determinism.yml` runs it across platforms. On one V8, x86-64 agrees across Linux and Windows bit for bit; arm64 does not, in the three suites that lean on `sin`, `cos`, `exp` and `pow`. ECMA-262 specifies those functions only as "an implementation-approximated result", and V8's fdlibm port is compiled per architecture — on arm64 a fused multiply-add rounds `a*b + c` once where two instructions round twice. The consequence is a last bit, not a different world: a shared URL resolves to the same place, a sky stop lands a fraction of a 255th apart. Anything wider than that is a leak and is a revert. See `docs/notes/ci.md`.
4. **Every place is a URL.** Any feature creating a new kind of location extends the deep-link schema in `main.js` in the same commit.
5. **Continuity.** No cuts, no loading screens, no fades to black. Scale changes are hyperzooms under a passing snapshot (`transition.js`). If a feature can't be entered continuously, it isn't finished.
6. **Precision discipline.** Camera stays at scene origin; the world carries the negated camera position in JS doubles; tile vertices are tile-relative and built in float64 in the worker. Never introduce a float32 world-space position at planet scale.
7. **GLSL↔JS height-field parity.** `src/terrain.js` is an exact port of the orbital height field. Change the noise in GLSL, port it in the same commit, with a numeric parity test over 10⁴ samples (max abs error < 1e-4 of planet radius). Break this and the coast you saw from space stops being the coast you walk. *(The reference independently arrived at the same rule — it calls its terrain sampler "single source of truth, shared with the CPU.")*
8. **Black belongs to vacuum, not to the display.** Rewritten after reading the reference; see §3, row 1. In vacuum (cosmic web, galaxy, system, black hole) the background is true `#000` and blacks are never lifted. Inside an atmosphere (planet approach, surface, cloud deck) the print curve engages and **nothing reaches pure black.** Both are physically motivated. Neither is a compromise.
9. **Frame budget is a correctness property**, not a nice-to-have. See §5.

---

## 3 · Resolved contradictions

Settled. Do not re-litigate mid-build; raise between milestones if you disagree.

| Tension | Ruling | Why |
|---|---|---|
| **OLED true-black doctrine vs. the reference's explicit lift.** The reference states outright that nothing in a Ghibli frame is ever pure black, and lifts the print by `vec3(0.017, 0.021, 0.036)`. Its shadow model is annotated *"shadows change hue, they do not go black."* AEON's original invariant said the opposite. | **Split by medium, not by taste.** Vacuum renders to true `#000`; atmosphere renders through the lifted print. Vacuum genuinely delivers zero photons; an atmosphere genuinely never does. The doctrine survives and gains a physical justification. The grade cross-fades on the atmospheric-entry hyperzoom, driven by the same parameter that drives the transition. | Both sources were right about different media. This is the most consequential change from v1 of this document. |
| **An authored valley vs. 10²⁸ generated worlds.** The reference is one hand-composed place: a 2400 m world, a river spline through hand-placed control points, hero landmarks the terrain is deformed to accommodate, a footpath explicitly routed *to lead the eye out of frame-left*, and a sun nailed at 13.5° elevation / 292° azimuth. None of that ports directly. | **Port the light, the palette method, and the print — those generalise. Convert the composition into procedural constraints.** The landing-site solver must *guarantee* what the reference hand-placed: a valley cross-section framing the view, one leading line exiting frame, one hero landmark in the opening frustum, a spawn sun forced into a golden-hour band. Composition becomes a solver constraint, not a decoration. | This is the actual engineering problem the reference sets you. Everything else is transcription. |
| Two tonemaps: AEON's `1 − exp(−1.32·c)` vs. the reference's rational print curve. | **The reference curve wins at surface scale; AEON's survives in vacuum.** They are not competing tonemaps — the reference's is a *grade*, and grades belong to atmospheres. Cross-fade on entry. Never ACES, in either regime. | §9.4. |
| "Minimalist clean interface" vs. cities, vehicles, third-person UI | **Minimalism is a property of the chrome. Maximalism is a property of the world.** HUD: hairline type, ≤3 persistent elements, fades after 4 s, `H` kills it. The reference agrees — its HUD sits at 0.62 opacity, 11 px, uppercase, letter-spaced, bottom-anchored, pointer-events none. | The two demands were never about the same object. |
| Research-grade physics vs. "Rick and Morty × Cowboy Bebop" | **The numbers are never negotiable; the palette always is.** If a stylistic choice requires falsifying a formula, the style loses. Bebop informs *interface and score only.* | The physics is the project's actual claim to originality. |
| Miyazaki / Malick vs. Ghost of Tsushima | **Settled by evidence, not inference.** The reference is Ghibli by declaration and Ghost-of-Tsushima by construction: a painted four-stop sky over a twelve-million-vertex wind-driven meadow. It proves the two are one target. See §9. | v1 guessed this. The file confirms it. |
| Rick-and-Morty biome absurdity | **Weirdness budget: ≤5% of worlds.** Enforce in the seed→biome function. | Rarity is the mechanism by which strangeness lands. |
| "Maximum ambition / loop until perfect / never stop" | **Ambition unbounded in scope, bounded in sequence.** One milestone at a time (§6), each shippable, none regressing a predecessor. | An unterminated loop produces thrash and silent regressions, not quality. |

---

## 4 · Non-goals

- No multiplayer, no backend, no accounts, no persistence beyond URL + `localStorage` logbook.
- No combat, inventory, quests, XP, or economy. **This is a place, not a game loop.** The verbs are *travel* and *look*.
- **No meteor-strike mechanic.** Remove the `X` impact + runtime crater-baking path from `src/surface.js`. Ancient craters on airless worlds stay — generation, not mechanics.
- No build tooling, no TypeScript migration, no framework.
- No photoreal humanoid characters. Figures are silhouettes and scale references.
- No third-party art assets, ever.

---

## 5 · Budgets

`?bench=1` runs a fixed 600-frame scripted flight and writes a perf JSON.

| Tier | p95 / p99 |
|---|---|
| Desktop ref — M-series or RTX 3060 class @ 1440p | ≥ 60 / ≥ 50 fps |
| Mobile ref — iPhone 13 class, DPR capped 2.0 | ≥ 30 / ≥ 25 fps |
| Low tier — Intel Iris / Adreno 6xx | ≥ 30 / ≥ 24 fps |

**Per-frame at surface scale:** ≤ 900 draw calls · ≤ 2.2 M triangles · ≤ 12 ms CPU main thread.
**GPU memory:** ≤ 400 MB desktop, ≤ 220 MB mobile.
**Load:** first pixel ≤ 1.2 s · interactive ≤ 2.5 s · transferred ≤ 2.5 MB.

Adopt the reference's **four-row quality table** verbatim in shape — one array indexed by tier, each row carrying every knob (per-ring grass density multipliers, shadow map resolution, wind RT resolution, supersample factor, bloom levels, per-ring blade segment counts). One row change reconfigures the entire renderer. Note its supersample discipline: the factor is **on top of** device pixel ratio and always ≥ 1.0 above Low, so the composite always resolves *down* to the canvas.

**The rule:** *any change that costs frames must pay for them.* Add the LOD before the feature.

---

## 6 · Milestone ladder

Strict order. Do not begin **M(n+1)** until **M(n)** passes its gate (§7.7).

### M0 · Build the instrument
- `tools/capture.js` — headless Playwright, fixed deterministic route across all six scales, numbered PNGs + perf JSON to `docs/captures/<milestone>/`. Real GPU, not CI SwiftShader.
- `?bench=1` harness: p50/p95/p99 frame times, draw calls, triangles, GPU memory.
- **Shader compile gate**: extract every shader string *as passed to `gl.shaderSource`*, not as it reads in source, and compile-check headlessly. This codebase and the reference both assemble shaders by template interpolation; defects only exist post-assembly.
- Vendor the reference to `docs/reference/hoshi-no-tani.html`; record provenance in `docs/reference/README.md`.
- Delete the meteor-strike mechanic (§4).
- Stop desktop and mobile control layers from mounting simultaneously.

**Gate:** one command produces a complete numbered capture set from cold start; perf JSON for all three tiers.

---

### M1 · The web must breathe
`cosmic.js`, `nbody.js`, `post.js` — **vacuum scale: §2.8 true-black regime applies.**

- Colour tracers by **local density × velocity divergence** — infall cool, outflow warm — so palette is a readout of real dynamics.
- Drive shimmer from the actual growth factor `D(a)`, never a bare sine. Motion is non-loopable because it is integrating.
- Screen-space anisotropic kernel so filaments read as *thread*, not fog.
- Continuous slow `a`-drift; expose scrubbing on the deep-time lever.
- Adopt the reference's **ordered dither** — `fract(dot(gl_FragCoord.xy, vec2(0.7548776662, 0.5698402909)))` at ±0.5/255. Its stated purpose is that a smooth gradient must never band, and the cosmic web is the worst banding case in the project.

**Gate:** (a) 20 s capture shows continuous motion, no perceptible loop; (b) ≥4 distinguishable hue families, all within 0.02–0.85 luminance; (c) the `N` toggle makes the N-body/Zel'dovich difference *more* legible; (d) zero banding in the deep field at 8-bit; (e) budgets unchanged.

---

### M2 · Ground truth
`terrain.js`, `surface.js`, new `material.js`, new `paint.js` — **atmosphere scale: lifted print regime.**

Port §9.2 (`paint()`) and §9.3 (aerial perspective) first; they change every subsequent frame.

- Four-layer triplanar procedural materials blended by slope × altitude × latitude × moisture. Analytic noise mid/far; generated detail arrays inside 30 m.
- Ocean: 8–12 summed Gerstner waves on the shared wind field, Beer–Lambert depth absorption, Fresnel sky probe. Take the reference's river as the model: **depth-graded body colour in discrete bands**, quantised sun glitter, foam from gradient — not a PBR water shader.
- Distant terrain: the reference renders far ridges as **pure haze, pure shape** — silhouette only, no detail. Do the same; cheaper *and* better.

**Gate:** at 1.68 m eye height, no visible tiling within 40 m in any biome; every material nameable from a still (§8 axis 5); §2.7 parity green; a shadowed surface anywhere in frame that has gone achromatic-dark is a failure.

---

### M3 · Wind and grass
new `flora.js`, new `wind.js` — the milestone the reference exists to teach.

**One global wind field** sampled by *everything*: grass, foliage, dust, spores, cloth, water ripple, cloud advection, smoke. Build it as the reference does — a render target (256², 440 m span) with an **analytic fallback beyond its edge** so gust bands still roll over the far hills, blended on an edge mask. The fallback branch is warp-coherent (all of a blade's vertices sample one point), which is what makes it nearly free.

Three ingredients, in order:
1. **Coherent gust cells** — six travelling cells with a sharp leading edge (`exp(−|u|·9)`), an exponential body, and a cross-wind Gaussian falloff. This is what makes wind read as *weather* rather than as noise.
2. **Inertial-subrange turbulence**, advected with the flow.
3. **Terrain coupling** — speed-up over crests (`1 + 0.92·crest`), shelter in lee (`exp(−Δh/23)`), deflection along contours.

Plus a **logarithmic boundary layer** normalised to 10 m reference height, so roots barely move and tips whip.

Grass per §9.5. The single most transferable idea in the reference: **one continuous density law across all rings** — `blades/m²(d) = B·min(1, (dn/d)^1.5)` with `K = B·dn^1.5` held constant between rings, so there is no density step anywhere. Rings exist *only* to switch blade tessellation. Thin twice: coarsely on CPU by lowering instance count from a pre-shuffled buffer (any prefix is a fair sample, and a thinned blade costs nothing — not even a vertex shader invocation), then finely per-blade in the vertex shader against true distance, with the CPU deliberately over-drawing from the chunk's *nearest* corner so the shader can only ever remove.

Use exponent **1.5**, not 1.45 or 1.7 — at exactly 1.5 the shader evaluates it as `x·x·inversesqrt(x)`, three single-cycle instructions against roughly ten for a general `pow()`, and it runs on ~12 M vertices per frame.

**Gate:** ≥ 800 k blades ≥ 60 fps desktop, proportionate count ≥ 30 fps mobile; no visible density step at any ring boundary; a gust crosses frame as a coherent front with a legible leading edge; blades ring at their own frequency after the front passes; the walker parts grass within 1.2 m; grass reads as *meadow* at the horizon, not as a green plane.

---

### M4 · The body
new `avatar.js`, new `camera.js`; rework input in `main.js`

First and third person, switchable without a cut. Capsule controller against LOD-ring collision; step-up, slope limit, slide, coyote time, variable-height jump, momentum preservation. Third-person rig: spring arm with collision, velocity-proportional look-ahead, dead-zoned auto-align, horizon held low (§9.7). Gravity per world from real `GM/R²`.

Adopt the reference's **single gait clock**: one phase drives head bob, footstep audio, and the grass the walker parts, so they can never drift out of sync. Locomotion blends procedurally — no keyframed assets. Eye height 1.68 m, FOV 52.

**Gate:** input→visible response ≤ 2 frames; camera never clips terrain across the full route; a blind viewer of a 30 s third-person capture cannot identify a frame where control fights the camera.

---

### M5 · Traversal
new `vehicle.js` — hover craft and short-hop flyer. Continuous enter/exit, camera inherits velocity. Dust, grass displacement, spray all sampling the M3 field. Speed bounded by quadtree streaming rate.

**Gate:** one unbroken capture: standing → vehicle → 40 km traverse → dismount → walking. No pop-in, no seam, no frame over budget.

---

### M6 · Civilisation
`settlement.js` → `civilization.js`

Four tiers — outpost, town, city, arcology — by world age, atmosphere, and seed-derived tech index. WFC street networks conformed to terrain gradient. Settlements sit where settlements sit: sheltered, watered, at a confluence or a pass. Parameterised mass models, no meshes on disk.

Take the reference's village palette as the archetype for temperate worlds — warm clay roofs against cream walls, dark timber, windows glowing at `#FFD98C`. The per-window dusk light-up is already the best moment in AEON; protect and extend it.

**This is where the composition solver from §3 row 2 lands.** A settlement is a hero landmark; the road to it is a leading line.

**Gate:** the same city coherent and legible at 10 km, 500 m, and 1.68 m, scored independently.

---

### M7 · Mobile
**Gate:** at 390 × 844 — controls ≤ 14% of screen area, entirely within the bottom 30%, never co-present with keyboard hints, fade after 3 s idle, one-handed reachable. All six scales controllable. Mobile-tier budgets green.

---

### M8 · Direction
Exposure adaptation, camera drift, tour recut, audio rebalance. The milestone where it stops being a demo.

---

## 7 · Workflow

1. **Read before writing** — the touched modules, in full, plus the relevant section of the reference.
2. **Plan.** `docs/plans/M<n>.md`: modules, new files, risks, rollback, budgets at risk. **Human sign-off before code.**
3. **Validate offline first.** New shader math gets a CPU reference implementation and a pixel diff (≥97% within 2/255) before it enters the render loop.
4. **Build behind a flag**, default-off. Flipping the default is a separate commit.
5. **Capture.** `node tools/capture.js --milestone M<n>`.
6. **Critique** against §8. Below gate → step 4. **Max 5 iterations**, then escalate with a written account of the blocking axis. Do not silently loop.
7. **Gate.** Re-shoot and re-score *every previous milestone*. No regressions. Budgets green. Commit.

| Agent | Owns | Notes |
|---|---|---|
| `architect` | `docs/plans/*` | Plans only, no code. |
| `graphics` | shaders, materials, post | Owns §9 fidelity. |
| `sim` | physics, cosmology, procgen | Guards §2.3 and §2.7. |
| `interaction` | input, camera, controllers, mobile | |
| `perf` | §5 | **Has veto.** |
| `critic` | §8 | No code. Adversarial by design. |

Parallelise across **modules**, never across a file. `perf` and `critic` run after every fan-in.

---

## 8 · Critic rubric

You cannot play No Man's Sky, Starfield, Outer Wilds, Breath of the Wild, or Pacific Drive, and their screenshots must not enter this repo. **You *can* run `docs/reference/hoshi-no-tani.html` and capture from it.** For any atmospheric-scale work, capture the reference on the same route and score both blind. This is the side-by-side you originally asked for, and it is executable.

Score 0–5. **Gate: ≥4 every axis, ≥4.5 mean.**

1. **Silhouette** — readable subject at three distances?
2. **Light** — a dominant light with direction *and* a secondary bounce or rim? Any surface receiving no light information at all?
3. **Depth** — aerial perspective present? Three separable depth planes?
4. **Motion** — at least one element moving with coherent, non-loopable motion?
5. **Materials** — every surface nameable without labels?
6. **Colour** — ≤3 hue families plus one accent; nothing clipping; **in vacuum, blacks at true 0; in atmosphere, no pixel below the lift.**
7. **Chrome** — delete the HUD entirely and lose no orientation?
8. **Honesty** — does anything on screen contradict the physics the HUD asserts?

**One sentence per axis naming the specific pixel region that lost the point.** "Looks good" is a failed review. So is "not AAA."

---

## 9 · Art bible

> **North star: the wind and the light do the acting.**
> Reference implementation: `docs/reference/hoshi-no-tani.html`. When this section and the reference disagree, the reference wins — read it.

### 9.1 · Palette as a single table

Every colour in one const, sRGB hex, converted to linear at load, injected into GLSL as `vec3` literals. Roughly sixty names grouped by domain: sky & air, clouds, grass, terrain, river, stone, trees, village, light. Zero bytes shipped; entirely deterministic. Already AEON's doctrine — the reference proves how far it scales.

Anchor values for a temperate world:

```
sky      zenith #4E80B4  upper #7BA9CE  mid #A8CAE0  horizon #E4DAC2
         horizon-sun #FBE2AE  glow #FFF1CE  disc #FFFAEA  anti #C8D4D6
air      haze #A9BCC7  mist #D6DDD4
light    sun #FFD79C  ambient-sky #9EC6E6  ambient-ground #AA9C64
         shadow-tint #5C6E9E          ← shadows are violet, never grey
```

Per-world palettes stay seed-derived. **There is no default palette** — confirm the palette for a biome family before building it. But derive them *in this structure*, with these roles.

### 9.2 · The light model — `paint()`

The heart of it. Every lit surface goes through one function.

- **Half-Lambert wrap**: `clamp(ndl·0.62 + 0.46, 0, 1)`. Non-negotiable at low sun. A 13.5° sun grazes flat ground at `ndl ≈ 0.23`; plain Lambert drops the whole valley floor into the shade band and golden hour reads as dusk.
- **Three-stop hue ramp**, band edges at `0.17` and `0.58`, with a `soft` width and a per-surface `jit` — a painterly wobble on the band edges. Transitions are soft but *visibly banded*. This is the single largest contributor to the illustrated look, and the first thing a PBR-trained instinct will delete. Don't.
- **Shadows change hue, they do not go black.** Blend toward `col·0.80 + shadowTint·0.040`, never toward zero.
- **Hemispheric ambient tints rather than washes** — normalise the hemi colour to unit luminance so it can rotate hue (cool from sky, warm from ground bounce) without ever bleaching the palette. Two terms: a 0.22-weight hue rotation, and a 0.052-weight additive fill gated on AO.
- **Backlight rim** — `pow(1 − dot(N,V), 4.2)` × `smoothstep(0.05, 0.85, dot(V, −sunDir))`, gated on shadow. The reference annotates this *"the connective tissue of the whole image."* Treat that as a spec.
- **Subsurface transmission** for grass, leaves, smoke: `pow(dot(V,−sun), 3.2) × pow(1 − |dot(N,sun)|, 2.2)`. Only surfaces nearly edge-on to the sun transmit — light coming *through*, not bouncing off.

### 9.3 · Aerial perspective

`fogNear 70 m`, `fogFar 1700 m`, exponent `1.28`, height falloff `exp(−(y−6)/260)` mixed at 0.72. Fog colour is **not** one colour: it lerps toward horizon-sun on a `pow(dot(−V,sun), 3.4)` Mie term and toward the anti-solar tint away from it. Valley mist pools separately — `smoothstep(46→8)` in height × `smoothstep(120→420)` in distance.

The fog fraction is written to the **alpha channel** so the post chain knows each pixel's distance. That one trick enables §9.4's distance-graded softening. Adopt it.

Guard the NaN: a poisoned depth must not poison the colour.

### 9.4 · The print

Order matters. Exposure → tonemap → grade → texture → resolve.

1. **Tonemap** — rational curve, `x(0.36x + 0.42) / (x(0.34x + 0.66) + 0.11)`, clamped. Not ACES. Not Reinhard.
2. **Shadows to violet, highlights to cream** — multiply by `(0.90, 0.95, 1.16)` below luma 0.34 and `(1.055, 1.012, 0.925)` above 0.44. The reference calls this *"the single biggest lever."* It is.
3. **Lift** `(0.017, 0.021, 0.036)` — atmosphere only (§2.8).
4. **Gentle S**, 16% toward `c²(3−2c)`, then a midtone-only saturation boost peaking around luma 0.10–0.42 and rolling off by 0.96.
5. **Watercolour softening tied to distance** — a blurred tap blended at `0.42 × fog`. Wet-in-wet, *not* bokeh. Plus chroma bleed at `0.09 + 0.17·wet`: paint runs, pixels do not.
6. **Paper tooth** — two gradient-noise octaves, ±3% grain plus 1% directional fibre.
7. **Warm-dark vignette** toward `(0.62, 0.60, 0.66)`, falloff `pow(1 − 1.15r², 1.55)`.
8. **Ordered dither** ±0.5/255, post-sRGB.

**FXAA note worth stealing:** compute FXAA luma through a Reinhard shape, not raw linear. In a linear HDR buffer a sunlit blade sits at 1.5 and a shaded one at 0.03; thresholding raw luma makes FXAA fire nowhere in the light and everywhere in the dark. Folding it through the curve the eye will see is the difference between it working on grass and not — and it buys back roughly 1.45× of the whole fragment budget versus brute-force supersampling.

### 9.5 · Grass and wind

Covered as M3 (§6). The doctrine in one line: **density is one continuous law, rings only switch tessellation, and everything that moves samples one wind field.**

Blade detail worth carrying: a curved cross-section two triangles wide that shades like a rolled leaf; a vertical hue path from teal at the root to yellow-green at the tip; tussock clustering at metre *and* decametre scales; a meadow mosaic of four patch colours; per-blade variation so no two greens match; dry patches; a wind flash on the gust fronts. And the acknowledgment that once a blade is two or three pixels wide, everything varying across its width is sub-pixel and should be dropped by tier.

### 9.6 · Sky

**A painted gradient, not a scattering integral.** Deliberate, and right — cheaper, art-directable, and it looks better. Four-stop vertical wash, azimuthal asymmetry (warm toward sun, cool away), Mie halo as `pow(ang,7)·0.72 + pow(ang,1.9)·0.16`, **sun disc painted 3× oversize and never blown out**, sheared cirrus above the horizon.

Keep a lightweight variant without disc or cirrus for reflections — moving water resolves none of it and the octaves come back as sparkle.

AEON complication: sun colour must stay honest to the star's blackbody temperature (§2, physics first). Resolution — **derive the four sky stops from the star's spectrum through a fixed transfer, rather than hardcoding them.** The stops above are that transfer's output for a G-type star at 13.5°. That is the port: not the values, the function that produced them.

### 9.7 · Composition

The reference's opening frame is designed, and its design is stated in its own comments: a valley cross-section chosen because it *"makes the whole composition"*, hero landmarks the terrain is deformed to accommodate, and a footpath routed to *"lead the eye out of frame-left."*

For AEON these become **spawn constraints on the landing-site solver**:
- Sun elevation at spawn forced into 8–18°. Golden hour is not a mood; it is the geometry the light model is tuned for.
- Horizon sits low; nothing is centred.
- At least one leading line (river, path, ridge, road) exiting frame.
- At least one hero landmark in the opening frustum, with scale legible against a human-height reference.
- Far ridges as pure silhouette in haze.

### 9.8 · Reduced motion

`prefers-reduced-motion`: hyperzooms shorten to 250 ms, camera drift off, wind amplitude halved. Never disabled outright — this is a moving universe, and stillness would be a lie about it.

---

## 10 · Reference provenance

The reference arrived as a CodePen export: `index.html` (6,133 lines, everything inline), an empty `script.js`, CodePen's default placeholder CSS, and a `package.json` pinning `three ^0.185.1`.

Two consequences:

- **The pen is self-contained and zero-asset.** Already compatible with §2.1 and §2.2. Nothing needs stripping.
- **It targets three r185; AEON vendors r170.** Colour-management and renderer defaults moved across that range. Port *techniques and constants*, not files, and re-verify anything touching `convertSRGBToLinear`, output colour space, or render-target formats.

The original `/editor/` URL is session-gated and unreadable by any agent. It is not a source of truth and must not be cited as one. `docs/reference/hoshi-no-tani.html` is the source of truth.

---

## 11 · Known traps

- **float32 at planet scale.** Five digits short of walking distance. Never a world-space float32 position below orbit.
- **Tile seams.** Skirts are load-bearing. Parents keep drawing until all four children have streamed.
- **`terrain.js` drift.** §2.7. Will look like a rendering bug and cost a day.
- **Determinism leaks.** Any `Math.random()`, wall-clock read, or iteration-order dependency in a generation path silently breaks shareable URLs. `tools/invariants.js` ratchets the entropy sites; `tools/digest.js` catches drift the ratchet cannot see.
- **Transcendental drift across architectures.** §2.3's per-architecture clause is not an excuse, it is a boundary. A quantity that reaches the *frame* through `sin`, `cos`, `exp` or `pow` may land a last bit apart on arm64 and after a V8 upgrade; one that reaches a *count*, an *index*, or a *branch* must not. Quantise before it crosses that line — a blade count decided by a last bit is a visible pop, and a hash bucket decided by one is a different world.
- **A CPU/GPU pair that is deliberately two functions.** §M3 fixes the density exponent at exactly 1.5 so the shader can evaluate `x·x·inversesqrt(x)`, while `src/meadow.js` calls `Math.pow`. They agree to 1.3e-7 today and nothing but `tools/pixeldiff.js --suite meadow` requires them to keep agreeing. The same reasoning as §2.7, one milestone over.
- **Adaptive quality mid-frame.** Set once at init. Live changes pump visibly.
- **Shader strings.** Compile-check post-assembly (§M0).
- **NaN in the bloom pyramid.** One bad texel gets smeared over a whole neighbourhood by the downsample chain and survives the tonemap as a solid block. The reference firewalls at the bright pass *and* again before the print. Do both.
- **Un-grassed annuli.** The reference records this exact bug: hand-picked chunk grids too small for the middle rings left a gap between every ring pair, which read as *"dense grass only appears when you get closer."* Derive the grid from the ring's own far distance.
- **PBR instinct.** The band edges in the hue ramp, the oversize sun disc, the painted sky, the quantised water glitter — every one looks like a bug to a physically-based reflex, and every one is the art direction. Do not "fix" them.

---

## 12 · Session protocol

```
Read CLAUDE.md and §9 in full before doing anything.
For any atmospheric-scale work, also read the matching section of
docs/reference/hoshi-no-tani.html.

Milestone: M<n> — <name>
Goal this session: <one sentence>

Follow §7 exactly: plan → sign-off → offline-validate → build behind a flag →
capture → critique → gate. Fan out per §7; parallelise across modules, never
across a file. Do not start M<n+1>.

Stop and ask me if: an invariant in §2 would have to bend, a budget in §5 goes
red and cannot be paid back, or the critic fails the same axis three times.
```

That is the whole prompt. Everything else lives in this file, in version control, where it can be argued with.

---

## 13 · The repository as it stands

~43 k lines of ES modules in `src/`, loaded directly by `index.html` — no
bundler, no manifest, no `package.json` anywhere in the tree (its absence is
enforced; see §14, `invariants.js`). `vendor/` holds `three@r170` and the
importmap that resolves it. `tools/` is dev-time only and is never imported by
`src/`.

```
index.html          the only entry point — importmap + <canvas>
src/                the universe (see the map below)
vendor/three@r170   the one dependency, vendored
tools/              the instrument: gates, captures, offline suites (§14)
docs/plans/         one per milestone + RECKONING.md, the live debt ledger
docs/notes/         cross-module integration notes, ci.md, AGENT-PROTOCOL.md
docs/reference/     hoshi-no-tani.html — the art north star (§10)
docs/captures/      committed capture sets, perf JSON, digest/pixeldiff baselines
docs/constitution/  superseded versions of this file
```

### Module map

**Foundations — touch these last and carefully.**
`rng.js` (the only entropy source, §2.3) · `clock.js` (one monotonic scene
time; nothing else reads a wall clock in a generation path) · `quality.js`
(the §5 four-row tier table) · `main.js` (App, scale graph, deep-link schema
§2.4, input dispatch) · `transition.js` (hyperzooms, §2.5).

**Scales**, one file each, in the order you fall through them:
`cosmic.js` (0 · the web) → `galaxy.js` (1) → `system.js` (2) →
`planetscale.js` (2.5 · the whole planet) → `surface.js` (3 · walkable, the
largest file in the repo) → `blackhole.js` (3b) · plus `clouds.js` (3½ ·
inside a giant), `orbital.js`, `ascent.js`/`climb.js` (surface ↔ orbit),
`liminal.js`/`rooms.js`/`interior.js` (the rooms between).

**Simulation & procgen** (`sim`'s ground, guards §2.3 and §2.7):
`cosmology.js` · `zeldovich.js` · `nbody.js` · `lightcone.js` ·
`collision.js` · `planet.js` · `terrain.js` (the CPU port of the orbital
height field — §2.7 lives here) · `landform.js` · `hydrology.js` ·
`rivers.js` · `quadtree.js` + `tilebuild.js` (streaming cube-sphere LOD,
float64 tile-relative vertices, §2.6) · `ecology.js` · `life.js` ·
`resonance.js`.

**Light, materials, print** (`graphics`, owns §9):
`paint.js` (§9.2 for the ground) · `painted.js` (§9.2 for everything else) ·
`material.js` · `foliage.js` · `shadow.js` · `aerial.js` (§9.3, writes the fog
fraction to alpha) · `starlight.js` + `scatterlut.js` (§9.6 — sky stops derived
from the star's blackbody, not hardcoded) · `starfield.js` · `night.js` ·
`print.js` + `soft.js` + `wash.js` (§9.4) · `post.js` + `bloom.js` +
`godrays.js` + `flare.js` · `horizon.js` (far ridges as silhouette) ·
`ocean.js` · `nebula.js` · `magnetosphere.js` / `aurora.js` / `curtain.js`.

**Wind and flora** (M3): `wind.js` (the one global field — gust cells,
turbulence, terrain coupling, log boundary layer; everything that moves samples
it) · `flora.js` · `meadow.js` (the §9.5 density law; note §11's CPU/GPU pair) ·
`grass.js` · `scatter.js` · `ground-cover.js` · `tree.js` · `blossom.js`.

**Body, camera, input** (`interaction`): `avatar.js` · `figure.js` ·
`traveler.js` · `camera.js` · `collision.js`(galactic) / capsule collision in
`avatar.js` · `input.js` (one layer — desktop and touch never mount together) ·
`touch.js` (§M7) · `hud.js` · `tour.js`.

**World-building & inhabitants:** `landing.js` (the composition solver, §9.7) ·
`settlement.js` → `civilization.js` → `city.js` · `caravan.js` · `festival.js` ·
`ruins.js` · `interior.js` · `troffer.js` · `vehicle.js` + `craft.js` +
`conjure.js` (M5) · `ships.js` · `herds.js` / `wildlife.js` / `megafauna.js` ·
`strange.js` / `wonder.js` (the ≤5% weirdness budget) · `constellations.js` ·
`weather.js` / `precip.js` · `silhouette.js` · `audio.js` + `score.js`.

**Instrumentation inside `src/`:** `bench.js` (`?bench=1`, §5) — it and
`city.js` are the sanctioned clock readers in §14's entropy ratchet.

### Conventions

- ES modules, no transpilation, no TypeScript. Import with explicit `.js`.
- Shaders are template literals inside their module; assemble by interpolation
  and remember §M0 — they are compile-checked **post-assembly**.
- Every file opens with a one-line comment naming what it is and the CLAUDE.md
  clause it answers to. Keep that; it is how the map above stays true.
- New location kind ⇒ extend the deep-link schema in `main.js` in the same
  commit (§2.4). Deep-link keys today: `seed`, `g`, `s`, `p`, `pl`, `moon`,
  `cl`, `room`, `bh`.
- New generation-path entropy ⇒ `rng.js` only, and expect `invariants.js` to
  refuse anything the ratchet has not been taught.

### Feature flags

Read via `PARAM(...)` at module top-level. Two shapes, and the shape *is* the
status: `!== '0'` means **shipped, with an escape hatch** so §2.4's saved URLs
still resolve; `=== '1'` means **built but not shipped** (§7.4).

Shipped (default on, `?x=0` disables): `m1`, `web`, `m2`, `mat`, `sea`,
`ridge`, `m3`, `m4`, `m5`, `m7`, `solve`, `sky`, `shadow`, `aerial`, `dither`.

Default-off (`?x=1` enables): `paint` — the §9.2 light model, the last
unflipped item in RECKONING's ledger — plus debug views `comp`, `fogview`,
`windview`, `bladedbg`, `shdebug`, `noclip`, and the experiments `airmat`,
`aurora`, `built`, `climb`.

Harness/diagnostic params: `bench=1`, `dt=<ms>` (pinned timestep — required for
`repeat.js`), `quad=1`, `tier=<n>`.

---

## 14 · Commands

No package manager. Node for the tools, Playwright as a *global* install.

```bash
python3 -m http.server 8080          # run the universe. This must never stop working.
npm i -g playwright && npx playwright install chromium

node tools/check.js --milestone M<n>   # parse → verify → shadercheck → capture → gate
node tools/check.js --skip capture     # the fast half, no browser
```

`check.js` names the GPU it ran on and says whether the artefacts count: a
software rasteriser gets a warning, real silicon a tick. **Capture output only
gates a milestone when `gateValid` is true** (§M0, `docs/captures/README.md`).

Offline, seconds, no browser — run these before anything else:

| tool | what it decides |
|---|---|
| `invariants.js` | §2 from the bytes on disk: assets, manifests, the entropy **ratchet** (new sites, not legitimacy), the meteor mechanic's continued absence, the reference's SHA-256. `--census` lists every entropy site. |
| `parse.js` | every module the browser loads actually parses (a backtick in a GLSL comment ends the template and the symptom is only "the page did not boot"). |
| `verify.js [suite]` | the maths against an *independent* second derivation — finite differences, eigen-decomposition, Simpson quadrature. Not snapshots. |
| `digest.js` | one SHA-256 over 6,181 samples of the pure generation path. `--json` writes a baseline, `--expect` compares. Per-architecture, see §2.3. |
| `shadercheck.js` / `glslcheck.js` | compile every shader string as passed to `gl.shaderSource`. |

With a browser: `capture.js` (the fixed six-scale route → numbered PNGs + perf
JSON), `gate.js` (the numeric gate clauses — hue families, banding, vacuum
black), `repeat.js` (one URL twice from cold, compared at app frame N, ≥97%
within 2/255), `pixeldiff.js` (CPU reference vs. shader, §7.3), `blind.js`
(shuffles capture sets for §8 scoring), `drawcensus.js` / `perfgrow.js` /
`alphaudit.js` / `tone.js` / `footplant.js` / `glimpse.js` (targeted audits),
`serve.js` (serves the reference so its importmap resolves offline), `boot.js`,
`shot.js`, `contact.js`.

`docs/notes/ci.md` records how each check was made to fail on purpose. A gate
nobody has seen go red is not evidence.

### CI

`.github/workflows/`: `constitution.yml` (invariants) · `verify.yml` (parse +
maths) · `shaders.yml` · `gates.yml` · `determinism.yml` (digest across
Linux/macOS/Windows, all three must agree; three Node versions *report* rather
than gate) · `soak.yml`. CI runs on SwiftShader — it proves the pipeline runs,
it never gates §5.

---

## 15 · Git & session operations

`docs/notes/AGENT-PROTOCOL.md` is operational law in this container and is
short. The rule that matters:

> **Commit and push each increment as it becomes green — per increment, not per
> round or per session.** The working tree has been observed reverting without
> warning; nothing has ever survived except what was pushed. Gate the *index*,
> then commit the index — never gate a working tree other agents are writing to.

Parallelise across modules, never across a file (§7). Agents commit their own
files; ownership is disjoint by construction.

---

## 16 · Current state — read RECKONING before proposing work

`docs/plans/RECKONING.md` is the live debt ledger and **§0 of it gets reported
at the start of every session**. Do not begin M6 until its acts are closed or
explicitly waived in a commit that says so.

As of this writing:

- **M0–M5 built.** M6 (civilisation) has substantial code in `settlement.js`,
  `civilization.js`, `city.js` but is not a passed milestone.
- **Act B is mostly closed** — the M2/M3/M5 flags, the materials, the sea, the
  ridges and the composition solver have been flipped on. **`?paint=1` — the
  §9.2 light model — is still default-off**, and is the last big one.
- **§8's critic has run** (Act A, blind, on an RTX 3060): all-flags **3.00**
  against a gate of ≥4 per axis and ≥4.5 mean. It **FAILS**. The named blocking
  axis was the ground's material; work since has moved it, and any claim about
  the current score needs a fresh blind capture, not this paragraph.
- **M1 gate clause (b) is open**: 3 distinguishable hue families of 4, after
  nine measured iterations. The fourth is blocked behind pricing the frame
  (§5 with the grass on). See RECKONING Act D — it needs a human decision, not
  another attempt.
- **§5 was last measured with the meadow off.** Any performance number quoted
  from before that re-run describes a frame with no grass in it.

Rules that follow from all of this, and that override optimism:

1. Any claim about how something **looks** cites a capture or says plainly that
   it is unverified. "The suite passes" is not evidence about a frame.
2. Before proposing a feature, state its cost against §5 **measured with the
   grass on**. If that number does not exist, get it first.
3. A default-off flag is not shipped. Finishing work behind one includes saying
   what flipping it would take and cost.
