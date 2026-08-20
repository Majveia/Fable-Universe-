// The traveler — because a universe this big deserves a witness you can see.
//
// Press C and the camera steps back: there you are. A long indigo coat with a
// bone pauldron on the left shoulder, a strap across to the opposite hip, a
// rust scarf streaming off the same shoulder as the coat, and one cold light
// where a face would be. The camera follows on a spring — drag still orbits,
// WASD is camera-relative, and the figure turns to face wherever it's going.
//
// Near the town plaza a hover-skiff waits, keel-light breathing. Walk up,
// press E, and the world starts moving underneath you: banking turns, a
// bobbing hover over land and sea alike, dust and spray kicked up behind.
// E again steps off wherever you are; the skiff parks and keeps waiting.
//
// ---------------------------------------------------------------------------
// What this file owns, and what `figure.js` owns
//
// The body — its proportion, its kit, its gait, its cloth and its light model —
// is `src/figure.js`, and the reasoning for every one of those decisions lives
// there. What is left here is placement: where the figure stands, which way it
// faces, what the camera does about it, and the skiff.
//
// The split is not cosmetic. Everything in `figure.js` is a pure function of
// the seed and of the walker's state; everything here reaches into `s` and
// touches the scene graph. Keeping them apart is what lets the figure be
// reasoned about — and, when it comes to it, tested — without a renderer.

import * as THREE from 'three';
import { RNG, arand, hash } from './rng.js';
import { softDotTexture } from './nebula.js';
import { HOVER, Hover, MOUNT, Mount, handMomentum } from './vehicle.js';
import { input, jumpHeld } from './input.js';
import { GAIT, gravityOf } from './avatar.js';
import { Figure } from './figure.js';
import { contactShadow, lightFor } from './paint.js';
import { exposureFor, skyLux } from './night.js';
import { SHADOW_GLSL, markCaster } from './shadow.js';

/**
 * The camera's height above the feet while riding, and *only* while riding.
 *
 * This constant used to be 1.8 and used to stand for the walker's eye as well,
 * which was wrong by 12 cm the moment §M4 landed: `GAIT.eye` is 1.68 and
 * `s.body.y` has been `walker.eyeY()` ever since. Every use of it against the
 * body has been replaced with the walker's own feet, which is the only number
 * that cannot drift out of step with the controller. What it still means, and
 * legitimately, is where a rider's eye sits above the skiff's keel.
 */
const RIDE_EYE = 1.8;

/**
 * §6 M5's half of this file. **Now default-on**, matching `surface.js:161`.
 *
 * It disagreed until this commit: `surface.js` flipped the default and this
 * file kept `=== '1'`. Nothing threw, because both halves are individually
 * coherent — the surface asked the hover for its position and got `null`, took
 * the walker branch, and the old inline flight path kept flying the skiff. The
 * symptom was that `?m5=1` and the default build ran *different vehicle
 * physics* while claiming to be the same feature. One flag, one default.
 */
const M5 = new URL(window.location.href).searchParams.get('m5') !== '0';

export function addTraveler(s) {
  const r = new RNG(hash(s.pp.seed, 0x77a7e1e5));

  // ------------------------------------------------------------ avatar ----
  //
  // §9.2's four light colours come from *this world's* star, through
  // `starlight.js`'s transfer, at the sun's own elevation — so the coat is lit
  // by the sun it is standing under rather than by a constant. `_syncLight()`
  // below re-derives them as the day turns.
  //
  // The shadow sampler is passed only if this build has one. `?paint=` is
  // default-off and `s.sunShadow` therefore usually does not exist; handing the
  // figure a `null` there compiles a shader with `shadow = 1.0` folded in as a
  // literal rather than one that samples a map nobody rendered.
  const starT = s.ctx.system?.temp ?? 5778;
  const sunElev = () => (Math.asin(Math.min(Math.max(s.uSunDir.value.y, -1), 1)) * 180) / Math.PI;
  const figure = new Figure({
    seed: s.pp.seed,
    sunDir: s.uSunDir,
    light: lightFor(starT, Math.max(sunElev(), 0.5)),
    shadowGLSL: s.sunShadow ? SHADOW_GLSL : null,
    shadowUniforms: s.sunShadow ? s.sunShadow.uniforms : null,
  });

  const avatar = new THREE.Group();
  avatar.add(figure.mesh);
  // The lantern hangs from the right hand and is placed from that bone every
  // frame, so it swings with the arm the gait is already swinging. A lantern
  // pinned to the group is a lantern floating beside a person.
  const lantern = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDotTexture(32), color: new THREE.Color(1.3, 0.85, 0.45),
    transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  lantern.scale.setScalar(1.6);
  avatar.add(lantern);
  avatar.visible = false;
  // §9.2's shadow is opt-in by layer: an occluder has to be named, and a person
  // standing in a meadow at a 13° sun is the most legible occluder in the frame.
  markCaster(figure.mesh);
  s.scene.add(avatar);

  const handPos = new THREE.Vector3();
  let lightT = 1e9;      // seconds since the light table was last re-derived

  // ------------------------------------------------------- contact shadow ----
  //
  // The figure floated, and `figure.js:163` says why in its own words: "there is
  // no shadow map in the default build." There is not — `surface.js` builds
  // `sunShadow` only inside `_paintUniforms()`, which runs only under `?paint=1`,
  // so `markCaster()` has nothing to render into and every occluder in the frame
  // casts nothing. §8 axis 1 asks for a readable subject at three distances and
  // the cheapest thing that separates a body from the ground it is standing on
  // is the dark shape at its feet.
  //
  // This is not the shadow map, and it is not waiting for one. It is the
  // first-order projection of a body onto locally flat ground, which at a
  // golden-hour sun is an ellipse of length `h / tan(elev)` pointing directly
  // away from the star — 7.4 m at §9.7's 13°, from a 1.7 m body. Every term is
  // the real geometry, so it cannot contradict the light (§8 axis 8): it
  // lengthens as the sun sets, swings as the sun moves, and detaches when you
  // leave the ground.
  //
  // Multiply blending rather than a dark quad, because §9.2 is explicit that
  // shadows change hue and do not go black. The multiplier bottoms out at
  // (0.42, 0.47, 0.62) — never zero, and bluest in blue, so a shadow lands
  // violet on any ground colour instead of grey.
  const SHADOW_TINT = new THREE.Vector3(0.42, 0.47, 0.62);
  const shadowGeo = new THREE.PlaneGeometry(1, 1, 1, 1);
  shadowGeo.rotateX(-Math.PI / 2);      // lie in the ground plane, long axis +z
  const contact = new THREE.Mesh(shadowGeo, new THREE.ShaderMaterial({
    uniforms: {
      uTint: { value: SHADOW_TINT },
      uAmt: { value: 0 },
    },
    vertexShader: /* glsl */`
      varying vec2 vUvC;
      void main() {
        vUvC = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */`
      precision mediump float;
      uniform vec3 uTint;
      uniform float uAmt;
      varying vec2 vUvC;
      void main() {
        vec2 p = vUvC * 2.0 - 1.0;
        // The penumbra widens with distance from the contact point: the near end
        // is where the body touches the ground and is nearly hard, the far end is
        // the tip of a long shadow and is nearly gone. One term, and it is most
        // of what stops this reading as a decal.
        float along = clamp(p.y * 0.5 + 0.5, 0.0, 1.0);
        float soft = mix(0.34, 0.92, along);
        float r = length(vec2(p.x, p.y * 0.92));
        float a = (1.0 - smoothstep(1.0 - soft, 1.0, r)) * uAmt;
        if (a < 0.004) discard;
        gl_FragColor = vec4(mix(vec3(1.0), uTint, a), 1.0);
      }
    `,
    blending: THREE.MultiplyBlending,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
  }));
  contact.frustumCulled = false;
  contact.renderOrder = 1;
  contact.visible = false;
  s.scene.add(contact);

  // ------------------------------------------------------------- skiff ----
  const skiff = new THREE.Group();
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xd8d2c2, roughness: 0.5, metalness: 0.15 });
  const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 2.2, 6, 10), hullMat);
  hull.rotation.x = Math.PI / 2;
  hull.scale.set(1.2, 1, 0.42);
  hull.position.y = 0.4;
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xcac2ae, roughness: 0.55, metalness: 0.2 });
  const wingL = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.1, 1.0), wingMat);
  wingL.position.set(-1.45, 0.42, 0.25);
  wingL.rotation.set(0.06, 0.45, 0);
  const wingR = wingL.clone();
  wingR.position.x = 1.45;
  wingR.rotation.set(0.06, -0.45, 0);
  const fin = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.5),
    new THREE.MeshStandardMaterial({
      color: 0x8fb6c9, roughness: 0.2, metalness: 0.3,
      transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    }));
  fin.position.set(0, 0.85, -0.7);
  fin.rotation.x = -0.35;
  const keel = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 2.6),
    new THREE.MeshBasicMaterial({
      color: new THREE.Color(0.35, 0.8, 1.1), transparent: true, opacity: 0.4,
      blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    }));
  keel.rotation.x = Math.PI / 2;
  keel.position.y = 0.06;
  const engine = new THREE.Sprite(new THREE.SpriteMaterial({
    map: softDotTexture(32), color: new THREE.Color(0.5, 0.9, 1.3),
    transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
  engine.position.set(0, 0.42, 1.6);
  engine.scale.setScalar(1.1);
  skiff.add(hull, wingL, wingR, fin, keel, engine);
  s.scene.add(skiff);

  // parked at the town dock, or beside the landing if nobody lives here
  const dock = s.settlement?.dock
    ?? { x: s.spawn.x + 26, z: s.spawn.z + 14, y: s.heightAt(s.spawn.x + 26, s.spawn.z + 14) };
  const ground = (x, z) => Math.max(s.heightAt(x, z), s.seaLevel === null ? -1e9 : s.seaLevel);
  skiff.position.set(dock.x, ground(dock.x, dock.z) + 0.55, dock.z);
  skiff.rotation.y = r.float(0, 6.28);

  // ----------------------------------------------------------- the wake ----
  const NW = 26;
  const wakeGeo = new THREE.BufferGeometry();
  const wPos = new Float32Array(NW * 3);
  const wAge = new Float32Array(NW).fill(9);
  wakeGeo.setAttribute('position', new THREE.BufferAttribute(wPos, 3));
  const wake = new THREE.Points(wakeGeo, new THREE.PointsMaterial({
    map: softDotTexture(32), color: 0xbfc8cc, size: 2.2,
    transparent: true, opacity: 0.22, depthWrite: false, sizeAttenuation: true,
  }));
  wake.visible = false;
  s.scene.add(wake);
  let wi = 0, wakeT = 0;

  // §6 M5 — the dynamics the suite tests, rather than a second copy of them
  // written inline. `ride` is the skiff's own keel height, not the walker's;
  // gravity is the world's, so a moon hop hangs the way a moon hop should.
  const hover = M5 ? new Hover({
    groundAt: ground,
    gravity: gravityOf(s.pp),
    ride: 3.4,
  }) : null;
  const mount = M5 ? new Mount(MOUNT.dur) : null;

  const T = {
    third: false,
    riding: false,
    avatar, skiff, figure,
    hover, mount,
    _camSet: false,
    _face: skiff.rotation.y,
    _bank: 0,
    _t: 0,

    toggleView() {
      T.third = !T.third;
      // Under §M5 the view swap is a handover like any other: the eye is where
      // it is, and the arm grows or retracts from there rather than cutting.
      if (!M5) T._camSet = false;
      return T.third;
    },

    /**
     * E: mount if the skiff is close; step off if riding.
     *
     * §2.5 — "if a feature can't be entered continuously, it isn't finished."
     * The old path teleports the body onto the deck, and has since it was
     * written; nobody noticed because the camera is behind the walker and the
     * jump is short. Over forty kilometres it stops going unnoticed.
     *
     * So under §M5 both directions are a spring plus a momentum handover, and
     * they are the same code because they are the same physics: whatever was
     * moving keeps moving.
     */
    tryMount() {
      if (T.riding) {
        T.riding = false;
        if (M5) {
          const eye = { x: s.camera.position.x, y: s.camera.position.y, z: s.camera.position.z };
          // step off where the craft is, carrying its velocity into the body
          const w = s.walker;
          if (w) {
            w.pos.x = hover.pos.x;
            w.pos.z = hover.pos.z;
            w.pos.y = ground(hover.pos.x, hover.pos.z);
            handMomentum(hover.vel, w.vel);
            w.vel.y = 0;          // the skiff's bob is not a jump
            w.grounded = true;
          }
          s.body.set(hover.pos.x, (w ? w.eyeY() : ground(hover.pos.x, hover.pos.z) + RIDE_EYE), hover.pos.z);
          s.vel.set(hover.vel.x, 0, hover.vel.z);
          // the craft settles where it was left, keel down
          skiff.position.set(hover.pos.x, ground(hover.pos.x, hover.pos.z) + 0.55, hover.pos.z);
          skiff.rotation.z = 0;
          wake.visible = false;
          mount.begin(eye, { x: s.body.x, y: s.body.y, z: s.body.z }, s.vel);
          return 'dismounted';
        }
        skiff.position.y = ground(skiff.position.x, skiff.position.z) + 0.55;
        skiff.rotation.z = 0;
        wake.visible = false;
        return 'dismounted';
      }
      const d = Math.hypot(s.body.x - skiff.position.x, s.body.z - skiff.position.z);
      if (d < MOUNT.reach) {
        if (M5) {
          const eye = { x: s.camera.position.x, y: s.camera.position.y, z: s.camera.position.z };
          T.riding = true;
          T.third = true;
          s.fly = false;
          hover.place(skiff.position.x, skiff.position.z, T._face);
          // and the walker's momentum goes with you — running at the skiff and
          // boarding should not stop you dead
          if (s.walker) handMomentum(s.walker.vel, hover.vel);
          s.body.set(hover.pos.x, hover.pos.y + RIDE_EYE, hover.pos.z);
          s.vel.set(hover.vel.x, 0, hover.vel.z);
          mount.begin(eye, { x: s.body.x, y: s.body.y, z: s.body.z }, s.vel);
          T._camSet = true;    // the spring owns the gap now, not a snap
          return 'mounted';
        }
        T.riding = true;
        T.third = true;
        T._camSet = false;
        s.fly = false;
        s.body.x = skiff.position.x;
        s.body.z = skiff.position.z;
        s.body.y = skiff.position.y + RIDE_EYE;
        return 'mounted';
      }
      return null;
    },

    /** the skiff has the helm: banking hover flight, camera-relative */
    drive(dt) {
      if (M5) return T._driveM5(dt);
      const boost = s.keys.has('ShiftLeft') || s.keys.has('ShiftRight');
      const speed = boost ? 190 : 85;
      const fwd = new THREE.Vector3(-Math.sin(s.yaw), 0, -Math.cos(s.yaw));
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const acc = new THREE.Vector3();
      if (s.keys.has('KeyW') || s.keys.has('ArrowUp')) acc.add(fwd);
      if (s.keys.has('KeyS') || s.keys.has('ArrowDown')) acc.sub(fwd);
      if (s.keys.has('KeyD') || s.keys.has('ArrowRight')) acc.add(right);
      if (s.keys.has('KeyA') || s.keys.has('ArrowLeft')) acc.sub(right);
      if (acc.lengthSq() > 0) acc.normalize().multiplyScalar(speed);
      s.vel.lerp(acc, 1 - Math.exp(-2.2 * dt));
      s.body.addScaledVector(s.vel, dt);

      // hover: ride the terrain and the sea at a steady keel height
      const g = ground(s.body.x, s.body.z);
      const hoverY = g + 3.4 + Math.sin(T._t * 2.1) * 0.24;
      s.body.y += (hoverY + RIDE_EYE - s.body.y) * (1 - Math.exp(-5 * dt));

      // the skiff itself: under the body, nose into the velocity, banking
      skiff.position.set(s.body.x, s.body.y - RIDE_EYE, s.body.z);
      const sp = Math.hypot(s.vel.x, s.vel.z);
      if (sp > 2) {
        const want = Math.atan2(-s.vel.x, -s.vel.z);
        let dy = want - T._face;
        dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        T._face += dy * Math.min(dt * 5, 1);
        T._bank += (dy * -1.1 - T._bank) * Math.min(dt * 4, 1);
      } else {
        T._bank *= Math.exp(-3 * dt);
      }
      skiff.rotation.set(0, T._face, Math.min(Math.max(T._bank, -0.55), 0.55));
      engine.material.opacity = 0.3 + Math.min(sp / 190, 1) * 0.7;
      keel.material.opacity = 0.35 + 0.2 * Math.sin(T._t * 3.1);

      // wake: dust over land, spray over water, only when moving low
      wakeT -= dt;
      const overSea = s.seaLevel !== null && s.heightAt(s.body.x, s.body.z) < s.seaLevel;
      if (sp > 18 && wakeT <= 0) {
        wakeT = 0.05;
        wPos[wi * 3] = s.body.x - s.vel.x / sp * 2.4 + (arand() - 0.5) * 1.4;
        wPos[wi * 3 + 1] = g + 0.5;
        wPos[wi * 3 + 2] = s.body.z - s.vel.z / sp * 2.4 + (arand() - 0.5) * 1.4;
        wAge[wi] = 0;
        wi = (wi + 1) % NW;
      }
      for (let i = 0; i < NW; i++) {
        if (wAge[i] < 2) { wAge[i] += dt; wPos[i * 3 + 1] += dt * 1.6; }
      }
      wakeGeo.attributes.position.needsUpdate = true;
      wake.visible = sp > 18;
      wake.material.color.setHex(overSea ? 0xd8ecf2 : 0xcabfa8);
    },

    /**
     * Dust over land, spray over water — and both drift *downwind* (§6 M5).
     *
     * The old wake rises straight up at 1.6 m/s on `arand()`, which is a
     * plume in still air on a world that has weather. M3 act 6 established
     * `s.sampleWind(x, z, height)` as the one reading every consumer agrees
     * on — the grass, the clouds, the ocean and the god rays all take it — and
     * a craft's wake joins that list rather than growing a fourth wind.
     *
     * It is sampled at the particle's own height, so the boundary layer does
     * the work: what is kicked up near the ground barely moves, and what gets
     * carried up rides the gust that is passing. That is also the cheapest
     * possible demonstration that the field is shared, because over water the
     * spray and the waves lean the same way.
     */
    _wake(dt, sp) {
      wakeT -= dt;
      const overSea = s.seaLevel !== null
        && s.heightAt(hover.pos.x, hover.pos.z) < s.seaLevel;
      const g = ground(hover.pos.x, hover.pos.z);
      if (sp > 18 && wakeT <= 0 && !hover.airborne) {
        wakeT = 0.05;
        const inv = 1 / Math.max(sp, 1e-3);
        wPos[wi * 3] = hover.pos.x - hover.vel.x * inv * 2.4 + (arand() - 0.5) * 1.4;
        wPos[wi * 3 + 1] = g + 0.5;
        wPos[wi * 3 + 2] = hover.pos.z - hover.vel.z * inv * 2.4 + (arand() - 0.5) * 1.4;
        wAge[wi] = 0;
        wi = (wi + 1) % NW;
      }
      for (let i = 0; i < NW; i++) {
        if (wAge[i] >= 2) continue;
        wAge[i] += dt;
        const h = Math.max(wPos[i * 3 + 1] - g, 0.05);
        const w = s.sampleWind
          ? s.sampleWind(wPos[i * 3], wPos[i * 3 + 2], h)
          : { x: 0, z: 0 };
        // spray is heavier than dust and is thrown rather than lifted, so it
        // rises slower and settles sooner
        const lift = overSea ? 1.1 : 1.6;
        wPos[i * 3] += w.x * dt;
        wPos[i * 3 + 1] += lift * dt;
        wPos[i * 3 + 2] += w.z * dt;
      }
      wakeGeo.attributes.position.needsUpdate = true;
      wake.visible = sp > 18;
      wake.material.color.setHex(overSea ? 0xd8ecf2 : 0xcabfa8);
    },

    /**
     * §M5's helm. The dynamics live in `vehicle.js` and are exercised in Node
     * by `tools/verify.js`; what is left here is the mesh, the wake and the
     * bridge back to `s.body`/`s.vel`, which twenty other things read.
     *
     * The craft takes the same analog axis the walker does, so switching
     * between them cannot change what the stick means — and `Space` is the
     * short hop for the same reason it is the jump: one thing a rider already
     * knows, transferred rather than relearned.
     */
    _driveM5(dt) {
      const boost = input.down('sprint');
      // The surface tile is a fixed mesh with nothing to stream, so there is
      // nothing here to outrun and no governor — that is planet scale's
      // problem (§6 M5, and `docs/plans/M5.md` §2). The ceiling here is the
      // tile: 1400 m wide, so 190 m/s crosses it in seven seconds.
      const top = boost ? 190 : 85;
      hover.step(dt, { move: input.move, hop: jumpHeld() }, s.rig ? s.rig.yaw : s.yaw, top);

      T._face = hover.face;
      T._bank = hover.bank;
      s.body.set(hover.pos.x, hover.pos.y + RIDE_EYE, hover.pos.z);
      s.vel.set(hover.vel.x, hover.vel.y, hover.vel.z);

      skiff.position.set(hover.pos.x, hover.pos.y, hover.pos.z);
      skiff.rotation.set(0, hover.face, hover.bank);

      const sp = hover.speed();
      engine.material.opacity = 0.3 + Math.min(sp / 190, 1) * 0.7;
      keel.material.opacity = 0.35 + 0.2 * Math.sin(hover.t * 3.1)
        // the skirt flares when it is carrying you rather than resting
        + (hover.airborne ? 0.25 : 0);
      // `_t` is advanced by `place()`, which also runs every frame — bumping it
      // here too would run the figure's clock at twice speed while riding
      T._wake(dt, sp);
    },

    /**
     * Stand the figure up for this frame: where it is, which way it faces, and
     * everything `figure.js` needs in order to know what it is doing.
     *
     * Two things here are worth stating rather than reading off:
     *
     * **The feet come from the walker, never from `s.body`.** `s.body.y` is the
     * *eye*, and the eye is `walker.pos.y + GAIT.eye + walker.bobY` — so
     * subtracting a constant from it puts the boots wherever the gait's bob
     * happens to be, and the figure breathes up and down through the ground at
     * a centimetre and a half. The controller already knows where its feet are.
     *
     * **The wind is sampled twice, at the hem and at the shoulder.** §6 M3's
     * boundary layer is the whole reason a coat and a scarf move differently in
     * the same gust, and one sample cannot express it. Two calls into
     * `s.sampleWind()` — the same reading the grass, the rain, the god rays and
     * the skiff's own wake all take (§6 M3: *one* field) — is the cheapest
     * possible statement of a gradient.
     */
    _figure(dt) {
      const w = s.walker;
      // riding: seated on the deck rather than deleted. The figure used to be
      // hidden while mounted, which meant §M5's forty-kilometre traverse was an
      // empty craft flying itself — and a craft with nobody in it is a much
      // worse advertisement for a hover-skiff than a slightly stiff sitting pose.
      const riding = T.riding;
      avatar.visible = true;

      let fx, fy, fz, vel, speed;
      if (riding) {
        const hv = M5 ? hover : null;
        fx = hv ? hv.pos.x : skiff.position.x;
        fz = hv ? hv.pos.z : skiff.position.z;
        fy = (hv ? hv.pos.y : skiff.position.y) + 0.30;   // the seat, above the keel
        vel = hv ? hv.vel : s.vel;
        speed = Math.hypot(vel.x, vel.z);
        T._face = hv ? hv.face : T._face;
        avatar.rotation.set(0, T._face, hv ? hv.bank : 0);
      } else {
        fx = w ? w.pos.x : s.body.x;
        fy = w ? w.pos.y : s.body.y - GAIT.eye;
        fz = w ? w.pos.z : s.body.z;
        vel = w ? w.vel : s.vel;
        speed = Math.hypot(vel.x, vel.z);
        // face where you are going, and turn at a rate a body could turn at.
        // Below 0.8 m/s the heading is held: a body shuffling in place should
        // not spin to chase the noise on its own velocity.
        if (speed > 0.8) {
          const want = Math.atan2(-vel.x, -vel.z);
          let dy = want - T._face;
          dy = ((dy + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
          T._face += dy * Math.min(dt * 8, 1);
        }
        avatar.rotation.set(0, T._face, 0);
      }
      avatar.position.set(fx, fy, fz);

      // …and the shadow it throws. `paint.js` owns the geometry so it can be
      // checked in Node; what is left here is putting a quad where it says.
      const gy = ground(fx, fz);
      const sh = contactShadow(s.uSunDir.value, {
        height: riding ? 1.1 : 1.7,      // seated is a shorter occluder
        width: riding ? 2.4 : 0.75,      // …and a wider one, because the skiff is
        feet: fy, ground: gy,
      });
      contact.visible = sh.amount > 0.004;
      if (contact.visible) {
        contact.material.uniforms.uAmt.value = sh.amount;
        contact.position.set(
          fx + Math.sin(sh.angle) * sh.offset,
          gy + sh.lift,
          fz + Math.cos(sh.angle) * sh.offset);
        contact.rotation.y = sh.angle;
        contact.scale.set(sh.width, 1, Math.max(sh.length, 0.4));
      }

      // the boundary layer, in two samples (see above)
      const wind = s.sampleWind ? s.sampleWind(fx, fz, 0.45) : { x: 0, z: 0 };
      const windUp = s.sampleWind ? s.sampleWind(fx, fz, 1.45) : wind;

      figure.update(dt, {
        walker: riding ? null : w,
        speed,
        vel,
        face: T._face,
        wind,
        windUp,
        mode: riding ? 'ride' : (w && w.fly) || s.fly ? 'fly' : 'walk',
        sunY: s.uSunDir.value.y,
        wet: s.uWet ? s.uWet.value : 0,
      });

      // §9.2's light table is a spectral integral and the sun moves slowly: one
      // local day is seven real minutes, so re-deriving it four times a second
      // is already forty times finer than anything the eye can catch on a coat.
      lightT += dt;
      if (lightT > 0.25) {
        lightT = 0;
        // …and how much of it there is. `exposureFor(skyLux(elev))` is the same
        // lever the terrain takes, so the figure darkens into dusk with the
        // ground it is standing on instead of staying at noon or, as it did
        // until now, at zero.
        figure.setLight(lightFor(starT, Math.max(sunElev(), 0.5), true),
          exposureFor(skyLux((Math.asin(Math.min(Math.max(s.uSunDir.value.y, -1), 1)) * 180) / Math.PI)));
      }

      // the lantern rides the hand the gait is already swinging
      figure.joint('handR', handPos);
      lantern.position.copy(handPos);
      const night = 1 - Math.min(Math.max((s.uSunDir.value.y + 0.12) * 3.5, 0), 1);
      lantern.material.opacity = night * 0.85;
    },

    /** after movement: seat the camera (and the figure) for this frame */
    // `camera` may be null: under §M4 the rig in `camera.js` owns the lens and
    // this is called only to keep the avatar mesh following. Splitting the two
    // responsibilities is what lets the new rig land without the figure, its
    // scarf, its lantern and its gait all having to move in the same commit.
    place(dt, camera) {
      T._t += dt;
      if (!T.third) {
        avatar.visible = false;
        // no body in frame, no shadow for it — and leaving it on would put a
        // dark ellipse in front of a first-person camera with nothing above it
        contact.visible = false;
        if (camera) {
          camera.position.copy(s.body);
          camera.quaternion.setFromEuler(new THREE.Euler(s.pitch, s.yaw, 0, 'YXZ'));
        }
        return;
      }

      T._figure(dt);

      if (!camera) return;   // §M4's rig owns the lens; the figure is done

      // the camera hangs back on a spring, orbiting with the drag
      const dist = T.riding ? 11 : 7;
      const rise = T.riding ? 3.2 : 2.1;
      const fwd = new THREE.Vector3(0, 0, -1)
        .applyEuler(new THREE.Euler(s.pitch, s.yaw, 0, 'YXZ'));
      const want = new THREE.Vector3().copy(s.body)
        .addScaledVector(fwd, -dist);
      want.y += rise;
      // never sink the lens under the hill
      want.y = Math.max(want.y, ground(want.x, want.z) + 0.7);
      if (!T._camSet) { camera.position.copy(want); T._camSet = true; }
      else camera.position.lerp(want, 1 - Math.exp(-7 * dt));
      const look = new THREE.Vector3().copy(s.body).addScaledVector(s.vel, 0.12);
      look.y = s.body.y + 0.35;
      camera.lookAt(look);
      T.applyMount(dt, camera);
    },

    /**
     * Close whatever gap a mount or dismount opened, after the frame's placer
     * has had its say (§2.5).
     *
     * This runs *last* and adds an offset rather than overriding a position,
     * because both placers are legitimate — the rig owns the lens on foot and
     * the arm above owns it while riding — and a handover that fought either of
     * them for ownership would be a third opinion about where the eye goes.
     * The offset starts at exactly the gap, ends at exactly zero, and has zero
     * slope at both ends, so neither the leaving nor the arriving camera takes
     * a step in velocity.
     */
    applyMount(dt, camera) {
      if (!M5 || !mount.active || !camera) return;
      const o = mount.update(dt);
      camera.position.x += o.x;
      camera.position.y += o.y;
      camera.position.z += o.z;
    },
  };
  return T;
}
