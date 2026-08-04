// The wind, made available — CLAUDE.md §6 M3 act 2.
//
// `src/wind.js` is the field: its arithmetic, its CPU mirror, its GLSL. It
// imports no three, which is what lets `tools/verify.js` hold the mirror and
// the shader to the same numbers. This file is where that field meets a GPU —
// the render target it evaluates into, the height texture its terrain coupling
// reads, and the uniform block everything downstream samples.
//
// Grass arrives in act 3 and lives here too, which is why the file is
// `flora.js` rather than `windfield.js`: the render target is not a system of
// its own, it is the field made available to the things that read it, and those
// things are what this file is about.
//
// ---------------------------------------------------------------------------
// The height texture, and why it is not a second evaluation of the ground
//
// §6 M3's third ingredient needs terrain: speed-up over crests, shelter in the
// lee, deflection along contours. All three want `heightAt` inside a fragment
// shader, and AEON has no GLSL height function at surface scale — heights live
// in vertex positions and in `ground.heightAt` on the CPU.
//
// So the ground is baked once into a texture. Two things make that honest
// rather than a shortcut:
//
//   · It is the **same function**, tabulated. `ground.js` owns the one
//     definition of walkable ground (§2.7's discipline, one level up), and this
//     samples that definition rather than re-deriving it. Nothing can disagree,
//     because there is nothing else to disagree with.
//
//   · The resolution is chosen against what the coupling actually varies by,
//     not against what looks generous. The crest filter is a ±58 m stencil and
//     the shelter lookup is 48 m upwind; at 192² over ±1400 m a texel is 14.6 m,
//     which is a quarter of the finest term. The gradient stencil moves from
//     the reference's ±7 m to one texel, because a finer stencil on a 14.6 m
//     table is reading interpolation rather than terrain.
//
// The cost matters and is why the resolution is not higher: `heightAt` runs at
// roughly 4.6 µs in the browser (measured — `src/horizon.js` does 16k samples
// in 74 ms), so 192² is about 170 ms at load. 512² would be 1.2 s against §5's
// 2.5 s to interactive, for detail the coupling cannot use.

import * as THREE from 'three';
import {
  HEIGHT_RES, WIND_FIELD_GLSL, WIND_NOISE_GLSL, WIND_SAMPLE_GLSL, WIND_SPAN,
  bakeHeight, windUniforms,
} from './wind.js';

/**
 * How often the field is re-evaluated, in frames.
 *
 * The reference's own reasoning, and its own number: *"the wind field and the
 * sun shadow both change slowly compared with the camera, so they run at half
 * rate on alternate frames — invisible, and it takes two whole passes off most
 * frames."* It interleaves three auxiliary passes one per frame so each frame
 * pays for one, and notes that nothing then updates slower than 20 Hz.
 *
 * At 288² with four octaves of curl noise at three taps each, the pass is about
 * a million noise evaluations. That is not free on a phone, and the eye cannot
 * follow a gust front at 60 Hz any better than at 20.
 */
export const WIND_PHASE = 3;

const FS_QUAD_VERT = /* glsl */`
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

/** the height sampler `WIND_FIELD_GLSL` expects to find */
const HEIGHT_GLSL = /* glsl */`
  uniform sampler2D uHeightTex;
  uniform vec2 uHeightOrigin;
  uniform float uHeightSpan;
  float wTerrainH(vec2 p) {
    vec2 uv = (p - uHeightOrigin) / uHeightSpan + 0.5;
    return texture(uHeightTex, clamp(uv, vec2(0.0), vec2(1.0))).r;
  }
`;

const FIELD_FRAG = /* glsl */`
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform vec2 uWindOrigin;
  ${WIND_NOISE_GLSL}
  ${HEIGHT_GLSL}
  ${WIND_FIELD_GLSL}
  void main() {
    vec2 p = uWindOrigin + (vUv - 0.5) * ${WIND_SPAN.toFixed(1)};
    outColor = windField(p, uWindTime);
  }
`;

/**
 * The debug view the reference carries and §6 M3's gate needs: `?windview=1`.
 *
 * A gust front is a thing you can only judge by watching one cross the frame,
 * and on a scale where grass does not exist yet there is nothing else to watch.
 * Speed as a cool-to-warm ramp, the excitement channel in red.
 */
const VIEW_FRAG = /* glsl */`
  precision highp float;
  in vec2 vUv;
  out vec4 outColor;
  uniform sampler2D uWindTex;
  uniform float uMean;
  void main() {
    vec4 w = texture(uWindTex, vUv);
    float s = length(w.rg) / max(uMean, 0.3);
    vec3 c = mix(vec3(0.06, 0.12, 0.22), vec3(0.95, 0.86, 0.55), smoothstep(0.3, 1.9, s));
    c = mix(c, vec3(1.0, 0.42, 0.32), smoothstep(0.4, 1.8, w.a));
    float g = (fract(vUv.x * 24.0) < 0.02 || fract(vUv.y * 24.0) < 0.02) ? 0.25 : 0.0;
    outColor = vec4(c + g, 1.0);
  }
`;

/**
 * The field on the GPU.
 *
 * `origin` follows the camera, **snapped to a texel**. Unsnapped, every texel
 * resamples a slightly different world point each frame, and anything reading
 * the target bilinearly — which is everything — gets a shimmer that looks like
 * turbulence and is not. Snapping costs two `floor`s and removes it entirely.
 */
export class WindField {
  constructor(renderer, wind, { heightAt = null, extent = 1400, size = 256 } = {}) {
    this.renderer = renderer;
    this.wind = wind;
    this.size = size;
    this.frame = 0;
    this.origin = new THREE.Vector2(0, 0);

    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false,
      stencilBuffer: false,
    });

    let heightTex = null;
    this.bake = null;
    if (heightAt) {
      this.bake = bakeHeight(heightAt, extent);
      heightTex = new THREE.DataTexture(this.bake.data, this.bake.res, this.bake.res,
        THREE.RedFormat, THREE.FloatType);
      heightTex.minFilter = THREE.LinearFilter;
      heightTex.magFilter = THREE.LinearFilter;
      heightTex.wrapS = THREE.ClampToEdgeWrapping;
      heightTex.wrapT = THREE.ClampToEdgeWrapping;
      heightTex.needsUpdate = true;
    }
    this.heightTex = heightTex;

    this.uniforms = {
      ...windUniforms(wind, 0, !!heightAt),
      uWindOrigin: { value: this.origin },
      uHeightTex: { value: heightTex },
      uHeightOrigin: { value: new THREE.Vector2(0, 0) },
      uHeightSpan: { value: extent * 2 },
    };

    this.scene = new THREE.Scene();
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: this.uniforms,
      vertexShader: FS_QUAD_VERT,
      fragmentShader: FIELD_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
  }

  /**
   * Evaluate the field. Returns true if it actually ran.
   *
   * The phase argument is the reference's interleave: one auxiliary pass per
   * frame rather than all of them every frame. Pass `force` for the first frame,
   * because a target nobody has written to is not slow, it is wrong.
   */
  update(t, camX = 0, camZ = 0, { force = false, phase = WIND_PHASE } = {}) {
    this.frame++;
    if (!force && this.frame % phase !== 0) return false;
    const texel = WIND_SPAN / this.size;
    this.origin.set(Math.round(camX / texel) * texel, Math.round(camZ / texel) * texel);
    this.uniforms.uWindTime.value = t;
    const prev = this.renderer.getRenderTarget();
    this.renderer.setRenderTarget(this.target);
    this.renderer.render(this.scene, this.camera);
    this.renderer.setRenderTarget(prev);
    return true;
  }

  /** what a consumer's material needs to call `windSample()` */
  sampleUniforms() {
    return {
      ...windUniforms(this.wind, this.uniforms.uWindTime.value, !!this.heightTex),
      uWindTex: { value: this.target.texture },
      uWindOrigin: this.uniforms.uWindOrigin,
    };
  }

  /** the GLSL a consumer includes, in dependency order */
  static get GLSL() {
    return WIND_NOISE_GLSL + WIND_FIELD_GLSL + WIND_SAMPLE_GLSL;
  }

  /** a full-screen debug view of the field — `?windview=1` */
  viewMaterial() {
    return new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        uWindTex: { value: this.target.texture },
        uMean: { value: this.wind.base },
      },
      vertexShader: FS_QUAD_VERT,
      fragmentShader: VIEW_FRAG,
      depthTest: false,
      depthWrite: false,
    });
  }

  dispose() {
    this.target.dispose();
    this.heightTex?.dispose();
    this.material.dispose();
  }
}
