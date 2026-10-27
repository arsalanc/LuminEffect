// ============ SCREENS ============
// Everything that isn't the playfield: the journey map, main menu, zen
// map select, settings, effect modes, stats and controls screens.

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
