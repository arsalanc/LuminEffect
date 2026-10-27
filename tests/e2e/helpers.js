// Shared Playwright setup: the game is opened straight from disk (file://),
// exactly how a player opening index.html would run it. Each test gets a
// fresh browser context, so localStorage starts empty.
const path = require("path");
const { chromium } = require("playwright");

const URL = "file://" + path.resolve(__dirname, "../../index.html");

async function launch() {
  return chromium.launch({ args: ["--autoplay-policy=no-user-gesture-required"] });
}

async function open(browser, { viewport = { width: 1280, height: 860 }, touch = false, init } = {}) {
  const context = await browser.newContext(touch
    ? { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }
    : { viewport });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", e => errors.push(e.message));
  page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
  if (init) await page.addInitScript(init);
  await page.goto(URL);
  return { page, errors, close: () => context.close() };
}

const click = (page, sel) => page.evaluate(s => document.querySelector(s).click(), sel);
const text = (page, sel) => page.evaluate(s => document.querySelector(s).textContent, sel);
const visible = (page, sel) => page.evaluate(s => !document.querySelector(s).classList.contains("hidden"), sel);

// start a main-menu mode, or an effect mode by id (zen: on map `zenMap`)
async function startMode(page, id, zenMap = 0) {
  if (id === "zen") {
    await click(page, '.mbtn[data-mode="zen"]');
    await page.evaluate(i => document.querySelectorAll(".mapcard")[i].click(), zenMap);
  } else if (["ultra", "purify", "mystery", "daily"].includes(id)) {
    await click(page, "#openeffect");
    await page.evaluate(i => [...document.querySelectorAll("#effectlist .mbtn")][i].click(),
      ["ultra", "purify", "mystery", "daily"].indexOf(id));
  } else {
    await click(page, `.mbtn[data-mode="${id}"]`);
  }
  await page.waitForFunction(() => !document.getElementById("game").classList.contains("hidden"));
}

async function quitToMenu(page) {
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("pause").classList.contains("hidden"));
  await click(page, "#quit");
}

module.exports = { launch, open, click, text, visible, startMode, quitToMenu };
