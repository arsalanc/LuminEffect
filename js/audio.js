// ============ PROCEDURAL AUDIO ============
// Everything is synthesized with WebAudio. Each map has a real tempo:
// a lookahead scheduler places a soft kick, offbeat hats and a quantized
// arpeggio on a sample-accurate 8th-note grid, and getBeat() exposes the
// beat phase so the visuals can breathe on the same clock.

const AudioSys = (() => {
  let ctx = null;
  let master, padGain, padFilter, padOscs = [];
  let theme = null;
  let enabled = true;
  let intensity = 0; // 0..1 danger/level signal from the game
  let volume = 0.7;  // user volume 0..1, applied to master gain
  let phase = 1;     // journey stage phase: 0 calm intro, 1 full groove, 2 climax
  let zoneActive = false;

  // ---- beat clock ----
  const LOOKAHEAD = 0.15;      // seconds scheduled ahead
  let schedTimer = null;
  let nextStepTime = 0;        // when the next 8th-note fires
  let step = 0;                // 8th-note counter (8 per bar)
  let anchorTime = 0;          // time of the last downbeat, for phase math
  let tempoScale = 1;          // zone halves this

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return false; }
    master = ctx.createGain();
    master.gain.value = volume * 0.75;
    master.connect(ctx.destination);
    return true;
  }

  function resume() {
    // mobile browsers suspend the context on tab switch / screen lock and
    // can report "interrupted" (iOS) — always try to bring it back
    if (ensure() && ctx.state !== "running") {
      const p = ctx.resume();
      if (p && p.catch) p.catch(() => {});
    }
  }

  function noteFreq(root, scale, degree, octave = 0) {
    const idx = ((degree % scale.length) + scale.length) % scale.length;
    const oct = octave + Math.floor(degree / scale.length);
    return root * Math.pow(2, (scale[idx] + 12 * oct) / 12);
  }

  function beatDur() {
    const bpm = theme ? theme.audio.bpm : 80;
    return 60 / (bpm * tempoScale);
  }

  // ---- ambient pad ----
  function startPad() {
    stopPad();
    if (!theme || !ctx) return;
    const a = theme.audio;
    padFilter = ctx.createBiquadFilter();
    padFilter.type = "lowpass";
    padFilter.frequency.value = a.padCutoff;
    padFilter.Q.value = 0.7;

    padGain = ctx.createGain();
    padGain.gain.value = 0;
    padGain.gain.linearRampToValueAtTime(a.padLevel || 0.10, ctx.currentTime + 3);
    padFilter.connect(padGain);
    padGain.connect(master);

    // root + fifth, slightly detuned pairs for width
    const freqs = [
      noteFreq(a.root, a.scale, 0, 0),
      noteFreq(a.root, a.scale, 0, 0) * 1.003,
      noteFreq(a.root, a.scale, 2, 0),
      noteFreq(a.root, a.scale, 0, 1) * 0.997,
    ];
    padOscs = freqs.map(f => {
      const o = ctx.createOscillator();
      o.type = a.wave === "sawtooth" ? "sawtooth" : "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.25;
      o.connect(g); g.connect(padFilter);
      o.start();
      return o;
    });

    // slow filter breathing (LFO period locked to 4 bars)
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1 / (beatDur() * 16);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = a.padCutoff * 0.4;
    lfo.connect(lfoGain); lfoGain.connect(padFilter.frequency);
    lfo.start();
    padOscs.push(lfo);
  }

  function stopPad() {
    if (padGain && ctx) {
      const g = padGain;
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
    }
    const olds = padOscs;
    padOscs = [];
    if (ctx) setTimeout(() => olds.forEach(o => { try { o.stop(); } catch (e) {} }), 1200);
  }

  // ---- rhythm section ----
  function kick(when, vol = 0.09) {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(110, when);
    o.frequency.exponentialRampToValueAtTime(42, when + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, when);
    g.gain.exponentialRampToValueAtTime(0.0001, when + 0.28);
    o.connect(g); g.connect(master);
    o.start(when); o.stop(when + 0.32);
  }

  function hat(when, vol = 0.02) {
    const len = Math.floor(ctx.sampleRate * 0.05);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "highpass"; f.frequency.value = 6500;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(when);
  }

  function scheduleStep(s, when) {
    const a = theme.audio;
    const inBar = s % 8;
    // kick pattern (kickEvery is in 8th-note steps); danger hits harder,
    // calm phase thins to one kick per bar, climax doubles up
    const kv = (1 + intensity * 0.35) * (a.kickLevel || 1);
    const kickStep = phase === 2 ? Math.min(2, a.kickEvery) : phase === 0 ? 8 : a.kickEvery;
    if (inBar % kickStep === 0) kick(when, (inBar === 0 ? 0.10 : 0.07) * kv);
    // offbeat hats — appear in climax phase or as danger rises
    if ((a.hat || phase === 2 || intensity > 0.55) && inBar % 2 === 1) hat(when, 0.02 + intensity * 0.015);
    // quantized arpeggio: calm phase drops the offbeat notes, climax lifts
    // an octave and leans in harder
    const degree = a.arp[inBar];
    const calmSkip = phase === 0 && inBar % 2 === 1;
    if (degree !== null && degree !== undefined && !calmSkip) {
      const phVol = phase === 0 ? 0.75 : phase === 2 ? 1.2 : 1;
      const vol = (inBar === 0 ? 0.045 : 0.028) * (1 + intensity * 0.6) * (a.arpLevel || 1) * phVol;
      const octave = (intensity > 0.65 || phase === 2) ? 1 : 0;
      pluck(noteFreq(a.root * 2, a.scale, degree, octave), vol, beatDur() * 1.6, "sine", when);
    }
    if (inBar === 0) {
      anchorTime = when;
      // pad brightens with stack danger and stage climax
      const bright = Math.min(1, intensity + (phase === 2 ? 0.35 : 0));
      if (padFilter) padFilter.frequency.setTargetAtTime(a.padCutoff * (1 + bright * 1.4), when, 0.5);
    }
  }

  function startClock() {
    stopClock();
    if (!ctx || !theme) return;
    tempoScale = 1; // a fresh clock never inherits zone time-dilation
    step = 0;
    nextStepTime = ctx.currentTime + 0.1;
    anchorTime = nextStepTime;
    schedTimer = setInterval(() => {
      if (!enabled) return;
      if (ctx.state !== "running") { resume(); return; } // self-heal after suspension
      const stepDur = beatDur() / 2; // 8th notes
      while (nextStepTime < ctx.currentTime + LOOKAHEAD) {
        scheduleStep(step, nextStepTime);
        step++;
        nextStepTime += stepDur;
      }
    }, 30);
  }

  function stopClock() {
    if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
  }

  // ---- one-shot voices ----
  function pluck(freq, vol = 0.05, dur = 0.4, type = "sine", when = null) {
    if (!ctx || !enabled || ctx.state !== "running") return;
    const t = when != null ? when : ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  function noise(dur = 0.15, vol = 0.08, cutoff = 1200) {
    if (!ctx || !enabled || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = cutoff;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t);
  }

  function deg(d, oct = 0) {
    const a = theme ? theme.audio : { root: 220, scale: [0, 3, 5, 7, 10] };
    return noteFreq(a.root * 2, a.scale, d, oct);
  }

  // ---- public API ----
  return {
    unlock() { resume(); },
    setEnabled(v) { enabled = v; },
    setIntensity(v) { intensity = Math.max(0, Math.min(1, v)); },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (ctx && master) master.gain.setTargetAtTime(volume * 0.75, ctx.currentTime, 0.05);
    },
    setTheme(t) {
      theme = t;
      phase = 1; // every new track starts at neutral groove
      if (!ctx) return;
      startPad();
      startClock();
    },
    setPhase(p) { phase = p; },
    phaseShift() {
      // rising sweep marking a mid-stage escalation
      noise(0.7, 0.05, 2500);
      [0, 2, 4, 7].forEach((d, i) => setTimeout(() => pluck(deg(d, 1), 0.04, 0.7), i * 90));
    },
    stopMusic() { stopPad(); stopClock(); },
    playingThemeId() {
      return (theme && schedTimer) ? theme.id : null;
    },

    // Zone dilates time: the whole groove drops to half tempo.
    setZoneTempo(active) {
      zoneActive = active;
      tempoScale = active ? 0.5 : 1;
      if (ctx && theme && schedTimer) {
        // re-anchor so the visual phase doesn't jump
        anchorTime = ctx.currentTime;
        nextStepTime = Math.max(nextStepTime, ctx.currentTime + 0.05);
        step = 0;
      }
    },

    // Beat phase for the visuals: phase 0 = right on the beat.
    getBeat() {
      if (!ctx || !theme || !schedTimer || ctx.state !== "running") {
        return { phase: 1, active: false, bpm: 0 };
      }
      const bd = beatDur();
      let phase = ((ctx.currentTime - anchorTime) / bd) % 1;
      if (phase < 0) phase += 1;
      return { phase, active: true, bpm: theme.audio.bpm * tempoScale };
    },

    move()   { pluck(deg(0, 1), 0.018, 0.08); },
    rotate() { pluck(deg(2, 1), 0.025, 0.1); },
    hold()   { pluck(deg(4, 0), 0.03, 0.2, "triangle"); },
    softDrop() { pluck(deg(0, 0), 0.012, 0.06); },
    hardDrop() { noise(0.12, 0.10, 900); pluck(deg(0, -1), 0.05, 0.15, "triangle"); },
    lock()   { noise(0.06, 0.05, 1500); },

    clear(lines, combo = 0) {
      // richer chord for bigger clears; combos climb the scale
      const shift = Math.min(combo, 6);
      const degrees = [[0], [0, 2], [0, 2, 4], [0, 2, 4, 7]][Math.min(lines, 4) - 1] || [0];
      degrees.forEach((d, i) => setTimeout(() => pluck(deg(d + shift, 1), 0.06, 0.9), i * 55));
      noise(0.2, 0.06, 2200);
    },
    tspin() { pluck(deg(3, 1), 0.06, 0.5, "triangle"); pluck(deg(3, 2), 0.04, 0.7); },
    b2b()   { pluck(deg(4, 2), 0.04, 0.8); },
    perfect() {
      [0, 2, 4, 7, 9].forEach((d, i) => setTimeout(() => pluck(deg(d, 1), 0.06, 1.4), i * 90));
    },
    levelUp() {
      [0, 4, 7].forEach((d, i) => setTimeout(() => pluck(deg(d, 1), 0.05, 0.8, "triangle"), i * 100));
    },
    // tension builds as zone lines bank: the slowed groove creeps back up
    // toward full speed the deeper the stack goes
    setZoneTension(t) {
      if (zoneActive) tempoScale = 0.5 + Math.min(1, t) * 0.45;
    },
    // every banked line rings one note higher than the last
    zoneLine(count) {
      pluck(deg(count, 1), 0.05, 0.55);
      noise(0.07, 0.05, 3200);
    },
    zoneStart() {
      noise(0.8, 0.05, 500);
      [4, 2, 0].forEach((d, i) => setTimeout(() => pluck(deg(d, 0), 0.06, 1.2), i * 140));
    },
    zoneEnd(lines) {
      const n = Math.min(10, Math.max(3, lines));
      for (let i = 0; i < n; i++) setTimeout(() => pluck(deg(i, 1), 0.05, 0.9), i * 70);
      noise(0.5, 0.09, 3000);
    },
    gameOver() {
      [4, 3, 1, 0].forEach((d, i) => setTimeout(() => pluck(deg(d, 0), 0.06, 1.5), i * 220));
    },
  };
})();
