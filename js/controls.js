// ============ CONTROLS ============
// Rebindable keyboard actions. Each action holds up to two keys; binding a
// key to one action removes it from any other.

const ACTIONS = [
  { id: "left",  label: "MOVE LEFT" },
  { id: "right", label: "MOVE RIGHT" },
  { id: "soft",  label: "SOFT DROP" },
  { id: "hard",  label: "HARD DROP" },
  { id: "cw",    label: "ROTATE CW" },
  { id: "ccw",   label: "ROTATE CCW" },
  { id: "hold",  label: "HOLD" },
  { id: "zone",  label: "ZONE" },
  { id: "pause", label: "PAUSE" },
];

const DEFAULT_KEYS = {
  left: ["ArrowLeft"], right: ["ArrowRight"], soft: ["ArrowDown"], hard: [" "],
  cw: ["ArrowUp", "x"], ccw: ["z"], hold: ["c"], zone: ["Shift", "Enter"], pause: ["p", "Escape"],
};

// letters bind case-insensitively (so Shift+Z still rotates)
function normKey(k) { return k.length === 1 ? k.toLowerCase() : k; }

const KEY_NAMES = {
  " ": "SPACE", ArrowLeft: "←", ArrowRight: "→", ArrowUp: "↑", ArrowDown: "↓",
  Escape: "ESC", Enter: "ENTER", Shift: "SHIFT", Control: "CTRL", Alt: "ALT", Meta: "CMD",
  Backspace: "BKSP", Tab: "TAB", CapsLock: "CAPS",
};
function keyLabel(k) {
  if (!k) return "—";
  return KEY_NAMES[k] || (k.length === 1 ? k.toUpperCase() : k.toUpperCase());
}

const Controls = {
  KEY: "lumineffect-keys",
  load() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(this.KEY) || "{}") || {}; } catch (e) {}
    const map = {};
    for (const a of ACTIONS) {
      const v = saved[a.id];
      map[a.id] = Array.isArray(v) ? v.filter(k => typeof k === "string").slice(0, 2) : [...DEFAULT_KEYS[a.id]];
    }
    return map;
  },
  save(map) {
    try { localStorage.setItem(this.KEY, JSON.stringify(map)); } catch (e) {}
  },
  defaults() {
    const map = {};
    for (const a of ACTIONS) map[a.id] = [...DEFAULT_KEYS[a.id]];
    return map;
  },
  // key → action
  lookup(map) {
    const out = {};
    for (const id in map) for (const k of map[id]) out[normKey(k)] = id;
    return out;
  },
  bind(map, action, slot, key) {
    const k = normKey(key);
    for (const id in map) map[id] = map[id].filter(x => normKey(x) !== k);
    const keys = map[action];
    if (slot >= keys.length) keys.push(k); else keys[slot] = k;
    map[action] = keys.slice(0, 2);
  },
};
