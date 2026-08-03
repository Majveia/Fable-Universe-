// One input layer — CLAUDE.md §M4, and `docs/plans/WORLDS.md` §5.
//
// WORLDS.md §5 states the problem exactly: *"there is no controller, there are
// seven of them."* `main.js` routes pointer and key events to whichever scale
// is on top, and then four scales each keep their own private `keys` Set,
// filled by their own duplicated pair of listeners:
//
//     surface.js:1144 · planetscale.js:822 · system.js:357 · clouds.js:207
//
// All four are the same three lines. None of them is removed on `exit()`, only
// on `dispose()`, so a scale left on the stack keeps listening. There is no
// `keyup` at the top level and no `blur` handler, so a key held while
// alt-tabbing stays held.
//
// ---------------------------------------------------------------------------
// Why this is a new module and not a tidier `_bindInput`
//
// §6 M4 says "rework input in `main.js`". This deviates, and the reason is the
// one thing that makes M7 possible at all.
//
// The touch layer today works by *synthesising keystrokes*:
//
//     window.dispatchEvent(new KeyboardEvent('keydown', { code }))   hud.js:161
//
// so a thumb that has a magnitude and a direction arrives at the controller as
// four booleans and a boost flag. That is why walking on glass feels like
// nothing: the analog part was thrown away at the very first hop. The fix is
// not a better stick, it is a shared **axis** that a thumb can write to
// directly — and an axis has to be importable by `hud.js`, which a private
// method on `main.js` is not.
//
// ---------------------------------------------------------------------------
// The shape
//
// One state object. Three *sources* write to it — keyboard, touch, gamepad —
// and three *consumers* read it: orbit (cosmic, galaxy, system, black hole),
// walk (surface), fly (planet, vehicles). A binding is defined once, so adding
// a gamepad is a new source rather than a new handler in every scale.
//
// §2.3: this reads the wall clock, and that is fine — input is not a generation
// path. Nothing here feeds `hash()` or a seed. The controller it drives is
// stepped with the frame's `dt`, which `?dt=` pins, which is what keeps a
// replay reproducible.

/** the analog movement axis, in the camera's frame: x strafe, y forward */
const axis = { x: 0, y: 0 };
/** look delta accumulated since the last read, in radians */
const look = { x: 0, y: 0 };
/** held actions, by name */
const held = new Set();
/** actions that fired this frame and have not been consumed */
const pressed = new Set();

/** raw key codes currently down — the shared replacement for four private Sets */
export const keys = new Set();

/**
 * The action map. One place, so a rebinding is one line and a second source is
 * a new writer rather than a new switch statement.
 *
 * `Space` is deliberately absent. It is bound globally to pause-time in
 * `main.js:421`, and §2.4 makes that a permanent contract — a link someone
 * saved expects space to pause. Jump therefore goes through the scale-first
 * override already established for `KeyB` at `main.js:429`: the active scale
 * gets first refusal on Space, and only an unhandled press falls through to
 * `togglePlay`.
 */
export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'],
  back: ['KeyS', 'ArrowDown'],
  left: ['KeyA', 'ArrowLeft'],
  right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  up: ['KeyR'],
  down: ['KeyF'],
  person: ['KeyC'],
  interact: ['KeyE'],
};

const CODE_TO_ACTION = (() => {
  const m = new Map();
  for (const [action, codes] of Object.entries(BINDINGS)) {
    for (const c of codes) m.set(c, action);
  }
  return m;
})();

/**
 * What a consumer reads. `move` is analog: a keyboard writes ±1 into it, a
 * thumb writes whatever fraction it is pushed to, and neither the controller
 * nor the camera can tell which wrote it — which is the entire point.
 */
export const input = {
  move: axis,
  look,
  /** true while the action is held, from any source */
  down(action) { return held.has(action); },
  /** true once, on the frame the action began */
  once(action) {
    if (!pressed.has(action)) return false;
    pressed.delete(action);
    return true;
  },
  /** consume the accumulated look delta; returns radians and zeroes the store */
  takeLook() {
    const d = { x: look.x, y: look.y };
    look.x = 0; look.y = 0;
    return d;
  },
  /**
   * Seconds since anything at all happened — what the chrome fades on.
   *
   * A *timestamp difference*, not an accumulation of frame deltas, and the
   * distinction is not academic. Summing `dt` makes the answer depend on when
   * frames happen to land: on a slow rasteriser the frame after a tap adds its
   * whole 4.5 s duration to a timer that was reset 150 ms ago, and the chrome
   * flickers back out immediately. "Time since the user last did something" is
   * a property of the clock, so it is read from the clock.
   *
   * §2.3 is untouched: this feeds one CSS class and nothing that generates
   * anything. Under a pinned `?dt=` it switches to accumulation so a capture
   * stays reproducible — see `tickInput`.
   */
  get idle() {
    return pinnedDt ? simIdle : (now() - lastActivity) / 1000;
  },
  set idle(v) {
    simIdle = v;
    lastActivity = now() - v * 1000;
  },
};

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
let lastActivity = now();
let simIdle = 0;
let pinnedDt = 0;

/**
 * Pin the idle clock to a fixed timestep, so a `?dt=`-pinned capture renders
 * the same chrome on every machine (§7.3's pixel diff, §7.7's re-shoot).
 */
export function pinIdleClock(dt) {
  pinnedDt = dt || 0;
}

/** something happened: restart the idle clock, whichever one is running */
function wake() {
  lastActivity = now();
  simIdle = 0;
}

// ---------------------------------------------------------------------------
// sources

/** a source that owns the axis directly — the touch stick, and a gamepad */
let analogHold = null;

function recomputeAxis() {
  if (analogHold) { axis.x = analogHold.x; axis.y = analogHold.y; return; }
  axis.x = (held.has('right') ? 1 : 0) - (held.has('left') ? 1 : 0);
  axis.y = (held.has('forward') ? 1 : 0) - (held.has('back') ? 1 : 0);
}

function setAction(action, on) {
  if (!action) return;
  if (on) {
    if (!held.has(action)) pressed.add(action);
    held.add(action);
  } else {
    held.delete(action);
  }
  recomputeAxis();
}

/**
 * Push an analog vector from a non-keyboard source. `null` releases it and
 * hands the axis back to the keyboard.
 *
 * The magnitude is preserved, not normalised — `Walker.step` clamps it to 1 and
 * scales speed by it, so a thumb an eighth of the way out walks slowly. This
 * one function is what `hud.js`'s synthetic-`KeyboardEvent` bridge collapses
 * into, and with it the reason mobile movement was four booleans.
 */
export function setAnalog(v) {
  analogHold = v;
  wake();
  recomputeAxis();
}

/** push a look delta in radians, from a drag, a pointer-lock move, or a stick */
export function addLook(dx, dy) {
  look.x += dx;
  look.y += dy;
  wake();
}

/** set an action from a non-keyboard source — a touch button, a gamepad face */
export function setSource(action, on) {
  wake();
  setAction(action, on);
}

/**
 * Release everything. Called on `blur` and on `visibilitychange`, which is the
 * bug this module inherits: nothing did, so a key held while alt-tabbing stayed
 * held and the body walked into the horizon while the tab was hidden.
 */
export function releaseAll() {
  keys.clear();
  held.clear();
  pressed.clear();
  analogHold = null;
  recomputeAxis();
}

let attached = false;

/**
 * Attach the keyboard source. Idempotent, because a second scale mounting must
 * not double-bind — which is the shape of the fault the four private Sets have.
 */
export function attachKeyboard(target = window) {
  if (attached) return;
  attached = true;

  target.addEventListener('keydown', (e) => {
    wake();
    if (e.repeat) return;
    keys.add(e.code);
    setAction(CODE_TO_ACTION.get(e.code), true);
  });
  target.addEventListener('keyup', (e) => {
    keys.delete(e.code);
    setAction(CODE_TO_ACTION.get(e.code), false);
  });
  // A pointer that moves is input, whether or not it is bound to anything —
  // the chrome must not fade out from under a hand that is using it. Capturing
  // and passive so it can never interfere with a drag it is only observing.
  window.addEventListener('pointermove', wake, { capture: true, passive: true });
  window.addEventListener('pointerdown', wake, { capture: true, passive: true });
  window.addEventListener('wheel', wake, { capture: true, passive: true });

  // A key is held by the *window*, not by the page. Without these two, alt-tab
  // with W down and you come back to a body that has been walking the whole
  // time — and the keyup that would have stopped it went to another window.
  target.addEventListener('blur', releaseAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) releaseAll();
  });
}

/**
 * The per-frame tick: clears one-shot presses, and ages the *simulated* idle
 * clock when one is pinned. Unpinned, idle comes from the wall clock and this
 * has nothing to add to it.
 */
export function tickInput(dt) {
  if (pinnedDt) simIdle += dt;
  pressed.clear();
}

/**
 * Jump, which cannot be a binding.
 *
 * `Space` belongs to pause-time globally, so the walk consumer asks for it
 * through the scale-first path instead: `main.js` offers `Space` to the active
 * scale before falling through to `togglePlay`, and a scale that is walking
 * takes it. Held state comes from the raw key set, because a jump has to know
 * how long the button was down (variable height) and a one-shot cannot say.
 */
export const JUMP_CODE = 'Space';
export function jumpHeld() {
  return keys.has(JUMP_CODE) || held.has('jump');
}
