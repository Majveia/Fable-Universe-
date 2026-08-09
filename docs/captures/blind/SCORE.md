# Blind score — CLAUDE.md §8

Sealed 2026-08-05T18:05:37.938Z · scored 2026-08-05 · **`key.json` was not
opened before this sheet was filled in.** Scored from the images alone.

Capture: **RTX 3060 Laptop GPU, Direct3D11, `gateValid: true`.** Real silicon —
the first §8 scoring in this project's history that is about pixels a GPU drew.

§8: score 0–5. **Gate: ≥4 every axis, ≥4.5 mean.**

---

## Method, recorded before the scores

**Five of the six stations are pixel-identical between the two sets.** Measured:
`cosmic-web` 33.0% vs 33.0% of pixels at true black with matching hue peaks;
`galaxy` 58.9/59.0; `star-system` 29.1/29.1; `planet-orbit` 0.0/0.0 with hue
peaks 97.4% vs 97.5%; `black-hole` 0.7/0.7.

That is expected rather than alarming — every flag under test (`paint`, `mat`,
`sea`, `ridge`, `m3`, `m5`, `solve`) is read in `surface.js`. So only
**surface** carries a real comparison, and scoring the other five twice would be
scoring one image twice and calling it agreement.

Axis 4 (motion) is **unscoreable from a still** and is recorded as such rather
than guessed.

---

## surface — A

| axis | score | the region that lost the point |
|---|---|---|
| 1 · Silhouette | **2** | Only the hill edge reads. The huts on the ridge (x≈660, x≈1370) are 10-px dark wedges with no internal structure at any distance. |
| 2 · Light | **2** | A key from upper-left is inferable from the hill gradient, but the hut faces at x≈680 are flat dark with no bounce, rim or transmission — §8's "any surface receiving no light information at all". |
| 3 · Depth | **3** | Aerial perspective is genuinely present; the left ridge desaturates into the sky. But two planes, not three: near meadow and far ridge, nothing between. |
| 4 · Motion | — | Unscoreable from a still. |
| 5 · Materials | **1** | Nothing is nameable. The lower two-thirds is a smooth green-to-olive gradient; measured near-ground gradient magnitude **1.15/255** — no texture at any scale. |
| 6 · Colour | **2** | Two hue families (50° at 32.6%, 210° at 47.8%) against §8's four. Nothing clips; darkest pixel luma 0.158, so §2.8's atmospheric lift holds. |
| 7 · Chrome | **5** | No HUD in frame and orientation survives on the horizon line alone. |
| 8 · Honesty | **2** | The dark polyhedron at centre-top (x≈700–1050, y≈100–330) has no shadow, no ground contact and no scale reference. |

**Mean of seven scoreable axes: 2.43 — FAIL.**

---

## surface — B

| axis | score | the region that lost the point |
|---|---|---|
| 1 · Silhouette | **3** | The colonnade at centre reads at mid distance and the figure on the left ridge at far, but the whole lower half is empty — one of the three distances has no subject. |
| 2 · Light | **2** | The columns take a warm key and the glow at x≈995, y≈505 is real secondary light, but the ground across the entire lower half carries no directional information. |
| 3 · Depth | **3** | Two ridges separate cleanly by haze; the near plane is featureless, so two usable planes again. |
| 4 · Motion | — | Unscoreable from a still. |
| 5 · Materials | **2** | The colonnade reads as cut stone. The ground reads as nothing — measured gradient **1.07/255**, flatter than A. |
| 6 · Colour | **4** | Four hue families (20°, 40°, 110°, 210°), 2% achromatic — §8's count met. Darkest luma 0.174; nothing clips. |
| 7 · Chrome | **5** | As A. |
| 8 · Honesty | **2** | The same unanchored polyhedron, here at x≈1010–1350, y≈190–360, overlapping the hero structure. |

**Mean of seven scoreable axes: 3.00 — FAIL.**

---

## The answer to Act A's question

**B is better than A** — four of seven scoreable axes, and 0.57 of a mean point.
The gap is real and it is mostly colour: four hue families against two.

**Neither passes §8's gate**, and both fail on the same two axes for the same
single reason: **materials (1 and 2) and light (2 and 2)**. The ground occupies
more than half of both frames and carries no texture and no directional light.
That is one defect, not two, and it is the blocking axis.

## Two findings that are not scores

1. **The meadow is not drawing.** Near-ground high-frequency detail is 1.15 and
   1.07 out of 255. M3 instances ~3.3 M blades; that would raise the figure by
   an order of magnitude. Whichever frame carries `m3=1`, the grass did not
   reach the picture.
2. **`planet-orbit` violates §2.8.** Darkest pixel `rgb(13,7,0)`, luma 0.0305,
   and **0.0%** of the frame reaches true black — in *both* sets, so it is not
   flag-related. §2.8: in vacuum the background is true `#000` and blacks are
   never lifted. `star-system` reaches `rgb(0,0,0)` correctly, so this is
   specific to the planet scale. Previously unrecorded.

---

<!-- revealed -->
## The key

**cosmic-web** — A = `RECK-default` · B = `RECK-allflags`

**galaxy** — A = `RECK-default` · B = `RECK-allflags`

**star-system** — A = `RECK-default` · B = `RECK-allflags`

**planet-orbit** — A = `RECK-allflags` · B = `RECK-default`

**surface** — A = `RECK-default` · B = `RECK-allflags`

**black-hole** — A = `RECK-default` · B = `RECK-allflags`

_Sheet was filled in before the reveal._
