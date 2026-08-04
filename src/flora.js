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
  HEIGHT_RES, WIND_MEAN_GLSL, WIND_NOISE_GLSL, WIND_PASS_GLSL, WIND_SAMPLE_GLSL,
  WIND_SPAN, bakeHeight, windUniforms,
} from './wind.js';
import {
  MEADOW_GLSL, RINGS, bladeRoots, chunkGrid, chunkInstances, chunkNearDist,
} from './meadow.js';

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

// A RawShaderMaterial gets no preamble from three — not the attributes, not the
// matrices, not `precision`. Everything it uses it declares. Omitting these two
// is a compile error that only exists once the material is instantiated, which
// is exactly the class of defect §M0's gate is for, and exactly the class the
// bench-route traversal could not see because it never reached this scale.
const FS_QUAD_VERT = /* glsl */`
  in vec3 position;
  in vec2 uv;
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
  ${WIND_MEAN_GLSL}
  ${WIND_PASS_GLSL}
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

  /** the GLSL a *consumer* includes — the field's evaluator is not part of it */
  static get GLSL() {
    return WIND_NOISE_GLSL + WIND_MEAN_GLSL + WIND_SAMPLE_GLSL;
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

// ---------------------------------------------------------------------------
// the blades — §9.5, act 3
//
// One ring's worth, and the law from `meadow.js` wired to real geometry. What
// this act has to demonstrate before act 4 multiplies it by four is the *double
// thinning*, because that is the budget:
//
//   · coarsely on the CPU, by lowering a chunk's instance count against a
//     pre-shuffled buffer. Any prefix is a fair spatial sample, and a thinned
//     blade costs nothing at all — not even a vertex shader invocation.
//   · finely in the vertex shader, per blade, against its own true distance.
//     The CPU deliberately over-draws from the chunk's NEAREST corner, so the
//     shader can only ever remove.
//
// Removed blades collapse to their root rather than branching: every vertex
// lands on the same point, the triangles have zero area, and the rasteriser
// discards them before a fragment exists. A `return` would be a divergent
// branch on twelve million vertices; this is a multiply.

const BLADE_VERT = /* glsl */`
  in vec3 position;
  in vec2 aRoot;      // xz within the chunk
  in float aRand;     // the blade's own number: thinning, phase, variation
  in float aHeight;

  uniform mat4 projectionMatrix;
  uniform mat4 viewMatrix;
  uniform vec2 uChunkOrigin;
  uniform vec3 uCam;
  uniform float uTime;
  uniform float uHeightScale;
  uniform float uWidth;
  uniform float uForce;      // what the air can actually push with (rho U^2)

  out float vTip;
  out float vGust;
  out float vRand;

  // Only what it calls. A blade samples the field; it does not evaluate one, so
  // the gust lattice and the four-octave curl cascade have no business in a
  // shader that runs on every vertex of every blade. WIND_MEAN_GLSL is the
  // part windSample()'s analytic fallback needs.
  ${WIND_NOISE_GLSL}
  ${HEIGHT_GLSL}
  ${WIND_MEAN_GLSL}
  ${WIND_SAMPLE_GLSL}
  ${MEADOW_GLSL}

  void main() {
    vec2 world = uChunkOrigin + aRoot;
    float ground = wTerrainH(world);
    float d = length(vec3(world.x, ground, world.y) - uCam);

    // the fine thinning. Collapsing is a multiply, not a branch — see the note
    // in src/flora.js on why that matters at this vertex count.
    float live = meadowKeep(d, aRand) ? 1.0 : 0.0;

    vTip = position.y;
    vRand = aRand;

    // One sample, at one point, for every vertex of this blade. That is what
    // makes the analytic-fallback branch inside windSample() warp-coherent, and
    // §6 M3 calls that the single largest saving in this shader.
    vec4 w = windSample(world, uTime);
    vec2 flow = w.rg;
    vGust = w.a;

    float h = aHeight * uHeightScale * live;
    // the logarithmic boundary layer: roots barely move, tips whip
    float lean = windProfile(vTip * max(h, 0.05)) * uForce;
    // quasi-static balance of the wind against the blade's own stiffness, so a
    // blade bows rather than shearing — and bows most where it is thinnest
    float bend = lean * vTip * vTip * 0.16;

    vec3 p = vec3(world.x, ground, world.y);
    vec2 across = normalize(vec2(-flow.y, flow.x) + vec2(1e-6));
    p.xz += across * position.x * uWidth * live;
    p.y += vTip * h;
    p.xz += normalize(flow + vec2(1e-6)) * bend * h;
    p.y -= bend * bend * h * 0.35;      // bowing shortens it, it does not stretch

    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }
`;

const BLADE_FRAG = /* glsl */`
  precision highp float;
  in float vTip;
  in float vGust;
  in float vRand;
  out vec4 outColor;
  uniform vec3 uBase;
  uniform vec3 uTipCol;
  uniform vec3 uSunColor;

  void main() {
    // Act 3 is the law and the motion. §9.5's blade detail — the rolled
    // cross-section, the tussock clustering, the meadow mosaic, the wind flash
    // — is act 5, and putting a sketch of it here would make act 5's before and
    // after meaningless. A root-to-tip hue path and per-blade variation only.
    vec3 col = mix(uBase, uTipCol, vTip * vTip);
    col *= 0.86 + 0.28 * fract(vRand * 71.3);
    // the wind flash: a gust front turns blades edge-on and they catch the sun
    col += uSunColor * smoothstep(1.1, 2.2, vGust) * 0.12 * vTip;
    outColor = vec4(col, 1.0);
  }
`;

/**
 * One blade: a tapered strip of `seg` segments, two vertices wide.
 *
 * `seg` is the *only* thing a ring boundary changes (§9.5), which is why it is
 * a parameter here and a column in `quality.js` rather than a constant.
 */
export function bladeGeometry(seg) {
  const pos = [];
  const idx = [];
  for (let i = 0; i <= seg; i++) {
    const t = i / seg;
    const w = (1 - t) * (1 - t * 0.35) * 0.5;   // tapers, and faster near the tip
    pos.push(-w, t, 0, w, t, 0);
  }
  for (let i = 0; i < seg; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 2, a + 1, a + 3);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return g;
}

/**
 * Is a chunk's column inside the view frustum?
 *
 * A chunk is a square of ground carrying blades up to about `2·hs` metres
 * tall, so the test is a box against the six planes — and the bounding sphere
 * of that box is enough, because a false positive costs one draw call and a
 * false negative costs a hole in the meadow. Erring outward is the only safe
 * direction.
 */
export function chunkInFrustum(frustum, cx, cz, chunk, hs) {
  const x = (cx + 0.5) * chunk, z = (cz + 0.5) * chunk;
  const r = chunk * Math.SQRT1_2 + 2 * hs + 1;
  _sphere.center.set(x, 0, z);
  _sphere.radius = r;
  // a chunk's ground height is unknown here; widening the sphere by the
  // terrain's own local relief would need a height query per chunk per frame,
  // so the sphere is centred on the datum and grown to cover it
  _sphere.radius = r + 260;
  return frustum.intersectsSphere(_sphere);
}

const _sphere = new THREE.Sphere();

/**
 * A ring of chunks, thinned twice.
 *
 * ---------------------------------------------------------------------------
 * Why the blades are stratified *and* shuffled
 *
 * The reference shuffles its instance buffer so that any prefix is a fair
 * spatial sample, which is what makes coarse thinning free. Generating the
 * roots from `hash(seed, i)` would make the shuffle a no-op — a hash already
 * decorrelates index from position, so every prefix is fair and the shuffle
 * buys nothing. That would be shipping a line that looks load-bearing and is
 * not.
 *
 * So the roots are **stratified**: one blade jittered inside each cell of a
 * `g × g` grid, which covers the chunk far more evenly than uniform random —
 * no clumps, no bald patches, which at 1100 blades/m² is the difference
 * between ground and mange. Stratification makes index and position correlated
 * by construction, so the shuffle is then doing exactly the job the reference
 * describes: without it, a thinned chunk would lose whole rows.
 */
export class GrassRing {
  constructor(ring, windField, opts = {}) {
    const { seed = 1, seg = 4, density = 1, palette = null } = opts;
    this.ring = ring;
    this.spec = RINGS[ring];
    this.wf = windField;
    this.densityMul = density;
    this.grid = chunkGrid(ring);
    this.group = new THREE.Group();
    this.chunks = [];

    const n = this.spec.blades;
    const chunk = this.spec.chunk;

    const { root, rand, height } = bladeRoots(seed, n, chunk);
    for (let i = 0; i < n; i++) height[i] *= this.spec.hs;

    // One set of attribute buffers, shared by every chunk. Each chunk needs its
    // own geometry object because `instanceCount` lives on the geometry rather
    // than the mesh — but the buffers are shared, so the cost is a few objects
    // and not a few hundred megabytes.
    const shared = {
      position: null,
      index: null,
      aRoot: new THREE.InstancedBufferAttribute(root, 2),
      aRand: new THREE.InstancedBufferAttribute(rand, 1),
      aHeight: new THREE.InstancedBufferAttribute(height, 1),
    };
    const proto = bladeGeometry(seg);
    shared.position = proto.getAttribute('position');
    shared.index = proto.getIndex();

    const base = palette?.base ?? [0.24, 0.36, 0.20];
    const tip = palette?.tip ?? [0.62, 0.71, 0.34];

    // ONE material for the ring, not one per chunk.
    //
    // Act 4 built 412 chunks across four rings, each with its own
    // RawShaderMaterial. three caches programs by source, so that was still one
    // shader compile — but it was 412 uniform sets to allocate, hold and walk
    // on dispose, and the surface scale became slow enough to tear down that
    // the compile gate's *next* navigation timed out. The defect showed up as
    // "the black-hole scale was never reached", which is a symptom three files
    // away from its cause.
    //
    // The two uniforms that genuinely differ per chunk are written in
    // `onBeforeRender`, which three calls immediately before the draw and
    // before `setProgram` uploads anything — the standard way to say "same
    // shader, different transform" without minting a material to hold it.
    const mat = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        ...this.wf.sampleUniforms(),
        uChunkOrigin: { value: new THREE.Vector2(0, 0) },
        uCam: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uHeightScale: { value: 1 },
        uWidth: { value: 0.028 },
        uForce: { value: this.wf.wind.force },
        uRingDn: { value: this.spec.dn },
        uChunkNear: { value: this.spec.dn },
        uDensityMul: { value: density },
        uHeightTex: this.wf.uniforms.uHeightTex,
        uHeightOrigin: this.wf.uniforms.uHeightOrigin,
        uHeightSpan: this.wf.uniforms.uHeightSpan,
        uBase: { value: new THREE.Vector3(...base) },
        uTipCol: { value: new THREE.Vector3(...tip) },
        uSunColor: { value: new THREE.Vector3(1, 0.92, 0.78) },
      },
      vertexShader: BLADE_VERT,
      fragmentShader: BLADE_FRAG,
      side: THREE.DoubleSide,
    });
    this.material = mat;

    for (let cx = -this.grid; cx <= this.grid; cx++) {
      for (let cz = -this.grid; cz <= this.grid; cz++) {
        const geo = new THREE.InstancedBufferGeometry();
        geo.setAttribute('position', shared.position);
        geo.setIndex(shared.index);
        geo.setAttribute('aRoot', shared.aRoot);
        geo.setAttribute('aRand', shared.aRand);
        geo.setAttribute('aHeight', shared.aHeight);
        geo.instanceCount = 0;

        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.origin = new THREE.Vector2(0, 0);
        mesh.userData.near = this.spec.dn;
        mesh.onBeforeRender = () => {
          mat.uniforms.uChunkOrigin.value.copy(mesh.userData.origin);
          mat.uniforms.uChunkNear.value = mesh.userData.near;
        };
        // Distance and frustum answer *different* questions — how far, and
        // whether it is behind you — and act 3 dismissed the second on the
        // grounds that it was the first asked twice. That was wrong.
        //
        // Measured rather than guessed, because the first version of this
        // claim was a guess and it was false: of 412 chunks across four rings,
        // the distance cull leaves 208 and the frustum test leaves 112. Call
        // it 73% together. (The suite's frustum model is deliberately
        // conservative — any corner inside the half-angle, plus slack — so a
        // real six-plane test culls somewhat more, and the number quoted is
        // the one that can be defended.)
        //
        // It is still done by hand rather than by three's bounding-sphere
        // test: the chunk's world position moves every frame as the grid
        // follows the camera, so an automatic test would need the sphere
        // updated anyway, and the plane test wants the *chunk*, not the
        // instanced geometry's local bounds.
        mesh.frustumCulled = false;
        mesh.userData.noCast = true;
        this.chunks.push({ cx, cz, mesh, geo });
        this.group.add(mesh);
      }
    }
    this.shared = shared;
    this.blades = 0;
  }

  /**
   * Re-seat the chunks around the camera and thin them.
   *
   * The grid follows the camera in whole chunks, so a chunk is re-homed rather
   * than rebuilt — its blades are chunk-relative and its roots never move. That
   * is the difference between walking through a meadow and rebuilding one every
   * step.
   */
  update(camX, camZ, camY, t, frustum = null) {
    const chunk = this.spec.chunk;
    const ox = Math.floor(camX / chunk), oz = Math.floor(camZ / chunk);
    let live = 0, drawn = 0;
    for (const c of this.chunks) {
      const gx = ox + c.cx, gz = oz + c.cz;
      const dNear = chunkNearDist(gx, gz, chunk, camX, camZ);
      if (dNear > this.spec.far) { c.mesh.visible = false; c.geo.instanceCount = 0; continue; }
      if (frustum && !chunkInFrustum(frustum, gx, gz, chunk, this.spec.hs)) {
        c.mesh.visible = false; c.geo.instanceCount = 0; continue;
      }
      const count = chunkInstances(this.ring, dNear, this.densityMul);
      c.mesh.visible = count > 0;
      if (c.mesh.visible) drawn++;
      c.geo.instanceCount = count;
      // per chunk, read back by its own onBeforeRender at draw time
      c.mesh.userData.origin.set(gx * chunk, gz * chunk);
      c.mesh.userData.near = dNear;
      live += count;
    }
    // what the CPU instanced this frame, before the shader's own thinning —
    // the number §5's budget is actually about — and how many draw calls it
    // took, which is the other half of that budget
    // per ring, and therefore written once rather than once per chunk
    this.material.uniforms.uCam.value.set(camX, camY, camZ);
    this.material.uniforms.uTime.value = t;
    this.blades = live;
    this.drawn = drawn;
  }

  dispose() {
    for (const c of this.chunks) c.geo.dispose();
    this.material.dispose();
  }
}

