const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { launch, open, click, text, visible, startMode, quitToMenu } = require("./helpers");

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

const lines = page => page.evaluate(() => +document.getElementById("lines").textContent);

test("theater: the bot plays, clears lines and tours the maps", async () => {
  const { page, errors, close } = await open(browser);
  await page.evaluate(() => { EFFECT_MODES.theater.linesPerMap = 4; });
  await startMode(page, "theater");
  const firstMap = await text(page, "#mapname");
  await page.waitForFunction(m => document.getElementById("mapname").textContent !== m, firstMap, { timeout: 60000 });
  assert.ok(await lines(page) >= 4);
  assert.equal(await text(page, "#goal-label"), "NEXT MAP");
  assert.deepEqual(errors, []);
  await close();
});

test("theater: the player's keys don't move pieces, but pause still works", async () => {
  const { page, errors, close } = await open(browser);
  await startMode(page, "theater");
  // freeze the bot so only the player's keys could change anything
  await page.evaluate(() => { window.updateAutoplay = () => {}; });
  const before = await page.evaluate(() => ({ hold: game.hold, x: game.cur.x, rot: game.cur.rot }));
  for (const k of ["c", "ArrowLeft", "ArrowRight", "x", "z"]) await page.keyboard.press(k);
  await page.waitForTimeout(100);
  assert.deepEqual(await page.evaluate(() => ({ hold: game.hold, x: game.cur.x, rot: game.cur.rot })), before);
  await quitToMenu(page);
  await click(page, "#openstats");
  assert.equal(await page.evaluate(() => document.querySelector(".stat-cell b").textContent), "0", "the bot's runs don't count");
  assert.deepEqual(errors, []);
  await close();
});

test("attract loop: idling on the menu starts the theater, any key ends it", async () => {
  const { page, errors, close } = await open(browser);
  await page.evaluate(() => { EFFECT_MODES.theater.attractAfter = 1; });
  await page.waitForFunction(() => !document.getElementById("game").classList.contains("hidden"), null, { timeout: 10000 });
  assert.equal(await visible(page, "#attract"), true);
  assert.equal(await text(page, "#modename"), "THEATER");
  await page.waitForFunction(() => +document.getElementById("score").textContent.replace(/,/g, "") > 0, null, { timeout: 15000 });
  await page.keyboard.press("Space");
  assert.equal(await visible(page, "#menu"), true);
  assert.equal(await visible(page, "#attract"), false);
  assert.equal(await visible(page, "#game"), false);
  assert.deepEqual(errors, []);
  await close();
});
