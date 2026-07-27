# The worlds — sequencing a rebuild

**Ask:** redo the worlds from scratch so they look like
`docs/reference/hoshi-no-tani.html`, and redo the controls for desktop and
mobile. Miyazaki and Malick for the light; Ghost of Tsushima for the ground;
flow state for the feel.

This document is the order, and the argument for it.

---

## 1 · What "from scratch" correctly means here

For the **ground**, from scratch is right and the constitution already says so.
§M2 replaces the terrain materials wholesale; §M3 replaces the flora entirely.
`surface.js`'s terrain fragment shader is a slope/altitude colour ramp with two
noise octaves and a one-line fog — there is nothing there to preserve.

For **six scales at once**, it is not. §7's ladder exists because an unbounded
rewrite produces thrash and silent regressions, and this session has three
worked examples of exactly that: a bloom that returned four times the light it
was given, a determinism test that photographed the wrong frame twice, and a
quality table that quietly rendered below native resolution. Each was found
because something downstream was measured. A simultaneous rewrite of terrain,
materials, flora, camera and controls has no downstream.

So: the ground gets rebuilt from nothing, in the order below, and each act is
scored before the next begins.

---

## 2 · The order, and why it is not negotiable

| # | Act | Why here |
|---|---|---|
| 1 | **§9.2 `paint()`** — the light model | Every surface goes through one function. Build materials first and they get tuned against a light model that is about to be replaced, then tuned again |
| 2 | **§9.3 aerial perspective** | Fog is what makes a valley read as depth rather than as a texture. It also writes the distance the print needs (§9.4 steps 5, already deferred twice) |
| 3 | **Materials** — four-layer triplanar | Now judgeable, because the light and the air are the reference's |
| 4 | **Ocean** — Gerstner, Beer–Lambert, quantised glitter | Depends on 1–3 for its shore and its haze |
| 5 | **M3 · wind and grass** | The milestone the reference exists to teach, and the single biggest lever on "does it look like that file" |
| 6 | **M4 · the body and the camera** | A camera can only be judged over ground that is finished. Controls land here |
| 7 | **M7 · mobile** | Same controller, different surface |

Acts 1 and 2 are M2's remaining work and are already planned in `M2.md` §16.
Act 5 is M3, act 6 is M4, act 7 is M7.

**The one reordering worth arguing about:** controls before grass. If the
walking is what feels wrong today, act 6 can move to third — the camera rig and
the input layer do not depend on the material work, only on the terrain
collision that already exists. It costs a re-score of the camera against the
finished ground later. Say so and it moves.

---

## 3 · What each act must deliver to count

Not "looks better". §8 scores 0–5 on eight axes and a gate is ≥4 on every one.

| Act | Passes when |
|---|---|
| 1 | A shadowed surface anywhere in frame that has gone achromatic-dark is a failure. Half-Lambert wrap at `ndl·0.62 + 0.46`; three-stop ramp with *visible* band edges; shadows shift hue toward violet and never toward zero |
| 2 | Three separable depth planes in a still. Far ridges as pure silhouette. Fog fraction in alpha, surviving to the print |
| 3 | Every material nameable from a still, at 1.68 m eye height, with no visible tiling inside 40 m in any biome |
| 4 | Depth reads as discrete bands, not a gradient. Sun glitter quantised, not a specular lobe |
| 5 | ≥ 800k blades at ≥ 60 fps desktop; no density step at any ring boundary; a gust crosses frame as a coherent front with a legible leading edge |
| 6 | Input→visible response ≤ 2 frames; camera never clips terrain across the full route; no frame where control fights the camera |
| 7 | Controls ≤ 14% of screen area, entirely within the bottom 30%, never co-present with keyboard hints, fade after 3 s idle |

---

## 4 · What the reference actually teaches, in one list

Read from `docs/reference/hoshi-no-tani.html`, in the order the frame is built:

1. **One palette table**, sRGB hex → linear at load, injected as GLSL literals.
   Sixty names. Zero bytes shipped. `src/starlight.js` already derives the sky
   and air half of it from the star's spectrum.
2. **One light function** every lit surface calls, with a wrapped diffuse and a
   *banded* three-stop hue ramp. The bands are the illustrated look. A
   PBR-trained instinct deletes them; §11 lists that as the archetypal error.
3. **One wind field** sampled by everything that moves — grass, foliage, dust,
   cloth, water, cloud. A 256² render target with an analytic fallback beyond
   its edge, blended on an edge mask.
4. **One density law** for grass across all rings, `B·min(1, (dn/d)^1.5)`, with
   rings switching *tessellation only*. Exponent exactly 1.5, because the
   compiler evaluates it as `x·x·inversesqrt(x)`.
5. **One gait clock** driving head bob, footstep audio and the grass the walker
   parts, so they cannot drift apart.
6. **One print**, already ported (`src/print.js`).

Six singletons. The reference is not beautiful because of what it draws; it is
beautiful because there is exactly one of each of those and everything agrees.

---

## 5 · Controls, since they are called out separately

Today's input is a keyboard handler per scale and a separate touch layer. §M0
already had to stop the two from mounting at once, which is the symptom of the
real problem: there is no controller, there are seven of them.

The rebuild is one input layer with three consumers — orbit (cosmic, galaxy,
system, black hole), walk (surface, first and third person), and fly (planet,
vehicles) — sharing one action map, so a binding is defined once and a gamepad
or a thumbstick is a new *source*, not a new handler.

Desktop: pointer-lock look, WASD, shift to sprint, space to jump, C to switch
person, F to enter or leave a vehicle, H to kill the HUD. Third-person rig is a
spring arm with collision, velocity-proportional look-ahead, dead-zoned
auto-align, horizon held low (§9.7).

Mobile: one thumb region per hand, both inside the bottom 30%, both fading
after 3 s of no touch. Left is a floating stick that appears where the thumb
lands rather than at a fixed rosette; right is look, with a tap-to-interact.
Nothing fixed, nothing more than 14% of the screen, no keyboard hints ever
co-present.

---

## 6 · What this needs from a human

- **The reordering call in §2**, if walking is what feels worst today.
- **A look at act 1 when it lands**, because §9.2's band edges are the one thing
  in this whole plan that a measurement cannot score. They are supposed to be
  visible. If they read as a bug to you, they read as a bug.
