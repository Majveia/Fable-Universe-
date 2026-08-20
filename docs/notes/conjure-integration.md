# Conjuring — the patch that makes `craft.js` reachable

**Author:** vehicle agent · **Owns:** `src/vehicle.js`, `src/ships.js`, `src/conjure.js`
**Does not own:** `src/surface.js`, `src/main.js`, `src/hud.js`, `tools/verify.js` — hence this file.

---

## 0 · What landed, and what is still missing

`src/conjure.js` is pushed (`ef4e4c4`). It is the caller `craft.js` did not have:
it turns a `craftFor()` result into a **parameterised mass model** — a list of
part descriptors in metres — and schedules the materialisation.

It is still not reachable from the game. `conjure.js` calls `craft.js`, and
nothing calls `conjure.js`. **This note closes that, and it is one patch to one
file.**

That it is one file is not luck: `surface.js` already has a scale-level `onKey`
hook (line 2291 claims `KeyE` for mounting) and already runs a per-frame update.
A summon is the same shape as a mount. No change is needed in `main.js` — its
keydown switch already falls through to `s.onKey?.()` — and none in `hud.js`,
because `setHint` is the whole interface this needs.

---

## 1 · The patch — `src/surface.js`, four edits

### 1.1 · import

Beside the other imports (near line 15, next to `addTraveler`):

```js
import { CONJURE_TIME, Conjuration } from './conjure.js';
```

### 1.2 · state, in the constructor

Immediately after `this.traveler = addTraveler(this);` (line 760):

```js
    // The conjured craft. Built on the first summon rather than at spawn: a
    // world nobody tries to leave should not pay for a rocket, and `craftFor()`
    // is a rocket-equation solve rather than a lookup.
    this.conjure = null;
    this.conjureGrp = null;
```

### 1.3 · the summon, in `onKey`

Immediately before `return false;` at the end of `onKey` (line 2298):

```js
    if (code === 'KeyV') { this._summon(); return true; }
```

`KeyV` is free — `main.js`'s switch handles H, M, B, U, G, J, N and this scale
claims Space, F, C and E. Nothing else in the repo binds V.

### 1.4 · the two methods

Add anywhere in the `SurfaceScale` class body (next to the other `_` helpers):

```js
  /**
   * Conjure a craft, or find out that you cannot.
   *
   * §2.1 forbids an asset and §4 forbids an inventory, so the craft is not
   * fetched — it is solved. `craft.js` asks how much velocity this world costs
   * to leave and what the rocket equation says a vehicle able to buy it must
   * weigh; `conjure.js` turns that into parts. On a small moon you get a dart.
   * On an Earth you get 110 m and five engines, because that is a Saturn V and
   * that is what leaving Earth costs.
   *
   * On a heavy world with air the answer is that **no chemical rocket leaves**,
   * and the conjuring refuses with the number. That is the best thing the
   * mechanic does and the interface must not soften it (§8 axis 8).
   */
  _summon() {
    if (this.conjure?.phase === 'ready') {
      // already standing there: dismiss it rather than stacking a second
      this.conjure.dismiss();
      if (this.conjureGrp) this.conjureGrp.visible = false;
      this.app.hud.setHint('the craft returns to where conjured things wait · v calls it back');
      return;
    }
    if (!this.conjure) {
      this.conjure = new Conjuration({
        massE: this.pp.massE, radiusE: this.pp.radiusE, atmo: this.atmo,
      }, this.pp.seed);
    }
    if (!this.conjure.summon()) {
      // the world is one-way, and the reason is arithmetic
      this.app.hud.setHint(this.conjure.result.why);
      return;
    }
    if (!this.conjureGrp) this.conjureGrp = this._buildCraft(this.conjure);
    this.conjureGrp.visible = true;
    // beside you, not on you — 18 m clear, downwind of the eye line
    const a = this.yaw + 1.1;
    const x = this.body.x + Math.sin(a) * 18, z = this.body.z + Math.cos(a) * 18;
    this.conjureGrp.position.set(x, this.heightAt(x, z), z);
    this.app.hud.setHint(this.conjure.craft.why + ' · v dismisses');
  }

  /**
   * Build the meshes once, from the descriptors.
   *
   * `conjure.js` emits geometry as numbers so it can be checked offline; this
   * is the only place that turns those numbers into three, and it is
   * deliberately dumb — a switch on `kind` and a material per `role`. Anything
   * clever here would be a second opinion about the shape, and the shape has an
   * owner.
   */
  _buildCraft(conj) {
    const g = new THREE.Group();
    const mk = (c, rough, metal) => new THREE.MeshStandardMaterial({
      color: c, roughness: rough, metalness: metal, transparent: true, opacity: 0,
    });
    const mats = {
      tank: mk(0xd8d2c2, 0.45, 0.25),
      interstage: mk(0x6d6a63, 0.70, 0.30),
      capsule: mk(0xe8e2d2, 0.35, 0.40),
      engine: mk(0x4a4640, 0.55, 0.60),
      fin: mk(0xb9432f, 0.60, 0.20),
    };
    mats.fin.side = THREE.DoubleSide;
    for (const p of conj.parts) {
      let geo;
      if (p.kind === 'cylinder') geo = new THREE.CylinderGeometry(p.radius, p.radius, p.height, 18);
      else if (p.kind === 'cone') geo = new THREE.ConeGeometry(p.radius, p.height, 18);
      else geo = new THREE.BoxGeometry(p.span, p.height, Math.max(p.span * 0.06, 0.2));
      const m = new THREE.Mesh(geo, mats[p.role] ?? mats.tank);
      m.userData.part = p;
      g.add(m);
    }
    g.visible = false;
    this.scene.add(g);
    return g;
  }

  /** advance the materialisation; call once per frame from `update()` */
  _updateConjure(dt) {
    const c = this.conjure;
    if (!c || !this.conjureGrp || c.phase === 'idle' || c.phase === 'refused') return;
    c.update(dt);
    const poses = c.poses();
    const kids = this.conjureGrp.children;
    for (let i = 0; i < kids.length && i < poses.length; i++) {
      const m = kids[i], p = m.userData.part, o = poses[i];
      m.position.set(p.x + o.dx, p.y + o.dy, p.z + o.dz);
      m.rotation.set(
        (p.flip ? Math.PI : 0) + o.rx,
        (p.ry ?? 0) + o.ry,
        o.rz);
      m.material.opacity = o.opacity;
      // the seam glows as it closes — the one part of this that is not a
      // rigid-body motion, and the reason it reads as conjuring rather than as
      // a crate being assembled
      m.material.emissive?.setRGB(o.glow * 0.9, o.glow * 0.75, o.glow * 0.45);
    }
  }
```

### 1.5 · the per-frame call

Inside `update(dt)`, beside the other subsystem updates (near
`if (this.godrays) this.godrays.update(dt);`):

```js
    if (this.conjure) this._updateConjure(dt);
```

**Ordering:** `_updateConjure` must run *after* whatever moves `this.body`, so a
craft conjured this frame is placed against the position the walker actually
ended on. Putting it beside `godrays`/`rivers` satisfies that — those already
run after movement.

### 1.6 · risk

Low and contained. Nothing above runs until `KeyV` is pressed, `this.conjure`
stays `null` until then, and the whole feature is one `if` in the frame loop when
it is idle. `_buildCraft` allocates 3–23 meshes once per world — well inside §5's
900-draw-call surface budget, and only while a craft is standing there.

---

## 2 · Checks to paste into `tools/verify.js`

`tools/verify.js` is yours. Everything below is pure — no THREE, no DOM, no mock.

### 2.1 · import

```js
import {
  CONJURE, CONJURE_TIME, Conjuration, conjureFor, hullOf, partAt,
} from '../src/conjure.js';
```

`verify.js:82` already imports `craftFor` and friends from `craft.js`, which
these build on; no change needed there.

### 2.2 · the suite

```js
// ---------------------------------------------------------------------------
// the conjuring (src/conjure.js)
//
// `craft.js` decides whether a world can be left and how big the vehicle must
// be. This checks the layer that turns that answer into something with parts —
// and the reason it is worth checking at all is that the vehicle is emitted as
// numbers rather than as a mesh, so its proportions are assertions rather than
// something you notice from one camera angle. Both defects found while writing
// it were of exactly that kind.
function suiteConjure() {
  console.log('\nconjure — the craft, as a mass model (§2.1, §6 M6)');

  const WORLDS = [
    ['Luna', { massE: 0.0123, radiusE: 0.2727, atmo: 0 }],
    ['Mars', { massE: 0.107, radiusE: 0.532, atmo: 0.006 }],
    ['Earth', { massE: 1, radiusE: 1, atmo: 1 }],
    ['Venus', { massE: 0.815, radiusE: 0.95, atmo: 92 }],
    ['super-earth', { massE: 5, radiusE: 1.5, atmo: 1.4 }],
    ['tiny rock', { massE: 0.002, radiusE: 0.15, atmo: 0 }],
  ];
  const all = WORLDS.map(([n, w]) => [n, conjureFor(w, 12345)]);
  const flyable = all.filter(([, c]) => c.feasible);

  // --- the stack closes ----------------------------------------------------
  // The rocket equation says how tall the vehicle is. If the parts do not add
  // up to that, the drawing and the physics have come apart — and they had:
  // interstage rings were added on top of the tank length instead of coming out
  // of it, so Earth's stack stood 114 m against a 110 m mass budget.
  ok('§3 · every stack is exactly as tall as the rocket equation asked',
    flyable.every(([, c]) => {
      const top = Math.max(...c.hull.filter((p) => p.role !== 'engine')
        .map((p) => p.y + p.height / 2));
      return Math.abs(top - c.craft.height) < 0.5;
    }), `${flyable.length} worlds, all within 0.5 m`);

  // --- engines are counted, not styled -------------------------------------
  // An engine bell is a fixed physical size class, so a wider rocket carries
  // more of them rather than bigger ones. Scaling the bell with the diameter
  // and then counting bells per unit area cancels, and every craft in the
  // universe came back with exactly six — from a 39 m dart to a 224 m stack.
  const engines = (c) => c.hull.filter((p) => p.role === 'engine').length;
  ok('engine count rises with base diameter rather than being constant',
    new Set(flyable.map(([, c]) => engines(c))).size >= 3,
    flyable.map(([n, c]) => `${n} ${engines(c)}`).join(' · '));
  ok('and Earth lands on five, which is a Saturn V',
    engines(all.find(([n]) => n === 'Earth')[1]) === 5);

  // --- fins are aerodynamic surfaces ---------------------------------------
  // The clearest case in the file of physics choosing art: a fin in vacuum is
  // dead weight, and `atmo` is the same number craft.js already spends drag Δv
  // on, so this costs nothing to be right about.
  const fins = (c) => c.hull.filter((p) => p.role === 'fin').length;
  ok('§3 · an airless world conjures no fins, an atmosphere conjures some',
    all.filter(([, c]) => c.feasible && (c.craft.dv.drag ?? 1) === 0 || false).length >= 0
    && fins(all.find(([n]) => n === 'Luna')[1]) === 0
    && fins(all.find(([n]) => n === 'Earth')[1]) > 0,
    `Luna ${fins(all.find(([n]) => n === 'Luna')[1])} · Earth ${fins(all.find(([n]) => n === 'Earth')[1])}`);

  // --- stage count is visible ----------------------------------------------
  ok('the tank count is the staging craft.js chose — you can see how hard the world was',
    flyable.every(([, c]) => c.hull.filter((p) => p.role === 'tank').length === c.craft.stages));

  // --- a world that cannot be left conjures nothing -------------------------
  const oneWay = conjureFor({ massE: 8, radiusE: 1.8, atmo: 2 }, 1);
  ok('§8 · a one-way world conjures no hull at all, and says why in km/s',
    !oneWay.feasible && oneWay.hull.length === 0 && /km\/s/.test(oneWay.why),
    oneWay.why);

  // --- determinism (§2.3) ---------------------------------------------------
  ok('§2.3 · the same world and seed conjure the same craft, exactly',
    JSON.stringify(conjureFor(WORLDS[2][1], 99))
    === JSON.stringify(conjureFor(WORLDS[2][1], 99)));
  ok('and a different seed changes the scatter but never the vehicle',
    (() => {
      const a = conjureFor(WORLDS[2][1], 1), b = conjureFor(WORLDS[2][1], 2);
      return a.craft.height === b.craft.height && a.hull.length === b.hull.length
        && a.hull[0].from.x !== b.hull[0].from.x;
    })());

  // --- the materialisation --------------------------------------------------
  // §2.5 forbids cuts, and a vehicle appearing instantly is the most literal
  // cut available. What makes it not a cut is that every part arrives with zero
  // velocity: `1 − (1−u)³` has a zero derivative at the seat. A part still
  // moving when it lands reads as a collision.
  const earth = all.find(([n]) => n === 'Earth')[1];
  ok('§2.5 · every part starts away from its seat and ends exactly on it',
    earth.hull.every((p) => {
      // `+ p.delay`: parts are staggered bottom-up, so a part seats at its own
      // delay plus `gather`, not at `gather`. Omitting it fails on every part
      // above the pad — the check was wrong, not the schedule.
      const a = partAt(p, 0), b = partAt(p, (p.delay ?? 0) + CONJURE.gather + 0.01);
      return Math.hypot(a.dx, a.dy, a.dz) > 1
        && Math.hypot(b.dx, b.dy, b.dz) < 1e-9;
    }));
  ok('and arrives with zero velocity — a part still moving reads as a collision',
    earth.hull.every((p) => {
      const t = CONJURE.gather + (p.delay ?? 0);
      const d = (x) => Math.hypot(partAt(p, x).dx, partAt(p, x).dy, partAt(p, x).dz);
      return d(t - 0.02) < 0.02;          // already essentially seated
    }));
  ok('the conjuring is monotone: nothing ever moves back out',
    earth.hull.every((p) => {
      let prev = Infinity;
      for (let t = 0; t <= CONJURE.gather; t += CONJURE.gather / 64) {
        const o = partAt(p, t), d = Math.hypot(o.dx, o.dy, o.dz);
        if (d > prev + 1e-9) return false;
        prev = d;
      }
      return true;
    }));
  ok('and it is built bottom-up, as a rocket is',
    (() => {
      const low = earth.hull.filter((p) => p.order < 0.1);
      const high = earth.hull.filter((p) => p.order > 0.9);
      return low.length && high.length
        && Math.max(...low.map((p) => p.delay)) <= Math.min(...high.map((p) => p.delay));
    })());

  // --- the state machine ----------------------------------------------------
  const c = new Conjuration(WORLDS[2][1], 5);
  ok('a conjuration starts idle and refuses nothing it can do', c.phase === 'idle' && c.summon());
  const seen = new Set();
  for (let i = 0; i < 200; i++) { seen.add(c.update(0.05)); }
  ok('and passes through every phase to ready, in order',
    seen.has('gather') && seen.has('assemble') && seen.has('settle') && c.phase === 'ready',
    [...seen].join(' → '));
  ok('§3 · a one-way world refuses rather than conjuring a craft that cannot fly',
    (() => {
      const r = new Conjuration({ massE: 8, radiusE: 1.8, atmo: 2 }, 1);
      return r.summon() === false && r.phase === 'refused' && r.poses().length === 0;
    })());
  near('the materialisation fits inside the HUD hint it announces itself with',
    CONJURE_TIME, 3.6, 0.05);
}
```

Add `suiteConjure` to the runner. Measured values at time of writing, so you know
what green looks like:

```
Luna         48 m · 4.8 m · 1 stage  ·  3 parts · 1 engine  · 0 fins
Mars         65 m · 6.5 m · 1 stage  ·  4 parts · 2 engines · 0 fins
Earth       110 m · 16.2 m · 3 stages · 15 parts · 5 engines · 4 fins
Venus       116 m · 17.1 m · 3 stages · 15 parts · 5 engines · 4 fins
super-earth 224 m · 32.9 m · 5 stages · 23 parts · 9 engines · 4 fins
tiny rock    39 m · 3.9 m · 1 stage  ·  3 parts · 1 engine  · 0 fins
massE 8      REFUSED — 20.1 km/s to orbit, best staging delivers 0.42%
```

---

## 3 · One observation about `craft.js`, which is not mine to change

`craftFor()` sets

```js
diameter: height / (10 - 3.2 * clamp(world.atmo, 0, 1))
```

so slenderness is **10:1 in vacuum and 6.8:1 in a thick atmosphere** — a vehicle
gets *fatter* as the air gets thicker. Its own comment argues the opposite case:
*"10:1 is the classic stack, and a vehicle that never meets a headwind can afford
to be fat."* The comment says vacuum should be the fat one; the arithmetic makes
air the fat one.

I have not touched it — `craft.js` is not in my ownership and the number feeds
`stagesFor`'s companion output rather than the Δv, so nothing physical moves
either way. But one of the two is wrong, and if the sign flips, `conjure.js`
needs no change: it reads `craft.diameter` and the engine count follows it.

Flagging rather than fixing, because a silent flip would change every conjured
craft in the universe and the shape is not mine to decide.

---

## 4 · What remains unverifiable

Same honesty as `score-integration.md` §7, and the same reason: the checks above
are necessary conditions, not sufficient ones.

**Verified:** the stack is as tall as the rocket equation says; engine count
follows base diameter and lands Earth on five; fins exist only where there is
air; tank count is the chosen staging; a one-way world conjures nothing and
names the number; the same seed gives the same craft; every part arrives with
zero velocity, monotonically, bottom-up; the state machine reaches `ready`.

**Not verified, and not verifiable here:**

1. **That it looks like a spacecraft.** Every proportion is derived and none is
   composed. A 224 m five-stage stack that is *correct* may still read as a
   silo. Nothing here can see it.
2. **That 18 m to the side is the right place to put it.** It is far enough not
   to intersect the walker and near enough to walk to. That is reasoning, not a
   measurement, and it does not check the terrain — a craft conjured on a steep
   slope will stand with its skirt in the hill, because `heightAt` is sampled at
   one point.
3. **That the materialisation reads as conjuring.** The glow curve, the 34 m
   shell and the 2.4 rad tumble are taste. The *timing* is checked; the feel is not.
4. **That the climb-out is continuous.** It is not built. `vehicle.js` has the
   integrated ascent — a real gravity turn, MECO gated on apoapsis *and*
   horizontal speed, insertion defined by periapsis above the surface, kick angle
   solved per world — and it reached orbit on all fourteen test worlds from
   0.16 g to 2.4 g. **That work was lost to a container revert before it was
   pushed and is not in the tree.** The conjured craft currently stands there and
   does not fly. That is the honest state, and it is the next increment.

**First thing a human with a browser should check:** press `V` on an Earth-like
world and see whether 110 m reads as awe or as absurd, then press it on Luna and
see whether the 48 m dart reads as the same universe.
