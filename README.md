# LUMINEFFECT

A browser-based tribute to *Tetris Effect* — pure HTML/CSS/JS, no build step, no dependencies.

## Play

Open `index.html` in any modern browser. That's it.

(Or serve it: `npx serve .` / `python -m http.server` and open the URL.)

## Modes

- **JOURNEY** — a constellation of 13 short stages across the six maps, played from a node map. Each stage is 1–2 minutes and takes ~3 to clear, so you can play in bursts; progress and stars persist between sessions. The stage order is an emotional arc — gentle opening, long build, climax at EVENT HORIZON, then a deliberate comedown.
- **CLASSIC** — marathon. Level up every 10 lines, win at level 15 (150 lines).
- **SPRINT** — 40 lines, race the clock. Random map each run; your best time is saved.
- **ZEN** — pick any map *and speed*, no game over, no pressure. Topping out just gently wipes the board.

### Effect modes

- **ULTRA** — three minutes, score as much as you can. Speed rises every 10 lines.
- **PURIFY** — dark garbage rows (marked with an X) rise from below, faster as you go. Clear lines through them to purify 60 dark blocks; your best time is saved.
- **MYSTERY** — every 16 seconds of play something changes. Curses: FOG (only a lantern around your piece shows the stack), UPSIDE DOWN, MIRROR (left is right), BLINDFOLD (next queue hidden), RUSH (3× gravity), SURGE (two garbage rows). Gifts: I-PIECE RAIN, CLEANSE (bottom rows vanish), CHARGE (full zone meter). And WORLD SHIFT jumps to another map. Events pause while you're in the Zone.
- **DAILY** — a two-minute score attack that's the same for everyone on a given day: the map, the twist (pure, rising garbage, or mystery events), the piece order and the events are all seeded from the date. Tracks today's best, your all-time daily best and your streak of consecutive days.

## Settings

DAS (auto-repeat delay), ARR (auto-repeat rate, 0 = instant), volume, effects quality, ghost piece, block patterns, reduce motion, snap-clear-sounds-to-beat, and phone vibration — all persisted in localStorage.

### Accessibility

- **BLOCK PATTERNS** — every piece type gets its own glyph (bar, square, triangle, slashes, dot, ring), so pieces can be told apart without relying on color.
- **REDUCE MOTION & FLASHING** — no board shake, no zone flash, softer row flashes, no shockwave rings or world flinch, a gentler beat pulse, a steady (not throbbing) danger glow, and fade-only text animations. On by default when the OS asks for reduced motion.

## Stats

The STATS screen keeps lifetime totals (games, time played, lines, pieces, tetrises, T-spins, perfect clears, zones, best zone, max combo, total score) and, per mode, games played, best result and the last five results. Runs quit from the pause menu count too.

### Effects quality

- **HIGH** — everything, including frosted-glass blur on the board and panels.
- **BALANCED** — no backdrop blur (panels go more opaque instead). The blur is by far the most expensive effect: the background animates every frame, so the browser has to re-blur every panel every frame.
- **LOW** — also renders the background at half resolution with fewer particles and sparks.
- **AUTO** (default) — starts at HIGH on desktop and BALANCED on touch devices, steps down a tier after ~2 seconds of sub-45fps play, and remembers where it settled. Picking AUTO again re-measures from the top.

## Maps

Six audiovisual worlds, each with its own palette, background particle system, and musical scale for the procedural soundtrack:

| Map | Mood |
|---|---|
| THE DEEP | abyssal bubbles, minor pentatonic |
| GOLDEN DUNES | drifting sand, warm major |
| AURORA FIELDS | northern-light ribbons |
| FIREFLY GROVE | blinking fireflies in a night forest, lydian pentatonic |
| NEON CITY | synth rain on glass |
| EVENT HORIZON | starfield at the edge |

## The Zone

Line clears fill the **ZONE** meter. At 30%+ press **SHIFT** (or **ENTER**): time stops, and every line you clear freezes at the bottom of the field instead of vanishing. When the zone ends they all cash out at once — stack enough for an **OCTOTRIS**, **DODECATRIS**, **DECAHEXATRIS**...

## Controls

Every keyboard action can be rebound in **CONTROLS** (two keys per action; ESC cancels, DEL clears a slot), which also has the soft drop speed (5× to 40×, or instant). Defaults:

| Key | Action |
|---|---|
| ← → | move (DAS auto-repeat) |
| ↓ | soft drop |
| SPACE | hard drop |
| Z / X or ↑ | rotate CCW / CW |
| C | hold |
| SHIFT / ENTER | activate zone |
| P / ESC | pause |

### Touch (phones/tablets)

| Gesture | Action |
|---|---|
| drag left/right | move (one column per cell-width) |
| tap right / left half | rotate CW / CCW |
| drag down | soft drop |
| flick down | hard drop |
| bottom buttons | hold · rotate · zone · pause |

Portrait mode re-arranges the HUD (next queue on top, board center, stats below); the whole playfield auto-scales to any screen.

## Mechanics

Guideline-style engine: SRS rotation with wall kicks, 7-bag randomizer, ghost piece, hold, 5-piece preview, lock delay with move resets, T-spins (full + mini), back-to-back bonus, combos, perfect clears. All audio is synthesized live with WebAudio — each map plays in its own scale, and every move, rotate, clear and zone event is a note in it.

## Audiovisual immersion

- **Harmony that moves** — each map cycles through its own chord progression. The pad glides between chords, a bass line follows the roots once the groove kicks in, and every player sound (move, rotate, clear, zone) is pitched from the chord playing at that moment, so your input always lands in tune with the track.
- **Space** — a synthesized reverb sized per map (tight for NEON CITY, cavernous for EVENT HORIZON) plus a tempo-synced ping-pong delay, glued by a bus compressor. The kick pumps the pad like a sidechain.
- **Stereo placement** — move, rotate, drop and lock sounds pan with the active piece's column.
- **A singing lead** — each map has its own melody, sung by a synthesized formant "voice" on its own vowel. In Journey it arrives with the build (a phrase, then space to answer) and sings every phrase with a harmony at the climax.
- **Clears land on the beat** — line clear, T-spin, perfect clear and zone sounds snap to the groove's grid (never more than ~130 ms late); the visuals stay instant. Can be turned off in settings.
- **Danger** — when the stack climbs past about 11 rows a heartbeat creeps in under the music (every beat near the top), the pad drains away, and the edges of the world and the rim of the well throb red with it.
- **Haptics** — on phones, hard drops, clears, the zone and game over vibrate (where the browser supports it).
- **The Zone sounds underwater** — the music sinks behind a lowpass and the room swells. Banking lines slowly lifts the filter, and cashing out snaps everything back into focus with a sub-bass impact. Your own sounds stay crisp the whole time.
- **The world reacts, in its own way** — bubbles swirl into a vortex in THE DEEP, sand gusts outward in GOLDEN DUNES, auroras flare, FIREFLY GROVE's fireflies light up in a wave and scatter, NEON CITY's rain bends away from the board, and EVENT HORIZON's stars stretch into hyperspace streaks. Line clears also fling sparks (bubbles, grains or light, depending on the map) in the cleared rows' colors out of the well and past the camera, with a shockwave ring and the background field flinching outward. Sparks freeze in mid-air during the Zone and fly when it ends. Hard drops leave light streaks, freshly locked pieces glint, and background particles blend additively under a soft vignette.

## Structure

The game is plain scripts loaded in order from `index.html` — no modules and no build step, so it runs straight from disk over `file://`. Top-level declarations are shared between scripts, so each file owns one concern:

**Game data and logic (no DOM — unit-tested in Node)**
- `js/themes.js` — map definitions: palette, particles and music
- `js/journey.js` — journey stages, map layout, progress/stars store
- `js/controls.js` — rebindable key actions and their storage
- `js/stats.js` — lifetime stats store
- `js/engine.js` — the Tetris engine: SRS, 7-bag (optionally seeded), scoring, zone, garbage
- `js/modes.js` — effect mode definitions, mystery events, daily challenge seeding and records

**Presentation**
- `js/audio.js` — procedural WebAudio synth and beat clock
- `js/fx.js` — background particle worlds and board particle FX

**Game shell** (split out of what used to be one big `main.js`)
- `js/app.js` — DOM handles, board geometry, the run's state, settings, shared helpers
- `js/render.js` — drawing the board, pieces, previews and HUD
- `js/flow.js` — a run from start to game over: engine events, mode rules, effect-mode runtime
- `js/input.js` — keyboard (rebindable, DAS/ARR) and touch gestures
- `js/quality.js` — effects tiers and the AUTO frame-time watchdog
- `js/screens.js` — journey map, menus, settings, effect modes, stats and controls screens
- `js/main.js` — frame loop, audio unlock, responsive layout, boot

## Tests

```
npm install
npm test            # both suites
npm run test:unit   # engine, modes, journey, controls, stats — Node only, ~1s
npm run test:e2e    # the real game in headless Chromium via Playwright, ~30s
```

Unit tests load the DOM-free scripts into a Node `vm` sandbox (`tests/load.js`). Browser tests open `index.html` from disk exactly as a player would, and fail on any page error. GitHub Actions runs both on every push to `main` and every pull request.

### Rendering notes

- Board cells are pre-rendered once per color/size/glow into sprite canvases and blitted with `drawImage`; no per-cell gradients or `shadowBlur` in the frame loop.
- The background sky, vignette, danger glow, beat halo and danger rim are CSS layers whose *opacity* is driven per frame (compositor-only); the background canvas itself is transparent and only draws particles, batched into a few paths per frame.
- HUD text and styles are written only when they change; hold/next previews redraw only when the queue changes.
- Noise buffers are generated once and reused; reverb impulses are built in small chunks across timer ticks and cached per room size.
