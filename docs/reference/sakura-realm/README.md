# sakura-realm — the second reference

**Upstream:** https://github.com/Leonxlnx/sakura-realm
**Commit:** `4dd670e9ccbf7dba6a72462288fd8111021b3006` (2026-08-10)
**Licence:** MIT, © 2026 Leonxlnx — full text in `LICENSE` beside this file.
**Vendored:** `src/` and `CONTRACTS.md`. `src/ui/` and `src/dev/` were dropped;
they are its chrome and its capture harness, and AEON has both already.

---

## Why it is here

`hoshi-no-tani.html` taught AEON its light, its palette method and its print.
This one is here for the half that reference did not cover: **weather, trees,
plants and terrain** — the nature systems, which the human asked for by name.

It is the better reference for that work for one reason above all others. It was
built under the same hard rule AEON's §2.1 states, and its own contract says so
in almost the same words:

> **No external asset downloads.** There is no network fetch of textures or
> models. Every texture is **generated procedurally at runtime** (canvas 2D or a
> GPU pass) … and every mesh is generated in code. This is a hard rule.

So nothing in it needs stripping to be legible to this project, and nothing in
it is a technique that only works because someone shipped a 4K albedo map. Two
independent projects arrived at the same constraint, which is the strongest
evidence available that the constraint is not a handicap.

Its art direction is also close enough to argue with usefully: *"quiet,
cinematic, slightly melancholy … soft light, strong atmospheric perspective,
low-saturation greens, and pink that reads as pale and desaturated, never
candy."* That is recognisably §9's sensibility reached by a different road.

---

## What does **not** port, and why

The differences are structural, not stylistic, and pretending otherwise would
produce a worse universe rather than a better one.

| Theirs | AEON | Consequence |
|---|---|---|
| Vite 6, npm, bare imports | no build step, vendored `three@r170` (§2.2) | source ports; the module graph does not |
| `postprocessing` (pmndrs) + `n8ao` as dependencies | §2.2 forbids both | `post/pipeline.js` cannot be taken as written; its *ideas* can |
| three 0.180 | three r170 | re-verify anything touching colour management or RT formats (§10) |
| **one** place: one tree at the origin, one field, one sky | 10²⁸ worlds from one 32-bit seed | every hardcoded constant has to become a function of the seed |
| `Math.random()` freely | §2.3 — `src/rng.js` is the only entropy | every scatter and every branch has to be re-seeded |
| tuned for one GPU (Radeon 780M) | §5's four-row quality table, three tiers | its budget split is evidence, not a target |

The last two rows are the real work. A sakura tree at the origin can hardcode
its trunk radius; a universe cannot. **What ports is the method that produced
the number, never the number** — which is exactly the ruling §9.6 already made
about the sky's four stops, applied to bark and branching angles.

---

## What to take, in order of what the frames actually need

Judged against real device screenshots of AEON, not against a wish list.

1. **`tree/branches.js` (2 260 lines).** AEON's trees are faceted low-poly
   blobs on a stick — the single worst object in any surface frame. This is
   recursive branch geometry with real taper and bark. Highest value by a wide
   margin.
2. **`world/scatter.js` (3 441 lines).** Ferns, rocks, undergrowth. AEON has
   `life.js`, and the ground between the grass still reads empty.
3. **`weather/precipitation.js` + `atmosfx.js` (4 508 lines).** Rain, and the
   air it falls through. AEON's `weather.js` is thin.
4. **`tree/blossoms.js` + `petals.js`.** Only after 1–3: petals with nothing to
   fall from is a particle system, not a tree.
5. **`sky/clouds.js` (2 871 lines).** Read it, but AEON's `clouds.js` was just
   rewired and is not the weak frame any more.

`core/textures.js` (6 215 lines) is the substrate under all of it and should be
read first — it is their answer to the same question `nebula.js` and
`material.js` answer here.

---

## The rule for anything ported out of this directory

Same as §10's rule for the first reference, and it is not a formality:

**Port techniques and constants, not files.** Nothing under
`docs/reference/sakura-realm/` is ever imported by `src/`. If a module here is
worth having, it is rewritten in AEON's idiom — seeded from `rng.js`, tiered
through `quality.js`, and tested in `tools/verify.js` — and the commit that adds
it says which file it learned from.

The MIT licence permits far more than that. The constraint is AEON's, not
Leonxlnx's: a file copied in whole is a file nobody here can reason about, and
§2.3 alone would break the moment it called `Math.random()`.
