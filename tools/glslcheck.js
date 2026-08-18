// The fast half of §M0's compile gate.
//
//   node tools/glslcheck.js
//
// `shadercheck.js` is the honest one: it flies the universe and compiles every
// program the renderer actually assembles. On real silicon that finishes; on a
// software rasteriser it does not, and even in station mode it can only compile
// the shaders a *particular world on a particular day* happens to build. A
// shader that exists only when a world is in flower — `blossom.js`'s falling
// petals — is invisible to it on most worlds and on every world out of season.
//
// So this is the other end of the same rule. Every shader the codebase exports
// as a complete `{ vert, frag }` pair is compiled here, in a real driver, in
// about ten seconds, on any machine, whatever the season. It proves the string
// compiles; it does not prove the frame is right. That is what captures are for.
//
// The other `*_GLSL` exports — `PAINT_GLSL`, `OCEAN_GLSL`, `WIND_GLSL` and the
// rest — are deliberately *not* here. They are chunks, meant to be interpolated
// into a host program that declares the uniforms they read, and compiling one
// alone would either fail for reasons that are not defects or need a fake host
// that is not the real one. §M0 is explicit that a chunk must be checked after
// assembly, which is `shadercheck.js`'s job and cannot be this one's.
//
// The exported-constant discipline is the point and not an accident: a shader
// reachable only from inside a build function is a shader that can only be
// checked by reproducing the world that builds it.

import { arg, launch, playwright, serve } from './lib.js';

/**
 * What to compile, and what to compile it as.
 *
 * `uniforms` only has to be *shaped* right — three needs a value to infer each
 * uniform's type. The numbers are never read.
 */
const SUBJECTS = [
  {
    name: 'blossom · falling petals',
    module: '/src/blossom.js',
    exportName: 'PETAL_GLSL',
    kind: 'points',
    attributes: { aPh: 2 },
    uniforms: {
      uTime: 0, uCam: [0, 0, 0], uBox: 44, uBoxY: 26, uSpeed: 6, uFlutter: 0.9,
      uPeriod: 1.5, uR: 0.03, uH: 900, uColor: [1, 1, 1], uDay: 1, uOpen: 1,
      uDrift: [0, 0],
    },
  },
];

const PAGE = (origin, subjects) => `
import * as THREE from '${origin}/vendor/three.module.js';
const out = [];
const cv = document.createElement('canvas');
cv.width = 64; cv.height = 64;
const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false });
renderer.debug.checkShaderErrors = true;
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
camera.position.z = 4;

const errs = [];
const realError = console.error;
console.error = (...a) => { errs.push(a.map(String).join(' ')); realError(...a); };

for (const sub of ${JSON.stringify(subjects)}) {
  const before = errs.length;
  try {
    const mod = await import('${origin}' + sub.module);
    const glsl = mod[sub.exportName];
    if (!glsl || !glsl.vert || !glsl.frag) {
      out.push({ name: sub.name, ok: false, info: sub.exportName + ' is not { vert, frag }' });
      continue;
    }
    const uniforms = {};
    for (const [k, v] of Object.entries(sub.uniforms)) {
      uniforms[k] = { value: Array.isArray(v)
        ? (v.length === 2 ? new THREE.Vector2(...v) : new THREE.Vector3(...v)) : v };
    }
    const mat = new THREE.ShaderMaterial({
      uniforms, vertexShader: glsl.vert, fragmentShader: glsl.frag, transparent: true,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    for (const [a, n] of Object.entries(sub.attributes || {})) {
      geo.setAttribute(a, new THREE.BufferAttribute(new Float32Array(3 * n), n));
    }
    const obj = sub.kind === 'points' ? new THREE.Points(geo, mat) : new THREE.Mesh(geo, mat);
    obj.frustumCulled = false;
    scene.add(obj);
    renderer.render(scene, camera);
    renderer.render(scene, camera);
    scene.remove(obj);
    out.push({ name: sub.name, ok: errs.length === before, info: errs.slice(before).join('\\n') });
  } catch (e) {
    out.push({ name: sub.name, ok: false, info: String((e && e.stack) || e) });
  }
}
console.error = realError;
window.__GLSLCHECK = { out, gl: renderer.getContext().getParameter(renderer.getContext().VERSION) };
`;

const site = await serve();
const browser = await launch(await playwright());
const page = await browser.newPage({ viewport: { width: 64, height: 64 } });
page.on('pageerror', (e) => console.error('  page error:', String(e)));

await page.goto(`${site.origin}/index.html?boot=0`, { waitUntil: 'domcontentloaded' });
await page.addScriptTag({ type: 'module', content: PAGE(site.origin, SUBJECTS) });
await page.waitForFunction('window.__GLSLCHECK', null, { timeout: Number(arg('timeout', 90)) * 1000 });
const res = await page.evaluate(() => window.__GLSLCHECK);

console.log(`\nglslcheck · ${res.gl}`);
let bad = 0;
for (const r of res.out) {
  console.log(`  ${r.ok ? 'ok  ' : 'FAIL'} ${r.name}`);
  if (!r.ok) { bad++; console.log(r.info.split('\n').map((l) => '        ' + l).join('\n')); }
}
console.log(`\n${res.out.length - bad}/${res.out.length} exported shaders compile`);

await browser.close();
await site.close();
process.exit(bad ? 1 : 0);
