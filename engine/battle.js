// Creatures and turn-based battles. Creature species come from world/creatures.json;
// their portraits are drawn procedurally as SVG from colour + shape, so a new species
// needs no art. Battles run in a DOM overlay over the paused world.

import { ELEMENTS, EFFECTIVENESS } from './catalog.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const SVG_NS = 'http://www.w3.org/2000/svg';
const safeColor = c => (/^#[0-9a-f]{3,8}$/i.test(String(c || '')) ? c : '#9a9a9a');

/** Procedural creature portrait. shape: blob | sprout | flame | fin | horn | wing | spark. */
export function creatureSVG(species, size = 120) {
  const color = safeColor(species?.color || ELEMENTS[species?.element]?.color);
  const shape = species?.shape || 'blob';
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  const add = (tag, attrs) => {
    const n = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    svg.appendChild(n);
    return n;
  };
  add('ellipse', { cx: 50, cy: 92, rx: 28, ry: 5, fill: 'rgba(0,0,0,.18)' });
  // Accessories behind the body.
  if (shape === 'wing') {
    add('path', { d: 'M28 55 Q5 35 12 62 Q18 70 30 66 Z', fill: color, opacity: 0.8 });
    add('path', { d: 'M72 55 Q95 35 88 62 Q82 70 70 66 Z', fill: color, opacity: 0.8 });
  }
  if (shape === 'fin') add('path', { d: 'M50 22 Q62 10 70 30 Z', fill: color });
  if (shape === 'flame') {
    add('path', { d: 'M50 6 Q66 26 58 36 Q72 30 68 46 L32 46 Q28 30 42 36 Q34 22 50 6 Z', fill: '#ffb03a' });
    add('path', { d: 'M50 18 Q58 30 54 38 L46 38 Q42 30 50 18 Z', fill: '#ffe066' });
  }
  if (shape === 'spark') {
    add('path', { d: 'M28 30 L18 12 L36 24 Z', fill: '#2b2b2b' });
    add('path', { d: 'M72 30 L82 12 L64 24 Z', fill: '#2b2b2b' });
  }
  add('ellipse', { cx: 50, cy: 62, rx: 30, ry: 28, fill: color });
  add('ellipse', { cx: 50, cy: 72, rx: 18, ry: 13, fill: 'rgba(255,255,255,.35)' });
  add('ellipse', { cx: 40, cy: 50, rx: 10, ry: 7, fill: 'rgba(255,255,255,.18)' });
  if (shape === 'sprout') {
    add('path', { d: 'M50 36 Q48 24 50 18', stroke: '#3c7d2a', 'stroke-width': 3, fill: 'none' });
    add('path', { d: 'M50 20 Q36 8 30 20 Q40 26 50 20 Z', fill: '#58b947' });
    add('path', { d: 'M50 22 Q64 10 70 22 Q60 28 50 22 Z', fill: '#6fd05a' });
  }
  if (shape === 'horn') {
    add('path', { d: 'M36 40 L30 20 L44 36 Z', fill: '#efe6d2' });
    add('path', { d: 'M64 40 L70 20 L56 36 Z', fill: '#efe6d2' });
  }
  if (shape === 'blob') {
    add('circle', { cx: 30, cy: 40, r: 8, fill: color });
    add('circle', { cx: 70, cy: 40, r: 8, fill: color });
  }
  for (const x of [41, 59]) {
    add('ellipse', { cx: x, cy: 58, rx: 5, ry: 6.5, fill: '#1d1d24' });
    add('circle', { cx: x + 1.6, cy: 55.5, r: 1.8, fill: '#fff' });
  }
  add('path', { d: 'M45 67 Q50 71 55 67', stroke: '#1d1d24', 'stroke-width': 2, fill: 'none', 'stroke-linecap': 'round' });
  add('ellipse', { cx: 33, cy: 66, rx: 4, ry: 2.5, fill: 'rgba(255,120,120,.45)' });
  add('ellipse', { cx: 67, cy: 66, rx: 4, ry: 2.5, fill: 'rgba(255,120,120,.45)' });
  return svg;
}

export function statsFor(species, level) {
  return {
    maxHp: Math.round((species.hp || 20) + level * 3),
    atk: (species.atk || 5) + level * 1.1,
    def: (species.def || 5) + level * 1.0,
    spd: (species.spd || 5) + level * 0.8,
  };
}

export function makeCreature(species, level) {
  const s = statsFor(species, level);
  return { id: species.id, name: species.name, level, hp: s.maxHp, xp: 0 };
}

function damage(move, attacker, defender, aSpec, dSpec) {
  const a = statsFor(aSpec, attacker.level), d = statsFor(dSpec, defender.level);
  const eff = EFFECTIVENESS[move.element]?.[dSpec.element] ?? 1;
  const stab = move.element === aSpec.element ? 1.2 : 1;
  const roll = 0.85 + Math.random() * 0.15;
  const dmg = Math.max(1, Math.round(((move.power || 6) * (a.atk / d.def) * 0.55 + attacker.level * 0.25) * eff * stab * roll));
  return { dmg, eff };
}

const DEFAULT_MOVES = [{ name: 'Tackle', element: 'stone', power: 6 }];

/**
 * Run one battle. spec = { wild: true, species, level } or { trainer, team: [{creature, level}] }.
 * Resolves 'win' | 'lose' | 'run' | 'caught'.
 */
export function runBattle(root, game, spec) {
  return new Promise(resolve => {
    const state = game.state;
    const speciesOf = id => game.species(id) || { id, name: id, element: 'stone', hp: 20, atk: 5, def: 5, spd: 5 };
    const foes = spec.wild
      ? [makeCreature(spec.species, spec.level)]
      : (spec.team || []).map(t => makeCreature(speciesOf(t.creature), t.level || 5));
    let foeIdx = 0;
    let mineIdx = state.party.findIndex(c => c.hp > 0);
    if (mineIdx < 0 || !foes.length) { resolve('run'); return; }

    root.replaceChildren();
    root.hidden = false;
    const box = el('div', 'battle');
    const field = el('div', 'battle-field');
    const foeSide = el('div', 'battle-side foe');
    const mySide = el('div', 'battle-side mine');
    const log = el('div', 'battle-log');
    const menu = el('div', 'battle-menu');
    field.append(foeSide, mySide);
    box.append(field, log, menu);
    root.appendChild(box);

    const card = (c, mine) => {
      const sp = speciesOf(c.id);
      const st = statsFor(sp, c.level);
      const wrap = el('div', 'battle-card');
      const info = el('div', 'battle-info');
      const name = el('div', 'battle-name');
      name.append(el('span', '', c.name), el('span', 'lvl', ` Lv ${c.level}`));
      const elem = el('span', 'elem', ELEMENTS[sp.element]?.name || '');
      elem.style.background = ELEMENTS[sp.element]?.color || '#888';
      name.appendChild(elem);
      const bar = el('div', 'hpbar');
      const fill = el('div', 'hpfill');
      const pct = Math.max(0, c.hp / st.maxHp);
      fill.style.width = pct * 100 + '%';
      fill.style.background = pct > 0.5 ? '#4cd964' : pct > 0.2 ? '#ffcc00' : '#ff3b30';
      bar.appendChild(fill);
      info.append(name, bar);
      if (mine) info.appendChild(el('div', 'hptext', `${Math.max(0, c.hp)} / ${st.maxHp}`));
      const pic = el('div', 'battle-pic');
      pic.appendChild(creatureSVG(sp, mine ? 130 : 120));
      wrap.append(info, pic);
      return wrap;
    };
    const draw = () => {
      foeSide.replaceChildren(card(foes[foeIdx], false));
      mySide.replaceChildren(card(state.party[mineIdx], true));
    };
    const say = text => new Promise(r => { log.textContent = text; setTimeout(r, 900); });
    const flash = side => { side.classList.remove('hit'); void side.offsetWidth; side.classList.add('hit'); };

    const finish = result => {
      root.hidden = true;
      root.replaceChildren();
      resolve(result);
    };

    const foeTurn = async () => {
      const foe = foes[foeIdx], fsp = speciesOf(foe.id);
      const mine = state.party[mineIdx], msp = speciesOf(mine.id);
      const moves = fsp.moves?.length ? fsp.moves : DEFAULT_MOVES;
      const mv = moves[Math.floor(Math.random() * moves.length)];
      const { dmg, eff } = damage(mv, foe, mine, fsp, msp);
      mine.hp = Math.max(0, mine.hp - dmg);
      flash(mySide);
      draw();
      await say(`${spec.wild ? 'Wild ' : ''}${foe.name} used ${mv.name}!${eff > 1 ? ' It hits hard!' : eff < 1 ? ' Not very effective.' : ''}`);
      if (mine.hp <= 0) {
        await say(`${mine.name} fainted!`);
        mineIdx = state.party.findIndex(c => c.hp > 0);
        if (mineIdx < 0) { await say('You have no creatures left…'); finish('lose'); return false; }
        draw();
        await say(`Go, ${state.party[mineIdx].name}!`);
      }
      return true;
    };

    const gainXp = async foe => {
      const mine = state.party[mineIdx];
      mine.xp += foe.level * 9;
      await say(`${mine.name} gained ${foe.level * 9} XP.`);
      while (mine.xp >= mine.level * 20) {
        mine.xp -= mine.level * 20;
        const before = statsFor(speciesOf(mine.id), mine.level).maxHp;
        mine.level++;
        mine.hp += statsFor(speciesOf(mine.id), mine.level).maxHp - before;
        draw();
        await say(`${mine.name} grew to level ${mine.level}!`);
      }
    };

    const act = async action => {
      menu.replaceChildren();
      const mine = state.party[mineIdx], msp = speciesOf(mine.id);
      const foe = foes[foeIdx], fsp = speciesOf(foe.id);
      const meFirst = statsFor(msp, mine.level).spd >= statsFor(fsp, foe.level).spd;

      if (action.type === 'run') {
        if (Math.random() < 0.8) { await say('Got away safely!'); finish('run'); return; }
        await say("Couldn't escape!");
        if (!(await foeTurn())) return;
        return showMenu();
      }
      if (action.type === 'item') {
        state.items[action.item]--;
        const heal = action.item === 'potion' ? 25 : 10;
        mine.hp = Math.min(statsFor(msp, mine.level).maxHp, mine.hp + heal);
        draw();
        await say(`${mine.name} recovered ${heal} HP.`);
        if (!(await foeTurn())) return;
        return showMenu();
      }
      if (action.type === 'orb') {
        state.items.orb--;
        const ratio = foe.hp / statsFor(fsp, foe.level).maxHp;
        const chance = Math.min(0.95, (1 - ratio) * 0.75 + 0.15) / (fsp.rarity || 1);
        await say('You threw a capture orb…');
        if (Math.random() < chance) {
          if (state.party.length < 6) state.party.push(foe); else (state.box = state.box || []).push(foe);
          game.markSeen(foe.id, true);
          await say(`${foe.name} joined your team!`);
          finish('caught');
          return;
        }
        await say(`${foe.name} broke free!`);
        if (!(await foeTurn())) return;
        return showMenu();
      }
      // Attack
      const mv = action.move;
      const playerHit = async () => {
        const { dmg, eff } = damage(mv, mine, foe, msp, fsp);
        foe.hp = Math.max(0, foe.hp - dmg);
        flash(foeSide);
        draw();
        await say(`${mine.name} used ${mv.name}!${eff > 1 ? ' Super effective!' : eff < 1 ? ' Not very effective.' : ''}`);
        if (foe.hp <= 0) {
          await say(`${spec.wild ? 'Wild ' : ''}${foe.name} fainted!`);
          await gainXp(foe);
          foeIdx++;
          if (foeIdx >= foes.length) {
            if (spec.trainer) await say(`You defeated ${spec.trainer}!`);
            finish('win');
            return false;
          }
          draw();
          await say(`${spec.trainer} sent out ${foes[foeIdx].name}!`);
          return false;
        }
        return true;
      };
      if (meFirst) {
        if (await playerHit()) { if (!(await foeTurn())) return; }
        else if (root.hidden) return;
      } else {
        if (!(await foeTurn())) return;
        if (!(await playerHit()) && root.hidden) return;
      }
      showMenu();
    };

    const showMenu = () => {
      menu.replaceChildren();
      log.textContent = `What will ${state.party[mineIdx].name} do?`;
      const msp = speciesOf(state.party[mineIdx].id);
      for (const mv of (msp.moves?.length ? msp.moves : DEFAULT_MOVES).slice(0, 4)) {
        const b = el('button', 'btn move', mv.name);
        b.style.borderColor = ELEMENTS[mv.element]?.color || '#888';
        b.onclick = () => act({ type: 'attack', move: mv });
        menu.appendChild(b);
      }
      if ((state.items.potion || 0) > 0) {
        const b = el('button', 'btn', `Potion ×${state.items.potion}`);
        b.onclick = () => act({ type: 'item', item: 'potion' });
        menu.appendChild(b);
      }
      if (spec.wild && (state.items.orb || 0) > 0) {
        const b = el('button', 'btn accent', `Orb ×${state.items.orb}`);
        b.onclick = () => act({ type: 'orb' });
        menu.appendChild(b);
      }
      if (spec.wild) {
        const b = el('button', 'btn ghost', 'Run');
        b.onclick = () => act({ type: 'run' });
        menu.appendChild(b);
      }
    };

    draw();
    game.markSeen(foes[0].id);
    say(spec.wild ? `A wild ${foes[0].name} appeared!` : `${spec.trainer} wants to battle!`)
      .then(() => say(`Go, ${state.party[mineIdx].name}!`))
      .then(showMenu);
  });
}
