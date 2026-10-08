// WebGL renderer: isometric orthographic camera, chunked terrain meshes with vertex
// colours and corner AO, instanced props, animated water, soft shadows, drifting
// cloud shadows and a day/night cycle with lamps that light up after dusk.

import * as THREE from 'three';
import { CHUNK } from './world.js';
import { TERRAINS, SIDE_COLORS, PROPS } from './catalog.js';
import { hash2 } from './noise.js';
import { propGeometry, FIXED_ORIENTATION, FIXED_SCALE } from './props.js';

export const STEP = 0.5;          // world units per height level
export const WATER_Y = 0.32;      // water surface

const ISO = new THREE.Vector3(1, 1, 1).normalize();
const tmpColor = new THREE.Color();
const tmpColor2 = new THREE.Color();

export class Renderer {
  constructor(canvas, world, opts = {}) {
    this.world = world;
    this.viewChunks = opts.viewChunks ?? 3;
    this.dayLength = opts.dayLengthSec ?? 600;
    this.timeOfDay = opts.startTime ?? 0.35;

    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    // The camera sits 60 units from the focus, so the fog starts behind the visible area.
    this.scene.fog = new THREE.Fog(0xbfe3f5, 75, 150);

    this.zoom = opts.zoom ?? 1;
    this.camera = new THREE.OrthographicCamera(-10, 10, 10, -10, 0.1, 400);
    this.target = new THREE.Vector3();

    this.hemi = new THREE.HemisphereLight(0xcfeaff, 0x5a7a3a, 0.9);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff1d6, 2.2);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -26; sc.right = 26; sc.top = 26; sc.bottom = -26; sc.near = 1; sc.far = 120;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    this.terrainMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    this.propMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, flatShading: true });

    this.buildWater();
    this.buildClouds();
    this.buildHighlight();

    this.lampLights = [];
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(0xffc46b, 0, 7, 1.6);
      this.scene.add(l);
      this.lampLights.push(l);
    }

    this.chunks = new Map();     // "cx,cy" → { group, terrain, lights: [] }
    this.dirty = new Set();
    world.onChange((x, y) => {
      const cx = Math.floor(x / CHUNK), cy = Math.floor(y / CHUNK);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const lx = x - (cx + dx) * CHUNK, ly = y - (cy + dy) * CHUNK;
        if (lx >= -2 && lx <= CHUNK + 1 && ly >= -2 && ly <= CHUNK + 1) this.dirty.add((cx + dx) + ',' + (cy + dy));
      }
    });

    this.raycaster = new THREE.Raycaster();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.applyZoom();
  }

  applyZoom() {
    // ~22 tiles across the short side at zoom 1.
    const half = 11 / this.zoom;
    const a = this.aspect || 1;
    this.camera.left = -half * Math.max(a, 1);
    this.camera.right = half * Math.max(a, 1);
    this.camera.top = half / Math.min(a, 1);
    this.camera.bottom = -half / Math.min(a, 1);
    this.camera.updateProjectionMatrix();
  }

  setZoom(z) {
    this.zoom = Math.max(0.45, Math.min(2.6, z));
    this.applyZoom();
  }

  // ───────────── scene pieces ─────────────

  buildWater() {
    const size = 256;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    // Tileable bumpy height → normal map.
    const hgt = (x, y) => {
      let v = 0;
      for (let k = 1; k <= 4; k++) {
        const f = (Math.PI * 2 * k) / size;
        v += Math.sin(x * f * (k + 1) + k * 1.7) * Math.cos(y * f * (5 - k) + k) / k;
      }
      return v;
    };
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const dx = hgt(x + 1, y) - hgt(x - 1, y);
      const dy = hgt(x, y + 1) - hgt(x, y - 1);
      const n = new THREE.Vector3(-dx * 2, -dy * 2, 1).normalize();
      const i = (y * size + x) * 4;
      img.data[i] = (n.x * 0.5 + 0.5) * 255;
      img.data[i + 1] = (n.y * 0.5 + 0.5) * 255;
      img.data[i + 2] = (n.z * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const normal = new THREE.CanvasTexture(cv);
    normal.wrapS = normal.wrapT = THREE.RepeatWrapping;
    normal.repeat.set(24, 24);
    this.waterNormal = normal;
    this.water = new THREE.Mesh(
      new THREE.PlaneGeometry(220, 220),
      new THREE.MeshStandardMaterial({
        color: 0x3a9fd0, transparent: true, opacity: 0.78, roughness: 0.12, metalness: 0.15,
        normalMap: normal, normalScale: new THREE.Vector2(0.35, 0.35),
      })
    );
    this.water.rotation.x = -Math.PI / 2;
    this.water.position.y = WATER_Y;
    this.water.receiveShadow = true;
    this.scene.add(this.water);
  }

  buildClouds() {
    this.clouds = [];
    // Clouds are never drawn (they would cover the iso view) — only their shadows
    // drift over the land.
    const mat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
    for (let i = 0; i < 7; i++) {
      const g = new THREE.Group();
      const n = 3 + (i % 3);
      for (let j = 0; j < n; j++) {
        const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1 + ((i + j) % 3) * 0.4, 1), mat);
        m.position.set(j * 1.3 - n * 0.6, ((j * 7) % 3) * 0.25, ((j * 5) % 3) * 0.5);
        m.castShadow = true;
        g.add(m);
      }
      g.position.set((i * 37) % 60 - 30, 14 + (i % 3), (i * 23) % 60 - 30);
      g.userData.speed = 0.4 + (i % 4) * 0.15;
      this.scene.add(g);
      this.clouds.push(g);
    }
  }

  buildHighlight() {
    const pts = [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]].map(([x, z]) => new THREE.Vector3(x, 0.03, z));
    const geo = new THREE.BufferGeometry().setFromPoints(pts);
    this.highlight = new THREE.LineLoop(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9 }));
    this.highlight.visible = false;
    this.scene.add(this.highlight);
  }

  showHighlight(tile, color = 0xffffff) {
    if (!tile) { this.highlight.visible = false; return; }
    const h = this.world.heightAt(tile.x, tile.y);
    this.highlight.position.set(tile.x, Math.max(h * STEP, TERRAINS[this.world.tile(tile.x, tile.y).t]?.liquid ? WATER_Y : 0), tile.y);
    this.highlight.material.color.set(color);
    this.highlight.visible = true;
  }

  // ───────────── chunks ─────────────

  buildChunk(cx, cy) {
    const world = this.world;
    const pos = [], nor = [], col = [];
    const x0 = cx * CHUNK, y0 = cy * CHUNK;
    const quad = (a, b, c, d, n, ca, cb, cc, cd) => {
      pos.push(...a, ...b, ...c, ...a, ...c, ...d);
      for (let i = 0; i < 6; i++) nor.push(...n);
      col.push(...ca, ...cb, ...cc, ...ca, ...cc, ...cd);
    };
    const byProp = new Map();
    const lights = [];

    for (let ly = 0; ly < CHUNK; ly++) {
      for (let lx = 0; lx < CHUNK; lx++) {
        const x = x0 + lx, y = y0 + ly;
        const t = world.tile(x, y);
        const top = t.h * STEP;
        const terr = TERRAINS[t.t] || TERRAINS.grass;
        // Per-tile colour variation keeps big fields from looking flat.
        const v = hash2(x, y, world.seed + 101);
        tmpColor.set(terr.color);
        tmpColor.offsetHSL((v - 0.5) * 0.02, (v - 0.5) * 0.06, (v - 0.5) * 0.06 + Math.min(t.h, 10) * 0.004);
        if (terr.liquid) tmpColor.multiplyScalar(t.t === 'deep' ? 0.55 : 0.8);
        const base = [tmpColor.r, tmpColor.g, tmpColor.b];
        // Corner ambient occlusion from higher neighbours.
        const ao = (dx, dy) => {
          let n = 0;
          if (world.heightAt(x + dx, y) > t.h) n++;
          if (world.heightAt(x, y + dy) > t.h) n++;
          if (world.heightAt(x + dx, y + dy) > t.h) n++;
          const k = 1 - n * 0.13;
          return [base[0] * k, base[1] * k, base[2] * k];
        };
        quad(
          [x - 0.5, top, y - 0.5], [x - 0.5, top, y + 0.5], [x + 0.5, top, y + 0.5], [x + 0.5, top, y - 0.5],
          [0, 1, 0], ao(-1, -1), ao(-1, 1), ao(1, 1), ao(1, -1)
        );

        // Cliff sides toward lower neighbours.
        tmpColor2.set(SIDE_COLORS[t.t] || SIDE_COLORS.default);
        const sides = [
          [1, 0, [x + 0.5, y - 0.5], [x + 0.5, y + 0.5], [1, 0, 0], 0.92],
          [-1, 0, [x - 0.5, y + 0.5], [x - 0.5, y - 0.5], [-1, 0, 0], 0.7],
          [0, 1, [x + 0.5, y + 0.5], [x - 0.5, y + 0.5], [0, 0, 1], 1.0],
          [0, -1, [x - 0.5, y - 0.5], [x + 0.5, y - 0.5], [0, 0, -1], 0.7],
        ];
        for (const [dx, dy, a, b, n, shade] of sides) {
          const nh = world.heightAt(x + dx, y + dy);
          if (nh >= t.h) continue;
          const bottom = nh * STEP;
          const ct = [tmpColor2.r * shade, tmpColor2.g * shade, tmpColor2.b * shade];
          const cbm = [ct[0] * 0.72, ct[1] * 0.72, ct[2] * 0.72];
          // A lip of the top colour makes grass edges read clearly.
          const lip = Math.min(0.08, top - bottom);
          const topCol = [base[0] * shade * 0.92, base[1] * shade * 0.92, base[2] * shade * 0.92];
          quad([a[0], top, a[1]], [b[0], top, b[1]], [b[0], top - lip, b[1]], [a[0], top - lip, a[1]], n, topCol, topCol, topCol, topCol);
          quad([a[0], top - lip, a[1]], [b[0], top - lip, b[1]], [b[0], bottom, b[1]], [a[0], bottom, a[1]], n, ct, ct, cbm, cbm);
        }

        if (t.p && !world.footprintOwner(x, y)) {
          if (!byProp.has(t.p)) byProp.set(t.p, []);
          byProp.get(t.p).push({ x, y, top, c: t.c });
          if (PROPS[t.p]?.light) lights.push(new THREE.Vector3(x, top + 1.1, y));
        }
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeBoundingSphere();
    const terrain = new THREE.Mesh(geo, this.terrainMat);
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    terrain.userData.chunk = true;

    const group = new THREE.Group();
    group.add(terrain);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    for (const [id, list] of byProp) {
      const inst = new THREE.InstancedMesh(propGeometry(id), this.propMat, list.length);
      inst.castShadow = true;
      inst.receiveShadow = true;
      list.forEach((it, i) => {
        const r = hash2(it.x, it.y, this.world.seed + 202);
        q.setFromAxisAngle(up, FIXED_ORIENTATION.has(id) ? 0 : r * Math.PI * 2);
        const k = FIXED_SCALE.has(id) ? 1 : 0.82 + r * 0.36;
        s.set(k, k, k);
        p.set(it.x, it.top, it.y);
        m4.compose(p, q, s);
        inst.setMatrixAt(i, m4);
        tmpColor.set(it.c || '#ffffff');
        if (!it.c) tmpColor.offsetHSL(0, 0, (r - 0.5) * 0.12);
        inst.setColorAt(i, tmpColor);
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.computeBoundingSphere();
      group.add(inst);
    }
    this.scene.add(group);
    return { group, terrain, lights };
  }

  disposeChunk(c) {
    this.scene.remove(c.group);
    c.group.traverse(o => { if (o.isMesh && o.geometry && o === c.terrain) o.geometry.dispose(); if (o.isInstancedMesh) o.dispose(); });
  }

  updateChunks(fx, fy, budget = 2) {
    const ccx = Math.floor(fx / CHUNK), ccy = Math.floor(fy / CHUNK);
    const R = this.viewChunks;
    for (const k of this.dirty) {
      const c = this.chunks.get(k);
      if (!c) continue;
      const [cx, cy] = k.split(',').map(Number);
      this.disposeChunk(c);
      this.chunks.set(k, this.buildChunk(cx, cy));
    }
    this.dirty.clear();
    const want = [];
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const k = (ccx + dx) + ',' + (ccy + dy);
      if (!this.chunks.has(k)) want.push([dx * dx + dy * dy, ccx + dx, ccy + dy, k]);
    }
    want.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < Math.min(budget, want.length); i++) {
      const [, cx, cy, k] = want[i];
      this.chunks.set(k, this.buildChunk(cx, cy));
    }
    for (const [k, c] of this.chunks) {
      const [cx, cy] = k.split(',').map(Number);
      if (Math.abs(cx - ccx) > R + 1 || Math.abs(cy - ccy) > R + 1) {
        this.disposeChunk(c);
        this.chunks.delete(k);
      }
    }
    return want.length;
  }

  // ───────────── picking ─────────────

  pickTile(clientX, clientY) {
    const ndc = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const meshes = [];
    for (const c of this.chunks.values()) meshes.push(c.terrain);
    const hit = this.raycaster.intersectObjects(meshes, false)[0];
    if (!hit) return null;
    const n = hit.face.normal;
    return { x: Math.round(hit.point.x - n.x * 0.01), y: Math.round(hit.point.z - n.z * 0.01) };
  }

  // ───────────── frame ─────────────

  /** Day factor 0 (midnight) … 1 (noon). */
  daylight() {
    return Math.max(0, Math.sin((this.timeOfDay - 0.25) * Math.PI * 2) * 0.5 + 0.5);
  }

  update(dt, focus) {
    this.timeOfDay = (this.timeOfDay + dt / this.dayLength) % 1;
    const sunAngle = (this.timeOfDay - 0.25) * Math.PI * 2;
    const day = Math.sin(sunAngle);                // -1 … 1
    const light = Math.max(0, day);
    const dusk = Math.max(0, 1 - Math.abs(day) * 3.5);   // peaks at sunrise/sunset
    const night = Math.max(0, -day);

    this.target.lerp(focus, 1 - Math.pow(0.0015, dt));
    this.camera.position.copy(this.target).addScaledVector(ISO, 60);
    this.camera.lookAt(this.target);

    // Sun arcs over the scene; at night a dim blue "moon" keeps shapes readable.
    const dir = new THREE.Vector3(Math.cos(sunAngle) * 0.8, Math.max(0.35, Math.abs(Math.sin(sunAngle))), 0.55).normalize();
    this.sun.position.copy(this.target).addScaledVector(dir, 50);
    this.sun.target.position.copy(this.target);
    this.sun.color.setRGB(1, 0.92 - dusk * 0.3, 0.82 - dusk * 0.45).lerp(tmpColor.set(0x8fa8ff), night);
    this.sun.intensity = 0.35 + light * 2.0;

    const sky = tmpColor.set(0x9fd6f2).lerp(tmpColor2.set(0xf2a477), dusk * 0.7).lerp(new THREE.Color(0x101a33), night * 0.92);
    this.scene.background = sky.clone();
    this.scene.fog.color.copy(sky);
    this.hemi.intensity = 0.35 + light * 0.7;
    this.hemi.color.setRGB(0.8 + light * 0.2, 0.85 + light * 0.1, 1);
    this.renderer.toneMappingExposure = 0.95 + light * 0.15;

    // Lamps: the nearest light props get a real point light after dusk.
    const lampOn = Math.min(1, night * 3 + dusk * 0.4);
    if (lampOn > 0.01) {
      const all = [];
      for (const c of this.chunks.values()) for (const l of c.lights) all.push(l);
      all.sort((a, b) => a.distanceToSquared(this.target) - b.distanceToSquared(this.target));
      this.lampLights.forEach((pl, i) => {
        if (all[i]) { pl.position.copy(all[i]); pl.intensity = 6 * lampOn; } else pl.intensity = 0;
      });
    } else {
      for (const pl of this.lampLights) pl.intensity = 0;
    }

    // Water follows the camera on a coarse grid so it always covers the view.
    this.water.position.x = Math.round(this.target.x / 8) * 8;
    this.water.position.z = Math.round(this.target.z / 8) * 8;
    this.waterNormal.offset.x = (this.waterNormal.offset.x + dt * 0.012) % 1;
    this.waterNormal.offset.y = (this.waterNormal.offset.y + dt * 0.007) % 1;
    this.water.material.color.setRGB(0.22, 0.6, 0.82).multiplyScalar(0.35 + light * 0.65);

    for (const c of this.clouds) {
      c.position.x += c.userData.speed * dt;
      if (c.position.x - this.target.x > 40) c.position.x -= 80;
      if (c.position.x - this.target.x < -40) c.position.x += 80;
      if (c.position.z - this.target.z > 40) c.position.z -= 80;
      if (c.position.z - this.target.z < -40) c.position.z += 80;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
