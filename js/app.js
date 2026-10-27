// ============ APP STATE ============
// Shared by every game script (they're plain scripts, not modules, so the
// game still runs straight from index.html over file://; top-level let /
// const / function declarations are visible to the scripts loaded after).
// This file owns the DOM handles, board geometry, the run's mutable state,
// persisted scores and settings, and small helpers used everywhere.
//
// Load order: app → render → flow → input → quality → screens → main.

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

// ---------- device ----------
const isTouch = matchMedia("(pointer: coarse)").matches;
if (isTouch) document.body.classList.add("touch");

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
