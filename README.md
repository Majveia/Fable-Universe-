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

## The five scales

You descend through nested scales — and the transitions are **seamless
hyperzooms**: the camera falls toward what you clicked, the scales swap
mid-motion under a passing snapshot, and you arrive still moving. No cuts,
no fades to black. **Click** selects, **double-click** dives, **Esc**
ascends, **Space** pauses time, **+ / −** bend it, **H** hides the
interface, **drag / scroll** to fly.

### 1 · The cosmic web — a real N-body simulation
262,144 dark-matter particles run through a **particle-mesh N-body code on
your GPU**: every frame their mass is deposited on a 64³ mesh, Poisson's
equation is solved in Fourier space by a Stockham FFT
(`φ_k = −3Ωm δ_k / 2ak²`, 36 shader passes), forces come from differencing
the potential, and the particles are kicked and drifted with the ΛCDM
factors `dp/da = −∇φ/(aE)`, `dx/da = p/(a³E)` — the same leapfrog scheme as
research codes, integrated from the Friedmann equation for a flat ΛCDM
universe (Ωm = 0.315, ΩΛ = 0.685, H₀ = 67.4; Planck 2018). Initial
conditions are **Zel'dovich** displacements at z ≈ 20, so structure grows
from linear theory into genuine self-gravity: filaments stay thin, halos
collapse and virialize. Press `N` to flip between the N-body run and pure
linear theory and see exactly what gravity adds after shell-crossing. `E`
switches comoving ↔ physical coordinates; the HUD reads out true redshift
and cosmic age. (No float-render support? It falls back to the analytic
Zel'dovich field automatically.)

### 2 · Galaxy
About one disk galaxy in six is caught **mid-collision**: the two cores
move as an exact two-body problem while 262,144 disk stars ride along as
test particles in the moving potentials — the restricted three-body scheme
with which Toomre & Toomre first explained the Antennae in 1972, integrated
live on the GPU. Watch the first passage pour a bridge of stars toward the
companion while counter-tails sling outward; nothing is keyframed.

![interacting pair](docs/screenshots/13-collision.png)

Otherwise: a quarter-million stars seeded from the node you clicked: exponential disk,
Hernquist bulge, globular halo, and logarithmic **density-wave arms** traced
by hot young blue stars and Hα/OIII star-forming nebulae — a handful of
them **volumetric**: bounding spheres whose fragments raymarch emission
through 3D noise density, clouds with real depth and parallax — with dust lanes
that genuinely absorb the starlight behind them (reverse-subtract blending).
Rotation is differential — a flat rotation curve, the dark-matter signature —
computed live in the shader. Spirals, barred spirals, ellipticals and
irregulars all occur. Click any star; or click the core.

### 3 · Star system
The star's mass draws its temperature, luminosity and blackbody color from
main-sequence scaling relations. A few percent of systems orbit a **pulsar**
— a neutron-star corpse sweeping lighthouse beams off its misaligned
magnetic poles inside the filament shell of its own supernova, with
second-generation rocky worlds like PSR B1257+12's (the first exoplanets
ever found). Back in the galaxy view, supernovae pop off stochastically —
watch long enough and you'll catch one. (Otherwise: occasionally a red
giant or white dwarf —
and about one system in five is a **close binary**: two suns waltzing about
their barycenter on true Kepler orbits, with every planet circumbinary
beyond the ~3.5-separation stability limit, Kepler-16 style). Planets obey
**Kepler**: periods from `P² = a³/M★`, positions from solving
`M = E − e·sin E` by Newton iteration every frame. Seven species of world —
barren, terrestrial, ocean, ice, lava, gas giant, ice giant — with procedural
simplex-noise surfaces, drifting cloud decks, sun-lit atmospheric rims,
ringed giants with shadowed ringlets, moons, asteroid belts in the widest
orbital gap, and the occasional long-period comet growing its tail near
perihelion. Some temperate worlds are inhabited; look at their night side.
Orbital radii are gently compressed (r^0.62) so worlds stay visible — the
info cards report the true numbers.

And press **J**: the ship runs **relativistic**. The galactic sky obeys
special relativity star by star, computed in the vertex shader — exact
aberration `cosθ' = (cosθ+β)/(1+βcosθ)` crowds the stars ahead, the Doppler
factor `δ = 1/(γ(1−βcosθ'))` walks each star's blackbody color along a
temperature ramp (blue-white ahead, embers behind), intensity beams as δ³
(the headlight effect), and the system's clocks visibly outrun yours by γ —
throttle to 0.985c and watch a year pass in your minute. Every formula is
the real one — and it is now real **transportation**: steer the bow onto
any star ahead and it locks as a destination with a name and a light-year
distance; hold your heading and you close the gap and *arrive*, the system
torn down and rebuilt around the star you aimed at. The galaxy is a place
you can cross.

![relativistic cruise at 0.93c](docs/screenshots/18-relativistic.png)

![interstellar destination locked](docs/screenshots/22-interstellar.png)

And hold **]**: **deep time**. The star's whole life rides a lever — real
scaling tracks (`t_MS = 10·M^−2.5 Gyr`), the slow main-sequence brightening,
the red-giant ascent with its radius honest from the Stefan–Boltzmann law
until it swallows the inner worlds, then a planetary nebula and the long
white-dwarf cooling — or, past 8 M☉, a live supernova that leaves the
pulsar spinning in its own remnant. Every planet answers to the changing
luminosity: the green habitable-zone band migrates outward across the
system, oceans boil off the old garden worlds and their city lights go
out, while frozen moons thaw into late seas. `[` rewinds; the lever
forgives, though the universe would not.

![red giant](docs/screenshots/20-red-giant.png)

![supernova aftermath](docs/screenshots/21-supernova-remnant.png)

### 4 · The surface — set foot on it
Every solid world — **and every moon** — can be landed on from its info
card, and the descent is **continuous**: the same Ashima simplex noise the
orbital shader draws is ported exactly to JavaScript (`src/terrain.js`), so
the ground is a sample of the planet's true height field — the landing
site is chosen metres above the real waterline, and the coast you walk is
the coast you saw from space. Three LOD rings carry the terrain ~14 km to
a horizon that curves with the world's actual radius, and the scale swap
hides inside an atmospheric veil on the way down. Comets near perihelion
hang in the twilight with their tails combed anti-sunward.

![the shore of Korora](docs/screenshots/17-korora-shore.png)

The sky's sun is the system's actual star — correct blackbody color,
correct angular size for this orbit. Walk with WASD (drag to look, Shift to run, `F` to fly), watch
the day turn, and on inhabited worlds wait for dusk: city glow rises over
the ridgeline. Ocean worlds put you on an island shore; lava worlds seep
light through fissures at night. Stand on the moon of a ringed giant and
the parent world hangs vast and tidally fixed overhead, rendered by its
real orbital shader and lit by the local sun — it runs through true phases
as the day passes. The sibling planets wander the sun's arc at their true
elongations. The HUD reports true surface gravity, GM/R². And the sky is not always
kind — press **X** (or just wait) and a meteor streaks down, flashes on
impact, and leaves a bowl-and-rim **crater** baked permanently into the
terrain's height field, ringed with scorched ejecta. Airless worlds arrive
already pockmarked with ancient ones.

![giant in the sky](docs/screenshots/12-moon-giant.png)

![a barren, cratered world at dusk](docs/screenshots/23-barren-craters.png)

Worlds in the liquid-water band grow a **biosphere**: alien flora in a
palette seeded by the world itself, winged skimmers that beat and bank
through boid flocks (flap computed in the vertex shader), tall two-legged
striders grazing the hills with a true antiphase gait, and — after dark on
inhabited worlds — drifting bioluminescent spores. Inhabited worlds keep a
**settlement** near the landing site: towers whose procedurally-drawn
windows light one by one with the dusk, beacon masts blinking at the edge
of town. Your own moons cross the sky with true phases.

![settlement at dusk](docs/screenshots/19-settlement-night.png)

![biosphere](docs/screenshots/15-biosphere.png)

Gas and ice giants have no surface to land on — so **dive the cloud deck**
instead: cruise between infinite procedural stratus layers in the planet's
own palette, steer into cumulus towers, and watch lightning go off below
the deck, as it does on Jupiter.

![cloud deck](docs/screenshots/14-cloud-dive.png)

### 5 · The nucleus — a black hole, computed honestly
Every pixel's ray is integrated through Schwarzschild spacetime
(`d²x/dλ² = −(3/2)h²x/r⁵`, the exact null-geodesic equation, 170 steps per
pixel). The photon ring, the accretion disk arching over and under the
shadow, the doubled disk images, the lensed starfield — none of it is
painted; all of it falls out of the integration. Disk emission is
Doppler-boosted by δ³, so the approaching side burns brighter and bluer,
as the Event Horizon Telescope observed at M87*.

## Design

- **One continuous universe**: the system's night sky is not a texture — it
  is *your* galaxy, all 240k stars projected with 1/d² brightness from your
  star's true seat in the disk (dive near the core and the sky burns);
  behind every galaxy, the actual cosmic-web neighborhood it condensed
  from glimmers at infinity.
- **It sounds like it looks**: a generative WebAudio score with zero
  samples — a beating two-tone void in the web, starlight shimmer in
  galaxies, breathing subs at the horizon of the black hole, and wind
  shaped by each world's actual atmosphere. Risers accompany every
  hyperzoom. `M` mutes.
- **OLED-first**: everything luminous over true black; HDR half-float
  pipeline with selective bloom; hairline typographic HUD that fades away.
- **Deterministic**: every galaxy, star, planet, name and civilization is a
  pure function of `hash(seed, …)`. Universe 1138's Delta Cora is the same
  Delta Cora on every machine, forever.
- **A logbook** (`B`, or the ◈ button): mark any place — a cloud deck, a
  moon, a colliding pair — and warp back to it later. Entries are just the
  same shareable coordinates the URL always carries.
- **A tour mode** (`T`): AEON flies itself — creation plays out, a node is
  chosen, the camera falls through a galaxy to a star, lands somewhere or
  sinks into a cloud deck, visits the black hole, and begins again
  somewhere new. Touch anything to take the controls.

![pulsar](docs/screenshots/16-pulsar.png)
- **Enormous**: ~314k web tracers × any node → a galaxy of 240k clickable
  stars → ~10²⁸ addressable star systems per universe × 2³² universes.
- **Zero dependencies** beyond a vendored Three.js r170; runs from any
  static file server.
- **Adaptive**: resolution scales itself to hold frame rate.

## Files

```
index.html          shell, import map, HUD styling
src/main.js         scale stack, input, adaptive quality
src/transition.js   seamless hyperzoom dives between scales
src/cosmology.js    ΛCDM: growth factor D(a), cosmic age t(a)
src/cosmic.js       the cosmic web (scale 0): N-body + Zel'dovich fallback
src/nbody.js        GPU particle-mesh N-body: FFT Poisson solver, leapfrog
src/galaxy.js       procedural galaxies (scale 1)
src/system.js       Keplerian star systems, binaries (scale 2)
src/planet.js       GLSL worlds: surfaces, clouds, atmospheres, rings, star
src/surface.js      landable planet surfaces (scale 3)
src/blackhole.js    Schwarzschild geodesic raymarcher (scale 4)
src/nebula.js       procedural nebula textures & sprites
src/starfield.js    in-galaxy sky dome
src/post.js         HDR bloom pipeline
src/hud.js          the interface
src/rng.js          deterministic hashing, RNG, name synthesis
```

## Gallery

| | |
|---|---|
| ![young universe](docs/screenshots/1-cosmic-early.png) | ![N-body halos](docs/screenshots/7-cosmic-nbody.png) |
| ![galaxy](docs/screenshots/3-galaxy.png) | ![star system](docs/screenshots/4-system.png) |
| ![ocean world from orbit](docs/screenshots/5-planet.png) | ![binary suns](docs/screenshots/8-binary-suns.png) |
| ![ice world sunset](docs/screenshots/9-surface-ice-sunset.png) | ![ocean world shore](docs/screenshots/10-surface-ocean.png) |

City glow after dark on an inhabited ocean world:

![city night](docs/screenshots/11-surface-city-night.png)

![black hole](docs/screenshots/6-blackhole.png)
