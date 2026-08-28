// The station ring, photographed both ways — CLAUDE.md §8 axis 5, §M0.
//
//   node tools/ringshot.js [--out docs/captures/greeble]
//
// Same reason tools/ringcensus.js exists: the ring is only built once you board
// it, and boarding has no deep link (§2.4 — logged in RECKONING), so nothing
// that navigates by URL can photograph it. This drives the two shipped builders
// directly and screenshots each.
//
// **These frames are SwiftShader.** They show geometry, layout and whether the
// surface law is doing anything at all. They are NOT evidence about the frame
// under §8 and `gateValid` is false for them — §16 rule 1. Do not score them.
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { arg, launch, playwright, serve, REPO } from './lib.js';

const out = resolve(REPO, String(arg('out', 'docs/captures/greeble')));
await mkdir(out, { recursive: true });

const pw = await playwright();
const { origin, close } = await serve();
const browser = await launch(pw);
const page = await browser.newPage({ viewport: { width: 900, height: 600 } });

const errs = [];
page.on('pageerror', (e) => errs.push(String(e).split('\n')[0]));
page.on('console', (m) => {
  const t = m.text();
  if (m.type() === 'error' && !/favicon|404/i.test(t)) errs.push(t.slice(0, 200));
});

console.log('\nringshot · the ring, both builders · SwiftShader — not a §8 capture\n');
for (const [which, close] of [['stock', 0], ['plated', 0], ['plated', 1]]) {
  await page.goto(`${origin}/tools/ringshot.html?which=${which}&close=${close}`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__shot !== undefined, null, { timeout: 120000 })
    .catch(() => {});
  const info = await page.evaluate(() => window.__shot);
  const file = resolve(out, `ring-${which}${close ? '-close' : ''}.png`);
  await writeFile(file, await page.screenshot());
  console.log(`  ${(which + (close ? ' 1:1' : '')).padEnd(11)} ${String(info?.meshes ?? '?').padStart(3)} draws · `
    + `${String(info?.tris ?? '?').padStart(6)} tris  →  ${file.replace(REPO + '/', '')}`);
}

await browser.close();
await close();
for (const e of errs) console.error('  page error: ' + e);
console.log(`\nringshot · ${errs.length ? 'errors above' : 'clean'}`);
process.exit(errs.length ? 1 : 0);
