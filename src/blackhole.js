// SCALE 3b — THE NUCLEUS
//
// A supermassive black hole rendered by integrating actual null geodesics.
// Each pixel's ray is marched through Schwarzschild spacetime using
//   d²x/dλ² = −(3/2) h² x / r⁵     (units: r_s = 1, h = |x × v| conserved)
// which is exactly the textbook photon equation u'' + u = (3/2) r_s u².
// Light that grazes the hole wraps around it — the photon ring, the doubled
// image of the accretion disk above and below the shadow, the Einstein-lensed
// starfield — none of it is painted; all of it falls out of the integration.
// Disk emission is Doppler-boosted by δ³, so the approaching side burns
// brighter and bluer: relativistic beaming, as observed at M87* and Sgr A*.

import * as THREE from 'three';

const VERT = /* glsl */`
  void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = /* glsl */`
  precision highp float;
  uniform vec2  uRes;
  uniform float uTime;
  uniform vec3  uCamPos;
  uniform vec3  uCamFwd;
  uniform vec3  uCamRight;
  uniform vec3  uCamUp;
  uniform float uSeed;

  #define STEPS 170
  #define R_ESCAPE 44.0
  #define DISK_IN 2.35
  #define DISK_OUT 10.5

  float hash13(vec3 p){
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float noise2(vec2 p){
    vec2 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash13(vec3(i, uSeed));
    float b = hash13(vec3(i + vec2(1,0), uSeed));
    float c = hash13(vec3(i + vec2(0,1), uSeed));
    float d = hash13(vec3(i + vec2(1,1), uSeed));
    return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
  }
  float fbm2(vec2 p){
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++){ v += a * noise2(p); p = p * 2.13 + 7.7; a *= 0.5; }
    return v;
  }

  // the sky behind everything — lensed by the geodesics that reach it
  vec3 background(vec3 d){
    vec3 col = vec3(0.0);
    // star grid on the direction sphere
    vec3 dd = d * 340.0;
    vec3 cell = floor(dd);
    for (int i = 0; i < 1; i++){
      float h = hash13(cell);
      if (h > 0.9955) {
        vec3 sp = cell + 0.5;
        float dist = length(dd - sp);
        float mag = (h - 0.9955) / 0.0045;
        col += vec3(1.0, 0.92, 0.85) * exp(-dist * dist * 4.5) * (0.25 + mag * 1.1);
      }
    }
    // the host galaxy's glowing band
    float band = exp(-abs(d.y + 0.18 * sin(d.x * 2.0)) * 6.5);
    float wisp = fbm2(d.xz * 5.0 + 3.0);
    col += vec3(0.045, 0.036, 0.05) * band * (0.5 + wisp);
    col += vec3(0.004, 0.003, 0.007);
    return col;
  }

  // disk emission at radius r, azimuth phi (rest frame, before beaming)
  vec3 diskShade(float r, float phi, out float alpha){
    // Keplerian shear: inner material laps the outer — streaks wind up
    float w = 8.0 / pow(r, 1.5);
    float streak = fbm2(vec2(log(r) * 7.0, (phi - w * uTime * 0.55) * 2.2));
    float ring = fbm2(vec2(r * 3.1, uSeed * 3.7));
    float body = smoothstep(DISK_IN, DISK_IN + 0.7, r) * smoothstep(DISK_OUT, DISK_OUT - 3.5, r);
    float em = body * (0.35 + 0.9 * streak) * (0.6 + 0.55 * ring);
    // temperature falls outward: white-hot rim → amber → deep red
    float t = clamp(1.0 - (r - DISK_IN) / (DISK_OUT - DISK_IN), 0.0, 1.0);
    vec3 c = mix(vec3(1.0, 0.36, 0.08), vec3(1.0, 0.86, 0.62), t * t);
    c = mix(c, vec3(1.05, 0.98, 0.9), smoothstep(0.75, 1.0, t));
    alpha = clamp(em * 1.4, 0.0, 1.0);
    return c * em * (0.55 + 2.6 * t * t);
  }

  void main(){
    vec2 uv = (gl_FragCoord.xy * 2.0 - uRes) / uRes.y;
    vec3 rd = normalize(uCamFwd * 1.35 + uCamRight * uv.x + uCamUp * uv.y);
    vec3 p = uCamPos;
    vec3 v = rd;

    vec3 h3 = cross(p, v);
    float h2 = dot(h3, h3);

    vec3 col = vec3(0.0);
    float through = 1.0;   // transmittance toward later crossings
    bool captured = false;

    float prevY = p.y;
    vec3 prevP = p;

    for (int i = 0; i < STEPS; i++){
      float r = length(p);
      if (r > R_ESCAPE && dot(p, v) > 0.0) break;
      if (r < 0.52) { captured = true; break; }

      float dt = clamp(r * 0.11, 0.02, 0.42);
      // exact Schwarzschild bending
      v += -1.5 * h2 * p / pow(r, 5.0) * dt;
      p += v * dt;

      // did we pierce the equatorial plane? → accretion disk
      if (p.y * prevY < 0.0){
        float f = prevY / (prevY - p.y);
        vec3 hit = mix(prevP, p, f);
        float hr = length(hit.xz);
        if (hr > DISK_IN && hr < DISK_OUT){
          float phi = atan(hit.z, hit.x);
          float a;
          vec3 c = diskShade(hr, phi, a);
          // relativistic beaming: δ³ with tangential Keplerian flow
          vec3 flow = normalize(vec3(-hit.z, 0.0, hit.x));
          float beta = clamp(0.62 / sqrt(max(hr - 1.0, 0.35)), 0.0, 0.9);
          float gam = 1.0 / sqrt(1.0 - beta * beta);
          float dopp = clamp(1.0 / (gam * (1.0 - beta * dot(flow, -v))), 0.35, 1.9);
          c *= pow(dopp, 3.0);
          c = mix(c, c * vec3(0.6, 0.75, 1.25), clamp((dopp - 1.0) * 1.4, -0.35, 0.6));
          // gravitational redshift dims the inner edge
          c *= clamp(1.0 - 0.75 / hr, 0.05, 1.0);
          col += c * through;
          through *= (1.0 - a * 0.85);
          if (through < 0.02) { captured = true; break; }
        }
      }
      prevY = p.y;
      prevP = p;
    }

    if (!captured) col += background(normalize(v)) * through;

    // filmic-ish shoulder before the shared tonemap
    col = col / (1.0 + col * 0.30);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export class BlackHoleScale {
  constructor(app, ctx) {
    this.app = app;
    this.kind = 'blackhole';
    this.ctx = ctx;
    this.bhMassMsun = ctx.bhMassMsun || 4.2e6;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100); // unused by shader; needed by composer

    this.theta = 0.17;         // shallow tilt: the disk arcs over the shadow
    this.phi = 0;
    this.dist = 16;
    this.autoOrbit = true;
    this.playing = true;
    this.speed = 1;
    this.time = 0;

    this.uniforms = {
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uCamFwd: { value: new THREE.Vector3() },
      uCamRight: { value: new THREE.Vector3() },
      uCamUp: { value: new THREE.Vector3() },
      uSeed: { value: (ctx.bhMassMsun || 1) % 17 + 3.1 },
    };
    const quad = new THREE.Mesh(
      new THREE.PlaneGeometry(2, 2),
      new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VERT, fragmentShader: FRAG, depthTest: false, depthWrite: false })
    );
    quad.frustumCulled = false;
    this.scene.add(quad);

    this._drag = null;
    this.bloomSettings = { strength: 0.55, radius: 0.6, threshold: 0.25 };
  }

  update(dt) {
    if (this.playing) this.time += dt * this.speed;
    if (this.autoOrbit) this.phi += dt * 0.05;
    this.uniforms.uTime.value = this.time;
    this.uniforms.uRes.value.set(
      this.app.renderer.domElement.width,
      this.app.renderer.domElement.height);

    const ct = Math.cos(this.theta), st = Math.sin(this.theta);
    const pos = new THREE.Vector3(
      this.dist * ct * Math.cos(this.phi),
      this.dist * st,
      this.dist * ct * Math.sin(this.phi));
    const fwd = pos.clone().negate().normalize();
    const right = new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize();
    const up = new THREE.Vector3().crossVectors(right, fwd);
    this.uniforms.uCamPos.value.copy(pos);
    this.uniforms.uCamFwd.value.copy(fwd);
    this.uniforms.uCamRight.value.copy(right);
    this.uniforms.uCamUp.value.copy(up);
  }

  // manual orbit: drag to steer, wheel to approach
  onPointerDown(e) { this._drag = { x: e.clientX, y: e.clientY }; this.autoOrbit = false; }
  onPointerMove(e) {
    if (!this._drag) return;
    this.phi += (e.clientX - this._drag.x) * 0.004;
    this.theta = Math.min(Math.max(this.theta + (e.clientY - this._drag.y) * 0.003, -1.25), 1.25);
    this._drag = { x: e.clientX, y: e.clientY };
  }
  onPointerUp() { this._drag = null; }
  onWheel(e) {
    this.dist = Math.min(Math.max(this.dist * (1 + Math.sign(e.deltaY) * 0.09), 5.5), 38);
  }

  togglePlay() { this.playing = !this.playing; }
  speedUp() { this.speed = Math.min(this.speed * 1.6, 12); }
  slowDown() { this.speed = Math.max(this.speed / 1.6, 0.1); }
  timeReadout() { return `disk flow ×${this.speed.toFixed(1)}`; }

  hudStats() {
    const rs = 2.95 * this.bhMassMsun; // km
    return [
      ['object', 'supermassive black hole'],
      ['mass', (this.bhMassMsun / 1e6).toFixed(1) + ' × 10⁶ M☉'],
      ['schwarzschild radius', rs >= 1e6 ? (rs / 1e6).toFixed(1) + ' × 10⁶ km' : Math.round(rs).toLocaleString() + ' km'],
      ['camera', this.dist.toFixed(1) + ' rₛ from the horizon'],
      ['integrator', 'null geodesics, 170 steps/px'],
    ];
  }

  pick() { return null; }
  onKey() { return false; }
  enter() {}
  exit() {}
  resume() {}
  dispose() {
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
}

export const BLACKHOLE_NOTE = `This image is computed, not painted. Every pixel's ray is integrated through Schwarzschild spacetime — <em>d²x/dλ² = −(3/2)h²x/r⁵</em>, the exact equation for light — so the thin bright <em>photon ring</em>, the disk arching impossibly over and under the shadow (light from the far side, bent to reach you), and the warped starfield are all consequences of gravity alone. The approaching side of the disk outshines the receding side by the Doppler factor cubed: relativistic beaming, just as the Event Horizon Telescope saw at M87*. Drag to orbit; scroll to lean closer.`;
