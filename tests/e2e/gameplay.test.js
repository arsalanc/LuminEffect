const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { launch, open, click, text, visible, startMode, quitToMenu } = require("./helpers");

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

// test hook: when window.__fill is set, the next lock first fills the
// bottom rows (all but the column the piece lands in) so it clears lines
const fillHook = () => {
  window.addEventListener("DOMContentLoaded", () => {
    const orig = Tetris.prototype._lock;
    Tetris.prototype._lock = function (d) {
      if (window.__fill) {
        const n = window.__fill; window.__fill = 0;
        for (let y = ROWS - n; y < ROWS; y++) this.grid[y] = this.grid[y].map(() => 1);
      }
      return orig.call(this, d);
    };
  });
};

test("classic: drops score, clears announce, pause pauses", async () => {
  const { page, errors, close } = await open(browser, { init: fillHook });
  await startMode(page, "classic");
  await page.keyboard.press(" ");
  await page.waitForFunction(() => +document.getElementById("score").textContent.replace(/,/g, "") > 0);
  await page.evaluate(() => { window.__fill = 4; });
  await page.keyboard.press(" ");
  await page.waitForFunction(() => document.getElementById("lines").textContent === "4");
  assert.match(await text(page, "#announce"), /TETRIS|PERFECT CLEAR/); // the fill can empty the board
  await page.keyboard.press("p");
  assert.equal(await visible(page, "#pause"), true);
  const t = await text(page, "#time");
  await page.waitForTimeout(1200);
  assert.equal(await text(page, "#time"), t, "the clock stops while paused");
  await page.keyboard.press("p");
  assert.equal(await visible(page, "#pause"), false);
  assert.deepEqual(errors, []);
  await close();
});

test("the zone banks lines and cashes them out", async () => {
  const { page, errors, close } = await open(browser, { init: fillHook });
  await startMode(page, "zen");
  // fill the meter through a few clears
  for (let i = 0; i < 3; i++) {
    await page.evaluate(() => { window.__fill = 4; });
    await page.keyboard.press(" ");
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => document.getElementById("zonemeter").classList.contains("ready"));
  await page.keyboard.press("Shift");
  await page.waitForFunction(() => document.getElementById("boardwrap").classList.contains("zone-active"));
  await page.evaluate(() => { window.__fill = 2; });
  await page.keyboard.press(" ");
  await page.waitForFunction(() => !document.getElementById("boardwrap").classList.contains("zone-active"), null, { timeout: 30000 });
  assert.deepEqual(errors, []);
  await close();
});

test("a rebound key works in game and shows in the help line", async () => {
  const { page, errors, close } = await open(browser);
  await click(page, "#opencontrols");
  await page.evaluate(() => [...document.querySelectorAll(".keyrow")].find(r => r.textContent.startsWith("HARD DROP")).querySelector(".keychip").click());
  await page.keyboard.press("j");
  await click(page, "#controlsback");
  assert.match(await text(page, "#menu .help"), /J hard drop/);
  await startMode(page, "sprint");
  await page.keyboard.press("j");
  await page.waitForFunction(() => +document.getElementById("score").textContent.replace(/,/g, "") > 0);
  await quitToMenu(page);
  assert.deepEqual(errors, []);
  await close();
});

test("accessibility options render without errors", async () => {
  const { page, errors, close } = await open(browser, { init: fillHook });
  await click(page, "#opensettings");
  await click(page, "#set-patterns");
  await click(page, "#set-motion");
  await click(page, "#setback");
  assert.equal(await page.evaluate(() => document.body.classList.contains("reduce-motion")), true);
  await startMode(page, "classic");
  for (let i = 0; i < 4; i++) { await page.keyboard.press(i % 2 ? "ArrowLeft" : "ArrowRight"); await page.keyboard.press(" "); }
  await page.evaluate(() => { window.__fill = 2; });
  await page.keyboard.press(" ");
  await page.waitForTimeout(300);
  assert.deepEqual(errors, []);
  await close();
});

test("quitting a run counts it in lifetime stats", async () => {
  const { page, close } = await open(browser);
  await startMode(page, "sprint");
  await page.keyboard.press(" ");
  await quitToMenu(page);
  await click(page, "#openstats");
  assert.equal(await page.evaluate(() => document.querySelector(".stat-cell b").textContent), "1");
  assert.match(await text(page, "#stats-modes"), /SPRINT/);
  await close();
});
