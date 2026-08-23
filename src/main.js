// AEON — a living universe.
//
// Four nested scales, one stack:
//   cosmic web  →  galaxy  →  star system  →  (galactic nucleus: black hole)
// Everything is procedural: one integer seeds it all. The integer itself is
// rolled fresh each visit — every arrival is a universe nobody has seen —
// and reflected into the URL, so any universe you're standing in can be
// shared by copying the address bar.

import * as THREE from 'three';
import { Post } from './post.js';
import { HUD } from './hud.js';
import { Hyperzoom } from './transition.js';
import { parseRoomKey } from './liminal.js';
import { ROOM_NOTE, RoomScale } from './rooms.js';
import { Ambience } from './audio.js';
import { Tour } from './tour.js';
import { CosmicScale, COSMIC_NOTE } from './cosmic.js';
import { GalaxyScale, GALAXY_NOTE, galaxyParams } from './galaxy.js';
import { SystemScale, SYSTEM_NOTE } from './system.js';
import { BlackHoleScale, BLACKHOLE_NOTE } from './blackhole.js';
import { SurfaceScale, SURFACE_NOTE } from './surface.js';
import { CloudsScale, CLOUDS_NOTE } from './clouds.js';
import { PlanetScale, PLANET_NOTE } from './planetscale.js';
import { seedAmbient, starName, universeEpigraph } from './rng.js';
import { advance as advanceClock, resetClock } from './clock.js';
import { Bench, BENCH_ON, BENCH_SEED } from './bench.js';
import { Q, pixelRatio } from './quality.js';
import { paintForScale } from './print.js';
import { pinIdleClock, tickInput } from './input.js';
import { gravityOf } from './avatar.js';
import { CABIN_ON, CabinScale } from './cabin.js';
import { craftFor } from './craft.js';
import { sit, stepCrew } from './pilot.js';

// scratch for THREE.Color#getHSL — the score reads a world's palette hue, and
// allocating an object per scale change to do it would be silly
const HSL = { h: 0, s: 0, l: 0 };

const NOTES = { room: ROOM_NOTE, cosmic: COSMIC_NOTE, galaxy: GALAXY_NOTE, system: SYSTEM_NOTE, blackhole: BLACKHOLE_NOTE, surface: SURFACE_NOTE, clouds: CLOUDS_NOTE, planet: PLANET_NOTE };
const HINTS = {
  room: 'w a s d to walk · the doors lead to worlds that share this address · they may be anywhere',
  cosmic: 'drag to look · scroll to zoom · space plays cosmic time · click a bright node to enter a galaxy · n compares gravity vs linear theory · u rolls a fresh universe',
  galaxy: 'drag to look · scroll to zoom · click a star to visit its system · click the core to meet the nucleus · esc to ascend',
  system: 'click a world · land from its card · j to cruise (steer into a star to travel there) · hold ] to age the star · esc to ascend',
  blackhole: 'drag to orbit the horizon · scroll to lean closer · esc to ascend',
  surface: 'drag to look · wasd walk · shift runs · f flies · c steps outside · e boards the skiff · esc to orbit',
  clouds: 'drag to steer · you fly where you look · w dives faster, s eases off · + − trims the cruise · esc to climb out',
  planet: 'autopilot is flying you down · drag to look around · any key takes the helm · b boards a shuttle · esc flies you back to orbit',
};

class App {
  constructor() {
    const url = new URL(window.location.href);
    // a pinned ?seed= is honored (links, logbook, tests); otherwise the
    // dice roll — this visit's universe exists for the first time right now
    const pinned = parseInt(url.searchParams.get('seed'));
    this.seed = Number.isInteger(pinned) && pinned > 0 ? pinned
      // a measured flight is not a fresh arrival: an unpinned ?bench=1 still
      // has to fly the same universe on every machine
      : BENCH_ON ? BENCH_SEED
      : (crypto.getRandomValues(new Uint32Array(1))[0] & 0x7fffffff) || 1138;
    // Transient motion gets its stream now, before any scale is built, so the
    // sparks and the rain and the traffic are a property of the seed too.
    // Everything structural was already seeded; this is what was left (§2.3).
    seedAmbient(this.seed);
    resetClock();

    // A fixed timestep, when asked for. Seeding alone does not make a frame
    // reproducible: the draws come out in the order the program asks for them,
    // and dt-dependent branches ("a bolt every dt/5 seconds") make that order a
    // function of frame timing. Pin dt and the same URL renders the same frame,
    // which is what §7.3's pixel diff and §7.7's re-shoot both need.
    const fixedMs = parseFloat(url.searchParams.get('dt'));
    this.fixedDt = Number.isFinite(fixedMs) && fixedMs > 0 ? fixedMs / 1000
      : BENCH_ON ? 1 / 60 : 0;

    /** frames drawn since construction; a harness's only honest clock (§_frame) */
    this.frames = 0;
    /** set by haltAt(); the frame the loop stopped on, or 0 */
    this.halted = 0;
    this._haltAt = 0;

    // the classic surface is the default; the streaming globe is opt-in
    this.quadOn = url.searchParams.get('quad') === '1';

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // ACES, and the one place it is still allowed to exist.
    //
    // Every document in this repo forbids it by name — v1 §"Print" ("Never
    // ACES"), v2 §9.4 step 1 ("Not ACES. Not Reinhard.") and v2 §3 row 3
    // ("Never ACES, in either regime") — and the universe rendered through it
    // at every scale for its entire life, which M0's audit routed to M2 as the
    // largest single gap between the constitution and the pixels.
    //
    // `Post` now sets `NoToneMapping` and runs §9.4's print instead. This
    // assignment survives only as the `?m2=0` fallback: a saved link that asks
    // for the old frame still gets it, exactly (§2.4).
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    // §5's quality table, chosen once and never moved again (§11)
    this.dpr = pixelRatio();
    this.renderer.setPixelRatio(this.dpr);
    document.getElementById('app').appendChild(this.renderer.domElement);

    this.post = new Post(this.renderer);
    this.hud = new HUD(this);
    this.zoom = new Hyperzoom(this);
    // the universe's own seed, so `keySeed` at the cosmic scale is this
    // universe rather than 0 — without it every seed opens on the same chord
    this.audio = new Ambience(this.seed);
    this.tour = new Tour(this);
    const unlock = () => {
      this.audio.unlock();
      const s = this.active();
      this.audio.setScale(s.kind, this._worldInfo(s));
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    this.raycaster = new THREE.Raycaster();
    // fat fingers deserve fat rays: touch picks with a wider threshold, so
    // a double-tap dives as readily as a desktop double-click
    this.raycaster.params.Points.threshold =
      window.matchMedia && matchMedia('(pointer: coarse)').matches ? 6 : 2;
    this.pointer = new THREE.Vector2();

    this.log = JSON.parse(localStorage.getItem('aeon-log-v1') || '[]');

    this.stack = [new CosmicScale(this)];
    this._restore(url);
    this._syncScale();

    this._bindInput();
    this._resize();
    window.addEventListener('resize', () => this._resize());

    this.clock = new THREE.Clock();
    this._statT = 0;
    this._warping = false;

    // splash dissolves into the young universe — each one opens on its line
    const spl = document.querySelector('#splash p');
    if (spl) spl.textContent = `universe ${this.seed} · ${universeEpigraph(this.seed)}`;
    setTimeout(() => {
      // the splash may already be gone — a measured run tears it down on
      // frame zero rather than fade it over the first 1.4 s of the flight
      const s = document.getElementById('splash');
      if (!s) return;
      s.classList.add('gone');
      setTimeout(() => s.remove(), 1600);
    }, 1400);

    // the instrument, if this run is a measurement (§5) — null otherwise
    // a pinned timestep pins the chrome's idle clock too, so a capture of
    // frame N shows the same HUD on every machine
    pinIdleClock(this.fixedDt);

    this.bench = Bench.maybe(this);

    this.renderer.setAnimationLoop(() => this._frame());

    // deterministic hooks for tests / tinkering
    window.AEON = this;
  }

  active() { return this.stack[this.stack.length - 1]; }

  /** re-enter a deep-linked location: ?g=<galaxy>&s=<star>&bh=1 */
  _restore(url) {
    const g = parseInt(url.searchParams.get('g'));
    if (!g) return;
    this.stack[0].exit();
    this.stack.push(new GalaxyScale(this, { galaxySeed: g }));
    const s = parseInt(url.searchParams.get('s'));
    if (s) {
      this.active().exit();
      this.stack.push(new SystemScale(this, { starSeed: s }));
      // deeper still? a world, a moon, a cloud deck — or the whole globe
      const pIdx = parseInt(url.searchParams.get('p'));
      const sys = this.active();
      const plIdx = parseInt(url.searchParams.get('pl'));
      const plNode = Number.isInteger(plIdx) ? sys.planetNodes[plIdx] : null;
      // planet surfaces live on the globe now: old ?p= planet links follow
      const pNode = Number.isInteger(pIdx) ? sys.planetNodes[pIdx] : null;
      const redirected = pNode && pNode.pp.typeId <= 4 && this.quadOn
        && url.searchParams.get('moon') === null && !url.searchParams.get('cl');
      const globeNode = (plNode && plNode.pp.typeId <= 4 && this.quadOn) ? plNode
        : (redirected ? pNode : null);
      if (globeNode) {
        const ctx = this._approachCtx(sys, globeNode.pp);
        sys.exit();
        this.stack.push(new PlanetScale(this, ctx));
        this.active().enter();
        // §2.4 · and one level further in, if the link named the cabin. It is
        // pushed *on top of* the planet rather than instead of it, so backing
        // out of the ship leaves you in orbit rather than nowhere — and so a
        // `?cab=` link that arrives with the flag off still resolves to the
        // world it names instead of silently delivering nothing.
        const cab = url.searchParams.get('cab');
        if (cab && CABIN_ON) {
          const cs = new CabinScale(this, {
            ...ctx, craft: craftFor(globeNode.pp), capture: 1435,
          });
          this.active().exit();
          this.stack.push(cs);
          this.active().enter();
          // `?cab=2` is the helm, and it is a *place*, so it has to resolve to
          // the seated state rather than to a walk toward it.
          if (cab === '2') {
            const helm = cs.spec.stations.find((q) => q.id === 'helm');
            cs.crew = sit(cs.crew, helm);
            while (cs.crew.mode === 'moving') cs.crew = stepCrew(cs.crew, cs.spec, {}, 1 / 60);
          }
        }
        return;
      }
      // streaming off: a ?pl= globe link lands on the classic surface instead
      const node = pNode ?? plNode;
      const idx = pNode ? pIdx : plIdx;
      if (node) {
        const base = { system: sys.params, sunColor: sys.starColor, hostIndex: idx };
        if (url.searchParams.get('cl') && node.pp.typeId >= 5) {
          sys.exit();
          this.stack.push(new CloudsScale(this, { ...base, planet: node.pp }));
          this.active().enter();
        } else if (url.searchParams.get('moon') !== null && node.moons.length) {
          const mIdx = Math.min(parseInt(url.searchParams.get('moon')) || 0, node.moons.length - 1);
          const w = sys.moonAsWorld(node.moons[mIdx]);
          sys.exit();
          this.stack.push(new SurfaceScale(this, {
            ...base, planet: w, moonIndex: mIdx, parentGiant: { pp: node.pp },
          }));
          this.active().enter();
        } else if (node.pp.typeId >= 5) {
          // §2.4, the half that was missing: a giant has no ground, so `?pl=`
          // and a bare `?p=` both fell off the end of this chain and left you
          // on the system view with no explanation — a link that names a place
          // and silently delivers nowhere. Its cloud deck *is* the place you
          // can stand on a giant, and it was already built; `?cl=1` above is
          // now the explicit spelling of a default rather than the only way in.
          sys.exit();
          this.stack.push(new CloudsScale(this, { ...base, planet: node.pp }));
          this.active().enter();
        } else if (node.pp.typeId <= 4) {
          sys.exit();
          this.stack.push(new SurfaceScale(this, { ...base, planet: node.pp }));
          this.active().enter();
        }
      }
    } else if (url.searchParams.get('room')) {
      // NOTE: this branch sits inside the `?g=` chain, so a bare `?room=` lands
      // on the cosmic web instead. That is deliberate rather than an oversight
      // *now*: a room's doors are worlds in a particular galaxy, so a room
      // without a galaxy is an address with nothing to open onto. `?room=` on
      // its own is answered by `enterRoom` supplying the current galaxy, and
      // the URL form always carries `g` — `roomKey` alone is not a location.
      // §2.4 · `?room=a3f0c000.19` — the rooms between, `src/liminal.js`.
      //
      // A room is not a record anywhere: it *is* its address, so this decodes
      // rather than looks up, and an address that is not one is refused instead
      // of resolving to room zero. The scene that draws it lands next; the
      // schema lands here because §2.4 requires it in the same commit as the
      // feature that creates the location, and because a URL people may already
      // be holding must never come to mean a different room later.
      const addr = parseRoomKey(url.searchParams.get('room'));
      if (addr) {
        const g = parseInt(url.searchParams.get('g'));
        const galaxySeed = Number.isFinite(g) ? g >>> 0 : hash(this.seed, 0xbe0) >>> 0;
        const rs = new RoomScale(this, { galaxySeed, addr });
        this.stack.push(rs);
        // Every other branch in this chain enters the scale it pushed and this
        // one did not, so a shared `?room=` URL arrived with the controls off:
        // you stood in the room and could not walk, which is the one thing
        // there is to do in it.
        this.active().enter();
        console.info(`[room] ${rs.deepLink} · ${rs.R.shape.width.toFixed(1)}`
          + `×${rs.R.shape.depth.toFixed(1)}×${rs.R.shape.ceiling.toFixed(1)} m`
          + ` · ${rs.R.doors.length} doors · ${rs.tubeCount} tubes`);
      }
    } else if (url.searchParams.get('bh')) {
      const gal = this.active();
      gal.exit();
      this.stack.push(new BlackHoleScale(this, { bhMassMsun: gal.params?.bhMassMsun }));
      // …and enter it, which every other branch in this function does and this
      // one did not. Without it `controls.enabled` stays false, so the one roll
      // in sixteen that lands you at a galactic nucleus arrived somewhere you
      // could not turn to look at.
      this.active().enter();
    }
  }

  /** roll a universe nobody has ever seen (a cold jump, honestly fresh) */
  freshUniverse() {
    const u = new URL(window.location.href);
    for (const k of ['seed', 'g', 's', 'bh', 'p', 'moon', 'cl', 'pl', 'room', 'cab']) u.searchParams.delete(k);
    window.location.href = u;
  }

  /** keep the URL pointing at where you are, so places can be shared */
  _reflectUrl() {
    const u = new URL(window.location.href);
    u.searchParams.set('seed', this.seed);
    for (const k of ['g', 's', 'bh', 'p', 'moon', 'cl', 'pl', 'room', 'cab']) u.searchParams.delete(k);
    for (const sc of this.stack) {
      if (sc.kind === 'galaxy') u.searchParams.set('g', sc.ctx.galaxySeed);
      if (sc.kind === 'system') u.searchParams.set('s', sc.ctx.starSeed);
      if (sc.kind === 'blackhole') u.searchParams.set('bh', '1');
      if (sc.kind === 'planet') u.searchParams.set('pl', sc.ctx.hostIndex);
      if (sc.kind === 'surface') {
        u.searchParams.set('p', sc.ctx.hostIndex);
        if (sc.ctx.moonIndex !== undefined) u.searchParams.set('moon', sc.ctx.moonIndex);
      }
      if (sc.kind === 'clouds') {
        u.searchParams.set('p', sc.ctx.hostIndex);
        u.searchParams.set('cl', '1');
      }
      // §2.4 · `?cab=1` standing in the ship, `?cab=2` seated at the helm.
      // The cabin rides *under* whichever world it is in orbit of, so the key
      // is written alongside `pl`/`p` rather than instead of it — a cabin with
      // no world to be above is an address with nothing to open onto, the same
      // argument `?room=` settles above.
      if (sc.kind === 'cabin') {
        u.searchParams.set('pl', sc.ctx.hostIndex);
        u.searchParams.set('cab', sc.deepLink);
      }
    }
    history.replaceState(null, '', u);
  }

  // ------------------------------------------------------------ scales ----
  push(scale, focusFn) {
    if (this._warping) return;
    this._warping = true;
    this.hud.hideCard();
    if (focusFn) {
      // seamless hyperzoom: fall toward the target, swap mid-motion
      this.audio.warp('dive');
      this.zoom.dive(this.active(), scale, focusFn, () => {
        this.active().exit();
        this.stack.push(scale);
        this._syncScale();
      });
    } else {
      this.hud.warp(() => {
        this.active().exit();
        this.stack.push(scale);
        this._syncScale();
        this._warping = false;
      });
    }
  }

  /**
   * The ground gave way. Replace the stack with the room.
   *
   * Not pushed *under* the world, because you did not descend into it and
   * there is nothing above it to come back to — the way out of a room is a
   * door, and the doors go to worlds (§6 of `src/liminal.js`).
   */
  enterRoom(galaxySeed, addr) {
    if (this._warping) return;
    this.audio?.warp?.('dive');
    this.hud.warp(() => {
      while (this.stack.length) { const s = this.stack.pop(); s.exit?.(); s.dispose?.(); }
      this.stack.push(new RoomScale(this, { galaxySeed, addr }));
      this.active().resume?.();
      this._syncScale();
      this._warping = false;
    });
  }

  /**
   * A door in a room opens onto a world that shares its address.
   *
   * The world is real and addressable and may be anywhere — that is the entire
   * claim of `src/liminal.js` §6, and this is the four lines that make it true
   * rather than asserted. The room is replaced rather than stacked under,
   * because you did not descend into it and there is nothing to come back up to.
   */
  enterWorldFromRoom(galaxySeed, star) {
    if (this._warping) return;
    const from = this.active();
    this.audio?.warp?.('dive');
    this.hud.warp(() => {
      while (this.stack.length) { const s = this.stack.pop(); s.exit?.(); s.dispose?.(); }
      this.stack.push(new GalaxyScale(this, { galaxySeed }));
      this.stack.push(new SystemScale(this, { starSeed: star.starSeed >>> 0 }));
      this.active().resume?.();
      this._syncScale();
      this._warping = false;
    });
    void from;
  }

  popTo(depth) {
    if (this._warping || depth < 0 || depth >= this.stack.length) return;
    this._warping = true;
    this.hud.hideCard();
    if (depth === this.stack.length - 2) {
      // single-level ascend: seamless
      this.audio.warp('ascend');
      const from = this.active();
      this.zoom.ascend(from, this.stack[depth], () => {
        this.stack.pop();
        from.exit();
        from.dispose();
        this.active().resume();
        this._syncScale();
      });
    } else {
      this.hud.warp(() => {
        while (this.stack.length > depth + 1) {
          const s = this.stack.pop();
          s.exit();
          s.dispose();
        }
        this.active().resume();
        this._syncScale();
        this._warping = false;
      });
    }
  }

  /**
   * What the score needs to know about where you are standing (`src/score.js`).
   *
   * This used to hand over three fields and `null` at the four vacuum scales,
   * while `deriveScore()` reads eight. The consequence was not a crash — every
   * field is optional and defaults — it was worse than that: **every world was
   * scored as if it orbited the Sun at one gravity**, and every universe opened
   * on the same chord. A generative score whose inputs never vary is a
   * hardcoded one wearing a costume, which is precisely the thing §1 says this
   * project must not do in the one medium where nobody would check.
   *
   * Two seeds, and the difference is the point. `keySeed` fixes the key and
   * hangs on the *star*, so every world in a system is in the same key and a
   * dive from orbit to the ground changes register, mode and instrumentation
   * but never modulates under you — §2.5, in the one medium where a cut would
   * be inaudible as a cut and merely feel wrong. `seed` fixes everything else
   * (the chord progression, where each generator starts) and is the world's
   * own, so two planets of one star are the same key and different pieces.
   *
   * `blackhole` deliberately gets no star: its `ctx` carries only `bhMassMsun`,
   * so `keySeed` falls through to the universe's seed and it plays in the
   * universe's key. That is intentional and must not be "fixed" by handing over
   * the accretion disc's temperature — the disc is the hottest thing in the
   * project and the mode transfer would score the maw in Lydian.
   */
  _worldInfo(s) {
    const star = s.kind === 'system' ? s.params : (s.ctx?.system ?? null);
    const keySeed = star?.seed ?? s.ctx?.starSeed ?? s.ctx?.galaxySeed ?? this.seed;
    const base = { seed: keySeed, keySeed, starTemp: star?.temp };
    const pp = s.pp;
    if (!pp) return base;
    return {
      ...base,
      seed: pp.seed ?? keySeed,
      type: pp.type,
      atmo: s.kind === 'surface' ? s.atmo : s.kind === 'clouds' ? 1.5 : 0.55,
      mood: pp.res?.id,
      Teq: pp.Teq,
      gravity: gravityOf(pp),
      hue: pp.colA?.getHSL ? pp.colA.getHSL(HSL).h : undefined,
      inhabited: pp.inhabited,
    };
  }

  /**
   * Draw exactly `n` frames and stop. The only way to photograph a specific
   * frame: without it a screenshot catches whatever the loop happened to be on
   * when the compositor got round to it, which is a property of the machine.
   * Nothing in the universe calls this — it exists for `tools/`.
   */
  haltAt(n) {
    this._haltAt = n;
    if (this.frames >= n) { this.renderer.setAnimationLoop(null); this.halted = this.frames; }
  }

  /** and back to running, for a harness that wants more frames after a look */
  resume() {
    this._haltAt = 0;
    this.halted = 0;
    this.renderer.setAnimationLoop(() => this._frame());
  }

  _syncScale() {
    this._reflectUrl();
    const s = this.active();
    s.camera.aspect = this.width / this.height || 1;
    s.camera.updateProjectionMatrix();
    this.post.setScene(s.scene, s.camera);
    this.post.tune(s.bloomSettings);
    this.post.grade(s.gradeSettings);
    this.hud.setNote(s.noteOverride ?? NOTES[s.kind]);
    this.hud.setHint(s.hintOverride?.() ?? HINTS[s.kind]);
    this.audio.setScale(s.kind, this._worldInfo(s));
    this._crumbs();
  }

  _crumbs() {
    const items = [{ label: 'universe ' + this.seed, onclick: () => this.popTo(0) }];
    for (let i = 1; i < this.stack.length; i++) {
      const s = this.stack[i];
      const label = s.kind === 'galaxy' ? s.params.name
        : s.kind === 'system' ? s.params.name
        : s.kind === 'planet' ? s.pp.name + (s.walk ? ' · surface' : ' · orbit')
        : s.kind === 'surface' ? s.pp.name + ' · surface'
        : s.kind === 'clouds' ? s.pp.name + ' · cloud deck'
        : 'nucleus';
      items.push({ label, onclick: () => this.popTo(i) });
    }
    this.hud.setCrumbs(items);
  }

  // ------------------------------------------------------------- input ----
  _bindInput() {
    const cv = this.renderer.domElement;
    let down = null;

    // two fingers on the glass = the wheel: pinch is altitude everywhere
    const tp = new Map();
    let pinchD = null;
    const pinchDist = () => {
      const [a, b] = [...tp.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    cv.addEventListener('pointerdown', (e) => {
      this.tour.stop();
      if (e.pointerType === 'touch') {
        tp.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (tp.size === 2) {
          pinchD = pinchDist();
          this.active().onPointerUp?.(e);   // the drag yields to the pinch
          down = null;
          return;
        }
      }
      down = { x: e.clientX, y: e.clientY };
      this.active().onPointerDown?.(e);
    });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch' && tp.has(e.pointerId)) {
        tp.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (tp.size >= 2) {
          const d = pinchDist();
          if (pinchD !== null && Math.abs(d - pinchD) > 1) {
            this.active().onWheel?.({ deltaY: (pinchD - d) * 3.2 });
            pinchD = d;
          }
          return;
        }
      }
      this.active().onPointerMove?.(e);
    });
    const lift = (e) => {
      if (e.pointerType === 'touch') {
        tp.delete(e.pointerId);
        if (tp.size < 2) pinchD = null;
      }
    };
    cv.addEventListener('pointercancel', lift);
    let lastTap = null;
    cv.addEventListener('pointerup', (e) => {
      lift(e);
      this.active().onPointerUp?.(e);
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved >= 6) return;
      // touch never fires dblclick once touch-action is none: two quick
      // taps in the same place are the double-tap, synthesized here
      const now = performance.now();
      if (e.pointerType === 'touch' && lastTap && now - lastTap.t < 500
        && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 34) {
        lastTap = null;
        this._dblclick(e);
        return;
      }
      lastTap = { t: now, x: e.clientX, y: e.clientY };
      this._click(e);
    });
    cv.addEventListener('dblclick', (e) => this._dblclick(e));
    cv.addEventListener('wheel', (e) => this.active().onWheel?.(e), { passive: true });

    window.addEventListener('keydown', (e) => {
      const s = this.active();
      if (e.code === 'KeyT') {
        this.tour.active ? this.tour.stop() : this.tour.start();
        return;
      }
      this.tour.stop();
      switch (e.code) {
        case 'Escape':
        case 'Backspace':
          if (this._transfer) { this._transfer = null; this.hud.setHint(''); }
          else if (s.kind === 'surface' && s.exitInterior?.()) { /* left the shrine, not the world */ }
          else if (s.kind === 'planet' && s.beginAscent?.()) { /* the climb-out flies you */ }
          else if (s.kind === 'system' && s.focusIndex >= 0) { s.focusPlanet(-1); this.hud.hideCard(); }
          else this.popTo(this.stack.length - 2);
          break;
        case 'Space': s.togglePlay?.(); e.preventDefault(); break;
        case 'Comma': case 'Minus': s.slowDown?.(); break;
        case 'Period': case 'Equal': s.speedUp?.(); break;
        case 'BracketLeft': s.scrub?.(-1); break;
        case 'BracketRight': s.scrub?.(1); break;
        // One toggle, not a walk over `.hud` setting each element's visibility
        // independently — that version could desync, and it missed `#touch`
        // entirely, so the one key whose whole job is "show me the world with
        // nothing on it" left the controls sitting on the frame it had cleared.
        case 'KeyH': this.hud.toggleChrome(); break;
        case 'KeyM': this.hud.setMuted(this.audio.toggleMute()); break;
        // the scale speaks first: on a planet, B is the shuttle, not the log
        case 'KeyB': if (!s.onKey?.('KeyB')) this.hud.toggleLog(); break;
        /* §2.4/§2.5 · the cabin. `E` takes the seat and `L` commits the
           descent, and both belong to the scale — but from *orbit* `E` is the
           way aboard, which is the step that closes the chain. Same scale-first
           rule as KeyB: the cabin answers if it is the active scale, and the
           planet below hands you up into one if it is. */
        case 'KeyE':
          if (!s.onKey?.('KeyE') && s.kind === 'planet') this.boardCabin(s);
          break;
        case 'KeyL': s.onKey?.('KeyL'); break;
        case 'KeyU': this.freshUniverse(); break;
        case 'KeyG': this.hud.toggleAtlas(); break;
        // J for the leap: somewhere wondrous, one press, from anywhere.
        case 'KeyJ': this.hud._wondrous(); break;
        // Same scale-first rule as KeyB above, and it was missing. `cosmic.js`
        // handles KeyN — it is the N-body/Zel'dovich toggle, and §M1's gate
        // clause (c) is *about* that toggle. This line took the key first, so
        // the clause was unreachable from a keyboard: pressing N opened the
        // bestiary and the comparison the milestone is scored on never ran.
        case 'KeyN': if (!s.onKey?.('KeyN')) this.hud.toggleBestiary(); break;
        case 'Slash': this.hud.toggleControls(); break;
        default: s.onKey?.(e.code);
      }
    });
  }

  _ndc(e) {
    this.pointer.set(
      (e.clientX / this.width) * 2 - 1,
      -(e.clientY / this.height) * 2 + 1);
    return this.pointer;
  }

  _click(e) {
    const s = this.active();
    const ndc = this._ndc(e);
    this.raycaster.setFromCamera(ndc, s.camera);
    const hit = s.pick?.(this.raycaster, ndc);
    if (!hit) { this.hud.hideCard(); return; }

    if (s.kind === 'cosmic') this._cardGalaxy(hit);
    else if (s.kind === 'galaxy') hit.type === 'core' ? this._cardCore(hit) : this._cardStar(hit);
    else if (s.kind === 'system') {
      if (hit.type === 'sun') this._cardSun(s);
      else if (hit.type === 'moon') this._cardMoon(s, hit);
      else this._cardPlanet(s, hit);
    }
  }

  _dblclick(e) {
    const s = this.active();
    const ndc = this._ndc(e);
    this.raycaster.setFromCamera(ndc, s.camera);
    const hit = s.pick?.(this.raycaster, ndc);
    if (!hit) return;
    this.diveFromHit(s, hit);
  }

  /** descend into whatever was hit — shared by input and the tour autopilot */
  diveFromHit(s, hit) {
    if (s.kind === 'cosmic') {
      this.push(new GalaxyScale(this, { galaxySeed: hit.galaxySeed, webPos: hit.position.clone() }), () => hit.position);
    } else if (s.kind === 'galaxy') {
      if (hit.type === 'core') {
        this.push(new BlackHoleScale(this, { bhMassMsun: s.params.bhMassMsun }), () => new THREE.Vector3());
      } else {
        this.push(
          new SystemScale(this, { starSeed: hit.starSeed, galaxyPos: hit.position.clone() }),
          () => s.starPosAt(hit.index));
      }
    } else if (s.kind === 'system' && hit.type === 'planet') {
      // double-click means take me there — all the way to the world itself
      const p = s.params.planets[hit.index];
      if (p.typeId <= 4) { this.quadOn ? this.approach(s, p) : this.landOn(s, p); }
      else this.cruise(s, p);
    }
  }

  /** interstellar arrival: replace the current system with the neighbor star */
  arriveAtStar(fromSys, starSeed) {
    if (this._warping) return;
    const depth = this.stack.indexOf(fromSys);
    if (depth < 1) return; // system already torn down mid-flight
    this._warping = true;
    this.hud.hideCard();
    this.audio.warp('dive');
    // a flash of starlight streaking past, then the new system fades in
    this.hud.veil(new THREE.Color(0.55, 0.62, 0.85));
    const arrive = { dir: fromSys.rel.dir.toArray() };
    setTimeout(() => {
      const gpos = fromSys.ctx.galaxyPos;
      while (this.stack.length > depth) {
        const sc = this.stack.pop();
        sc.exit();
        sc.dispose();
      }
      const sys = new SystemScale(this, { starSeed, galaxyPos: gpos, arrive });
      this.stack.push(sys);
      sys.enter();
      this._syncScale();
      this.audio.warp('ascend');
      this._warping = false;
    }, 260);
  }

  landOn(s, p) {
    this.push(
      new SurfaceScale(this, { planet: p, system: s.params, sunColor: s.starColor, hostIndex: p.index }),
      () => s.planetNodes[p.index].group.position);
  }

  /** everything the whole-planet scale needs, captured from the live system */
  _approachCtx(s, p) {
    const node = s.planetNodes[p.index];
    if (node.group.position.lengthSq() === 0) s.update(0); // deep link: seat the orbits
    const sunDir = s.uSunPos.value.clone().sub(node.group.position).normalize();
    const fromDir = s.camera.position.clone().sub(node.group.position).normalize();
    const moons = node.moons.map(m => ({
      dist: m.userData.dist, drawR: m.userData.drawR ?? 0.2,
      phase: m.userData.phase, rate: m.userData.rate,
    }));
    return {
      planet: p, system: s.params, sunColor: s.starColor, hostIndex: p.index,
      sunDir: sunDir.toArray(), fromDir: fromDir.toArray(), moons,
      gview: s._galaxyView(),
    };
  }

  /** fall out of the system view onto the whole streaming globe */
  approach(s, p) {
    this.push(
      new PlanetScale(this, this._approachCtx(s, p)),
      () => s.planetNodes[p.index].group.position);
  }


  cruise(s, p) {
    this.push(
      new CloudsScale(this, { planet: p, system: s.params, sunColor: s.starColor, hostIndex: p.index }),
      () => s.planetNodes[p.index].group.position);
  }

  // ------------------------------------------------------- transfer ----
  /** the interplanetary autopilot: glide across the system to the world
   *  you clicked, then hand the fall to the descent director — with the
   *  ascent director, grass to grass is Esc and one card button */
  beginTransfer(s, p) {
    if (this._warping || this.zoom.busy) return;
    this.hud.hideCard();
    s.focusPlanet(p.index);
    this._transfer = { sys: s, p, t: 0 };
    this.hud.setHint('transfer autopilot · making for ' + p.name + ' · esc aborts');
  }

  _tickTransfer(dt) {
    const T = this._transfer;
    const s = this.active();
    if (s !== T.sys) { this._transfer = null; return; }   // arrived, or you left
    if (this._warping || this.zoom.busy) return;
    T.t += dt;
    const node = T.sys.planetNodes[T.p.index].group.position;
    const near = T.sys.camera.position.distanceTo(node) < Math.max(T.p.drawRadius * 8, 6);
    if ((T.t > 2.5 && near) || T.t > 18) {
      this.approach(T.sys, T.p);         // the descent director lands you
    }
  }

  // ---------------------------------------------------------- logbook ----
  _saveLog() { localStorage.setItem('aeon-log-v1', JSON.stringify(this.log)); }

  markPlace() {
    const u = new URL(window.location.href);
    const params = {};
    for (const k of ['g', 's', 'bh', 'p', 'moon', 'cl', 'pl', 'room', 'cab']) {
      const v = u.searchParams.get(k);
      if (v !== null) params[k] = v;
    }
    const label = this.stack.map(sc =>
      sc.kind === 'cosmic' ? 'universe ' + this.seed
        : sc.kind === 'galaxy' ? sc.params.name
        : sc.kind === 'system' ? sc.params.name
        : sc.kind === 'planet' ? sc.pp.name + ' orbit'
        : sc.kind === 'surface' ? sc.pp.name
        : sc.kind === 'clouds' ? sc.pp.name + ' clouds'
        : 'nucleus').join(' ▸ ');
    this.log.push({ label, seed: this.seed, params, t: Date.now() });
    this._saveLog();
    this.hud.refreshLog();
  }

  removePlace(i) {
    this.log.splice(i, 1);
    this._saveLog();
    this.hud.refreshLog();
  }

  /**
   * Board the ship from orbit — §2.5's missing half.
   *
   * Pushed *on top of* the planet rather than replacing it, so stepping back
   * out of the airlock leaves you where you were rather than nowhere, and so
   * the cabin never has to reconstruct an orbit it did not build.
   *
   * There is no hyperzoom here on purpose. A hyperzoom is how this project
   * changes *scale*; boarding does not change scale, it changes what you are
   * standing in, and diving the camera into a hull would be a flourish that
   * said something false about the geometry.
   */
  boardCabin(planetScale) {
    if (!CABIN_ON || this._warping) return false;
    const ctx = planetScale.ctx;
    const cs = new CabinScale(this, {
      ...ctx, craft: craftFor(planetScale.pp), capture: 1435,
    });
    this.active().exit();
    this.stack.push(cs);
    this._syncScale();
    this.active().enter();
    this.hud.setHint('E · take the seat');
    return true;
  }

  /**
   * The bottom of the descent: `descent.js` crossed the capture line and the
   * surface takes the vehicle.
   *
   * The cabin and the planet under it are both dropped, because you are not in
   * either any more — but the *system* stays, so `Escape` from the ground still
   * climbs back out the way it always did. Handing off rather than pushing is
   * what keeps the stack from growing a level every time somebody lands.
   */
  arriveOnSurface(from, ctx) {
    if (this.active() !== from) return;
    const surface = new SurfaceScale(this, ctx);
    // drop the cabin and the orbit beneath it in one step
    while (this.stack.length && this.active().kind !== 'system') {
      const top = this.stack.pop();
      top.exit();
      top.dispose?.();
    }
    this.stack.push(surface);
    this._syncScale();
    this.active().enter();
    // `showDiscovery` is what this HUD has for "you have arrived somewhere" —
    // it is the same call the shrine and the ruins make, so a touchdown reads
    // like every other arrival rather than inventing a second notification.
    this.hud.showDiscovery(ctx.planet?.name ?? 'surface', 'touchdown');
  }

  /** warp to a logged place: tear the stack down, rebuild it there */
  travelTo(i) {
    const e = this.log[i];
    if (!e) return;
    if (e.seed !== this.seed) {
      // other universe: cold jump
      const u = new URL(window.location.href);
      for (const k of ['g', 's', 'bh', 'p', 'moon', 'cl', 'pl', 'room', 'cab']) u.searchParams.delete(k);
      u.searchParams.set('seed', e.seed);
      for (const [k, v] of Object.entries(e.params)) u.searchParams.set(k, v);
      window.location.href = u;
      return;
    }
    this.teleport(e.params);
  }

  /** warp anywhere in this universe — {g, s, pl, p, moon, cl} — behind one
   *  fade: the Atlas's engine, and the logbook's */
  teleport(params) {
    if (this._warping || this.zoom.busy) return;
    const u = new URL(window.location.href);
    for (const k of ['g', 's', 'bh', 'p', 'moon', 'cl', 'pl', 'room', 'cab']) u.searchParams.delete(k);
    u.searchParams.set('seed', this.seed);
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
    this._warping = true;
    this.audio.warp('dive');
    this.hud.warp(() => {
      while (this.stack.length > 1) {
        const s = this.stack.pop();
        s.exit();
        s.dispose();
      }
      this.stack[0].resume();
      // `finally`, because a destination that fails to build must still leave
      // you somewhere. Without it `_warping` stayed true and every later
      // teleport returned at the guard on the first line — the app was not
      // merely showing a black screen, it had stopped accepting the input that
      // could have got you off it.
      try {
        this._restore(u);
      } finally {
        this._syncScale();
        this._warping = false;
      }
    });
  }

  // programmatic dives — used by tests and deep links
  diveGalaxy(seed) { this.push(new GalaxyScale(this, { galaxySeed: seed })); }
  diveSystem(seed) { this.push(new SystemScale(this, { starSeed: seed })); }
  diveBlackHole(mass = 4.2e6) { this.push(new BlackHoleScale(this, { bhMassMsun: mass })); }

  // -------------------------------------------------------------- cards ----
  _cardGalaxy(hit) {
    const p = galaxyParams(hit.galaxySeed);
    this.hud.showCard({
      title: p.name,
      kind: p.type + ' galaxy',
      rows: [
        ['stellar mass', (p.massMsun / 1e11).toFixed(2) + ' × 10¹¹ M☉'],
        ['spiral arms', p.type.includes('spiral') ? p.arms : '—'],
        ['nucleus', (p.bhMassMsun / 1e6).toFixed(1) + ' × 10⁶ M☉ BH'],
      ],
      flavor: 'A knot in the cosmic web, wound from the collapse you just watched.',
      action: {
        label: 'enter galaxy',
        cb: () => this.push(new GalaxyScale(this, { galaxySeed: hit.galaxySeed, webPos: hit.position.clone() }), () => hit.position),
      },
    });
  }

  _cardStar(hit) {
    this.hud.showCard({
      title: hit.name,
      kind: 'star system',
      rows: [['catalog id', 'A-' + (hit.starSeed >>> 8).toString(16)]],
      flavor: 'One of two hundred billion. This one has your attention.',
      action: {
        label: 'enter system',
        cb: () => this.push(
          new SystemScale(this, { starSeed: hit.starSeed, galaxyPos: hit.position.clone() }),
          () => this.active().starPosAt?.(hit.index) ?? hit.position),
      },
    });
  }

  _cardCore(hit) {
    this.hud.showCard({
      title: 'the nucleus',
      kind: 'supermassive black hole',
      rows: [['mass', (hit.bhMassMsun / 1e6).toFixed(1) + ' × 10⁶ M☉']],
      flavor: 'Every large galaxy keeps one. Light itself orbits here.',
      action: {
        label: 'descend',
        cb: () => this.push(new BlackHoleScale(this, { bhMassMsun: hit.bhMassMsun }), () => new THREE.Vector3()),
      },
    });
  }

  _cardSun(s) {
    const P = s.params;
    if (P.binary) {
      const pDays = Math.sqrt(P.binary.aBin ** 3 / P.massTotal) * 365.25;
      this.hud.showCard({
        title: P.name,
        kind: `${P.spectral}+${P.binary.spectralB} close binary`,
        rows: [
          ['masses', `${P.mass.toFixed(2)} + ${P.binary.massB.toFixed(2)} M☉`],
          ['surfaces', `${Math.round(P.temp).toLocaleString()} / ${Math.round(P.binary.tempB).toLocaleString()} K`],
          ['separation', P.binary.aBin.toFixed(3) + ' AU'],
          ['mutual period', pDays >= 30 ? (pDays / 365.25).toFixed(2) + ' yr' : pDays.toFixed(1) + ' d'],
          ['habitable zone', '≈ ' + P.hz.toFixed(2) + ' AU'],
        ],
        flavor: 'Two suns sharing a barycenter. Every world here is circumbinary — Kepler-16 country.',
      });
    } else {
      this.hud.showCard({
        title: P.name,
        kind: `${P.spectral}-class ${P.stage}`,
        rows: [
          ['mass', P.mass.toFixed(2) + ' M☉'],
          ['surface', Math.round(P.temp).toLocaleString() + ' K'],
          ['luminosity', (P.lum >= 100 ? P.lum.toFixed(0) : P.lum.toFixed(2)) + ' L☉'],
          ['radius', P.radiusSun.toFixed(2) + ' R☉'],
          ['habitable zone', '≈ ' + P.hz.toFixed(2) + ' AU'],
        ],
        flavor: 'Its color is its temperature — a blackbody wearing its physics.',
      });
    }
    s.focusPlanet(-1);
  }

  _cardMoon(s, hit) {
    const w = s.moonAsWorld(hit.moon);
    const g = w.massE / (w.radiusE * w.radiusE);
    this.hud.showCard({
      title: w.name,
      kind: w.type + ' of ' + w.parent.name,
      rows: [
        ['radius', w.radiusE.toFixed(2) + ' R⊕'],
        ['mass', w.massE.toFixed(3) + ' M⊕'],
        ['surface gravity', g.toFixed(2) + ' g'],
        ['orbital period', w.periodDays.toFixed(1) + ' d'],
        ['temperature', w.Teq + ' K'],
      ],
      flavor: w.parent.typeId >= 5
        ? 'From its surface, the giant never moves. It only watches.'
        : 'A stone attending a stone, both attending the star.',
      actions: [{
        label: 'land',
        cb: () => this.push(
          new SurfaceScale(this, {
            planet: w, system: s.params, sunColor: s.starColor,
            hostIndex: w.parent.index,
            moonIndex: hit.moon.userData.moonIndex,
            parentGiant: { pp: w.parent },
          }),
          () => hit.moon.getWorldPosition(new THREE.Vector3())),
      }],
    });
  }

  _cardPlanet(s, hit) {
    const p = hit.planet;
    const actions = [{ label: 'enter orbit', cb: () => s.focusPlanet(p.index) }];
    if (p.typeId <= 4) {
      actions.push({
        label: this.quadOn ? 'descend from orbit' : 'descend to surface',
        cb: () => this.quadOn ? this.approach(s, p) : this.push(
          new SurfaceScale(this, { planet: p, system: s.params, sunColor: s.starColor, hostIndex: p.index }),
          () => s.planetNodes[p.index].group.position),
      });
      if (this.quadOn) {
        actions.push({
          label: 'fly there · autopilot',
          cb: () => this.beginTransfer(s, p),
        });
      }
    } else {
      actions.push({
        label: 'dive the cloud deck',
        cb: () => this.push(
          new CloudsScale(this, { planet: p, system: s.params, sunColor: s.starColor, hostIndex: p.index }),
          () => s.planetNodes[p.index].group.position),
      });
    }
    this.hud.showCard({
      title: p.name,
      kind: p.type + (p.inhabited ? ' · inhabited' : ''),
      rows: [
        ['orbit', p.a.toFixed(2) + ' AU'],
        ['year', p.periodYears >= 1 ? p.periodYears.toFixed(2) + ' yr' : (p.periodYears * 365.25).toFixed(0) + ' d'],
        ['eccentricity', p.e.toFixed(3)],
        ['mass', p.massE >= 10 ? p.massE.toFixed(0) + ' M⊕' : p.massE.toFixed(2) + ' M⊕'],
        ['radius', p.radiusE.toFixed(2) + ' R⊕'],
        ['equilibrium temp', p.Teq + ' K'],
        ['moons', p.moons || '—'],
        ['rings', p.hasRings ? 'yes' : '—'],
      ],
      flavor: p.note,
      actions,
    });
  }

  // ------------------------------------------------------------- frame ----
  _frame() {
    // How many frames this universe has drawn. Not used by the universe — it
    // exists so a harness can photograph *frame N* rather than "90 frames after
    // I noticed the page was up". Those are different questions, and the second
    // one races page load: the loop starts when App constructs, and how far it
    // gets before an external observer attaches is a property of the machine.
    // Under a fixed timestep frame N is a well-defined state; "90 frames after
    // I looked" is not, and a determinism test that asks the second question
    // cannot tell a nondeterministic universe from a slow one. See tools/repeat.js.
    this.frames++;
    this.bench?.frameStart();
    const raw = this.clock.getDelta();
    const real = Math.min(raw, 0.1);
    const dt = this.fixedDt || real;
    advanceClock(dt);
    this.zoom.update(dt);
    if (this._warping && !this.zoom.busy && !this.hud.warpEl.classList.contains('on')) {
      this._warping = false;
    }
    this.tour.update(dt);
    if (this._transfer) this._tickTransfer(dt);
    const s = this.active();
    s.update(dt);
    s.glide?.(dt);
    this.post.setPaint(paintForScale(s));
    this.post.render(dt);
    this.zoom.render();
    this.hud.tick(dt);
    // The input layer's own clock, once per frame and at the *end* of it, so a
    // one-shot press survives long enough for the scale that ran this frame to
    // read it. It lives here rather than in the walk path because the idle
    // timer the HUD fades on has to run on all six scales, not only the one
    // with a body in it — which is how the first version of this managed to
    // never fade at all above the ground.
    //
    // It gets the *uncapped* delta, unlike everything else in this function.
    // §3 asks the chrome to fade "after 4 s", and 4 s means four seconds of a
    // person not touching anything — not four seconds of simulation. The 0.1 s
    // cap above exists so a hitch cannot teleport the world, and applying it
    // here instead made the fade take twenty times too long on a slow
    // rasteriser, which is exactly when a stalled HUD is least welcome.
    // `?dt=` still pins it, so a capture stays reproducible.
    tickInput(this.fixedDt || raw);

    this._statT -= dt;
    if (this._statT <= 0) {
      this._statT = 0.25;
      this.hud.setStats(s.hudStats());
      this.hud.setTime(s.timeReadout?.() ?? '', s.playing ?? true);
      // the crumb names a place, and touchdown changes the place
      const walking = s.kind === 'planet' ? !!s.walk : null;
      if (walking !== this._crumbWalk) { this._crumbWalk = walking; this._crumbs(); }
    }

    // Resolution does not move. It used to: this stepped the pixel ratio up and
    // down every 70 frames against a frame-time average, which §11 lists as a
    // known trap — "set once at init, live changes pump visibly" — and the old
    // code half-conceded it by holding resolution up during flown sequences,
    // "which is exactly when it must look like cinema." Every sequence is.
    // The tier is chosen once in quality.js and the renderer keeps it.

    this.bench?.frameEnd();

    // Stop exactly here, if a harness asked to photograph this frame. Counting
    // frames was only half the problem: `App.frames` told an observer *when*
    // frame N had been drawn, and the loop then kept drawing while the
    // screenshot was taken. On a software rasteriser that window holds zero or
    // one extra frames and nothing moves; on an RTX 3060 at 1400 fps it holds
    // dozens, and two runs land on different ones. That is what made the
    // determinism test report 14.54% bit-identical while insisting both runs
    // were "at frame 94" — they were, when asked. They were not, when
    // photographed. See tools/repeat.js.
    if (this._haltAt && this.frames >= this._haltAt) {
      this.renderer.setAnimationLoop(null);
      this.halted = this.frames;
    }
  }

  _resize() {
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.renderer.setSize(this.width, this.height);
    this.post.setSize(this.width, this.height);
    for (const s of this.stack) {
      s.camera.aspect = this.width / this.height;
      s.camera.updateProjectionMatrix();
    }
  }
}

new App();
