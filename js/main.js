// ============ MAIN ============
// The frame loop, audio unlock handling, responsive layout, and boot.

// ---------- main loop ----------
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  watchFrames((now - last) / 1000);
  let dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  Background.frame(dt);

  if (state === "playing") {
    elapsed += dt;
    handleDAS(dt);
    game.update(dt);
    updateMode(dt);
    updateAutoplay(dt);
  } else if (state === "transition") {
    transitionTimer -= dt;
    handleDAS(dt);
    game.update(dt); // keep playing through the card
    updateAutoplay(dt);
    if (transitionTimer <= 0) state = "playing";
    elapsed += dt;
  }

  // eased zone tint — slow ~0.5s entry: the world desaturates and
  // background time winds down to a backward drift
  const zoneTarget = game && game.zone ? 1 : 0;
  zoneVis += (zoneTarget - zoneVis) * Math.min(1, dt * 2.5);
  Background.setZone(zoneVis);

  // zone tension: banked lines wind the frozen world (and its music) back up
  const zTension = game && game.zone ? Math.min(1, game.zone.lines / 16) : 0;
  AudioSys.setZoneTension(zTension);
  Background.setZoneTension(zTension);

  // sounds sit where the piece is: left wall pans left, right wall right
  if (game && game.cur) AudioSys.setPan(((game.cur.x + game.cur.m[0].length / 2) / COLS) * 2 - 1);

  // speed-reactive intensity: stack height + level drive music & light
  if (game && state !== "menu" && state !== "mapselect" && state !== "journeymap") {
    const stackDanger = Math.max(0, ((ROWS - stackTop()) - 8) / 10); // kicks in at 8 rows high
    const levelHeat = ((game.level - 1) / 14) * 0.55;
    const target = Math.min(1, Math.max(stackDanger, levelHeat));
    intensityVis += (target - intensityVis) * Math.min(1, dt * 1.5);
    AudioSys.setIntensity(intensityVis);
    Background.setIntensity(intensityVis);
  }
  // danger is the stack alone, and only while you can still do something about it
  const live = game && (state === "playing" || state === "transition");
  const dTarget = live ? Math.min(1, Math.max(0, ((ROWS - stackTop()) - 8) / 10)) : 0;
  dangerVis += (dTarget - dangerVis) * Math.min(1, dt * (dTarget > dangerVis ? 1.2 : 3));
  AudioSys.setDanger(dangerVis);
  Background.setDanger(dangerVis);

  for (const f of flashRows) f.t += dt;
  flashRows = flashRows.filter(f => f.t < 0.4);
  fx.update(dt);

  if (state !== "menu" && state !== "mapselect" && state !== "journeymap") render();
  checkAttract();
}
requestAnimationFrame(loop);

// ---------- audio unlock safety net ----------
// Browsers only allow audio after a user gesture, and mobile ones re-suspend
// the context on tab switch / screen lock. Rather than relying on specific
// handlers, treat every gesture (and returning to the tab) as a resume cue.
// Menu music can only start once a gesture has unlocked audio, so every
// unlock cue also doubles as a "start the menu track if it should be
// playing" check.
function ensureMenuMusic() {
  if ((state === "menu" || state === "mapselect") && AudioSys.playingThemeId() !== "menu") {
    AudioSys.setTheme(MENU_THEME);
  }
}
["pointerdown", "touchend", "keydown", "click"].forEach(ev =>
  window.addEventListener(ev, () => { AudioSys.unlock(); ensureMenuMusic(); }, { capture: true, passive: true }));
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) { AudioSys.unlock(); ensureMenuMusic(); }
});

// ---------- responsive layout ----------
function fitLayout() {
  const portrait = isTouch && window.innerHeight > window.innerWidth;
  document.body.classList.toggle("portrait", portrait);
  // portrait lays the next-queue out horizontally above the board
  const wantW = portrait ? 320 : 120, wantH = portrait ? 64 : 330;
  if (nextCanvas.width !== wantW) { nextCanvas.width = wantW; nextCanvas.height = wantH; }
  const pa = $("playarea");
  if (!pa.offsetWidth) return; // hidden (menu screens)
  const reserve = isTouch ? 96 : 24; // leave room for the touch bar
  const s = Math.min(1.1,
    (window.innerWidth - 12) / pa.offsetWidth,
    (window.innerHeight - reserve) / pa.offsetHeight);
  pa.style.transform = `scale(${s})`;
}
window.addEventListener("resize", () => {
  fitLayout();
  // the map layout transposes between orientations, so redraw it
  if (state === "journeymap") renderJourneyMap();
});

// menu background: idle drift on the first theme
Background.setTheme(THEMES[Math.floor(Math.random() * THEMES.length)]);
fitLayout(); // establishes body.portrait before any menu is drawn
applyMotion();
refreshHelp();
refreshHiscores();
