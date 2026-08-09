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

1. ~~**The meadow is not drawing.**~~ **Corrected — it is.** The inference was
   that near-ground detail of 1.15 and 1.07 out of 255 meant no grass. Probing
   the actual page proves otherwise: the meadow builds 4 rings over 412 chunks
   and draws **3,517,993 blades across 162 chunks** (429,619 / 774,883 /
   1,233,091 / 1,080,400 by ring), and that is at *low*-tier density
   multipliers of 0.30/0.28/0.26/0.24.

   So the real finding is worse for the art and better for the code: **3.5 M
   blades are being drawn and the ground still measures as a smooth gradient.**
   §6 M3's own gate asks that grass "reads as *meadow* at the horizon, not as a
   green plane" — it is reading as a plane. That is a materials failure, not an
   absence, and it is the same defect the Materials axis already scored 1 and 2.

   Separately, the 0.21 M triangle count is explained: `M3` is read from
   `PARAM('m3')` at module load, the bench URL carried no flags, so the bench's
   surface station built no meadow at all. That is the `capture.js` bug fixed in
   `922aed6` — the stations had the flags and the bench did not.

   **Settled, by looking rather than by inferring.** The nearest 320×180 px of
   ground in the all-flags frame, magnified 5× with nearest-neighbour so nothing
   could hide in the resampling, is **completely featureless** — a flat sage
   wash with no blade edges, no colour variation, no sub-pixel noise. The
   default frame measures the same (gradient 1.15 vs 1.07 out of 255).

   So the final position is narrower than either earlier claim, and both were
   loose:

   - **In the frame, there is no grass.** Visually confirmed at magnification,
     not inferred from a gradient statistic.
   - **In the CPU's bookkeeping, there are 3.5 M blades across 162 chunks.**
     Measured from the running page.

   Both are facts and they do not agree. The reconciliation is *not* known, and
   guessing it is what the two previous versions of this note did wrong. The
   candidates: instances are issued but the vertex shader collapses them (a zero
   height, or `meadowKeep` rejecting against true distance); or `ring.blades`
   and `ring.drawn` are counters that do not reflect what was submitted; or the
   probe's low tier and the capture's desktop tier diverge. **Naming the cause
   needs a draw-call inspection, not another still.**
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
