// §9.2, for everything that is not the ground — CLAUDE.md §9.2, §2.1, §8 axis 2.
//
// §9.2 opens with a claim the codebase did not keep:
//
//   "The heart of it. Every lit surface goes through one function."
//
// `paint()` reaches the terrain, the ocean and the sky. It reaches nothing
// else. Every *object* standing on a world — every boulder, blade, frond,
// trunk, wall, roof and animal — was lit by three's stock `MeshStandardMaterial`,
// which is a physically-based reflectance model and is the exact instinct §11
// warns about by name.
//
// The result is legible in any surface capture and is the first thing anyone
// says about one: the ground is a painting and the things standing on it are
// grey props. A prop lit by PBR under a 13 degree sun has a bright top and a
// side that falls to near-black, because plain Lambert at grazing incidence
// *is* near-black and nothing is filling it. §M2's gate names that failure in
// those words — "a shadowed surface anywhere in frame that has gone
// achromatic-dark is a failure" — and §8 axis 2 asks it as a question: is any
// surface receiving no light information at all?
//
// So this file is the bridge. It hands `PAINT_GLSL` to an ordinary
// `MeshStandardMaterial` through `onBeforeCompile`, which keeps every piece of
// three's plumbing that is genuinely wanted — instancing, the shadow map, depth
// sorting, fog hooks — and replaces only the last step, where the colour is
// decided. One function, finally.
//
// ---------------------------------------------------------------------------
// The alpha that was never generated
//
// The second half is a bug rather than a design gap, and it is responsible for
// more ugliness than anything else in a surface frame.
//
// `ground-cover.js` builds its plants as cards — four vertices, per the
// reference — and says so:
//
//     // Plants are cards, per the reference — a card is four vertices
//     // whatever it is a picture of.
//
// `scatter.js` says the rest of it: the shape "lives in alpha, not in
// geometry." The material was built with `alphaTest: 0.35` and **no alphaMap
// and no map**, on any world, ever. Alpha is uniformly 1.0, the test passes at
// every texel, and every plant in the universe rendered as an opaque
// rectangle: a few hundred hard-edged quads per frame, at every angle, in flat
// dark green. The intent was in the comments and the picture was never in the
// repo.
//
// §2.1 says where the picture has to come from — "every texture is generated
// on-device at init from `hash(seed, …)`" — so `cardMask()` draws the six
// silhouettes analytically into a `DataTexture`. Six 64x64 RGBA masks is 96 KB
// of device memory and zero bytes shipped.
//
// Note `.g`: three r170's `alphamap_fragment` reads the **green** channel
// (`diffuseColor.a *= texture2D( alphaMap, vAlphaMapUv ).g`), so the coverage
// goes in every channel rather than only in alpha, where nothing would read it.

import * as THREE from 'three';
import { PAINT_GLSL } from './paint.js';
import { maskData } from './silhouette.js';

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

// ---------------------------------------------------------------------------
// the silhouette, wrapped for the GPU
//
// The shapes themselves are `src/silhouette.js`, which has no `three` in it so
// that `tools/verify.js` can assert things about them — the repo already draws
// that line between `scatter.js` (arithmetic, tested) and this file (meshes,
// not testable in Node), and the six analytic plant shapes are exactly the
// kind of thing that must not end up on the wrong side of it.

/** one species' silhouette as a `DataTexture`, ready for `alphaMap` */
export function cardMask(kind, seed, size = 64) {
  const tex = new THREE.DataTexture(maskData(kind, seed, size), size, size, THREE.RGBAFormat);
  tex.needsUpdate = true;
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  // A card seen edge-on at 40 m is sampled at a grazing angle, and without
  // anisotropy the mip chain blurs a tuft into a grey smear — which reads as
  // haze lying on the ground rather than as grass.
  tex.anisotropy = 4;
  return tex;
}


// ---------------------------------------------------------------------------
// the light model, on an ordinary material

/**
 * Three stops from one colour, by the same law `material.js` uses for the
 * ground — so a boulder and the scree beside it travel the same hue path and
 * the frame reads as one palette rather than two.
 *
 * `warm` and `cool` are how far the lit and shade ends run toward the sun and
 * the shadow tint. A mineral barely shifts; a leaf shifts a great deal, and
 * that difference is most of what makes one nameable against the other
 * (§8 axis 5).
 */
export function stopsFrom(base, light, { warm = 0.12, cool = 0.18, range = 0.28 } = {}) {
  const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const k = (a, m) => [a[0] * m, a[1] * m, a[2] * m];
  return {
    shade: mix(k(base, 1 - range), light.shadowTint, cool),
    mid: base,
    lit: mix(k(base, 1 + range), light.sun, warm),
  };
}

/**
 * A `MeshStandardMaterial` whose colour is decided by §9.2 instead of by PBR.
 *
 * `onBeforeCompile` rather than a `ShaderMaterial`, deliberately. A
 * ShaderMaterial would have to re-implement instancing, the shadow map, morph
 * targets and depth packing, all of which are wanted and none of which are
 * interesting. This keeps all of it and overrides the one line that matters —
 * and because the material still *is* a standard material, `castShadow` and
 * `receiveShadow` and the depth prepass keep working with no special cases.
 *
 * The stops arrive as uniforms rather than as literals so that a material can
 * be retuned at runtime by the day cycle without a recompile (§11: "adaptive
 * quality mid-frame" pumps visibly, and so does a shader recompile).
 */
export function paintedStandard(params, wiring, look = {}) {
  const {
    shade, mid, lit,
    soft = 0.11, jit = 0.0, rim = 0.55, ao = 1.0, ambient = 1.0,
    trans = 0.0, transCol = [0.55, 0.72, 0.32],
  } = look;

  const mat = new THREE.MeshStandardMaterial({ roughness: 1, ...params });
  const v3 = (c) => ({ value: new THREE.Vector3(c[0], c[1], c[2]) });

  const own = {
    uPaintShade: v3(shade), uPaintMid: v3(mid), uPaintLit: v3(lit),
    uPaintTransCol: v3(transCol),
    uPaintSoft: { value: soft }, uPaintJit: { value: jit },
    uPaintRim: { value: rim }, uPaintAO: { value: ao },
    uPaintAmb: { value: ambient }, uPaintTrans: { value: trans },
    uPaintSunW: wiring.sun,
  };
  mat.userData.paint = own;

  mat.onBeforeCompile = (shader) => {
    // A missing marker is a silent no-op, not an error: `String.replace` with a
    // pattern it cannot find returns the string unchanged, the material
    // compiles perfectly, and every prop in the world quietly goes back to PBR
    // with nothing anywhere saying so. That is the exact shape of the bug this
    // file was written to fix, so it gets a guard rather than a comment.
    for (const [marker, where] of [
      ['#include <dithering_fragment>', 'fragment'],
      ['#include <project_vertex>', 'vertex'],
    ]) {
      const src = where === 'fragment' ? shader.fragmentShader : shader.vertexShader;
      if (!src.includes(marker)) {
        console.error(`[painted] ${where} shader has no ${marker} — §9.2 is NOT being applied. `
          + 'three has renamed a chunk; painted.js needs a new injection point.');
      }
    }

    // The world position, for the shadow lookup.
    //
    // `sunShadow()` is indexed in world space because the map is the terrain's
    // — one map for the ground and everything standing on it, which is the only
    // way a boulder's shadow and the ground's can agree. Computed here rather
    // than taken from three's `worldpos_vertex`, which is only emitted when an
    // envmap or a spot light happens to be in the scene.
    shader.vertexShader = shader.vertexShader
      .replace('void main() {', 'varying vec3 vPaintW;\nvoid main() {')
      .replace('#include <project_vertex>', `
        #include <project_vertex>
        {
          vec4 wp = vec4(transformed, 1.0);
          #ifdef USE_INSTANCING
            wp = instanceMatrix * wp;
          #endif
          vPaintW = (modelMatrix * wp).xyz;
        }
      `);

    // Named one by one rather than spread, and `tools/verify.js` is the reason:
    // its `suitePaintUniforms` reads the uniforms PAINT_GLSL declares straight
    // off the chunk and requires every consumer to hand over all of them by
    // name. A spread satisfies the compiler and defeats the check, and the
    // check is right — an unprovided uniform is silently 0, and uPaintExposure
    // multiplies the whole result, so the failure mode is every prop in the
    // world rendering black with nothing in the log.
    const P = wiring.paint;
    Object.assign(shader.uniforms, {
      uPaintSun: P.uPaintSun,
      uPaintAmbSky: P.uPaintAmbSky,
      uPaintAmbGnd: P.uPaintAmbGnd,
      uPaintShadowTint: P.uPaintShadowTint,
      uPaintExposure: P.uPaintExposure,
    }, wiring.shadow || {}, own);

    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `
        ${PAINT_GLSL}
        ${wiring.shadowGLSL || 'float sunShadow(vec3 wp, float ndl) { return 1.0; }'}
        varying vec3 vPaintW;
        uniform vec3 uPaintShade; uniform vec3 uPaintMid; uniform vec3 uPaintLit;
        uniform vec3 uPaintTransCol; uniform vec3 uPaintSunW;
        uniform float uPaintSoft; uniform float uPaintJit; uniform float uPaintRim;
        uniform float uPaintAO; uniform float uPaintAmb; uniform float uPaintTrans;
        void main() {
      `)
      // Last chunk in the chain, so everything three wanted to do — alpha test,
      // alpha map, fog — has already happened and only the colour is replaced.
      .replace('#include <dithering_fragment>', `
        {
          Surf sf;
          // view space throughout: 'normal' is three's shaded normal and
          // vViewPosition is the eye->fragment vector, so -normalize() of it is
          // the surface->eye direction paint() wants
          sf.N = normalize(normal);
          sf.V = normalize(vViewPosition);
          sf.L = normalize((viewMatrix * vec4(uPaintSunW, 0.0)).xyz);
          sf.shade = uPaintShade; sf.mid = uPaintMid; sf.lit = uPaintLit;
          sf.soft = uPaintSoft;
          // The painterly wobble is per *fragment*, not per material: a band
          // edge that is identical on every instance reads as a contour line
          // drawn across the whole field, which is the one way this effect
          // looks like the quantisation bug it resembles (§11).
          sf.jit = uPaintJit * (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5);
          // Not getShadowMask(): that lives in three's lambert/phong chunk set
          // and does not exist in a standard material, which is a compile error
          // rather than a fallback. This is the terrain's map, so the ground and
          // the things on it are shadowed by one pass.
          sf.shadow = sunShadow(vPaintW, dot(sf.N, sf.L));
          sf.trans = uPaintTrans; sf.transCol = uPaintTransCol;
          sf.rim = uPaintRim; sf.ao = uPaintAO; sf.ambient = uPaintAmb;
          gl_FragColor.rgb = paint(sf);
        }
        #include <dithering_fragment>
      `);
  };
  // two materials that compile to different programs must not share a cache key
  mat.customProgramCacheKey = () => 'painted-v1';
  return mat;
}
