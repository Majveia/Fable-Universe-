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
    /**
     * An optional surface law — §9.2 said "one function", not "one surface".
     *
     * `paint()` decides how a fragment is lit and has never had any way to be
     * told what the fragment is *made of*: every prop arrives as three flat
     * stops, so a station deck and the handrail bolted to it travel the same
     * hue path at the same value with nothing between them. §8's blind run
     * scored materials 1 and 2 and named this.
     *
     * A detail layer is `{ pars, vertex, fragment, key }` — see
     * `greebleDetail()` in `src/greeble.js`, which is the only producer today.
     * Its fragment block runs after three's normals are final and before
     * `paint()` reads them, and it speaks to `paint()` through exactly four
     * globals plus the normal. It cannot reach the light model any other way,
     * which is the point: the stops, the bands, the rim and the ambient
     * rotation stay §9.2's, and the surface only gets to say how much of each.
     */
    detail = null,
  } = look;

  const mat = new THREE.MeshStandardMaterial({ roughness: 1, ...params });

  // A part set that never went through `bakeSurface()` has no `aHull`, and
  // (0,0) is exactly "no occlusion, no exposed edge" — so an object built from
  // the same kit without the bake is plain, not fully shadowed.
  if (detail) {
    mat.defaultAttributeValues = Object.assign({}, mat.defaultAttributeValues, { aHull: [0, 0] });
  }

  /**
   * §9.3, and why it has to be *here* rather than in `applyAerial()`.
   *
   * `src/aerial.js` already has a general injector, and it already does the
   * right thing for every material three owns: it injects at
   * `#include <opaque_fragment>`, which is where `gl_FragColor` first exists and
   * is before three's tonemapping and colour-space chunks, because the air
   * scatters linear light.
   *
   * This file injects at `#include <dithering_fragment>`, which is the *last*
   * chunk in the chain — chosen so that alpha test, alpha map and fog have all
   * run before the colour is replaced. Run both on one material and the order is
   * opaque_fragment, aerial, ..., dithering_fragment, paint — so `paint()`
   * overwrote the fog that `applyAerial()` had been careful to compute early.
   * Every boulder, plant, tree, settlement and sky-whale sat at its true
   * distance in depth and at zero distance in colour. `docs/notes/props.md`
   * records it as the seventh wiring of that shape: an injection point chosen
   * for a reason, and the reason undone two lines later.
   *
   * The fix is ordering, not a second fog. `paint()` is the last thing that
   * writes colour, so the air goes immediately after it, in the same block, out
   * of the same `AERIAL_GLSL` the terrain and the ocean use, off the same
   * uniform block — so a prop and the ground behind it cannot disagree about how
   * far away the horizon is. A material that gets the air here marks itself
   * `userData.aerial`, which is exactly the flag `applyAerial()` already checks
   * to stay idempotent, so the general injector leaves it alone.
   *
   * Still linear at that point, which is what makes this legal: under §M2 the
   * scene renders into a HalfFloat composer target with
   * `renderer.toneMapping = NoToneMapping`, so `tonemapping_fragment` and
   * `colorspace_fragment` are both no-ops and the value `paint()` writes is the
   * same linear radiance `aerial()` expects.
   */
  const air = wiring.air || null;
  // Additive and transparent surfaces keep their coverage: alpha there already
  // carries how much of the pixel the glow covers, and §9.3's clarity written
  // over it makes a lantern opaque. `_dressAerial()` makes the same call for
  // the materials it dresses, by the same test.
  const veil = !!(mat.transparent || mat.blending === THREE.AdditiveBlending);
  if (air) (mat.userData ||= {}).aerial = veil ? 'paint-veil' : 'paint';
  const v3 = (c) => ({ value: new THREE.Vector3(c[0], c[1], c[2]) });

  const own = {
    uPaintShade: v3(shade), uPaintMid: v3(mid), uPaintLit: v3(lit),
    uPaintTransCol: v3(transCol),
    uPaintSoft: { value: soft }, uPaintJit: { value: jit },
    uPaintRim: { value: rim }, uPaintAO: { value: ao },
    uPaintAmb: { value: ambient }, uPaintTrans: { value: trans },
    uPaintSunW: wiring.sun,
  };
  /**
   * The two numbers only the call site can know, and §11's unit trap is why
   * they are uniforms rather than constants.
   *
   * `uGreebleU2M` is object units to metres — `planetscale.js` and `craft.js`
   * disagree about what a unit is and are both right for their own scale, so
   * the detail law is written in metres and converted once in the vertex
   * shader. `uGreebleBump` is how many view-space units one metre of surface
   * relief is: a groove authored at twenty millimetres and handed to a
   * derivative taken in kilometres perturbs the normal by a factor of a
   * thousand, and the surface dissolves into crawling static.
   */
  if (detail) {
    own.uGreebleU2M = { value: look.u2m ?? 1 };
    own.uGreebleBump = { value: look.bumpScale ?? 1 };
  }
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
    if (detail) {
      // `place()` de-indexes and strips every attribute but position, normal
      // and uv, so `aHull` is the one channel the bake adds back and the only
      // one declared here.
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          attribute vec2 aHull;
          uniform float uGreebleU2M;
          ${detail.pars.match(/varying[^;]*;/g).join('\n')}`)
        .replace('#include <begin_vertex>', detail.vertex);
    }

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
    }, wiring.shadow || {}, own, air ? air.uniforms : {});

    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `
        ${detail ? detail.pars + '\nuniform float uGreebleBump;' : ''}
        ${PAINT_GLSL}
        ${wiring.shadowGLSL || 'float sunShadow(vec3 wp, float ndl) { return 1.0; }'}
        varying vec3 vPaintW;
        uniform vec3 uPaintShade; uniform vec3 uPaintMid; uniform vec3 uPaintLit;
        uniform vec3 uPaintTransCol; uniform vec3 uPaintSunW;
        uniform float uPaintSoft; uniform float uPaintJit; uniform float uPaintRim;
        uniform float uPaintAO; uniform float uPaintAmb; uniform float uPaintTrans;
        ${air ? `uniform vec3 uCam;\n${air.glsl}` : ''}
        void main() {
          // Neutral by construction: with no detail layer these are exactly
          // what paint() was handed before this hook existed, so the block
          // below is dead code rather than a different answer.
          vec3 gDetailTint = vec3(1.0);
          float gDetailFade = 0.0;
          float gDetailAO = 1.0;
          float gDetailJit = 0.0;
      `);

    if (detail) {
      /* `<normal_fragment_maps>` and not `<map_fragment>`, which is where the
         reference puts it. Two reasons, and the second is the load-bearing one.

         `normal` is not final until this chunk has run, and the surface law
         perturbs it — a seam that does not catch the key is a printed pattern,
         which is the whole failure being fixed. Injecting earlier would
         perturb a normal three then overwrites.

         And `paint()` never reads `diffuseColor`. It builds its colour from
         three stops, so the reference's approach — compose an albedo and let
         the lighting chain multiply it — would have every one of these terms
         silently thrown away at `<dithering_fragment>`. That is the exact
         shape of the bug the guard at the top of this function exists to
         catch, so it gets a guard too. */
      if (!shader.fragmentShader.includes('#include <normal_fragment_maps>')) {
        console.error('[painted] fragment shader has no #include <normal_fragment_maps> — '
          + 'the surface law is NOT being applied and every plated object is flat.');
      }
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <normal_fragment_maps>',
          '#include <normal_fragment_maps>\n' + detail.fragment);
    }

    shader.fragmentShader = shader.fragmentShader
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
          /* The stops, as the surface leaves them.
             gDetailTint multiplies all three, so a groove, a grimy plate and
             a panel rolled in a different year are the same colour travelling
             the same hue path, darker — §9.1's one palette, not a second one.
             gDetailFade desaturates them toward their own luminance, because
             paint that has chalked in vacuum has lost chroma and not value,
             and no multiply can express that. Both are 1.0 and 0.0 with no
             detail layer. */
          vec3 dShade = uPaintShade * gDetailTint;
          vec3 dMid = uPaintMid * gDetailTint;
          vec3 dLit = uPaintLit * gDetailTint;
          const vec3 LUMA = vec3(0.2126, 0.7152, 0.0722);
          sf.shade = mix(dShade, vec3(dot(dShade, LUMA)), gDetailFade);
          sf.mid = mix(dMid, vec3(dot(dMid, LUMA)), gDetailFade);
          sf.lit = mix(dLit, vec3(dot(dLit, LUMA)), gDetailFade);
          sf.soft = uPaintSoft;
          // The painterly wobble is per *fragment*, not per material: a band
          // edge that is identical on every instance reads as a contour line
          // drawn across the whole field, which is the one way this effect
          // looks like the quantisation bug it resembles (§11).
          // A detail layer adds to the amplitude, so the ragged paint boundary
          // lands on the corners the bake found chipped rather than being
          // uniform over the whole surface.
          sf.jit = (uPaintJit + gDetailJit) * (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5);
          // Not getShadowMask(): that lives in three's lambert/phong chunk set
          // and does not exist in a standard material, which is a compile error
          // rather than a fallback. This is the terrain's map, so the ground and
          // the things on it are shadowed by one pass.
          sf.shadow = sunShadow(vPaintW, dot(sf.N, sf.L));
          sf.trans = uPaintTrans; sf.transCol = uPaintTransCol;
          sf.rim = uPaintRim; sf.ao = uPaintAO * gDetailAO; sf.ambient = uPaintAmb;
          gl_FragColor.rgb = paint(sf);
          ${air ? `
          // World space, because that is what the air is measured in — and the
          // same vPaintW the shadow lookup uses, so a prop's haze and its
          // shadow cannot be computed about two different points.
          vec3 airToCam = uCam - vPaintW;
          float airDist = length(airToCam);
          vec4 aerialOut = aerial(gl_FragColor.rgb, airDist,
            airDist > 1e-5 ? airToCam / airDist : vec3(0.0, 1.0, 0.0),
            normalize(uPaintSunW), vPaintW.y);
          ${veil ? 'gl_FragColor.rgb = aerialOut.rgb;' : 'gl_FragColor = aerialOut;'}
          ` : ''}
        }
        #include <dithering_fragment>
      `);
  };
  // Two materials that compile to different programs must not share a cache
  // key. three appends this to its own parameter hash, so it only has to
  // separate what three cannot see — and whether §9.3 was injected is exactly
  // that: two props identical in every material property, one fogged and one
  // not, would otherwise be handed the same program and which one won would
  // depend on render order.
  const key = `painted-v1${air ? (veil ? '+air-veil' : '+air') : ''}${detail ? '+' + detail.key : ''}`;
  mat.customProgramCacheKey = () => key;
  return mat;
}
