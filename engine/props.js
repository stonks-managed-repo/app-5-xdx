// Low-poly meshes for props and characters, built from primitives with vertex colours
// so a whole chunk of one prop type renders as a single InstancedMesh.
// Every builder returns a BufferGeometry whose origin is the centre of the tile top.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

function paint(geo, color) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const c = new THREE.Color(color);
  const n = g.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  if (g.attributes.uv) g.deleteAttribute('uv');
  return g;
}

const part = (geo, color, x = 0, y = 0, z = 0, ry = 0) => {
  const g = paint(geo, color);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  return g;
};

const merge = parts => {
  const g = mergeGeometries(parts, false);
  g.computeVertexNormals();
  return g;
};

/** Slightly lumpy sphere for canopies and rocks. */
function lumpy(radius, detail, amount, seed) {
  const g = new THREE.IcosahedronGeometry(radius, detail);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 1 + amount * Math.sin(x * 7.1 + seed) * Math.cos(z * 6.3 + seed * 2) * Math.sin(y * 5.7 + seed);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  return g;
}

const BUILDERS = {
  tree_oak: () => merge([
    part(new THREE.CylinderGeometry(0.08, 0.12, 0.7, 6), '#7a5232', 0, 0.35, 0),
    part(lumpy(0.48, 1, 0.12, 1), '#4f9d3a', 0, 1.0, 0),
    part(lumpy(0.32, 1, 0.12, 2), '#62b347', 0.18, 1.32, 0.08),
    part(lumpy(0.3, 1, 0.1, 3), '#458a33', -0.2, 1.18, -0.12),
  ]),
  tree_cherry: () => merge([
    part(new THREE.CylinderGeometry(0.07, 0.11, 0.65, 6), '#6b4430', 0, 0.32, 0),
    part(lumpy(0.46, 1, 0.14, 4), '#f2a7c3', 0, 0.98, 0),
    part(lumpy(0.3, 1, 0.12, 5), '#f7c4d6', 0.2, 1.28, 0.05),
  ]),
  tree_pine: () => merge([
    part(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 6), '#6b4630', 0, 0.25, 0),
    part(new THREE.ConeGeometry(0.5, 0.75, 7), '#2f7d4a', 0, 0.75, 0),
    part(new THREE.ConeGeometry(0.4, 0.62, 7), '#358c52', 0, 1.15, 0),
    part(new THREE.ConeGeometry(0.28, 0.5, 7), '#3d9a5b', 0, 1.5, 0),
  ]),
  tree_snow: () => merge([
    part(new THREE.CylinderGeometry(0.07, 0.1, 0.5, 6), '#6b4630', 0, 0.25, 0),
    part(new THREE.ConeGeometry(0.5, 0.75, 7), '#2c6e46', 0, 0.75, 0),
    part(new THREE.ConeGeometry(0.42, 0.25, 7), '#f4f8fb', 0, 0.98, 0),
    part(new THREE.ConeGeometry(0.36, 0.6, 7), '#30794c', 0, 1.18, 0),
    part(new THREE.ConeGeometry(0.22, 0.32, 7), '#f4f8fb', 0, 1.5, 0),
  ]),
  tree_palm: () => {
    const parts = [];
    for (let i = 0; i < 5; i++) {
      const seg = paint(new THREE.CylinderGeometry(0.07, 0.085, 0.3, 6), '#9b7650');
      seg.translate(i * 0.035, 0.15 + i * 0.28, 0);
      parts.push(seg);
    }
    for (let i = 0; i < 6; i++) {
      const leaf = paint(new THREE.BoxGeometry(0.7, 0.03, 0.16), i % 2 ? '#3f9a46' : '#4daf52');
      leaf.translate(0.35, 0, 0);
      leaf.rotateZ(-0.45);
      leaf.rotateY((i / 6) * Math.PI * 2);
      leaf.translate(0.15, 1.5, 0);
      parts.push(leaf);
    }
    return merge(parts);
  },
  bush: () => merge([
    part(lumpy(0.3, 1, 0.15, 6), '#4c9a3c', 0, 0.22, 0),
    part(lumpy(0.22, 1, 0.15, 7), '#5aae47', 0.18, 0.2, 0.1),
    part(lumpy(0.2, 1, 0.15, 8), '#438a35', -0.15, 0.18, -0.1),
  ]),
  rock: () => merge([part(lumpy(0.28, 0, 0.18, 9), '#9a958e', 0, 0.16, 0)]),
  boulder: () => merge([
    part(lumpy(0.45, 0, 0.2, 10), '#8b8680', 0, 0.3, 0),
    part(lumpy(0.22, 0, 0.2, 11), '#a19c95', 0.3, 0.12, 0.2),
  ]),
  flowers: () => {
    const parts = [];
    const colors = ['#ffffff', '#ffd23f', '#ff6b8b', '#b48cff', '#ff9f43'];
    for (let i = 0; i < 6; i++) {
      const a = i * 2.4, r = 0.12 + (i % 3) * 0.1;
      parts.push(part(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 3), '#3e8a35', Math.cos(a) * r, 0.08, Math.sin(a) * r));
      parts.push(part(new THREE.IcosahedronGeometry(0.045, 0), colors[i % colors.length], Math.cos(a) * r, 0.17, Math.sin(a) * r));
    }
    return merge(parts);
  },
  tallgrass: () => {
    const parts = [];
    for (let i = 0; i < 9; i++) {
      const a = i * 2.1, r = (i % 3) * 0.14 + 0.04;
      const blade = paint(new THREE.ConeGeometry(0.07, 0.42 + (i % 4) * 0.06, 4), i % 2 ? '#3f8f31' : '#4fa63c');
      blade.rotateZ(Math.sin(a) * 0.25);
      blade.rotateX(Math.cos(a) * 0.25);
      blade.translate(Math.cos(a) * r, 0.2, Math.sin(a) * r);
      parts.push(blade);
    }
    return merge(parts);
  },
  mushroom: () => merge([
    part(new THREE.CylinderGeometry(0.035, 0.045, 0.12, 6), '#f3ead8', 0, 0.06, 0),
    part(new THREE.SphereGeometry(0.09, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), '#d9443a', 0, 0.12, 0),
    part(new THREE.CylinderGeometry(0.025, 0.03, 0.08, 6), '#f3ead8', 0.14, 0.04, 0.08),
    part(new THREE.SphereGeometry(0.06, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2), '#d9443a', 0.14, 0.08, 0.08),
  ]),
  house: () => {
    const roof = new THREE.CylinderGeometry(0.01, 1.55, 0.95, 4, 1);
    roof.rotateY(Math.PI / 4);
    roof.scale(1, 1, 1.0);
    return merge([
      part(new THREE.BoxGeometry(2.3, 0.18, 2.3), '#b9b0a2', 0, 0.09, 0),
      part(new THREE.BoxGeometry(2.1, 1.2, 2.1), '#f4ead8', 0, 0.78, 0),
      part(roof, '#c8553d', 0, 1.85, 0),
      part(new THREE.BoxGeometry(0.42, 0.7, 0.05), '#7a4b2a', 0, 0.53, 1.07),
      part(new THREE.BoxGeometry(0.36, 0.3, 0.05), '#9fd3f0', -0.6, 0.9, 1.07),
      part(new THREE.BoxGeometry(0.36, 0.3, 0.05), '#9fd3f0', 0.6, 0.9, 1.07),
      part(new THREE.BoxGeometry(0.05, 0.3, 0.36), '#9fd3f0', 1.07, 0.9, 0.3),
      part(new THREE.BoxGeometry(0.22, 0.5, 0.22), '#8e5a43', 0.55, 2.0, -0.4),
    ]);
  },
  tower: () => merge([
    part(new THREE.CylinderGeometry(0.95, 1.05, 2.6, 10), '#d8d2c6', 0, 1.3, 0),
    part(new THREE.ConeGeometry(1.2, 1.2, 10), '#4a6fb5', 0, 3.2, 0),
    part(new THREE.BoxGeometry(0.42, 0.75, 0.1), '#6b4429', 0, 0.38, 1.0),
    part(new THREE.BoxGeometry(0.28, 0.4, 0.1), '#ffd98a', 0, 1.9, 0.98),
  ]),
  fence: () => merge([
    part(new THREE.BoxGeometry(0.08, 0.42, 0.08), '#a07045', -0.42, 0.21, 0),
    part(new THREE.BoxGeometry(0.08, 0.42, 0.08), '#a07045', 0.42, 0.21, 0),
    part(new THREE.BoxGeometry(1.0, 0.06, 0.05), '#b9824f', 0, 0.3, 0),
    part(new THREE.BoxGeometry(1.0, 0.06, 0.05), '#b9824f', 0, 0.15, 0),
  ]),
  lamp: () => merge([
    part(new THREE.CylinderGeometry(0.04, 0.06, 1.1, 6), '#3b3f48', 0, 0.55, 0),
    part(new THREE.BoxGeometry(0.2, 0.22, 0.2), '#ffe7a3', 0, 1.18, 0),
    part(new THREE.ConeGeometry(0.17, 0.12, 4), '#3b3f48', 0, 1.35, 0, Math.PI / 4),
  ]),
  sign: () => merge([
    part(new THREE.BoxGeometry(0.07, 0.5, 0.07), '#7a5232', 0, 0.25, 0),
    part(new THREE.BoxGeometry(0.55, 0.32, 0.06), '#c99a62', 0, 0.52, 0.03),
  ]),
  crate: () => merge([
    part(new THREE.BoxGeometry(0.5, 0.5, 0.5), '#b07c47', 0, 0.25, 0),
    part(new THREE.BoxGeometry(0.52, 0.06, 0.52), '#8a5c32', 0, 0.48, 0),
  ]),
  well: () => merge([
    part(new THREE.CylinderGeometry(0.42, 0.45, 0.45, 10), '#a6a198', 0, 0.22, 0),
    part(new THREE.CylinderGeometry(0.34, 0.34, 0.02, 10), '#3d8fb8', 0, 0.4, 0),
    part(new THREE.BoxGeometry(0.06, 0.8, 0.06), '#7a5232', -0.38, 0.75, 0),
    part(new THREE.BoxGeometry(0.06, 0.8, 0.06), '#7a5232', 0.38, 0.75, 0),
    part(new THREE.ConeGeometry(0.6, 0.35, 4), '#b5503c', 0, 1.3, 0, Math.PI / 4),
  ]),
  campfire: () => {
    const parts = [];
    for (let i = 0; i < 4; i++) {
      const log = paint(new THREE.CylinderGeometry(0.05, 0.05, 0.5, 5), '#6b4429');
      log.rotateZ(Math.PI / 2 - 0.3);
      log.rotateY(i * Math.PI / 2);
      log.translate(0, 0.08, 0);
      parts.push(log);
    }
    parts.push(part(new THREE.ConeGeometry(0.16, 0.38, 6), '#ff8c2a', 0, 0.28, 0));
    parts.push(part(new THREE.ConeGeometry(0.09, 0.26, 6), '#ffd84a', 0, 0.3, 0));
    return merge(parts);
  },
  chest: () => merge([
    part(new THREE.BoxGeometry(0.55, 0.32, 0.38), '#9a6235', 0, 0.16, 0),
    part(new THREE.CylinderGeometry(0.19, 0.19, 0.55, 8, 1, false, 0, Math.PI).rotateZ(Math.PI / 2), '#b0743f', 0, 0.32, 0),
    part(new THREE.BoxGeometry(0.08, 0.1, 0.04), '#f2c94c', 0, 0.3, 0.2),
  ]),
};

const geoCache = new Map();

/** Shared geometry for a prop id (built once). Unknown ids fall back to a crate. */
export function propGeometry(id) {
  if (!geoCache.has(id)) {
    const build = BUILDERS[id] || BUILDERS.crate;
    geoCache.set(id, build());
  }
  return geoCache.get(id);
}

/** Props that keep their authored orientation (buildings face the camera). */
export const FIXED_ORIENTATION = new Set(['house', 'tower', 'sign', 'fence', 'chest', 'well']);

/** Props whose instances are not scaled randomly. */
export const FIXED_SCALE = new Set(['house', 'tower', 'sign', 'fence', 'lamp', 'chest', 'well', 'crate', 'campfire']);

/** Register a custom prop mesh at runtime: registerProp('statue', () => geometry). */
export function registerProp(id, builder) {
  BUILDERS[id] = builder;
  geoCache.delete(id);
}

// ───────────── characters ─────────────

/**
 * A chunky low-poly character. look = { body, skin, hair, hat, pants }.
 * Returns a Group with named parts the animator moves (legs, arms, body).
 */
export function buildCharacter(look = {}) {
  const body = look.body || '#e0533d';
  const skin = look.skin || '#f1c7a1';
  const hair = look.hair || '#4a2f22';
  const pants = look.pants || '#3b4a6b';
  const mat = c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.75 });
  const g = new THREE.Group();
  const add = (geo, color, x, y, z, name) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(x, y, z);
    m.castShadow = true;
    if (name) m.name = name;
    g.add(m);
    return m;
  };
  const legGeo = new THREE.BoxGeometry(0.13, 0.32, 0.14);
  legGeo.translate(0, -0.16, 0);
  add(legGeo, pants, -0.09, 0.32, 0, 'legL');
  add(legGeo, pants, 0.09, 0.32, 0, 'legR');
  add(new THREE.BoxGeometry(0.36, 0.36, 0.22), body, 0, 0.5, 0, 'torso');
  const armGeo = new THREE.BoxGeometry(0.1, 0.32, 0.12);
  armGeo.translate(0, -0.14, 0);
  add(armGeo, body, -0.24, 0.66, 0, 'armL');
  add(armGeo, body, 0.24, 0.66, 0, 'armR');
  add(new THREE.BoxGeometry(0.34, 0.32, 0.32), skin, 0, 0.86, 0, 'head');
  add(new THREE.BoxGeometry(0.36, 0.12, 0.34), hair, 0, 1.03, -0.01);
  add(new THREE.BoxGeometry(0.05, 0.06, 0.02), '#222', -0.08, 0.88, 0.165);
  add(new THREE.BoxGeometry(0.05, 0.06, 0.02), '#222', 0.08, 0.88, 0.165);
  if (look.hat) {
    add(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 10), look.hat, 0, 1.1, 0);
    add(new THREE.CylinderGeometry(0.28, 0.28, 0.02, 12), look.hat, 0, 1.07, 0.04);
  }
  // Soft blob shadow helps read the position on slopes.
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(0.28, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.01;
  g.add(blob);
  return g;
}

/** Walk-cycle pose; phase in radians, amount 0..1. */
export function animateCharacter(group, phase, amount) {
  const swing = Math.sin(phase) * 0.7 * amount;
  const legL = group.getObjectByName('legL'), legR = group.getObjectByName('legR');
  const armL = group.getObjectByName('armL'), armR = group.getObjectByName('armR');
  if (legL) legL.rotation.x = swing;
  if (legR) legR.rotation.x = -swing;
  if (armL) armL.rotation.x = -swing * 0.8;
  if (armR) armR.rotation.x = swing * 0.8;
  const torso = group.getObjectByName('torso');
  if (torso) torso.position.y = 0.5 + Math.abs(Math.sin(phase)) * 0.03 * amount;
}
