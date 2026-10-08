// Game bootstrap and loop: loads game.json + world data + community builds, then runs
// grid movement, NPCs, scenario triggers, wild encounters and the build-mode editor.

import * as THREE from 'three';
import { World } from './world.js';
import { Renderer, STEP } from './render.js';
import { buildCharacter, animateCharacter } from './props.js';
import { UI, el } from './ui.js';
import { runScenario, canRun } from './scenario.js';
import { runBattle, makeCreature, statsFor, creatureSVG } from './battle.js';
import { Community, namespaceBuild } from './community.js';
import { Editor } from './editor.js';
import { ITEMS, PROPS, ELEMENTS } from './catalog.js';
import { hash2 } from './noise.js';

const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

/** x-game mode: running inside an X post (twitter:player iframe, ?x-game) or another embed — compact UI. */
export const X_GAME = new URLSearchParams(location.search).has('x-game') || (() => {
  try { return window.self !== window.top; } catch { return true; }
})();
const KEY_DIRS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};

async function loadJSON(path, fallback) {
  try {
    const res = await fetch(path, { cache: 'no-cache' });
    if (!res.ok) return fallback;
    return await res.json();
  } catch {
    return fallback;
  }
}

class Game {
  async boot() {
    this.config = await loadJSON('game.json', {});
    document.title = this.config.title || 'Iso World';
    if (X_GAME) {
      document.body.classList.add('x-game');
      const full = document.getElementById('btn-full');
      if (full) { full.href = location.origin + location.pathname; full.hidden = false; }
    }
    const [worldDef, npcs, creatures] = await Promise.all([
      loadJSON(this.config.world || 'world/world.json', {}),
      loadJSON(this.config.npcs || 'world/npcs.json', []),
      loadJSON(this.config.creatures || 'world/creatures.json', []),
    ]);
    const scenarioFiles = this.config.scenarios || ['scenarios/main.json'];
    const scenarioSets = await Promise.all(scenarioFiles.map(f => loadJSON(f, [])));

    this.worldDef = worldDef;
    this.extraItems = worldDef.items || {};
    this.creatures = new Map(creatures.map(c => [c.id, c]));
    this.world = new World(worldDef);
    this.npcs = new Map();
    this.scenarios = [];
    this.saveKey = `iso-world:save:${this.config.community?.worldId || this.config.title || 'local'}`;
    this.state = this.loadState();

    this.canvas = document.getElementById('game');
    this.renderer = new Renderer(this.canvas, this.world, {
      viewChunks: this.config.viewChunks ?? 3,
      dayLengthSec: this.config.dayLengthSec ?? 600,
      startTime: this.state.time ?? this.config.startTime ?? 0.35,
      // The X player is a 480×480 square: get closer so characters read well.
      zoom: X_GAME ? 1.3 : 1,
    });
    this.ui = new UI();
    this.community = new Community(this.config.community);
    this.busy = false;

    for (const n of npcs) this.addNpc(n);
    for (const set of scenarioSets) for (const s of [].concat(set)) this.addScenario(s);

    // Community builds, oldest first, on top of the owner's world.
    const builds = await this.community.load();
    this.builds = builds;
    for (const b of builds) {
      const { edits, npcs: bn, scenarios: bs } = namespaceBuild(b);
      for (const e of edits) this.world.applyEdit(e, false);
      for (const n of bn) this.addNpc(n);
      for (const s of bs) this.addScenario(s);
    }

    this.editor = new Editor(this);
    this.editor.applyDraft();

    const spawn = worldDef.spawn || { x: 0, y: 0 };
    const start = this.state.pos || this.world.findWalkable(spawn.x, spawn.y);
    this.player = { x: start.x, y: start.y, facing: this.state.facing || 'down', from: null, t: 0, phase: 0 };
    this.player.mesh = buildCharacter(this.config.playerLook || { body: '#e0533d', hat: '#d94f3d' });
    this.renderer.scene.add(this.player.mesh);
    this.placeMesh(this.player.mesh, this.player.x, this.player.y);

    this.bindInput();
    this.bindHud();
    // Pre-build the chunks around the spawn so the first frame is complete.
    for (let i = 0; i < 6 && this.renderer.updateChunks(this.player.x, this.player.y, 12) > 0; i++);
    this.focus = new THREE.Vector3(this.player.x, this.world.heightAt(this.player.x, this.player.y) * STEP, this.player.y);
    this.renderer.target.copy(this.focus);
    this.last = performance.now();
    requestAnimationFrame(t => this.frame(t));
    document.getElementById('loading').hidden = true;
    this.titleScreen();
  }

  // ───────────── state ─────────────

  loadState() {
    const fresh = { flags: {}, items: {}, vars: {}, party: [], box: [], quests: {}, done: {}, seen: {}, playerName: '' };
    try {
      const s = JSON.parse(localStorage.getItem(this.saveKey) || 'null');
      if (s) return { ...fresh, ...s };
    } catch { /* new game */ }
    return { ...fresh, items: { ...(this.config.startItems || { potion: 2 }) } };
  }

  save() {
    this.state.pos = { x: this.player.x, y: this.player.y };
    this.state.facing = this.player.facing;
    this.state.time = this.renderer.timeOfDay;
    try { localStorage.setItem(this.saveKey, JSON.stringify(this.state)); } catch { /* storage blocked */ }
  }

  // ───────────── entities ─────────────

  placeMesh(mesh, x, y) {
    mesh.position.set(x, this.world.heightAt(x, y) * STEP, y);
  }

  addNpc(def) {
    if (!def || !def.id || this.npcs.has(def.id)) return;
    const pos = this.world.isBlocked(def.x, def.y) ? this.world.findWalkable(def.x, def.y, 6) : { x: def.x, y: def.y };
    const mesh = buildCharacter(def.look || {});
    const npc = { def, id: def.id, name: def.name || 'Someone', x: pos.x, y: pos.y, home: { ...pos }, facing: def.facing || 'down', mesh, from: null, t: 0, phase: 0, next: 2 + Math.random() * 3, line: 0, draft: def.draft };
    this.faceMesh(npc);
    this.placeMesh(mesh, npc.x, npc.y);
    this.renderer.scene.add(mesh);
    this.npcs.set(def.id, npc);
  }

  removeNpc(id) {
    const n = this.npcs.get(id);
    if (!n) return;
    this.renderer.scene.remove(n.mesh);
    this.npcs.delete(id);
  }

  npcList() { return [...this.npcs.values()]; }

  addScenario(s) {
    if (!s || !s.id) return;
    this.scenarios.push(s);
  }

  removeScenario(id) { this.scenarios = this.scenarios.filter(s => s.id !== id); }

  species(id) { return this.creatures.get(id); }
  speciesList() { return [...this.creatures.values()]; }
  itemName(id) { return this.extraItems[id]?.name || ITEMS[id]?.name || id; }
  markSeen(id, caught) { this.state.seen[id] = caught ? 'caught' : (this.state.seen[id] || 'seen'); }

  isOccupied(x, y, except) {
    if (this.player && this.player.x === x && this.player.y === y && except !== this.player) return true;
    for (const n of this.npcs.values()) if (n !== except && n.x === x && n.y === y) return true;
    return false;
  }

  faceMesh(ent) {
    const [dx, dy] = DIRS[ent.facing] || DIRS.down;
    ent.mesh.rotation.y = Math.atan2(dx, dy);
  }

  // ───────────── scenario API ─────────────

  say(text, who) { return this.ui.say(text, who); }
  choose(text, options, who) { return this.ui.choose(text, options, who); }
  toast(text) { this.ui.toast(text); }
  wait(ms) { return new Promise(r => setTimeout(r, ms)); }

  teleport(x, y) {
    const p = this.world.findWalkable(Math.round(x), Math.round(y));
    this.player.x = p.x; this.player.y = p.y; this.player.from = null;
    this.placeMesh(this.player.mesh, p.x, p.y);
    this.renderer.target.set(p.x, this.world.heightAt(p.x, p.y) * STEP, p.y);
  }

  moveNpc(id, x, y) {
    const n = this.npcs.get(id);
    if (!n) return;
    const p = this.world.findWalkable(Math.round(x), Math.round(y), 6);
    n.x = n.home.x = p.x; n.y = n.home.y = p.y; n.from = null;
    this.placeMesh(n.mesh, p.x, p.y);
  }

  spawnNpc(def) { this.addNpc(def); }
  setTile(edit) { this.world.applyEdit(edit); }

  giveCreature(id, level) {
    const sp = this.species(id);
    if (!sp) { this.toast(`Unknown creature "${id}"`); return; }
    const c = makeCreature(sp, level);
    if (this.state.party.length < 6) this.state.party.push(c); else this.state.box.push(c);
    this.markSeen(id, true);
    this.toast(`${sp.name} joined your team!`);
  }

  healParty() {
    for (const c of this.state.party) c.hp = statsFor(this.species(c.id) || {}, c.level).maxHp;
    this.toast('Your team is fully healed.');
  }

  async battle(spec) {
    const root = document.getElementById('battle');
    if (!this.state.party.some(c => c.hp > 0)) {
      await this.say('You have no creature able to fight.');
      return 'lose';
    }
    let s = spec;
    if (typeof spec === 'string') s = { wild: true, species: this.species(spec), level: 5 };
    else if (spec.creature && !spec.team && !spec.trainer) s = { wild: true, species: this.species(spec.creature), level: spec.level || 5 };
    else if (spec.trainer || spec.team) s = { trainer: spec.trainer || 'Trainer', team: (spec.team || []).map(t => ({ creature: t.creature, level: Math.min(50, t.level || 5) })) };
    if (s.wild && !s.species) return 'run';
    this.busy = true;
    const result = await runBattle(root, this, s);
    this.busy = false;
    if (result === 'lose') {
      await this.say('You hurry back to safety…');
      this.healParty();
      const sp = this.worldDef.spawn || { x: 0, y: 0 };
      this.teleport(sp.x, sp.y);
    }
    this.save();
    return result;
  }

  async play(sc) {
    if (this.busy) return;
    await runScenario(sc, this.state, this);
  }

  // ───────────── interaction ─────────────

  front() {
    const [dx, dy] = DIRS[this.player.facing];
    return { x: this.player.x + dx, y: this.player.y + dy };
  }

  async interact() {
    if (this.busy || this.ui.open || this.player.from) return;
    const f = this.front();
    const npc = [...this.npcs.values()].find(n => n.x === f.x && n.y === f.y);
    if (npc) return this.talk(npc);
    const sc = this.scenarios.find(s => s.trigger?.type === 'interact' && s.trigger.x === f.x && s.trigger.y === f.y && canRun(s, this.state));
    if (sc) return this.play(sc);
    const tile = this.world.tile(f.x, f.y);
    const text = this.world.textAt(f.x, f.y);
    if (text) { this.busy = true; await this.say(text, PROPS[tile.p]?.name); this.busy = false; return; }
    if (tile.p === 'well') { this.busy = true; await this.say('The water is cold and clear.'); this.busy = false; }
  }

  async talk(npc) {
    // Face each other.
    const dx = this.player.x - npc.x, dy = this.player.y - npc.y;
    npc.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    this.faceMesh(npc);
    const sc = this.scenarios.find(s => s.trigger?.type === 'talk' && s.trigger.npc === npc.id && canRun(s, this.state));
    if (sc) return this.play(sc);
    const lines = npc.def.dialogue?.length ? npc.def.dialogue : ['…'];
    this.busy = true;
    await this.say(lines[npc.line % lines.length], npc.name);
    npc.line++;
    this.busy = false;
  }

  checkEnterTriggers() {
    const { x, y } = this.player;
    for (const s of this.scenarios) {
      const t = s.trigger;
      if (t?.type !== 'enter') continue;
      if (Math.hypot(x - t.x, y - t.y) <= (t.radius ?? 0.5) && canRun(s, this.state)) { this.play(s); return true; }
    }
    return false;
  }

  maybeEncounter() {
    const tile = this.world.tile(this.player.x, this.player.y);
    if (!PROPS[tile.p]?.encounter || !this.state.party.some(c => c.hp > 0)) return;
    if (Math.random() > (this.config.encounterRate ?? 0.09)) return;
    const pool = this.speciesList().filter(c => !c.habitat || c.habitat.includes(tile.t));
    if (!pool.length) return;
    const total = pool.reduce((a, c) => a + 1 / (c.rarity || 1), 0);
    let r = Math.random() * total, species = pool[0];
    for (const c of pool) { r -= 1 / (c.rarity || 1); if (r <= 0) { species = c; break; } }
    // Further from the spawn = stronger creatures: the open world has a direction.
    const sp = this.worldDef.spawn || { x: 0, y: 0 };
    const dist = Math.hypot(this.player.x - sp.x, this.player.y - sp.y);
    const level = Math.max(2, Math.min(50, Math.round(2 + dist / 22 + Math.random() * 2)));
    this.battle({ creature: species.id, level });
  }

  // ───────────── input ─────────────

  bindInput() {
    this.held = [];
    this.running = false;
    window.addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input, textarea, select')) {
        if (e.code === 'Escape' && this.ui.open) this.ui.closeModal();
        return;
      }
      if (this.ui.key(e)) return;
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.running = true;
      const d = KEY_DIRS[e.code];
      if (d) { e.preventDefault(); if (!this.held.includes(d)) this.held.push(d); return; }
      if (e.repeat) return;
      if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); this.interact(); }
      else if (e.code === 'KeyB') this.editor.toggle();
      else if (e.code === 'KeyP') this.showParty();
      else if (e.code === 'KeyI') this.showBag();
      else if (e.code === 'KeyQ') this.showQuests();
      else if (e.code === 'Escape' && this.editor.active) this.editor.toggle(false);
    });
    window.addEventListener('keyup', e => {
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.running = false;
      const d = KEY_DIRS[e.code];
      if (d) this.held = this.held.filter(x => x !== d);
    });
    window.addEventListener('blur', () => { this.held = []; this.running = false; });
    this.canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.renderer.setZoom(this.renderer.zoom * (e.deltaY > 0 ? 0.9 : 1.1));
    }, { passive: false });

    // Touch d-pad.
    for (const b of document.querySelectorAll('[data-dir]')) {
      const d = b.dataset.dir;
      const on = ev => { ev.preventDefault(); if (!this.held.includes(d)) this.held.push(d); };
      const off = () => { this.held = this.held.filter(x => x !== d); };
      b.addEventListener('pointerdown', on);
      b.addEventListener('pointerup', off);
      b.addEventListener('pointerleave', off);
      b.addEventListener('pointercancel', off);
    }
    document.getElementById('btn-act')?.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (this.ui.open) this.ui.next(); else this.interact();
    });
  }

  bindHud() {
    const on = (id, fn) => document.getElementById(id)?.addEventListener('click', fn);
    on('btn-party', () => this.showParty());
    on('btn-bag', () => this.showBag());
    on('btn-quests', () => this.showQuests());
    on('btn-build', () => this.editor.toggle());
    on('btn-world', () => this.showCommunity());
    on('btn-help', () => this.showHelp());
  }

  titleScreen() {
    const screen = document.getElementById('title-screen');
    document.getElementById('title-name').textContent = this.config.title || 'Iso World';
    document.getElementById('title-tagline').textContent = this.config.tagline || '';
    const name = document.getElementById('title-player');
    name.value = this.state.playerName || '';
    screen.hidden = false;
    const start = async () => {
      this.state.playerName = name.value.trim().slice(0, 16) || this.state.playerName || 'Traveller';
      screen.hidden = true;
      this.save();
      const startScenario = this.scenarios.find(s => s.trigger?.type === 'start' && canRun(s, this.state));
      if (startScenario) await this.play(startScenario);
    };
    document.getElementById('title-play').onclick = start;
    name.onkeydown = e => { if (e.key === 'Enter') start(); };
  }

  // ───────────── panels ─────────────

  showParty() {
    const body = el('div', 'party');
    if (!this.state.party.length) body.appendChild(el('p', 'hint', 'No creatures yet. Someone in town might help you with that.'));
    for (const c of this.state.party) {
      const sp = this.species(c.id) || { name: c.id };
      const st = statsFor(sp, c.level);
      const card = el('div', 'party-card');
      card.appendChild(creatureSVG(sp, 72));
      const info = el('div');
      info.appendChild(el('strong', '', `${c.name}  Lv ${c.level}`));
      const elem = el('span', 'elem', ELEMENTS[sp.element]?.name || '');
      elem.style.background = ELEMENTS[sp.element]?.color || '#888';
      info.appendChild(elem);
      const bar = el('div', 'hpbar');
      const fill = el('div', 'hpfill');
      fill.style.width = `${Math.max(0, c.hp / st.maxHp) * 100}%`;
      bar.appendChild(fill);
      info.append(bar, el('div', 'hint', `HP ${c.hp}/${st.maxHp} · XP ${c.xp}/${c.level * 20}`));
      card.appendChild(info);
      body.appendChild(card);
    }
    const seen = Object.keys(this.state.seen).length, caught = Object.values(this.state.seen).filter(v => v === 'caught').length;
    body.appendChild(el('p', 'hint', `Creature log: ${seen} seen · ${caught} befriended · ${this.creatures.size} known species`));
    this.ui.showModal('Team', body);
  }

  showBag() {
    const body = el('div', 'bag');
    const entries = Object.entries(this.state.items).filter(([, n]) => n > 0);
    if (!entries.length) body.appendChild(el('p', 'hint', 'Your bag is empty.'));
    for (const [id, n] of entries) {
      const row = el('div', 'bag-row');
      row.append(el('strong', '', `${this.itemName(id)} ×${n}`), el('span', 'hint', this.extraItems[id]?.desc || ITEMS[id]?.desc || ''));
      if ((id === 'potion' || id === 'berry') && this.state.party.length) {
        const use = el('button', 'btn small', 'Use');
        use.onclick = () => {
          const target = this.state.party.find(c => c.hp < statsFor(this.species(c.id) || {}, c.level).maxHp);
          if (!target) { this.toast('Everyone is healthy.'); return; }
          const max = statsFor(this.species(target.id) || {}, target.level).maxHp;
          target.hp = Math.min(max, target.hp + (id === 'potion' ? 25 : 10));
          this.state.items[id]--;
          this.save();
          this.toast(`${target.name} feels better.`);
          this.showBag();
        };
        row.appendChild(use);
      }
      body.appendChild(row);
    }
    this.ui.showModal('Bag', body);
  }

  showQuests() {
    const body = el('div', 'quests');
    const qs = Object.entries(this.state.quests);
    if (!qs.length) body.appendChild(el('p', 'hint', 'No quests yet. Talk to people!'));
    for (const [, q] of qs.sort((a, b) => (a[1].status === 'active' ? -1 : 1))) {
      const row = el('div', 'quest ' + q.status);
      row.appendChild(el('strong', '', (q.status === 'done' ? '✓ ' : '• ') + q.title));
      if (q.desc) row.appendChild(el('p', 'hint', q.desc));
      if (q.author) row.appendChild(el('p', 'hint', `Written by ${q.author}`));
      body.appendChild(row);
    }
    this.ui.showModal('Quests', body);
  }

  async showCommunity() {
    const body = el('div', 'community');
    const c = this.community;
    if (!c.enabled) {
      body.appendChild(el('p', 'hint', 'This world is not connected to community building.'));
    } else {
      const modeText = { open: 'Open — builds go live immediately.', review: 'Reviewed — the owner approves each build.', closed: 'Closed — the owner is not taking builds right now.' };
      body.appendChild(el('p', '', modeText[c.mode] || ''));
      body.appendChild(el('h3', '', `Community builds (${this.builds.length})`));
      for (const b of [...this.builds].reverse().slice(0, 30)) {
        const row = el('div', 'build-row');
        row.append(el('strong', '', b.payload?.title || 'Untitled'), el('span', 'hint', ` by ${b.author?.name || 'someone'}`));
        body.appendChild(row);
      }
      const mine = await c.mine();
      if (mine.length) {
        body.appendChild(el('h3', '', 'Your builds'));
        for (const m of mine) body.appendChild(el('div', 'build-row', `${m.payload?.title || 'Untitled'} — ${m.status}`));
      }
    }
    const build = el('button', 'btn accent', 'Open build mode (B)');
    build.onclick = () => { this.ui.closeModal(); this.editor.toggle(true); };
    body.appendChild(build);
    this.ui.showModal('World', body);
  }

  showHelp() {
    const body = el('div', 'help');
    const rows = [
      ['WASD / arrows', 'walk (hold Shift to run)'], ['E / Space', 'talk, read, interact'],
      ['B', 'build mode: shape the world, add NPCs and quests'], ['P', 'your creatures'], ['I', 'bag'], ['Q', 'quests'],
      ['Mouse wheel', 'zoom'],
    ];
    for (const [k, v] of rows) {
      const r = el('div', 'help-row');
      r.append(el('kbd', '', k), el('span', '', v));
      body.appendChild(r);
    }
    this.ui.showModal('How to play', body);
  }

  // ───────────── loop ─────────────

  stepEntity(ent, dt, speed) {
    if (!ent.from) return false;
    ent.t += dt * speed;
    ent.phase += dt * speed * Math.PI;
    const k = Math.min(1, ent.t);
    const fx = ent.from.x, fy = ent.from.y;
    const fh = this.world.heightAt(fx, fy) * STEP, th = this.world.heightAt(ent.x, ent.y) * STEP;
    ent.mesh.position.set(fx + (ent.x - fx) * k, fh + (th - fh) * k + Math.sin(k * Math.PI) * (fh !== th ? 0.18 : 0.04), fy + (ent.y - fy) * k);
    animateCharacter(ent.mesh, ent.phase, 1);
    if (k >= 1) { ent.from = null; ent.t = 0; return true; }
    return false;
  }

  tryMove(ent, dir) {
    const [dx, dy] = DIRS[dir];
    ent.facing = dir;
    this.faceMesh(ent);
    const tx = ent.x + dx, ty = ent.y + dy;
    if (!this.world.canStep(ent.x, ent.y, tx, ty) || this.isOccupied(tx, ty, ent)) return false;
    ent.from = { x: ent.x, y: ent.y };
    ent.x = tx; ent.y = ty; ent.t = 0;
    return true;
  }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    const p = this.player;
    const frozen = this.busy || this.ui.open || !document.getElementById('title-screen').hidden;

    if (!p.from && !frozen && this.held.length) {
      const dir = this.held[this.held.length - 1];
      if (!this.tryMove(p, dir)) animateCharacter(p.mesh, 0, 0);
    }
    if (p.from) {
      const arrived = this.stepEntity(p, dt, this.running ? 7.5 : 4.6);
      if (arrived) {
        if (!this.checkEnterTriggers()) this.maybeEncounter();
        if (++this.steps % 20 === 0) this.save();
      }
    } else if (!this.held.length) {
      animateCharacter(p.mesh, 0, 0);
    }

    // NPC idle wandering.
    for (const n of this.npcs.values()) {
      if (n.from) { if (this.stepEntity(n, dt, 2.6)) animateCharacter(n.mesh, 0, 0); continue; }
      if (!n.def.wander || frozen) continue;
      n.next -= dt;
      if (n.next > 0) continue;
      n.next = 2 + hash2(n.x, n.y, Math.floor(now)) * 4;
      const dirs = Object.keys(DIRS);
      const dir = dirs[Math.floor(Math.random() * 4)];
      const [dx, dy] = DIRS[dir];
      if (Math.abs(n.x + dx - n.home.x) > 3 || Math.abs(n.y + dy - n.home.y) > 3) continue;
      this.tryMove(n, dir);
    }

    this.renderer.updateChunks(p.mesh.position.x, p.mesh.position.z, 2);
    this.focus.set(p.mesh.position.x, p.mesh.position.y + 0.5, p.mesh.position.z);
    this.renderer.update(dt, this.focus);
    if (!p.from) this.ui.hud(this.world.placeAt(p.x, p.y), p.x, p.y, this.renderer.timeOfDay);
    requestAnimationFrame(t => this.frame(t));
  }
}

const game = new Game();
game.steps = 0;
window.game = game;
game.boot().catch(err => {
  console.error(err);
  const l = document.getElementById('loading');
  l.hidden = false;
  l.textContent = 'Could not start the game: ' + (err?.message || err);
});
