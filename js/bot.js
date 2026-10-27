// ============ AI PLAYER ============
// Picks where to put each piece. Every reachable resting position (each
// rotation, slid to each column, dropped straight down) is scored with
// Pierre Dellacherie's evaluation as tuned by El-Tetris — six board
// features with weights found by optimisation — and the bot also checks
// whether swapping in the hold piece would do better. No DOM: the game
// shell animates the chosen move, and the tests drive it directly.
//
// Two styles: "safe" is the pure evaluation (plays practically forever but
// clears mostly singles); "showy" keeps the right-hand column open while
// the stack is low and saves up for tetrises, which is far nicer to watch,
// falling back to safe play when the stack climbs.

const BOT_WEIGHTS = {
  landingHeight: -4.500158825082766,
  erodedCells: 3.4181268101392694,
  rowTransitions: -3.2178882868487753,
  colTransitions: -9.348695305445199,
  holes: -7.899265427351652,
  wellSums: -3.3855972247263626,
};

// showy-style tuning (found by sweeping seeded games: most tetrises while
// still never topping out)
const BOT_SHOWY = { maxStack: 12, tetrisBonus: 80, smallClear: 30, wellBlock: 12, wellRefund: 1 };

const Bot = {
  collides(grid, m, px, py) {
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        const gx = px + x, gy = py + y;
        if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
        if (gy >= 0 && grid[gy][gx]) return true;
      }
    }
    return false;
  },

  // matrices for 0..3 clockwise turns from spawn, exactly as the engine
  // produces them (so rotation index r matches the engine's cur.rot)
  rotations(type) {
    const out = [PIECES[type].map(r => [...r])];
    for (let r = 1; r < 4; r++) out.push(rotateCW(out[r - 1]));
    return type === "O" ? out.slice(0, 1) : out;
  },

  // every position reachable by rotating at spawn, sliding, then dropping
  placements(grid, type) {
    const out = [];
    this.rotations(type).forEach((m, rot) => {
      for (let x = -3; x < COLS; x++) {
        if (this.collides(grid, m, x, 0)) continue;
        let y = 0;
        while (!this.collides(grid, m, x, y + 1)) y++;
        out.push({ type, rot, x, y, m });
      }
    });
    return out;
  },

  evaluate(grid, p, style = "safe") {
    const g = grid.map(r => [...r]);
    let top = ROWS, bottom = 0;
    for (let y = 0; y < p.m.length; y++) {
      for (let x = 0; x < p.m[y].length; x++) {
        if (!p.m[y][x]) continue;
        g[p.y + y][p.x + x] = -1; // mark the piece's own cells
        top = Math.min(top, p.y + y); bottom = Math.max(bottom, p.y + y);
      }
    }
    // clear full rows, counting how many of the piece's cells went with them
    // (frozen zone rows are already "cleared" and don't count)
    let cleared = 0, pieceCells = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      const row = g[y];
      if (row.every(v => v !== 0) && !row.every(v => v === ZONE_CELL)) {
        cleared++;
        pieceCells += row.filter(v => v === -1).length;
        g.splice(y, 1);
        g.unshift(new Array(COLS).fill(0));
        y++;
      }
    }
    const filled = (x, y) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && g[y][x] !== 0);

    let rowT = 0;
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x <= COLS; x++) if (filled(x - 1, y) !== filled(x, y)) rowT++;
    }
    let colT = 0, holes = 0, wells = 0;
    for (let x = 0; x < COLS; x++) {
      let seenBlock = false, depth = 0;
      for (let y = 0; y <= ROWS; y++) {
        if (y > 0 && filled(x, y - 1) !== filled(x, y)) colT++;
        if (y === ROWS) break;
        const f = filled(x, y);
        if (f) seenBlock = true;
        else if (seenBlock) holes++;
        // wells: empty cells walled in on both sides, deeper ones cost more
        if (!f && filled(x - 1, y) && filled(x + 1, y)) { depth++; wells += depth; }
        else depth = 0;
      }
    }
    const landing = ROWS - (top + bottom) / 2;
    const w = BOT_WEIGHTS;
    let score = w.landingHeight * landing + w.erodedCells * cleared * pieceCells
      + w.rowTransitions * rowT + w.colTransitions * colT + w.holes * holes + w.wellSums * wells;

    if (style === "showy") {
      let stack = 0;
      for (let y = 0; y < ROWS; y++) if (g[y].some(v => v !== 0 && v !== ZONE_CELL)) { stack = ROWS - y; break; }
      const t = BOT_SHOWY;
      if (stack < t.maxStack) {
        if (cleared === 4) score += t.tetrisBonus;                // the payoff
        else if (cleared > 0) score -= t.smallClear * cleared;    // don't waste the setup on small clears
        // keep the well open: blocks in the right column are costly
        for (let y = 0; y < ROWS; y++) if (g[y][COLS - 1] !== 0 && g[y][COLS - 1] !== ZONE_CELL) score -= t.wellBlock;
        // the safe weights punish wells, but the right one is the point,
        // so give back most of what its depth cost
        for (let y = 0; y < ROWS; y++) {
          if (!filled(COLS - 1, y) && filled(COLS - 2, y)) score -= w.wellSums * t.wellRefund;
        }
      }
    }
    return score;
  },

  best(grid, type, style = "safe") {
    let best = null;
    for (const p of this.placements(grid, type)) {
      const score = this.evaluate(grid, p, style);
      if (!best || score > best.score) best = { ...p, score };
    }
    return best;
  },

  // the move for the game's current piece, or for the hold piece if
  // swapping is better: { hold, rot, x, y, type, score } (null: no room)
  plan(game, style = "safe") {
    if (!game.cur) return null;
    const here = this.best(game.grid, game.cur.type, style);
    if (game.canHold) {
      const alt = game.hold || game.queue[0];
      if (alt && alt !== game.cur.type) {
        const there = this.best(game.grid, alt, style);
        if (there && (!here || there.score > here.score + 1e-9)) return { ...there, hold: true };
      }
    }
    return here ? { ...here, hold: false } : null;
  },

  // play one piece instantly through the engine's own moves (used by tests
  // and anything that doesn't need to animate)
  playInstant(game, style = "safe") {
    const p = this.plan(game, style);
    if (!p) { game.hardDrop(); return; }
    if (p.hold) game.holdPiece();
    const turns = p.rot === 3 ? -1 : p.rot;
    for (let i = 0; i < Math.abs(turns); i++) game.rotate(Math.sign(turns));
    for (let guard = 0; game.cur.x !== p.x && guard < COLS; guard++) {
      if (!game.move(Math.sign(p.x - game.cur.x))) break;
    }
    game.hardDrop();
  },
};
