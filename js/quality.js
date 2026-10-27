// ============ EFFECTS QUALITY ============
// HIGH / BALANCED / LOW tiers and the AUTO watchdog that steps down when
// frames run slow during play.

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
