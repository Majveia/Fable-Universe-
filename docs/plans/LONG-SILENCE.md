# The Long Silence — a port audit, and the descent

**Source:** `https://github.com/achimala/TheLongSilence` — Anshu Chimala, **MIT**.
**Provenance:** read at commit-time from a shallow clone; not vendored. Unlike
`docs/reference/hoshi-no-tani.html` (§10) **nothing from this project is copied
into the tree.** What follows is a port of *techniques and constants*, re-derived
against AEON's own physics, its own RNG and its own render path. The MIT notice
is reproduced in `docs/reference/README.md`.

**Why this file exists:** the request was "implement this into our universe."
Read literally that breaks five clauses of §2 and all of §4. This file records
what was rejected and why, so nobody re-proposes the rejected half later.

---

## 0 · What was rejected, and under which clause

The two projects are startlingly aligned in spirit — seeded, hand-written GLSL,
no pre-made celestial content — which is exactly why the conflicts need naming.
Every row here is a **revert if it lands**, not a preference.

| The Long Silence does | AEON clause | Verdict |
|---|---|---|
| Ships 5.8 MB of `public/` — `terr_*.webp` ground maps, `panel_*`/`deck_*`/`soft_*` PBR sets, `interior_kit.glb` | **§2.1** zero runtime assets; **§5** ≤2.5 MB transferred | **Rejected.** Its ground detail is baked by `tools/bake_terrain.py` into four tiling images. AEON's equivalent must stay analytic. |
| Vite + npm + `three ^0.185` | **§2.2** no build step, vendored r170 | **Rejected.** `python3 -m http.server` stays sufficient. |
| AgX tonemap in the composite | **§9.4** — a rational print curve, *"Not ACES. Not Reinhard."* | **Rejected.** Verified AEON has neither AgX nor ACES anywhere today; it stays that way. |
| Single-scattering atmospheric raymarch | **§9.6** — *"A painted gradient, not a scattering integral. Deliberate, and right."* | **Rejected.** `starlight.js`/`scatterlut.js` already derive the sky stops from the star's blackbody. |
| Resonators, Cantos, the Archive, drive charge, seven-instrument objective | **§4** — *"This is a place, not a game loop"* | **Rejected wholesale.** The verbs stay *travel* and *look*. |
| Phones refused at the door with a message | **§M7** is a gate | **Rejected.** Mobile is a budget, not an audience decision. |
| Cubemap planet bake (albedo RGB + height A) | **§2.6**, **§2.7** | **Not now.** It collides with float64 tile-relative vertices and with GLSL↔JS height parity. `quadtree.js` already owns this ground. Revisit only with a parity test in the same commit. |

## 1 · What is being ported, and why it is the right half

The chosen slice is the one the request named: **stand inside the ship, sit down
at the helm, and fly it from orbit into the planet.**

It is also the most AEON-shaped thing in that repository, because it is a
**§2.5 continuity problem**. AEON honours "no cuts, no loading screens" at every
scale change except this one. Today:

- `ascent.js` + `climb.js` fly you **up** — surface → orbit, continuously. Good.
- Nothing flies you **down**. You arrive at a surface by *pushing a scale*.
- `craft.js` derives a vehicle from the world's real Δv budget — and you have
  never been able to stand inside it.

So the port closes an asymmetry that was already there, rather than adding a
new kind of thing.

### 1.1 · What comes across

| From | Idea | Kept because |
|---|---|---|
| `ship/Player.js` | **The bowed seat path.** A straight line from standing to the seat eye-point runs *through the backrest*, and the camera flies through it — a frame or two of grey shell filling the screen. The path is bowed out to the side you approached from and lifted, so the eye swings around the seat the way a body would. | It is a §2.5 cut in miniature, and the fix is three lines of quadratic Bézier. |
| `ship/Player.js` | **Seated look clamped to the arc the canopy covers**, so you cannot end up staring through the back of your own chair. | Chrome-free orientation, §8 axis 7. |
| `ship/Player.js` | **Critically-damped ground follow.** Writing the sampled height straight to the eye transmits every stride-scale ripple into the camera — "a hand-held shot on a trampoline." Legs absorb high frequencies; a damped follow is the cheap stand-in. | AEON's `avatar.js` walks a height field too. |
| `ship/Interior.js` | **The cabin is parented to the ship and modelled in metres**, scaled to world units only at the mount. Local coordinates stay in the range of a few metres and precision is exact. | This *is* §2.6, arrived at independently. |
| `ship/Interior.js` | Lights in a metre-scale cabin sit inside three's distance-attenuation clamp `max(d^decay, 0.01)`; scaling the cabin to kilometre units pins every lamp at 100× and blows the cabin to white. | A trap we would otherwise have hit once. |
| `world/Fleet.js` | **Analytic paths keyed to the clock, not integrated.** Craft are exactly where they belong after a pause, a reload or a jump, with no drift and no wake-up cost. | Restates §2.3 for moving things. Noted here; used by the cabin's traffic-through-the-canopy only. |

### 1.2 · What is *not* borrowed — the physics is ours

The Long Silence's descent is a director-driven shot: `land()` plays a
`SEQUENCES.descent` cutscene over a fixed 2.2 s. That is the correct choice for
a game and the wrong one for AEON, where §3 says *the numbers are never
negotiable*. So the trajectory is re-derived from first principles, and the
result is better than a borrowed one:

**`src/descent.js` is the mirror of `climb.js`, built on Allen–Eggers.**

The 1953 NACA ballistic-entry solution (H. J. Allen & A. J. Eggers) integrates
in closed form for an exponential atmosphere at constant flight-path angle:

```
v(h)  = v_e · exp( −ρ(h)·H / (2·β·sin|γ|) )
a_max = v_e²·sin|γ| / (2·e·H)                   ← independent of β
h_max = H·ln( ρ₀·H / (β·sin|γ|) )
v(h_max) = v_e·e^(−1/2) = 0.6065·v_e
```

Three properties earn it a place here:

1. **Peak deceleration does not depend on the ballistic coefficient at all.**
   β sets the *altitude* the pulse happens at, never its magnitude. That is a
   real and slightly surprising result, and it is exactly the kind of fact §1
   means by "beautiful because it is computed."
2. **It gives `verify.js` a genuine second derivation.** §14 demands the maths
   be checked against an *independent* derivation rather than a snapshot.
   `stepEntry()` integrates numerically; the suite checks it against the closed
   form above. Neither one is the other's baseline.
3. **It reuses the vehicle `climb.js` already solved for.** Same ballistic
   coefficient convention (`betaPerM · height`), same scale-height law
   `H = H_earth·(g_earth/g₀)`, same `craftFor()` result. Ascent and descent
   describe *one* vehicle, and a world that is expensive to leave is expensive
   to enter.

## 2 · The modules

| file | owns | pure? |
|---|---|---|
| `src/descent.js` | the entry trajectory — Allen–Eggers, terminal velocity, the flare, and `captureAltitude()`/`stepEntry()` as the mirror of `releaseAltitude()`/`stepAscent()` | **yes** — no `three`, no clock |
| `src/pilot.js` | the crew controller — walk the deck, station-in-reach, the bowed seat path, the canopy clamp | **yes** |
| `src/cabin.js` | the cabin drawn — cockpit / corridor / habitat, derived from `craftFor()`'s vehicle, zero assets | no |

Wiring lands in `planetscale.js` (the orbit end) and `main.js` (§2.4).

## 3 · §2.4 — the new location

A cabin is a place, so it is a URL in the same commit that creates it:

```
?cab=1     standing in the cabin, at whatever scale carries the craft
?cab=2     seated at the helm
```

Both resolve under an existing `?pl=`/`?s=` chain — a cabin without a world to
be in orbit of is an address with nothing to open onto, the same argument
`?room=` settles in `main.js`.

## 4 · Flag, and what flipping it costs

Built behind **`?cab=1`**, default-off, per §7.4. Flipping the default is a
separate commit and is not proposed here.

**§5 exposure, stated up front and honestly:** the cabin is interior geometry
drawn *instead of* the orbital scene, not on top of it — the planet is a
backdrop through a canopy at that point. The descent adds no geometry at all;
it is arithmetic driving a camera that already exists. The number that does not
exist yet is the cabin's draw-call cost measured with the meadow on at
touchdown, and §16 rule 2 forbids quoting one until it is measured.

## 5 · Order of work

1. `descent.js` + `verify.js --suite descent` — the maths, offline, no browser. ← **this increment**
2. `pilot.js` + its suite — the seat path and the clamps, offline.
3. `cabin.js` — the geometry.
4. Wiring + §2.4 + the flag.

Nothing in step 1 imports `three` or reads a clock, so all of it is decided by
`node tools/verify.js descent` in under a second.
