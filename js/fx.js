// ============ VISUAL FX ============
// Full-screen reactive background (one particle system per map) plus
// board-space particle bursts for line clears, drops and zone cash-outs.

// ---------- background ----------
const Background = (() => {
  const canvas = document.getElementById("bg");
  const ctx = canvas.getContext("2d");
  let W = 0, H = 0;
  let theme = THEMES[0];
  let prevTheme = null;
  let fade = 1; // 0..1 crossfade into current theme
  let parts = [];
  let t = 0;
  let energy = 0; // impulse energy from gameplay events (clears, drops)
  let pulse = 0;  // drawn value: event energy + musical beat envelope
  let zoneMode = 0; // 0..1, world turns monochrome-ish in zone
  let intensity = 0; // 0..1 danger/level signal — particles burn brighter
  let zoneTension = 0; // 0..1 banked zone lines — the frozen world hums louder

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resize);
  resize();

  function rand(a, b) { return a + Math.random() * (b - a); }

  function makeParticles(th) {
    const list = [];
    const kind = th.particles;
    const count = kind === "aurora" ? 26 : kind === "rain" ? 140 : 90;
    for (let i = 0; i < count; i++) {
      list.push({
        x: rand(0, 1), y: rand(0, 1),
        s: rand(0.3, 1),
        v: rand(0.4, 1),
        ph: rand(0, Math.PI * 2),
        hue: rand(-20, 20),
      });
    }
    return list;
  }

  function setTheme(th) {
    if (!th || th === theme) return;
    prevTheme = theme;
    theme = th;
    fade = 0;
    parts = makeParticles(th);
    document.documentElement.style.setProperty("--accent", th.accent);
    document.documentElement.style.setProperty("--glow", th.accent + "88");
  }

  function hexRGB(hex) {
    return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
  }
  function mix(a, b, k) { return a.map((v, i) => Math.round(v + (b[i] - v) * k)); }
  function css(rgb, alpha = 1) { return `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${alpha})`; }

  function drawGradient() {
    let top = hexRGB(theme.bgTop), bot = hexRGB(theme.bgBottom);
    if (prevTheme && fade < 1) {
      top = mix(hexRGB(prevTheme.bgTop), top, fade);
      bot = mix(hexRGB(prevTheme.bgBottom), bot, fade);
    }
    if (zoneMode > 0) {
      const z = zoneMode * 0.8;
      top = mix(top, [10, 10, 24], z);
      bot = mix(bot, [30, 34, 60], z);
    }
    const g = ctx.createLinearGradient(0, 0, 0, H);
    const boost = 1 + pulse * 0.35;
    g.addColorStop(0, css(top.map(v => Math.min(255, v * boost))));
    g.addColorStop(1, css(bot.map(v => Math.min(255, v * boost))));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  const drawers = {
    ocean(p) {
      // rising bubbles
      const x = p.x * W + Math.sin(t * p.v + p.ph) * 30;
      const y = ((p.y - t * 0.02 * p.v) % 1 + 1) % 1 * H;
      const r = p.s * 5 * (1 + pulse * 0.6);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(150,220,255,${0.12 + p.s * 0.15 + pulse * 0.2})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    },
    sand(p) {
      const x = ((p.x + t * 0.03 * p.v) % 1) * W;
      const y = p.y * H + Math.sin(t * 0.7 * p.v + p.ph) * 40;
      ctx.fillStyle = `rgba(255,205,130,${0.10 + p.s * 0.18 + pulse * 0.15})`;
      ctx.fillRect(x, y, p.s * 3 + 1, p.s * 2 + 1);
    },
    aurora(p, i) {
      if (i < 5) { // 5 ribbons
        ctx.beginPath();
        const yBase = H * (0.15 + i * 0.12);
        for (let x = 0; x <= W; x += 24) {
          const y = yBase + Math.sin(x * 0.004 + t * (0.3 + i * 0.07) + p.ph) * 60
                  + Math.sin(x * 0.001 + t * 0.15) * 90;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        const alpha = 0.05 + 0.04 * Math.sin(t * 0.5 + i) + pulse * 0.12;
        ctx.strokeStyle = i % 2 ? `rgba(120,255,190,${alpha})` : `rgba(140,180,255,${alpha})`;
        ctx.lineWidth = 26 - i * 3;
        ctx.stroke();
      } else { // stars
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * p.v * 2 + p.ph));
        ctx.fillStyle = `rgba(220,240,255,${0.25 * tw * p.s})`;
        ctx.fillRect(p.x * W, p.y * H * 0.7, 1.6, 1.6);
      }
    },
    rain(p) {
      const speed = 0.5 + p.v * 0.8;
      const y = ((p.y + t * speed * 0.25) % 1) * H;
      const x = p.x * W;
      const len = 14 + p.v * 22;
      const grad = ctx.createLinearGradient(x, y, x, y + len);
      grad.addColorStop(0, "rgba(255,110,220,0)");
      grad.addColorStop(1, `rgba(160,220,255,${0.15 + p.s * 0.2 + pulse * 0.2})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + len);
      ctx.stroke();
    },
    stars(p) {
      const drift = t * 0.004 * p.v;
      const x = ((p.x + drift) % 1) * W;
      const tw = 0.3 + 0.7 * Math.abs(Math.sin(t * p.v * 1.5 + p.ph));
      const r = p.s * 1.8 * (1 + pulse);
      ctx.fillStyle = `rgba(230,225,255,${(0.15 + 0.4 * tw * p.s)})`;
      ctx.beginPath();
      ctx.arc(x, p.y * H, r, 0, Math.PI * 2);
      ctx.fill();
    },
  };

  function frame(dt) {
    // zone slow-motion: time eases to a slow backward drift inside the zone
    const timeScale = 1 - zoneMode * 1.25;
    t += dt * timeScale;
    energy = Math.max(0, energy - dt * 1.4);
    // breathe with the music: sharp swell on each beat that decays across it
    const beat = (typeof AudioSys !== "undefined") ? AudioSys.getBeat() : { active: false };
    const beatEnv = beat.active ? Math.pow(Math.max(0, 1 - beat.phase), 2.5) * (0.22 + intensity * 0.15) : 0;
    pulse = Math.min(1, energy + beatEnv + intensity * 0.12 + zoneMode * zoneTension * 0.3);
    if (fade < 1) fade = Math.min(1, fade + dt / 1.8);
    drawGradient();
    const kind = theme.particles;
    const fn = drawers[kind] || drawers.stars;
    for (let i = 0; i < parts.length; i++) fn(parts[i], i);
  }

  parts = makeParticles(theme);

  return {
    setTheme,
    frame,
    beat(strength = 0.6) { energy = Math.min(1, energy + strength); },
    setZone(v) { zoneMode = v; },
    setZoneTension(v) { zoneTension = Math.max(0, Math.min(1, v)); },
    setIntensity(v) { intensity = Math.max(0, Math.min(1, v)); },
    get theme() { return theme; },
  };
})();

// ---------- board-space particles ----------
class BoardFX {
  constructor() {
    this.parts = [];
    this.shake = 0;
  }
  burstRow(yPix, wPix, cell, color, intensity = 1) {
    const n = Math.floor(22 * intensity);
    for (let i = 0; i < n; i++) {
      this.parts.push({
        x: Math.random() * wPix,
        y: yPix + Math.random() * cell,
        vx: (Math.random() - 0.5) * 260 * intensity,
        vy: (Math.random() - 0.8) * 220 * intensity,
        life: 0.6 + Math.random() * 0.7,
        t: 0,
        r: 1.5 + Math.random() * 2.5,
        color,
      });
    }
  }
  // one cleared cell breaking loose: a spinning quad that flies out,
  // shrinks and fades as if falling away into the background
  shatterCell(x, y, size, color, delay = 0) {
    this.parts.push({
      quad: true,
      x, y,
      vx: (Math.random() - 0.5) * 190,
      vy: -30 - Math.random() * 150,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 12,
      size,
      life: 0.5 + Math.random() * 0.35,
      t: -delay,
      color,
    });
    // a couple of sparks alongside
    for (let i = 0; i < 2; i++) {
      this.parts.push({
        x: x + (Math.random() - 0.5) * size, y,
        vx: (Math.random() - 0.5) * 220,
        vy: (Math.random() - 0.9) * 200,
        life: 0.35 + Math.random() * 0.4,
        t: -delay,
        r: 1 + Math.random() * 1.6,
        color,
      });
    }
  }
  burstAt(x, y, color, n = 10, spread = 140) {
    for (let i = 0; i < n; i++) {
      this.parts.push({
        x, y,
        vx: (Math.random() - 0.5) * spread,
        vy: (Math.random() - 0.7) * spread,
        life: 0.4 + Math.random() * 0.5,
        t: 0,
        r: 1 + Math.random() * 2,
        color,
      });
    }
  }
  addShake(v) { this.shake = Math.min(14, this.shake + v); }
  update(dt) {
    this.shake = Math.max(0, this.shake - dt * 30);
    for (const p of this.parts) {
      p.t += dt;
      if (p.t < 0) continue; // still waiting on its stagger delay
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += (p.quad ? 260 : 320) * dt;
      if (p.quad) p.rot += p.vr * dt;
    }
    this.parts = this.parts.filter(p => p.t < p.life);
  }
  draw(ctx) {
    for (const p of this.parts) {
      if (p.t < 0) continue;
      const k = 1 - p.t / p.life;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      if (p.quad) {
        const s = p.size * (0.25 + 0.75 * k); // shrink away into the distance
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.fillRect(-s / 2, -s / 2, s, s);
        ctx.restore();
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * k + 0.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
}
