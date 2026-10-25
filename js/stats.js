// ============ LIFETIME STATS ============
// Totals across every run, plus per-mode bests and recent results. Runs are
// recorded when they end (or are quit from the pause menu).

const LifetimeStats = {
  KEY: "lumineffect-stats",

  blank() {
    return {
      since: Date.now(),
      games: 0, time: 0, score: 0, lines: 0, pieces: 0,
      single: 0, double: 0, triple: 0, tetris: 0, tspin: 0, perfect: 0,
      zones: 0, bestZone: 0, maxCombo: 0,
      modes: {},
    };
  },

  get data() {
    try {
      const d = JSON.parse(localStorage.getItem(this.KEY) || "null");
      return d && typeof d === "object" ? Object.assign(this.blank(), d) : this.blank();
    } catch (e) { return this.blank(); }
  },

  // timed: the mode's record is a finishing time (lower is better)
  record(mode, game, elapsed, { finished = true, timed = false } = {}) {
    const d = this.data;
    const s = game.stats;
    d.games++;
    d.time += elapsed;
    d.score += game.score;
    d.lines += game.lines;
    d.pieces += game.pieces;
    for (const k of ["single", "double", "triple", "tetris", "tspin", "perfect", "zones"]) d[k] += s[k] || 0;
    d.bestZone = Math.max(d.bestZone, s.maxZone);
    d.maxCombo = Math.max(d.maxCombo, s.maxCombo);

    const m = d.modes[mode] || (d.modes[mode] = { games: 0, best: 0, bestTime: null, last: [] });
    m.games++;
    m.best = Math.max(m.best, game.score);
    if (timed && finished) m.bestTime = m.bestTime == null ? elapsed : Math.min(m.bestTime, elapsed);
    m.last = [timed ? (finished ? { t: elapsed } : { dnf: true }) : { s: game.score }, ...m.last].slice(0, 5);

    try { localStorage.setItem(this.KEY, JSON.stringify(d)); } catch (e) {}
  },

  reset() {
    try { localStorage.removeItem(this.KEY); } catch (e) {}
  },
};
