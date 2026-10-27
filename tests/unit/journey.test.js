const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadGame, plain } = require("../load");

const G = loadGame();
beforeEach(() => G.localStorage.clear());

test("journey nodes are well formed", () => {
  const ids = G.JOURNEY_NODES.map(n => n.id);
  assert.equal(new Set(ids).size, ids.length);
  const themeIds = new Set(G.THEMES.map(t => t.id));
  for (const n of G.JOURNEY_NODES) {
    assert.ok(themeIds.has(n.theme), `${n.id} uses unknown map ${n.theme}`);
    assert.ok(n.x >= 0 && n.x <= G.JMAP_W && n.y >= 0 && n.y <= G.JMAP_H, n.id);
  }
  for (const t of G.THEMES) assert.ok(G.JOURNEY_NODES.some(n => n.theme === t.id), `journey never visits ${t.id}`);
});

test("stages unlock in order", () => {
  assert.equal(G.JourneyProgress.isUnlocked(0), true);
  assert.equal(G.JourneyProgress.isUnlocked(1), false);
  G.JourneyProgress.record(G.JOURNEY_NODES[0], { score: 1, stars: 1, time: 10 });
  assert.equal(G.JourneyProgress.isUnlocked(1), true);
  assert.equal(G.JourneyProgress.nextIndex(), 1);
});

test("a cleared stage stays open even if a new stage is added before it", () => {
  // finish every stage except one in the middle (as if it was just added)
  const skip = 3;
  G.JOURNEY_NODES.forEach((n, i) => { if (i !== skip) G.JourneyProgress.record(n, { score: 1, stars: 1, time: 1 }); });
  assert.equal(G.JourneyProgress.isUnlocked(skip), true);
  assert.equal(G.JourneyProgress.isUnlocked(skip + 1), true, "already-cleared stages never re-lock");
  assert.equal(G.JourneyProgress.nextIndex(), skip);
});

test("records keep the best of each stat", () => {
  const n = G.JOURNEY_NODES[0];
  G.JourneyProgress.record(n, { score: 500, stars: 2, time: 60 });
  G.JourneyProgress.record(n, { score: 300, stars: 1, time: 40 });
  assert.deepEqual(plain(G.JourneyProgress.best(n.id)), { score: 500, stars: 2, time: 40 });
});

test("stars: topping out earns none, par earns two", () => {
  const n = G.JOURNEY_NODES[2];
  assert.equal(G.JourneyProgress.starsFor(n, 1e9, true), 0);
  assert.equal(G.JourneyProgress.starsFor(n, 0, false), 1);
  assert.equal(G.JourneyProgress.starsFor(n, n.par, false), 2);
  assert.equal(G.JourneyProgress.starsFor(n, n.par * 1.6, false), 3);
});

test("classic tours every map over its 15 levels", () => {
  const seen = new Set();
  for (let lvl = 1; lvl <= 15; lvl++) {
    seen.add(Math.min(G.THEMES.length - 1, Math.floor((lvl - 1) * G.THEMES.length / 15)));
  }
  assert.equal(seen.size, G.THEMES.length);
});
