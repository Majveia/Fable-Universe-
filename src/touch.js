// The thumb layer — CLAUDE.md §M7, and `docs/plans/WORLDS.md` §5.
//
// What this replaces is `hud.js:133-280`: a fixed 92 px rosette, a spring
// slider and seven buttons, all of which work by *synthesising keystrokes*:
//
//     window.dispatchEvent(new KeyboardEvent('keydown', { code }))   hud.js:161
//
// So a thumb that has a magnitude and a direction arrives at the controller as
// four booleans and a boost flag. That is the whole reason walking on glass
// feels like nothing, and no amount of restyling the stick would have fixed it:
// the analog part was gone at the first hop. `src/input.js` gives it somewhere
// to go, and this writes there directly.
//
// ---------------------------------------------------------------------------
// Nothing at rest
//
// §M7's gate: controls ≤ 14% of screen area, entirely within the bottom 30%,
// never co-present with keyboard hints, faded after 3 s idle, one-handed
// reachable. The old layer measured about 7.3% of a 390×844 screen and dimmed
// to opacity 0.22 after 4 s — inside the area budget, over on the timing, and
// never actually gone.
//
// This one is *invisible at rest*. The left half of the glass is a stick that
// materialises exactly where the thumb lands and dissolves when it lifts; the
// right half is look-drag. Neither exists as pixels until it is touched, so
// the resting frame is 0% obscured, which is the number §3 is really asking
// for when it says minimalism is a property of the chrome.
//
// The one persistent element is a single context button, because a control
// that is invisible *and* has no discoverable affordance is not minimal, it is
// hidden. It carries the current scale's one meaningful verb.

import { input, setAnalog, setSource } from './input.js';

const CSS = `
#tt { position:fixed; inset:0; z-index:22; pointer-events:none;
  opacity:1; transition:opacity .45s ease; }
#tt.idle { opacity:0; }
#tt .zone { position:absolute; bottom:0; height:62%; pointer-events:auto;
  touch-action:none; }
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
#tt .ctx { position:absolute; right:16px;
  bottom:calc(22px + env(safe-area-inset-bottom));
  width:44px; height:44px; border-radius:50%; pointer-events:auto;
  border:1px solid rgba(255,255,255,.18); background:rgba(12,16,22,.30);
  backdrop-filter:blur(6px); -webkit-backdrop-filter:blur(6px);
  color:rgba(255,255,255,.92); font:inherit; font-size:17px; touch-action:none; }
#tt .ctx:active { background:rgba(158,203,255,.26); }
`;

/**
 * `radius` is how far the thumb travels for full deflection. Deliberately
 * smaller than the old 92 px rosette's 38 px throw looks: a thumb pivots at the
 * knuckle and 52 px is about the arc it makes without the hand moving, which is
 * what "one-handed reachable" means in practice.
 */
const STICK = { radius: 52, dead: 6 };

/** radians per pixel — the same number `camera.js` gives the mouse */
const LOOK_PER_PX = 0.0031;

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
    // controls sitting on top of the frame it had just cleared.
    root.className = 'hud';
    root.innerHTML = `
      <div class="zone l"></div>
      <div class="zone r"></div>
      <div class="ring"></div><div class="nub"></div>
      <button class="ctx" title="go"></button>`;
    document.body.appendChild(root);

    this.root = root;
    this.ring = root.querySelector('.ring');
    this.nub = root.querySelector('.nub');
    this.ctx = root.querySelector('.ctx');
    this._idle = 0;
    this._ctxT = 0;

    this._bindStick(root.querySelector('.zone.l'));
    this._bindLook(root.querySelector('.zone.r'));
    this.ctx.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this._idle = 0;
      this._context();
    });
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
      this._idle = 0;
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
      this._idle = 0;
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
    let pinch = null;

    zone.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      live.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 });
      if (live.size === 2) pinch = this._pinchDist(live);
      this._idle = 0;
    });

    zone.addEventListener('pointermove', (e) => {
      const p = live.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.moved += Math.hypot(dx, dy);
      p.x = e.clientX; p.y = e.clientY;
      this._idle = 0;

      // two fingers is altitude, everywhere — the same gesture main.js already
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
      else if (s.onPointerMove) {
        // scales that still steer themselves get a synthetic drag rather than
        // a second implementation of looking around
        s.onPointerMove({ clientX: e.clientX, clientY: e.clientY });
      }
    });

    const end = (e) => {
      const p = live.get(e.pointerId);
      live.delete(e.pointerId);
      if (live.size < 2) pinch = null;
      if (!p) return;
      // a tap that did not travel is a selection, not a look
      if (p.moved < 8 && performance.now() - p.t < 400) {
        this.app._click?.({ clientX: p.x, clientY: p.y, pointerType: 'touch' });
      }
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  _pinchDist(live) {
    const [a, b] = [...live.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // ------------------------------------------------------------ context ---

  /** the one verb this scale has, so the button is never a menu */
  _context() {
    const s = this.app.active();
    if (s.kind === 'surface') { s.onKey?.('KeyE'); return; }
    if (s.kind === 'planet') { s.onKey?.('KeyG') || this.app.tour.start(); return; }
    this.app.tour.active ? this.app.tour.stop() : this.app.tour.start();
  }

  tick(dt) {
    // Idle is read off `input`, which every source writes to — a thumb, a key,
    // a wheel, a gamepad — so none of them has to know this layer exists, and
    // it is wall time rather than the frame loop's capped `dt`.
    this._idle = input.idle;
    this.root.classList.toggle('idle', this._idle > 3);

    if ((this._ctxT += dt) > 0.4) {
      this._ctxT = 0;
      const s = this.app.active();
      this.ctx.textContent = s.kind === 'surface' ? (s.traveler?.riding ? '✕' : '⛵')
        : s.kind === 'planet' ? '⛯' : '➤';
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
 * `hud.js:124` reads `matchMedia('(pointer: coarse)')` exactly once, at
 * construction, with no change listener — so a hybrid laptop that is touched
 * after load gets the thumb layer *and* keeps every keyboard listener live,
 * which is the case §M0 asked to close and did not.
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
