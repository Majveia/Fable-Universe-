// The wind, resident on the GPU — CLAUDE.md §M3, docs/plans/M3.md step 2.
//
// `src/wind.js` is the field. This is the copy of it that twelve million grass
// vertices can afford to read: a 256² render target over a 440 m window that
// follows the camera, holding the velocity and gust weight at every point, so a
// blade costs one texture fetch instead of four octaves of simplex noise.
//
// The numbers are the reference's, ported as technique (§10). Its span is 440 m
// and its resolution 256, which is 1.72 m per texel — and that is not an
// arbitrary trade. The finest thing the field contains is a gust front's
// leading edge, `smoothstep(0.14, 0, u)` over a cell length of 26 to 60 m,
// so between 3.6 m and 8.4 m wide: two to five texels. Coarser and the fronts
// §M3's gate asks to be *legible* would arrive as a step; finer and the pass
// costs more than the vertices it saves.
//
// ---------------------------------------------------------------------------
// Three decisions worth stating, because each has a wrong-looking alternative
//
// **The window snaps to whole texels.** If the origin tracked the camera
// continuously, the lattice the field is sampled on would slide under the world
// and a blade standing still would read a slightly different point every frame.
// That reads as a shimmer that no amount of filtering removes, because the
// error is in the sampling and not in the filter. Snapping means the window
// slides in whole texels and a stationary blade reads a fixed point — the same
// reason `shadow.js` snaps its own centre, recorded there for the same reason.
//
// **Half float, and linear filtering.** A 16-bit float resolves about 0.008 m/s
// at 10 m/s, which sounds marginal against a 2/255 gate until you notice what
// dominates: the target is a 1.72 m lattice with bilinear interpolation
// between, so its error against the true field is *interpolation* error, orders
// above the storage. Full float would buy nothing and would cost
// `OES_texture_float_linear`, which mobile does not reliably have — and a field
// sampled with NEAREST would show its own texels as facets in the grass.
//
// **The pass writes metres per second, unnormalised.** There is no encoding to
// get wrong, no scale uniform to drift, and half-float carries ±65504 so the
// range was never in question. `windScale` still exists for the parity gate,
// which needs a full scale to express a tolerance against; storage does not.
//
// ---------------------------------------------------------------------------
// What is not here yet
//
// The analytic fallback beyond the window's edge, and its blend mask — that is
// docs/plans/M3.md step 3, gated on the seam. Until then sampling outside the
// window clamps to the edge, which is wrong in a way that is invisible with no
// consumers and would be very visible with them. Step 4 is the first step that
// may read this.

import * as THREE from 'three';
import {
  WIND_SIZE, WIND_SPAN, WIND_GLSL, syncWindUniforms, windUniformBlock, windWindow,
} from './wind.js';
import { noiseGLSL } from './planet.js';


/**
 * The chunk a consumer includes to read the target.
 *
 * `uWindWin` is `(originX, originZ, 1/span)` — one uniform rather than three,
 * because every consumer will carry it and a vertex shader's uniform budget is
 * a real budget. The boundary layer is *not* applied here: `windShear` from
 * `WIND_GLSL` is one `log` of a height the caller knows, and keeping it out of
 * the target is what lets a blade fetch once at its root and shear per vertex.
 */
export const WINDTEX_GLSL = /* glsl */`
uniform sampler2D uWindTex;
uniform vec3 uWindWin;      // (origin.x, origin.z, 1.0 / span)

float windShearTex(float h) {
  return log((max(h, 0.015) + 0.06) / 0.06) * 0.19523;
}

vec3 windTex(vec2 P) {
  vec2 uv = (P - uWindWin.xy) * uWindWin.z;
  return texture2D(uWindTex, uv).xyz;
}
`;

// GLSL3 out of necessity (see the material below), so written as GLSL3: `out`
// in the vertex stage, `in` and an explicit output in the fragment stage.
// three.js does **not** supply a `gl_FragColor` shim in this mode — writing to
// it compiles to `undeclared identifier`, the program silently falls back, and
// the target reads as a field of exact zeros, which is the shape of a bug that
// looks like an addressing error. `collision.js` and `nbody.js` declare their
// own `out vec4` for the same reason.
const FIELD_VERT = /* glsl */`
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const FIELD_FRAG = (noise) => /* glsl */`
  precision highp float;
  in vec2 vUv;
  out vec4 frag;
  uniform vec3 uWindWin;
${noise}
${WIND_GLSL}
  void main() {
    // the texel's own world point, from the same window the sampler uses
    vec2 P = uWindWin.xy + vUv / uWindWin.z;
    frag = vec4(windField(P), 1.0);
  }
`;

export class WindField {
  // No renderer here: a render target does not need one to exist, only to be
  // drawn into, and `shadow.js` defers for the same reason — the surface owns
  // its renderer through `app`, which is not settled at construction time.
  constructor(wind, { size = WIND_SIZE, span = WIND_SPAN } = {}) {
    this.wind = wind;
    this.size = size;
    this.span = span;

    this.rt = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });

    // The block the *pass* writes with, and the block consumers read with, are
    // deliberately the same object for `uWindWin`: one window, so a consumer
    // cannot be reading last frame's origin against this frame's texels.
    this.uniforms = {
      uWindTex: { value: this.rt.texture },
      uWindWin: { value: new THREE.Vector3(0, 0, 1 / span) },
    };

    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    // `noiseGLSL(true)`, never `NOISE_GLSL`: src/wind.js pins the exact gradient
    // path on the CPU and this is the other half of that pair. Taking whatever
    // `?intnoise` selected would make the field agree with its CPU twin only on
    // builds that happened to pass the flag.
    this.material = new THREE.ShaderMaterial({
      // GLSL3, and not by preference: the exact gradient path is written in
      // integers — `ivec4`, `%`, integer division — and GLSL ES 1.00 has none
      // of them. That is the same reason planet.js gives for `?intnoise=1`
      // being a WebGL2-only fix.
      glslVersion: THREE.GLSL3,
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_FRAG(noiseGLSL(true)),
      uniforms: { ...windUniformBlock(), uWindWin: this.uniforms.uWindWin },
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    quad.frustumCulled = false;
    this.scene.add(quad);
  }

  /** one pass, once per frame, before anything samples it */
  update(renderer, t, camX, camZ) {
    const [ox, oz] = windWindow(camX, camZ);
    this.uniforms.uWindWin.value.set(ox, oz, 1 / this.span);
    syncWindUniforms(this.material.uniforms, this.wind, t);

    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(this.rt);
    renderer.render(this.scene, this.cam);
    renderer.setRenderTarget(prev);
  }

  dispose() {
    this.rt.dispose();
    this.material.dispose();
    this.scene.clear();
  }
}
