// The game only talks to a "backend" object with these async methods:
//   getPersonalBest(day)            -> { timeMs, ghost, runId } | null
//   getLeaderboard(day)             -> [{ runId, name, timeMs, hasGhost, isYou }]
//   submitRun({ day, name, timeMs, ghost }) -> { rank, isPB, runId }
//   getGhost(day, runId)            -> { timeMs, ghost } | null
//
// Today this is saved in the browser (localStorage). When Supabase is connected we add
// a second class with the same methods, and nothing else in the game has to change.

const PREFIX = 'driftle:v1:';
const KEEP_DAYS = 7;

function read(key, fallback) {
  try {
    const v = localStorage.getItem(PREFIX + key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function getSavedName() {
  return read('name', 'Driver');
}

export function saveName(name) {
  write('name', name);
}

export class LocalBackend {
  constructor() {
    this.kind = 'local';
    this.prune();
  }

  prune() {
    try {
      const cutoff = Date.now() - KEEP_DAYS * 86400000;
      const dayPrefix = PREFIX + 'day:';
      const drop = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(dayPrefix)) {
          const when = Date.parse(k.slice(dayPrefix.length) + 'T00:00:00Z');
          if (!Number.isNaN(when) && when < cutoff) drop.push(k);
        }
      }
      drop.forEach((k) => localStorage.removeItem(k));
    } catch {
      /* storage unavailable: nothing to clean */
    }
  }

  async getPersonalBest(day) {
    const d = read('day:' + day, null);
    return d && d.pb ? d.pb : null;
  }

  async getLeaderboard(day) {
    const d = read('day:' + day, null);
    const runs = d && d.runs ? d.runs : [];
    return runs
      .slice()
      .sort((a, b) => a.timeMs - b.timeMs)
      .slice(0, 10)
      .map((r) => ({ runId: r.id, name: r.name, timeMs: r.timeMs, hasGhost: !!r.hasGhost, isYou: true }));
  }

  async submitRun({ day, name, timeMs, ghost }) {
    const d = read('day:' + day, { runs: [], pb: null });
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const isPB = !d.pb || timeMs < d.pb.timeMs;
    if (isPB) {
      d.pb = { timeMs, ghost, runId: id };
      d.runs.forEach((r) => {
        r.hasGhost = false;
      });
    }
    d.runs.push({ id, name, timeMs, hasGhost: isPB });
    d.runs.sort((a, b) => a.timeMs - b.timeMs);
    d.runs = d.runs.slice(0, 20);
    write('day:' + day, d);
    const idx = d.runs.findIndex((r) => r.id === id);
    return { rank: idx < 0 ? null : idx + 1, isPB, runId: id };
  }

  async getGhost(day, runId) {
    const d = read('day:' + day, null);
    return d && d.pb && d.pb.runId === runId ? d.pb : null;
  }
}
