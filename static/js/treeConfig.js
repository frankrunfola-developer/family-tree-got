// static/js/treeConfig.js
// Central config for tree layout + rendering.

export const TREE_CFG = {
  // Dagre layout (graph -> x/y positions)
  dagre: {
    rankdir: "TB",
    ranksep: 18,
    nodesep: 60,
    marginx: 10,
    marginy: 10,
  },

  // Node/card sizing (SVG px)
sizing: {
  CARD_W: 170,
  CARD_H: 200,
  CARD_R: 7,
  PHOTO_H: 135,         // or omit and compute it
  BOTTOM_PANEL_H: 65,   // MUST exist if you reference it
},
  // Card text positions (relative to card top-left)
  text: {
    NAME_Y: 230,
    META_Y: 190,
  },

  // Text styling
  fonts: {
    NAME_PX: 22,
    META_PX: 18,
    WEIGHT_NAME: 700,
    WEIGHT_META: 500,
  },

  // Link routing knobs
  links: {
    STEM: 34,
  },

    // Spacing policy
  spacing: {
    SPOUSE_GAP: 1,     // was 30
    SIBLING_GAP: 30,    // was 10
    CLUSTER_GAP: 20,    // was 80
    COUPLE_KEEP_OUT_PAD: 12,
    ROW_EPS: 10,
  },
  // Default/simple-mode pruning rules
  preview: {
    // Default tree render (simple mode): limit how many children we keep per parent.
    SIMPLE_MAX_KIDS_PER_PARENT: 1,
  },

  // ViewBox framing / padding
 view: {
    minWidth: 550,
    minHeight: 620,
    pad: 10,
    extra: 54,
  },
};