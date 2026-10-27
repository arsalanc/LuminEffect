// Loads the game's plain browser scripts into a Node vm sandbox so the
// DOM-free parts (engine, modes, journey, controls, stats, bot) can be
// unit-tested without a browser. Top-level const/class declarations live
// in the context's shared global scope, so they're read back by name.
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_FILES = ["themes.js", "journey.js", "controls.js", "stats.js", "engine.js", "modes.js", "bot.js"];

function memoryStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: k => m.delete(k),
    clear: () => m.clear(),
  };
}

function loadGame(files = DEFAULT_FILES) {
  const ctx = vm.createContext({ console, localStorage: memoryStorage() });
  for (const f of files) {
    const file = path.join(ROOT, "js", f);
    if (!fs.existsSync(file)) continue;
    vm.runInContext(fs.readFileSync(file, "utf8"), ctx, { filename: file });
  }
  // read any global (including top-level const/class) by evaluating its
  // name; `run` evaluates arbitrary code inside the sandbox
  const run = code => vm.runInContext(code, ctx);
  return new Proxy({}, { get: (_, name) => (name === "run" ? run : run(String(name))) });
}

// Arrays and objects made inside the sandbox have that realm's prototypes,
// which strict deep-equality rejects; compare plain copies instead.
const plain = v => JSON.parse(JSON.stringify(v));

module.exports = { loadGame, plain };
