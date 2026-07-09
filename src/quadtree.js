// The streaming quadtree planet — chunked LOD on a cube sphere.
//
// Six root tiles, each the root of a quadtree. Every frame the tree is
// walked from the top: a node whose projected size is too coarse for its
// distance asks for its four children from a Web Worker pool and keeps
// drawing itself until all four are resident — so refinement streams in
// under you with no holes and no popping in from nothing. Receding merges
// back up the tree; retired tiles rest in an LRU cache until evicted.
//
// Precision is the quiet hard part. The planet is thousands of units wide
// and your boots stop half a meter over it — float32 runs out five digits
// too soon. So vertices are stored relative to their tile's center (built
// in float64 in the worker), the camera lives at the scene origin, and the
// planet group carries −cameraPos (JavaScript numbers: doubles). three.js
// composes the matrices on the CPU in doubles, and what reaches the GPU is
// the small difference (tileCenter − camera): jitter-free at ground level.

import * as THREE from 'three';
import { buildTile, buildIndices, uvToDir, surfaceRadius } from './tilebuild.js';
import { planetHeight } from './terrain.js';

const HALF_ANG = Math.PI / 4;   // half angular span of a cube face

export class QuadtreePlanet {
  /**
   * @param pp        planet params (noiseSeed, oceanLevel, typeId, …)
   * @param opts      { R, amp, res, maxDepth, makeMaterial(center) → material }
   */
  constructor(pp, opts) {
    this.pp = pp;
    this.R = opts.R;
    this.amp = opts.amp;
    this.res = (opts.res ?? 33) | 1; // odd, so parent grids align with children
    this.maxDepth = opts.maxDepth ?? 13;
    this.makeMaterial = opts.makeMaterial;
    this.splitK = opts.splitK || 6.5;   // split when dist < chord · splitK (~4 px error)

    this.group = new THREE.Group();
    this.job = {
      seed: pp.noiseSeed,
      ocean: pp.oceanLevel,
      sea: (pp.typeId === 1 || pp.typeId === 2) && pp.oceanLevel > -0.5,
      R: this.R, amp: this.amp, res: this.res,
      skirtK: opts.skirtK ?? 1,
      flat: opts.flat ?? null,     // constant-height sheet (the ocean surface)
      bathy: !!opts.bathy,         // true terrain under a real water surface
    };

    // one index ARRAY serves every tile, but each geometry gets its own
    // BufferAttribute — a shared GL index buffer dies with the first
    // disposed tile while other tiles' VAOs still point at it
    this.indexArray = buildIndices(this.res);
    this.trisPerTile = this.indexArray.length / 3;

    this.tiles = new Map();      // key → { mesh, geo }
    this.pending = new Set();    // keys in flight to a worker
    this.results = [];           // built tiles awaiting GPU upload
    this.cap = 900;              // LRU tile budget
    this.stats = { drawn: 0, cached: 0, pending: 0, built: 6, maxDepth: 0, tris: 0 };

    // worker pool
    const n = opts.workers
      ?? Math.min(4, Math.max(2, (navigator.hardwareConcurrency || 4) - 1));
    this.workers = [];
    this.idle = [];
    for (let w = 0; w < n; w++) {
      const wk = new Worker(new URL('./tilebuild.js', import.meta.url), { type: 'module' });
      wk.onmessage = (e) => { wk._job = null; this.results.push(e.data); this.idle.push(wk); };
      wk.onerror = (e) => {
        console.warn('AEON tile worker:', e.message);
        if (wk._job) { this.pending.delete(wk._job); wk._job = null; }
        this.idle.push(wk);
      };
      this.workers.push(wk);
      this.idle.push(wk);
    }

    // the six roots, synchronously: the globe exists on frame one
    for (let f = 0; f < 6; f++) {
      const key = f + ':0:0:0';
      this._adopt(buildTile({ ...this.job, key, face: f, depth: 0, i: 0, j: 0 }));
    }

    this._shown = new Set();
    this._sticky = new Set();
    this._misses = [];
    this._d3 = [0, 0, 0];
  }

  /** crust radius under a unit direction — collision, spawn, HUD */
  heightAt(dir) {
    return surfaceRadius(dir.x, dir.y, dir.z, this.job);
  }
  /** raw height field value (same units the ocean level lives in) */
  fieldAt(dir) {
    return planetHeight(dir.x, dir.y, dir.z, this.job.seed);
  }

  _adopt(data) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(data.pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(data.norm, 3));
    geo.setAttribute('aMorph', new THREE.BufferAttribute(data.morph, 3));
    geo.setAttribute('aMorphN', new THREE.BufferAttribute(data.morphN, 3));
    geo.setIndex(new THREE.BufferAttribute(this.indexArray, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), data.boundR * 1.05);
    const center = new THREE.Vector3(data.center[0], data.center[1], data.center[2]);
    const depth = parseInt(data.key.split(':')[1], 10);
    const splitD = this.R * (Math.PI / 2) / (1 << depth) * this.splitK;
    const mesh = new THREE.Mesh(geo, this.makeMaterial(center, splitD));
    mesh.position.copy(center);
    mesh.visible = false;
    this.group.add(mesh);
    this.tiles.set(data.key, { mesh, geo });
  }

  /** center of a node's sphere patch, double precision */
  _center(face, depth, i, j, out) {
    const span = 2 / (1 << depth);
    uvToDir(face, -1 + (i + 0.5) * span, -1 + (j + 0.5) * span, this._d3);
    out.set(this._d3[0], this._d3[1], this._d3[2]).multiplyScalar(this.R);
    return out;
  }

  update(camPos) {
    const S = this.stats;
    S.drawn = 0; S.maxDepth = 0;

    // upload a few finished tiles per frame — streaming, not stuttering
    let uploads = 0;
    while (this.results.length && uploads < 4) {
      const data = this.results.shift();
      this.pending.delete(data.key);
      if (!this.tiles.has(data.key)) { this._adopt(data); S.built++; }
      uploads++;
    }

    const camR = camPos.length();
    const camDir = _v1.copy(camPos).multiplyScalar(1 / (camR || 1));
    // everything past the horizon (plus a node's own angular radius) is skippable
    const horizon = Math.acos(Math.min(this.R * 0.995 / Math.max(camR, this.R), 1));

    const show = _showSet; show.clear();
    const sticky = this._sticky; sticky.clear();
    this._misses.length = 0;

    const visit = (face, depth, i, j) => {
      const c = this._center(face, depth, i, j, _v2);
      const ang = HALF_ANG / (1 << depth);          // angular half-span
      const cDir = _v3.copy(c).multiplyScalar(1 / this.R);
      // margin: the node's own angular size plus the height a mountain can
      // poke above the geometric horizon (√(2·amp/R))
      if (depth >= 2 && cDir.dot(camDir) <
        Math.cos(horizon + ang * 2.4 + Math.sqrt(2 * this.amp / this.R) + 0.02)) return;

      const dist = Math.max(_v4.copy(c).sub(camPos).length() - this.R * ang, 0.002);
      const chord = this.R * ang * 2;
      const key = face + ':' + depth + ':' + i + ':' + j;
      const tile = this.tiles.get(key);
      if (tile) { sticky.add(key); this.tiles.delete(key); this.tiles.set(key, tile); } // LRU touch

      if (depth < this.maxDepth && dist < chord * this.splitK) {
        // want children: draw them if all four are resident, else stream them
        let ready = true;
        for (let q = 0; q < 4; q++) {
          const ci = i * 2 + (q & 1), cj = j * 2 + (q >> 1);
          const ck = face + ':' + (depth + 1) + ':' + ci + ':' + cj;
          if (!this.tiles.has(ck)) {
            ready = false;
            if (!this.pending.has(ck)) {
              this._misses.push({
                key: ck, face, depth: depth + 1, i: ci, j: cj,
                prio: chord / dist,
              });
            }
          }
        }
        if (ready) {
          for (let q = 0; q < 4; q++) visit(face, depth + 1, i * 2 + (q & 1), j * 2 + (q >> 1));
          return;
        }
      }
      if (tile) {
        show.add(key);
        S.drawn++;
        if (depth > S.maxDepth) S.maxDepth = depth;
      }
    };
    for (let f = 0; f < 6; f++) visit(f, 0, 0, 0);

    // flip visibility only where it changed
    for (const key of this._shown) {
      if (!show.has(key)) { const t = this.tiles.get(key); if (t) t.mesh.visible = false; }
    }
    for (const key of show) {
      if (!this._shown.has(key)) { const t = this.tiles.get(key); if (t) t.mesh.visible = true; }
    }
    const tmp = this._shown; this._shown = show; _showSet = tmp;

    // dispatch the most urgent misses to idle workers
    this._misses.sort((a, b) => b.prio - a.prio);
    for (const m of this._misses) {
      if (!this.idle.length) break;
      const wk = this.idle.pop();
      this.pending.add(m.key);
      wk._job = m.key;
      wk.postMessage({ ...this.job, key: m.key, face: m.face, depth: m.depth, i: m.i, j: m.j });
    }

    // evict cold tiles (never one that is drawn or was touched this frame)
    if (this.tiles.size > this.cap) {
      for (const [key, t] of this.tiles) {
        if (this.tiles.size <= this.cap) break;
        if (sticky.has(key) || this._shown.has(key)) continue;
        t.geo.dispose(); t.mesh.material.dispose();
        this.group.remove(t.mesh);
        this.tiles.delete(key);
      }
    }

    S.cached = this.tiles.size;
    S.pending = this.pending.size;
    S.tris = S.drawn * this.trisPerTile;
  }

  dispose() {
    for (const wk of this.workers) wk.terminate();
    for (const [, t] of this.tiles) { t.geo.dispose(); t.mesh.material.dispose(); }
    this.tiles.clear();
  }
}

// scratch vectors — update() runs hot
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _v4 = new THREE.Vector3();
let _showSet = new Set();
