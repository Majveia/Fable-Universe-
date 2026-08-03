// Procedural nebulae and luminous-sprite helpers. All textures are painted
// at startup on a canvas from seeded value-noise fbm — nothing is loaded.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';
import { NOISE_GLSL } from './planet.js';

// ------------------------------------------------ volumetric nebulae ------
// A bounding sphere rendered back-face; each fragment marches a ray through
// the volume accumulating emission from 3D fbm density. Real depth, real
// parallax — clouds you can orbit.

const VOLNEB_VERT = /* glsl */`
  varying vec3 vW;
  void main() {
    vW = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }
`;

const VOLNEB_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uCenter;
  uniform float uR;
  uniform vec3 uCam;
  uniform vec3 uColA;
  uniform vec3 uColB;
  uniform float uSeed;
  uniform float uGain;
  varying vec3 vW;
  ${NOISE_GLSL}

  void main() {
    vec3 rd = normalize(vW - uCam);
    vec3 oc = uCam - uCenter;
    float b = dot(oc, rd);
    float c = dot(oc, oc) - uR * uR;
    float disc = b * b - c;
    if (disc < 0.0) discard;
    float sq = sqrt(disc);
    float t0 = max(-b - sq, 0.0);
    float t1 = -b + sq;
    if (t1 <= t0) discard;

    const int STEPS = 16;
    float dt = (t1 - t0) / float(STEPS);
    vec3 acc = vec3(0.0);
    vec3 sd = vec3(uSeed * 3.1, uSeed * 7.7, uSeed * 1.9);
    for (int i = 0; i < STEPS; i++) {
      float t = t0 + (float(i) + 0.5) * dt;
      vec3 p = (uCam + rd * t - uCenter) / uR;
      float rad = length(p);
      float n = fbm3(p * 2.4 + sd) * 0.5 + 0.5;
      float dens = smoothstep(0.32, 0.8, n) * smoothstep(1.0, 0.3, rad);
      float hue = fbm3(p * 1.2 - sd) * 0.5 + 0.5;
      acc += mix(uColA, uColB, hue) * dens;
    }
    acc *= uGain / float(STEPS);
    acc = acc / (1.0 + acc * 1.6);   // shoulder: stay luminous, never foggy
    gl_FragColor = vec4(acc, 1.0);
  }
`;

/** an emission nebula with genuine volume — additive, orbitable */
export function makeVolumetricNebula(seed, radius, colA, colB, camPosUniform, gain = 1.4) {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 24, 16),
    new THREE.ShaderMaterial({
      uniforms: {
        uCenter: { value: new THREE.Vector3() },
        uR: { value: radius },
        uCam: camPosUniform,
        uColA: { value: colA },
        uColB: { value: colB },
        uSeed: { value: (seed % 100) + 0.37 },
        uGain: { value: gain },
      },
      vertexShader: VOLNEB_VERT,
      fragmentShader: VOLNEB_FRAG,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false, depthTest: false,
    }));
  mesh.onBeforeRender = () => {
    mesh.getWorldPosition(mesh.material.uniforms.uCenter.value);
  };
  return mesh;
}

// -------------------------------------------------------- noise canvas ----

function makeValueNoise(rng, size) {
  const g = new Float32Array(size * size);
  for (let i = 0; i < g.length; i++) g[i] = rng.next();
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
    const at = (i, j) => g[((j % size + size) % size) * size + ((i % size + size) % size)];
    const a = at(xi, yi), b = at(xi + 1, yi), c = at(xi, yi + 1), d = at(xi + 1, yi + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}

function fbm(noise, x, y, oct) {
  let v = 0, amp = 0.5, f = 1;
  for (let o = 0; o < oct; o++) { v += amp * noise(x * f, y * f); amp *= 0.5; f *= 2.03; }
  return v;
}

/** wispy cloud alpha texture with radial falloff */
export function nebulaTexture(seed = 7, size = 256) {
  const rng = new RNG(hash(seed, 0xeb));
  const noise = makeValueNoise(rng, 64);
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const dx = u - 0.5, dy = v - 0.5;
      const rad = Math.sqrt(dx * dx + dy * dy) * 2;
      // domain-warped fbm for filamentary wisps
      const wx = fbm(noise, u * 4 + 13.7, v * 4 + 5.1, 4);
      const wy = fbm(noise, u * 4 + 41.3, v * 4 + 27.9, 4);
      let n = fbm(noise, u * 6 + wx * 1.6, v * 6 + wy * 1.6, 5);
      n = Math.pow(Math.max(n - 0.18, 0) * 1.45, 1.6);
      const fall = Math.max(1 - rad, 0);
      const a = Math.min(n * fall * fall * 2.2, 1);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = a * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** soft gaussian dot */
export function softDotTexture(size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(cv);
}

/**
 * A galactic bulge's surface brightness, as a sprite profile.
 *
 * `softDotTexture` is a Gaussian, and a Gaussian is the wrong shape for a
 * nucleus in a way that shows: it is *flat* near the centre, so scaled up and
 * added to itself it clips across a wide disc and the core becomes a white
 * hole with no gradient in it. A bulge is not flat near the centre. It follows
 * de Vaucouleurs' r^¼ law —
 *
 *     I(r) = I_e · exp(−7.669 · ((r/R_e)^¼ − 1))
 *
 * — which is a sharp cusp with long faint wings, and that is exactly the shape
 * that keeps a small saturated nucleus surrounded by a readable falloff instead
 * of one big saturated disc.
 *
 * `reFrac` is the effective radius as a fraction of the sprite, and it is the
 * only knob: smaller concentrates the light, larger spreads it. The 1908 law
 * supplies the rest.
 */
export function bulgeTexture(size = 256, reFrac = 0.22) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  // normalised so the centre is 1; the law's own dynamic range does the rest
  const peak = Math.exp(-7.669 * (0 - 1));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5, dy = (y + 0.5) / size - 0.5;
      const r = Math.sqrt(dx * dx + dy * dy) * 2;   // 0 at centre, 1 at edge
      let a = Math.exp(-7.669 * (Math.pow(Math.max(r, 1e-4) / reFrac, 0.25) - 1)) / peak;
      // a hard edge on an additive sprite is a visible square, so take the
      // last tenth of the radius to zero
      a *= Math.max(1 - Math.max(r - 0.9, 0) / 0.1, 0);
      const i = (y * size + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
      img.data[i + 3] = Math.min(Math.max(a, 0), 1) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(cv);
}

/** fuzzy inclined-disk blob — a distant galaxy seen from afar */
export function galaxyAtlasTexture(size = 128) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.translate(size / 2, size / 2);
  ctx.rotate(0.6);
  ctx.scale(1, 0.42);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.3, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(-size / 2, -size / 2, size, size);
  return new THREE.CanvasTexture(cv);
}

// ------------------------------------------------- galaxy HII nebulae -----

const NEB_VERT = /* glsl */`
  attribute float aR;
  attribute float aTheta;
  attribute float aY;
  attribute float aSize;
  attribute float aHue;
  attribute float aSpin;
  uniform float uTime;
  uniform float uVrot;
  uniform float uProj;   // drawingBufferHeight * cot(fov/2) / 2
  varying float vHue;
  varying float vSpin;
  varying float vNear;
  varying float vSeed;

  void main() {
    float omega = uVrot / max(aR, 14.0);
    float th = aTheta + omega * uTime;
    vec3 p = vec3(aR * cos(th), aY, aR * sin(th));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vHue = aHue;
    vSpin = aSpin;
    float px = clamp(aSize * uProj / -mv.z, 1.0, 2000.0);
    gl_PointSize = px;
    // How big this cloud is on screen, which is what decides how much detail
    // it has to carry. One texture lookup stretched over 600 px is a blur
    // however good the texture is, so the fragment adds structure of its own
    // in proportion to how far it is being magnified.
    vNear = clamp((px - 90.0) / 340.0, 0.0, 1.0);
    vSeed = aSpin * 7.31 + aHue * 13.7;
    gl_Position = projectionMatrix * mv;
  }
`;

const NEB_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uMap;
  varying float vHue;
  varying float vSpin;
  varying float vNear;
  varying float vSeed;

  // Cheap value noise. The sprite is already a texture lookup and a few adds;
  // this has to stay in the same budget, so it is two octaves of hashed
  // gradient rather than anything principled.
  float h21(vec2 p) {
    vec3 q = fract(vec3(p.xyx) * 0.1031);
    q += dot(q, q.yzx + 33.33);
    return fract((q.x + q.y) * q.z);
  }
  float vn(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h21(i), h21(i + vec2(1, 0)), f.x),
               mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), f.x), f.y);
  }

  void main() {
    // rotate the sprite per-instance so clouds don't look stamped
    vec2 c = gl_PointCoord - 0.5;
    float cs = cos(vSpin), sn = sin(vSpin);
    vec2 uv = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
    float a = texture2D(uMap, uv).a;

    // Structure that arrives as the cloud fills more of the screen. Two
    // octaves, domain-warped by the first, so what appears is filament rather
    // than grain — a magnified HII region is ragged, not smooth.
    float fil = 0.0;
    if (vNear > 0.01) {
      vec2 q = uv * 9.0 + vSeed;
      float w = vn(q) - 0.5;
      float n = vn(q * 2.7 + w * 1.9) * 0.62 + vn(q * 6.1 - w * 1.1) * 0.38;
      fil = (n - 0.42) * 2.0;
      // it thins the cloud rather than brightening it: gas is patchy, and
      // adding light where there is none makes a fog instead of a filament
      a *= clamp(1.0 + fil * vNear * 1.15, 0.0, 1.9);
    }

    // Hα crimson → OIII teal emission mix.
    //
    // The mix used to be one number for the whole cloud, which is why they
    // read as tinted cotton. In a real HII region the OIII sits where the
    // ionising stars are and Hα in the cooler shell around it, so the ratio
    // varies *inside* the cloud — and that variation is most of what makes it
    // look like gas.
    vec3 ha  = vec3(0.9, 0.16, 0.22);
    vec3 o3  = vec3(0.15, 0.75, 0.72);
    float hue = clamp(vHue + fil * vNear * 0.42, 0.0, 1.0);
    vec3 col = mix(ha, o3, hue);
    gl_FragColor = vec4(col * a * 0.34, 1.0);
  }
`;

/**
 * Build additive HII-region sprites that co-rotate with a galaxy's disk.
 * `spots`: [{r, theta, y, size, hue}], sharedUniforms must carry uTime/uVrot.
 */
export function makeNebulaSprites(spots, sharedUniforms) {
  const per = 4; // layered puffs per region
  const N = spots.length * per;
  const aR = new Float32Array(N), aTheta = new Float32Array(N), aY = new Float32Array(N);
  const aSize = new Float32Array(N), aHue = new Float32Array(N), aSpin = new Float32Array(N);
  const rng = new RNG(hash(spots.length, 0x5eb));
  let j = 0;
  for (const s of spots) {
    for (let k = 0; k < per; k++) {
      aR[j] = s.r + rng.gauss() * s.size * 0.25;
      aTheta[j] = s.theta + rng.gauss() * (s.size * 0.3 / Math.max(s.r, 1));
      aY[j] = s.y + rng.gauss() * s.size * 0.14;
      aSize[j] = s.size * (0.6 + 0.8 * rng.next());
      aHue[j] = Math.min(Math.max(s.hue + rng.gauss() * 0.15, 0), 1);
      aSpin[j] = rng.float(0, Math.PI * 2);
      j++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  geo.setAttribute('aR', new THREE.BufferAttribute(aR, 1));
  geo.setAttribute('aTheta', new THREE.BufferAttribute(aTheta, 1));
  geo.setAttribute('aY', new THREE.BufferAttribute(aY, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(aSize, 1));
  geo.setAttribute('aHue', new THREE.BufferAttribute(aHue, 1));
  geo.setAttribute('aSpin', new THREE.BufferAttribute(aSpin, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: sharedUniforms.uTime,
      uVrot: sharedUniforms.uVrot,
      uProj: { value: 800 },
      uMap: { value: nebulaTexture(11) },
    },
    vertexShader: NEB_VERT,
    fragmentShader: NEB_FRAG,
    blending: THREE.AdditiveBlending,
    depthWrite: false, depthTest: false, transparent: true,
  });
  return new THREE.Points(geo, mat);
}
