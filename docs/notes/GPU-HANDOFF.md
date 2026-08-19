# GPU handoff — what a machine with real silicon needs to settle

**For:** whoever runs this on a real GPU (Cowork, or a human at a laptop).
**From:** a session that has built five merged PRs against this repo and has
seen exactly **one frame** of the result.
**Read time:** five minutes. **Run time:** about an hour, mostly unattended.

You do not need to have followed the work. Everything you need is below.

---

## 1 · Why this exists

`tools/` runs anywhere. Only some of it *means* anything without a GPU, and §M0
is specific: *"Real GPU, not CI SwiftShader."*

The container this project has been developed in has no GPU. It renders through
SwiftShader, a software rasteriser, at roughly one frame per ten seconds on a
world with life on it. That is enough to prove the code *runs*. It is not enough
to prove anything about how it **looks** or what it **costs**.

So there is a clean split, and it is worth stating precisely because the whole
brief rests on it:

| settled without a GPU | needs a GPU |
|---|---|
| does every scale construct without throwing | frame time, p50/p95/p99 |
| do all shaders compile | whether the frame is beautiful |
| how many triangles are in the frame | whether those triangles cost too much |
| is the maths right (713 assertions) | §8's eight axes, scored on real pixels |

Everything in the left column is green. Nothing in the right column has ever
been measured.

---

## 2 · Do this

```bash
git clone https://github.com/Majveia/Fable-Universe-.git
cd Fable-Universe-
git checkout claude/interactive-3d-universe-n6suwb   # the default branch
git pull

npm i -g playwright
npx playwright install chromium      # NOT --with-deps; see §7

node tools/check.js --milestone M1 --extra "slab=1"
```

On **Windows PowerShell**, `&&` is not a statement separator — use `;` or put
each command on its own line.

`tools/check.js` runs everything and prints one verdict. It takes ~1 hour, most
of it the capture set. `docs/GPU-RUN.md` documents each stage in detail if
something goes wrong.

---

## 3 · The three questions only you can answer

This is the actual ask. Everything else is context.

### Q1 — Is the frame within budget on real silicon?

§5's ceiling is **2.2 M triangles and 900 draw calls per frame at surface
scale**, at ≥60 fps p95 on a desktop reference (M-series or RTX 3060 class at
1440p).

Measured here by counting the scene graph — exact numbers, unknown cost:

| tier | triangles | % of §5 | draw calls |
|---|---|---|---|
| low | 1 346 830 | 61% | 512 objects |
| desktop | 1 755 572 | 80% | 512 objects |

Composition on Kerune III in full bloom (`?g=1&s=2309773419&p=2&bloom=1`):

```
                   low        desktop
tree wood        338 400      490 140
ground cover     331 236      331 236
tree foliage     188 820      324 080
blossom           56 255      177 670
everything else  432 119      447 526
```

**What to report:** p50/p95/p99 frame times per tier from `?bench=1`, and
whether the desktop row holds ≥60 fps p95.

**If it goes red,** these are the first numbers to take back, in this order —
they are written into the source as such:

1. `BASE_ROCK` / `BASE_PLANT` in `src/ground-cover.js` — ground cover is a
   stated 15% of the frame and is backdrop, not hero content.
2. `GROVE_BUDGET` and `GROVE_NEAR` in `src/life.js` — the 260 m threshold that
   promotes near grove stands to grown trees.
3. The blossom `cap` in `src/life.js` — 44 000 flowers is 10% of the frame.

### Q2 — Are the three known visual defects real?

I found these in a single frame and have not fixed them. **Confirm or deny each
from a capture**; if one is not real, say so, because it would mean my reading
of that frame was wrong.

**A · Branches arc like fishing rods and dump their foliage on the ground.**
Look at any grown tree at `?g=1&s=2309773419&p=2&bloom=1`. Branches appear to
bend through nearly 180°, so the tips point *down* and the canopy sits in a heap
at the base instead of overhead. Suspect `curvature()` in `src/tree.js` pinned
against its own `maxCurvature` rail.

**B · Foliage is blue while the grass is green.**
Canopy material is `#73a5b9`; ground-cover plants are `#86b36c`. Two systems
derive vegetation colour independently from the same seed and disagree on the
same world. `vegH` spans 0.06–0.62 and the top of that range is blue.

**C · Ground cover goes black facing away from the sun.**
Thousands of near-black specks across the midfield. `PAINT_GLSL` — §9.2's
half-Lambert wrap, which CLAUDE.md calls *"non-negotiable at low sun"* — is
imported by exactly two files: `src/surface.js` (terrain) and `src/figure.js`
(the avatar). Every tree, leaf, rock and plant card is a plain
`MeshStandardMaterial` lit by three's default Lambert, which is precisely the
failure §9.2 predicts.

### Q3 — Have the galaxy and the system regressed?

The repo contains its own before-pictures. Compare against them directly:

| capture in repo | what to shoot | what changed |
|---|---|---|
| `docs/screenshots/3-galaxy.png` | `?seed=20250601&g=1` then enter a galaxy | original has a warm rose halo, visible spiral arms, pink HII knots. Suspect `4802f7a` "Retire the galaxy's unresolved-light halo" removed too much. |
| `docs/screenshots/4-system.png` | any star system | original has a violet nebula lane across the whole frame and a broad halo on the star. Both appear to be gone. |

Both suspect commits were themselves *fixes to reported problems* — a flat tan
smear when flying in, and a blown-white core — so the answer is probably not a
straight revert but a distance-dependent one. **Report which of the two looks
(original vs current) is better at each of: far, mid, and inside.** That
distinction is what nobody has data for.

---

## 4 · §8, scored on real pixels

This has never been run on any of the work. `tools/blind.js` shuffles capture
sets so they can be scored without knowing which is which.

Score 0–5 on each axis. **Gate: ≥4 every axis, ≥4.5 mean.**

1. **Silhouette** — readable subject at three distances?
2. **Light** — a dominant light with direction *and* a secondary bounce or rim?
   Any surface receiving no light information at all?
3. **Depth** — aerial perspective present? Three separable depth planes?
4. **Motion** — at least one element moving with coherent, non-loopable motion?
5. **Materials** — every surface nameable without labels?
6. **Colour** — ≤3 hue families plus one accent; nothing clipping; **in vacuum,
   blacks at true 0; in atmosphere, no pixel below the lift.**
7. **Chrome** — delete the HUD entirely and lose no orientation?
8. **Honesty** — does anything on screen contradict the physics the HUD asserts?

**One sentence per axis naming the specific pixel region that lost the point.**
"Looks good" is a failed review. So is "not AAA."

---

## 5 · What is already green (do not re-litigate)

Save your time for §3. These are settled and reproduce on any machine:

```
parse        113/113 modules · 3 raw shaders linted · 302 import edges
verify       713/713 assertions
boot         19/19 stations (--all) — every world kind constructs, nothing throws
glslcheck    1/1 exported shader pairs compile in a real driver
shadercheck  212 shaders · 0 failed · all six scales
```

`node tools/boot.js --all` is the fast sanity check if you suspect the tree is
broken — it walks every world type in about fifteen minutes and needs no GPU.

---

## 6 · A shortcut for looking

The whole universe is bundled as a single self-contained HTML file — no server,
no checkout, opens on a phone. Ask for the artifact link, or rebuild it:

```
?g=1&s=2309773419&p=2&bloom=1          Kerune III, a world in full flower
?g=1&s=2309773419&p=5                  an ice world
?g=1&s=424242&p=1                      an ocean world
?giants=1&g=1&s=2309773419&p=5&cl=1    a gas giant's cloud deck
?seed=20250601&g=1&bh=1                a black hole
```

Useful overrides: `?bloom=1` forces flowering regardless of the world's season
(68% of an orbit has no flower on it, so without this the station is a coin
toss); `?sun=-8` puts it at night; `?storm=1` brings weather; `?giants=1`
restores gas giants, which are off by default.

---

## 7 · Two traps that have already cost this project time

**Do not use `playwright install --with-deps`.** It puts `apt-get` on the
critical path. One CI run sat inside it for 28 minutes and died on a job
timeout while the identical commit passed elsewhere in seven. Every library
Chromium needs is already present on a modern runner — the only packages
`--with-deps` fetches are CJK and Cyrillic *fonts*, which this project never
renders. And do not wrap it in a `timeout` you intend to retry around: killing
the npx process orphans the `apt-get` it spawned as root, which keeps
`/var/lib/dpkg/lock-frontend` and makes every retry fail instantly.

**A screenshot must stop the render loop first.** `page.screenshot()` against a
running loop competes with it for the same CPU and will time out on a slow
rasteriser. `App.haltAt(n)` stops the loop *inside* the frame loop, so the
canvas holds frame N exactly. `tools/capture.js` already does this; anything
hand-rolled must too. I lost five PRs' worth of confidence to concluding
"SwiftShader cannot render this" after one naive attempt that used the wrong
method.

---

## 8 · What I would most like back

In order of how much it would change what happens next:

1. **One frame of a world in bloom, on real silicon.** Everything in §3 Q2
   resolves in a glance, and three of my aesthetic arguments are currently
   arithmetic that has never met a pixel.
2. **The `?bench=1` numbers per tier.** They decide whether the last three PRs
   were affordable or whether the ground cover and grove thresholds come back
   down.
3. **A yes or no on the galaxy and system regressions**, with the far/mid/inside
   split from §3 Q3.

Anything beyond that is a bonus. These three are the ones blocking real
decisions.
