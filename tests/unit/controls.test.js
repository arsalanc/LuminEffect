const { test, beforeEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadGame, plain } = require("../load");

const G = loadGame();
beforeEach(() => G.localStorage.clear());

test("default bindings cover every action", () => {
  const map = G.Controls.defaults();
  const look = G.Controls.lookup(map);
  for (const a of G.ACTIONS) assert.ok(map[a.id].length > 0, a.id);
  assert.equal(look.ArrowLeft, "left");
  assert.equal(look[" "], "hard");
  assert.equal(look.x, "cw");
});

test("letters bind case-insensitively", () => {
  const look = G.Controls.lookup(G.Controls.defaults());
  assert.equal(look[G.normKey("Z")], "ccw");
});

test("binding a key steals it from any other action", () => {
  const map = G.Controls.defaults();
  G.Controls.bind(map, "hold", 0, "x");
  assert.deepEqual(plain(map.hold), ["x"]);
  assert.ok(!map.cw.includes("x"));
  assert.equal(G.Controls.lookup(map).x, "hold");
});

test("an action holds at most two keys", () => {
  const map = G.Controls.defaults();
  G.Controls.bind(map, "zone", 2, "q");
  assert.equal(map.zone.length, 2);
});

test("saved bindings round-trip and missing actions fall back to defaults", () => {
  const map = G.Controls.defaults();
  G.Controls.bind(map, "hard", 0, "j");
  G.Controls.save(map);
  G.localStorage.setItem(G.Controls.KEY, JSON.stringify({ hard: ["j"] }));
  const loaded = G.Controls.load();
  assert.deepEqual(plain(loaded.hard), ["j"]);
  assert.deepEqual(plain(loaded.left), ["ArrowLeft"]);
});

test("key labels are readable", () => {
  assert.equal(G.keyLabel(" "), "SPACE");
  assert.equal(G.keyLabel("ArrowUp"), "↑");
  assert.equal(G.keyLabel("j"), "J");
  assert.equal(G.keyLabel(undefined), "—");
});
