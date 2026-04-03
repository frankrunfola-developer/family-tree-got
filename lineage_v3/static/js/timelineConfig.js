// static/js/timelineConfig.js
// Single source of truth for Timeline “snake” layout knobs.

window.TIMELINE_CFG = {
  vars: {
    GAP_X: 10,
    GAP_Y: 10,
    PAD_X: 34,
    PAD_Y: 34,
    CARD_W: 240,
    CARD_H: 92,
    COLS: 3,
    ELBOW_X: 10,
    BLEED: 34,
    STROKE_W: 9,   // NEW (optional)
    ELBOW_R: 0,    // NEW (0 = auto)
  },
  safety: {
    MIN_PAD_X: 5,
    MIN_BLEED: 16,
    STROKE_PAD: 8,
  }
};