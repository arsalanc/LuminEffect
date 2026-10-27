const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { launch, open, click, text, visible } = require("./helpers");

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

test("boots to the menu without errors", async () => {
  const { page, errors, close } = await open(browser);
  assert.equal(await visible(page, "#menu"), true);
  const modes = await page.evaluate(() => [...document.querySelectorAll("#menu .mbtn[data-mode]")].map(b => b.dataset.mode));
  assert.deepEqual(modes, ["journey", "classic", "sprint", "zen"]);
  assert.deepEqual(errors, []);
  await close();
});

test("every menu screen opens and returns", async () => {
  const { page, errors, close } = await open(browser);
  for (const [openBtn, screen, back] of [
    ["#openeffect", "#effectmodes", "#effectback"],
    ["#openstats", "#stats", "#statsback"],
    ["#opencontrols", "#controls", "#controlsback"],
    ["#opensettings", "#settings", "#setback"],
  ]) {
    await click(page, openBtn);
    assert.equal(await visible(page, screen), true, screen);
    assert.equal(await visible(page, "#menu"), false);
    await click(page, back);
    assert.equal(await visible(page, "#menu"), true);
  }
  assert.equal(await page.evaluate(() => document.querySelectorAll("#effectlist .mbtn").length), 4);
  assert.deepEqual(errors, []);
  await close();
});

test("journey map and zen map select list everything", async () => {
  const { page, errors, close } = await open(browser);
  await click(page, '.mbtn[data-mode="journey"]');
  assert.equal(await page.evaluate(() => document.querySelectorAll(".jnode").length), await page.evaluate(() => JOURNEY_NODES.length));
  assert.match(await text(page, "#jmap-progress"), /0 \/ \d+ STAGES/);
  await click(page, "#jmap-back");
  await click(page, '.mbtn[data-mode="zen"]');
  assert.equal(await page.evaluate(() => document.querySelectorAll(".mapcard").length), await page.evaluate(() => THEMES.length));
  assert.deepEqual(errors, []);
  await close();
});

test("settings persist across reloads", async () => {
  const { page, close } = await open(browser);
  await click(page, "#opensettings");
  await click(page, "#set-ghost");
  await click(page, "#set-patterns");
  await page.reload();
  const s = await page.evaluate(() => ({ ghost: document.getElementById("set-ghost").checked, pat: document.getElementById("set-patterns").checked }));
  assert.deepEqual(s, { ghost: false, pat: true });
  await close();
});

test("phone layout: touch bar in game, no keyboard controls screen", async () => {
  const { page, errors, close } = await open(browser, { touch: true });
  assert.equal(await visible(page, "#opencontrols"), false);
  await click(page, '.mbtn[data-mode="sprint"]');
  await page.waitForFunction(() => !document.getElementById("touchbar").classList.contains("hidden"));
  assert.equal(await page.evaluate(() => document.body.classList.contains("portrait")), true);
  assert.deepEqual(errors, []);
  await close();
});
