# the-long-silence — the third reference

**Upstream:** https://github.com/achimala/TheLongSilence
**Commit:** `4845c1df02e71edcb54dd14e902663d51e0434eb` (2026-07-28)
**Licence:** MIT, © 2026 Anshu Chimala — full text in `LICENSE` beside this file.
**Vendored:** `src/` and their README, kept as `UPSTREAM-README.md` (this file is AEON's provenance record, per the `sakura-realm` precedent). `src/ui/` was dropped — its chrome, and
AEON has `hud.js`. `public/`, `tools/`, `package.json`, `vite.config.js` and the
wrangler config were dropped; see below.

---

## Why it is here

`hoshi-no-tani.html` taught AEON its light, its palette method and its print.
`sakura-realm` covered weather, trees, plants and terrain. This one is here for
the half neither reference touches: **vacuum** — hulls, stations, derelicts,
baked worlds seen from orbit, and the surfacing of built things.

That is not a gap AEON chose. §9 is written about an atmosphere, and it is
written well; four of its eight subsections assume air. So every object AEON
has ever put in vacuum — the station ring, the orbital hull, the conjured
craft — was surfaced by whatever was to hand, which was three's stock
`MeshStandardMaterial`. `src/painted.js` opens by naming the general form of
that failure:

> "the ground is a painting and the things standing on it are grey props."

This reference is the counter-example, and it is a good one, because it was
built under most of AEON's constraints and reached AEON's conclusions
independently. Its `greeble.js` header states the doctrine in §9's own voice:

> "a universe whose objects were shaded by five different authors reads as five
> different games. One plate-seam law, one weathering law, one rim term, one
> set of base materials."

That is §9.1's argument for a single palette table, arrived at from the other
end.

## The zero-asset claim, corrected

Its README says *"WebGL2, no assets — every star, world, ring system, nebula
and derelict is generated from a seed and shaded by hand-written GLSL."*

**That is true of the space game and false of the repository.** `public/models/`
carries `interior_kit.glb` and thirteen `.webp` texture maps (`deck_albedo`,
`panel_normal`, `kit_ao`, `terr_crust`, `terr_scree`, `terr_sand`, `terr_rock`
and others). Two modules load them:

| module | what it loads | consequence for AEON |
|---|---|---|
| `src/ship/interiorAssets.js` | `interior_kit.glb` + the deck/panel/soft PBR sets | **does not port.** §2.1, no argument |
| `src/world/Surface.js` | the four `terr_*` maps | **does not port** as written; AEON's `terrain.js` + `material.js` own this anyway |

`public/` is deliberately **not vendored**, so nothing in this tree resolves
those paths. The two modules above are kept, with their loader calls intact,
because a reference that has been quietly edited is worth less than one that
shows exactly where its own rule stops.

**Everything AEON actually ports from here is asset-free.** `src/gfx/greeble.js`
is 2,169 lines and contains no `TextureLoader`, no `GLTFLoader`, no `Math.random`
and no clock read — checked, not assumed. It generates its one bitmap,
a decal atlas, on a canvas at init, which is §2.1's own method.

---

## What does **not** port, and why

Structural differences, not stylistic ones.

| Theirs | AEON | Consequence |
|---|---|---|
| Vite, npm, `package.json` | no build step, vendored `three@r170` (§2.2) | source ports; the module graph does not |
| three `^0.185.1` | three r170 | re-verify anything touching colour management or RT formats (§10) |
| Resonators, Cantos, the Aperture, scanning, drive charge | §4 — "no combat, inventory, quests, XP or economy. **This is a place, not a game loop.**" | the entire `src/game/` layer is read, never ported |
| AgX tonemap in the composite | §9.4 — "Not ACES. Not Reinhard" | rejected; AEON's rational print curve stands |
| Adaptive render scale, 0.62×–2×, live | §11 — "adaptive quality mid-frame. Set once at init. Live changes pump visibly" | rejected as a *live* mechanism |
| PBR throughout — `reflectedLight.directSpecular`, Fresnel, roughness lobes | §9.2 — one `paint()` decides every lit surface | their **detail** ports; their **shading tail** does not |
| Phones refused at the door | §M7 — mobile is a gate, not an opt-out | their tier reasoning is evidence, never a target |
| `Math.random()` in world generation | §2.3 — `src/rng.js` is the only entropy | re-seed every placement |
| assets under `public/` | §2.1 | see above |

## What is worth taking, and where it went

| theirs | AEON | state |
|---|---|---|
| `gfx/greeble.js` — the plate-seam law, weathering, sun-bleach, the `aHull` bake, the `hullLod` band limits, the geometry kit | `src/greeble.js`, feeding `src/painted.js` | **Act 1** |
| the fold rule — speed scaled by distance to the nearest mass, so an approach decelerates itself | `src/pilot.js`, over `system.js`'s existing cruise | **Act 2** |
| `gfx/PostFX.js` — GPU auto-exposure on a **sqrt** mean, not the textbook log mean, because a space frame is 90% black sky and log-of-near-zero blows out every shot | would replace `night.js:exposureFor()`, which says outright it is "a stand-in for §M8's exposure adaptation" | queued |
| `gfx/cubeBake.js` + `world/planetBakeShader.js` — albedo RGB + terrain height A into a cubemap, 1024²/face near and 256² far; no pole pinch, no seam | `planetscale.js` evaluates ~20 octaves of fbm per pixel per frame today | queued; highest §2.7 parity risk |
| `world/Fleet.js` — traffic on analytic paths keyed to the clock, **not** a simulation, so craft are exactly where they belong after a jump or a pause; plus beacons sized from view depth to hold a constant few pixels | deterministic by construction — §2.3 and `clock.js` exactly | queued |

## Provenance gate

`tools/invariants.js` (§10 block, ~line 550) reads SHA-256 records out of
`docs/reference/README.md`, but its table regex only matches `vendor/…` paths,
so neither `sakura-realm` nor this tree is byte-checked the way
`hoshi-no-tani.html` is. The pinned upstream commit above is the record instead:
this tree is a `git clone --depth 1` of it with `src/ui/` and the non-vendored
directories removed, and nothing else edited. Widening that regex is a change to
a gate and belongs in its own commit.
