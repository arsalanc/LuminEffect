// ============ GAME FLOW ============
// A run from start to finish: engine event handling (clears, zone,
// top-out), per-mode rules and progression, the effect-mode runtime
// (rising garbage, mystery events), starting a run, game over, and
// returning to the menu.

// ---------- engine events ----------
function makeGame(seed = null) {
  const g = new Tetris({
    onLock(cur, dropDist) {
      AudioSys.lock();
      const cells = [];
      cur.m.forEach((row, y) => row.forEach((v, x) => {
        if (v && cur.y + y >= HIDDEN_ROWS) cells.push([cur.x + x, cur.y + y - HIDDEN_ROWS]);
      }));
      fx.lockFlash(cells, CELL);
      if (dropDist > 0) {
        // hard drop: a streak of light down each column the piece fell through
        const color = pieceColor(PIECE_ORDER.indexOf(cur.type) + 1);
        const span = {};
        cells.forEach(([x, y]) => {
          const c = span[x] || (span[x] = [y, y]);
          c[0] = Math.min(c[0], y); c[1] = Math.max(c[1], y);
        });
        for (const x in span) {
          const [top, bot] = span[x];
          fx.trail(+x * CELL, Math.max(0, top - dropDist) * CELL, (bot + 1) * CELL, CELL, color);
        }
      }
    },
    onClear(info) {
      AudioSys.clear(info.lines, Math.max(0, info.combo)); // combos climb the scale
      buzz(info.perfect || info.lines >= 4 ? [25, 40, 45] : 12 + info.lines * 8);
      if (info.spin) AudioSys.tspin();
      if (info.b2b) AudioSys.b2b();
      if (info.perfect) AudioSys.perfect();
      Background.beat(0.25 + info.lines * 0.15);
      shake(info.lines * 2 + (info.lines === 4 ? 4 : 0));
      // the cleared rows' colors erupt out of the well into the world
      const midRow = info.rows.reduce((a, r) => a + r, 0) / info.rows.length - HIDDEN_ROWS;
      const burstCols = [...new Set(info.rowData.flat().filter(v => v).map(pieceColor))];
      Background.burst(0.2 + info.lines * 0.2 + (info.spin ? 0.25 : 0) + (info.perfect ? 0.8 : 0),
        burstCols, boardPoint(BW / 2, (midRow + 0.5) * CELL));
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
    onTSpinNoLines(mini) {
      announce(mini ? "T-SPIN MINI" : "T-SPIN"); AudioSys.tspin();
      Background.burst(0.15, [pieceColor(PIECE_ORDER.indexOf("T") + 1)], boardPoint(BW / 2, BH / 2));
    },
    onZoneStart(total) {
      AudioSys.zoneStart();
      AudioSys.setZoneTempo(true); // time dilates: the groove drops to half speed
      $("boardwrap").classList.add("zone-active");
      if (!settings.reduceMotion) {
        $("zoneflash").classList.remove("flash"); void $("zoneflash").offsetWidth;
        $("zoneflash").classList.add("flash");
      }
      announce("THE ZONE", "time stands still");
      buzz([20, 60, 40]);
      Background.burst(0.5, ["#ffffff", Background.theme.accent], boardPoint(BW / 2, BH / 2));
    },
    onZoneLines(count) {
      Background.beat(0.4 + Math.min(0.6, count * 0.04));
      AudioSys.zoneLine(count); // pitch climbs with every banked line
      buzz(10);
      shake(1 + Math.min(6, count * 0.4));
      // sparks freeze mid-air inside the zone, then fly when it ends
      Background.burst(0.15, ["#dfe8ff", Background.theme.accent], boardPoint(BW / 2, BH - count * CELL));
    },
    onZoneEnd(res) {
      AudioSys.setZoneTempo(false);
      $("boardwrap").classList.remove("zone-active");
      if (res.lines > 0) {
        AudioSys.zoneEnd(res.lines);
        buzz([40, 50, 70, 50, 100]);
        shake(4 + res.lines);
        Background.beat(1);
        Background.burst(Math.min(2, 0.8 + res.lines / 10),
          ["#ffffff", Background.theme.accent, ...Background.theme.pieceColors.slice(0, 3)],
          boardPoint(BW / 2, BH - (res.lines / 2) * CELL));
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
        shake(6);
        buzz([40, 60, 40]);
        g.zenWipe();
      } else {
        gameOver(false);
      }
    },
  }, { seed });
  return g;
}

// ---------- modes ----------
function currentTheme() {
  if (mode === "journey") return themeById(curNode().theme);
  // classic tours every map across its 15 levels
  if (mode === "classic") return THEMES[Math.min(THEMES.length - 1, Math.floor((game.level - 1) * THEMES.length / 15))];
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
    const node = curNode();
    if (game.lines >= node.goal) { gameOver(true); return; } // stage cleared
    // mid-stage phase shifts: calm → build → climax within one map
    const prog = game.lines / node.goal;
    const newPhase = prog >= 0.75 ? 2 : prog >= 0.4 ? 1 : 0;
    if (newPhase > stagePhase) {
      stagePhase = newPhase;
      game.level = node.level + stagePhase; // speed climbs with the music
      AudioSys.setPhase(stagePhase);
      AudioSys.phaseShift();
      Background.beat(0.6);
    }
  } else if (mode === "sprint") {
    if (game.lines >= 40) { gameOver(true); return; }
  } else if (mode === "classic") {
    if (game.lines >= 150) { gameOver(true); return; }
    levelUpEvery10();
  } else if (mode === "purify") {
    if (game.purified >= EFFECT_MODES.purify.target) { gameOver(true); return; }
    // speed creeps up as the dark is cleansed
    const lvl = 2 + Math.floor(game.purified / 15);
    if (lvl > game.level) { game.level = lvl; AudioSys.levelUp(); announce(`LEVEL ${lvl}`); }
  } else if (mode === "ultra" || mode === "mystery" || mode === "daily") {
    levelUpEvery10();
  }
}

function levelUpEvery10() {
  const newLevel = Math.min(15, Math.floor(game.lines / 10) + 1);
  if (newLevel > game.level) {
    game.level = newLevel;
    AudioSys.levelUp();
    announce(`LEVEL ${newLevel}`);
    applyTheme();
  }
}

// ---------- effect modes ----------
const isEffectMode = m => m in EFFECT_MODES;
const hasRising = () => mode === "purify" || (mode === "daily" && ms.daily.twist === "rising");
const hasMystery = () => mode === "mystery" || (mode === "daily" && ms.daily.twist === "mystery");

// timers, rising garbage and mystery events; runs every frame of play
function updateMode(dt) {
  if (!ms || !game || game.over) return;
  const def = EFFECT_MODES[mode];
  if (def && def.timeLimit && elapsed >= def.timeLimit) { gameOver(true); return; }
  if (game.zone) return; // time stands still in the zone — the rules do too
  if (hasRising()) {
    ms.garbageT += dt;
    const every = mode === "purify" ? purifyInterval(game.purified) : 7;
    if (ms.garbageT >= every) {
      ms.garbageT = 0;
      game.addGarbage(1);
      AudioSys.lock();
      shake(1.5);
    }
  }
  if (hasMystery()) {
    if (ms.active) {
      ms.active.left -= dt;
      if (ms.active.left <= 0) endMysteryEffect();
    }
    ms.eventT += dt;
    if (ms.eventT >= EFFECT_MODES.mystery.every) { ms.eventT = 0; triggerMystery(); }
  }
}

function triggerMystery() {
  // never the same twice running, and never a second timed curse on top of one
  const pool = MYSTERY_EVENTS.filter(e => e.id !== ms.lastId && !(ms.active && e.kind === "timed"));
  if (!pool.length) return;
  const ev = pool[Math.floor(ms.rng() * pool.length)];
  ms.lastId = ev.id;
  announce(ev.name, ev.sub, ev.good === true ? "good" : ev.good === false ? "bad" : "");
  AudioSys.phaseShift();
  Background.burst(0.5, [ev.good === false ? "#ff5f7a" : ev.good ? "#7dffb0" : "#c9a6ff"], boardPoint(BW / 2, BH / 2));
  buzz([20, 40, 20]);
  switch (ev.id) {
    case "flip": boardCanvas.classList.add("flipped"); break;
    case "rush": game.gravityScale = 3; break;
    case "surge": game.addGarbage(2); break;
    case "irain": game.queue.splice(0, 4, "I", "I", "I", "I"); break;
    case "cleanse": game.removeBottomRows(3); break;
    case "charge": game.meter = 1; break;
    case "shift": {
      const others = THEMES.filter(t => t !== zenTheme);
      zenTheme = others[Math.floor(ms.rng() * others.length)];
      applyTheme();
      break;
    }
  }
  if (ev.kind === "timed") ms.active = { ev, left: ev.dur };
}

function endMysteryEffect() {
  if (!ms || !ms.active) return;
  const id = ms.active.ev.id;
  ms.active = null;
  if (id === "flip") boardCanvas.classList.remove("flipped");
  if (id === "rush" && game) game.gravityScale = 1;
}
const effectOn = id => !!(ms && ms.active && ms.active.ev.id === id);

function startGame(m, themeChoice = null, nodeIndex = 0) {
  endMysteryEffect();
  boardCanvas.classList.remove("flipped");
  mode = m;
  jIndex = nodeIndex;
  elapsed = 0;
  zoneVis = 0;
  intensityVis = 0;
  AudioSys.setIntensity(0);
  Background.setIntensity(0);
  flashRows = [];
  fx = new BoardFX();
  const daily = m === "daily" ? dailyInfo() : null;
  game = makeGame(daily ? daily.seed : null);
  game.softDropFactor = settings.sdf;
  ms = isEffectMode(m) ? {
    garbageT: 0, eventT: 0, active: null, lastId: null, daily,
    rng: daily ? seededRandom(daily.seed + 1) : Math.random,
  } : null;
  if (isEffectMode(m)) {
    zenTheme = daily ? daily.theme : THEMES[Math.floor(Math.random() * THEMES.length)];
    game.level = m === "purify" ? 2 : 1;
    if (hasRising()) game.addGarbage(m === "purify" ? 4 : 2); // start with some dark to dig into
  }
  if (m === "zen") {
    zenTheme = themeChoice || THEMES[0];
    game.level = settings.zenSpeed; // player-chosen speed, fixed for the run
  }
  if (m === "sprint") {
    zenTheme = THEMES[Math.floor(Math.random() * THEMES.length)]; // random map each run
    game.level = 3; // brisk fixed gravity — the race is about your hands
  }
  if (m === "journey") game.level = curNode().level;
  stagePhase = 0;

  $("modename").textContent = m === "journey" ? curNode().name
    : daily ? `DAILY · ${DAILY_TWISTS[daily.twist].name}` : m.toUpperCase();
  $("goal-label").textContent = {
    journey: "GOAL", classic: "NEXT LVL", sprint: "LEFT", zen: "FLOW",
    ultra: "TIME LEFT", daily: "TIME LEFT", purify: "PURIFIED", mystery: "NEXT EVENT",
  }[m];
  const th = m === "journey" ? themeById(curNode().theme) : m === "classic" ? THEMES[0] : zenTheme;
  Background.setTheme(th);
  AudioSys.setTheme(th);
  AudioSys.setPhase(m === "journey" ? 0 : 1); // journey opens calm
  $("mapname").textContent = th.name;

  $("menu").classList.add("hidden");
  $("mapselect").classList.add("hidden");
  $("journeymap").classList.add("hidden");
  $("results").classList.add("hidden");
  $("pause").classList.add("hidden");
  $("game").classList.remove("hidden");
  $("boardwrap").classList.remove("zone-active");
  if (isTouch) $("touchbar").classList.remove("hidden");
  fitLayout();
  if (m === "journey") showStageCard(curNode().name, curNode().sub);
  else if (daily) showStageCard("DAILY " + daily.key, `${th.name.toLowerCase()} · ${DAILY_TWISTS[daily.twist].sub}`);
  else if (isEffectMode(m)) showStageCard(EFFECT_MODES[m].name, EFFECT_MODES[m].sub);
  else showStageCard(th.name, th.sub);
  state = "playing";
}

function gameOver(victory) {
  state = "over";
  endMysteryEffect();
  LifetimeStats.record(mode, game, elapsed, { finished: victory, timed: TIMED_MODES.has(mode) });
  AudioSys.gameOver();
  buzz(victory ? [20, 40, 20, 40, 60] : [80, 80, 160]);
  AudioSys.stopMusic();
  $("boardwrap").classList.remove("zone-active");
  // sprint records finish time (only on completion); other modes record score
  let isNewBest = false, dailyRes = null;
  if (TIMED_MODES.has(mode)) {
    if (victory) isNewBest = store.save(mode, Math.round(elapsed * 100) / 100);
  } else if (mode === "daily") {
    dailyRes = DailyRecord.submit(ms.daily.key, game.score);
    isNewBest = dailyRes.newToday;
  } else if (mode !== "journey") {
    isNewBest = store.save(mode, game.score);
  }

  // journey: bank the node, award stars, and offer the next stage
  let stars = 0, journeyDone = false;
  if (mode === "journey") {
    const node = curNode();
    stars = JourneyProgress.starsFor(node, game.score, !victory);
    if (victory) {
      isNewBest = JourneyProgress.record(node, {
        score: game.score, stars, time: Math.round(elapsed * 100) / 100,
      });
      journeyDone = jIndex >= JOURNEY_NODES.length - 1;
    }
    $("result-stars").innerHTML = [1, 2, 3]
      .map(i => `<span class="${i <= stars ? "" : "dimstar"}">★</span>`).join("");
    $("result-stars").classList.remove("hidden");
    $("nextstage").classList.toggle("hidden", !victory || journeyDone);
    $("tojmap").classList.remove("hidden");
    $("retry").textContent = "RETRY STAGE";
  } else {
    $("result-stars").classList.add("hidden");
    $("nextstage").classList.add("hidden");
    $("tojmap").classList.add("hidden");
    $("retry").textContent = "PLAY AGAIN";
  }

  $("result-title").textContent = victory
    ? (mode === "journey"
        ? (journeyDone ? "JOURNEY COMPLETE" : "STAGE CLEAR")
        : mode === "sprint" ? "SPRINT COMPLETE"
        : mode === "purify" ? "PURIFIED"
        : mode === "ultra" || mode === "daily" ? "TIME UP" : "YOU WIN")
    : "GAME OVER";
  const timed = TIMED_MODES.has(mode);
  const rows = [
    ["SCORE", game.score.toLocaleString() + (!timed && isNewBest ? " ★ NEW BEST" : "")],
    ["LINES", game.lines],
    ["LEVEL", game.level],
    ["TIME", fmtTime(elapsed) + (timed && isNewBest ? " ★ NEW BEST" : "")],
    ["MAX COMBO", game.stats.maxCombo],
    ["TETRISES", game.stats.tetris],
    ["T-SPINS", game.stats.tspin],
    ["BEST ZONE", game.stats.maxZone + " lines"],
  ];
  if (mode === "purify") rows.splice(1, 0, ["PURIFIED", `${game.purified} / ${EFFECT_MODES.purify.target}`]);
  if (dailyRes) rows.splice(1, 0, ["TODAY'S BEST", dailyRes.today.toLocaleString()], ["DAY STREAK", dailyRes.streak]);
  $("result-stats").innerHTML = rows.map(([k, v]) =>
    `<div class="rrow"><span class="dim">${k}</span><b>${v}</b></div>`).join("");
  $("results").classList.remove("hidden");
}

function toMenu() {
  state = "menu";
  endMysteryEffect();
  hideStageCard();
  AudioSys.stopMusic();
  intensityVis = 0;
  AudioSys.setIntensity(0);
  Background.setIntensity(0);
  Background.setZone(0);
  $("game").classList.add("hidden");
  $("results").classList.add("hidden");
  $("pause").classList.add("hidden");
  $("mapselect").classList.add("hidden");
  $("journeymap").classList.add("hidden");
  $("touchbar").classList.add("hidden");
  $("menu").classList.remove("hidden");
  refreshHiscores();
  ensureMenuMusic(); // old pad fades out as the menu track fades in
}
