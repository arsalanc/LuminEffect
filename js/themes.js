// ============ THEMES / MAPS ============
// Each map defines the whole audiovisual identity of a stage:
// piece colors, background gradient + particle behavior, accent glow,
// and the musical scale the audio engine plays in.

const THEMES = [
  {
    id: "deepsea",
    name: "THE DEEP",
    sub: "abyssal drift",
    accent: "#4fd8ff",
    bgTop: "#020b1c", bgBottom: "#04304a",
    particles: "ocean",
    // I O T S Z J L
    pieceColors: ["#39e6ff", "#ffd76b", "#c592ff", "#5cf2b8", "#ff7fa5", "#5f8dff", "#ffb35c"],
    audio: {
      root: 110.0, scale: [0, 3, 5, 7, 10], wave: "sine", padCutoff: 900,
      bpm: 72, kickEvery: 4, hat: false,
      arp: [0, null, 2, null, 4, null, 2, null], // 8th-note steps, scale degrees
    },
  },
  {
    id: "dunes",
    name: "GOLDEN DUNES",
    sub: "wind over sand",
    accent: "#ffc46b",
    bgTop: "#1a0e05", bgBottom: "#5a3410",
    particles: "sand",
    pieceColors: ["#ffd98a", "#ffab4f", "#e08cff", "#9fe86e", "#ff8264", "#7fa8ff", "#ffcf5c"],
    audio: {
      root: 130.81, scale: [0, 2, 4, 7, 9], wave: "triangle", padCutoff: 1200,
      bpm: 84, kickEvery: 4, hat: false,
      arp: [0, 2, 4, 2, 3, 2, 4, 2],
    },
  },
  {
    id: "aurora",
    name: "AURORA FIELDS",
    sub: "lights over ice",
    accent: "#8affc9",
    bgTop: "#020614", bgBottom: "#0b2b33",
    particles: "aurora",
    pieceColors: ["#7dfff1", "#f6ff9e", "#d99eff", "#8aff9e", "#ff9ecb", "#8ab2ff", "#ffd08a"],
    audio: {
      root: 146.83, scale: [0, 2, 3, 7, 8], wave: "sine", padCutoff: 800,
      bpm: 76, kickEvery: 4, hat: false,
      arp: [0, null, 3, null, 2, null, 4, null],
    },
  },
  {
    id: "neon",
    name: "NEON CITY",
    sub: "rain on glass",
    accent: "#ff5fd0",
    bgTop: "#0a0212", bgBottom: "#2a0a3d",
    particles: "rain",
    pieceColors: ["#00f0ff", "#ffe600", "#ff2fd6", "#39ff88", "#ff3860", "#4d6bff", "#ff9130"],
    audio: {
      root: 98.0, scale: [0, 3, 5, 7, 10], wave: "sawtooth", padCutoff: 600,
      bpm: 100, kickEvery: 2, hat: true, // four-on-the-floor with offbeat hats
      arp: [0, 2, 4, 5, 3, 2, 4, 2],
    },
  },
  {
    id: "cosmos",
    name: "EVENT HORIZON",
    sub: "the edge of everything",
    accent: "#c9a6ff",
    bgTop: "#01010a", bgBottom: "#140a30",
    particles: "stars",
    pieceColors: ["#9be8ff", "#ffe9a6", "#cfa6ff", "#a6ffc4", "#ffa6c0", "#a6b4ff", "#ffcf9b"],
    audio: {
      root: 123.47, scale: [0, 2, 5, 7, 10], wave: "sine", padCutoff: 700,
      bpm: 66, kickEvery: 8, hat: false, // one deep pulse per bar
      arp: [0, null, null, 2, null, null, 4, null],
    },
  },
];

function themeById(id) {
  return THEMES.find(t => t.id === id) || THEMES[0];
}

// Audio-only pseudo-theme for the main menu: slow, soft, nowhere to be.
const MENU_THEME = {
  id: "menu",
  name: "MENU",
  audio: {
    root: 110.0, scale: [0, 2, 5, 7, 9], wave: "sine", padCutoff: 650,
    bpm: 58, kickEvery: 8, hat: false,
    arp: [0, null, null, 4, null, 2, null, null],
    padLevel: 0.085, kickLevel: 0.35, arpLevel: 0.75,
  },
};
