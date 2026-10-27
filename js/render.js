// ============ RENDERING ============
// Draws the board, falling piece, ghost, previews and HUD each frame.
// Cells come from cached sprites; DOM writes only happen on change.

function roundRect(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

// Cells are pre-rendered once per (color, size, glow) into small sprites:
// gradients and shadowBlur are far too slow to redo for 200 cells a frame.
const spriteCache = new Map();
function cellSprite(color, size, glow, pat) {
  const g = glow > 0 ? Math.min(24, Math.max(3, Math.round(glow / 3) * 3)) : 0;
  const key = `${color}|${size}|${g}|${pat}`;
  let spr = spriteCache.get(key);
  if (spr) return spr;
  if (spriteCache.size > 400) spriteCache.clear();
  const pad = g ? g + 2 : 0;
  const full = size + pad * 2;
  const cv = document.createElement("canvas");
  cv.width = cv.height = Math.ceil(full * DPR);
  const c = cv.getContext("2d");
  c.scale(DPR, DPR);
  if (g) { c.shadowColor = color; c.shadowBlur = g; }
  const inset = 1.5, x = pad, y = pad;
  roundRect(c, x + inset, y + inset, size - inset * 2, size - inset * 2, 4);
  const grad = c.createLinearGradient(x, y, x, y + size);
  grad.addColorStop(0, color);
  grad.addColorStop(1, shade(color, -0.35));
  c.fillStyle = grad;
  c.fill();
  c.shadowBlur = 0;
  // inner highlight
  c.globalAlpha = 0.35;
  roundRect(c, x + inset + 2, y + inset + 2, size - inset * 2 - 4, (size - inset * 2) * 0.35, 3);
  c.fillStyle = "#ffffff";
  c.fill();
  if (pat >= 0) drawGlyph(c, pat, x + size / 2, y + size / 2, size);
  spr = { cv, pad, full };
  spriteCache.set(key, spr);
  return spr;
}

// Block patterns: a distinct glyph per piece type so pieces can be told
// apart without relying on color. Dark (purify) cells always carry an X.
function drawGlyph(c, pat, cx, cy, size) {
  const r = size * 0.17;
  c.globalAlpha = 0.6;
  c.strokeStyle = c.fillStyle = pat === 7 ? "#d9c8ff" : "rgba(10,14,30,.85)";
  c.lineWidth = Math.max(1.5, size * 0.07);
  c.lineCap = "round";
  c.beginPath();
  switch (pat) {
    case 0: c.moveTo(cx - r, cy); c.lineTo(cx + r, cy); c.stroke(); break;                // I: bar
    case 1: c.strokeRect(cx - r * 0.8, cy - r * 0.8, r * 1.6, r * 1.6); break;           // O: square
    case 2: c.moveTo(cx, cy - r); c.lineTo(cx + r, cy + r * 0.8); c.lineTo(cx - r, cy + r * 0.8); c.closePath(); c.fill(); break; // T: triangle
    case 3: c.moveTo(cx - r, cy + r); c.lineTo(cx + r, cy - r); c.stroke(); break;       // S: /
    case 4: c.moveTo(cx - r, cy - r); c.lineTo(cx + r, cy + r); c.stroke(); break;       // Z: \
    case 5: c.arc(cx, cy, r * 0.6, 0, Math.PI * 2); c.fill(); break;                     // J: dot
    case 6: c.arc(cx, cy, r * 0.85, 0, Math.PI * 2); c.stroke(); break;                  // L: ring
    case 7: c.moveTo(cx - r, cy - r); c.lineTo(cx + r, cy + r); c.moveTo(cx + r, cy - r); c.lineTo(cx - r, cy + r); c.stroke(); break; // dark: X
  }
  c.globalAlpha = 1;
}

// which glyph a cell value gets (-1 = none)
function patOf(v) {
  if (v === DARK_CELL) return 7;
  return settings.patterns && v >= 1 && v <= 7 ? v - 1 : -1;
}

function drawCell(c, x, y, size, color, alpha = 1, glow = 0, pat = -1) {
  const spr = cellSprite(color, size, glow, pat);
  c.globalAlpha = alpha;
  c.drawImage(spr.cv, x - spr.pad, y - spr.pad, spr.full, spr.full);
  c.globalAlpha = 1;
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.max(0, Math.min(255, Math.round(r * (1 + k))));
  g = Math.max(0, Math.min(255, Math.round(g * (1 + k))));
  b = Math.max(0, Math.min(255, Math.round(b * (1 + k))));
  return `rgb(${r},${g},${b})`;
}

function pieceColor(v) {
  const th = Background.theme;
  if (v === ZONE_CELL) return "#e8ecff";
  if (v === DARK_CELL) return "#4d3d6b";
  return th.pieceColors[v - 1] || "#888888";
}

function drawMatrixOn(c, m, type, cw, ox, oy, color) {
  const pat = patOf(PIECE_ORDER.indexOf(type) + 1);
  for (let y = 0; y < m.length; y++)
    for (let x = 0; x < m[y].length; x++)
      if (m[y][x]) drawCell(c, ox + x * cw, oy + y * cw, cw, color, 1, 6, pat);
}

const previewKeys = new Map();
function drawPreview(c, canvas, types) {
  const th = Background.theme;
  // the queue only changes on spawn/hold, so skip identical redraws
  const blind = canvas === nextCanvas && effectOn("blind");
  const key = `${types.join()}|${th.id}|${canvas.width}|${settings.patterns}|${blind}`;
  if (previewKeys.get(canvas) === key) return;
  previewKeys.set(canvas, key);
  c.clearRect(0, 0, canvas.width, canvas.height);
  const horiz = canvas.width > canvas.height; // portrait phones lay the queue out sideways
  if (blind) {
    // BLINDFOLD: the queue is hidden behind question marks
    c.fillStyle = "rgba(220,230,255,.35)";
    c.font = "bold 22px system-ui, sans-serif";
    c.textAlign = "center"; c.textBaseline = "middle";
    for (let i = 0; i < 5; i++) {
      c.fillText("?", horiz ? i * 62 + 31 : canvas.width / 2, horiz ? canvas.height / 2 : i * 62 + 33);
    }
    return;
  }
  types.forEach((t, i) => {
    if (!t) return;
    const m = PIECES[t];
    const cw = horiz ? 14 : 20;
    const w = m[0].length * cw, h = m.length * cw;
    const slotH = (54 - (t === "I" ? cw * 2 : h)) / 2;
    const ox = horiz ? i * 62 + (62 - w) / 2 : (canvas.width - w) / 2;
    const oy = horiz ? (canvas.height - h) / 2 : i * 62 + slotH + 6;
    const color = th.pieceColors[PIECE_ORDER.indexOf(t)];
    drawMatrixOn(c, m, t, cw, ox, oy, color);
  });
}

function accentRgba(alpha) {
  const hex = Background.theme.accent;
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function render() {
  const th = Background.theme;
  // beat envelope: 1 right on the beat, decaying across it
  const beat = AudioSys.getBeat();
  const be = beat.active ? Math.pow(Math.max(0, 1 - beat.phase), 2.5) : 0;
  const zt = game && game.zone ? Math.min(1, game.zone.lines / 16) : 0;
  // shake
  const sx = (Math.random() - 0.5) * fx.shake;
  const sy = (Math.random() - 0.5) * fx.shake;
  bctx.save();
  bctx.clearRect(0, 0, BW, BH);
  bctx.translate(sx, sy);

  // subtle grid, breathing with the music
  bctx.strokeStyle = `rgba(140,180,255,${0.04 + zoneVis * 0.05 + be * 0.05})`;
  bctx.lineWidth = 1;
  for (let x = 1; x < COLS; x++) {
    bctx.beginPath(); bctx.moveTo(x * CELL, 0); bctx.lineTo(x * CELL, BH); bctx.stroke();
  }
  for (let y = 1; y < VISIBLE_ROWS; y++) {
    bctx.beginPath(); bctx.moveTo(0, y * CELL); bctx.lineTo(BW, y * CELL); bctx.stroke();
  }

  if (!game) { bctx.restore(); return; }

  // locked cells; under FOG only a lantern around the falling piece shows them
  const fog = effectOn("fog") && game.cur;
  const fcx = fog ? game.cur.x + game.cur.m.length / 2 : 0, fcy = fog ? game.cur.y + game.cur.m.length / 2 : 0;
  for (let y = HIDDEN_ROWS; y < ROWS; y++) {
    for (let x = 0; x < COLS; x++) {
      const v = game.grid[y][x];
      if (!v) continue;
      const py = (y - HIDDEN_ROWS) * CELL;
      const lit = fog ? Math.max(0.05, Math.min(1, 1 - (Math.hypot(x + 0.5 - fcx, y + 0.5 - fcy) - 2.5) / 2.5)) : 1;
      if (v === ZONE_CELL) {
        // frozen rows shimmer faster and glow hotter as tension builds
        const shimmer = 0.75 + 0.25 * Math.sin(performance.now() / (200 - zt * 130) + y);
        drawCell(bctx, x * CELL, py, CELL, "#dfe8ff", shimmer * lit, 10 + zt * 14);
      } else {
        drawCell(bctx, x * CELL, py, CELL, pieceColor(v), lit, zoneVis > 0.3 ? 2 : 0, patOf(v));
      }
    }
  }

  if (game.cur && !game.over && state !== "over") {
    const color = th.pieceColors[PIECE_ORDER.indexOf(game.cur.type)];
    const curPat = patOf(PIECE_ORDER.indexOf(game.cur.type) + 1);
    // ghost
    const gy = game.ghostY();
    if (settings.ghost)
    for (let y = 0; y < game.cur.m.length; y++)
      for (let x = 0; x < game.cur.m[y].length; x++)
        if (game.cur.m[y][x]) {
          const py = (gy + y - HIDDEN_ROWS) * CELL;
          if (py >= -CELL) {
            bctx.globalAlpha = 0.22;
            roundRect(bctx, (game.cur.x + x) * CELL + 2, py + 2, CELL - 4, CELL - 4, 4);
            bctx.strokeStyle = color;
            bctx.lineWidth = 2;
            bctx.stroke();
            bctx.globalAlpha = 1;
          }
        }
    // active piece
    for (let y = 0; y < game.cur.m.length; y++)
      for (let x = 0; x < game.cur.m[y].length; x++)
        if (game.cur.m[y][x]) {
          const py = (game.cur.y + y - HIDDEN_ROWS) * CELL;
          if (py >= -CELL) drawCell(bctx, (game.cur.x + x) * CELL, py, CELL, color, 1, 9 + be * 9, curPat);
        }
  }

  // row clear flashes
  for (const f of flashRows) {
    if (f.t < 0) continue;
    const k = 1 - f.t / 0.35;
    if (k <= 0) continue;
    bctx.globalAlpha = k * (settings.reduceMotion ? 0.2 : 0.6); // soft flash — the shatter carries the moment
    bctx.fillStyle = "#ffffff";
    bctx.fillRect(0, f.y, BW, CELL);
    bctx.globalAlpha = 1;
  }

  fx.draw(bctx);

  // accent glow rising from the floor of the well, swelling on each beat
  if (beat.active) {
    const gl = bctx.createLinearGradient(0, BH - 90, 0, BH);
    gl.addColorStop(0, accentRgba(0));
    gl.addColorStop(1, accentRgba(0.05 + be * 0.10));
    bctx.fillStyle = gl;
    bctx.fillRect(0, BH - 90, BW, 90);
  }

  // zone vignette
  if (zoneVis > 0.01) {
    const g = bctx.createRadialGradient(BW / 2, BH / 2, BH * 0.3, BW / 2, BH / 2, BH * 0.75);
    g.addColorStop(0, "rgba(120,150,255,0)");
    g.addColorStop(1, `rgba(120,150,255,${zoneVis * (0.18 + zt * 0.3)})`);
    bctx.fillStyle = g;
    bctx.fillRect(0, 0, BW, BH);
  }

  bctx.restore();

  // outer halo of the well swells on the beat; near the top, its rim
  // throbs red with the heartbeat. Both are opacity-only layers, so the
  // browser can animate them without repainting the well.
  const d = (dangerVis - 0.3) / 0.7;
  const calm = settings.reduceMotion; // no pulsing light: a soft halo, a steady rim
  setStyle("beathalo", "opacity", (be * (calm ? 0.25 : 0.9)).toFixed(2));
  setStyle("dangerrim", "opacity", d > 0 && !game.zone ? (0.35 + d * 0.65 * (calm ? 0.7 : 0.4 + be * 0.6)).toFixed(2) : "0");

  // side panels
  drawPreview(hctx, holdCanvas, [game.hold]);
  drawPreview(nctx, nextCanvas, game.queue.slice(0, 5));

  // HUD — DOM writes only when a value actually changes
  setText("score", game.score.toLocaleString());
  setText("level", game.level);
  setText("lines", game.lines);
  setText("time", fmtTime(elapsed));
  if (mode === "journey") setText("goal", `${game.lines} / ${curNode().goal}`);
  else if (mode === "classic") setText("goal", game.level >= 15 ? "MAX" : `${10 - (game.lines % 10)} lines`);
  else if (mode === "sprint") setText("goal", `${Math.max(0, 40 - game.lines)} lines`);
  else if (mode === "ultra" || mode === "daily") setText("goal", fmtTime(Math.max(0, EFFECT_MODES[mode].timeLimit - elapsed + 0.999)));
  else if (mode === "purify") setText("goal", `${game.purified} / ${EFFECT_MODES.purify.target}`);
  else if (mode === "theater") setText("goal", `${EFFECT_MODES.theater.linesPerMap - game.lines % EFFECT_MODES.theater.linesPerMap} lines`);
  else if (mode === "mystery") setText("goal", ms.active ? ms.active.ev.name : `${Math.ceil(EFFECT_MODES.mystery.every - ms.eventT)}s`);
  else setText("goal", "∞");

  // zone meter (a transform, not a height, so it never triggers layout)
  const fill = game.zone ? game.zone.time / game.zone.total : game.meter;
  setStyle("zonefill", "transform", `scaleY(${Math.max(0, Math.min(1, fill)).toFixed(3)})`);
  const ready = game.zoneReady();
  if (ready !== lastZoneReady) { lastZoneReady = ready; $("zonemeter").classList.toggle("ready", ready); }
}

const domCache = {};
let lastZoneReady = null;
function setText(id, v) {
  v = String(v);
  if (domCache[id] === v) return;
  domCache[id] = v;
  $(id).textContent = v;
}
function setStyle(id, prop, v) {
  const k = id + "." + prop;
  if (domCache[k] === v) return;
  domCache[k] = v;
  $(id).style[prop] = v;
}

function stackTop() {
  for (let y = 0; y < ROWS; y++) if (game.grid[y].some(v => v !== 0)) return y;
  return ROWS;
}
