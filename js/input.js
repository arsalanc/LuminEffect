// ============ INPUT ============
// Keyboard (rebindable actions with DAS/ARR auto-repeat) and touch
// gestures + button bar. Every horizontal move goes through tryMove so
// mystery MIRROR can flip it.

function doHardDrop() {
  const gx = (game.cur.x + 1.5) * CELL;
  const gy = Math.min(BH - 4, (game.ghostY() - HIDDEN_ROWS + 1) * CELL);
  game.hardDrop(); AudioSys.hardDrop(); shake(3); buzz(9);
  fx.burstAt(gx, Math.max(4, gy), Background.theme.accent, 8, 100);
}

// every horizontal move goes through here so MIRROR can flip it
function tryMove(dir) {
  return game.move(effectOn("mirror") ? -dir : dir);
}

const held = {}; // action → currently held
let dasTimer = 0, arrTimer = 0, dasDir = 0;

window.addEventListener("keydown", e => {
  if (rebinding) return; // the controls screen is capturing this key
  if (e.repeat) return;
  AudioSys.unlock();
  const action = keyLookup[normKey(e.key)];
  if (!action) return;

  if (state === "playing" || state === "transition") {
    e.preventDefault();
    held[action] = true;
    switch (action) {
      case "left": case "right": {
        const dir = action === "left" ? -1 : 1;
        dasDir = dir; dasTimer = 0; arrTimer = 0;
        if (tryMove(dir)) AudioSys.move();
        break;
      }
      case "soft": game.softDropping = true; break;
      case "hard": doHardDrop(); break;
      case "cw": if (game.rotate(1)) AudioSys.rotate(); break;
      case "ccw": if (game.rotate(-1)) AudioSys.rotate(); break;
      case "hold": if (game.holdPiece()) AudioSys.hold(); break;
      case "zone": game.activateZone(); break;
      case "pause": state = "paused"; $("pause").classList.remove("hidden"); break;
    }
  } else if (state === "paused" && action === "pause") {
    state = "playing"; $("pause").classList.add("hidden");
  }
});

window.addEventListener("keyup", e => {
  const action = keyLookup[normKey(e.key)];
  if (!action) return;
  held[action] = false;
  if (action === "soft" && game) game.softDropping = false;
  if ((action === "left" && dasDir === -1) || (action === "right" && dasDir === 1)) dasDir = 0;
});

function handleDAS(dt) {
  if (!dasDir) return;
  const isHeld = dasDir === -1 ? held.left : held.right;
  if (!isHeld) { dasDir = 0; return; }
  const das = settings.das / 1000, arr = settings.arr / 1000;
  dasTimer += dt;
  if (dasTimer < das) return;
  if (arr <= 0) {
    // instant: slam to the wall
    let moved = false;
    for (let i = 0; i < COLS && tryMove(dasDir); i++) moved = true;
    if (moved) AudioSys.move();
  } else {
    arrTimer += dt;
    while (arrTimer >= arr) {
      arrTimer -= arr;
      if (tryMove(dasDir)) AudioSys.move();
    }
  }
}

// ---------- touch controls ----------
// drag horizontally = move (one column per cell-width), drag down = soft
// drop, fast downward flick = hard drop, tap = rotate (left half CCW).
if (isTouch) {
  let tp = null; // active gesture
  const cellPx = () => boardCanvas.getBoundingClientRect().width / COLS;

  $("game").addEventListener("pointerdown", e => {
    AudioSys.unlock();
    if (state !== "playing" && state !== "transition") return;
    tp = {
      id: e.pointerId,
      x0: e.clientX, y0: e.clientY,
      lx: e.clientX, ly: e.clientY,
      t0: performance.now(),
      mode: null,
      hist: [[performance.now(), e.clientY]],
    };
  });

  window.addEventListener("pointermove", e => {
    if (!tp || e.pointerId !== tp.id || !game) return;
    const cp = cellPx();
    const dx = e.clientX - tp.x0, dy = e.clientY - tp.y0;
    if (!tp.mode) {
      if (Math.abs(dx) > cp * 0.55 && Math.abs(dx) > Math.abs(dy)) { tp.mode = "h"; tp.lx = tp.x0; }
      else if (dy > cp * 0.55 && dy > Math.abs(dx)) { tp.mode = "v"; tp.ly = tp.y0; }
    }
    if (tp.mode === "h") {
      while (e.clientX - tp.lx >= cp) { if (tryMove(1)) AudioSys.move(); tp.lx += cp; }
      while (tp.lx - e.clientX >= cp) { if (tryMove(-1)) AudioSys.move(); tp.lx -= cp; }
    } else if (tp.mode === "v") {
      while (e.clientY - tp.ly >= cp) { game.softStep(); tp.ly += cp; }
    }
    tp.hist.push([performance.now(), e.clientY]);
    if (tp.hist.length > 6) tp.hist.shift();
  });

  window.addEventListener("pointerup", e => {
    if (!tp || e.pointerId !== tp.id) { return; }
    const g = tp; tp = null;
    if (!game || (state !== "playing" && state !== "transition")) return;
    const dt = performance.now() - g.t0;
    const dx = e.clientX - g.x0, dy = e.clientY - g.y0;
    if (g.mode === "v") {
      // downward flick = hard drop
      const [ot, oy] = g.hist[0];
      const vel = (e.clientY - oy) / Math.max(1, performance.now() - ot) * 1000;
      if (vel > 800 && dy > 24) doHardDrop();
    } else if (!g.mode && dt < 300 && Math.abs(dx) < 9 && Math.abs(dy) < 9) {
      // tap = rotate; left half of the board rotates the other way
      const rect = boardCanvas.getBoundingClientRect();
      const ccw = e.clientX < rect.left + rect.width / 2;
      if (game.rotate(ccw ? -1 : 1)) AudioSys.rotate();
    }
  });
  window.addEventListener("pointercancel", () => { tp = null; });
  $("game").addEventListener("contextmenu", e => e.preventDefault());

  // button bar
  function tbtn(id, fn) {
    $(id).addEventListener("pointerdown", e => {
      e.preventDefault(); e.stopPropagation();
      AudioSys.unlock();
      if (state === "playing" || state === "transition") fn();
    });
  }
  tbtn("tb-hold", () => { if (game.holdPiece()) AudioSys.hold(); });
  tbtn("tb-ccw", () => { if (game.rotate(-1)) AudioSys.rotate(); });
  tbtn("tb-cw", () => { if (game.rotate(1)) AudioSys.rotate(); });
  tbtn("tb-zone", () => game.activateZone());
  tbtn("tb-pause", () => { state = "paused"; $("pause").classList.remove("hidden"); });

  // touch-appropriate hint text
  $("zonehint").textContent = "ZONE BUTTON";
  document.querySelector("#menu .help").textContent =
    "drag to move · tap to rotate · drag down to soft drop · flick down to hard drop";
  $("opencontrols").classList.add("hidden"); // no keyboard to rebind
}
