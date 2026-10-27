// ============ GAME ORCHESTRATION ============
// Wires the engine, audio and FX together: modes (journey / classic /
// sprint / zen and the effect modes), rebindable input with DAS/ARR, board
// rendering, HUD, announcements, menus, stats and accessibility options.

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
  let mode = null;    // journey | classic | sprint | zen | ultra | purify | mystery | daily
  let elapsed = 0;
  let zoneVis = 0;    // eased 0..1 for zone tint
  let intensityVis = 0; // eased 0..1 danger/level intensity
  let dangerVis = 0;    // eased 0..1 stack height alone — drives the heartbeat
  let flashRows = []; // {y, t} white flash on cleared rows
  let jIndex = 0;     // index into JOURNEY_NODES for the stage being played
  let stagePhase = 0; // journey mid-stage phase: 0 calm, 1 build, 2 climax
  let transitionTimer = 0;
  // effect-mode state: garbage timer, mystery event timer + active effect
  let ms = null;      // { garbageT, eventT, active: { ev, left } | null, rng, lastId, daily }

  const curNode = () => JOURNEY_NODES[jIndex];

  const TIMED_MODES = new Set(["sprint", "purify"]);

  // ---------- persistence ----------
  const store = {
    get scores() { try { return JSON.parse(localStorage.getItem("lumineffect") || "{}"); } catch (e) { return {}; } },
    save(m, value) {
      const s = this.scores;
      // sprint and purify record a time — lower is better; everything else is a score
      const better = TIMED_MODES.has(m) ? (!s[m] || value < s[m]) : (!s[m] || value > s[m]);
      if (better) { s[m] = value; localStorage.setItem("lumineffect", JSON.stringify(s)); }
      return better;
    },
  };

  // ---------- settings ----------
  const prefersCalm = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const SETTINGS_DEFAULTS = {
    das: 150, arr: 33, sdf: 20, volume: 70, ghost: true, quantize: true, vibrate: true, fx: "auto",
    patterns: false, reduceMotion: prefersCalm, zenSpeed: 1,
  };
  const settings = Object.assign(
    {}, SETTINGS_DEFAULTS,
    (() => { try { return JSON.parse(localStorage.getItem("lumineffect-settings") || "{}"); } catch (e) { return {}; } })()
  );
  function saveSettings() { localStorage.setItem("lumineffect-settings", JSON.stringify(settings)); }
  AudioSys.setVolume(settings.volume / 100);
  AudioSys.setQuantize(settings.quantize);
  let keyBinds = Controls.load();
  let keyLookup = Controls.lookup(keyBinds);

  // reduced motion: no shake, no full-screen flashes, a calmer world
  function shake(v) { if (!settings.reduceMotion) fx.addShake(v); }
  function applyMotion() {
    document.body.classList.toggle("reduce-motion", settings.reduceMotion);
    Background.setCalm(settings.reduceMotion);
  }

  // haptics: phones feel the drops, clears and zone (no-op where unsupported)
  function buzz(pattern) {
    if (!settings.vibrate || !isTouch || !navigator.vibrate) return;
    try { navigator.vibrate(pattern); } catch (e) {}
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${m}:${s.toString().padStart(2, "0")}`;
  }

  // ---------- announcements ----------
  let announceTimer = null;
  function announce(text, sub = "", tone = "") {
    const el = $("announce");
    el.innerHTML = text + (sub ? `<span class="sub">${sub}</span>` : "");
    el.className = tone; // "good" / "bad" tint for mystery events
    el.classList.remove("show");
    void el.offsetWidth; // restart animation
    el.classList.add("show");
    clearTimeout(announceTimer);
    announceTimer = setTimeout(() => el.classList.remove("show"), 1300);
  }

  let stageCardTimer = null;
  function showStageCard(name, sub) {
    const card = $("stagecard");
    $("stagecard-name").textContent = name;
    $("stagecard-sub").textContent = sub;
    card.classList.remove("hidden", "show");
    void card.offsetWidth;
    card.classList.add("show");
    clearTimeout(stageCardTimer);
    stageCardTimer = setTimeout(hideStageCard, 3000);
  }
  // also called on leaving a run early, so the card never lingers over menus
  function hideStageCard() {
    clearTimeout(stageCardTimer);
    $("stagecard").classList.add("hidden");
  }

  // board-space pixel → screen pixel, so world FX can erupt from the well
  function boardPoint(px, py) {
    const r = boardCanvas.getBoundingClientRect();
    return { x: r.left + (px / BW) * r.width, y: r.top + (py / BH) * r.height };
  }

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

  // ---------- journey map ----------
  let jSelected = -1;

  function showJourneyMap() {
    state = "journeymap";
    jSelected = -1;
    endMysteryEffect();
    hideStageCard();
    AudioSys.stopMusic();
    Background.setIntensity(0);
    Background.setZone(0);
    intensityVis = 0;
    AudioSys.setIntensity(0);
    $("game").classList.add("hidden");
    $("results").classList.add("hidden");
    $("pause").classList.add("hidden");
    $("menu").classList.add("hidden");
    $("touchbar").classList.add("hidden");
    $("journeymap").classList.remove("hidden");
    renderJourneyMap();
    ensureMenuMusic();
  }

  function renderJourneyMap() {
    const portrait = document.body.classList.contains("portrait");
    const wrap = $("jmap-nodes");
    const resume = JourneyProgress.nextIndex();
    wrap.innerHTML = "";

    // dotted path through every node, with the cleared prefix drawn lit
    const pts = JOURNEY_NODES.map(n => {
      const c = mapCoords(n, portrait);
      return `${c.left},${c.top}`;
    });
    $("jmap-lines").setAttribute("viewBox", "0 0 100 100");
    $("jmap-path").setAttribute("points", pts.join(" "));
    const doneCount = JourneyProgress.completedCount();
    $("jmap-path-done").setAttribute("points", doneCount > 0 ? pts.slice(0, doneCount + 1).join(" ") : "");

    JOURNEY_NODES.forEach((node, i) => {
      const unlocked = JourneyProgress.isUnlocked(i);
      const done = JourneyProgress.isComplete(node.id);
      const best = JourneyProgress.best(node.id);
      const b = document.createElement("button");
      b.className = "jnode " + (!unlocked ? "locked" : done ? "done" : "open")
        + (unlocked && i === resume && !done ? " current" : "");
      const c = mapCoords(node, portrait);
      b.style.left = c.left + "%";
      b.style.top = c.top + "%";
      b.style.borderColor = unlocked ? themeById(node.theme).accent + "cc" : "";
      b.innerHTML = `<span class="jn-num">${unlocked ? i + 1 : "&#128274;"}</span>`
        + `<span class="jn-stars">${best ? "★".repeat(best.stars) : ""}</span>`;
      b.addEventListener("mouseenter", () => describeNode(i));
      b.addEventListener("click", () => {
        if (!unlocked) {
          describeNode(i);
          return;
        }
        // first tap selects (so touch users can read it), second starts
        if (jSelected === i) { startGame("journey", null, i); return; }
        jSelected = i;
        wrap.querySelectorAll(".jnode").forEach((el, k) => el.classList.toggle("sel", k === i));
        describeNode(i);
        AudioSys.unlock();
      });
      wrap.appendChild(b);
    });

    const total = JOURNEY_NODES.length;
    $("jmap-progress").textContent =
      `${doneCount} / ${total} STAGES   ·   ${JourneyProgress.totalStars()} / ${total * 3} ★`;
    $("jmap-continue").textContent = doneCount >= total ? "REPLAY FROM START" : "CONTINUE";
    if (jSelected < 0) describeNode(resume);
  }

  function describeNode(i) {
    const node = JOURNEY_NODES[i];
    const unlocked = JourneyProgress.isUnlocked(i);
    const best = JourneyProgress.best(node.id);
    if (!unlocked) {
      $("jmap-info").innerHTML = `<span class="ji-name">LOCKED</span>`
        + `<span class="ji-sub">clear stage ${i} to open this path</span>`;
      return;
    }
    const meta = best
      ? `BEST ${best.score.toLocaleString()} · ${fmtTime(best.time)} · ${"★".repeat(best.stars)}`
      : `${node.goal} LINES · SPEED ${node.level}`;
    $("jmap-info").innerHTML = `<span class="ji-name">${node.name}</span>`
      + `<span class="ji-sub">${node.sub}</span>`
      + `<span class="ji-meta">${meta}</span>`;
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

  function refreshHiscores() {
    const s = store.scores;
    const parts = ["classic", "sprint", "zen"]
      .filter(m => s[m])
      .map(m => m === "sprint" ? `SPRINT ${fmtTime(s[m])}` : `${m.toUpperCase()} ${s[m].toLocaleString()}`);
    // journey reports progress rather than a single score
    const done = JourneyProgress.completedCount();
    if (done > 0) parts.unshift(`JOURNEY ${done}/${JOURNEY_NODES.length}`);
    $("hiscore").textContent = parts.length ? "BEST — " + parts.join("   ·   ") : "";
  }

  // ---------- input ----------
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
  const isTouch = matchMedia("(pointer: coarse)").matches;
  if (isTouch) document.body.classList.add("touch");

  // ---------- effects quality ----------
  // 2 = full (frosted-glass blur), 1 = balanced (no backdrop blur — by far
  // the costliest effect, since the animated background makes the browser
  // re-blur every panel every frame), 0 = low (also a half-res background
  // and fewer particles). AUTO starts high on desktop, balanced on touch,
  // and steps down when frames run long during play; the tier it settles on
  // is remembered for next time.
  const FX_LEVELS = { high: 2, balanced: 1, low: 0 };
  const FX_AUTO_KEY = "lumineffect-fxauto";
  const autoDefault = isTouch ? 1 : 2;
  let autoLevel = (() => {
    try { const v = localStorage.getItem(FX_AUTO_KEY); return v === null ? autoDefault : Math.min(autoDefault, +v); } catch (e) { return autoDefault; }
  })();
  let slowTime = 0;

  function fxLevel() { return settings.fx === "auto" ? autoLevel : FX_LEVELS[settings.fx] ?? 2; }

  function applyQuality() {
    const q = fxLevel();
    document.body.classList.toggle("fx-noblur", q < 2);
    Background.setQuality(q);
    const name = ["low", "balanced", "high"][q];
    $("fx-val").textContent = settings.fx === "auto" ? `auto · ${name}` : name;
  }

  function watchFrames(raw) {
    if (settings.fx !== "auto" || autoLevel === 0) return;
    if (state !== "playing" && state !== "transition") { slowTime = 0; return; }
    if (raw > 0.25) return; // a tab switch or one-off hitch, not sustained load
    // count time spent in frames slower than ~45fps; good frames pay it back
    slowTime = raw > 1 / 45 ? slowTime + raw : Math.max(0, slowTime - raw * 0.5);
    if (slowTime > 2) {
      slowTime = 0;
      autoLevel--;
      try { localStorage.setItem(FX_AUTO_KEY, autoLevel); } catch (e) {}
      applyQuality();
    }
  }

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

  // ---------- menu wiring ----------
  document.querySelectorAll("#menu .mbtn[data-mode]").forEach(btn => {
    btn.addEventListener("click", () => {
      AudioSys.unlock();
      const m = btn.dataset.mode;
      if (m === "zen") {
        $("menu").classList.add("hidden");
        $("mapselect").classList.remove("hidden");
        state = "mapselect";
      } else if (m === "journey") {
        showJourneyMap();
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
  bindSlider("set-sdf", "sdf-val", "sdf", v => v > 40 ? "instant" : v + "×", v => { if (game) game.softDropFactor = v; });
  function bindCheck(id, key, onChange) {
    const el = $(id);
    const sync = () => { el.checked = settings[key]; };
    sync();
    settingSyncs.push(sync);
    el.addEventListener("change", () => {
      settings[key] = el.checked;
      saveSettings();
      if (onChange) onChange(settings[key]);
    });
  }
  bindCheck("set-ghost", "ghost");
  bindCheck("set-patterns", "patterns");
  bindCheck("set-motion", "reduceMotion", applyMotion);
  bindCheck("set-quantize", "quantize", v => AudioSys.setQuantize(v));
  bindCheck("set-vibrate", "vibrate", v => { if (v) buzz(30); });
  // effects tier chips; picking AUTO again re-measures from the top
  const fxBtns = $("fxbtns");
  ["auto", "high", "balanced", "low"].forEach(v => {
    const b = document.createElement("button");
    b.className = "chip";
    b.dataset.fx = v;
    b.textContent = v.toUpperCase();
    b.addEventListener("click", () => {
      settings.fx = v;
      if (v === "auto") {
        autoLevel = autoDefault;
        try { localStorage.removeItem(FX_AUTO_KEY); } catch (e) {}
      }
      saveSettings();
      syncFx();
    });
    fxBtns.appendChild(b);
  });
  function syncFx() {
    fxBtns.querySelectorAll(".chip").forEach(c => c.classList.toggle("sel", c.dataset.fx === settings.fx));
    applyQuality();
  }
  settingSyncs.push(syncFx);
  syncFx();
  // keep the zen speed chips in sync too
  settingSyncs.push(() => {
    speedBtns.querySelectorAll(".chip").forEach(c => c.classList.toggle("sel", +c.textContent === settings.zenSpeed));
  });
  $("setreset").addEventListener("click", () => {
    Object.assign(settings, SETTINGS_DEFAULTS);
    saveSettings();
    settingSyncs.forEach(fn => fn());
    AudioSys.setVolume(settings.volume / 100);
    AudioSys.setQuantize(settings.quantize);
  });
  $("opensettings").addEventListener("click", () => { $("menu").classList.add("hidden"); $("settings").classList.remove("hidden"); });
  $("setback").addEventListener("click", () => { $("settings").classList.add("hidden"); $("menu").classList.remove("hidden"); });

  $("resume").addEventListener("click", () => { state = "playing"; $("pause").classList.add("hidden"); });
  $("quit").addEventListener("click", () => {
    // a run abandoned from the pause menu still counts toward lifetime stats
    if (game && !game.over && state === "paused") {
      LifetimeStats.record(mode, game, elapsed, { finished: false, timed: TIMED_MODES.has(mode) });
    }
    mode === "journey" ? showJourneyMap() : toMenu();
  });
  $("retry").addEventListener("click", () => startGame(mode, mode === "zen" ? zenTheme : null, jIndex));
  $("tomenu").addEventListener("click", toMenu);
  $("tojmap").addEventListener("click", showJourneyMap);
  $("nextstage").addEventListener("click", () =>
    startGame("journey", null, Math.min(jIndex + 1, JOURNEY_NODES.length - 1)));
  $("jmap-back").addEventListener("click", toMenu);
  $("jmap-continue").addEventListener("click", () => {
    const done = JourneyProgress.completedCount() >= JOURNEY_NODES.length;
    startGame("journey", null, done ? 0 : JourneyProgress.nextIndex());
  });

  // ---------- sub-screens off the main menu ----------
  function openScreen(id) { $("menu").classList.add("hidden"); $(id).classList.remove("hidden"); }
  function closeScreen(id) { $(id).classList.add("hidden"); $("menu").classList.remove("hidden"); refreshHiscores(); }

  // effect modes: one card per mode with its record
  function renderEffectModes() {
    const s = store.scores;
    const list = $("effectlist");
    list.innerHTML = "";
    for (const id of ["ultra", "purify", "mystery", "daily"]) {
      const def = EFFECT_MODES[id];
      let meta;
      if (id === "daily") {
        const d = dailyInfo();
        const r = DailyRecord.summary(d.key);
        meta = `${d.key} · ${d.theme.name} · ${DAILY_TWISTS[d.twist].name}`
          + (r.today != null ? ` · TODAY ${r.today.toLocaleString()}` : " · NOT PLAYED YET")
          + (r.streak > 1 ? ` · ${r.streak} DAY STREAK` : "");
      } else {
        meta = s[id] ? `BEST ${TIMED_MODES.has(id) ? fmtTime(s[id]) : s[id].toLocaleString()}` : "NO RECORD YET";
      }
      const b = document.createElement("button");
      b.className = "mbtn";
      b.innerHTML = `<span class="mbtn-name">${def.name}</span><span class="mbtn-desc">${def.desc}</span>`
        + `<span class="mbtn-meta">${meta}</span>`;
      b.addEventListener("click", () => { AudioSys.unlock(); $("effectmodes").classList.add("hidden"); startGame(id); });
      list.appendChild(b);
    }
  }
  $("openeffect").addEventListener("click", () => { renderEffectModes(); openScreen("effectmodes"); });
  $("effectback").addEventListener("click", () => closeScreen("effectmodes"));

  // lifetime stats
  const MODE_NAMES = { journey: "JOURNEY", classic: "CLASSIC", sprint: "SPRINT", zen: "ZEN", ultra: "ULTRA", purify: "PURIFY", mystery: "MYSTERY", daily: "DAILY" };
  function renderStats() {
    const d = LifetimeStats.data;
    const hrs = d.time / 3600;
    const totals = [
      ["GAMES", d.games], ["TIME PLAYED", hrs >= 1 ? `${hrs.toFixed(1)} h` : `${Math.round(d.time / 60)} min`],
      ["LINES", d.lines], ["PIECES", d.pieces],
      ["TETRISES", d.tetris], ["T-SPINS", d.tspin],
      ["PERFECT CLEARS", d.perfect], ["ZONES", d.zones],
      ["BEST ZONE", d.bestZone + " lines"], ["MAX COMBO", d.maxCombo],
      ["TOTAL SCORE", d.score], ["SINCE", new Date(d.since).toLocaleDateString()],
    ];
    $("stats-totals").innerHTML = totals.map(([k, v]) =>
      `<div class="stat-cell"><b>${typeof v === "number" ? v.toLocaleString() : v}</b><span class="dim">${k}</span></div>`).join("");
    const rows = Object.keys(MODE_NAMES).filter(m => d.modes[m]).map(m => {
      const r = d.modes[m];
      const timed = TIMED_MODES.has(m);
      const best = timed ? (r.bestTime != null ? fmtTime(r.bestTime) : "—") : r.best.toLocaleString();
      const last = r.last.map(x => x.dnf ? "DNF" : x.t != null ? fmtTime(x.t) : x.s.toLocaleString()).join(" · ");
      return `<tr><td>${MODE_NAMES[m]}</td><td>${r.games}</td><td>${best}</td><td class="dim">${last}</td></tr>`;
    });
    $("stats-modes").innerHTML = rows.length
      ? `<table class="modetable"><tr><th>MODE</th><th>GAMES</th><th>BEST</th><th>LAST 5</th></tr>${rows.join("")}</table>`
      : `<p class="dim">play a few runs and they'll show up here</p>`;
  }
  $("openstats").addEventListener("click", () => { renderStats(); openScreen("stats"); });
  $("statsback").addEventListener("click", () => closeScreen("stats"));
  $("statsreset").addEventListener("click", e => {
    // two clicks to confirm, so a stray tap can't wipe everything
    if (e.currentTarget.dataset.armed) { LifetimeStats.reset(); renderStats(); delete e.currentTarget.dataset.armed; e.currentTarget.textContent = "RESET STATS"; return; }
    e.currentTarget.dataset.armed = "1";
    e.currentTarget.textContent = "CLICK AGAIN TO RESET";
  });

  // key bindings
  let rebinding = null; // { action, slot } while waiting for a key
  function renderKeys() {
    const list = $("keylist");
    list.innerHTML = "";
    for (const a of ACTIONS) {
      const row = document.createElement("div");
      row.className = "keyrow";
      row.innerHTML = `<span>${a.label}</span>`;
      for (let slot = 0; slot < 2; slot++) {
        const b = document.createElement("button");
        const listening = rebinding && rebinding.action === a.id && rebinding.slot === slot;
        b.className = "chip keychip" + (listening ? " sel" : "");
        b.textContent = listening ? "PRESS A KEY" : keyLabel(keyBinds[a.id][slot]);
        b.addEventListener("click", () => { rebinding = { action: a.id, slot }; renderKeys(); });
        row.appendChild(b);
      }
      list.appendChild(row);
    }
    refreshHelp();
  }
  window.addEventListener("keydown", e => {
    if (!rebinding) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const { action, slot } = rebinding;
    rebinding = null;
    if (e.key === "Escape") { renderKeys(); return; }
    if (e.key === "Delete" || e.key === "Backspace") {
      keyBinds[action].splice(slot, 1);
    } else {
      Controls.bind(keyBinds, action, slot, e.key);
    }
    Controls.save(keyBinds);
    keyLookup = Controls.lookup(keyBinds);
    renderKeys();
  }, true);
  $("opencontrols").addEventListener("click", () => { renderKeys(); openScreen("controls"); });
  $("controlsback").addEventListener("click", () => { rebinding = null; closeScreen("controls"); });
  $("keysreset").addEventListener("click", () => {
    keyBinds = Controls.defaults();
    Controls.save(keyBinds);
    keyLookup = Controls.lookup(keyBinds);
    renderKeys();
  });

  // the menu's help line always shows the player's own keys
  function refreshHelp() {
    if (isTouch) return;
    const k = id => keyBinds[id].map(keyLabel).join(" ") || "—";
    document.querySelector("#menu .help").textContent =
      `${k("left")} / ${k("right")} move · ${k("soft")} soft drop · ${k("hard")} hard drop · `
      + `${k("ccw")} / ${k("cw")} rotate · ${k("hold")} hold · ${k("zone")} zone · ${k("pause")} pause`;
  }

  // menu background: idle drift on the first theme
  Background.setTheme(THEMES[Math.floor(Math.random() * THEMES.length)]);
  fitLayout(); // establishes body.portrait before any menu is drawn
  applyMotion();
  refreshHelp();
  refreshHiscores();
})();
