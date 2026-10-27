// ============ PROCEDURAL AUDIO ============
// Everything is synthesized with WebAudio. Each map has a real tempo:
// a lookahead scheduler places a soft kick, offbeat hats, a bass line and a
// quantized arpeggio on a sample-accurate 8th-note grid, and getBeat()
// exposes the beat phase so the visuals can breathe on the same clock.
//
// Signal chain:
//   music voices → zone lowpass ┬→ compressor → master
//                               ├→ reverb ────┘
//                               └→ ping-pong delay
//   player sfx → (bypass zone lowpass) → same reverb / delay / compressor
//
// Harmony moves through a per-map chord progression; the pad glides between
// chords and every player sound (move, rotate, clear...) is pitched from the
// chord that is sounding right now, so your play is part of the music.
// Clear sounds snap to the groove's grid, a formant "voice" sings each map's
// melody as the stage builds, and a heartbeat creeps in when the stack is
// close to the top.

const AudioSys = (() => {
  let ctx = null;
  let master, comp, sfxIn, reverb, revIn, revOut, dlyIn, dlyL, dlyR;
  let musicDry, musicRev, musicDly; // zone lowpasses in front of each music path
  let padGain, padDuck, padDanger, padFilter, padOscs = [], padVoices = [];
  let irKey = null;
  let theme = null;
  let enabled = true;
  let intensity = 0; // 0..1 danger/level signal from the game
  let volume = 0.7;  // user volume 0..1, applied to master gain
  let phase = 1;     // journey stage phase: 0 calm intro, 1 full groove, 2 climax
  let zoneActive = false;
  let zoneCut = 0;   // last zone lowpass target, to avoid re-automating every frame
  let pan = 0;       // stereo position of the active piece, -1..1
  let danger = 0;    // 0..1 how close the stack is to topping out
  let quantize = true; // snap clear sounds to the beat grid

  // ---- beat clock ----
  const LOOKAHEAD = 0.15;      // seconds scheduled ahead
  let schedTimer = null;
  let nextStepTime = 0;        // when the next 8th-note fires
  let step = 0;                // 8th-note counter (8 per bar)
  let anchorTime = 0;          // time of the last downbeat, for phase math
  let tempoScale = 1;          // zone halves this

  // ---- harmony ----
  let bar = -1;                // bars since the clock started
  let schedChord = 0;          // chord root (scale degree) at the scheduler's horizon
  let chord = 0;               // chord root that is audible right now

  function panner(p) {
    if (ctx.createStereoPanner) {
      const n = ctx.createStereoPanner();
      n.pan.value = p;
      return n;
    }
    return ctx.createGain(); // very old Safari: mono is fine
  }

  function lowpass(freq, dest) {
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = freq; f.Q.value = 0.8;
    if (dest) f.connect(dest);
    return f;
  }

  function ensure() {
    if (ctx) return true;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    } catch (e) { return false; }
    master = ctx.createGain();
    master.gain.value = volume * 0.75;
    master.connect(ctx.destination);

    // gentle bus compression glues the layers and catches big clear chords
    comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 3.5;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    comp.connect(master);
    sfxIn = ctx.createGain();
    sfxIn.connect(comp);

    reverb = ctx.createConvolver();
    revIn = ctx.createGain();
    revOut = ctx.createGain(); revOut.gain.value = 0.35;
    revIn.connect(reverb); reverb.connect(revOut); revOut.connect(comp);

    // tempo-synced ping-pong delay; echoes darken and melt into the reverb
    dlyIn = ctx.createGain(); dlyIn.gain.value = 0.3;
    dlyL = ctx.createDelay(3); dlyR = ctx.createDelay(3);
    const tone = lowpass(2600);
    const fb = ctx.createGain(); fb.gain.value = 0.38;
    const pl = panner(-0.75), pr = panner(0.75);
    dlyIn.connect(dlyL); dlyL.connect(pl); dlyL.connect(dlyR); dlyR.connect(pr);
    dlyR.connect(tone); tone.connect(fb); fb.connect(dlyL);
    const melt = ctx.createGain(); melt.gain.value = 0.3;
    [pl, pr].forEach(p => { p.connect(comp); p.connect(melt); });
    melt.connect(revIn);

    musicDry = lowpass(20000, comp);
    musicRev = lowpass(20000, revIn);
    musicDly = lowpass(20000, dlyIn);
    zoneCut = 20000;
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

  // Connect a voice's output: music goes through the zone lowpass, sfx
  // bypasses it so your own sounds stay crisp while the world is muffled.
  function route(node, { music = false, pan: p = 0, rev = 0, dly = 0 } = {}) {
    let out = node;
    if (p) { const pn = panner(Math.max(-1, Math.min(1, p))); node.connect(pn); out = pn; }
    out.connect(music ? musicDry : sfxIn);
    if (rev > 0) send(out, music ? musicRev : revIn, rev);
    if (dly > 0) send(out, music ? musicDly : dlyIn, dly);
  }

  function send(from, to, amt) {
    const g = ctx.createGain();
    g.gain.value = amt;
    from.connect(g); g.connect(to);
  }

  // Synthetic room: stereo noise with an exponential tail that darkens as
  // it decays, like air absorbing the highs. Built a quarter-second at a
  // time across timer ticks (a 6s room is ~600k samples, a visible hitch
  // if done in one go mid-game), cached per size, and capped at 4s — past
  // that the tail is under -25dB and only costs the audio thread.
  const irCache = new Map();
  let irJob = 0;
  function setRoom(seconds, wet) {
    revOut.gain.setTargetAtTime(wet, ctx.currentTime, 0.5);
    const key = seconds.toFixed(2);
    if (irKey === key) return;
    irKey = key;
    if (irCache.has(key)) { reverb.buffer = irCache.get(key); return; }
    const job = ++irJob;
    const rate = ctx.sampleRate;
    const full = Math.floor(rate * seconds);
    const len = Math.min(full, Math.floor(rate * 4));
    const buf = ctx.createBuffer(2, len, rate);
    const chans = [buf.getChannelData(0), buf.getChannelData(1)];
    const lp = [0, 0];
    const chunk = Math.floor(rate * 0.25);
    let i = Math.floor(rate * 0.018); // pre-delay
    (function work() {
      if (job !== irJob) return; // a newer room superseded this one
      const end = Math.min(len, i + chunk);
      for (let ch = 0; ch < 2; ch++) {
        const d = chans[ch];
        let l = lp[ch];
        for (let j = i; j < end; j++) {
          const k = j / full;
          l += ((Math.random() * 2 - 1) - l) * (0.92 - 0.8 * k);
          const fadeOut = j > len * 0.9 ? (len - j) / (len * 0.1) : 1; // no click where the cap cuts
          d[j] = l * Math.pow(1 - k, 2.6) * fadeOut;
        }
        lp[ch] = l;
      }
      i = end;
      if (i < len) setTimeout(work, 0);
      else { irCache.set(key, buf); reverb.buffer = buf; }
    })();
  }

  function syncDelay(tc = 0.05) {
    if (!theme || !dlyL) return;
    const t = Math.min(2.5, beatDur() * 0.75); // dotted 8th
    dlyL.delayTime.setTargetAtTime(t, ctx.currentTime, tc);
    dlyR.delayTime.setTargetAtTime(t, ctx.currentTime, tc);
  }

  // inside the zone the music sinks underwater; sfx stay on top
  function zoneCutoff(freq, tc) {
    if (!ctx || Math.abs(freq - zoneCut) < 40) return;
    zoneCut = freq;
    [musicDry, musicRev, musicDly].forEach(f => f.frequency.setTargetAtTime(freq, ctx.currentTime, tc));
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
  // chord voicing stacked in scale steps: root, root (detuned), 3rd, 5th, octave
  function padFreqs(c) {
    const a = theme.audio;
    return [
      noteFreq(a.root, a.scale, c, 0),
      noteFreq(a.root, a.scale, c, 0) * 1.003,
      noteFreq(a.root, a.scale, c + 2, 0),
      noteFreq(a.root, a.scale, c + 4, 0),
      noteFreq(a.root, a.scale, c, 1) * 0.997,
    ];
  }

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
    padDuck = ctx.createGain(); // sidechain: the kick pushes the pad down
    padDanger = ctx.createGain(); // the pad drains away as danger rises
    padDanger.gain.value = 1 - danger * 0.6;
    padFilter.connect(padGain);
    padGain.connect(padDanger);
    padDanger.connect(padDuck);
    route(padDuck, { music: true, rev: 0.7 });

    padVoices = padFreqs(schedChord).map((f, i) => {
      const o = ctx.createOscillator();
      o.type = a.wave === "sawtooth" ? "sawtooth" : "sine";
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = 0.2;
      o.connect(g);
      // spread the voicing across the stereo field
      if (ctx.createStereoPanner) {
        const p = panner([0, 0, -0.45, 0.45, 0][i]);
        g.connect(p); p.connect(padFilter);
      } else g.connect(padFilter);
      o.start();
      return o;
    });
    padOscs = padVoices.slice();

    // slow filter breathing (LFO period locked to 4 bars)
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1 / (beatDur() * 16);
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = a.padCutoff * 0.4;
    lfo.connect(lfoGain); lfoGain.connect(padFilter.frequency);
    lfo.start();
    padOscs.push(lfo);
  }

  function retunePad(c, when) {
    const fs = padFreqs(c);
    padVoices.forEach((o, i) => o.frequency.setTargetAtTime(fs[i], when, 0.3)); // glide
  }

  function stopPad() {
    if (padGain && ctx) {
      const g = padGain;
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + 1);
    }
    const olds = padOscs;
    padOscs = []; padVoices = [];
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
    o.connect(g);
    route(g, { music: true, rev: 0.06 });
    o.start(when); o.stop(when + 0.32);
    // pump the pad around the kick
    if (padDuck) {
      const depth = (theme.audio.pump || 0.25) * (phase === 0 ? 0.5 : 1);
      padDuck.gain.setTargetAtTime(1 - depth, when, 0.01);
      padDuck.gain.setTargetAtTime(1, when + 0.06, 0.13);
    }
  }

  function hat(when, vol = 0.02, p = 0) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf(0.05);
    const f = ctx.createBiquadFilter();
    f.type = "highpass"; f.frequency.value = 6500;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g);
    route(g, { music: true, pan: p, rev: 0.15 });
    src.start(when);
  }

  function bass(freq, when, dur, vol) {
    const o = ctx.createOscillator();
    o.type = "triangle";
    o.frequency.value = freq;
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = freq;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(320 + intensity * 500 + (phase === 2 ? 300 : 0), when);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, when);
    g.gain.linearRampToValueAtTime(vol, when + 0.02);
    g.gain.setTargetAtTime(vol * 0.6, when + 0.05, dur * 0.3);
    g.gain.setTargetAtTime(0.0001, when + dur, 0.06);
    o.connect(f); sub.connect(f); f.connect(g);
    route(g, { music: true, rev: 0.08 });
    o.start(when); sub.start(when);
    o.stop(when + dur + 0.4); sub.stop(when + dur + 0.4);
  }

  // lub-dub: two low, dry thumps
  function heartbeat(when, vol) {
    [[0, 1, 62], [0.17, 0.65, 54]].forEach(([off, amp, f0]) => {
      const t = when + off;
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(f0, t);
      o.frequency.exponentialRampToValueAtTime(f0 * 0.6, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol * amp, t + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
      o.connect(g);
      route(g, { music: true, rev: 0.05 });
      o.start(t); o.stop(t + 0.25);
    });
  }

  // Formant "voice": two detuned saws through vowel resonances, with a
  // slow swell and delayed vibrato, so the lead reads as a distant singer
  // rather than a synth.
  const VOWELS = {
    a: [[800, 1], [1150, 0.5], [2900, 0.18]],
    o: [[450, 1], [800, 0.45], [2830, 0.1]],
    u: [[325, 1], [700, 0.3], [2530, 0.06]],
    e: [[400, 1], [1700, 0.45], [2600, 0.2]],
  };
  function vox(freq, when, dur, vol, vowel = "a", opts = {}) {
    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, when);
    out.gain.linearRampToValueAtTime(vol, when + Math.min(0.12, dur * 0.4));
    out.gain.setTargetAtTime(vol * 0.8, when + 0.15, 0.4);
    out.gain.setTargetAtTime(0.0001, when + dur, 0.12);
    route(out, opts);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const depth = ctx.createGain();
    depth.gain.setValueAtTime(0, when);
    depth.gain.linearRampToValueAtTime(freq * 0.014, when + Math.min(0.5, dur * 0.6));
    vib.connect(depth);
    const end = when + dur + 0.8;
    [1, 1.004].forEach(detune => {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = freq * detune;
      depth.connect(o.frequency);
      (VOWELS[vowel] || VOWELS.a).forEach(([ff, amp]) => {
        const bp = ctx.createBiquadFilter();
        bp.type = "bandpass"; bp.frequency.value = ff; bp.Q.value = ff / 90;
        const g = ctx.createGain(); g.gain.value = amp;
        o.connect(bp); bp.connect(g); g.connect(out);
      });
      o.start(when); o.stop(end);
    });
    vib.start(when); vib.stop(end);
  }

  function scheduleStep(s, when) {
    const a = theme.audio;
    const inBar = s % 8;
    const stepDur = beatDur() / 2;
    if (inBar === 0) {
      anchorTime = when;
      // advance the progression on the downbeat; the pad glides to it and
      // realtime sfx pick it up the moment it becomes audible
      bar++;
      const prog = a.prog || [0];
      const c = prog[Math.floor(bar / (a.chordBars || 1)) % prog.length];
      if (c !== schedChord) retunePad(c, when);
      schedChord = c;
      setTimeout(() => { chord = c; }, Math.max(0, (when - ctx.currentTime) * 1000));
      // pad brightens with stack danger and stage climax
      const bright = Math.min(1, intensity + (phase === 2 ? 0.35 : 0));
      if (padFilter) padFilter.frequency.setTargetAtTime(a.padCutoff * (1 + bright * 1.4), when, 0.5);
      if (padDanger) padDanger.gain.setTargetAtTime(1 - danger * 0.6, when, 0.8);
    }
    // heartbeat: every other beat once the stack climbs, every beat near the top
    if (danger > 0.3 && inBar % (danger > 0.7 ? 2 : 4) === 0) heartbeat(when, 0.05 + danger * 0.07);
    // kick pattern (kickEvery is in 8th-note steps); danger hits harder,
    // calm phase thins to one kick per bar, climax doubles up
    const kv = (1 + intensity * 0.35) * (a.kickLevel || 1);
    const kickStep = phase === 2 ? Math.min(2, a.kickEvery) : phase === 0 ? 8 : a.kickEvery;
    if (inBar % kickStep === 0) kick(when, (inBar === 0 ? 0.10 : 0.07) * kv);
    // offbeat hats — appear in climax phase or as danger rises
    if ((a.hat || phase === 2 || intensity > 0.55) && inBar % 2 === 1) {
      hat(when, 0.02 + intensity * 0.015, inBar % 4 === 1 ? -0.3 : 0.3);
    }
    // bass enters once the groove does (2 in the pattern = octave up)
    const bassHit = (a.bass || [1])[inBar];
    if (bassHit && phase >= 1 && a.bassLevel !== 0) {
      const f = noteFreq(a.root / 2, a.scale, schedChord, bassHit - 1);
      bass(f, when, stepDur * (a.bassLen || 3), 0.035 * (a.bassLevel || 1) * (1 + intensity * 0.3));
    }
    // quantized arpeggio over the current chord: calm phase drops the
    // offbeat notes, climax lifts an octave and leans in harder
    const degree = a.arp[inBar];
    const calmSkip = phase === 0 && inBar % 2 === 1;
    if (degree !== null && degree !== undefined && !calmSkip) {
      const phVol = phase === 0 ? 0.75 : phase === 2 ? 1.2 : 1;
      const vol = (inBar === 0 ? 0.045 : 0.028) * (1 + intensity * 0.6) * (a.arpLevel || 1) * phVol;
      const octave = (intensity > 0.65 || phase === 2) ? 1 : 0;
      pluck(noteFreq(a.root * 2, a.scale, degree + schedChord, octave), vol, beatDur() * 1.6, "sine", when,
        { music: true, pan: (inBar % 4 - 1.5) * 0.25, rev: 0.45, dly: a.delay || 0.3 });
    }
    // melody: 2-bar phrases sung over the chords. The build sings every
    // other phrase (call, then space to answer); the climax sings every
    // phrase with a harmony a step above.
    const mel = a.melody;
    if (mel && phase >= 1) {
      const ph = Math.floor(bar / 2);
      if (phase === 2 || ph % 2 === 1) {
        const at = (bar % 2) * 8 + inBar;
        const phrase = mel.phrases[ph % mel.phrases.length];
        for (const [st, d, len] of phrase) {
          if (st !== at) continue;
          const dur = stepDur * len;
          const v = 0.11 * (mel.level || 1) * (1 + intensity * 0.3);
          vox(noteFreq(a.root * 2, a.scale, schedChord + d, 0), when, dur, v, mel.vowel,
            { music: true, pan: -0.15, rev: 0.75, dly: 0.5 });
          if (phase === 2) {
            vox(noteFreq(a.root * 2, a.scale, schedChord + d + 2, 0), when, dur, v * 0.55, mel.vowel,
              { music: true, pan: 0.35, rev: 0.8, dly: 0.4 });
          }
        }
      }
    }
    // climax: glassy bells sparkle high above the groove
    if (phase === 2 && (inBar === 3 || inBar === 6)) {
      bell(noteFreq(a.root * 4, a.scale, schedChord + (inBar === 3 ? 4 : 2), 0), 0.016, 1.4, when,
        { music: true, pan: inBar === 3 ? 0.55 : -0.55, rev: 0.7, dly: 0.8 });
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
  function pluck(freq, vol = 0.05, dur = 0.4, type = "sine", when = null, opts = { rev: 0.3 }) {
    if (!ctx || !enabled || ctx.state !== "running") return;
    const t = when != null ? when : ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.004); // tiny attack, no click
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    route(g, opts);
    o.start(t); o.stop(t + dur + 0.05);
  }

  // struck-bar bell: inharmonic partials, the upper ones dying first
  function bell(freq, vol = 0.04, dur = 1.2, when = null, opts = { rev: 0.6, dly: 0.4 }) {
    if (!ctx || !enabled || ctx.state !== "running") return;
    const t = when != null ? when : ctx.currentTime;
    const out = ctx.createGain();
    route(out, opts);
    [[1, 1, 1], [2.76, 0.32, 0.45], [5.4, 0.12, 0.25]].forEach(([ratio, amp, life]) => {
      const o = ctx.createOscillator();
      o.frequency.value = freq * ratio;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(vol * amp, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur * life);
      o.connect(g); g.connect(out);
      o.start(t); o.stop(t + dur * life + 0.05);
    });
  }

  // Next point on the groove's grid (16ths, or 32nds at slow tempos so the
  // wait never exceeds ~130ms): big moments land in time with the music.
  function onGrid() {
    const now = ctx.currentTime;
    if (!quantize || !schedTimer || !theme) return now;
    let g = beatDur() / 4;
    while (g > 0.13) g /= 2;
    const k = Math.ceil((now - anchorTime) / g - 1e-6);
    return Math.max(now, anchorTime + k * g);
  }

  // noise is generated once per length and reused: hats, locks and drops
  // fire constantly and allocating a fresh buffer each time feeds the GC
  const noiseCache = new Map();
  function noiseBuf(dur, decay = true) {
    const key = dur + (decay ? "d" : "f");
    let buf = noiseCache.get(key);
    if (buf) return buf;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (decay ? 1 - i / len : 1);
    noiseCache.set(key, buf);
    return buf;
  }

  function noise(dur = 0.15, vol = 0.08, cutoff = 1200, opts = { rev: 0.2 }, when = null) {
    if (!ctx || !enabled || ctx.state !== "running") return;
    const t = when != null ? when : ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf(dur);
    const f = ctx.createBiquadFilter();
    f.type = "lowpass"; f.frequency.value = cutoff;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f); f.connect(g);
    route(g, opts);
    src.start(t);
  }

  // filtered-noise whoosh: a riser when f1 > f0, a downsweep otherwise
  function sweep(dur, f0, f1, vol, opts = { rev: 0.6, dly: 0.3 }) {
    if (!ctx || !enabled || ctx.state !== "running") return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf(dur, false);
    const f = ctx.createBiquadFilter();
    f.type = "bandpass"; f.Q.value = 1.4;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    const peak = f1 > f0 ? t + dur * 0.9 : t + dur * 0.1;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, peak);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g);
    route(g, opts);
    src.start(t);
  }

  // deep sub impact for the big moments
  function boom(vol = 0.16, when = null) {
    if (!ctx || !enabled || ctx.state !== "running") return;
    const t = when != null ? when : ctx.currentTime;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(30, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.3);
    o.connect(g);
    route(g, { rev: 0.25 });
    o.start(t); o.stop(t + 1.4);
  }

  function deg(d, oct = 0) {
    const a = theme ? theme.audio : { root: 220, scale: [0, 3, 5, 7, 10] };
    return noteFreq(a.root * 2, a.scale, d + chord, oct);
  }

  const here = (rev = 0.3, dly = 0) => ({ pan: pan * 0.6, rev, dly });

  // ---- public API ----
  return {
    unlock() { resume(); },
    setEnabled(v) { enabled = v; },
    setIntensity(v) { intensity = Math.max(0, Math.min(1, v)); },
    setPan(v) { pan = Math.max(-1, Math.min(1, v)); },
    setDanger(v) { danger = Math.max(0, Math.min(1, v)); },
    setQuantize(v) { quantize = !!v; },
    setVolume(v) {
      volume = Math.max(0, Math.min(1, v));
      if (ctx && master) master.gain.setTargetAtTime(volume * 0.75, ctx.currentTime, 0.05);
    },
    setTheme(t) {
      theme = t;
      phase = 1; // every new track starts at neutral groove
      const a = t.audio;
      bar = -1;
      schedChord = chord = (a.prog || [0])[0];
      if (!ctx) return;
      setRoom(a.reverb || 3, a.wet || 0.35);
      dlyIn.gain.setTargetAtTime(a.delay || 0.3, ctx.currentTime, 0.2);
      startPad();
      startClock();
      syncDelay(0.01);
    },
    setPhase(p) { phase = p; },
    phaseShift() {
      // rising sweep marking a mid-stage escalation
      sweep(1.1, 300, 5000, 0.05);
      [0, 2, 4, 7].forEach((d, i) => setTimeout(() => pluck(deg(d, 1), 0.04, 0.7, "sine", null, { rev: 0.5, dly: 0.5, pan: -0.45 + i * 0.3 }), i * 90));
    },
    stopMusic() {
      stopPad(); stopClock();
      zoneActive = false;
      if (ctx) zoneCutoff(20000, 0.3);
    },
    playingThemeId() {
      return (theme && schedTimer) ? theme.id : null;
    },

    // Zone dilates time: the whole groove drops to half tempo and sinks
    // underwater behind a lowpass, with the room opening up around it.
    setZoneTempo(active) {
      zoneActive = active;
      tempoScale = active ? 0.5 : 1;
      if (ctx && theme && schedTimer) {
        // re-anchor so the visual phase doesn't jump
        anchorTime = ctx.currentTime;
        nextStepTime = Math.max(nextStepTime, ctx.currentTime + 0.05);
        step = 0;
        syncDelay(0.3); // echoes stretch with time — a tape-slow warble
        const wet = theme.audio.wet || 0.35;
        if (active) {
          zoneCutoff(650, 0.25);
          revOut.gain.setTargetAtTime(wet * 1.8, ctx.currentTime, 0.4);
        } else {
          zoneCutoff(20000, 0.06); // the world snaps back into focus
          revOut.gain.setTargetAtTime(wet, ctx.currentTime, 1.2);
        }
      }
    },

    // Beat phase for the visuals: phase 0 = right on the beat.
    getBeat() {
      if (!ctx || !theme || !schedTimer || ctx.state !== "running") {
        return { phase: 1, n: 0, active: false, bpm: 0 };
      }
      const bd = beatDur();
      const pos = (ctx.currentTime - anchorTime) / bd;
      const phase = pos - Math.floor(pos);
      const n = ((Math.floor(pos) % 4) + 4) % 4; // beat within the bar
      return { phase, n, active: true, bpm: theme.audio.bpm * tempoScale };
    },

    move()   { pluck(deg(0, 1), 0.018, 0.08, "sine", null, here(0.2)); },
    rotate() { pluck(deg(2, 1), 0.025, 0.1, "sine", null, here(0.3)); },
    hold()   { pluck(deg(4, 0), 0.03, 0.2, "triangle", null, here(0.5, 0.3)); },
    softDrop() { pluck(deg(0, 0), 0.012, 0.06, "sine", null, here(0.1)); },
    hardDrop() {
      noise(0.12, 0.10, 900, here(0.3));
      pluck(deg(0, -1), 0.06, 0.18, "triangle", null, here(0.3));
    },
    lock()   { noise(0.06, 0.05, 1500, here(0.15)); },

    clear(lines, combo = 0) {
      if (!ctx || ctx.state !== "running") return;
      // richer chord for bigger clears; combos climb the scale
      const t = onGrid();
      const shift = Math.min(combo, 6);
      const degrees = [[0], [0, 2], [0, 2, 4], [0, 2, 4, 7]][Math.min(lines, 4) - 1] || [0];
      degrees.forEach((d, i) =>
        pluck(deg(d + shift, 1), 0.06, 0.9, "sine", t + i * 0.055, { pan: (i - (degrees.length - 1) / 2) * 0.35, rev: 0.6, dly: 0.45 }));
      noise(0.2, 0.06, 2200, { rev: 0.4 }, t);
      if (lines >= 4) { bell(deg(7 + shift, 1), 0.035, 1.6, t); boom(0.1, t); }
    },
    tspin() {
      if (!ctx || ctx.state !== "running") return;
      const t = onGrid();
      pluck(deg(3, 1), 0.06, 0.5, "triangle", t, here(0.5, 0.4));
      bell(deg(3, 2), 0.03, 1.0, t, { pan: pan * 0.6, rev: 0.6, dly: 0.5 });
    },
    b2b() { if (ctx && ctx.state === "running") bell(deg(4, 2), 0.035, 1.2, onGrid()); },
    perfect() {
      if (!ctx || ctx.state !== "running") return;
      const t = onGrid();
      [0, 2, 4, 7, 9].forEach((d, i) => bell(deg(d, 1), 0.05, 1.8, t + i * 0.09, { pan: -0.6 + i * 0.3, rev: 0.7, dly: 0.6 }));
      boom(0.12, t);
    },
    levelUp() {
      sweep(0.9, 400, 4000, 0.035);
      [0, 4, 7].forEach((d, i) => setTimeout(() => pluck(deg(d, 1), 0.05, 0.8, "triangle", null, { rev: 0.5, dly: 0.5 }), i * 100));
    },
    // tension builds as zone lines bank: the slowed groove creeps back up
    // toward full speed and the underwater filter slowly lifts
    setZoneTension(t) {
      if (!zoneActive) return;
      tempoScale = 0.5 + Math.min(1, t) * 0.45;
      zoneCutoff(650 + Math.min(1, t) * 2600, 0.2);
    },
    // every banked line rings one bell higher than the last
    zoneLine(count) {
      if (!ctx || ctx.state !== "running") return;
      const t = onGrid();
      bell(deg(count, 1), 0.05, 1.1, t, { pan: ((count % 5) - 2) * 0.25, rev: 0.7, dly: 0.4 });
      noise(0.07, 0.05, 3200, { rev: 0.3 }, t);
    },
    zoneStart() {
      sweep(0.9, 5000, 220, 0.06, { rev: 0.8 });
      boom(0.09);
      [4, 2, 0].forEach((d, i) => setTimeout(() => pluck(deg(d, 0), 0.06, 1.2, "sine", null, { rev: 0.8, dly: 0.5 }), i * 140));
    },
    zoneEnd(lines) {
      if (!ctx || ctx.state !== "running") return;
      const t = onGrid();
      const n = Math.min(10, Math.max(3, lines));
      for (let i = 0; i < n; i++) {
        pluck(deg(i, 1), 0.05, 0.9, "sine", t + i * 0.07, { pan: (i / (n - 1)) * 1.2 - 0.6, rev: 0.6, dly: 0.5 });
      }
      noise(0.5, 0.09, 3000, { rev: 0.6 }, t);
      boom(0.12 + Math.min(0.06, lines * 0.004), t);
      if (lines >= 8) bell(deg(n, 2), 0.04, 2.2, t);
    },
    gameOver() {
      [4, 3, 1, 0].forEach((d, i) => setTimeout(() => pluck(deg(d, 0), 0.06, 1.5, "sine", null, { rev: 0.8, dly: 0.4 }), i * 220));
    },
  };
})();
