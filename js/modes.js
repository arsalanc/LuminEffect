// ============ EFFECT MODES ============
// Short twists on the core game, grouped under EFFECT MODES on the menu:
// a 3-minute score attack, a garbage-clearing race, a mode where random
// events keep rewriting the rules, and a seeded daily challenge.

const EFFECT_MODES = {
  ultra: {
    name: "ULTRA", sub: "three minutes",
    desc: "Three minutes. Score as much as you can.",
    timeLimit: 180,
  },
  purify: {
    name: "PURIFY", sub: "clear the dark",
    desc: "Dark blocks rise from below. Clear lines through them to purify 60.",
    target: 60,
  },
  mystery: {
    name: "MYSTERY", sub: "anything can happen",
    desc: "Every few seconds something changes. Survive as long as you can.",
    every: 16, // seconds of play between events (daily's mystery twist too)
  },
  daily: {
    name: "DAILY", sub: "one shot a day",
    desc: "Two minutes, the same pieces and twist for everyone today.",
    timeLimit: 120,
  },
  theater: {
    name: "THEATER", sub: "sit back",
    desc: "The game plays itself through every world. Just watch and listen.",
    linesPerMap: 24,   // lines before the tour moves on to the next map
    attractAfter: 30,  // seconds idle on the menu before the theater starts by itself
  },
};

// Purify: dark rows creep up faster the more you've already cleansed
function purifyInterval(purified) {
  return Math.max(2.2, 5.5 - purified * 0.04);
}

// ---- mystery events ----
// kind "timed" effects last `dur` seconds of play; "instant" ones happen once.
// good: true reads as a gift (green), false as a curse (red), null neutral.
const MYSTERY_EVENTS = [
  { id: "fog",     name: "FOG",          sub: "the stack fades from view",  kind: "timed", dur: 10, good: false },
  { id: "flip",    name: "UPSIDE DOWN",  sub: "which way is down?",          kind: "timed", dur: 10, good: false },
  { id: "mirror",  name: "MIRROR",       sub: "left is right",               kind: "timed", dur: 10, good: false },
  { id: "blind",   name: "BLINDFOLD",    sub: "no peeking ahead",            kind: "timed", dur: 12, good: false },
  { id: "rush",    name: "RUSH",         sub: "everything falls faster",     kind: "timed", dur: 10, good: false },
  { id: "surge",   name: "SURGE",        sub: "the floor rises",             kind: "instant", good: false },
  { id: "irain",   name: "I-PIECE RAIN", sub: "four long ones in a row",     kind: "instant", good: true },
  { id: "cleanse", name: "CLEANSE",      sub: "the floor falls away",        kind: "instant", good: true },
  { id: "charge",  name: "CHARGE",       sub: "the zone is yours",           kind: "instant", good: true },
  { id: "shift",   name: "WORLD SHIFT",  sub: "somewhere else entirely",     kind: "instant", good: null },
];

// ---- daily challenge ----
function localDateKey(d = new Date()) {
  const p = n => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function hashString(str) {
  let h = 2166136261 >>> 0; // FNV-1a
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h;
}

const DAILY_TWISTS = {
  calm:    { name: "PURE",    sub: "just you and the pieces" },
  rising:  { name: "RISING",  sub: "dark rows creep up from below" },
  mystery: { name: "MYSTERY", sub: "events every few seconds" },
};

// Everything about today's challenge is derived from the date, so every
// player gets the same map, twist, pieces and events.
function dailyInfo(date = new Date()) {
  const key = localDateKey(date);
  const seed = hashString("lumineffect:" + key);
  const r = seededRandom(seed ^ 0x9e3779b9);
  const theme = THEMES[Math.floor(r() * THEMES.length)];
  const twists = Object.keys(DAILY_TWISTS);
  const twist = twists[Math.floor(r() * twists.length)];
  return { key, seed, theme, twist };
}

const DailyRecord = {
  KEY: "lumineffect-daily",
  get data() {
    try {
      const d = JSON.parse(localStorage.getItem(this.KEY) || "{}");
      return d && typeof d === "object" ? d : {};
    } catch (e) { return {}; }
  },
  // today's best, all-time best and the run of consecutive days played
  summary(key) {
    const d = this.data;
    return {
      today: d.date === key ? d.today : null,
      best: d.best || 0,
      streak: d.date === key || d.date === localDateKey(new Date(Date.now() - 864e5)) ? d.streak || 0 : 0,
    };
  },
  submit(key, score) {
    const d = this.data;
    const yesterday = localDateKey(new Date(Date.now() - 864e5));
    const firstToday = d.date !== key;
    const out = {
      date: key,
      today: firstToday ? score : Math.max(d.today || 0, score),
      best: Math.max(d.best || 0, score),
      streak: !firstToday ? d.streak || 1 : d.date === yesterday ? (d.streak || 0) + 1 : 1,
    };
    try { localStorage.setItem(this.KEY, JSON.stringify(out)); } catch (e) {}
    return { ...out, newToday: firstToday || score > (d.today || 0) };
  },
};
