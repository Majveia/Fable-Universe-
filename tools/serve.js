// The dev server, run by hand.
//
//   node tools/serve.js [--port 8080]
//
// `python3 -m http.server 8080` remains sufficient to run AEON and always will
// (CLAUDE.md §2.2). This exists for the one thing it cannot do: serve the art
// reference offline. The reference's importmap points at a CDN, and §8 needs
// it to *run* — so `serve()` swaps that one URL for the r180 vendored beside
// it, on the way out, leaving the file on disk byte-exact.
//
// Everything in tools/ already serves through the same function, so the
// reference runs under `capture.js` and `shadercheck.js` too. This just gives
// a human the same thing without a capture attached.

import { arg, REPO, serve } from './lib.js';

const port = Number(arg('port', 8080));
const site = await serve(REPO, port);

console.log(`\naeon · serving ${REPO}\n`);
console.log(`  the universe    ${site.origin}/`);
console.log(`  the reference   ${site.origin}/docs/reference/hoshi-no-tani.html`);
console.log(`  a measured run  ${site.origin}/?bench=1`);
console.log('\nthe reference resolves three from docs/reference/vendor/ — no network needed.');
console.log('it wants a real GPU, though: on a software rasteriser it will sit in its');
console.log('loading card for many minutes, computing rather than hanging.\n');
console.log('ctrl-c to stop.');

process.on('SIGINT', async () => { await site.close(); process.exit(0); });
