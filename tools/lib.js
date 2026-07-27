// Shared plumbing for the M0 instruments: a static file server with no
// dependencies, and a Chromium launch that resolves Playwright wherever the
// machine happens to keep it.
//
// CLAUDE.md §2.2 keeps the *runtime* free of dependencies — `python3 -m
// http.server` must remain sufficient, forever. These are dev instruments,
// run by hand, and they are the one place §M0 explicitly sanctions Playwright.
// So: no package.json, no lockfile, no build step. One global install.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = resolve(fileURLToPath(new URL('../', import.meta.url)));

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

// The art reference ships with a CDN importmap — the one thing in it that is
// not self-contained. §8 requires that the reference *runs*, because its blind
// side-by-side is the rubric's only executable comparison, and a machine with
// no route to jsdelivr renders nothing at all.
//
// The fix is applied here, in the bytes on the way out, rather than in the
// file on disk. docs/reference/hoshi-no-tani.html stays byte-exact with the
// export, so its SHA-256 in docs/reference/README.md means something and §9's
// "the reference wins — read it" has one unambiguous thing to read. A local
// edit would be a place for drift to hide; six lines of visible rewrite in the
// dev server are not.
const REFERENCE = 'hoshi-no-tani.html';
const REFERENCE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
const REFERENCE_LOCAL = '/docs/reference/vendor/three-0.180.0/three.module.js';

/** the repo, served exactly as `python3 -m http.server` would serve it —
 *  save for the one documented rewrite above */
export async function serve(root = REPO, port = 0) {
  const server = createServer(async (req, res) => {
    try {
      const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
      const file = join(root, rel);
      if (!file.startsWith(root)) { res.writeHead(403).end(); return; }
      let body = await readFile(file);
      if (file.endsWith(REFERENCE)) {
        body = Buffer.from(String(body).replace(REFERENCE_CDN, REFERENCE_LOCAL));
      }
      res.writeHead(200, {
        'content-type': MIME[extname(file)] || 'application/octet-stream',
        'cache-control': 'no-store',
      }).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((ok) => server.listen(port, '127.0.0.1', ok));
  const bound = server.address().port;
  return { origin: `http://127.0.0.1:${bound}`, close: () => new Promise(r => server.close(r)) };
}

/** playwright lives wherever it lives; a missing one is a one-line fix, so
 *  say the line rather than dumping a module-resolution stack */
export async function playwright() {
  const require = createRequire(import.meta.url);
  const candidates = ['playwright', 'playwright-core'];
  for (const name of candidates) {
    try { return await import(name); } catch { /* keep looking */ }
  }
  for (const root of [process.env.NODE_PATH, '/usr/lib/node_modules', '/usr/local/lib/node_modules',
    process.execPath.replace(/\/bin\/node$/, '/lib/node_modules')]) {
    if (!root) continue;
    for (const name of candidates) {
      try { return await import(require.resolve(join(root, name, 'index.mjs'))); } catch { /* keep looking */ }
    }
  }
  throw new Error(
    'Playwright not found. These tools are dev-only and deliberately unpackaged:\n'
    + '    npm i -g playwright && npx playwright install chromium\n'
    + 'The runtime stays dependency-free either way (CLAUDE.md §2.2).');
}

/** the three rows of §5, expressed as the only knobs that exist today:
 *  viewport and device pixel ratio. The real four-row quality table (§5)
 *  lands with the renderer rework — until then a tier is a device, not a
 *  configuration, and this file must not pretend otherwise. */
export const TIERS = {
  desktop: { viewport: { width: 2560, height: 1440 }, deviceScaleFactor: 1, label: 'desktop ref @1440p' },
  mobile: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, label: 'mobile ref, DPR 2' },
  low: { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, label: 'low tier @720p' },
};

export async function launch(pw) {
  return pw.chromium.launch({
    args: [
      '--use-gl=angle', '--use-angle=default', '--enable-unsafe-swiftshader',
      '--no-sandbox', '--disable-dev-shm-usage', '--enable-gpu-rasterization',
      '--ignore-gpu-blocklist',
    ],
  });
}

export function arg(name, fallback = null) {
  const i = process.argv.indexOf('--' + name);
  if (i < 0) return fallback;
  const next = process.argv[i + 1];
  return next && !next.startsWith('--') ? next : true;
}
