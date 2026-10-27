const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadGame } = require("../load");

const G = loadGame();

test("the bot completes an open line when it can", () => {
  const g = new G.Tetris({}, { seed: 1 });
  // bottom row full except column 9; give it an I
  g.grid[G.ROWS - 1] = g.grid[G.ROWS - 1].map((_, x) => (x === 9 ? 0 : 1));
  g._spawn("I");
  g.canHold = false;
  const p = G.Bot.plan(g);
  assert.equal(p.rot % 2, 1, "stands the I up");
  G.Bot.playInstant(g);
  assert.equal(g.lines, 1);
});

test("the bot avoids burying holes", () => {
  const g = new G.Tetris({}, { seed: 2 });
  const holes = grid => {
    let n = 0;
    for (let x = 0; x < G.COLS; x++) {
      let seen = false;
      for (let y = 0; y < G.ROWS; y++) { if (grid[y][x]) seen = true; else if (seen) n++; }
    }
    return n;
  };
  for (let i = 0; i < 30; i++) G.Bot.playInstant(g);
  assert.ok(holes(g.grid) <= 2, `left ${holes(g.grid)} holes after 30 pieces`);
});

for (const seed of [11, 22, 33]) {
  test(`the bot survives 500 pieces and clears lines (seed ${seed})`, () => {
    let toppedOut = false;
    const g = new G.Tetris({ onTopOut() { toppedOut = true; } }, { seed });
    for (let i = 0; i < 500 && !toppedOut; i++) G.Bot.playInstant(g);
    assert.equal(toppedOut, false);
    assert.ok(g.lines >= 180, `only cleared ${g.lines} lines`);
  });
}

test("the bot digs through rising garbage", () => {
  let toppedOut = false;
  const g = new G.Tetris({ onTopOut() { toppedOut = true; } }, { seed: 5 });
  g.addGarbage(6);
  for (let i = 0; i < 300 && !toppedOut; i++) {
    G.Bot.playInstant(g);
    if (i % 6 === 5) g.addGarbage(1);
  }
  assert.equal(toppedOut, false);
  assert.ok(g.purified >= 300, `purified only ${g.purified}`);
});

test("showy style still survives, and scores tetrises", () => {
  let toppedOut = false;
  const g = new G.Tetris({ onTopOut() { toppedOut = true; } }, { seed: 7 });
  for (let i = 0; i < 600 && !toppedOut; i++) G.Bot.playInstant(g, "showy");
  assert.equal(toppedOut, false);
  assert.ok(g.stats.tetris >= 8, `only ${g.stats.tetris} tetrises`);
});
