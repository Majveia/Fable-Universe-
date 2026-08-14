# Sky integration — patches the `graphics` pass needs in files it does not own

Everything below is a change to a file outside the `graphics` agent's ownership
(`src/surface.js`). The modules the patches call are already written, parsed and
in the tree: `src/starfield.js`, `src/clouds.js`, `src/aerial.js`,
`src/starlight.js`.

Each patch was applied to the bytes on the wire (Playwright `page.route`) and
the resulting frame shot, so these are verified text, not proposals. The
executable form lives at
`/tmp/claude-0/-home-user-Fable-Universe-/0e592dad-6658-595a-b644-a3fbb5c157e5/scratchpad/patch.mjs`.

---

## Why — the measurement, including the part that refutes the hypothesis

Two instruments were run against the surface station
(`?seed=20250601&g=443188473&s=2309765500&p=1`).

**1 · A 5184-ray march against the real height field**, with the distances put
through `aerial()`'s CPU port and the scale's own live uniform block:

```
camera y 11.52 m · ground y 9.84 m  (eye height 1.68 m, as specified)
sun elevation 12.49°                (inside §9.7's 8–18° band)
air: near 70 m · far 1700 m · hazeH 570.7 m · mistAmt 1

rays 5184 · sky 50.0% · solid 50.0%
mean fog over solid pixels           0.000
fog 0.0–0.1   50.0% of frame  ###################################
fog 0.1–1.0    0.0% of frame
past 0.5  0.0%   ·   past 0.8  0.0%   ·   past 0.9  0.0%
```

**The "haze reaches the player's feet" hypothesis is refuted at this station.**
Not one solid pixel is past fog 0.1. The geometry forbids it: at a 1.68 m eye
height over near-flat ground, a ray at angle θ below the horizon lands at
`1.68/sin θ`, so everything outside the last ~0.5° of the frame is inside 200 m,
and §9.3's curve is still at 0.134 there.

**2 · The shipped frame, measured per band** (640×360, `?tier=low`):

| band | mean RGB | saturation |
|---|---|---|
| sky zenith | 112,128,152 | 0.267 |
| sky mid | 157,173,198 | 0.204 |
| sky horizon | 165,178,200 | 0.173 |
| ground far | 105,143,145 | 0.282 |
| ground mid | 103,145,142 | 0.288 |
| ground near | 81,115,114 | 0.297 |
| cloud | 184,194,210 | 0.127 |

Near, mid and far ground differ by **0.015 in saturation and 2 in hue**. If haze
were washing the near field, near would be *more* saturated than far. It is not.
There is no aerial perspective in this frame at all — including at the horizon,
where §8 axis 3 needs it.

So the diagnosis is the opposite of the hypothesis, and it has three parts:

1. **The sky is desaturated at source.** `surface.js` builds it from two stops,
   `pp.atmoColor * 0.26` and `pp.atmoColor * 0.5 + (0.04,0.04,0.05)`. Measured
   zenith saturation 0.267 against §9.1's `#4E80B4` at 0.567 — **47% of spec**.
   Nine of §9.1's ten sky stops were never read, though `starlight.js` has been
   computing all of them from the star's spectrum since M2 act 2.
2. **The far ridges get no separation.** `horizon.js` draws a skyline at 3–20 km.
   At `fogFar` 1700 m every one of those pixels is fog = 1.000 — flat haze
   against a flat pale sky, so the hills do not read as hazy, they do not read.
3. **`fogFar` 1700 m is a weather, not a constant.** By the WMO scale that is
   *mist* (1–2 km visibility). The reference is one 2400 m valley that wanted its
   far wall dissolved; AEON inherited the number without the composition that
   justified it.

The latent fourth, already committed: the valley-mist band was measured against
the planet datum rather than the valley floor, so on land below 46 m it became
"mist everywhere past 420 m" — +0.16 fog and a 45% pull toward `#D6DDD4`. That
is `mistBase`, and it is in `src/aerial.js` now.

---

## Patch 1 · imports

```diff
-import { AERIAL_GLSL, aerialParams, airFor } from './aerial.js';
+import { AERIAL_GLSL, aerialParams, airFor, visibilityFor } from './aerial.js';
+import { makeSurfaceSky } from './starfield.js';
+import { makeCumulus } from './clouds.js';
```
```diff
-import { qArr, qInt } from './quality.js';
+import { qArr, qInt, Q } from './quality.js';
```

## Patch 2 · the sky — `_buildSky()`

Replace the `this.sky = new THREE.Mesh(...)` block (the one using `SKY_VERT` /
`SKY_FRAG`) with:

```js
    // §9.6 · the painted four-stop wash, with all ten of §9.1's stops derived
    // from this star's spectrum by the transfer in starlight.js.
    this.skyDome = makeSurfaceSky({
      sunDir: this.uSunDir,
      T: this.ctx.system?.temp ?? 5778,
      atmo: this.atmo,
      sunAng: Math.max(angRad, 0.012),
      cirrus: Math.min((this.pp.clouds ?? 0.3) * 1.1, 0.9),
      tier: Q.name,
    });
    this.sky = this.skyDome.mesh;
    this.scene.add(this.sky);
```

`SKY_VERT` and `SKY_FRAG` then have no callers and can go. `this.zenithColor` /
`this.horizonColor` are still read by the ocean, the ridges and the grass, so
they stay — the sky simply stops being the thing that defines them.

## Patch 3 · the clouds — `_buildClouds()`

Replace the entire body after the early-out with:

```js
    const r = new RNG(hash(pp.seed, 0xc1a0d5));
    this.cumulus = makeCumulus({
      sunDir: this.uSunDir,
      camPos: this._uCamPos || (this._uCamPos = { value: new THREE.Vector3() }),
      seed: pp.seed, rand: () => r.next(), tier: Q.name,
      T: this.ctx.system?.temp ?? 5778,
      // The lifting condensation level. Every cloud in a field shares it —
      // they condensed out of the same air at the same dew point — which is
      // why a real cumulus sky looks ruled along its bases.
      base: 620 + 900 * (1 - Math.min(pp.clouds ?? 0.4, 1)),
      amount: Math.min(Math.max((pp.clouds ?? 0.4) * 1.35, 0.12), 0.95),
      aerialGLSL: AERIAL ? AERIAL_GLSL : '',
      aerialUniforms: AERIAL ? this._aerialUniforms() : {},
    });
    this.scene.add(this.cumulus.mesh);
```

This deletes the two `THREE.Points` layers, their `softDotTexture(64)` sprites
and `this._cloudWind`. `this.clouds` is then never assigned, so the
`if (this.clouds)` block in `update()` becomes dead and can be removed with it.

## Patch 4 · the weather — `_aerialUniforms()`

```diff
-    const p = aerialParams(this.pp, this.atmo, 1);
+    const p = aerialParams(this.pp, this.atmo, 1, {
+      visibility: visibilityFor(this.pp, this.atmo),
+      mistBase: this.seaLevel !== null && this.seaLevel !== undefined
+        ? this.seaLevel : (this.body ? this.heightAt(0, 0) : 0),
+    });
```

and add the new uniform to the block it returns:

```diff
       uAirMistAmt: { value: p.mistAmt },
+      uAirMistBase: { value: p.mistBase },
```

`uAirMistBase` is declared in `AERIAL_GLSL` and defaults to 0 in WebGL when a
host does not set it, so the shader compiles and behaves exactly as before
without this hunk. The hunk is what makes it correct.

## Patch 5 · per frame — `update()`

Immediately before the existing `if (this.clouds) {` block:

```js
    if (this.skyDome || this.cumulus) {
      const elevDeg = (Math.asin(Math.min(Math.max(elev, -1), 1)) * 180) / Math.PI;
      // one wind, one drift, one clock — shared by the deck and the cirrus so
      // the two halves of the sky cannot disagree about the weather (§6 M3)
      const cw = this._cw || this.cloudWind();
      this._cloudDrift = this._cloudDrift || { x: 0, y: 0 };
      this._cloudDrift.x += cw.x * dt;
      this._cloudDrift.y += cw.z * dt;
      if (this.skyDome) {
        this.skyDome.update(elevDeg, {
          cirrusDrift: this._cloudDrift,
          cirrusDir: { x: cw.x, y: cw.z },
        });
      }
      if (this.cumulus) {
        this.cumulus.update(elevDeg, this._cloudDrift);
        if (this._uCamPos) this._uCamPos.value.copy(this.camera.position);
      }
    }
```

`this._cw` is already computed once per frame by the M3 block for the grass, so
the deck's wind costs nothing extra; `cloudWind()` is the fallback for the
pre-M3 path.

---

## What this does not cover

- **Orbit.** `planetscale.js` already has a raymarched cloud slab behind
  `Q.volumetrics`, which is off at `low` and `mobile` — that is why the orbit
  frame has no deck. Turning it on at `mobile` is a `quality.js` change and a
  perf call, not a graphics one.
- **Cloud shadows on the ground.** `clouds.js` exports `CLOUD_FIELD_GLSL`, the
  same coverage field the vertex shader gates puffs on, precisely so a shadow
  can be a second reading of it and therefore always belong to a cloud you can
  point at. Wiring it into the terrain shader is a `surface.js` change.
