const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { launch, open, text, startMode, quitToMenu } = require("./helpers");

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

test("ultra ends with TIME UP when the clock runs out", async () => {
  const { page, errors, close } = await open(browser);
  await page.evaluate(() => { EFFECT_MODES.ultra.timeLimit = 2; });
  await startMode(page, "ultra");
  assert.equal(await text(page, "#goal-label"), "TIME LEFT");
  await page.waitForFunction(() => document.getElementById("result-title").textContent === "TIME UP", null, { timeout: 10000 });
  assert.deepEqual(errors, []);
  await close();
});

test("purify: dark rows rise, clearing them wins", async () => {
  const { page, errors, close } = await open(browser, {
    init: () => window.addEventListener("DOMContentLoaded", () => {
      // plug every garbage hole on lock so the dark rows clear
      const orig = Tetris.prototype._lock;
      Tetris.prototype._lock = function (d) {
        if (window.__plug) for (const r of this.grid) if (r.includes(DARK_CELL)) r.fill(DARK_CELL);
        return orig.call(this, d);
      };
    }),
  });
  await page.evaluate(() => { EFFECT_MODES.purify.target = 9; });
  await startMode(page, "purify");
  // the HUD fills in on the first rendered frame
  await page.waitForFunction(() => document.getElementById("goal").textContent === "0 / 9");
  await page.evaluate(() => { window.__plug = true; });
  await page.keyboard.press(" ");
  await page.waitForFunction(() => document.getElementById("result-title").textContent === "PURIFIED", null, { timeout: 10000 });
  assert.deepEqual(errors, []);
  await close();
});

test("mystery: every event fires and timed effects clean up", async () => {
  const { page, errors, close } = await open(browser);
  await page.evaluate(() => {
    EFFECT_MODES.mystery.every = 0.25;
    MYSTERY_EVENTS.forEach(e => { if (e.kind === "timed") e.dur = 0.2; });
    window.__seen = new Set();
    new MutationObserver(() => {
      const t = document.querySelector("#announce").firstChild;
      if (t) window.__seen.add(t.textContent);
    }).observe(document.querySelector("#announce"), { childList: true });
  });
  await startMode(page, "mystery");
  const all = await page.evaluate(() => MYSTERY_EVENTS.map(e => e.name));
  await page.waitForFunction(n => window.__seen.size >= n || !document.getElementById("results").classList.contains("hidden"),
    all.length, { timeout: 40000 });
  const seen = await page.evaluate(() => [...window.__seen]);
  for (const name of all) assert.ok(seen.includes(name), `never saw ${name}`);
  await page.evaluate(() => { EFFECT_MODES.mystery.every = 1e9; });
  await page.waitForTimeout(400);
  assert.equal(await page.evaluate(() => document.getElementById("board").classList.contains("flipped")), false);
  assert.deepEqual(errors, []);
  await close();
});

test("daily deals the same pieces on every attempt", async () => {
  const { page, errors, close } = await open(browser);
  const attempt = async () => {
    await startMode(page, "daily");
    await page.waitForTimeout(200);
    const shot = await page.evaluate(() => document.getElementById("next").toDataURL());
    const name = await text(page, "#modename");
    await quitToMenu(page);
    return { shot, name };
  };
  const a = await attempt(), b = await attempt();
  assert.match(a.name, /^DAILY · /);
  assert.equal(a.shot, b.shot);
  assert.deepEqual(errors, []);
  await close();
});
