const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadGame } = require("../load");

const G = loadGame();
beforeEach(() => G.localStorage.clear());

const DAY = 864e5;
const T0 = Date.UTC(2026, 9, 20, 12); // midday, so local dates are stable

test("daily challenge is the same all day and changes between days", () => {
  const a = G.dailyInfo(new Date(T0)), b = G.dailyInfo(new Date(T0 + 3600e3));
  assert.equal(a.key, b.key);
  assert.equal(a.seed, b.seed);
  assert.equal(a.theme.id, b.theme.id);
  assert.equal(a.twist, b.twist);
  const keys = new Set(), seeds = new Set(), twists = new Set(), themes = new Set();
  for (let d = 0; d < 90; d++) {
    const info = G.dailyInfo(new Date(T0 + d * DAY));
    keys.add(info.key); seeds.add(info.seed); twists.add(info.twist); themes.add(info.theme.id);
  }
  assert.equal(keys.size, 90);
  assert.equal(seeds.size, 90);
  assert.deepEqual([...twists].sort(), Object.keys(G.DAILY_TWISTS).sort(), "every twist turns up");
  assert.equal(themes.size, G.THEMES.length, "every map turns up");
});

test("daily record keeps today's best and counts a streak of consecutive days", () => {
  const key = t => G.localDateKey(new Date(t));
  G.run(`Date.now = () => ${T0}`);
  let r = G.DailyRecord.submit(key(T0), 1000);
  assert.equal(r.streak, 1); assert.equal(r.today, 1000); assert.equal(r.newToday, true);
  r = G.DailyRecord.submit(key(T0), 500);
  assert.equal(r.today, 1000, "a worse run doesn't replace today's best");
  assert.equal(r.newToday, false);
  G.run(`Date.now = () => ${T0 + DAY}`);
  r = G.DailyRecord.submit(key(T0 + DAY), 300);
  assert.equal(r.streak, 2); assert.equal(r.today, 300); assert.equal(r.best, 1000);
  G.run(`Date.now = () => ${T0 + 3 * DAY}`);
  r = G.DailyRecord.submit(key(T0 + 3 * DAY), 200);
  assert.equal(r.streak, 1, "a skipped day resets the streak");
  G.run(`Date.now = () => Number(new Date())`);
});

test("purify garbage speeds up as you purify, with a floor", () => {
  let prev = Infinity;
  for (let p = 0; p <= 200; p += 10) {
    const v = G.purifyInterval(p);
    assert.ok(v <= prev); prev = v;
    assert.ok(v >= 2.2);
  }
});

test("mystery events are well formed", () => {
  const ids = G.MYSTERY_EVENTS.map(e => e.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const e of G.MYSTERY_EVENTS) {
    assert.ok(e.name && e.sub, e.id);
    assert.ok(e.kind === "timed" || e.kind === "instant", e.id);
    if (e.kind === "timed") assert.ok(e.dur > 0, e.id);
  }
  assert.ok(G.MYSTERY_EVENTS.some(e => e.kind === "instant"), "an instant event must always be pickable");
});
