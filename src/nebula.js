// Procedural nebulae and luminous-sprite helpers. All textures are painted
// at startup on a canvas from seeded value-noise fbm — nothing is loaded.

import * as THREE from 'three';
import { hash, RNG } from './rng.js';

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

  void main() {
    float omega = uVrot / max(aR, 14.0);
    float th = aTheta + omega * uTime;
    vec3 p = vec3(aR * cos(th), aY, aR * sin(th));
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    vHue = aHue;
    vSpin = aSpin;
    gl_PointSize = clamp(aSize * uProj / -mv.z, 1.0, 2000.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const NEB_FRAG = /* glsl */`
  precision highp float;
  uniform sampler2D uMap;
  varying float vHue;
  varying float vSpin;

  void main() {
    // rotate the sprite per-instance so clouds don't look stamped
    vec2 c = gl_PointCoord - 0.5;
    float cs = cos(vSpin), sn = sin(vSpin);
    vec2 uv = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) + 0.5;
    float a = texture2D(uMap, uv).a;
    // Hα crimson → OIII teal emission mix
    vec3 ha  = vec3(0.9, 0.16, 0.22);
    vec3 o3  = vec3(0.15, 0.75, 0.72);
    vec3 col = mix(ha, o3, vHue);
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
