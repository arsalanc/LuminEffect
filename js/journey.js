// ============ JOURNEY MAP ============
// Journey is a constellation of short stages rather than one long run, so it
// can be played in bursts. Each node is 1-2 minutes; progress persists, and
// finishing one unlocks the next.
//
// The stage order is an emotional arc, not a difficulty ramp: a gentle
// opening, a long build, a climax at EVENT HORIZON, then a deliberate
// comedown so a full playthrough ends calm instead of exhausted.

// x/y are laid out on a 900x500 landscape grid (see mapCoords for portrait,
// which transposes the same numbers into a vertical meander).
function jnode(id, name, theme, goal, level, x, y, sub) {
  return { id, name, theme, goal, level, x, y, sub, par: goal * level * 150 };
}

const JOURNEY_NODES = [
  // — act i: awakening —
  jnode("first-light", "FIRST LIGHT", "deepsea", 8, 1, 90, 70, "the surface, still bright"),
  jnode("drift", "DRIFT", "deepsea", 10, 2, 300, 70, "letting go"),
  jnode("shallows", "SHALLOWS", "aurora", 10, 3, 510, 70, "cold light on ice"),
  jnode("windward", "WINDWARD", "dunes", 12, 3, 720, 70, "the wind picks up"),
  // — act ii: the build —
  jnode("mirage", "MIRAGE", "dunes", 12, 4, 810, 250, "heat and repetition"),
  jnode("descent", "DESCENT", "deepsea", 14, 5, 600, 250, "down past the light"),
  jnode("signal", "SIGNAL", "neon", 14, 6, 390, 250, "something is calling"),
  jnode("overdrive", "OVERDRIVE", "neon", 16, 7, 180, 250, "all of it at once"),
  // — act iii: climax —
  jnode("threshold", "THRESHOLD", "cosmos", 16, 8, 90, 430, "the last quiet moment"),
  jnode("horizon", "EVENT HORIZON", "cosmos", 18, 9, 300, 430, "the edge of everything"),
  // — act iv: comedown —
  jnode("afterglow", "AFTERGLOW", "aurora", 12, 4, 510, 430, "the light comes back"),
  jnode("home", "HOME", "deepsea", 10, 2, 720, 430, "you can rest now"),
];

const JMAP_W = 900, JMAP_H = 500;

// Portrait transposes the landscape layout so the snake runs top-to-bottom.
function mapCoords(node, portrait) {
  return portrait
    ? { left: (node.y / JMAP_H) * 100, top: (node.x / JMAP_W) * 100 }
    : { left: (node.x / JMAP_W) * 100, top: (node.y / JMAP_H) * 100 };
}

const JourneyProgress = {
  KEY: "lumineffect-journey",

  get data() {
    try {
      const d = JSON.parse(localStorage.getItem(this.KEY) || "{}");
      return d && typeof d === "object" ? d : {};
    } catch (e) { return {}; }
  },

  _write(d) {
    try { localStorage.setItem(this.KEY, JSON.stringify(d)); } catch (e) {}
  },

  isComplete(id) { return !!this.data[id]; },
  best(id) { return this.data[id] || null; },

  // A node is playable once the previous one is cleared.
  isUnlocked(index) {
    if (index <= 0) return true;
    return this.isComplete(JOURNEY_NODES[index - 1].id);
  },

  // First unplayed node, or the last one if the journey is finished.
  nextIndex() {
    for (let i = 0; i < JOURNEY_NODES.length; i++) {
      if (!this.isComplete(JOURNEY_NODES[i].id)) return i;
    }
    return JOURNEY_NODES.length - 1;
  },

  completedCount() {
    return JOURNEY_NODES.filter(n => this.isComplete(n.id)).length;
  },

  totalStars() {
    return JOURNEY_NODES.reduce((sum, n) => {
      const b = this.best(n.id);
      return sum + (b ? b.stars : 0);
    }, 0);
  },

  // 1 star for finishing, 2 for beating par, 3 for clearing it well.
  starsFor(node, score, toppedOut) {
    if (toppedOut) return 0;
    if (score >= node.par * 1.6) return 3;
    if (score >= node.par) return 2;
    return 1;
  },

  // Each stat keeps its own record — a fast run banks its time even if it
  // scored badly. Returns true when the score itself is a new high.
  record(node, { score, stars, time }) {
    const d = this.data;
    const prev = d[node.id];
    const improved = !prev || score > prev.score;
    d[node.id] = prev
      ? { score: Math.max(score, prev.score), stars: Math.max(stars, prev.stars), time: Math.min(time, prev.time) }
      : { score, stars, time };
    this._write(d);
    return improved;
  },

  reset() { this._write({}); },
};
