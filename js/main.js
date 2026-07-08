// ============ GAME ORCHESTRATION ============
// Wires the engine, audio and FX together: modes (journey / classic / zen),
// input with DAS/ARR, board rendering, HUD, announcements and menus.

(() => {
  const $ = id => document.getElementById(id);
  const boardCanvas = $("board"), bctx = boardCanvas.getContext("2d");
  const holdCanvas = $("hold"), hctx = holdCanvas.getContext("2d");
  const nextCanvas = $("next"), nctx = nextCanvas.getContext("2d");

  const CELL = 30;
  const BW = COLS * CELL, BH = VISIBLE_ROWS * CELL;
  const DPR = Math.min(window.devicePixelRatio || 1, 2);
  boardCanvas.width = BW * DPR; boardCanvas.height = BH * DPR;
  boardCanvas.style.width = BW + "px"; boardCanvas.style.height = BH + "px";
  bctx.scale(DPR, DPR);

  // ---------- state ----------
  let game = null;
  let fx = new BoardFX();
  let state = "menu"; // menu | mapselect | playing | paused | over | transition
  let mode = null;    // journey | classic | zen
  let elapsed = 0;
  let zoneVis = 0;    // eased 0..1 for zone tint
  let intensityVis = 0; // eased 0..1 danger/level intensity
  let flashRows = []; // {y, t} white flash on cleared rows
  let stage = 0;      // journey stage index
  let transitionTimer = 0;

  const JOURNEY_GOALS = [10, 12, 14, 16, 18];
  const JOURNEY_LEVELS = [1, 3, 5, 7, 9];

  // ---------- persistence ----------
  const store = {
    get scores() { try { return JSON.parse(localStorage.getItem("lumineffect") || "{}"); } catch (e) { return {}; } },
    save(m, value) {
      const s = this.scores;
      // sprint records a time — lower is better; everything else is a score
      const better = m === "sprint" ? (!s[m] || value < s[m]) : (!s[m] || value > s[m]);
      if (better) { s[m] = value; localStorage.setItem("lumineffect", JSON.stringify(s)); }
      return better;
    },
  };

  // ---------- settings ----------
  const SETTINGS_DEFAULTS = { das: 150, arr: 33, volume: 70, ghost: true, zenSpeed: 1 };
  const settings = Object.assign(
    {}, SETTINGS_DEFAULTS,
    (() => { try { return JSON.parse(localStorage.getItem("lumineffect-settings") || "{}"); } catch (e) { return {}; } })()
  );
  function saveSettings() { localStorage.setItem("lumineffect-settings", JSON.stringify(settings)); }
  AudioSys.setVolume(settings.volume / 100);

  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // ---------- announcements ----------
  let announceTimer = null;
  function announce(text, sub = "") {
    const el = $("announce");
    el.innerHTML = text + (sub ? `<span class="sub">${sub}</span>` : "");
    el.classList.remove("show");
    void el.offsetWidth; // restart animation
    el.classList.add("show");
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => el.classList.remove("show"), 1300);
  }

  function showStageCard(name, sub) {
    const card = $("stagecard");
    $("stagecard-name").textContent = name;
    $("stagecard-sub").textContent = sub;
    card.classList.remove("hidden", "show");
    void card.offsetWidth;
    card.classList.add("show");
    setTimeout(() => card.classList.add("hidden"), 3000);
  }

  // ---------- engine events ----------
  function makeGame() {
    const g = new Tetris({
      onLock() { AudioSys.lock(); },
      onClear(info) {
        AudioSys.clear(info.lines);
        if (info.spin) AudioSys.tspin();
        if (info.b2b) AudioSys.b2b();
        if (info.perfect) AudioSys.perfect();
        Background.beat(0.25 + info.lines * 0.15);
        fx.addShake(info.lines * 2 + (info.lines === 4 ? 4 : 0));
        // shatter choreography: each cell breaks loose in its own color,
        // rippling outward from the center of the row
        info.rows.forEach((r, i) => {
          const y = (r - HIDDEN_ROWS) * CELL;
          flashRows.push({ y, t: 0 });
          const cells = info.rowData[i];
          for (let x = 0; x < COLS; x++) {
            const delay = (Math.abs(x - (COLS - 1) / 2) / ((COLS - 1) / 2)) * 0.12 + i * 0.03;
            fx.shatterCell((x + 0.5) * CELL, y + CELL / 2, CELL - 4, pieceColor(cells[x]), delay);
          }
        });
        let sub = [];
        if (info.b2b) sub.push("BACK-TO-BACK");
        if (info.combo > 0) sub.push(`${info.combo} COMBO`);
        if (info.perfect) { announce("PERFECT CLEAR", sub.join(" · ")); }
        else announce(info.name, sub.join(" · "));
        onLinesChanged();
      },
      onTSpinNoLines(mini) { announce(mini ? "T-SPIN MINI" : "T-SPIN"); AudioSys.tspin(); },
      onZoneStart(total) {
        AudioSys.zoneStart();
        AudioSys.setZoneTempo(true); // time dilates: the groove drops to half speed
        $("boardwrap").classList.add("zone-active");
        $("zoneflash").classList.remove("flash"); void $("zoneflash").offsetWidth;
        $("zoneflash").classList.add("flash");
        announce("THE ZONE", "time stands still");
      },
      onZoneLines(count) {
        Background.beat(0.5);
        AudioSys.clear(Math.min(count, 4));
      },
      onZoneEnd(res) {
        AudioSys.setZoneTempo(false);
        $("boardwrap").classList.remove("zone-active");
        if (res.lines > 0) {
          AudioSys.zoneEnd(res.lines);
          fx.addShake(4 + res.lines);
          Background.beat(1);
          announce(res.name, `${res.lines} LINES · +${res.points.toLocaleString()}`);
          for (let i = 0; i < res.lines; i++) {
            const y = BH - (i + 1) * CELL;
            flashRows.push({ y, t: -i * 0.04 });
            fx.burstRow(y, BW, CELL, "#ffffff", 0.7);
          }
        }
        onLinesChanged();
      },
      onTopOut() {
        if (mode === "zen") {
          announce("REBUILD", "the board is yours again");
          Background.beat(0.8);
          fx.addShake(6);
          g.zenWipe();
        } else {
          gameOver(false);
        }
      },
    });
    return g;
  }

  // ---------- modes ----------
  function currentTheme() {
    if (mode === "journey") return THEMES[stage % THEMES.length];
    if (mode === "classic") return THEMES[Math.floor((game.level - 1) / 3) % THEMES.length];
    return zenTheme;
  }
  let zenTheme = THEMES[0];

  function applyTheme() {
    const th = currentTheme();
    if (Background.theme !== th) {
      Background.setTheme(th);
      AudioSys.setTheme(th);
      $("mapname").textContent = th.name;
    }
  }

  function onLinesChanged() {
    if (!game) return;
    if (mode === "journey") {
      const goal = JOURNEY_GOALS[stage];
      if (game.lines >= goal) {
        stage++;
        if (stage >= THEMES.length) { gameOver(true); return; }
        game.lines = 0;
        game.level = JOURNEY_LEVELS[stage];
        state = "transition";
        transitionTimer = 2.6;
        const th = THEMES[stage];
        showStageCard(th.name, th.sub);
        applyTheme();
        AudioSys.levelUp();
      }
    } else if (mode === "sprint") {
      if (game.lines >= 40) { gameOver(true); return; }
    } else if (mode === "classic") {
      if (game.lines >= 150) { gameOver(true); return; }
      const newLevel = Math.min(15, Math.floor(game.lines / 10) + 1);
      if (newLevel > game.level) {
        game.level = newLevel;
        AudioSys.levelUp();
        announce(`LEVEL ${newLevel}`);
        applyTheme();
      }
    }
  }

  function startGame(m, themeChoice = null) {
    mode = m;
    stage = 0;
    elapsed = 0;
    zoneVis = 0;
    intensityVis = 0;
    AudioSys.setIntensity(0);
    Background.setIntensity(0);
    flashRows = [];
    fx = new BoardFX();
    game = makeGame();
    if (m === "zen") {
      zenTheme = themeChoice || THEMES[0];
      game.level = settings.zenSpeed; // player-chosen speed, fixed for the run
    }
    if (m === "sprint") {
      zenTheme = THEMES[Math.floor(Math.random() * THEMES.length)]; // random map each run
      game.level = 3; // brisk fixed gravity — the race is about your hands
    }
    if (m === "journey") game.level = JOURNEY_LEVELS[0];

    $("modename").textContent = m.toUpperCase();
    $("goal-label").textContent = m === "journey" ? "GOAL" : m === "classic" ? "NEXT LVL" : m === "sprint" ? "LEFT" : "FLOW";
    const th = (m === "zen" || m === "sprint") ? zenTheme : THEMES[0];
    Background.setTheme(th);
    AudioSys.setTheme(th);
    $("mapname").textContent = th.name;

    $("menu").classList.add("hidden");
    $("mapselect").classList.add("hidden");
    $("results").classList.add("hidden");
    $("pause").classList.add("hidden");
    $("game").classList.remove("hidden");
    $("boardwrap").classList.remove("zone-active");
    if (isTouch) $("touchbar").classList.remove("hidden");
    fitLayout();
    showStageCard(th.name, th.sub);
    state = "playing";
  }

  function gameOver(victory) {
    state = "over";
    AudioSys.gameOver();
    AudioSys.stopMusic();
    $("boardwrap").classList.remove("zone-active");
    // sprint records finish time (only on completion); other modes record score
    let isNewBest = false;
    if (mode === "sprint") {
      if (victory) isNewBest = store.save("sprint", Math.round(elapsed * 100) / 100);
    } else {
      isNewBest = store.save(mode, game.score);
    }
    $("result-title").textContent = victory
      ? (mode === "journey" ? "JOURNEY COMPLETE" : mode === "sprint" ? "SPRINT COMPLETE" : "YOU WIN")
      : "GAME OVER";
    const rows = [
      ["SCORE", game.score.toLocaleString() + (mode !== "sprint" && isNewBest ? " ★ NEW BEST" : "")],
      ["LINES", game.lines],
      ["LEVEL", game.level],
      ["TIME", fmtTime(elapsed) + (mode === "sprint" && isNewBest ? " ★ NEW BEST" : "")],
      ["MAX COMBO", game.stats.maxCombo],
      ["TETRISES", game.stats.tetris],
      ["T-SPINS", game.stats.tspin],
      ["BEST ZONE", game.stats.maxZone + " lines"],
    ];
    $("result-stats").innerHTML = rows.map(([k, v]) =>
      `<div class="rrow"><span class="dim">${k}</span><b>${v}</b></div>`).join("");
    $("results").classList.remove("hidden");
  }

  function toMenu() {
    state = "menu";
    AudioSys.stopMusic();
    intensityVis = 0;
    AudioSys.setIntensity(0);
    Background.setIntensity(0);
    Background.setZone(0);
    $("game").classList.add("hidden");
    $("results").classList.add("hidden");
    $("pause").classList.add("hidden");
    $("mapselect").classList.add("hidden");
    $("touchbar").classList.add("hidden");
    $("menu").classList.remove("hidden");
    refreshHiscores();
  }

  function refreshHiscores() {
    const s = store.scores;
    const parts = ["journey", "classic", "sprint", "zen"]
      .filter(m => s[m])
      .map(m => m === "sprint" ? `SPRINT ${fmtTime(s[m])}` : `${m.toUpperCase()} ${s[m].toLocaleString()}`);
    $("hiscore").textContent = parts.length ? "BEST — " + parts.join("   ·   ") : "";
  }

  // ---------- input ----------
  function doHardDrop() {
    const gx = (game.cur.x + 1.5) * CELL;
    const gy = Math.min(BH - 4, (game.ghostY() - HIDDEN_ROWS + 1) * CELL);
    game.hardDrop(); AudioSys.hardDrop(); fx.addShake(3);
    fx.burstAt(gx, Math.max(4, gy), Background.theme.accent, 8, 100);
  }

  const keys = {};
  let dasTimer = 0, arrTimer = 0, dasDir = 0;

  window.addEventListener("keydown", e => {
    if (e.repeat) return;
    AudioSys.unlock();
    const k = e.key;

    if (state === "playing" || state === "transition") {
      if (k === "ArrowLeft" || k === "ArrowRight") {
        const dir = k === "ArrowLeft" ? -1 : 1;
        dasDir = dir; dasTimer = 0; arrTimer = 0;
        if (game.move(dir)) AudioSys.move();
        keys[k] = true;
        e.preventDefault();
      } else if (k === "ArrowDown") {
        game.softDropping = true; keys[k] = true; e.preventDefault();
      } else if (k === " ") {
        doHardDrop();
        e.preventDefault();
      } else if (k === "ArrowUp" || k.toLowerCase() === "x") {
        if (game.rotate(1)) AudioSys.rotate(); e.preventDefault();
      } else if (k.toLowerCase() === "z") {
        if (game.rotate(-1)) AudioSys.rotate(); e.preventDefault();
      } else if (k.toLowerCase() === "c") {
        if (game.holdPiece()) AudioSys.hold(); e.preventDefault();
      } else if (k === "Shift" || k === "Enter") {
        if (game.activateZone()) e.preventDefault();
      } else if (k.toLowerCase() === "p" || k === "Escape") {
        state = "paused"; $("pause").classList.remove("hidden");
      }
    } else if (state === "paused" && (k.toLowerCase() === "p" || k === "Escape")) {
      state = "playing"; $("pause").classList.add("hidden");
    }
  });

  window.addEventListener("keyup", e => {
    keys[e.key] = false;
    if (e.key === "ArrowDown" && game) game.softDropping = false;
    if ((e.key === "ArrowLeft" && dasDir === -1) || (e.key === "ArrowRight" && dasDir === 1)) dasDir = 0;
  });

  function handleDAS(dt) {
    if (!dasDir) return;
    const held = dasDir === -1 ? keys["ArrowLeft"] : keys["ArrowRight"];
    if (!held) { dasDir = 0; return; }
    const das = settings.das / 1000, arr = settings.arr / 1000;
    dasTimer += dt;
    if (dasTimer < das) return;
    if (arr <= 0) {
      // instant: slam to the wall
      let moved = false;
      for (let i = 0; i < COLS && game.move(dasDir); i++) moved = true;
      if (moved) AudioSys.move();
    } else {
      arrTimer += dt;
      while (arrTimer >= arr) {
        arrTimer -= arr;
        if (game.move(dasDir)) AudioSys.move();
      }
    }
  }

  // ---------- rendering ----------
  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawCell(c, x, y, size, color, alpha = 1, glow = 0) {
    c.globalAlpha = alpha;
    if (glow > 0) { c.shadowColor = color; c.shadowBlur = glow; }
    const pad = 1.5;
    roundRect(c, x + pad, y + pad, size - pad * 2, size - pad * 2, 4);
    const g = c.createLinearGradient(x, y, x, y + size);
    g.addColorStop(0, color);
    g.addColorStop(1, shade(color, -0.35));
    c.fillStyle = g;
    c.fill();
    // inner highlight
    c.globalAlpha = alpha * 0.35;
    roundRect(c, x + pad + 2, y + pad + 2, size - pad * 2 - 4, (size - pad * 2) * 0.35, 3);
    c.fillStyle = "#ffffff";
    c.fill();
    c.globalAlpha = 1;
    c.shadowBlur = 0;
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
    return th.pieceColors[v - 1] || "#888";
  }

  function drawMatrixOn(c, m, type, cw, ox, oy, color) {
    for (let y = 0; y < m.length; y++)
      for (let x = 0; x < m[y].length; x++)
        if (m[y][x]) drawCell(c, ox + x * cw, oy + y * cw, cw, color, 1, 6);
  }

  function drawPreview(c, canvas, types) {
    c.clearRect(0, 0, canvas.width, canvas.height);
    const th = Background.theme;
    const horiz = canvas.width > canvas.height; // portrait phones lay the queue out sideways
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

    // locked cells
    for (let y = HIDDEN_ROWS; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const v = game.grid[y][x];
        if (!v) continue;
        const py = (y - HIDDEN_ROWS) * CELL;
        if (v === ZONE_CELL) {
          const shimmer = 0.75 + 0.25 * Math.sin(performance.now() / 200 + y);
          drawCell(bctx, x * CELL, py, CELL, "#dfe8ff", shimmer, 10);
        } else {
          drawCell(bctx, x * CELL, py, CELL, pieceColor(v), 1, zoneVis > 0.3 ? 2 : 0);
        }
      }
    }

    if (game.cur && !game.over && state !== "over") {
      const color = th.pieceColors[PIECE_ORDER.indexOf(game.cur.type)];
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
            if (py >= -CELL) drawCell(bctx, (game.cur.x + x) * CELL, py, CELL, color, 1, 9 + be * 9);
          }
    }

    // row clear flashes
    for (const f of flashRows) {
      if (f.t < 0) continue;
      const k = 1 - f.t / 0.35;
      if (k <= 0) continue;
      bctx.globalAlpha = k * 0.6; // soft flash — the shatter carries the moment
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
      g.addColorStop(1, `rgba(120,150,255,${zoneVis * 0.18})`);
      bctx.fillStyle = g;
      bctx.fillRect(0, 0, BW, BH);
    }

    bctx.restore();

    // outer halo of the well swells on the beat
    $("boardwrap").style.setProperty("--beatpx", (be * 22).toFixed(1) + "px");

    // side panels
    drawPreview(hctx, holdCanvas, [game.hold]);
    drawPreview(nctx, nextCanvas, game.queue.slice(0, 5));

    // HUD
    $("score").textContent = game.score.toLocaleString();
    $("level").textContent = game.level;
    $("lines").textContent = game.lines;
    $("time").textContent = fmtTime(elapsed);
    if (mode === "journey") $("goal").textContent = `${game.lines} / ${JOURNEY_GOALS[Math.min(stage, JOURNEY_GOALS.length - 1)]}`;
    else if (mode === "classic") $("goal").textContent = game.level >= 15 ? "MAX" : `${10 - (game.lines % 10)} lines`;
    else if (mode === "sprint") $("goal").textContent = `${Math.max(0, 40 - game.lines)} lines`;
    else $("goal").textContent = "∞";

    // zone meter
    const fill = game.zone
      ? (game.zone.time / game.zone.total) * 100
      : game.meter * 100;
    $("zonefill").style.height = fill + "%";
    $("zonemeter").classList.toggle("ready", game.zoneReady());
  }

  // ---------- main loop ----------
  let last = performance.now();
  function loop(now) {
    requestAnimationFrame(loop);
    let dt = Math.min((now - last) / 1000, 0.05);
    last = now;

    Background.frame(dt);

    if (state === "playing") {
      elapsed += dt;
      handleDAS(dt);
      game.update(dt);
    } else if (state === "transition") {
      transitionTimer -= dt;
      handleDAS(dt);
      game.update(dt); // keep playing through the card
      if (transitionTimer <= 0) state = "playing";
      elapsed += dt;
    }

    // eased zone tint — slow ~0.5s entry: the world desaturates and
    // background time winds down to a backward drift
    const zoneTarget = game && game.zone ? 1 : 0;
    zoneVis += (zoneTarget - zoneVis) * Math.min(1, dt * 2.5);
    Background.setZone(zoneVis);

    // speed-reactive intensity: stack height + level drive music & light
    if (game && state !== "menu" && state !== "mapselect") {
      let top = ROWS;
      for (let y = 0; y < ROWS; y++) {
        if (game.grid[y].some(v => v !== 0)) { top = y; break; }
      }
      const stackDanger = Math.max(0, ((ROWS - top) - 8) / 10); // kicks in at 8 rows high
      const levelHeat = ((game.level - 1) / 14) * 0.55;
      const target = Math.min(1, Math.max(stackDanger, levelHeat));
      intensityVis += (target - intensityVis) * Math.min(1, dt * 1.5);
      AudioSys.setIntensity(intensityVis);
      Background.setIntensity(intensityVis);
    }

    for (const f of flashRows) f.t += dt;
    flashRows = flashRows.filter(f => f.t < 0.4);
    fx.update(dt);

    if (state !== "menu" && state !== "mapselect") render();
  }
  requestAnimationFrame(loop);

  // ---------- responsive layout ----------
  const isTouch = matchMedia("(pointer: coarse)").matches;
  if (isTouch) document.body.classList.add("touch");

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
  window.addEventListener("resize", fitLayout);

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
        while (e.clientX - tp.lx >= cp) { if (game.move(1)) AudioSys.move(); tp.lx += cp; }
        while (tp.lx - e.clientX >= cp) { if (game.move(-1)) AudioSys.move(); tp.lx -= cp; }
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
  }

  // ---------- menu wiring ----------
  document.querySelectorAll("#menu .mbtn[data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      AudioSys.unlock();
      const m = btn.dataset.mode;
      if (m === "zen") {
        $("menu").classList.add("hidden");
        $("mapselect").classList.remove("hidden");
        state = "mapselect";
      } else {
        startGame(m);
      }
    });
  });

  // build zen map cards
  const mapList = $("maplist");
  THEMES.forEach(th => {
    const b = document.createElement("button");
    b.className = "mapcard";
    b.style.background = `linear-gradient(160deg, ${th.bgTop}, ${th.bgBottom})`;
    b.style.borderColor = th.accent + "66";
    b.innerHTML = `<span class="mc-name" style="color:${th.accent}">${th.name}</span><span class="mc-sub">${th.sub}</span>`;
    b.addEventListener("click", () => { AudioSys.unlock(); startGame("zen", th); });
    mapList.appendChild(b);
  });
  $("mapback").addEventListener("click", () => { $("mapselect").classList.add("hidden"); $("menu").classList.remove("hidden"); state = "menu"; });

  // zen speed picker
  const speedBtns = $("speedbtns");
  [1, 2, 3, 4, 5, 6, 8, 10, 12, 15].forEach(lvl => {
    const b = document.createElement("button");
    b.className = "chip" + (lvl === settings.zenSpeed ? " sel" : "");
    b.textContent = lvl;
    b.addEventListener("click", () => {
      settings.zenSpeed = lvl;
      saveSettings();
      speedBtns.querySelectorAll(".chip").forEach(c => c.classList.toggle("sel", +c.textContent === lvl));
    });
    speedBtns.appendChild(b);
  });

  // settings panel — each control registers a sync so the whole UI can be
  // refreshed from the settings object (used by RESET DEFAULTS)
  const settingSyncs = [];
  function bindSlider(id, valId, key, fmt, onChange) {
    const el = $(id), val = $(valId);
    const sync = () => { el.value = settings[key]; val.textContent = fmt(settings[key]); };
    sync();
    settingSyncs.push(sync);
    el.addEventListener("input", () => {
      settings[key] = +el.value;
      val.textContent = fmt(settings[key]);
      saveSettings();
      if (onChange) onChange(settings[key]);
    });
  }
  bindSlider("set-das", "das-val", "das", v => v + " ms");
  bindSlider("set-arr", "arr-val", "arr", v => v === 0 ? "instant" : v + " ms");
  bindSlider("set-vol", "vol-val", "volume", v => v + "%", v => { AudioSys.unlock(); AudioSys.setVolume(v / 100); });
  $("set-ghost").checked = settings.ghost;
  settingSyncs.push(() => { $("set-ghost").checked = settings.ghost; });
  $("set-ghost").addEventListener("change", () => { settings.ghost = $("set-ghost").checked; saveSettings(); });
  // keep the zen speed chips in sync too
  settingSyncs.push(() => {
    speedBtns.querySelectorAll(".chip").forEach(c => c.classList.toggle("sel", +c.textContent === settings.zenSpeed));
  });
  $("setreset").addEventListener("click", () => {
    Object.assign(settings, SETTINGS_DEFAULTS);
    saveSettings();
    settingSyncs.forEach(fn => fn());
    AudioSys.setVolume(settings.volume / 100);
  });
  $("opensettings").addEventListener("click", () => { $("menu").classList.add("hidden"); $("settings").classList.remove("hidden"); });
  $("setback").addEventListener("click", () => { $("settings").classList.add("hidden"); $("menu").classList.remove("hidden"); });

  $("resume").addEventListener("click", () => { state = "playing"; $("pause").classList.add("hidden"); });
  $("quit").addEventListener("click", toMenu);
  $("retry").addEventListener("click", () => startGame(mode, mode === "zen" ? zenTheme : null));
  $("tomenu").addEventListener("click", toMenu);

  // menu background: idle drift on the first theme
  Background.setTheme(THEMES[Math.floor(Math.random() * THEMES.length)]);
  refreshHiscores();
})();
