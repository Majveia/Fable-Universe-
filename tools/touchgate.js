// §M7's gate, measured rather than looked at.
//
//   "at 390 × 844 — controls ≤ 14% of screen area, entirely within the bottom
//    30%, never co-present with keyboard hints, fade after 3 s idle,
//    one-handed reachable. All six scales controllable."
//
// Every clause but the last is a DOM read, so all of them are decidable in this
// container. The area budget is measured on what is *drawn*, which for the M7
// layer means the resting frame is the interesting number: the stick does not
// exist until a thumb lands on it.
import { arg, launch, playwright, serve } from './lib.js';

const pw = await playwright();
const site = await serve();
const browser = await launch(pw);
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
});
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

const results = [];
const ok = (name, pass, detail = '') => {
  results.push(pass);
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`);
};

const seed = Number(arg('seed', 20250601));
const flags = arg('flags', 'm2=1&m4=1&m7=1') === true ? 'm2=1&m4=1&m7=1' : String(arg('flags', 'm2=1&m4=1&m7=1'));
await page.goto(`${site.origin}/index.html?seed=${seed}&q=mobile&${flags}`,
  { waitUntil: 'load' });
await page.waitForTimeout(9000);

const W = 390, H = 844, AREA = W * H;

const measure = () => page.evaluate(() => {
  const vis = (el) => {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return null;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 ? { x: r.x, y: r.y, w: r.width, h: r.height } : null;
  };
  const tt = document.getElementById('tt');
  const boxes = [];
  if (tt && +getComputedStyle(tt).opacity > 0) {
    for (const el of tt.querySelectorAll('.ctx, .ring, .nub')) {
      const b = vis(el); if (b) boxes.push(b);
    }
  }
  // "Persistent" means resident in the layout — not summoned, not display:none
  // — rather than "opaque right now". The idle fade is a separate clause with
  // its own measurement, and counting by opacity conflates the two: every count
  // reads zero four seconds after the last touch, which would pass the ≤3
  // clause while saying nothing about how many elements there are.
  const persistent = [];
  for (const el of document.querySelectorAll('.hud')) {
    if (el.id === 'tt') continue;
    if (el.classList.contains('summoned')) continue;
    if (getComputedStyle(el).display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) persistent.push({ id: el.id, x: r.x, y: r.y, w: r.width, h: r.height });
  }
  return {
    boxes,
    persistent,
    ttOpacity: tt ? +getComputedStyle(tt).opacity : null,
    hintsVisible: !!vis(document.getElementById('hints')),
    coarse: document.body.classList.contains('coarse'),
    hasTouchLayer: !!tt,
  };
});

// Wake it first: measured cold, every count reads zero because the fade has
// already run, and "0 persistent elements" would pass the ≤3 clause without
// saying anything about how many there are.
// The classes are decided in `hud.tick`, and this container renders at about
// 0.2 fps — slower than the three-second timeout being tested — so the tick is
// driven directly rather than waited for. The CSS transitions then need their
// own moment before a computed-opacity read means anything.
const settle = async () => {
  await page.evaluate(() => window.AEON.hud.tick(0));
  // A computed opacity mid-transition is only meaningful after a style recalc,
  // and a style recalc needs a rendered frame. Waiting in wall time is not
  // enough when frames are seconds apart, so wait for the frames themselves.
  const n = await page.evaluate(() => window.AEON.frames);
  await page.waitForFunction((k) => window.AEON.frames > k + 2, n, { timeout: 90000 })
    .catch(() => {});
  await page.waitForTimeout(1200);
};
const wake = async () => {
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 200, clientY: 400 }));
  });
  await settle();
};
await wake();
const m = await measure();
console.log(`\n§M7 gate · 390 × 844\n`);

ok('the thumb layer mounted on a coarse pointer', m.hasTouchLayer && m.coarse);

const area = m.boxes.reduce((s, b) => s + b.w * b.h, 0);
ok('controls ≤ 14% of screen area', area / AREA <= 0.14,
  `${(100 * area / AREA).toFixed(2)}% at rest — the old rosette measured 7.3%`);

const worstTop = m.boxes.length ? Math.min(...m.boxes.map((b) => b.y)) : H;
ok('entirely within the bottom 30%', worstTop >= H * 0.70,
  `highest control edge at ${(100 * worstTop / H).toFixed(1)}% down`
  + ` (needs ≥ 70%) — the old #vslide reached 73.5%`);

ok('never co-present with keyboard hints', !m.hintsVisible,
  'the hint line is summoned, not resident');

ok('≤ 3 persistent HUD elements (§3)', m.persistent.length <= 3,
  `${m.persistent.length}: ${m.persistent.map((p) => p.id).join(', ')} — there were 7`);

// --- the 3 s fade, to zero rather than to 0.22 -----------------------------
await page.waitForTimeout(4400);
await settle();
const idle = await measure();
ok('the thumb layer fades to zero after 3 s idle', idle.ttOpacity === 0,
  `opacity ${idle.ttOpacity} — the old layer stopped at 0.22 after 4 s`);

const restedDrawn = await page.evaluate(() => [...document.querySelectorAll('.hud')]
  .filter((e) => e.id !== 'tt' && !e.classList.contains('summoned')
    && getComputedStyle(e).display !== 'none' && +getComputedStyle(e).opacity > 0.01).length);
ok('and so does the chrome, after 4 s', restedDrawn === 0,
  `${restedDrawn} of ${m.persistent.length} resident elements still drawn`);

// --- and it comes back ------------------------------------------------------
// This container renders at about 0.2 fps, which is *slower than the 3 s fade
// itself* — by the time Playwright's tap has been dispatched and a frame has
// run, more wall time has passed than the timeout being tested, so waking is
// not observable end-to-end here at any wait length. What is observable is the
// causal chain, driven synchronously: a touch resets the idle clock, and the
// next tick clears the resting classes. On a device that renders faster than
// once every three seconds these are the same statement.
await page.evaluate(() => {
  const zone = document.querySelector('#tt .zone.l');
  zone.dispatchEvent(new PointerEvent('pointerdown', {
    pointerId: 9, clientX: 120, clientY: 700, bubbles: true, pointerType: 'touch',
  }));
  zone.dispatchEvent(new PointerEvent('pointerup', {
    pointerId: 9, clientX: 120, clientY: 700, bubbles: true, pointerType: 'touch',
  }));
  window.AEON.hud.tick(0);
});
// Asserted on the classes rather than on computed opacity: the fade is a CSS
// transition and this read lands while it is still running. The classes are
// what the code decides; the opacity is what CSS does with that, and the two
// fade clauses above already measured the latter.
const woke = await page.evaluate(() => ({
  ttIdle: document.getElementById('tt').classList.contains('idle'),
  resting: [...document.querySelectorAll('.resting')].map((e) => e.id),
}));
ok('any input brings it back', !woke.ttIdle && woke.resting.length === 0,
  'the idle clock reset and no element is left resting');

// --- the stick is analog, and appears where the thumb lands ----------------
await page.waitForTimeout(200);
const stick = await page.evaluate(async () => {
  const zone = document.querySelector('#tt .zone.l');
  const send = (type, x, y, id = 1) => zone.dispatchEvent(new PointerEvent(type, {
    pointerId: id, clientX: x, clientY: y, bubbles: true, pointerType: 'touch',
  }));
  const { input } = await import('/src/input.js');
  send('pointerdown', 90, 700);
  const ring = document.querySelector('#tt .ring').getBoundingClientRect();
  send('pointermove', 90, 674);           // half of the 52 px radius, upward
  const half = Math.hypot(input.move.x, input.move.y);
  send('pointermove', 90, 648);           // full deflection
  const full = Math.hypot(input.move.x, input.move.y);
  const fwd = input.move.y;
  send('pointerup', 90, 648);
  const after = Math.hypot(input.move.x, input.move.y);
  return { ringX: ring.x + ring.width / 2, ringY: ring.y + ring.height / 2, half, full, fwd, after };
});
ok('the stick materialises where the thumb lands',
  Math.abs(stick.ringX - 90) < 2 && Math.abs(stick.ringY - 700) < 2,
  `ring centre (${stick.ringX.toFixed(0)}, ${stick.ringY.toFixed(0)}) for a touch at (90, 700)`);
ok('a half-pushed thumb writes half a unit of movement',
  Math.abs(stick.half - 0.5) < 0.05 && Math.abs(stick.full - 1) < 0.02,
  `|move| ${stick.half.toFixed(3)} at half throw, ${stick.full.toFixed(3)} at full`
  + ' — the old layer wrote 1.0 or nothing');
ok('screen-up is forward, and lifting releases the axis',
  stick.fwd > 0.9 && stick.after === 0);

// --- H kills everything, including the thumb layer -------------------------
await page.evaluate(() => window.AEON.hud.toggleChrome());
await page.waitForTimeout(200);
const hidden = await page.evaluate(() => {
  const tt = document.getElementById('tt');
  return { tt: getComputedStyle(tt).visibility, any: [...document.querySelectorAll('.hud')]
    .filter((e) => getComputedStyle(e).visibility !== 'hidden').length };
});
ok('§8 axis 7 · H hides every last piece of chrome, thumb layer included',
  hidden.tt === 'hidden' && hidden.any === 0,
  'the old toggle iterated .hud and #touch never carried the class');

await browser.close();
await site.close?.();
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} gate clauses`);
process.exit(pass === results.length ? 0 : 1);
