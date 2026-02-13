// static/js/treeConfig.js
// Single source of truth for tree rendering + layout knobs.
// Both tree.js and familyTree.js import this.

export const TREE_CFG = {
  dagre: {
    rankdir: "TB",
    ranksep: 45,
    nodesep: 200,
    marginx: 10,
    marginy: 10,
  },

  sizing: {
    CARD_W: 155,
    CARD_H: 180,
    CARD_R: 16,

    PHOTO_SIZE: 110,
    PHOTO_R: 55,
  },

  text: {
    NAME_Y: 138,
    META_Y: 158,
  },

  links: {
    // Elbow routing vertical drop (union -> child, and single-parent cases)
    STEM_LEN: 10,
    STEM_MIN: 6,
    STEM_FACTOR: 0.35, // 0 = fixed only

    // Couple connector controls
    // COUPLE_STEM: desired trunk height (join bar -> union point)
    // PARENT_STEM_MAX: cap for parent->join vertical drops (defaults to COUPLE_STEM)
    COUPLE_STEM: 14,       // try 8–16
    PARENT_STEM_MAX: 14,   // keep parent verticals short; set equal to COUPLE_STEM

    COUPLE_Y_FROM_TOP: 74, // keep if used elsewhere
  },

  spacing: {
    SPOUSE_GAP: 20,
    SIBLING_GAP: 75,
    CLUSTER_GAP: 62,
    COUPLE_KEEP_OUT_PAD: 12,
    ROW_EPS: 10,
  },

  view: {
    minWidth: 1050,
    minHeight: 620,
    pad: 18,
    extra: 54,
  },
};
