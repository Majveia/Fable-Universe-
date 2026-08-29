# The shipped build — every feature flag on

RECKONING Act F flipped the last three (`paint`, `greeble`, `pilot`). These are
frames of the result.

**None of it is §8 evidence.** SwiftShader, and `tools/clean.js` wrecks the
quality knobs the way `glimpse.js` does — grass density 0.012, one blade
segment, 512 shadow map — so density, colour and performance are all
misrepresented by construction. `gateValid` is false on every file here.

What they answer is binary: is the world there, and does it read with the
chrome deleted (§8 axis 7).

| file | scale | note |
|---|---|---|
| `cosmic-clean.png` | cosmic web | filaments read as thread; four hue families visible |
| `galaxy-clean.png` | galaxy | |
| `orbit-clean.png` | planet | atmosphere limb, terrain, sea |
| `surface-clean.png` | surface | golden hour, §9.2 shipped |
| `*-shipped.png` | | the same places with the HUD, plus their metrics JSON |

## What these frames say that a suite cannot

Three things are visible and worth acting on, and none of them is a score.

**1 · `planet-orbit` still does not reach true black.** RECKONING logged this
before the port and it is unchanged: the field around the world is dark navy,
not `#000`. §2.8 is not ambiguous — vacuum renders to true black — so this is
an open defect with a picture attached now rather than only a measurement.

**2 · The surface reads as one hue family.** §8 axis 6 allows up to three plus
an accent. `surface-clean.png` is yellow-green almost everywhere, and the near
-ground gradient measures 4.89/255 — better than the 1.07 the ledger recorded
before the material work, and still low. How much of that is the wrecked knobs
and how much is the frame is exactly what a real GPU has to separate.

**3 · The composition works.** Low horizon, nothing centred, sun in the golden
-hour band, a hero landmark and a leading line — §9.7's spawn constraints are
doing their job, and that is legible even through a software raster.

## The one that is not a compromise

`../greeble/` holds the station ring before and after. That comparison does not
depend on the quality knobs, because it is about whether a surface has a law at
all — and the measurement beside it (68 draws to 2) holds on any GPU.
