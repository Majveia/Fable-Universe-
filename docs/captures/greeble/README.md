# The Long Silence port — captures

**These are SwiftShader frames and they are not §8 evidence.** This container
has no GPU; `gateValid` is false for everything here. §16 rule 1 stands — no
axis is scored off these, and no claim about the frame is made from them.

What they *are* good for is the thing you cannot get from a passing suite:
whether the geometry is there, whether the merge happened, and whether the
surface law is doing anything at all.

## The station ring — `?greeble=1`

| | draws | tris |
|---|---|---|
| `ring-stock.png` | 68 | 1,572 |
| `ring-plated.png` | 2 | 16,132 |
| `ring-plated-close.png` | 2 | 16,132 |

Both are the shipped builders — `_buildRing` and `_buildRingPlated` — called on
a stub through `tools/ringshot.html`, from the same camera under the same
lighting rig. The lights are there for *both*, deliberately: the stock path is
PBR and would photograph as a black silhouette without them, and an A/B about
the lighting rig would not be an A/B about the surface.

The ring needs its own tool for the same reason `ringcensus.js` does — it is
only built once you board it, and boarding has no deep link (§2.4, and the gap
is logged in RECKONING §0).

**What the close-up shows, and what to check on real silicon.** Plate seams run
continuously across part boundaries, which is the merge working — `place()`
bakes each transform into its vertices so the law reads one coordinate system.
Hatches are cut into bays, fasteners sit outboard of the bolted joints, and the
anti-glare coat gives the deck a warm top against a cool side. §8 axis 2's
question — is any surface receiving no light information — reads as no on the
shade faces, which are blue-grey rather than black.

Two things a real GPU has to settle:

1. **The warmth.** The lit stop is very saturated here. That is §9.2's ramp
   against a G-star at 12°, and it may be correct or may want the sun elevation
   the composition solver actually spawns at. Not decidable from a software
   raster.
2. **Speckle in the mid-distance.** Possibly the `gLod` band limits not yet
   biting at that projected size, possibly SwiftShader's `fwidth`. The band
   limits exist precisely to stop sub-pixel detail crawling, so this is the
   first thing to look at on hardware.
