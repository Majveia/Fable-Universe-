// Procedural worlds. Every surface is carved from 3D simplex noise in the
// fragment shader — no textures, no assets. Seven species of world:
//   0 barren rock · 1 terrestrial · 2 ocean · 3 ice · 4 lava · 5 gas giant
//   6 ice giant
// plus animated cloud decks, fresnel atmospheres, night-side civilization
// lights, banded ring systems, and a granulating blackbody star.

import * as THREE from 'three';

// --------------------------------------------------------------- noise ----
// Ashima Arts / Ian McEwan simplex noise (MIT), the workhorse of this file.
export const NOISE_GLSL = /* glsl */`
vec3 mod289(vec3 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 mod289(vec4 x){ return x - floor(x * (1.0/289.0)) * 289.0; }
vec4 permute(vec4 x){ return mod289(((x*34.0)+10.0)*x); }
vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v){
  const vec2 C = vec2(1.0/6.0, 1.0/3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i  = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0)*2.0 + 1.0;
  vec4 s1 = floor(b1)*2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}
float fbm(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { v += a * snoise(p); p = p * 2.07 + 11.3; a *= 0.5; }
  return v;
}
float fbm3(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * snoise(p); p = p * 2.07 + 11.3; a *= 0.5; }
  return v;
}
float ridged(vec3 p) {
  float v = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * (1.0 - abs(snoise(p))); p = p * 2.13 + 5.7; a *= 0.5; }
  return v;
}
`;

const SURF_VERT = /* glsl */`
  varying vec3 vN;      // world normal
  varying vec3 vObj;    // object-space unit position (noise domain)
  varying vec3 vW;      // world position
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vObj = normalize(position);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const SURF_FRAG = /* glsl */`
  precision highp float;
  uniform int   uType;
  uniform float uSeed;
  uniform vec3  uSunPos;
  uniform vec3  uCamPos;
  uniform float uTime;
  uniform float uOcean;      // sea level in height units
  uniform float uCity;       // 0/1 inhabited
  uniform vec3  uColA;       // low terrain / band A
  uniform vec3  uColB;       // high terrain / band B
  uniform vec3  uColC;       // accent (vegetation / storm / crack glow)
  uniform float uIceCap;     // polar cap latitude threshold, 2.0 = none
  varying vec3 vN;
  varying vec3 vObj;
  varying vec3 vW;
  ${NOISE_GLSL}

  void main() {
    vec3 n = normalize(vN);
    vec3 sunDir = normalize(uSunPos - vW);
    vec3 viewDir = normalize(uCamPos - vW);
    float day = dot(n, sunDir);
    float light = smoothstep(-0.12, 0.25, day);
    vec3 sd = vec3(uSeed * 17.31, uSeed * 9.17, uSeed * 31.7);
    vec3 p = vObj;
    float lat = p.y;
    vec3 col = vec3(0.0);
    vec3 emit = vec3(0.0);
    float spec = 0.0;

    if (uType >= 5) {
      // ---- gas / ice giant: warped latitude bands + streaks + storm oval
      float flow = uTime * 0.008;
      float warp = fbm3(p * 2.0 + sd) * 0.35;
      float bandCoord = lat * (uType == 5 ? 7.0 : 4.5) + warp * 2.4;
      float band = sin(bandCoord * 3.14159) * 0.5 + 0.5;
      float streak = fbm(vec3(p.x * 1.2 + flow * 3.0, p.y * 9.0, p.z * 1.2) + sd) * 0.5 + 0.5;
      col = mix(uColA, uColB, band);
      col = mix(col, col * (0.72 + 0.55 * streak), 0.6);
      // great storm
      vec2 sp = vec2(atan(p.z, p.x) - flow * 1.5, lat - 0.28);
      sp.x = mod(sp.x + 3.14159, 6.28318) - 3.14159;
      float d = length(sp * vec2(0.9, 4.0));
      float storm = smoothstep(0.55, 0.2, d);
      float swirl = fbm3(vec3(sp * 6.0, uTime * 0.05) + sd);
      col = mix(col, uColC * (0.9 + 0.3 * swirl), storm * 0.85);
      // limb darkening
      col *= 0.55 + 0.45 * pow(max(dot(n, viewDir), 0.0), 0.5);
    } else {
      // ---- solid worlds: continents from fbm + ridged mountains
      float cont = fbm(p * 2.3 + sd);
      float mount = ridged(p * 5.0 + sd * 1.7);
      float h = cont * 0.75 + mount * 0.45 - 0.28;

      if (uType == 4) {
        // lava world: black basalt, glowing fracture network
        float crack = ridged(p * 6.5 + sd);
        float glow = smoothstep(0.78, 0.95, crack) * (0.75 + 0.25 * sin(uTime * 0.7 + crack * 20.0));
        col = mix(vec3(0.02), uColA, smoothstep(-0.3, 0.6, h) * 0.35);
        emit = uColC * glow * 2.4;
      } else if (h < uOcean && uType != 3) {
        // sea
        float depth = clamp((uOcean - h) * 2.2, 0.0, 1.0);
        col = mix(uColC * 0.6, uColA * 0.35, depth);
        spec = pow(max(dot(reflect(-sunDir, n), viewDir), 0.0), 110.0) * 0.9;
      } else {
        // land
        float above = h - uOcean;
        vec3 low = uType == 3 ? uColA : mix(uColC, uColA, smoothstep(0.0, 0.28, above));
        col = mix(low, uColB, smoothstep(0.18, 0.5, above + mount * 0.12));
        if (uType == 3) {
          float crack = smoothstep(0.82, 0.98, ridged(p * 7.0 + sd));
          col = mix(col, uColC, crack * 0.6);
          spec = pow(max(dot(reflect(-sunDir, n), viewDir), 0.0), 60.0) * 0.45;
        }
        // snowline + polar caps
        float caps = smoothstep(uIceCap, uIceCap + 0.12, abs(lat) + h * 0.18);
        float snow = smoothstep(0.55, 0.7, above);
        col = mix(col, vec3(0.93, 0.95, 1.0), max(caps, snow));
        // night-side civilization
        if (uCity > 0.5 && h >= uOcean) {
          float megac = smoothstep(0.35, 0.75, fbm3(p * 5.0 + sd * 2.3));
          float grid = smoothstep(0.55, 0.95, fbm(p * 26.0 + sd));
          float nightside = smoothstep(0.05, -0.22, day);
          emit += vec3(1.0, 0.72, 0.42) * megac * grid * nightside * 1.15;
        }
      }
    }

    float ambient = 0.010;
    vec3 lit = col * (light * 0.95 + ambient) + spec * light * vec3(1.0, 0.98, 0.9) + emit;
    gl_FragColor = vec4(lit, 1.0);
  }
`;

const CLOUD_FRAG = /* glsl */`
  precision highp float;
  uniform float uSeed;
  uniform vec3  uSunPos;
  uniform float uTime;
  uniform float uAmt;
  varying vec3 vN;
  varying vec3 vObj;
  varying vec3 vW;
  ${NOISE_GLSL}
  void main() {
    vec3 n = normalize(vN);
    vec3 sunDir = normalize(uSunPos - vW);
    float day = dot(n, sunDir);
    float light = smoothstep(-0.1, 0.3, day);
    vec3 sd = vec3(uSeed * 7.7, uSeed * 3.1, uSeed * 13.9);
    vec3 p = vObj;
    // slow drifting, domain-warped deck
    vec3 q = p * 3.0 + sd + vec3(uTime * 0.006, 0.0, uTime * 0.002);
    float w = fbm3(q * 1.6) * 0.7;
    float c = fbm(q + w);
    float a = smoothstep(0.62 - uAmt * 0.22, 0.85, c * 0.5 + 0.5);
    gl_FragColor = vec4(vec3(0.9, 0.9, 0.94) * (light * 1.0 + 0.008), a * 0.8);
  }
`;

const ATMO_VERT = /* glsl */`
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vN = normalize(mat3(modelMatrix) * normal);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const ATMO_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uSunPos;
  uniform vec3 uCamPos;
  uniform vec3 uCenter;
  uniform vec3 uColor;
  uniform float uPower;
  varying vec3 vN;
  varying vec3 vW;
  void main() {
    vec3 nn = normalize(vW - uCenter);            // true outward shell normal
    vec3 viewDir = normalize(uCamPos - vW);
    vec3 sunDir = normalize(uSunPos - uCenter);
    // glow hugs the limb, strongest where the sun grazes the horizon
    float rim = pow(1.0 - abs(dot(nn, viewDir)), uPower);
    float day = clamp(dot(nn, sunDir) * 0.75 + 0.3, 0.0, 1.0);
    gl_FragColor = vec4(uColor * rim * day * 1.5, 1.0);
  }
`;

const STAR_FRAG = /* glsl */`
  precision highp float;
  uniform vec3 uColor;
  uniform float uTime;
  uniform float uSeed;
  uniform vec3 uCamPos;
  varying vec3 vN;
  varying vec3 vObj;
  varying vec3 vW;
  ${NOISE_GLSL}
  void main() {
    vec3 n = normalize(vN);
    vec3 viewDir = normalize(uCamPos - vW);
    vec3 p = vObj * 3.0 + vec3(uSeed);
    float g = fbm(p + vec3(0.0, uTime * 0.05, 0.0));
    float cells = fbm(p * 2.6 - vec3(uTime * 0.03));
    float granule = 0.72 + 0.38 * g + 0.2 * cells;
    // limb darkening (real stars dim toward the edge)
    float mu = clamp(dot(n, viewDir), 0.0, 1.0);
    float limb = 0.35 + 0.65 * pow(mu, 0.6);
    vec3 col = uColor * granule * limb * 2.6;
    // hot flecks
    col += uColor * smoothstep(0.62, 0.95, g) * 1.4;
    gl_FragColor = vec4(col, 1.0);
  }
`;

const RING_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vW;
  void main() {
    vUv = uv;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const RING_FRAG = /* glsl */`
  precision highp float;
  uniform float uSeed;
  uniform vec3 uSunPos;
  uniform vec3 uPlanetPos;
  uniform float uPlanetR;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec3 vW;
  ${NOISE_GLSL}
  void main() {
    float r = vUv.x; // 0 inner → 1 outer (RingGeometry maps radius to u)
    // fine ringlets + broad gaps
    float ringlets = fbm3(vec3(r * 40.0, uSeed, uSeed * 2.0)) * 0.5 + 0.5;
    float gaps = smoothstep(0.2, 0.5, abs(fbm3(vec3(r * 7.0, uSeed * 3.1, 1.7))));
    float a = ringlets * gaps;
    a *= smoothstep(0.0, 0.08, r) * smoothstep(1.0, 0.85, r);
    // planet shadow: eclipse when the sun is behind the planet from here
    vec3 toSun = uSunPos - vW;
    vec3 toP = uPlanetPos - vW;
    float tClose = clamp(dot(toP, normalize(toSun)), 0.0, length(toSun));
    vec3 closest = normalize(toSun) * tClose;
    float shade = 1.0 - smoothstep(uPlanetR * 1.05, uPlanetR * 0.7, length(toP - closest)) *
                        step(0.0, dot(toP, toSun));
    gl_FragColor = vec4(uColor * (0.35 + 0.65 * shade), a * 0.85);
  }
`;

// ------------------------------------------------------------ builders ----

export function makeSurfaceMaterial(pp, sunPosUniform, camPosUniform, timeUniform) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uType: { value: pp.typeId },
      uSeed: { value: pp.noiseSeed },
      uSunPos: sunPosUniform,
      uCamPos: camPosUniform,
      uTime: timeUniform,
      uOcean: { value: pp.oceanLevel },
      uCity: { value: pp.inhabited ? 1 : 0 },
      uColA: { value: pp.colA },
      uColB: { value: pp.colB },
      uColC: { value: pp.colC },
      uIceCap: { value: pp.iceCap },
    },
    vertexShader: SURF_VERT,
    fragmentShader: SURF_FRAG,
  });
}

export function makeCloudMaterial(pp, sunPosUniform, timeUniform) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSeed: { value: pp.noiseSeed + 4.7 },
      uSunPos: sunPosUniform,
      uTime: timeUniform,
      uAmt: { value: pp.clouds },
    },
    vertexShader: SURF_VERT,
    fragmentShader: CLOUD_FRAG,
    transparent: true,
    depthWrite: false,
  });
}

export function makeAtmosphereMaterial(pp, sunPosUniform, camPosUniform, centerUniform) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSunPos: sunPosUniform,
      uCamPos: camPosUniform,
      uCenter: centerUniform || { value: new THREE.Vector3() },
      uColor: { value: pp.atmoColor },
      uPower: { value: 3.4 },
    },
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
  });
}

export function makeStarSurfaceMaterial(color, seed, camPosUniform, timeUniform) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: color },
      uTime: timeUniform,
      uSeed: { value: seed },
      uCamPos: camPosUniform,
    },
    vertexShader: SURF_VERT,
    fragmentShader: STAR_FRAG,
  });
}

export function makeRingMaterial(pp, sunPosUniform, planetPosUniform) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSeed: { value: pp.noiseSeed * 1.3 },
      uSunPos: sunPosUniform,
      uPlanetPos: planetPosUniform,
      uPlanetR: { value: pp.drawRadius },
      uColor: { value: pp.ringColor },
    },
    vertexShader: RING_VERT,
    fragmentShader: RING_FRAG,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
}

/** blackbody chromaticity, T in kelvin → linear-ish RGB */
export function blackbodyRGB(T) {
  T = Math.min(Math.max(T, 1200), 40000) / 100;
  let r, g, b;
  r = T <= 66 ? 255 : 329.7 * Math.pow(T - 60, -0.1332);
  g = T <= 66 ? 99.47 * Math.log(T) - 161.1 : 288.1 * Math.pow(T - 60, -0.0755);
  b = T >= 66 ? 255 : T <= 19 ? 0 : 138.5 * Math.log(T - 10) - 305.0;
  const c = new THREE.Color(
    Math.min(Math.max(r / 255, 0), 1),
    Math.min(Math.max(g / 255, 0), 1),
    Math.min(Math.max(b / 255, 0), 1)
  );
  return c;
}
