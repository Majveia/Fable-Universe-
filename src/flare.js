// The lens admits it's a lens.
//
// A hand-built anamorphic flare: when the star crosses the frame, a warm
// streak lies across it, a halo blooms, and a chain of colored ghosts
// slides along the sun-to-center axis the way real glass scatters light.
// All textures are drawn procedurally; every element is a sprite placed
// in screen space each frame and faded by where the sun actually is.

import * as THREE from 'three';

function discTexture(inner, outer, r0 = 0.1, r1 = 0.5) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 128 * r0, 64, 64, 128 * r1);
  grad.addColorStop(0, inner);
  grad.addColorStop(1, outer);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

function ringTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 30, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.78, 'rgba(255,255,255,0.5)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

function streakTexture() {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 32;
  const g = cv.getContext('2d');
  const grad = g.createLinearGradient(0, 0, 256, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 32);
  return new THREE.CanvasTexture(cv);
}

export function addFlare(s) {
  if (s.atmo < 0.3) return null;   // airless worlds get the naked star
  const disc = discTexture('rgba(255,255,255,0.9)', 'rgba(255,255,255,0)');
  const ring = ringTexture();
  const streak = streakTexture();
  const sun = s.uSunColor.value;

  const mk = (map, color, t, scale, op) => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({
      map, color, transparent: true, opacity: 0, depthWrite: false,
      depthTest: false, blending: THREE.AdditiveBlending,
    }));
    sp.scale.set(scale, map === streak ? scale * 0.09 : scale, 1);
    sp.renderOrder = 20;
    sp.frustumCulled = false;
    s.scene.add(sp);
    return { sp, t, op };
  };

  const warm = sun.clone().lerp(new THREE.Color(1, 0.8, 0.55), 0.5);
  const els = [
    mk(streak, warm.clone().lerp(new THREE.Color(0.55, 0.75, 1.0), 0.45), 1.0, 120, 0.4),
    mk(disc, warm, 1.0, 34, 0.5),
    mk(ring, warm.clone().multiplyScalar(0.7), 0.55, 26, 0.14),
    mk(disc, new THREE.Color(0.5, 0.85, 0.7), 0.32, 6, 0.16),
    mk(disc, new THREE.Color(1.0, 0.65, 0.4), 0.06, 9, 0.14),
    mk(disc, new THREE.Color(0.6, 0.55, 1.0), -0.28, 7, 0.14),
    mk(ring, new THREE.Color(0.9, 0.6, 0.9), -0.6, 14, 0.1),
  ];

  const ndc = new THREE.Vector3();
  const v = new THREE.Vector3();
  return {
    update(camera) {
      // where is the star on the film plane?
      ndc.copy(s.uSunDir.value).multiplyScalar(14000).project(camera);
      const onScreen = ndc.z < 1 && Math.abs(ndc.x) < 1.25 && Math.abs(ndc.y) < 1.25;
      const vis = onScreen
        ? Math.max(0, Math.min((s.uSunDir.value.y + 0.03) * 8, 1))
          * (1 - Math.max(Math.abs(ndc.x), Math.abs(ndc.y)) * 0.55)
        : 0;
      for (const e of els) {
        e.sp.material.opacity = e.op * vis;
        if (!vis) continue;
        // slide each element along the sun-to-center axis
        v.set(ndc.x * e.t, ndc.y * e.t, 0.6).unproject(camera)
          .sub(camera.position).normalize().multiplyScalar(60).add(camera.position);
        e.sp.position.copy(v);
      }
    },
  };
}
