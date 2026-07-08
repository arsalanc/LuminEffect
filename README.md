# LUMINEFFECT

A browser-based tribute to *Tetris Effect* — pure HTML/CSS/JS, no build step, no dependencies.

## Play

Open `index.html` in any modern browser. That's it.

(Or serve it: `npx serve .` / `python -m http.server` and open the URL.)

## Modes

- **JOURNEY** — travel through all five maps in sequence. Reach each map's line goal to advance; speed rises with every stage.
- **CLASSIC** — marathon. Level up every 10 lines, win at level 15 (150 lines).
- **SPRINT** — 40 lines, race the clock. Random map each run; your best time is saved.
- **ZEN** — pick any map *and speed*, no game over, no pressure. Topping out just gently wipes the board.

## Settings

DAS (auto-repeat delay), ARR (auto-repeat rate, 0 = instant), volume, and ghost piece toggle — all persisted in localStorage.

## Maps

Five audiovisual worlds, each with its own palette, background particle system, and musical scale for the procedural soundtrack:

| Map | Mood |
|---|---|
| THE DEEP | abyssal bubbles, minor pentatonic |
| GOLDEN DUNES | drifting sand, warm major |
| AURORA FIELDS | northern-light ribbons |
| NEON CITY | synth rain on glass |
| EVENT HORIZON | starfield at the edge |

## The Zone

Line clears fill the **ZONE** meter. At 30%+ press **SHIFT** (or **ENTER**): time stops, and every line you clear freezes at the bottom of the field instead of vanishing. When the zone ends they all cash out at once — stack enough for an **OCTOTRIS**, **DODECATRIS**, **DECAHEXATRIS**...

## Controls

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

## Structure

- `js/engine.js` — pure game logic (no DOM), unit-testable
- `js/fx.js` — background particle systems + board particle FX
- `js/audio.js` — procedural WebAudio synth
- `js/themes.js` — map definitions
- `js/main.js` — game loop, input, rendering, UI, modes
