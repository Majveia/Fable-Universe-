// The thumb layer — CLAUDE.md §M7, and `docs/plans/WORLDS.md` §5.
//
// What this replaces is `hud.js:133-280`: a fixed 92 px rosette, a spring
// slider and seven buttons, all of which worked by *synthesising keystrokes*:
//
//     window.dispatchEvent(new KeyboardEvent('keydown', { code }))   hud.js:161
//
// So a thumb that has a magnitude and a direction arrived at the controller as
// four booleans and a boost flag. That is why walking on glass felt like
// nothing, and no amount of restyling the stick would have fixed it: the analog
// part was gone at the first hop. `src/input.js` gives it somewhere to go.
//
// ---------------------------------------------------------------------------
// The mistake the first version made, and the rule that comes out of it
//
// It covered the bottom 62% of the glass with two `pointer-events: auto` zones
// and left them there on every scale. Three of the six — cosmic, galaxy and
// system — steer with `OrbitControls`, which listens on the *canvas*. So the
// zones swallowed every touch those scales needed and never forwarded them:
// no orbiting, no pinch-zoom, and no double-tap to dive, on exactly the scales
// where looking around *is* the interaction. The layer was a wall.
//
// **A touch layer must add a control the scale does not have, never intercept
// one it does.** So the zones are scale-aware now: they only take the glass
// where there is no camera controller under it, and everywhere else the canvas
// keeps its events and the layer contributes chrome alone.
//
// ---------------------------------------------------------------------------
// Nothing at rest, and one button that blooms
//
// §M7 wants controls ≤14% of the screen, inside the bottom 30%, faded after 3 s.
// The old layer answered with seven permanent buttons. This answers with one:
// tap it for the scale's main verb, hold it and the scale's other verbs fan out
// on an arc inside the same thumb sweep. Seven affordances, one at rest, and
// none of them a row of icons the eye has to parse.

import { input, setAnalog, setSource } from './input.js';

const CSS = `
#tt { position:fixed; inset:0; z-index:22; pointer-events:none;
  opacity:1; transition:opacity .45s ease; }
#tt.idle { opacity:0; }
#tt .zone { position:absolute; bottom:0; height:62%; pointer-events:none;
  touch-action:none; }
#tt.walk .zone { pointer-events:auto; }
#tt .zone.l { left:0; width:46%; }
#tt .zone.r { right:0; width:54%; }
/* the stick exists only while a thumb is down, and only where it landed */
#tt .ring, #tt .nub { position:absolute; border-radius:50%; opacity:0;
  transition:opacity .18s ease; pointer-events:none; }
#tt .ring { width:104px; height:104px; margin:-52px 0 0 -52px;
  border:1px solid rgba(255,255,255,.20); background:rgba(10,14,20,.16);
  backdrop-filter:blur(3px); -webkit-backdrop-filter:blur(3px); }
#tt .nub { width:34px; height:34px; margin:-17px 0 0 -17px;
  background:rgba(255,255,255,.19); border:1px solid rgba(255,255,255,.34); }
#tt.live .ring, #tt.live .nub { opacity:1; }

#tt .ctx, #tt .fan b {
  position:absolute; border-radius:50%; pointer-events:auto;
  border:1px solid rgba(255,255,255,.18); background:rgba(12,16,22,.34);
  backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
  color:rgba(255,255,255,.92); font:inherit; touch-action:none;
  display:flex; align-items:center; justify-content:center; }
#tt .ctx { right:16px; bottom:calc(78px + env(safe-area-inset-bottom));
  width:46px; height:46px; font-size:18px; }
#tt .ctx:active { background:rgba(158,203,255,.28); }
#tt .fan { position:absolute; right:16px;
  bottom:calc(78px + env(safe-area-inset-bottom));
  width:46px; height:46px; pointer-events:none; }
#tt .fan b { width:40px; height:40px; font-size:15px; left:3px; top:3px;
  opacity:0; transform:translate(0,0) scale(.6);
  transition:opacity .18s ease, transform .22s cubic-bezier(.2,1.3,.4,1); }
#tt.fanned .fan { pointer-events:auto; }
#tt.fanned .fan b { opacity:1; }
#tt .fan b:active { background:rgba(158,203,255,.28); }
#tt .cap { position:absolute; right:74px;
  bottom:calc(86px + env(safe-area-inset-bottom));
  font-size:10px; letter-spacing:.22em; text-transform:uppercase;
  color:rgba(255,255,255,.55); white-space:nowrap; pointer-events:none;
  opacity:0; transition:opacity .25s ease; }
#tt.fanned .cap, #tt.hint .cap { opacity:1; }
`;

/**
 * How far the thumb travels for full deflection. Smaller than the old 92 px
 * rosette's throw looks, because a thumb pivots at the knuckle and 52 px is
 * about the arc it makes without the hand moving — which is what "one-handed
 * reachable" means in practice.
 */
const STICK = { radius: 52, dead: 6 };

/** which scales have no camera controller of their own under the glass */
const WALK_SCALES = new Set(['surface', 'planet', 'clouds', 'blackhole']);

export class TouchLayer {
  constructor(app) {
    this.app = app;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    const root = document.createElement('div');
    root.id = 'tt';
    // `.hud` so `H` kills it. The old `#touch` had no such class, so the one
    // key whose entire job is "show me the world with nothing on it" left the
    // controls sitting on the frame it had just cleared.
    root.className = 'hud';
    root.innerHTML = `
      <div class="zone l"></div>
      <div class="zone r"></div>
      <div class="ring"></div><div class="nub"></div>
      <div class="cap"></div>
      <div class="fan"></div>
      <button class="ctx"></button>`;
    document.body.appendChild(root);

    this.root = root;
    this.ring = root.querySelector('.ring');
    this.nub = root.querySelector('.nub');
    this.ctx = root.querySelector('.ctx');
    this.fan = root.querySelector('.fan');
    this.cap = root.querySelector('.cap');
    this._ctxT = 0;
    this._kind = null;

    this._bindStick(root.querySelector('.zone.l'));
    this._bindLook(root.querySelector('.zone.r'));
    this._bindPrimary();
  }

  // -------------------------------------------------------------- stick ---

  _bindStick(zone) {
    let id = null, ox = 0, oy = 0;

    const show = (x, y) => {
      this.ring.style.left = `${x}px`; this.ring.style.top = `${y}px`;
      this.nub.style.left = `${x}px`; this.nub.style.top = `${y}px`;
      this.root.classList.add('live');
    };

    zone.addEventListener('pointerdown', (e) => {
      if (id !== null) return;
      e.preventDefault();
      id = e.pointerId;
      try { zone.setPointerCapture(id); } catch { /* synthetic pointers */ }
      ox = e.clientX; oy = e.clientY;
      show(ox, oy);
      setAnalog({ x: 0, y: 0 });
    });

    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      let dx = e.clientX - ox, dy = e.clientY - oy;
      const d = Math.hypot(dx, dy);
      // Past full deflection the origin follows the thumb, so a long drag never
      // pins against an invisible edge — the stick travels with the hand
      // instead of the hand running out of stick.
      if (d > STICK.radius) {
        ox += dx * (1 - STICK.radius / d);
        oy += dy * (1 - STICK.radius / d);
        dx = e.clientX - ox; dy = e.clientY - oy;
        show(ox, oy);
      }
      this.nub.style.left = `${ox + dx}px`;
      this.nub.style.top = `${oy + dy}px`;
      const m = Math.hypot(dx, dy);
      if (m < STICK.dead) { setAnalog({ x: 0, y: 0 }); return; }
      // Magnitude is *kept*, not thresholded. Screen up is forward, so dy is
      // negated; this is the one line that makes a half-pushed thumb walk at
      // half speed, which is the entire difference from the old layer.
      const k = Math.min(m / STICK.radius, 1) / m;
      setAnalog({ x: dx * k, y: -dy * k });
      // a thumb pushed to the rim is a run, the same as holding shift
      setSource('sprint', m > STICK.radius * 0.93);
    });

    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      this.root.classList.remove('live');
      setAnalog(null);
      setSource('sprint', false);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  // --------------------------------------------------------------- look ---

  _bindLook(zone) {
    const live = new Map();
    let pinch = null, lastTap = null;

    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      live.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 });
      if (live.size === 2) pinch = this._pinchDist(live);
      this.app.active().onPointerDown?.(e);
    });

    zone.addEventListener('pointermove', (e) => {
      const p = live.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.moved += Math.hypot(dx, dy);
      p.x = e.clientX; p.y = e.clientY;

      // two fingers is altitude, everywhere — the same gesture main.js
      // synthesises into a wheel, kept so a pinch keeps meaning one thing
      if (live.size >= 2) {
        const d = this._pinchDist(live);
        if (pinch !== null && Math.abs(d - pinch) > 1) {
          this.app.active().onWheel?.({ deltaY: (pinch - d) * 3.2 });
          pinch = d;
        }
        return;
      }
      const s = this.app.active();
      if (s.rig) s.rig.look(dx, dy);
      else s.onPointerMove?.(e);
    });

    const end = (e) => {
      const p = live.get(e.pointerId);
      live.delete(e.pointerId);
      if (live.size < 2) pinch = null;
      this.app.active().onPointerUp?.(e);
      if (!p) return;
      if (p.moved >= 8 || performance.now() - p.t >= 400) return;

      // A tap that did not travel is a selection — and two of them in the same
      // place is the dive. Synthesised here for the same reason `main.js:390`
      // synthesises it on the canvas: `touch-action: none` means a touch never
      // fires `dblclick`, and without this the primary verb of the whole
      // universe — double-tap to fall into something — does not exist on glass.
      const now = performance.now();
      const ev = { clientX: p.x, clientY: p.y, pointerType: 'touch' };
      if (lastTap && now - lastTap.t < 500
        && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 34) {
        lastTap = null;
        this.app._dblclick(ev);
        return;
      }
      lastTap = { t: now, x: p.x, y: p.y };
      this.app._click(ev);
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  _pinchDist(live) {
    const [a, b] = [...live.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // ------------------------------------------------------------ the verbs --

  /**
   * Every verb the old seven-button row had, and the two it never had, keyed by
   * scale. The first entry is the primary — what a tap does. The rest fan out
   * on a hold.
   *
   * `?` is deliberately absent: a control that needs a legend has already lost,
   * and the legend is one summon gesture away in the HUD.
   */
  _verbs(kind) {
    const app = this.app;
    const tour = { icon: '➤', label: 'tour', run: () => (app.tour.active ? app.tour.stop() : app.tour.start()) };
    const wondrous = { icon: '✦', label: 'somewhere wondrous', run: () => app.hud._wondrous() };
    const atlas = { icon: '◈', label: 'atlas', run: () => app.hud.toggleAtlas() };
    const up = { icon: '↑', label: 'ascend', run: () => app.popTo(app.stack.length - 2) };

    switch (kind) {
      case 'cosmic':
      case 'galaxy':
      case 'system':
        // Nothing to fly here — you fall into things by double-tapping them.
        // So the primary is the roll of the dice, which is the verb this scale
        // actually wants and the one the old layer buried in a panel.
        return [wondrous, tour, atlas, ...(kind === 'cosmic' ? [] : [up])];
      case 'planet':
        return [
          { icon: '⛯', label: 'fly me down', run: () => app.active().onKey?.('KeyG') },
          { icon: '⇋', label: 'shuttle', run: () => app.active().onKey?.('KeyB') },
          wondrous, atlas, up,
        ];
      case 'surface':
        return [
          { icon: '⛵', label: 'skiff', run: () => app.active().onKey?.('KeyE') },
          { icon: '◉', label: 'third person', run: () => app.active().onKey?.('KeyC') },
          { icon: '✈', label: 'fly', run: () => app.active().onKey?.('KeyF') },
          wondrous, up,
        ];
      case 'clouds':
        return [wondrous, atlas, up];
      default:
        return [tour, wondrous, atlas, up];
    }
  }

  _bindPrimary() {
    let held = null, moved = 0, start = null;

    const openFan = () => {
      const v = this._verbs(this.app.active()?.kind).slice(1);
      this.fan.innerHTML = '';
      // An arc up and to the left of the thumb — the sweep a right hand makes
      // without the palm leaving the phone. Laid out from the primary outward
      // so the nearest button is the one most likely to be wanted.
      v.forEach((verb, i) => {
        const a = (Math.PI * 0.5) + (i + 1) * (Math.PI * 0.5) / (v.length + 1);
        const r = 78;
        const btn = document.createElement('b');
        btn.textContent = verb.icon;
        btn.style.transform = `translate(${Math.cos(a) * r}px, ${-Math.sin(a) * r}px) scale(1)`;
        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault(); e.stopPropagation();
          verb.run();
          closeFan();
        });
        btn.addEventListener('pointerenter', () => { this.cap.textContent = verb.label; });
        this.fan.appendChild(btn);
      });
      this.root.classList.add('fanned');
      this.cap.textContent = 'hold · release to close';
    };
    const closeFan = () => {
      this.root.classList.remove('fanned');
      this.cap.textContent = '';
    };
    this._closeFan = closeFan;

    this.ctx.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      moved = 0;
      start = { x: e.clientX, y: e.clientY };
      held = setTimeout(openFan, 260);
    });
    this.ctx.addEventListener('pointermove', (e) => {
      if (!start) return;
      moved = Math.max(moved, Math.hypot(e.clientX - start.x, e.clientY - start.y));
    });
    const release = () => {
      if (held) { clearTimeout(held); held = null; }
      start = null;
      if (this.root.classList.contains('fanned')) return;   // a fan button took it
      const v = this._verbs(this.app.active()?.kind)[0];
      if (moved < 12) v?.run();
    };
    this.ctx.addEventListener('pointerup', release);
    this.ctx.addEventListener('pointercancel', release);
    // a tap anywhere else closes an open fan
    window.addEventListener('pointerdown', (e) => {
      if (this.root.classList.contains('fanned') && !this.fan.contains(e.target)
        && e.target !== this.ctx) closeFan();
    }, true);
  }

  tick(dt) {
    // Idle is read off `input`, which every source writes to — a thumb, a key,
    // a wheel, a gamepad — so none of them has to know this layer exists, and
    // it is wall time rather than the frame loop's capped `dt`.
    this._idle = input.idle;
    const fanned = this.root.classList.contains('fanned');
    this.root.classList.toggle('idle', this._idle > 3 && !fanned);

    if ((this._ctxT += dt) > 0.4) {
      this._ctxT = 0;
      const kind = this.app.active()?.kind;
      if (kind !== this._kind) {
        this._kind = kind;
        // The zones only take the glass where nothing else is steering.
        // cosmic, galaxy and system drive OrbitControls off the canvas, and a
        // layer that swallows their touches is a layer that breaks them.
        this.root.classList.toggle('walk', WALK_SCALES.has(kind));
        this._closeFan?.();
      }
      const v = this._verbs(kind)[0];
      if (v && this.ctx.textContent !== v.icon) {
        this.ctx.textContent = v.icon;
        this.ctx.title = v.label;
        // name the verb briefly whenever it changes, then get out of the way
        this.cap.textContent = v.label;
        this.root.classList.add('hint');
        clearTimeout(this._hintT);
        this._hintT = setTimeout(() => this.root.classList.remove('hint'), 2200);
      }
    }
  }

  dispose() {
    this.root.remove();
  }
}

/**
 * §M7 and §M0's unfinished item: the two control layers must never be mounted
 * at once.
 *
 * `hud.js:124` read `matchMedia('(pointer: coarse)')` exactly once, at
 * construction, with no change listener — so a hybrid laptop touched after load
 * got the thumb layer *and* kept every keyboard listener live, which is the
 * case §M0 asked to close and did not.
 */
export function coarsePointer() {
  return !!(window.matchMedia && matchMedia('(pointer: coarse)').matches);
}

export function watchPointerKind(onChange) {
  if (!window.matchMedia) return;
  const q = matchMedia('(pointer: coarse)');
  const fire = () => onChange(q.matches);
  if (q.addEventListener) q.addEventListener('change', fire);
  else if (q.addListener) q.addListener(fire);
}
