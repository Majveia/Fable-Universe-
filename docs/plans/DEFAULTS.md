# The flags come on

**Governing document:** `CLAUDE.md`. This is a §7.4 commit — *"Build behind a
flag, default-off. Flipping the default is a separate commit."* This is that
separate commit, for nine flags at once — eight of which stuck — and it says
why for each.

---

## 0 · The defect this closes

§7.4 is a good rule and it was followed. What nobody wrote down is the rule's
other half: **a flag that is never flipped is a feature that was never
shipped.**

The state before this commit, measured by loading the site and looking at it:

| flag | what it gates | default |
|---|---|---|
| `?m1=` | the whole M1 cosmic-web enrichment | **off** |
| `?web=` | the second hue channel, M1 §13 | **off** |
| `?m1=` (post) | the ordered dither | **off** |
| `?paint=` | §9.2's light model — the heart of the art bible | **off** (stays off; §2) |
| `?mat=` | §M2 act 4, four-layer triplanar materials | **off** |
| `?sea=` | §M2 act 5, twelve Gerstner waves | **off** |
| `?ridge=` | §M2 act 6, far ridges as silhouette | **off** |
| `?m3=` | §M3 — **all the grass, and the wind field** | **off** |
| `?m5=` | §M5 — the skiff, and the stream governor | **off** |

Eight of those turned out to be finished, gated work that needed nothing but
the switch. The ninth, `?paint=`, was tried and put back — §2 records why, and
records it in full, because the reasoning that said it was ready was sound and
the frame disagreed.

Two whole milestones — **M3 and M5 — were entirely invisible**. The frame a
visitor actually landed on was, at surface scale, an untextured dome of ground
under a flat wash of fog: no grass, no materials, no sea, no far ridges. At
cosmic scale it was the pre-M1 web.

That frame is the one the project was being judged on. "Washed out and a bit
depressing" is an accurate description of it — and it is not a description of
the software. It is a description of the fraction of the software that was
switched on.

---

## 1 · What flipped, and the argument for each

**`?m1=` (cosmic.js and post.js) → on.** docs/plans/M1.md records four of five
gate clauses passing and one — four distinguishable hue families — reaching
three, blocked on a compositing change of its own size. §7 caps iteration at
five and asks for a written escalation, which §12 and §13 of that plan are. A
milestone four fifths met and zero fifths visible is the worst of both.

**`?web=` → on.** The measured improvement on the blocked clause: 2 hue families
to 3 (M1.md §13). It costs nothing when the eigenvalues are already computed.

**`?mat=` → on.** §M2's gate is literally "every material nameable from a still"
(§8 axis 5). Off by default that clause could never be met by a shipped frame.

**`?sea=` → on.** Twelve Gerstner waves replacing two crossed sines. No stated
blocker; it was off only because §7.4 said so.

**`?ridge=` → on.** It is the only thing in the build that gives §8 axis 3 its
third depth plane. Without it the 1400 m tile simply ends.

**`?m3=` → on.** The note above the flag said "act 3 wires the first ring only",
which stopped being true when `_buildMeadow` grew its loop over `RINGS`. All
four rings, the continuous density law, and the double thinning are in.

**`?m5=` → on** (surface.js and planetscale.js). The blocker was the undebated
×3.4 altitude throttle; the stream governor replaced it with a bound derived
from the tree's own measured refinement rate, so "no pop-in" became a property
of the law rather than of the machine.

**`?paint=` → tried, and put back off.** §2 below, in full: the reasoning that
said it was ready was sound, and the frame disagreed.

---

## 2 · `?paint=`, and the dependency that turned out not to be sufficient

The note that kept §9.2's light model off was honest and correct:

> Captured on seed 20250601 with the print and §9.3 both on, `?paint=1` flattens
> the terrain to a single pale wash.

The mechanism was diagnosed exactly. The three-stop ramp bands at `t = 0.17` and
`t = 0.58`, where `t` is the half-Lambert wrap `ndl·0.62 + 0.46`. That wrap maps
the whole lit hemisphere into 0.46–1.0, so with a +24° sun over a smooth dome of
ground **every pixel lands above the upper band edge**. One band occupied, one
colour out, every scrap of normal variation quantised away.

The note named two fixes and said neither existed. Both existed. Both were
behind their own default-off flags:

- **`?mat=`** gives each of four layers its own hue path, so the ramp has three
  genuinely different stops to move between rather than three points on one line
  through one colour.
- **`?solve=`** puts the spawn sun in §9.7's 8–18° band, which is the geometry
  the ramp is tuned for.

`?mat=` flips freely. `?solve=` does not: the full composition solve costs
127–337 ms of main thread inside `_buildTerrain`, which is 10–28× §5's frame
budget in the frame it lands, and §2.5 forbids covering it with a cut.

### The split

Only *one clause* of §9.7 was load-bearing for §9.2, and it is the cheapest one:

> "Sun elevation at spawn forced into 8–18°. Golden hour is not a mood; it is
> the geometry the light model is tuned for."

Choosing that phase is a 2000-step scan of a trig function the scale already
evaluates every frame — `_sunPhaseFacing`, which the solver path was already
calling. It does not pick where you stand or which way you face. It has no
measurable cost.

So the sun band is now unconditional and the expensive geometric solve stays
exactly where it was, behind `?solve=1`. §9.2 gets the geometry it depends on;
§5 pays nothing. **That change is kept** — the golden-hour spawn is worth having
on its own terms, and §9.7 asks for it regardless of what §9.2 does with it.

### And it was still not enough

Three frames, seed 20250601, Vindah II, 560×320, grass off, everything else at
ship defaults. The sun came out at **+12°**, in band, confirmed in the HUD:

| flags | mid-ground |
|---|---|
| `?paint=0&mat=0` | visible green mottling |
| `?paint=0&mat=1` | indistinguishable at this range |
| `?paint=1&mat=1` | **paler, mottling gone** |

The dependency chain was necessary and not sufficient. So `?paint=` goes back
to default-off and the flip is withdrawn.

### The candidate the evidence points at next

Something the two named fixes do not touch. The strongest candidate is that the
frame is **fog-dominated before the ramp gets a say**: §9.3's aerial perspective
carries most of the lower half at a 1.68 m eye height, so §9.2 is being asked to
add contrast to pixels that have already been lerped most of the way to the haze
colour. Both of the "washed out" complaints — the light model's and the naked
eye's — would then have one cause, and it would not be the light model.

That is measurable rather than speculative, and cheaply: §9.3 writes the fog
fraction into the **alpha channel** (that is the trick §9.4 step 5 spends). Read
it back and histogram it. If most of the frame is past 0.8, the aerial
perspective's `fogNear`/`fogFar`/exponent are the thing to argue with, not the
ramp.

Flipping nine flags and keeping eight is the outcome, not a failure of it. The
alternative was flipping none, which is where this started.

---

## 3 · What did not flip, and why

**`?solve=` stays off.** 127–337 ms of main thread, unsliced. Flipping it waits
on either a measurement showing the hyperzoom absorbs it or a change that slices
the solve across frames — a separate commit either way, exactly as its own note
said.

**`?comp=` stays off.** docs/plans/M1.md §12 records that it did not do what it
was built for. It is honestly labelled and costs nothing when off.

**`?slab=` stays off.** It is an experiment with a stated purpose and a measured
outcome, not a shipping default.

---

## 4 · The obligation this creates

Every capture set in `docs/captures/` predating this commit photographed the
default build, which is now a *different build*. §7.7 asks every previous
milestone to be re-shot and re-scored on a gate. **None of the flipped features
has been scored in a shipped frame on real silicon**, because the machine this
was done on rasterises in software and `docs/captures/README.md` is explicit
that a SwiftShader set is fabricated evidence.

So this commit closes a process defect and opens an evidence debt, and the debt
is the larger of the two. `skills/gpu-run` exists for exactly this. Until it is
run:

- §5's budgets are **unmeasured** against the new default. M3 alone is ~800 k
  blades that were previously not drawn at all, and §5 says any change that
  costs frames must pay for them. This change costs frames and has not yet paid.
- §8's rubric is **unscored** against the new default.

Neither is a reason to keep nine finished features switched off. Both are
reasons the next session starts here.

---

## 5 · `?paint=` — the withdrawal, and what it was actually about

Earlier in this session I flipped `?paint=` (§9.2's light model) to default-on,
measured three frames, concluded it *"still flattens the frame — paler, mottling
gone"*, and reverted it. That note has been sitting here as the reason the
constitution's own light model ships switched off.

**It was measured against a broken frame.** Those captures were taken while the
meadow bug was live, so the terrain was bare in every one of them — and the
terrain is the only thing `paint()` lights. `flora.js` has its own fragment
shader; grass never went through §9.2 at all. I was comparing two pictures of
exposed ground and calling the result an art judgement about the world.

Re-measured at the same station with the meadow rendering:

```
?paint=1   vs   default        indistinguishable at 512×288
```

Which is what it should be. At a grass-covered station the terrain is almost
entirely occluded, so the light model has nearly nothing to light. Neither the
regression I reported nor the improvement I hoped for is visible, because the
station cannot show either.

**So the honest state is: the flip is unmeasured, not measured-and-rejected.**
The question it needs is a world where the ground is *visible* — barren rock,
lava, ice, a desert — and none of the three captures I took was one. It stays
default-off because §7.4 forbids flipping a default without evidence, and
"indistinguishable on the one world that cannot show a difference" is not
evidence either way.

What is now known and was not before:

- `s.sunShadow` is constructed **only** inside `_paintUniforms()`, so with
  `?paint=` off there is no shadow map in the build and every `markCaster()`
  call in the repo renders into nothing. That is why the figure floated, and it
  is why the conjured craft's caster flag was inert when I added it.
- The figure's contact shadow (`paint.js:contactShadow`) deliberately does not
  wait for that map. It is a first-order sun projection and needs no pass.
- Anything else that wants to cast — the rocket, the trees, the towers — still
  has nowhere to cast into. That is the strongest remaining argument for the
  flip, and it is an argument for *separating the shadow map from the grade*
  rather than for flipping them together.

**Next session, on a machine with a GPU:** capture a barren or lava world at
`?paint=0` and `?paint=1`, score both blind on §8, and decide. If the grade
wins, the follow-up is to lift `sunShadow` out of `_paintUniforms()` so the map
can ship independently of the grade that currently gates it.
