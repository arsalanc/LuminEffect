const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadGame, plain } = require("../load");

const G = loadGame();
beforeEach(() => G.localStorage.clear());

function fakeGame(score, lines, extra = {}) {
  return {
    score, lines, pieces: lines * 3,
    stats: { single: 1, double: 0, triple: 0, tetris: 1, tspin: 0, perfect: 0, zones: 1, maxZone: 4, maxCombo: 2, ...extra },
  };
}

test("lifetime totals accumulate across runs", () => {
  G.LifetimeStats.record("classic", fakeGame(1000, 10), 60);
  G.LifetimeStats.record("classic", fakeGame(3000, 20, { maxZone: 9 }), 120);
  const d = G.LifetimeStats.data;
  assert.equal(d.games, 2);
  assert.equal(d.lines, 30);
  assert.equal(d.score, 4000);
  assert.equal(d.time, 180);
  assert.equal(d.tetris, 2);
  assert.equal(d.bestZone, 9);
  assert.equal(d.modes.classic.best, 3000);
  assert.deepEqual(plain(d.modes.classic.last.map(x => x.s)), [3000, 1000]);
});

test("timed modes keep the fastest finish and mark unfinished runs", () => {
  G.LifetimeStats.record("sprint", fakeGame(0, 40), 95, { timed: true });
  G.LifetimeStats.record("sprint", fakeGame(0, 40), 80, { timed: true });
  G.LifetimeStats.record("sprint", fakeGame(0, 12), 30, { timed: true, finished: false });
  const m = G.LifetimeStats.data.modes.sprint;
  assert.equal(m.bestTime, 80);
  assert.deepEqual(plain(m.last[0]), { dnf: true });
});

test("only the last five results are kept", () => {
  for (let i = 0; i < 8; i++) G.LifetimeStats.record("zen", fakeGame(i, 1), 1);
  assert.equal(G.LifetimeStats.data.modes.zen.last.length, 5);
});

test("reset clears everything", () => {
  G.LifetimeStats.record("zen", fakeGame(5, 1), 1);
  G.LifetimeStats.reset();
  assert.equal(G.LifetimeStats.data.games, 0);
});
