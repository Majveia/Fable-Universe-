// A frame with the chrome deleted — CLAUDE.md §8 axis 7, §M0's limits.
//
//   node tools/clean.js --at "g=1&s=2309773419&p=1" --name surface
//
// §8 axis 7 asks the question this answers: *delete the HUD entirely and lose
// no orientation?* Every other capture tool in this directory shoots the HUD
// along with the world, and at the small viewports this container can afford
// the chrome covers most of the frame — so the one axis that is about the
// world alone is the one nothing could photograph.
//
// `hud.toggleChrome()` is the same call `H` makes. Pressing it from the page
// rather than reimplementing it means what is hidden is exactly what the key
// hides, including the thumb layer that an earlier implementation missed.
//
// Same honesty as `glimpse.js`, and for the same reason: **this is a software
// rasteriser with the quality knobs wrecked.** gateValid is false. It answers
// binary questions — is the world there, does it read without labels — and
// nothing about colour, density or performance.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { arg, launch, playwright, serve, REPO } from './lib.js';

const W = Number(arg('w', 480)), H = Number(arg('h', 300));
const AT = String(arg('at', 'g=1&s=2309773419&p=1'));
const NAME = String(arg('name', 'clean'));
const OUT = resolve(REPO, String(arg('out', 'docs/captures/shipped')));
const BUDGET = Number(arg('timeout', 100)) * 1000;
// the same knobs glimpse turns down, for the same reason — see its header
const CHEAP = 'dt=0.0166&q=low&grass=0.012,0.010,0.006,0.006&blades=1,1,1,1'
  + '&wind=64&shres=512&shtaps=1&qd=10&qr=17&vc=0';

await mkdir(OUT, { recursive: true });
const { origin, close } = await serve();
const browser = await launch(await playwright());
const page = await browser.newPage({ viewport: { width: W, height: H } });
const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));

const url = `/index.html?${AT}&${CHEAP}`;
await page.goto(origin + url, { waitUntil: 'domcontentloaded' });
await page.waitForFunction(
  () => !!(window.AEON?.stack?.length), null, { timeout: BUDGET }).catch(() => {});
await page.waitForFunction(() => window.AEON.frames > 0, null, { timeout: BUDGET })
  .catch(() => {});
// let it settle before the chrome goes, so the hint text is not mid-fade
await page.waitForTimeout(2500);
const hidden = await page.evaluate(() => window.AEON?.hud?.toggleChrome?.() ?? null);
await page.waitForTimeout(600);

const file = resolve(OUT, `${NAME}.png`);
await writeFile(file, await page.screenshot());
const scale = await page.evaluate(() => window.AEON?.active?.()?.kind ?? '?');
await browser.close();
await close();

console.log(`clean · ${scale} · chrome ${hidden === true ? 'hidden' : 'NOT hidden — ' + hidden}`
  + `\n  ${file.replace(REPO + '/', '')} · gateValid FALSE — an instrument, not evidence`);
for (const e of errs) console.error('  page error: ' + e);
