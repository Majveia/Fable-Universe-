# docs/captures

Output of `node tools/capture.js --milestone M<n>`. One directory per
milestone: numbered PNGs per tier, a `perf-<tier>.json` per tier, and a
`manifest.json` tying every frame back to the deep link that produced it.

This is what §8's critic scores and what §7.7's gate re-shoots.

## What gets committed

**A run's PNGs are committed only when that run is `gateValid`.**

Every perf report carries `device.renderer` and a `gateValid` flag, false when
the run happened on a software rasteriser (SwiftShader, llvmpipe). §M0 asks for
a real GPU for a reason, and it cuts two ways:

- The **numbers** from a software run are worthless, and say so in their own
  output. They are still worth committing: the JSON is small, it records that
  the pipeline ran end to end, and its `gateValid: false` makes it unquotable
  against §5 by anyone reading it later.
- The **frames** are worse than worthless. A software rasteriser does not
  render what the GPU renders, so scoring those frames against §8 would seed
  the critic with fabricated evidence — and it would cost tens of megabytes,
  permanently, in a repo whose second invariant is that the bytes are few.

So a software run contributes its JSON and its manifest. The frames are
produced, looked at, and discarded. A run on real silicon commits everything.

`manifest.json` records `settledBy` per shot: `frames` when the settle
completed its full frame count, `timeout` when the wall-clock escape hatch
fired first. A `timeout` frame may be unsettled and should not be scored.
