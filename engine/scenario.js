// Scenario interpreter. Scenarios are plain JSON — written by the game owner in
// scenarios/*.json or by players in the in-game editor — and never executed as code.
//
// {
//   "id": "intro", "title": "A new journey",
//   "trigger": { "type": "talk", "npc": "elder" }      // talk | enter {x,y,radius} | interact {x,y} | start
//   "requires": { "notFlag": "met_elder" },            // optional condition (or array = all)
//   "once": true,                                      // optional; default true for enter/start
//   "steps": [
//     { "say": "Welcome, {player}!", "who": "Elder" },
//     { "choice": "Will you help?", "options": [ { "text": "Yes", "goto": "yes" }, { "text": "No" } ] },
//     { "end": true },
//     { "label": "yes" },
//     { "give": { "item": "orb", "count": 5 } },
//     { "quest": { "id": "lake", "title": "Visit the lake", "status": "active" } },
//     { "setFlag": "met_elder" }
//   ]
// }
//
// Steps: say, choice, label, goto, if {cond, then, else}, setFlag, clearFlag, setVar, addVar,
// give, take, giveCreature, heal, quest, teleport, moveNpc, spawnNpc, removeNpc, setTile,
// battle, toast, wait, end.
// Conditions: flag, notFlag, item+min, var+gte/lte/eq, quest+status, lastBattle, party (min size), all, any.

const MAX_STEPS = 400;

const same = n => n;

/**
 * Community scenarios run in their own namespace: their flags, vars and quests get the
 * scenario's scope prefix unless named "shared.*", so a player's story cannot flip the
 * owner's main-story flags.
 */
export function scopeOf(sc) {
  return sc.scope ? n => (String(n).startsWith('shared.') ? n : sc.scope + n) : same;
}

export function checkCondition(cond, state, nm = same) {
  if (!cond) return true;
  if (Array.isArray(cond)) return cond.every(c => checkCondition(c, state, nm));
  if (cond.all) return cond.all.every(c => checkCondition(c, state, nm));
  if (cond.any) return cond.any.some(c => checkCondition(c, state, nm));
  if (cond.flag !== undefined && !state.flags[nm(cond.flag)]) return false;
  if (cond.notFlag !== undefined && state.flags[nm(cond.notFlag)]) return false;
  if (cond.item !== undefined && (state.items[cond.item] || 0) < (cond.min ?? 1)) return false;
  if (cond.var !== undefined) {
    const v = Number(state.vars[nm(cond.var)] || 0);
    if (cond.gte !== undefined && !(v >= cond.gte)) return false;
    if (cond.lte !== undefined && !(v <= cond.lte)) return false;
    if (cond.eq !== undefined && v !== cond.eq) return false;
  }
  if (cond.quest !== undefined && (state.quests[nm(cond.quest)]?.status || 'none') !== (cond.status || 'done')) return false;
  if (cond.lastBattle !== undefined && state.vars.lastBattle !== cond.lastBattle) return false;
  if (cond.party !== undefined && state.party.length < cond.party) return false;
  return true;
}

export function interpolate(text, state) {
  return String(text ?? '').replace(/\{(player|var\.[\w-]+|item\.[\w-]+)\}/g, (_, k) => {
    if (k === 'player') return state.playerName || 'Traveller';
    if (k.startsWith('var.')) return String(state.vars[k.slice(4)] ?? 0);
    if (k.startsWith('item.')) return String(state.items[k.slice(5)] ?? 0);
    return '';
  });
}

/** Whether a scenario may start now. */
export function canRun(sc, state) {
  const once = sc.once ?? (sc.trigger?.type === 'enter' || sc.trigger?.type === 'start');
  if (once && state.done[sc.id]) return false;
  return checkCondition(sc.requires, state, scopeOf(sc));
}

/**
 * Run a scenario. `game` supplies the side effects:
 *   say(text, who), choose(text, options, who) → index, toast(text), wait(ms),
 *   teleport(x, y), moveNpc(id, x, y), spawnNpc(def), removeNpc(id), setTile(edit),
 *   battle(spec) → 'win' | 'lose' | 'run', giveCreature(id, level), healParty(), save()
 */
export async function runScenario(sc, state, game) {
  const steps = Array.isArray(sc.steps) ? sc.steps : [];
  const labels = new Map();
  steps.forEach((s, i) => { if (s && s.label) labels.set(s.label, i); });
  const nm = scopeOf(sc);
  const jump = name => (labels.has(name) ? labels.get(name) : steps.length);

  let pc = 0, executed = 0;
  game.busy = true;
  try {
    while (pc < steps.length && executed++ < MAX_STEPS) {
      const s = steps[pc] || {};
      pc++;
      if (s.label !== undefined) continue;
      if (s.end) break;
      if (s.goto !== undefined && s.choice === undefined) { pc = jump(s.goto); continue; }

      if (s.say !== undefined) {
        const lines = Array.isArray(s.say) ? s.say : [s.say];
        for (const line of lines) await game.say(interpolate(line, state), interpolate(s.who || '', state));
      } else if (s.choice !== undefined) {
        const options = (s.options || []).slice(0, 6);
        const idx = await game.choose(interpolate(s.choice, state), options.map(o => interpolate(o.text, state)), interpolate(s.who || '', state));
        const picked = options[idx] || {};
        if (picked.setFlag) state.flags[nm(picked.setFlag)] = true;
        if (picked.goto !== undefined) pc = jump(picked.goto);
      } else if (s.if !== undefined) {
        const ok = checkCondition(s.if, state, nm);
        if (ok && s.then !== undefined) pc = jump(s.then);
        else if (!ok && s.else !== undefined) pc = jump(s.else);
      } else if (s.setFlag !== undefined) {
        for (const f of [].concat(s.setFlag)) state.flags[nm(f)] = true;
      } else if (s.clearFlag !== undefined) {
        for (const f of [].concat(s.clearFlag)) delete state.flags[nm(f)];
      } else if (s.setVar !== undefined) {
        state.vars[nm(s.setVar.name)] = s.setVar.value;
      } else if (s.addVar !== undefined) {
        state.vars[nm(s.addVar.name)] = Number(state.vars[nm(s.addVar.name)] || 0) + Number(s.addVar.value || 1);
      } else if (s.give !== undefined) {
        const count = Math.max(1, Math.min(99, Number(s.give.count) || 1));
        state.items[s.give.item] = (state.items[s.give.item] || 0) + count;
        game.toast(`Received ${count}× ${game.itemName(s.give.item)}`);
      } else if (s.take !== undefined) {
        const count = Math.max(1, Number(s.take.count) || 1);
        state.items[s.take.item] = Math.max(0, (state.items[s.take.item] || 0) - count);
      } else if (s.giveCreature !== undefined) {
        const spec = typeof s.giveCreature === 'string' ? { id: s.giveCreature } : s.giveCreature;
        game.giveCreature(spec.id, spec.level || 5);
      } else if (s.heal) {
        game.healParty();
      } else if (s.quest !== undefined) {
        const q = s.quest, qid = nm(q.id);
        const prev = state.quests[qid] || {};
        state.quests[qid] = { title: q.title || prev.title || q.id, desc: q.desc || prev.desc || '', status: q.status || 'active', author: sc.author };
        game.toast(q.status === 'done' ? `Quest complete: ${state.quests[qid].title}` : `New quest: ${state.quests[qid].title}`);
      } else if (s.teleport !== undefined) {
        game.teleport(s.teleport.x, s.teleport.y);
      } else if (s.moveNpc !== undefined) {
        game.moveNpc(s.moveNpc.npc, s.moveNpc.x, s.moveNpc.y);
      } else if (s.spawnNpc !== undefined) {
        game.spawnNpc(s.spawnNpc);
      } else if (s.removeNpc !== undefined) {
        game.removeNpc(s.removeNpc);
      } else if (s.setTile !== undefined) {
        game.setTile(s.setTile);
      } else if (s.battle !== undefined) {
        state.vars.lastBattle = await game.battle(s.battle);
      } else if (s.toast !== undefined) {
        game.toast(interpolate(s.toast, state));
      } else if (s.wait !== undefined) {
        await game.wait(Math.min(5000, Number(s.wait) || 0));
      }
    }
    state.done[sc.id] = true;
  } finally {
    game.busy = false;
    game.save();
  }
}
