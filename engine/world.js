// The world: an endless procedural map (from the seed) with hand-made places stamped
// on top (towns, paths, buildings from world/world.json) and tile edits on top of
// that (the owner's world.json `tiles`, then community contributions in order).
//
// Tile = { h, t, p } — h: height level (0 = sea floor, each level 0.5 units),
// t: terrain id (catalog TERRAINS), p: prop id (catalog PROPS) or null.

import { createNoise2D, fbm, hash2, hashString } from './noise.js';
import { TERRAINS, PROPS } from './catalog.js';

export const CHUNK = 16;
export const MAX_H = 14;

const key = (x, y) => x + ',' + y;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

export class World {
  constructor(def) {
    this.def = def;
    this.seed = typeof def.seed === 'number' ? def.seed >>> 0 : hashString(String(def.seed ?? 'stonks'));
    const s = this.seed;
    this.nElev = createNoise2D(s);
    this.nRidge = createNoise2D(s + 1);
    this.nMount = createNoise2D(s + 2);
    this.nRiver = createNoise2D(s + 3);
    this.nMoist = createNoise2D(s + 4);
    this.nPatch = createNoise2D(s + 5);
    this.places = (def.places || []).map(p => ({ ...p, buildings: p.buildings || [], paths: p.paths || [] }));
    this.paths = [];
    for (const p of this.places) for (const seg of p.paths) this.paths.push(seg);
    for (const seg of def.paths || []) this.paths.push(seg);
    /** key → partial tile, applied over generated tiles */
    this.overrides = new Map();
    /** key → text for signs / chests */
    this.texts = new Map();
    this.cache = new Map();
    this.listeners = new Set();
    for (const p of this.places) {
      for (const b of p.buildings) this.setOverride(b.x, b.y, { p: b.type || 'house', ...(b.color ? { c: b.color } : {}) }, false);
    }
    for (const e of def.tiles || []) this.applyEdit(e, false);
    for (const s2 of def.signs || []) {
      this.setOverride(s2.x, s2.y, { p: s2.prop || 'sign' }, false);
      this.setText(s2.x, s2.y, s2.text, false);
    }
  }

  onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(x, y) { for (const fn of this.listeners) fn(x, y); }

  // ───────────── natural generation ─────────────

  elevation(x, y) {
    let e = fbm(this.nElev, x / 170, y / 170, 5);
    // Keep the area around the spawn on gentle land; mountains rise further out.
    const spawn = this.def.spawn || { x: 0, y: 0 };
    const d = Math.hypot(x - spawn.x, y - spawn.y);
    e = e + (0.5 - e) * 0.6 * Math.exp(-(d * d) / (60 * 60));
    const ridge = 1 - Math.abs(this.nRidge(x / 70, y / 70));
    e += smooth(0.55, 0.8, fbm(this.nMount, x / 300, y / 300, 2)) * ridge * ridge * 0.38 * smooth(50, 140, d);
    return e;
  }

  natural(x, y) {
    const e = this.elevation(x, y);
    const m = fbm(this.nMoist, x / 140 + 100, y / 140 - 100, 4);
    const r = hash2(x, y, this.seed);
    const river = Math.abs(fbm(this.nRiver, x / 190, y / 190, 3) - 0.5);
    let h, t, p = null;

    if (e < 0.36 || (river < 0.011 && e < 0.52)) {
      return { h: 0, t: e < 0.3 ? 'deep' : 'water', p: null };
    }
    if (e < 0.4 || (river < 0.02 && e < 0.52)) {
      h = 1; t = 'sand';
      if (r < 0.015) p = 'tree_palm'; else if (r < 0.025) p = 'rock';
      return { h, t, p };
    }
    if (e < 0.66) {
      h = 1 + Math.floor((e - 0.4) / 0.06);
      const patch = fbm(this.nPatch, x / 18, y / 18, 2);
      if (m > 0.6) {
        t = 'forest';
        if (r < 0.4) p = h >= 5 ? 'tree_pine' : (hash2(x, y, this.seed + 9) < 0.72 ? 'tree_oak' : 'tree_pine');
        else if (r < 0.45) p = 'bush';
        else if (r < 0.48) p = 'mushroom';
      } else if (m < 0.33) {
        t = 'dry';
        if (r < 0.012) p = 'rock'; else if (r < 0.02) p = 'bush';
        else if (patch > 0.64 && r < 0.7) p = 'tallgrass';
      } else {
        t = m > 0.47 ? 'grass' : 'meadow';
        if (patch > 0.6 && r < 0.85) p = 'tallgrass';
        else if (r < 0.02) p = hash2(x, y, this.seed + 7) < 0.15 ? 'tree_cherry' : 'tree_oak';
        else if (r < 0.04) p = 'bush';
        else if (r < (t === 'meadow' ? 0.13 : 0.07)) p = 'flowers';
        else if (r < 0.08) p = 'rock';
      }
      return { h, t, p };
    }
    if (e < 0.76) {
      h = 6 + Math.floor((e - 0.66) / 0.05);
      t = 'rock';
      if (r < 0.07) p = 'rock'; else if (r < 0.1) p = 'boulder'; else if (r < 0.13) p = 'tree_pine';
      return { h, t, p };
    }
    h = Math.min(MAX_H, 8 + Math.floor((e - 0.76) / 0.06));
    t = 'snow';
    if (r < 0.06) p = 'tree_snow'; else if (r < 0.08) p = 'rock';
    return { h, t, p };
  }

  /** Natural tile with places and paths stamped on top (no edits). */
  base(x, y) {
    const tile = this.natural(x, y);
    for (const pl of this.places) {
      const r = pl.radius || 10;
      const d = Math.hypot(x - pl.x, y - pl.y);
      if (d > r + 4) continue;
      if (pl._h === undefined) pl._h = pl.height ?? Math.max(1, this.natural(pl.x, pl.y).h);
      if (d <= r) {
        tile.h = pl._h;
        tile.t = pl.ground || 'grass';
        tile.p = null;
        // A few decorative flowers inside towns, never on paths or buildings.
        if (hash2(x, y, this.seed + 3) < 0.03 && d < r - 1) tile.p = 'flowers';
      } else {
        const k = (d - r) / 4;
        tile.h = Math.round(pl._h + (tile.h - pl._h) * k);
        if (TERRAINS[tile.t]?.liquid) { tile.t = 'sand'; tile.h = Math.max(1, tile.h); }
        if (hash2(x, y, this.seed + 11) > k) tile.p = null;
      }
    }
    for (const seg of this.paths) {
      if (distToSegment(x, y, seg) <= 0.75) {
        if (TERRAINS[tile.t]?.liquid) { tile.t = 'bridge'; tile.h = 1; }
        else tile.t = seg[4] || 'path';
        tile.p = null;
      }
    }
    return tile;
  }

  // ───────────── edits ─────────────

  /** Edit = { x, y, h?, t?, p? } where p: null/"" removes the prop. */
  applyEdit(e, notify = true) {
    const x = Math.round(e.x), y = Math.round(e.y);
    const patch = {};
    if (e.h !== undefined) patch.h = clamp(Math.round(e.h), 0, MAX_H);
    if (e.t !== undefined && TERRAINS[e.t]) patch.t = e.t;
    if (e.p !== undefined) patch.p = e.p && PROPS[e.p] ? e.p : null;
    if (e.c !== undefined) patch.c = e.c;
    this.setOverride(x, y, patch, notify);
    if (e.text !== undefined) this.setText(x, y, e.text, notify);
  }

  setOverride(x, y, patch, notify = true) {
    const k = key(x, y);
    this.overrides.set(k, { ...(this.overrides.get(k) || {}), ...patch });
    this.cache.delete(k);
    if (notify) this.emit(x, y);
  }

  setText(x, y, text, notify = true) {
    this.texts.set(key(x, y), String(text || '').slice(0, 500));
    if (notify) this.emit(x, y);
  }

  textAt(x, y) { return this.texts.get(key(x, y)) || ''; }

  // ───────────── queries ─────────────

  tile(x, y) {
    const k = key(x, y);
    let t = this.cache.get(k);
    if (t) return t;
    t = this.base(x, y);
    const o = this.overrides.get(k);
    if (o) {
      if (o.h !== undefined) t.h = o.h;
      if (o.t !== undefined) t.t = o.t;
      if (o.p !== undefined) t.p = o.p;
      if (o.c !== undefined) t.c = o.c;
      // Raising a water tile turns it into land.
      if (o.h !== undefined && o.h > 0 && TERRAINS[t.t]?.liquid && o.t === undefined) t.t = 'sand';
    }
    if (this.cache.size > 200000) this.cache.clear();
    this.cache.set(k, t);
    return t;
  }

  heightAt(x, y) { return this.tile(x, y).h; }

  /** Building that covers (x, y) with its footprint, if any. */
  footprintOwner(x, y) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const p = this.tile(x + dx, y + dy).p;
        if (p && PROPS[p]?.footprint >= Math.max(Math.abs(dx), Math.abs(dy))) return { x: x + dx, y: y + dy, p };
      }
    }
    return null;
  }

  isBlocked(x, y) {
    const t = this.tile(x, y);
    if (TERRAINS[t.t]?.liquid) return true;
    if (t.p && PROPS[t.p]?.block) return true;
    return !!this.footprintOwner(x, y);
  }

  canStep(fx, fy, tx, ty) {
    if (this.isBlocked(tx, ty)) return false;
    return Math.abs(this.heightAt(tx, ty) - this.heightAt(fx, fy)) <= 1;
  }

  placeAt(x, y) {
    for (const pl of this.places) {
      if (Math.hypot(x - pl.x, y - pl.y) <= (pl.radius || 10) + 2) return pl;
    }
    return null;
  }

  /** Nearest walkable tile to (x, y) — used for spawns and teleports. */
  findWalkable(x, y, maxR = 30) {
    for (let r = 0; r <= maxR; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (!this.isBlocked(x + dx, y + dy)) return { x: x + dx, y: y + dy };
        }
      }
    }
    return { x, y };
  }
}

function distToSegment(px, py, seg) {
  const [x1, y1, x2, y2] = seg;
  const dx = x2 - x1, dy = y2 - y1;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - x1) * dx + (py - y1) * dy) / len2 : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}
