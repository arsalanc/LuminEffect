const { test } = require("node:test");
const assert = require("node:assert/strict");
const { loadGame } = require("../load");

const G = loadGame();
const { Tetris, PIECES, PIECE_ORDER, ROWS, COLS, ZONE_CELL, DARK_CELL } = {
  Tetris: G.Tetris, PIECES: G.PIECES, PIECE_ORDER: G.PIECE_ORDER, ROWS: G.ROWS, COLS: G.COLS,
  ZONE_CELL: G.ZONE_CELL, DARK_CELL: G.DARK_CELL,
};

// a game with a recorder for every engine event
function game(opts) {
  const events = [];
  const handler = new Proxy({}, { get: (_, name) => (...args) => events.push([name, ...args]) });
  const g = new Tetris(handler, opts);
  return { g, events, named: n => events.filter(e => e[0] === n) };
}

// fill the bottom `n` rows except column `gap`
function fillBottom(g, n, gap) {
  for (let y = ROWS - n; y < ROWS; y++) g.grid[y] = g.grid[y].map((_, x) => (x === gap ? 0 : 1));
}

// spawn an I, stand it up, slide it to the left wall and drop it
function dropVerticalIAtLeftWall(g) {
  g._spawn("I");
  g.rotate(1);
  while (g.move(-1));
  g.hardDrop();
}

test("7-bag deals each piece exactly once per seven", () => {
  const t = Object.create(Tetris.prototype);
  t.bag = [];
  t.rng = G.seededRandom(5);
  for (let bag = 0; bag < 3; bag++) {
    const seven = Array.from({ length: 7 }, () => t._draw());
    assert.deepEqual([...seven].sort(), [...PIECE_ORDER].sort());
  }
});

test("the same seed deals the same pieces; a different seed doesn't", () => {
  const deal = seed => {
    const t = Object.create(Tetris.prototype);
    t.bag = []; t.rng = G.seededRandom(seed);
    return Array.from({ length: 50 }, () => t._draw()).join("");
  };
  assert.equal(deal(42), deal(42));
  assert.notEqual(deal(42), deal(43));
});

test("a vertical I into a 4-deep well is a tetris", () => {
  const { g, named } = game();
  fillBottom(g, 4, 0);
  dropVerticalIAtLeftWall(g);
  assert.equal(g.lines, 4);
  assert.equal(g.stats.tetris, 1);
  const [[, info]] = named("onClear");
  assert.equal(info.name, "TETRIS");
  assert.equal(info.lines, 4);
  assert.ok(g.grid.every(r => r.every(v => v === 0)), "board should be empty — a perfect clear");
  assert.equal(info.perfect, true);
});

test("hold swaps once per piece", () => {
  const { g } = game({ seed: 1 });
  const first = g.cur.type, next = g.queue[0];
  assert.equal(g.holdPiece(), true);
  assert.equal(g.hold, first);
  assert.equal(g.cur.type, next);
  assert.equal(g.holdPiece(), false, "can't hold again until the piece locks");
});

test("pieces collide with walls and the floor", () => {
  const { g } = game({ seed: 3 });
  let moves = 0;
  while (g.move(-1)) moves++;
  assert.ok(moves < COLS);
  assert.equal(g.move(-1), false);
  g.hardDrop();
  assert.ok(g.grid[ROWS - 1].some(v => v !== 0), "piece should land on the floor");
});

test("zone banks cleared lines at the bottom and cashes them out together", () => {
  const { g, named } = game();
  g.meter = 1;
  assert.equal(g.activateZone(), true);
  assert.ok(g.zone);
  assert.equal(g.gravityDelay(), Infinity, "time stands still in the zone");
  fillBottom(g, 4, 0);
  dropVerticalIAtLeftWall(g);
  assert.equal(g.zone.lines, 4);
  assert.ok(g.grid.slice(-4).every(r => r.every(v => v === ZONE_CELL)));
  assert.equal(g.lines, 0, "banked lines aren't counted until the zone ends");
  g.update(g.zone.time + 0.1);
  assert.equal(g.zone, null);
  const [[, res]] = named("onZoneEnd");
  assert.equal(res.lines, 4);
  assert.equal(g.lines, 4);
  assert.equal(g.stats.zones, 1);
  assert.ok(g.grid.every(r => r.every(v => v === 0)));
});

test("garbage rises with one hole and is purified when cleared", () => {
  const { g } = game({ seed: 9 });
  g.addGarbage(2);
  for (const r of g.grid.slice(-2)) {
    assert.equal(r.filter(v => v === DARK_CELL).length, COLS - 1);
    assert.equal(r.filter(v => v === 0).length, 1);
  }
  // plug the top garbage row's hole and clear it
  const row = g.grid[ROWS - 2];
  row[row.indexOf(0)] = 1;
  g._clearLines(false, false);
  assert.equal(g.purified, COLS - 1);
  assert.equal(g.lines, 1);
});

test("garbage pushing the stack through the ceiling tops out", () => {
  const { g, named } = game();
  g.grid[0][0] = 1;
  g.addGarbage(1);
  assert.equal(named("onTopOut").length, 1);
});

test("no garbage while the zone is active", () => {
  const { g } = game();
  g.meter = 1; g.activateZone();
  g.addGarbage(3);
  assert.ok(g.grid.every(r => r.every(v => v === 0)));
});

test("removeBottomRows lifts the floor away", () => {
  const { g } = game();
  fillBottom(g, 3, 4);
  assert.equal(g.removeBottomRows(5), 3, "stops at the first empty row");
  assert.ok(g.grid.every(r => r.every(v => v === 0)));
});

test("instant soft drop lands the piece in one frame without locking", () => {
  const { g } = game({ seed: 2 });
  g.softDropFactor = 41;
  g.softDropping = true;
  const type = g.cur.type;
  g.update(0.016);
  assert.equal(g.cur.y, g.ghostY());
  assert.equal(g.cur.type, type, "still the same piece — soft drop never locks instantly");
});

test("gravityScale speeds up gravity", () => {
  const { g } = game();
  const base = g.gravityDelay();
  g.gravityScale = 3;
  assert.ok(Math.abs(g.gravityDelay() - base / 3) < 1e-12);
});

test("every piece spawns inside the board on an empty grid", () => {
  for (const t of PIECE_ORDER) {
    const { g } = game();
    g._spawn(t);
    assert.equal(g._collides(g.cur.m, g.cur.x, g.cur.y), false, t);
    assert.ok(PIECES[t]);
  }
});
