// ============ TETRIS ENGINE ============
// Guideline-style core: SRS rotation with wall kicks, 7-bag randomizer,
// hold, ghost, T-spin detection, back-to-back, combos — plus the ZONE
// mechanic: cleared lines freeze at the bottom and cash out all at once.

const COLS = 10;
const VISIBLE_ROWS = 20;
const HIDDEN_ROWS = 2;
const ROWS = VISIBLE_ROWS + HIDDEN_ROWS;
const ZONE_CELL = 9; // sentinel value for frozen zone rows

const PIECES = {
  I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
  O: [[1,1],[1,1]],
  T: [[0,1,0],[1,1,1],[0,0,0]],
  S: [[0,1,1],[1,1,0],[0,0,0]],
  Z: [[1,1,0],[0,1,1],[0,0,0]],
  J: [[1,0,0],[1,1,1],[0,0,0]],
  L: [[0,0,1],[1,1,1],[0,0,0]],
};
const PIECE_ORDER = ["I", "O", "T", "S", "Z", "J", "L"];

// SRS kick tables, already converted to y-down screen coordinates.
const KICKS_JLSTZ = {
  "01": [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  "10": [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  "12": [[0,0],[1,0],[1,1],[0,-2],[1,-2]],
  "21": [[0,0],[-1,0],[-1,-1],[0,2],[-1,2]],
  "23": [[0,0],[1,0],[1,-1],[0,2],[1,2]],
  "32": [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  "30": [[0,0],[-1,0],[-1,1],[0,-2],[-1,-2]],
  "03": [[0,0],[1,0],[1,-1],[0,2],[1,2]],
};
const KICKS_I = {
  "01": [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
  "10": [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
  "12": [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
  "21": [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
  "23": [[0,0],[2,0],[-1,0],[2,-1],[-1,2]],
  "32": [[0,0],[-2,0],[1,0],[-2,1],[1,-2]],
  "30": [[0,0],[1,0],[-2,0],[1,2],[-2,-1]],
  "03": [[0,0],[-1,0],[2,0],[-1,-2],[2,1]],
};

const CLEAR_NAMES = ["", "SINGLE", "DOUBLE", "TRIPLE", "TETRIS"];
const ZONE_NAMES = ["", "SINGLE", "DOUBLE", "TRIPLE", "TETRIS", "PENTRIS",
  "HEXATRIS", "HEPTRIS", "OCTOTRIS", "ENNEATRIS", "DECATRIS", "HENDECATRIS",
  "DODECATRIS", "TRIADECATRIS", "TESSARATRIS", "PENTADECATRIS",
  "DECAHEXATRIS", "HEPTADECATRIS", "PERFECTRIS", "ENNEADECATRIS", "ULTIMATRIS"];

function rotateCW(m) {
  const n = m.length;
  const r = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++)
      r[y][x] = m[n - 1 - x][y];
  return r;
}
function rotateCCW(m) { return rotateCW(rotateCW(rotateCW(m))); }

class Tetris {
  // events: an object of optional callbacks the UI layer subscribes to.
  constructor(events = {}) {
    this.ev = events;
    this.reset();
  }

  reset() {
    this.grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    this.bag = [];
    this.queue = [];
    this.hold = null;
    this.canHold = true;
    this.cur = null;
    this.score = 0;
    this.lines = 0;
    this.level = 1;
    this.pieces = 0;
    this.combo = -1;
    this.b2b = false;
    this.over = false;
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.grounded = false;
    this.lastMoveWasRotation = false;
    this.lastKickIndex = 0;
    this.softDropping = false;
    this.gravityOverride = null; // zen mode pins the speed
    this.stats = { single: 0, double: 0, triple: 0, tetris: 0, tspin: 0, perfect: 0, maxCombo: 0, maxZone: 0 };
    // zone state
    this.meter = 0;          // 0..1
    this.zone = null;        // { time, total, lines } while active
    while (this.queue.length < 5) this.queue.push(this._draw());
    this._spawn();
  }

  _draw() {
    if (this.bag.length === 0) {
      this.bag = [...PIECE_ORDER];
      for (let i = this.bag.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
      }
    }
    return this.bag.pop();
  }

  _spawn(type = null) {
    const t = type || this.queue.shift();
    while (this.queue.length < 5) this.queue.push(this._draw());
    const m = PIECES[t].map(r => [...r]);
    this.cur = {
      type: t,
      m,
      rot: 0,
      x: Math.floor((COLS - m.length) / 2),
      y: t === "I" ? 0 : 0,
    };
    this.gravityAcc = 0;
    this.lockTimer = 0;
    this.lockResets = 0;
    this.grounded = false;
    this.lastMoveWasRotation = false;
    this.pieces++;
    if (this._collides(this.cur.m, this.cur.x, this.cur.y)) {
      if (this.ev.onTopOut) this.ev.onTopOut();
      else this.over = true;
    }
  }

  _collides(m, px, py) {
    for (let y = 0; y < m.length; y++) {
      for (let x = 0; x < m[y].length; x++) {
        if (!m[y][x]) continue;
        const gx = px + x, gy = py + y;
        if (gx < 0 || gx >= COLS || gy >= ROWS) return true;
        if (gy >= 0 && this.grid[gy][gx]) return true;
      }
    }
    return false;
  }

  _resetLock() {
    if (this.grounded && this.lockResets < 15) {
      this.lockTimer = 0;
      this.lockResets++;
    }
  }

  move(dx) {
    if (this.over || !this.cur) return false;
    if (!this._collides(this.cur.m, this.cur.x + dx, this.cur.y)) {
      this.cur.x += dx;
      this.lastMoveWasRotation = false;
      this._resetLock();
      return true;
    }
    return false;
  }

  rotate(dir) {
    if (this.over || !this.cur || this.cur.type === "O") return false;
    const from = this.cur.rot;
    const to = (from + (dir > 0 ? 1 : 3)) % 4;
    const m = dir > 0 ? rotateCW(this.cur.m) : rotateCCW(this.cur.m);
    const table = this.cur.type === "I" ? KICKS_I : KICKS_JLSTZ;
    const kicks = table[`${from}${to}`];
    for (let i = 0; i < kicks.length; i++) {
      const [kx, ky] = kicks[i];
      if (!this._collides(m, this.cur.x + kx, this.cur.y + ky)) {
        this.cur.m = m;
        this.cur.x += kx;
        this.cur.y += ky;
        this.cur.rot = to;
        this.lastMoveWasRotation = true;
        this.lastKickIndex = i;
        this._resetLock();
        return true;
      }
    }
    return false;
  }

  holdPiece() {
    if (this.over || !this.canHold || !this.cur) return false;
    const held = this.hold;
    this.hold = this.cur.type;
    this.canHold = false;
    this.pieces--; // spawn will re-count
    this._spawn(held || null);
    return true;
  }

  ghostY() {
    if (!this.cur) return 0;
    let y = this.cur.y;
    while (!this._collides(this.cur.m, this.cur.x, y + 1)) y++;
    return y;
  }

  hardDrop() {
    if (this.over || !this.cur) return;
    const dist = this.ghostY() - this.cur.y;
    this.cur.y += dist;
    this.score += dist * 2;
    if (dist > 0) this.lastMoveWasRotation = false;
    this._lock(dist);
  }

  gravityDelay() {
    if (this.zone) return Infinity; // time stands still inside the zone
    if (this.gravityOverride != null) return this.gravityOverride;
    const l = Math.min(this.level, 20);
    return Math.pow(0.8 - (l - 1) * 0.007, l - 1);
  }

  update(dt) {
    if (this.over || !this.cur) return;

    if (this.zone) {
      this.zone.time -= dt;
      if (this.zone.time <= 0) this._endZone();
    }

    // gravity
    let delay = this.gravityDelay();
    if (this.softDropping) delay = Math.min(delay / 20, 0.055);
    this.gravityAcc += dt;
    while (this.gravityAcc >= delay) {
      this.gravityAcc -= delay;
      if (!this._collides(this.cur.m, this.cur.x, this.cur.y + 1)) {
        this.cur.y++;
        this.lastMoveWasRotation = false;
        if (this.softDropping) {
          this.score += 1;
          if (this.ev.onSoftStep) this.ev.onSoftStep();
        }
      } else break;
    }

    // lock delay
    const onGround = this._collides(this.cur.m, this.cur.x, this.cur.y + 1);
    if (onGround) {
      if (!this.grounded) { this.grounded = true; this.lockTimer = 0; }
      this.lockTimer += dt;
      if (this.lockTimer >= 0.5) this._lock(0);
    } else {
      this.grounded = false;
    }
  }

  _tSpinCheck() {
    if (this.cur.type !== "T" || !this.lastMoveWasRotation) return { spin: false, mini: false };
    const cx = this.cur.x + 1, cy = this.cur.y + 1;
    const occ = (x, y) => x < 0 || x >= COLS || y >= ROWS || (y >= 0 && this.grid[y][x] !== 0);
    const corners = [occ(cx - 1, cy - 1), occ(cx + 1, cy - 1), occ(cx + 1, cy + 1), occ(cx - 1, cy + 1)];
    const filled = corners.filter(Boolean).length;
    if (filled < 3) return { spin: false, mini: false };
    // front corners = the two on the side the T points toward (rot 0=up,1=right,2=down,3=left)
    const frontIdx = [[0, 1], [1, 2], [2, 3], [3, 0]][this.cur.rot];
    const frontFilled = corners[frontIdx[0]] && corners[frontIdx[1]];
    const mini = !frontFilled && this.lastKickIndex < 4;
    return { spin: true, mini };
  }

  _lock(dropDist) {
    const { spin, mini } = this._tSpinCheck();
    const ci = PIECE_ORDER.indexOf(this.cur.type) + 1;
    let above = true;
    for (let y = 0; y < this.cur.m.length; y++) {
      for (let x = 0; x < this.cur.m[y].length; x++) {
        if (!this.cur.m[y][x]) continue;
        const gy = this.cur.y + y, gx = this.cur.x + x;
        if (gy >= 0) this.grid[gy][gx] = ci;
        if (gy >= HIDDEN_ROWS) above = false;
      }
    }
    if (this.ev.onLock) this.ev.onLock(this.cur, dropDist);

    if (above) { // locked entirely in hidden rows
      if (this.ev.onTopOut) this.ev.onTopOut(); else this.over = true;
      return;
    }

    this._clearLines(spin, mini);
    this.canHold = true;
    if (!this.over) this._spawn();
  }

  _fullRows() {
    const rows = [];
    for (let y = 0; y < ROWS; y++) {
      if (this.grid[y].every(v => v !== 0) && !this.grid[y].every(v => v === ZONE_CELL)) rows.push(y);
    }
    return rows;
  }

  _clearLines(spin, mini) {
    const rows = this._fullRows();
    const n = rows.length;

    if (n === 0) {
      if (spin) {
        // T-spin with no lines still scores and keeps the flow going
        const pts = (mini ? 100 : 400) * this.level;
        this.score += pts;
        if (this.ev.onTSpinNoLines) this.ev.onTSpinNoLines(mini, pts);
      }
      this.combo = -1;
      return;
    }

    if (this.zone) {
      // ZONE: rows sink to the bottom as frozen lines instead of vanishing
      this.grid = this.grid.filter((r, i) => !rows.includes(i));
      while (this.grid.length < ROWS) this.grid.push(new Array(COLS).fill(ZONE_CELL));
      this.zone.lines += n;
      this.zone.time = Math.min(this.zone.time + n * 0.6, this.zone.total); // clears buy a little time
      if (this.ev.onZoneLines) this.ev.onZoneLines(this.zone.lines, rows);
      // top out inside zone if frozen stack reaches the ceiling
      const frozen = this.grid.filter(r => r.every(v => v === ZONE_CELL)).length;
      if (frozen >= VISIBLE_ROWS - 2) this._endZone();
      return;
    }

    // normal clear — snapshot cell contents first so the FX layer can
    // shatter each cell in its own color
    const rowData = rows.map(y => [...this.grid[y]]);
    for (const y of rows) {
      this.grid.splice(y, 1);
      this.grid.unshift(new Array(COLS).fill(0));
    }

    this.combo++;
    this.stats.maxCombo = Math.max(this.stats.maxCombo, this.combo);
    const wasB2b = this.b2b;
    const hard = n === 4 || spin;
    this.b2b = hard;

    let base;
    if (spin) {
      base = mini ? [0, 200, 400, 0, 0][n] : [0, 800, 1200, 1600, 0][n];
      this.stats.tspin++;
    } else {
      base = [0, 100, 300, 500, 800][n];
    }
    let pts = base * this.level;
    const b2bActive = hard && wasB2b;
    if (b2bActive) pts = Math.floor(pts * 1.5);
    if (this.combo > 0) pts += 50 * this.combo * this.level;

    const perfect = this.grid.every(r => r.every(v => v === 0));
    if (perfect) { pts += 3000 * this.level; this.stats.perfect++; }

    this.score += pts;
    this.lines += n;
    if (n === 1) this.stats.single++;
    if (n === 2) this.stats.double++;
    if (n === 3) this.stats.triple++;
    if (n === 4) this.stats.tetris++;

    // zone meter gain
    let gain = n * 0.05;
    if (n === 4) gain += 0.05;
    if (spin) gain += 0.06;
    if (b2bActive) gain += 0.03;
    this.meter = Math.min(1, this.meter + gain);

    if (this.ev.onClear) this.ev.onClear({
      lines: n, rows, rowData, spin, mini, b2b: b2bActive,
      combo: this.combo, perfect, points: pts,
      name: spin ? `T-SPIN ${mini ? "MINI " : ""}${CLEAR_NAMES[n]}` : CLEAR_NAMES[n],
    });
  }

  // ---- ZONE ----
  zoneReady() { return this.meter >= 0.3 && !this.zone; }

  activateZone() {
    if (!this.zoneReady() || this.over) return false;
    const total = 4 + this.meter * 14; // 30% meter ≈ 8s, full ≈ 18s
    this.zone = { time: total, total, lines: 0 };
    this.meter = 0;
    if (this.ev.onZoneStart) this.ev.onZoneStart(total);
    return true;
  }

  _endZone() {
    const z = this.zone;
    this.zone = null;
    if (!z) return;
    // clear all frozen rows
    let cleared = 0;
    for (let y = ROWS - 1; y >= 0; y--) {
      if (this.grid[y].every(v => v === ZONE_CELL)) {
        this.grid.splice(y, 1);
        this.grid.unshift(new Array(COLS).fill(0));
        cleared++;
        y++; // recheck same index
      }
    }
    const pts = cleared * cleared * 100 * this.level;
    this.score += pts;
    this.lines += cleared;
    this.stats.maxZone = Math.max(this.stats.maxZone, cleared);
    const name = cleared > 0 ? (ZONE_NAMES[Math.min(cleared, 20)] || "ULTIMATRIS") : "";
    if (this.ev.onZoneEnd) this.ev.onZoneEnd({ lines: cleared, points: pts, name });
  }

  // Zen mode: gently wipe the board instead of dying
  zenWipe() {
    this.grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    this.combo = -1;
    this.b2b = false;
    this.zone = null;
    this.over = false;
    this._spawn();
  }
}
