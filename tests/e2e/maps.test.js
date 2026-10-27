const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { launch, open, startMode, quitToMenu } = require("./helpers");

let browser;
before(async () => { browser = await launch(); });
after(() => browser.close());

// every map: start zen on it, play a few pieces, set off its big-moment
// reaction, and make sure nothing throws (with and without reduced motion)
for (const calm of [false, true]) {
  test(`every map plays and reacts without errors${calm ? " (reduced motion)" : ""}`, async () => {
    const { page, errors, close } = await open(browser);
    if (calm) await page.evaluate(() => { document.getElementById("set-motion").click(); });
    const ids = await page.evaluate(() => THEMES.map(t => t.id));
    for (let i = 0; i < ids.length; i++) {
      await startMode(page, "zen", i);
      assert.equal(await page.evaluate(() => Background.theme.id), ids[i]);
      for (let k = 0; k < 3; k++) { await page.keyboard.press(k % 2 ? "ArrowLeft" : "ArrowRight"); await page.keyboard.press(" "); }
      await page.evaluate(() => Background.burst(1.2, ["#ffffff"]));
      await page.waitForTimeout(250);
      await quitToMenu(page);
    }
    assert.deepEqual(errors, []);
    await close();
  });
}
