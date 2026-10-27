// ============ AUTOPLAY ============
// Drives the bot in THEATER mode: each piece is planned with Bot, then
// played out as visible moves — a beat to "think", rotations and slides at
// a steady pace, then a hard drop — and the zone fires whenever the meter
// fills. Also runs the menu's attract loop: leave the menu idle and the
// theater starts on its own; any key or tap brings the menu back.

let autoPlan = null;   // { cur, p, turns, wait } for the piece being played
let attract = false;   // theater was started by idling on the menu
let lastInput = performance.now();

// seconds between moves: unhurried at first, quicker as the music builds
function botPace() { return [0.12, 0.085, 0.06][stagePhase] ?? 0.085; }

function updateAutoplay(dt) {
  if (mode !== "theater" || !game || !game.cur || game.over) return;
  if (game.meter >= 0.95 && !game.zone) game.activateZone();
  if (!autoPlan || autoPlan.cur !== game.cur) {
    const p = Bot.plan(game, "showy");
    autoPlan = { cur: game.cur, p, turns: p ? (p.rot === 3 ? -1 : p.rot) : 0, wait: 0.22 };
  }
  autoPlan.wait -= dt;
  if (autoPlan.wait > 0) return;
  autoPlan.wait = botPace();
  const { p } = autoPlan;
  if (!p) { doHardDrop(); return; }
  if (p.hold) {
    p.hold = false;
    if (game.holdPiece()) { AudioSys.hold(); return; } // a new piece: replanned next frame
  }
  if (autoPlan.turns !== 0) {
    const dir = Math.sign(autoPlan.turns);
    autoPlan.turns -= dir;
    if (game.rotate(dir)) AudioSys.rotate();
    return;
  }
  if (game.cur.x !== p.x && game.move(Math.sign(p.x - game.cur.x))) {
    AudioSys.move();
    return;
  }
  doHardDrop();
}

// ---------- attract loop ----------
$("attract").textContent = isTouch ? "TAP ANYWHERE TO PLAY" : "PRESS ANY KEY TO PLAY";

["keydown", "pointerdown", "pointermove", "wheel"].forEach(type => {
  window.addEventListener(type, e => {
    lastInput = performance.now();
    if (!attract || type === "pointermove" || type === "wheel") return;
    // the key or tap that ends the demo shouldn't also press a menu button
    e.preventDefault();
    e.stopImmediatePropagation();
    AudioSys.unlock();
    toMenu();
  }, { capture: true, passive: false });
});

function checkAttract() {
  if (state !== "menu" || $("menu").classList.contains("hidden")) return;
  if (performance.now() - lastInput < EFFECT_MODES.theater.attractAfter * 1000) return;
  attract = true;
  startGame("theater");
}
