// Community world-building: players publish what they built in the editor (tile edits,
// NPCs, scenarios) as one "build". The Buildpad API stores it; depending on the owner's
// setting it goes live at once or after the owner approves it in Buildpad.

const CLIENT_KEY = 'iso-world:client-id';

function clientId() {
  try {
    let id = localStorage.getItem(CLIENT_KEY);
    if (!id) {
      id = crypto.randomUUID ? crypto.randomUUID() : String(Math.random()).slice(2) + Date.now();
      localStorage.setItem(CLIENT_KEY, id);
    }
    return id;
  } catch {
    return 'anon-' + Math.floor(Math.random() * 1e9);
  }
}

export class Community {
  constructor(config) {
    this.api = (config?.api || '').replace(/\/+$/, '');
    this.worldId = config?.worldId || '';
    this.enabled = !!(this.api && this.worldId);
    this.mode = 'closed';
    this.clientId = clientId();
  }

  url(path = '') {
    return `${this.api}/api/game-worlds/${encodeURIComponent(this.worldId)}${path}`;
  }

  /** Approved builds, oldest first: [{ id, author: { name }, payload, createdAt }]. */
  async load() {
    if (!this.enabled) return [];
    try {
      const res = await fetch(this.url(), { cache: 'no-store' });
      if (!res.ok) return [];
      const data = await res.json();
      this.mode = data.world?.contributions || 'closed';
      this.title = data.world?.title;
      return Array.isArray(data.contributions) ? data.contributions : [];
    } catch (err) {
      console.warn('[community] load failed', err);
      return [];
    }
  }

  /** Publish a build. Resolves { id, status: 'approved' | 'pending' }. */
  async submit(authorName, payload) {
    if (!this.enabled) throw new Error('Community building is not set up for this world.');
    const res = await fetch(this.url('/contributions'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'build', author: { name: authorName, clientId: this.clientId }, payload }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Publishing failed (${res.status})`);
    return data;
  }

  /** This browser's own builds with their review status. */
  async mine() {
    if (!this.enabled) return [];
    try {
      const res = await fetch(this.url(`/contributions/mine?clientId=${encodeURIComponent(this.clientId)}`), { cache: 'no-store' });
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data.contributions) ? data.contributions : [];
    } catch {
      return [];
    }
  }
}

/**
 * Namespace a build's NPC and scenario ids so they cannot collide with the owner's
 * content or other builds; scenario triggers that point at the build's own NPCs follow.
 */
export function namespaceBuild(contribution) {
  const p = contribution.payload || {};
  const ns = `c${contribution.id}:`;
  const npcIds = new Set((p.npcs || []).map(n => n.id));
  const npcs = (p.npcs || []).map(n => ({ ...n, id: ns + n.id, author: contribution.author?.name }));
  const scenarios = (p.scenarios || []).map(s => {
    const out = { ...s, id: ns + (s.id || 'scenario'), scope: ns, author: contribution.author?.name };
    if (s.trigger?.type === 'talk' && npcIds.has(s.trigger.npc)) out.trigger = { ...s.trigger, npc: ns + s.trigger.npc };
    const own = id => (npcIds.has(id) ? ns + id : id);
    out.steps = (s.steps || []).map(step => {
      if (step?.moveNpc) return { ...step, moveNpc: { ...step.moveNpc, npc: own(step.moveNpc.npc) } };
      if (step?.removeNpc !== undefined) return { ...step, removeNpc: own(step.removeNpc) };
      return step;
    });
    return out;
  });
  return { edits: p.edits || [], npcs, scenarios };
}
