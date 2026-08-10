# The benchmark — what "AAA" means, stated in pixels

**Governing document:** `CLAUDE.md`. This does not supersede it. It supplies the
one thing §8 has always been missing: **a target the rubric can be scored
against.**

---

## 0 · Why this file exists

§8 says the critic must score 0–5 on eight axes and name the pixel region that
lost the point. It has never said *against what*. "≥4 on Light" is not a
specification, and every score in `docs/captures/blind/SCORE.md` was therefore
an absolute judgement made by a scorer with nothing to hold the frame beside.

§8 does name one comparator — `docs/reference/hoshi-no-tani.html`, which is
runnable and capturable — and that remains the executable one. This file records
a second, supplied directly by the human on 2026-08-10 as three reference
frames, and it is more specific than the reference in the places that matter.

**The frames have a source, and it is readable.** They are from
**`Leonxlnx/sakura-realm`** (GitHub, **MIT licence**, Three.js `^0.180.0`,
Vite + pmndrs/postprocessing). That upgrades the benchmark from a look to a
comparable *implementation*, and §10's rule for the reference applies here
unchanged: **port techniques and constants, not files.** Nothing is vendored,
nothing is depended on, and §2.2 (zero runtime dependencies, no build step) and
§4 (no third-party art assets) are untouched — sakura-realm needs Vite and a
postprocessing package, and AEON still must run under `python3 -m http.server`.

Its architecture is close enough to AEON's for the comparison to be sharp:
instanced grass streamed in chunks around the camera on a shared
divergence-free wind field, a procedural sky, raymarched clouds, a procedurally
grown tree, and a quality-tier table. §5 and §6 M3 describe the same shapes.

**When this file and a score disagree, this file is the target.** When this file
and `CLAUDE.md` disagree, `CLAUDE.md` wins — nothing here licenses breaking §2.

---

## 1 · The three frames

### Frame A — daylight meadow

- **Grass fills the lower 40% of the frame** and individual blades are
  *resolvable*: separate edges, separate tips, visible overlap. Waist-height on
  a standing figure. Bright saturated yellow-green, lighter toward the tips,
  darker at the roots where blades occlude each other.
- Scattered **taller seed heads and reeds** stand proud of the sward — a second
  species at a fraction of the density, which is what stops a meadow reading as
  a single crop.
- **Sky is saturated cyan**, deepest at the zenith, paling to near-white at the
  horizon. It is *blue*, not blue-grey.
- **Cumulus with form**: soft edges, a brighter lit top, a marginally cooler
  base, at two or three distinct sizes, thinning to a band near the horizon.
- **A blossom tree** whose branch structure is fully readable as silhouette —
  dark thin limbs against dense pink clusters. No interior shading needed; the
  shape carries it.
- **The far horizon is a row of soft rounded hills in pale haze** — pure shape,
  no detail. This is §M2 act 6 and §9.7's "far ridges as pure silhouette",
  exactly.
- Birds as a few dark specks. Petals in the air.

### Frame B — looking up into the canopy

- **A flat, strongly saturated cyan field with no banding**, occupying most of
  the frame, with blossom hanging into the top.
- This is the hardest 8-bit test in the set: a large smooth area of a single
  strong hue. It is what §6 M1's ordered dither exists for, applied at
  atmospheric scale.

### Frame C — sunset over a field

- **A four-stop vertical wash**: violet-blue at the top, through pale lilac, to
  a warm cream band at the horizon. §9.6's structure, visibly.
- **The sun is blown to cream but is not a clipped white disc** — it has a
  gradient and a bloom, and the sky around it stays coloured.
- **Low cloud bars catching warm light from beneath**, dark-ish above.
- **A yellow field** running to a hazed treeline, with brown seed heads standing
  out of it at low density.
- The near field is **fully saturated**; only the far treeline is hazed.

---

## 2 · The three properties every frame shares

Stated separately because they are what our frames actually fail, and they are
one sentence each:

1. **Saturated.** Nothing in the benchmark is grey. Our surface frames measure
   sat 0.343 and read as pale mint.
2. **Low contrast, and that is not the same as low saturation.** The benchmark
   is soft — no crushed blacks, no blown highlights outside the sun itself — and
   simultaneously *highly* saturated. That combination is the whole look, and it
   is the one a photographic instinct reaches for least.
3. **The haze is far away.** In every frame the near and middle ground are
   clear and coloured; only the horizon band is desaturated. **Our haze reaches
   the player's feet**, which flattens the near field into the same wash as the
   distance and costs §8 axis 3 its third plane, axis 5 its materials, and
   axis 6 its colour, all from one cause.

Property 3 is the highest-value single measurement open in the project. §9.3
writes the fog fraction into the alpha channel; histogram it and compare against
the benchmark, where the near field would histogram at ~0.

---

## 3 · Where we stand against it, as measured

| element | benchmark | ours, measured |
|---|---|---|
| grass | blades resolvable, lower 40% of frame | near ground gradient **1.15/255** — featureless, while the CPU submits 3.5 M blades. Contradiction unresolved; see `docs/captures/blind/SCORE.md` §"Two findings that are not scores" |
| sky | saturated cyan, four-stop | flat pale blue-grey wash |
| clouds | lit top, cooler base, real form | half a dozen soft white blobs |
| horizon | hills in pale haze, pure shape | `?ridge=` now default-on; unscored since the flip |
| sun | blown cream, not clipped | at system scale it was a clipped grey blowout; fixed, unverified |
| saturation | high | sat 0.343, mean 143.9 |
| haze | horizon only | reaches the feet |

---

## 3b · The first thing reading sakura-realm settles

Its blade vertex shader opens:

```glsl
attribute vec4 iPos;    // xyz world base, w height (m)
```

**The blade's exact world position — including Y — arrives as a per-instance
attribute, computed on the CPU.** There is no height texture in that vertex
shader and no GLSL terrain function. Every root is exactly on the ground
because the CPU put it there.

AEON does the opposite. `flora.js`'s `BLADE_VERT` calls `wTerrainH(world)`,
which samples the **wind field's** height bake — 192² over ±1400 m, a 14.66 m
texel. That resolution is right for the wind, whose finest term is a ±58 m
stencil, and wrong for seating a 0.42–1.0 m blade. Measured against the real
ground: **rms 0.11–0.15 m, worst 0.68 m, and 19–29% of roots more than 10 cm
below the surface the terrain is drawn from.**

The reason AEON took the texture route is recorded in `flora.js` and is a real
constraint, not an oversight: one geometry and one instance buffer are *shared*
across every chunk in a ring, because minting a buffer per chunk meant 412
vertex array objects and cost a browser crash at the compile gate. Per-instance
world positions require per-chunk buffers. So this is a genuine architectural
fork with a cost on both sides, and it is the decision to revisit — not a bug
to patch.

The third option neither project takes, and the one §2.7 already blesses one
scale up: **port `ground.heightAt` to GLSL** the way `terrain.js` ports the
orbital field, with the same numeric parity test. That fixes the root height
exactly, at any distance, with no per-chunk buffers.

---

## 4 · What this does not license

The benchmark is a *look*, not a permission. In particular it does not
override:

- **§2.1** — every one of those textures is still generated from `hash(seed, …)`
  on device. No image files.
- **§2.3** — determinism. No `Math.random` in a generation path to make a frame
  prettier.
- **§3 row 5** — "the numbers are never negotiable; the palette always is." The
  benchmark is a palette-and-composition target. If matching it requires
  falsifying a formula, the formula wins and the frame stays imperfect.
- **§5** — budgets. Denser grass is the most obvious way to approach Frame A and
  the most obvious way to blow the frame budget. Add the LOD before the feature.

And one thing it *does* settle: the benchmark frames are a **temperate world in
daylight and at golden hour**. AEON has 10²⁸ systems and §9.1 says there is no
default palette. So this is the target for *that biome family*, and the transfer
that produces it — not the hexes — is what generalises. An ice world matching
Frame A's palette exactly would be a failure of §9.6, not a success.
