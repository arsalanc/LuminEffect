// ============ VISUAL FX ============
// Full-screen reactive background (one particle system per map) plus
// board-space particle bursts for line clears, drops and zone cash-outs.
// Each map's world reacts to big moments in its own way: bubbles swirl,
// sand gusts outward, auroras flare, rain bends away, stars warp.

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
  let motes = []; // event sparks flung out of the board toward the camera
  let rings = []; // shockwaves expanding from the board
  let push = 0;   // the ambient field flinches outward on big moments
  let vignette = null, dangerGlow = null;
  let react = 0, rx = 0, ry = 0; // the map's reaction to the last big moment, centred at (rx, ry)
  let danger = 0; // 0..1 stack height — the edges of the world pulse red

  function resize() {
    W = canvas.width = window.innerWidth;
    H = canvas.height = window.innerHeight;
    vignette = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    vignette.addColorStop(0, "rgba(0,0,0,0)");
    vignette.addColorStop(1, "rgba(0,0,6,0.55)");
    dangerGlow = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.55);
    dangerGlow.addColorStop(0, "rgba(255,30,60,0)");
    dangerGlow.addColorStop(1, "rgba(255,30,60,0.55)");
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

  // how strongly the current reaction reaches a point: strongest near its
  // origin, with the unit direction pointing away from it
  function reach(x, y) {
    const dx = x - rx, dy = y - ry, d = Math.hypot(dx, dy) || 1;
    return { k: react * Math.exp(-d / (Math.min(W, H) * 0.5)), ux: dx / d, uy: dy / d };
  }

  const drawers = {
    ocean(p) {
      // rising bubbles; a big moment swirls them around it like a vortex
      let x = p.x * W + Math.sin(t * p.v + p.ph) * 30;
      let y = ((p.y - t * 0.02 * p.v) % 1 + 1) % 1 * H;
      const { k } = reach(x, y);
      if (k > 0.01) {
        const a = k * 1.6, c = Math.cos(a), sn = Math.sin(a), dx = x - rx, dy = y - ry;
        x = rx + dx * c - dy * sn;
        y = ry + dx * sn + dy * c - k * 40;
      }
      const r = p.s * 5 * (1 + pulse * 0.6 + k);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(150,220,255,${0.12 + p.s * 0.15 + pulse * 0.2})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    },
    sand(p) {
      // drifting grains; a big moment is a gust blowing them outward
      let x = ((p.x + t * 0.03 * p.v) % 1) * W;
      let y = p.y * H + Math.sin(t * 0.7 * p.v + p.ph) * 40;
      const { k, ux, uy } = reach(x, y);
      x += ux * k * 170; y += uy * k * 70;
      ctx.fillStyle = `rgba(255,205,130,${0.10 + p.s * 0.18 + pulse * 0.15 + k * 0.3})`;
      ctx.fillRect(x, y, p.s * 3 + 1 + k * 26 * Math.abs(ux), p.s * 2 + 1);
    },
    aurora(p, i) {
      if (i < 5) { // 5 ribbons
        ctx.beginPath();
        const yBase = H * (0.15 + i * 0.12);
        // a big moment makes the ribbons flare: taller, wider, brighter
        const amp = 1 + react * 0.9;
        for (let x = 0; x <= W; x += 24) {
          const y = yBase + (Math.sin(x * 0.004 + t * (0.3 + i * 0.07) + p.ph) * 60
                  + Math.sin(x * 0.001 + t * 0.15) * 90) * amp;
          x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        const alpha = 0.05 + 0.04 * Math.sin(t * 0.5 + i) + pulse * 0.12 + react * 0.16;
        ctx.strokeStyle = i % 2 ? `rgba(120,255,190,${alpha})` : `rgba(140,180,255,${alpha})`;
        ctx.lineWidth = 26 - i * 3 + react * 14;
        ctx.stroke();
      } else { // stars
        const tw = 0.4 + 0.6 * Math.abs(Math.sin(t * p.v * 2 + p.ph));
        ctx.fillStyle = `rgba(220,240,255,${Math.min(1, 0.25 * tw * p.s + react * 0.3)})`;
        ctx.fillRect(p.x * W, p.y * H * 0.7, 1.6, 1.6);
      }
    },
    rain(p) {
      // falling streaks; a big moment bends the rain away from it
      const speed = 0.5 + p.v * 0.8;
      const y = ((p.y + t * speed * 0.25) % 1) * H;
      const x = p.x * W;
      const len = 14 + p.v * 22;
      const { k, ux } = reach(x, y + len / 2);
      const x0 = x + ux * k * 30, x1 = x + ux * k * 95;
      const grad = ctx.createLinearGradient(x0, y, x1, y + len);
      grad.addColorStop(0, "rgba(255,110,220,0)");
      grad.addColorStop(1, `rgba(160,220,255,${Math.min(1, 0.15 + p.s * 0.2 + pulse * 0.2 + k * 0.4)})`);
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(x0, y);
      ctx.lineTo(x1, y + len);
      ctx.stroke();
    },
    stars(p) {
      const drift = t * 0.004 * p.v;
      const x = ((p.x + drift) % 1) * W;
      const tw = 0.3 + 0.7 * Math.abs(Math.sin(t * p.v * 1.5 + p.ph));
      const r = p.s * 1.8 * (1 + pulse);
      const alpha = 0.15 + 0.4 * tw * p.s;
      const { k, ux, uy } = reach(x, p.y * H);
      if (k > 0.02) {
        // a big moment warps space: stars stretch into hyperspace streaks
        const sx = x + ux * k * 30, sy = p.y * H + uy * k * 30, len = k * 140 * p.s;
        ctx.strokeStyle = `rgba(230,225,255,${Math.min(1, alpha + k * 0.4)})`;
        ctx.lineWidth = r;
        ctx.lineCap = "round";
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + ux * len, sy + uy * len); ctx.stroke();
        return;
      }
      ctx.fillStyle = `rgba(230,225,255,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, p.y * H, r, 0, Math.PI * 2);
      ctx.fill();
    },
  };

  // Sparks live in a little 3D space: they start near the board and fly
  // past the camera, so perspective spreads them across the whole screen.
  function burst(strength = 0.5, colors = null, origin = null) {
    const valid = (colors || []).filter(c => /^#[0-9a-f]{6}$/i.test(c));
    const cols = (valid.length ? valid : [theme.accent]).map(hexRGB);
    const ox = origin ? origin.x : W / 2, oy = origin ? origin.y : H / 2;
    const n = Math.min(170, Math.round(18 + strength * 80));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = rand(0.04, 0.32) * (0.6 + strength * 0.5);
      motes.push({
        x: rand(-0.04, 0.04), y: rand(-0.04, 0.04),
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        z: rand(0.9, 1.3), vz: -rand(0.35, 1.0) * (0.7 + strength * 0.6),
        ox, oy, t: 0, life: rand(1.4, 2.6), s: rand(1, 2.6),
        rgb: cols[i % cols.length],
      });
    }
    if (motes.length > 600) motes.splice(0, motes.length - 600);
    rings.push({ x: ox, y: oy, t: 0, life: 0.9 + strength * 0.5, k: Math.min(1, strength), rgb: cols[0] });
    push = Math.min(1, push + strength * 0.5);
    react = Math.min(1.4, react + strength * 0.8);
    rx = ox; ry = oy;
  }

  function drawMotes(dt) {
    const f = Math.min(W, H) * 0.5; // focal length
    for (const m of motes) {
      m.t += dt;
      m.x += m.vx * dt; m.y += m.vy * dt; m.z += m.vz * dt;
    }
    motes = motes.filter(m => m.t < m.life && m.z > 0.06);
    const kind = theme.particles;
    for (const m of motes) {
      const k = 1 - m.t / m.life;
      const sx = m.ox + (m.x / m.z) * f, sy = m.oy + (m.y / m.z) * f;
      // sparks take the map's own material: bubbles, grains, or light
      if (kind === "ocean") {
        ctx.strokeStyle = css(m.rgb, Math.min(1, k * 1.4) * 0.8);
        ctx.lineWidth = Math.min(3, 0.6 / m.z);
        ctx.beginPath(); ctx.arc(sx, sy, Math.min(26, m.s * 2.4 / m.z), 0, Math.PI * 2); ctx.stroke();
        continue;
      }
      if (kind === "sand") {
        const sz = Math.min(9, m.s * 1.6 / m.z);
        ctx.fillStyle = css(m.rgb, Math.min(1, k * 1.4) * 0.85);
        ctx.fillRect(sx - sz / 2, sy - sz / 2, sz, sz);
        continue;
      }
      // streak back toward where it was a moment ago: motion blur for free
      const z2 = m.z - m.vz * 0.05;
      const tx = m.ox + ((m.x - m.vx * 0.05) / z2) * f, ty = m.oy + ((m.y - m.vy * 0.05) / z2) * f;
      ctx.strokeStyle = css(m.rgb, Math.min(1, k * 1.4) * 0.85);
      ctx.lineWidth = Math.min(7, m.s / m.z);
      ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(sx, sy); ctx.stroke();
    }
    for (const r of rings) r.t += dt;
    rings = rings.filter(r => r.t < r.life);
    for (const r of rings) {
      const p = r.t / r.life;
      const rad = (1 - Math.pow(1 - p, 3)) * Math.hypot(W, H) * 0.55;
      ctx.strokeStyle = css(r.rgb, (1 - p) * 0.35 * r.k);
      ctx.lineWidth = 2 + (1 - p) * 14 * r.k;
      ctx.beginPath(); ctx.arc(r.x, r.y, rad, 0, Math.PI * 2); ctx.stroke();
    }
  }

  function frame(dt) {
    // zone slow-motion: time eases to a slow backward drift inside the zone
    const timeScale = 1 - zoneMode * 1.25;
    t += dt * timeScale;
    energy = Math.max(0, energy - dt * 1.4);
    push = Math.max(0, push - dt * 1.6);
    react = Math.max(0, react - dt * Math.max(0.12, timeScale) * 0.9); // frozen in the zone too
    // breathe with the music: sharp swell on each beat that decays across it
    const beat = (typeof AudioSys !== "undefined") ? AudioSys.getBeat() : { active: false };
    const beatEnv = beat.active ? Math.pow(Math.max(0, 1 - beat.phase), 2.5) * (0.22 + intensity * 0.15) : 0;
    pulse = Math.min(1, energy + beatEnv + intensity * 0.12 + zoneMode * zoneTension * 0.3);
    if (fade < 1) fade = Math.min(1, fade + dt / 1.8);
    drawGradient();
    const kind = theme.particles;
    const fn = drawers[kind] || drawers.stars;
    // additive light: overlapping particles bloom instead of muddying
    ctx.globalCompositeOperation = "lighter";
    const sc = 1 + push * 0.06;
    ctx.setTransform(sc, 0, 0, sc, (W / 2) * (1 - sc), (H / 2) * (1 - sc));
    for (let i = 0; i < parts.length; i++) fn(parts[i], i);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // event sparks hang in the air while time is stopped in the zone
    drawMotes(dt * Math.max(0.12, timeScale));
    ctx.globalCompositeOperation = "source-over";
    if (vignette) { ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H); }
    // danger: the edges of the world throb red in time with the heartbeat
    // (every other beat at first, every beat near the top)
    if (danger > 0.3 && dangerGlow) {
      const d = (danger - 0.3) / 0.7;
      const onHeart = beat.active && (danger > 0.7 || beat.n % 2 === 0);
      const throb = onHeart ? Math.pow(Math.max(0, 1 - beat.phase), 4) : 0;
      ctx.globalAlpha = Math.min(1, d * (0.3 + throb * 0.7));
      ctx.fillStyle = dangerGlow;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }
  }

  parts = makeParticles(theme);

  return {
    setTheme,
    frame,
    beat(strength = 0.6) { energy = Math.min(1, energy + strength); },
    burst,
    setZone(v) { zoneMode = v; },
    setZoneTension(v) { zoneTension = Math.max(0, Math.min(1, v)); },
    setIntensity(v) { intensity = Math.max(0, Math.min(1, v)); },
    setDanger(v) { danger = Math.max(0, Math.min(1, v)); },
    get theme() { return theme; },
  };
})();

// ---------- board-space particles ----------
class BoardFX {
  constructor() {
    this.parts = [];
    this.trails = [];  // hard-drop light columns
    this.flashes = []; // freshly locked cells glinting
    this.shake = 0;
  }
  trail(x, y0, y1, w, color) {
    this.trails.push({ x, y0, y1, w, color, t: 0, life: 0.3 });
  }
  lockFlash(cells, size) {
    this.flashes.push({ cells, size, t: 0, life: 0.22 });
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
    for (const f of this.trails) f.t += dt;
    for (const f of this.flashes) f.t += dt;
    this.trails = this.trails.filter(f => f.t < f.life);
    this.flashes = this.flashes.filter(f => f.t < f.life);
  }
  draw(ctx) {
    ctx.globalCompositeOperation = "lighter";
    for (const f of this.trails) {
      const k = 1 - f.t / f.life;
      const w = f.w * (0.35 + 0.65 * k);
      const g = ctx.createLinearGradient(0, f.y0, 0, f.y1);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(1, f.color);
      ctx.globalAlpha = k * 0.55;
      ctx.fillStyle = g;
      ctx.fillRect(f.x + (f.w - w) / 2, f.y0, w, f.y1 - f.y0);
    }
    for (const f of this.flashes) {
      ctx.globalAlpha = (1 - f.t / f.life) * 0.5;
      ctx.fillStyle = "#ffffff";
      for (const [cx, cy] of f.cells) ctx.fillRect(cx * f.size + 2, cy * f.size + 2, f.size - 4, f.size - 4);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
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
        ctx.globalCompositeOperation = "lighter"; // sparks glow
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * k + 0.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalCompositeOperation = "source-over";
      }
    }
    ctx.globalAlpha = 1;
  }
}
