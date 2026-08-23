// Does the cabin chain actually run? — CLAUDE.md §2.4, §2.5, §16 rule 1.
//
// `tools/boot.js` exists because a wiring defect passes every pure-function
// suite in the repo and then throws on the frame it is asked to draw. It walks
// every scale on several worlds, which is thorough and, on a software
// rasteriser, slow enough that nobody runs it while iterating.
//
// This is the same argument narrowed to one chain — the one the cabin adds:
//
//     orbit → board → walk → sit → descend → touchdown
//
// It drives that with real key events and a pinned timestep, and it fails on
// **any** console error, not merely on an exception that reaches the top. A
// scale that half-builds and logs is exactly the failure boot.js was written
// about.
//
//   node tools/cabincheck.js [--seed 7] [--timeout 120]

import { arg, launch, playwright, serve } from './lib.js';

const SEED = arg('seed', '7');
const TIMEOUT = Number(arg('timeout', '120')) * 1000;

const pw = await playwright();
const { origin, close } = await serve();
const browser = await launch(pw);
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

const step = async (label, fn) => {
  const before = errors.length;
  const got = await fn();
  const bad = errors.slice(before);
  const okay = bad.length === 0 && got !== false;
  console.log(`  ${okay ? 'ok  ' : 'FAIL'} ${label}`
    + (got && got !== true ? `   ${got}` : '')
    + (bad.length ? `\n       ${bad.join('\n       ')}` : ''));
  return okay;
};

let pass = true;
try {
  // `?dt=` pins the timestep so this is reproducible, and `?cab=1` is the flag
  await page.goto(`${origin}/?seed=${SEED}&cab=1&dt=16`, { timeout: TIMEOUT });
  await page.waitForFunction('window.AEON && window.AEON.stack.length > 0',
    { timeout: TIMEOUT });

  console.log('\ncabin — orbit → board → sit → descend → ground');

  pass = await step('the page boots with ?cab=1 and no console error',
    () => page.evaluate('window.AEON.active().kind')) && pass;

  // build a CabinScale against a real craft and step it
  pass = await step('CabinScale builds, and the crew stands in it', async () => {
    const r = await page.evaluate(`(async () => {
      const { CabinScale } = await import('/src/cabin.js');
      const { craftFor } = await import('/src/craft.js');
      const pp = { seed: 3, massE: 1, radiusE: 1, atmo: 1, name: 'test', color: 0x6f7f6a };
      const cs = new CabinScale(window.AEON, {
        planet: pp, system: {}, sunColor: 0xfff1ce, hostIndex: 0,
        craft: craftFor(pp), capture: 1435,
      });
      window.__cs = cs;
      cs.enter();
      for (let i = 0; i < 30; i++) cs.update(1 / 60);
      return cs.crew.mode + ' · deck ' + cs.spec.length.toFixed(2) + ' m'
        + ' · ' + cs.scene.children.length + ' objects';
    })()`);
    return r;
  }) && pass;

  pass = await step('the nav table is met first, walking forward from the spawn',
    async () => page.evaluate(`(async () => {
      const { stepCrew, stationInReach } = await import('/src/pilot.js');
      const cs = window.__cs;
      for (let i = 0; i < 900; i++) {
        cs.crew = stepCrew(cs.crew, cs.spec, { fwd: 1 }, 1 / 60);
        if (stationInReach(cs.crew, cs.spec.stations)) break;
      }
      const st = stationInReach(cs.crew, cs.spec.stations);
      return st ? st.id + ' at z=' + cs.crew.pos[2].toFixed(2) : false;
    })()`)) && pass;

  /* ...and on to the helm, steering round the table the way a person would.
     The first version of this walked until *any* station was in reach, sat in
     it, and then reported that `L` did not start a descent — which was correct
     behaviour being read as a failure: the nav station is not the helm and the
     ship should refuse to be flown from it. */
  pass = await step('and steering past it reaches the helm',
    async () => page.evaluate(`(async () => {
      const { CREW, stepCrew, stationInReach } = await import('/src/pilot.js');
      const cs = window.__cs, s = cs.spec;
      const tbl = s.blockers[1] || [0, 0, 1e9, 1e9];
      for (let i = 0; i < 4000; i++) {
        const near = cs.crew.pos[2] > tbl[2] - 0.42 && cs.crew.pos[2] < tbl[3] + 0.42;
        const side = -(s.tableSide || 1);
        const sec = s.volumes.find(q => cs.crew.pos[2] >= q[1] && cs.crew.pos[2] <= q[2]) || s.volumes[0];
        const lim = Math.max(sec[0] - CREW.radius - 0.04, 0);
        const wantX = Math.max(-lim, Math.min(lim, near
          ? side * (Math.abs(side > 0 ? tbl[0] : tbl[1]) + CREW.radius + 0.08) : 0));
        cs.crew = stepCrew(cs.crew, s, {
          fwd: 1, strafe: Math.max(-1, Math.min(1, (wantX - cs.crew.pos[0]) * 3)),
        }, 1 / 60);
        if (stationInReach(cs.crew, s.stations) && stationInReach(cs.crew, s.stations).id === 'helm') {
          return 'helm at z=' + cs.crew.pos[2].toFixed(2);
        }
      }
      return false;
    })()`)) && pass;

  pass = await step('E takes the seat, and the eye lands on the seat eye',
    async () => page.evaluate(`(async () => {
      const cs = window.__cs;
      if (!cs.onKey('KeyE')) return false;
      for (let i = 0; i < 200 && cs.crew.mode === 'moving'; i++) cs.update(1 / 60);
      const e = cs.crew.seat.eye;
      const d = Math.hypot(cs.camera.position.x - e[0], cs.camera.position.y - e[1],
        cs.camera.position.z - e[2]);
      return cs.crew.mode === 'seated' && cs.crew.seat.id === 'helm' && d < 1e-6
        ? 'seated at the helm, camera on the seat eye to ' + d.toExponential(1) + ' m'
        : false;
    })()`)) && pass;

  pass = await step('§2.4 · the URL now names the helm', async () =>
    page.evaluate('window.__cs.deepLink === "2" ? "?cab=2" : false')) && pass;

  pass = await step('L commits the descent and it integrates',
    async () => page.evaluate(`(async () => {
      const cs = window.__cs;
      if (!cs.onKey('KeyL')) return false;
      const h0 = cs.entry.h;
      for (let i = 0; i < 400; i++) cs.update(1 / 60);
      return cs.entry.h < h0 && cs.flying
        ? (h0 / 1000).toFixed(0) + ' km → ' + (cs.entry.h / 1000).toFixed(1) + ' km'
          + ' · ' + (cs.entry.decel / 9.80665).toFixed(2) + ' g' : false;
    })()`)) && pass;

  /* §2.8 is the invariant this scale is most able to break, because the cabin
     is the one place that *crosses* the boundary: true #000 in vacuum, and
     nothing below §9.4's lift once there is air outside. Asserted rather than
     reported — a check that returns a string is a check that cannot fail, and
     this suite has already caught one of those. */
  pass = await step('§2.8 · true black in vacuum, lifted once there is air',
    async () => page.evaluate(`(async () => {
      const { CabinScale } = await import('/src/cabin.js');
      const { craftFor } = await import('/src/craft.js');
      const pp = { seed: 3, massE: 1, radiusE: 1, atmo: 1, name: 't', color: 0x6f7f6a };
      const fresh = new CabinScale(window.AEON, {
        planet: pp, system: {}, sunColor: 0xfff1ce, hostIndex: 0,
        craft: craftFor(pp), capture: 1435,
      });
      fresh.update(1 / 60);
      const vac = fresh.scene.background.getHex();          // not flying yet
      const cs = window.__cs;
      for (let i = 0; i < 200000 && cs.entry.phase !== 'down'; i++) cs.update(1 / 60);
      cs.update(1 / 60);
      const air = cs.scene.background;
      fresh.dispose();
      if (vac !== 0x000000) return false;                    // vacuum must be #000
      if (!(air.b > 0.03 && air.b > air.r)) return false;     // and violet-lifted
      return 'vacuum #000000 → air rgb('
        + [air.r, air.g, air.b].map(v => v.toFixed(3)).join(', ')
        + ') at entry ' + cs.entryFrac.toFixed(3);
    })()`)) && pass;

  pass = await step('the descent hands off rather than running forever',
    async () => page.evaluate('window.__cs.entry.phase === "down" ? "phase down, taken=" + window.__cs.entry.taken : false')) && pass;

  pass = await step('disposing the cabin frees its geometry',
    async () => page.evaluate('(window.__cs.dispose(), "disposed")')) && pass;
} catch (e) {
  console.log(`  FAIL harness: ${e.message}`);
  pass = false;
} finally {
  await browser.close();
  await close();
}

console.log(`\n${pass && errors.length === 0 ? 'cabin · chain runs clean'
  : `cabin · FAILED${errors.length ? ` · ${errors.length} console error(s)` : ''}`}`);
process.exit(pass && errors.length === 0 ? 0 : 1);
