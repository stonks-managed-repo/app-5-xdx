// In-game world editor. Players sculpt terrain, paint ground, place objects, NPCs and
// signs, and write scenarios (quests / dialogues) in a form — then publish the whole
// draft as one community build, or download it as JSON for the repository.

import { TERRAINS, PROPS, ITEMS } from './catalog.js';
import { el } from './ui.js';

const DRAFT_KEY = 'iso-world:draft';
const NAME_KEY = 'iso-world:author';

const STEP_TYPES = {
  say:      { label: 'Say',          fields: [['who', 'Speaker'], ['say', 'Text', 'textarea']] },
  choice:   { label: 'Question',     fields: [['choice', 'Question'], ['yes', 'Answer 1 (continues)'], ['no', 'Answer 2 (ends)']] },
  give:     { label: 'Give item',    fields: [['item', 'Item', 'item'], ['count', 'Count', 'number']] },
  creature: { label: 'Give creature', fields: [['creature', 'Creature id', 'creature'], ['level', 'Level', 'number']] },
  battle:   { label: 'Battle',       fields: [['trainer', 'Trainer name'], ['creature', 'Creature id', 'creature'], ['level', 'Level', 'number']] },
  quest:    { label: 'Quest',        fields: [['qid', 'Quest id'], ['title', 'Title'], ['status', 'Status', 'status']] },
  flag:     { label: 'Set flag',     fields: [['flag', 'Flag name']] },
  heal:     { label: 'Heal party',   fields: [] },
  teleport: { label: 'Teleport',     fields: [['x', 'X', 'number'], ['y', 'Y', 'number']] },
};

/** Form steps → scenario steps. */
function compileSteps(rows) {
  const out = [];
  let n = 0;
  for (const r of rows) {
    switch (r.type) {
      case 'say': if (r.say) out.push({ say: r.say, ...(r.who ? { who: r.who } : {}) }); break;
      case 'choice': {
        const label = `after_${n++}`;
        out.push({ choice: r.choice || '…', options: [{ text: r.yes || 'Yes', goto: label }, { text: r.no || 'No', goto: '__end' }] });
        out.push({ label });
        break;
      }
      case 'give': if (r.item) out.push({ give: { item: r.item, count: Math.max(1, Math.min(10, +r.count || 1)) } }); break;
      case 'creature': if (r.creature) out.push({ giveCreature: { id: r.creature, level: Math.max(1, Math.min(50, +r.level || 5)) } }); break;
      case 'battle': if (r.creature) out.push({ battle: { trainer: r.trainer || 'Trainer', team: [{ creature: r.creature, level: Math.max(1, Math.min(50, +r.level || 5)) }] } }); break;
      case 'quest': if (r.qid) out.push({ quest: { id: r.qid, title: r.title || r.qid, status: r.status || 'active' } }); break;
      case 'flag': if (r.flag) out.push({ setFlag: r.flag }); break;
      case 'heal': out.push({ heal: true }); break;
      case 'teleport': out.push({ teleport: { x: +r.x || 0, y: +r.y || 0 } }); break;
    }
  }
  out.push({ end: true }, { label: '__end' });
  return out;
}

export class Editor {
  constructor(game) {
    this.game = game;
    this.panel = document.getElementById('editor');
    this.active = false;
    this.tool = 'raise';
    this.terrain = 'grass';
    this.prop = 'tree_oak';
    this.brush = 1;
    this.painting = false;
    this.lastPainted = '';
    this.draft = this.loadDraft();
    this.bindPointer();
  }

  loadDraft() {
    try {
      const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (d && Array.isArray(d.edits)) return { title: '', description: '', npcs: [], scenarios: [], ...d };
    } catch { /* fresh */ }
    return { title: '', description: '', edits: [], npcs: [], scenarios: [] };
  }

  saveDraft() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(this.draft)); } catch { /* storage full or blocked */ }
  }

  /** Re-apply the local draft on top of the world after load. */
  applyDraft() {
    for (const e of this.draft.edits) this.game.world.applyEdit(e, false);
    for (const n of this.draft.npcs) this.game.addNpc({ ...n, draft: true });
    for (const s of this.draft.scenarios) this.game.addScenario({ ...s, draft: true });
  }

  toggle(force) {
    this.active = force ?? !this.active;
    this.panel.hidden = !this.active;
    document.body.classList.toggle('editing', this.active);
    if (this.active) this.render();
    else this.game.renderer.showHighlight(null);
  }

  // ───────────── pointer ─────────────

  bindPointer() {
    const canvas = this.game.canvas;
    canvas.addEventListener('pointermove', e => {
      if (!this.active) return;
      const t = this.game.renderer.pickTile(e.clientX, e.clientY);
      this.hover = t;
      this.game.renderer.showHighlight(t, this.tool === 'erase' ? 0xff6b6b : 0xffffff);
      if (this.painting && t) this.applyAt(t, false);
    });
    canvas.addEventListener('pointerdown', e => {
      if (!this.active || e.button !== 0) return;
      const t = this.game.renderer.pickTile(e.clientX, e.clientY);
      if (!t) return;
      this.painting = ['raise', 'lower', 'paint', 'prop', 'erase', 'flatten'].includes(this.tool);
      this.lastPainted = '';
      this.flattenTo = this.game.world.heightAt(t.x, t.y);
      this.applyAt(t, true);
    });
    window.addEventListener('pointerup', () => {
      if (this.painting) { this.painting = false; this.saveDraft(); this.renderSummary(); }
    });
  }

  edit(e) {
    this.game.world.applyEdit(e);
    // Keep only the latest edit per tile/field in the draft.
    const prev = this.draft.edits.find(d => d.x === e.x && d.y === e.y);
    if (prev) Object.assign(prev, e); else this.draft.edits.push({ ...e });
  }

  applyAt(t, first) {
    const k = `${t.x},${t.y},${this.tool}`;
    if (!first && k === this.lastPainted) return;
    this.lastPainted = k;
    const w = this.game.world;
    const r = this.brush - 1;
    const tiles = [];
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) tiles.push({ x: t.x + dx, y: t.y + dy });
    if (this.game.isOccupied(t.x, t.y) && ['raise', 'lower', 'prop'].includes(this.tool)) return;

    switch (this.tool) {
      case 'raise': for (const p of tiles) this.edit({ x: p.x, y: p.y, h: w.heightAt(p.x, p.y) + 1 }); break;
      case 'lower': for (const p of tiles) this.edit({ x: p.x, y: p.y, h: Math.max(0, w.heightAt(p.x, p.y) - 1), ...(w.heightAt(p.x, p.y) <= 1 ? { t: 'water' } : {}) }); break;
      case 'flatten': for (const p of tiles) this.edit({ x: p.x, y: p.y, h: this.flattenTo }); break;
      case 'paint': for (const p of tiles) this.edit({ x: p.x, y: p.y, t: this.terrain, ...(TERRAINS[this.terrain].liquid ? { h: 0, p: null } : {}) }); break;
      case 'prop': this.edit({ x: t.x, y: t.y, p: this.prop }); if (this.prop === 'sign') this.editSign(t); break;
      case 'erase': for (const p of tiles) this.edit({ x: p.x, y: p.y, p: null }); break;
      case 'npc': if (first) this.editNpc(t); break;
      case 'sign': if (first) { this.edit({ x: t.x, y: t.y, p: 'sign' }); this.editSign(t); } break;
    }
  }

  // ───────────── forms ─────────────

  field(label, input) {
    const wrap = el('label', 'field');
    wrap.appendChild(el('span', '', label));
    wrap.appendChild(input);
    return wrap;
  }

  input(value, opts = {}) {
    const i = el(opts.textarea ? 'textarea' : 'input');
    if (!opts.textarea) i.type = opts.type || 'text';
    i.value = value ?? '';
    if (opts.max) i.maxLength = opts.max;
    if (opts.placeholder) i.placeholder = opts.placeholder;
    return i;
  }

  select(options, value) {
    const s = el('select');
    for (const [v, label] of options) {
      const o = el('option', '', label);
      o.value = v;
      if (v === value) o.selected = true;
      s.appendChild(o);
    }
    return s;
  }

  editSign(t) {
    const text = this.input(this.game.world.textAt(t.x, t.y), { textarea: true, max: 300, placeholder: 'What does the sign say?' });
    const body = el('div', 'form');
    body.appendChild(this.field('Sign text', text));
    this.game.ui.showModal('Sign', body, [{ label: 'Save', primary: true, onClick: () => {
      this.edit({ x: t.x, y: t.y, p: 'sign', text: text.value.slice(0, 300) });
      this.saveDraft();
      this.game.ui.closeModal();
      this.renderSummary();
    } }]);
    setTimeout(() => text.focus(), 30);
  }

  editNpc(t, existing) {
    const npc = existing || { id: `npc${Date.now().toString(36)}`, x: t.x, y: t.y, name: '', look: { body: '#3f7cd9', hair: '#2b1d14' }, dialogue: [] };
    const body = el('div', 'form');
    const name = this.input(npc.name, { max: 24, placeholder: 'e.g. Fisher Mila' });
    const color = this.input(npc.look?.body || '#3f7cd9', { type: 'color' });
    const hair = this.input(npc.look?.hair || '#2b1d14', { type: 'color' });
    const hat = this.select([['', 'No hat'], ['#d94f3d', 'Red cap'], ['#2e3a59', 'Navy cap'], ['#f2c94c', 'Straw hat']], npc.look?.hat || '');
    const lines = this.input((npc.dialogue || []).join('\n'), { textarea: true, max: 1200, placeholder: 'One line per message' });
    const wander = el('input'); wander.type = 'checkbox'; wander.checked = !!npc.wander;
    body.append(this.field('Name', name), this.field('Shirt', color), this.field('Hair', hair), this.field('Hat', hat),
      this.field('Dialogue (used when no quest is running)', lines), this.field('Walks around', wander));
    const hint = el('p', 'hint', 'To give this NPC a quest, open Scenarios and pick "Talk to NPC".');
    body.appendChild(hint);
    const save = () => {
      if (!name.value.trim()) { name.focus(); return; }
      const def = {
        id: npc.id, x: npc.x, y: npc.y, name: name.value.trim().slice(0, 24),
        look: { body: color.value, hair: hair.value, ...(hat.value ? { hat: hat.value } : {}) },
        dialogue: lines.value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 12).map(s => s.slice(0, 300)),
        wander: wander.checked,
      };
      this.draft.npcs = this.draft.npcs.filter(n => n.id !== def.id).concat(def);
      this.game.removeNpc(def.id);
      this.game.addNpc({ ...def, draft: true });
      this.saveDraft();
      this.game.ui.closeModal();
      this.render();
    };
    const actions = [{ label: 'Save NPC', primary: true, onClick: save }];
    if (existing) actions.unshift({ label: 'Delete', onClick: () => {
      this.draft.npcs = this.draft.npcs.filter(n => n.id !== npc.id);
      this.game.removeNpc(npc.id);
      this.saveDraft();
      this.game.ui.closeModal();
      this.render();
    } });
    this.game.ui.showModal(existing ? 'Edit NPC' : 'New NPC', body, actions);
    setTimeout(() => name.focus(), 30);
  }

  editScenario(existing) {
    const sc = existing || { id: `quest${Date.now().toString(36)}`, title: '', trigger: { type: 'talk', npc: this.draft.npcs[0]?.id || '' }, rows: [{ type: 'say', who: '', say: '' }] };
    const rows = (sc.rows || []).map(r => ({ ...r }));
    const body = el('div', 'form');
    const title = this.input(sc.title, { max: 60, placeholder: 'e.g. The lost fishing rod' });
    const npcOptions = [...this.draft.npcs.map(n => [n.id, `Talk to ${n.name}`]), ...this.game.npcList().filter(n => !n.draft).map(n => [n.id, `Talk to ${n.name}`])];
    const trig = this.select([...npcOptions, ['__enter', 'Walk onto my current position'], ['__start', 'When a player starts the game']],
      sc.trigger.type === 'talk' ? sc.trigger.npc : sc.trigger.type === 'enter' ? '__enter' : '__start');
    const once = el('input'); once.type = 'checkbox'; once.checked = sc.once ?? true;
    body.append(this.field('Title', title), this.field('Starts when', trig), this.field('Only once per player', once));

    const list = el('div', 'steps');
    const creatureOpts = this.game.speciesList().map(s => [s.id, s.name]);
    const itemOpts = Object.entries({ ...ITEMS, ...(this.game.extraItems || {}) }).map(([k, v]) => [k, v.name]);
    const drawRows = () => {
      list.replaceChildren();
      rows.forEach((r, i) => {
        const card = el('div', 'step');
        const head = el('div', 'step-head');
        head.appendChild(el('strong', '', `${i + 1}. ${STEP_TYPES[r.type].label}`));
        const tools = el('div', 'step-tools');
        const up = el('button', 'icon-btn', '↑'); up.onclick = () => { if (i) { [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; drawRows(); } };
        const del = el('button', 'icon-btn', '×'); del.onclick = () => { rows.splice(i, 1); drawRows(); };
        tools.append(up, del);
        head.appendChild(tools);
        card.appendChild(head);
        for (const [key, label, kind] of STEP_TYPES[r.type].fields) {
          let input;
          if (kind === 'item') input = this.select(itemOpts, r[key]);
          else if (kind === 'creature') input = this.select(creatureOpts, r[key]);
          else if (kind === 'status') input = this.select([['active', 'Start'], ['done', 'Complete']], r[key]);
          else input = this.input(r[key], { textarea: kind === 'textarea', type: kind === 'number' ? 'number' : 'text', max: 300 });
          if ((kind === 'item' || kind === 'creature') && !r[key]) r[key] = input.value;
          input.oninput = input.onchange = () => { r[key] = input.value; };
          card.appendChild(this.field(label, input));
        }
        list.appendChild(card);
      });
    };
    drawRows();
    body.appendChild(list);
    const adders = el('div', 'adders');
    for (const [type, def] of Object.entries(STEP_TYPES)) {
      const b = el('button', 'chip', '+ ' + def.label);
      b.onclick = () => { rows.push({ type }); drawRows(); };
      adders.appendChild(b);
    }
    body.appendChild(adders);

    const save = () => {
      if (!title.value.trim()) { title.focus(); return; }
      const p = this.game.player;
      const trigger = trig.value === '__enter' ? { type: 'enter', x: p.x, y: p.y, radius: 1 }
        : trig.value === '__start' ? { type: 'start' } : { type: 'talk', npc: trig.value };
      const def = { id: sc.id, title: title.value.trim().slice(0, 60), trigger, once: once.checked, rows, steps: compileSteps(rows) };
      this.draft.scenarios = this.draft.scenarios.filter(s => s.id !== def.id).concat(def);
      this.game.removeScenario(def.id);
      this.game.addScenario({ ...def, draft: true });
      this.saveDraft();
      this.game.ui.closeModal();
      this.render();
    };
    const actions = [
      { label: 'Test it', onClick: () => { save(); const s = this.draft.scenarios.find(x => x.id === sc.id); if (s) { this.toggle(false); this.game.play({ ...s, once: false }); } } },
      { label: 'Save scenario', primary: true, onClick: save },
    ];
    if (existing) actions.unshift({ label: 'Delete', onClick: () => {
      this.draft.scenarios = this.draft.scenarios.filter(s => s.id !== sc.id);
      this.game.removeScenario(sc.id);
      this.saveDraft();
      this.game.ui.closeModal();
      this.render();
    } });
    this.game.ui.showModal(existing ? 'Edit scenario' : 'New scenario', body, actions);
  }

  // ───────────── panel ─────────────

  render() {
    const p = this.panel;
    p.replaceChildren();
    const head = el('div', 'ed-head');
    head.appendChild(el('h2', '', 'Build mode'));
    const close = el('button', 'icon-btn', '×');
    close.onclick = () => this.toggle(false);
    head.appendChild(close);
    p.appendChild(head);

    const tools = [
      ['raise', '⬆ Raise'], ['lower', '⬇ Lower'], ['flatten', '▭ Flatten'], ['paint', '🖌 Paint'],
      ['prop', '🌳 Place'], ['erase', '✖ Erase'], ['npc', '🙂 NPC'], ['sign', '🪧 Sign'],
    ];
    const grid = el('div', 'tool-grid');
    for (const [id, label] of tools) {
      const b = el('button', 'tool' + (this.tool === id ? ' on' : ''), label);
      b.onclick = () => { this.tool = id; this.render(); };
      grid.appendChild(b);
    }
    p.appendChild(grid);

    if (['raise', 'lower', 'flatten', 'paint', 'erase'].includes(this.tool)) {
      const brush = this.select([['1', 'Brush 1×1'], ['2', 'Brush 3×3'], ['3', 'Brush 5×5']], String(this.brush));
      brush.onchange = () => { this.brush = +brush.value; };
      p.appendChild(this.field('Brush', brush));
    }
    if (this.tool === 'paint') {
      const sw = el('div', 'swatches');
      for (const [id, t] of Object.entries(TERRAINS)) {
        const b = el('button', 'swatch' + (this.terrain === id ? ' on' : ''));
        b.style.background = t.color;
        b.title = t.name;
        b.onclick = () => { this.terrain = id; this.render(); };
        sw.appendChild(b);
      }
      p.appendChild(sw);
    }
    if (this.tool === 'prop') {
      const s = this.select(Object.entries(PROPS).map(([id, d]) => [id, d.name]), this.prop);
      s.onchange = () => { this.prop = s.value; };
      p.appendChild(this.field('Object', s));
    }

    const sec = (title) => { const h = el('h3', '', title); p.appendChild(h); };
    sec('NPCs');
    if (!this.draft.npcs.length) p.appendChild(el('p', 'hint', 'Pick the NPC tool and click a tile.'));
    for (const n of this.draft.npcs) {
      const row = el('button', 'row', `${n.name}  ·  ${n.x}, ${n.y}`);
      row.onclick = () => this.editNpc({ x: n.x, y: n.y }, n);
      p.appendChild(row);
    }
    sec('Scenarios');
    for (const s of this.draft.scenarios) {
      const row = el('button', 'row', s.title);
      row.onclick = () => this.editScenario(s);
      p.appendChild(row);
    }
    const add = el('button', 'btn small', '+ New scenario');
    add.onclick = () => this.editScenario();
    p.appendChild(add);

    this.summary = el('div', 'ed-summary');
    p.appendChild(this.summary);
    this.renderSummary();
  }

  renderSummary() {
    if (!this.summary) return;
    const s = this.summary;
    s.replaceChildren();
    const d = this.draft;
    s.appendChild(el('p', 'hint', `Draft: ${d.edits.length} tile edits · ${d.npcs.length} NPCs · ${d.scenarios.length} scenarios`));
    const c = this.game.community;
    if (c.enabled && c.mode !== 'closed') {
      const name = this.input(localStorageGet(NAME_KEY), { max: 24, placeholder: 'Your builder name' });
      const title = this.input(d.title, { max: 60, placeholder: 'What did you build? e.g. Fishing village' });
      title.oninput = () => { d.title = title.value; this.saveDraft(); };
      s.append(this.field('Builder name', name), this.field('Build title', title));
      const pub = el('button', 'btn accent', c.mode === 'review' ? 'Send for review' : 'Publish to the world');
      pub.onclick = async () => {
        const author = name.value.trim();
        if (author.length < 2) { name.focus(); this.game.ui.toast('Pick a builder name first'); return; }
        if (!d.title.trim()) { title.focus(); this.game.ui.toast('Give your build a title'); return; }
        if (!d.edits.length && !d.npcs.length && !d.scenarios.length) { this.game.ui.toast('Nothing to publish yet'); return; }
        localStorageSet(NAME_KEY, author);
        pub.disabled = true;
        try {
          const payload = {
            title: d.title.trim(), description: d.description || '',
            edits: d.edits, npcs: d.npcs,
            scenarios: d.scenarios.map(({ rows, draft, ...rest }) => rest),
          };
          const res = await c.submit(author, payload);
          this.game.ui.toast(res.status === 'approved' ? 'Published! Everyone can see it now.' : 'Sent! The world owner will review it.');
          this.draft = { title: '', description: '', edits: [], npcs: [], scenarios: [] };
          this.saveDraft();
          if (res.status === 'approved') setTimeout(() => location.reload(), 1200);
          else this.render();
        } catch (err) {
          this.game.ui.toast(err.message || 'Publishing failed');
        } finally {
          pub.disabled = false;
        }
      };
      s.appendChild(pub);
    } else {
      s.appendChild(el('p', 'hint', c.enabled ? 'The owner has closed community building for now.' : 'Community publishing is off for this world.'));
    }
    const row = el('div', 'ed-actions');
    const dl = el('button', 'btn ghost small', 'Download JSON');
    dl.onclick = () => {
      const blob = new Blob([JSON.stringify({ ...d, scenarios: d.scenarios.map(({ rows, draft, ...r }) => r) }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'world-build.json';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    const discard = el('button', 'btn ghost small', 'Discard draft');
    discard.onclick = () => {
      this.draft = { title: '', description: '', edits: [], npcs: [], scenarios: [] };
      this.saveDraft();
      location.reload();
    };
    row.append(dl, discard);
    s.appendChild(row);
  }
}

function localStorageGet(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } }
function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch { /* ignore */ } }
