// AEON — a living universe.
//
// Four nested scales, one stack:
//   cosmic web  →  galaxy  →  star system  →  (galactic nucleus: black hole)
// Everything is procedural and deterministic: one integer seeds it all.

import * as THREE from 'three';
import { Post } from './post.js';
import { HUD } from './hud.js';
import { Hyperzoom } from './transition.js';
import { Ambience } from './audio.js';
import { Tour } from './tour.js';
import { CosmicScale, COSMIC_NOTE } from './cosmic.js';
import { GalaxyScale, GALAXY_NOTE, galaxyParams } from './galaxy.js';
import { SystemScale, SYSTEM_NOTE } from './system.js';
import { BlackHoleScale, BLACKHOLE_NOTE } from './blackhole.js';
import { SurfaceScale, SURFACE_NOTE } from './surface.js';
import { CloudsScale, CLOUDS_NOTE } from './clouds.js';
import { starName } from './rng.js';

const NOTES = { cosmic: COSMIC_NOTE, galaxy: GALAXY_NOTE, system: SYSTEM_NOTE, blackhole: BLACKHOLE_NOTE, surface: SURFACE_NOTE, clouds: CLOUDS_NOTE };
const HINTS = {
  cosmic: 'drag to look · scroll to zoom · space plays cosmic time · click a bright node to enter a galaxy · n compares gravity vs linear theory',
  galaxy: 'drag to look · scroll to zoom · click a star to visit its system · click the core to meet the nucleus · esc to ascend',
  system: 'click a world to read it · double-click to enter orbit · land from the card · j engages relativistic cruise · esc to ascend',
  blackhole: 'drag to orbit the horizon · scroll to lean closer · esc to ascend',
  surface: 'drag to look · wasd to walk · shift runs · f flies · space pauses the day · esc to return to orbit',
  clouds: 'drag to steer · you fly where you look · w dives faster, s eases off · + − trims the cruise · esc to climb out',
};

class App {
  constructor() {
    const url = new URL(window.location.href);
    this.seed = parseInt(url.searchParams.get('seed')) || 1138;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(this.dpr);
    document.getElementById('app').appendChild(this.renderer.domElement);

    this.post = new Post(this.renderer);
    this.hud = new HUD(this);
    this.zoom = new Hyperzoom(this);
    this.audio = new Ambience();
    this.tour = new Tour(this);
    const unlock = () => {
      this.audio.unlock();
      const s = this.active();
      this.audio.setScale(s.kind, this._worldInfo(s));
    };
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    this.raycaster = new THREE.Raycaster();
    this.raycaster.params.Points.threshold = 2;
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
    this._perf = { acc: 0, n: 0 };
    this._warping = false;

    // splash dissolves into the young universe
    setTimeout(() => {
      const s = document.getElementById('splash');
      s.classList.add('gone');
      setTimeout(() => s.remove(), 1600);
    }, 1400);

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
      // deeper still? a world, a moon, a cloud deck
      const pIdx = parseInt(url.searchParams.get('p'));
      const sys = this.active();
      const node = Number.isInteger(pIdx) ? sys.planetNodes[pIdx] : null;
      if (node) {
        const base = { system: sys.params, sunColor: sys.starColor, hostIndex: pIdx };
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
        } else if (node.pp.typeId <= 4) {
          sys.exit();
          this.stack.push(new SurfaceScale(this, { ...base, planet: node.pp }));
          this.active().enter();
        }
      }
    } else if (url.searchParams.get('bh')) {
      const gal = this.active();
      gal.exit();
      this.stack.push(new BlackHoleScale(this, { bhMassMsun: gal.params.bhMassMsun }));
    }
  }

  /** keep the URL pointing at where you are, so places can be shared */
  _reflectUrl() {
    const u = new URL(window.location.href);
    for (const k of ['g', 's', 'bh', 'p', 'moon', 'cl']) u.searchParams.delete(k);
    for (const sc of this.stack) {
      if (sc.kind === 'galaxy') u.searchParams.set('g', sc.ctx.galaxySeed);
      if (sc.kind === 'system') u.searchParams.set('s', sc.ctx.starSeed);
      if (sc.kind === 'blackhole') u.searchParams.set('bh', '1');
      if (sc.kind === 'surface') {
        u.searchParams.set('p', sc.ctx.hostIndex);
        if (sc.ctx.moonIndex !== undefined) u.searchParams.set('moon', sc.ctx.moonIndex);
      }
      if (sc.kind === 'clouds') {
        u.searchParams.set('p', sc.ctx.hostIndex);
        u.searchParams.set('cl', '1');
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

  _worldInfo(s) {
    if (s.kind === 'surface') return { type: s.pp.type, atmo: s.atmo };
    if (s.kind === 'clouds') return { type: s.pp.type, atmo: 1.5 };
    return null;
  }

  _syncScale() {
    this._reflectUrl();
    const s = this.active();
    s.camera.aspect = this.width / this.height || 1;
    s.camera.updateProjectionMatrix();
    this.post.setScene(s.scene, s.camera);
    this.post.tune(s.bloomSettings);
    this.hud.setNote(s.noteOverride ?? NOTES[s.kind]);
    this.hud.setHint(HINTS[s.kind]);
    this.audio.setScale(s.kind, this._worldInfo(s));
    this._crumbs();
  }

  _crumbs() {
    const items = [{ label: 'universe ' + this.seed, onclick: () => this.popTo(0) }];
    for (let i = 1; i < this.stack.length; i++) {
      const s = this.stack[i];
      const label = s.kind === 'galaxy' ? s.params.name
        : s.kind === 'system' ? s.params.name
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

    cv.addEventListener('pointerdown', (e) => {
      this.tour.stop();
      down = { x: e.clientX, y: e.clientY };
      this.active().onPointerDown?.(e);
    });
    cv.addEventListener('pointermove', (e) => this.active().onPointerMove?.(e));
    cv.addEventListener('pointerup', (e) => {
      this.active().onPointerUp?.(e);
      if (!down) return;
      const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
      down = null;
      if (moved < 6) this._click(e);
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
          if (s.kind === 'system' && s.focusIndex >= 0) { s.focusPlanet(-1); this.hud.hideCard(); }
          else this.popTo(this.stack.length - 2);
          break;
        case 'Space': s.togglePlay?.(); e.preventDefault(); break;
        case 'Comma': case 'Minus': s.slowDown?.(); break;
        case 'Period': case 'Equal': s.speedUp?.(); break;
        case 'BracketLeft': s.scrub?.(-1); break;
        case 'BracketRight': s.scrub?.(1); break;
        case 'KeyH': document.querySelectorAll('.hud').forEach(el => el.style.visibility = el.style.visibility === 'hidden' ? '' : 'hidden'); break;
        case 'KeyM': this.hud.setMuted(this.audio.toggleMute()); break;
        case 'KeyB': this.hud.toggleLog(); break;
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
      s.focusPlanet(hit.index);
    }
  }

  landOn(s, p) {
    this.push(
      new SurfaceScale(this, { planet: p, system: s.params, sunColor: s.starColor, hostIndex: p.index }),
      () => s.planetNodes[p.index].group.position);
  }

  cruise(s, p) {
    this.push(
      new CloudsScale(this, { planet: p, system: s.params, sunColor: s.starColor, hostIndex: p.index }),
      () => s.planetNodes[p.index].group.position);
  }

  // ---------------------------------------------------------- logbook ----
  _saveLog() { localStorage.setItem('aeon-log-v1', JSON.stringify(this.log)); }

  markPlace() {
    const u = new URL(window.location.href);
    const params = {};
    for (const k of ['g', 's', 'bh', 'p', 'moon', 'cl']) {
      const v = u.searchParams.get(k);
      if (v !== null) params[k] = v;
    }
    const label = this.stack.map(sc =>
      sc.kind === 'cosmic' ? 'universe ' + this.seed
        : sc.kind === 'galaxy' ? sc.params.name
        : sc.kind === 'system' ? sc.params.name
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

  /** warp to a logged place: tear the stack down, rebuild it there */
  travelTo(i) {
    const e = this.log[i];
    if (!e || this._warping || this.zoom.busy) return;
    const u = new URL(window.location.href);
    for (const k of ['g', 's', 'bh', 'p', 'moon', 'cl']) u.searchParams.delete(k);
    u.searchParams.set('seed', e.seed);
    for (const [k, v] of Object.entries(e.params)) u.searchParams.set(k, v);
    if (e.seed !== this.seed) { window.location.href = u; return; } // other universe: cold jump
    this._warping = true;
    this.audio.warp('dive');
    this.hud.warp(() => {
      while (this.stack.length > 1) {
        const s = this.stack.pop();
        s.exit();
        s.dispose();
      }
      this.stack[0].resume();
      this._restore(u);
      this._syncScale();
      this._warping = false;
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
        label: 'descend to surface',
        cb: () => this.push(
          new SurfaceScale(this, { planet: p, system: s.params, sunColor: s.starColor, hostIndex: p.index }),
          () => s.planetNodes[p.index].group.position),
      });
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
    const dt = Math.min(this.clock.getDelta(), 0.1);
    this.zoom.update(dt);
    if (this._warping && !this.zoom.busy && !this.hud.warpEl.classList.contains('on')) {
      this._warping = false;
    }
    this.tour.update(dt);
    const s = this.active();
    s.update(dt);
    s.glide?.(dt);
    this.post.render(dt);
    this.zoom.render();
    this.hud.tick(dt);

    this._statT -= dt;
    if (this._statT <= 0) {
      this._statT = 0.25;
      this.hud.setStats(s.hudStats());
      this.hud.setTime(s.timeReadout?.() ?? '', s.playing ?? true);
    }

    // adaptive resolution: hold 60ish, never look potato unless we must
    const p = this._perf;
    p.acc += dt; p.n++;
    if (p.n >= 70) {
      const avg = p.acc / p.n;
      if (avg > 0.03 && this.dpr > 1) this._setDpr(Math.max(this.dpr - 0.25, 1));
      else if (avg < 0.015 && this.dpr < Math.min(window.devicePixelRatio || 1, 2)) this._setDpr(this.dpr + 0.25);
      p.acc = 0; p.n = 0;
    }
  }

  _setDpr(v) {
    this.dpr = v;
    this.renderer.setPixelRatio(v);
    this.post.composer.setPixelRatio(v);
    this._resize();
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
