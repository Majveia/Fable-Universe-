# AEON — a living universe

An interactive, real-time universe that runs in your browser. No build step,
no assets, no network: one integer seed and ~4,000 lines of JavaScript/GLSL
unfold into a cosmos you can fall through — from the large-scale structure of
spacetime down to rain-free ocean worlds and the warped light around a
supermassive black hole.

![the cosmic web](docs/screenshots/2-cosmic-now.png)

## Run it

```bash
# any static file server works; from the repo root:
python3 -m http.server 8080
# then open http://localhost:8080
```

Best experienced full-screen, in the dark, on an OLED display. The background
is true `#000` black.

Optional URL parameters: `?seed=42` (a different universe), `?n=96`
(cosmic-web tracer resolution per axis, default 68 → 314k particles).

Your location is reflected into the URL as you travel (`?g=…&s=…`, `&bh=1`
at the nucleus), so any galaxy, star system or black hole in any universe
is a bookmarkable, shareable address.

## The four scales

You descend through nested scales. **Click** selects, **double-click** dives,
**Esc** ascends, **Space** pauses time, **+ / −** bend it, **H** hides the
interface, **drag / scroll** to fly.

### 1 · The cosmic web — live structure formation
314,000 dark-matter tracers evolve under the **Zel'dovich approximation**,
`x = q + D(a)·ψ(q)`: real cosmological perturbation theory. The growth factor
`D(a)` is integrated at startup from the Friedmann equation for a flat
**ΛCDM** universe (Ωm = 0.315, ΩΛ = 0.685, H₀ = 67.4) — the same cosmology as
Planck 2018. Press play and watch 13.8 Gyr of gravity drain the voids and
gather matter into walls, filaments and cluster nodes. The HUD reads out true
redshift and cosmic age; `E` switches comoving ↔ physical (expanding)
coordinates. The displacement field is evaluated analytically per particle,
per frame, in the vertex shader — and mirrored on the CPU so a click can
gradient-ascend the density field to the nearest peak and dive into the
galaxy that lives there.

### 2 · Galaxy
A quarter-million stars seeded from the node you clicked: exponential disk,
Hernquist bulge, globular halo, and logarithmic **density-wave arms** traced
by hot young blue stars and Hα/OIII star-forming nebulae, with dust lanes
that genuinely absorb the starlight behind them (reverse-subtract blending).
Rotation is differential — a flat rotation curve, the dark-matter signature —
computed live in the shader. Spirals, barred spirals, ellipticals and
irregulars all occur. Click any star; or click the core.

### 3 · Star system
The star's mass draws its temperature, luminosity and blackbody color from
main-sequence scaling relations (occasionally a red giant or white dwarf).
Planets obey **Kepler**: periods from `P² = a³/M★`, positions from solving
`M = E − e·sin E` by Newton iteration every frame. Seven species of world —
barren, terrestrial, ocean, ice, lava, gas giant, ice giant — with procedural
simplex-noise surfaces, drifting cloud decks, sun-lit atmospheric rims,
ringed giants with shadowed ringlets, moons, asteroid belts in the widest
orbital gap, and the occasional long-period comet growing its tail near
perihelion. Some temperate worlds are inhabited; look at their night side.
Orbital radii are gently compressed (r^0.62) so worlds stay visible — the
info cards report the true numbers.

### 4 · The nucleus — a black hole, computed honestly
Every pixel's ray is integrated through Schwarzschild spacetime
(`d²x/dλ² = −(3/2)h²x/r⁵`, the exact null-geodesic equation, 170 steps per
pixel). The photon ring, the accretion disk arching over and under the
shadow, the doubled disk images, the lensed starfield — none of it is
painted; all of it falls out of the integration. Disk emission is
Doppler-boosted by δ³, so the approaching side burns brighter and bluer,
as the Event Horizon Telescope observed at M87*.

## Design

- **OLED-first**: everything luminous over true black; HDR half-float
  pipeline with selective bloom; hairline typographic HUD that fades away.
- **Deterministic**: every galaxy, star, planet, name and civilization is a
  pure function of `hash(seed, …)`. Universe 1138's Delta Cora is the same
  Delta Cora on every machine, forever.
- **Enormous**: ~314k web tracers × any node → a galaxy of 240k clickable
  stars → ~10²⁸ addressable star systems per universe × 2³² universes.
- **Zero dependencies** beyond a vendored Three.js r170; runs from any
  static file server.
- **Adaptive**: resolution scales itself to hold frame rate.

## Files

```
index.html          shell, import map, HUD styling
src/main.js         scale stack, warp transitions, input, adaptive quality
src/cosmology.js    ΛCDM: growth factor D(a), cosmic age t(a)
src/cosmic.js       Zel'dovich structure formation (scale 0)
src/galaxy.js       procedural galaxies (scale 1)
src/system.js       Keplerian star systems (scale 2)
src/planet.js       GLSL worlds: surfaces, clouds, atmospheres, rings, star
src/blackhole.js    Schwarzschild geodesic raymarcher (scale 3)
src/nebula.js       procedural nebula textures & sprites
src/starfield.js    in-galaxy sky dome
src/post.js         HDR bloom pipeline
src/hud.js          the interface
src/rng.js          deterministic hashing, RNG, name synthesis
```

## Gallery

| | |
|---|---|
| ![young universe](docs/screenshots/1-cosmic-early.png) | ![galaxy](docs/screenshots/3-galaxy.png) |
| ![star system](docs/screenshots/4-system.png) | ![ocean world](docs/screenshots/5-planet.png) |

![black hole](docs/screenshots/6-blackhole.png)
