// static/js/treeConfig.js
// ----------------------------------------------------------------------------
// Tree rendering + layout knobs (single source of truth).
// Imported by both `tree.js` and `familyTree.js`.
//
// If you want to change how the tree *looks* without touching layout/render code,
// change values in this file first.
// ----------------------------------------------------------------------------

export const TREE_CFG = {
  // Dagre layout (graph -> x/y positions)
  dagre: {
    rankdir: "TB",  // Extra padding around the dagre graph
    ranksep: 45, // Vertical distance between generations (rows)
    nodesep: 100,// Horizontal distance between nodes (columns)
    marginx: 10,   // Extra padding around the dagre graph
    marginy: 10,
  },

  // Node/card sizing (all dimensions in SVG px)
  sizing: {
    CARD_W: 160,     // person card width
    CARD_H: 250,     // person card height
    CARD_R: 10,      // card corner radius
    PHOTO_R: 20,   // single source of truth for circle size
    PHOTO_Y: 14,   // top offset of the circle’s bounding box
},

  // Card text baseline positions (relative to card top-left)
  text: {
    NAME_Y: 202,
    META_Y: 235
  },

  // Text styling (SVG text)
  fonts: {
    NAME_PX: 22,   // name font size
    META_PX: 18,   // date/meta font size
    WEIGHT_NAME: 600,
    WEIGHT_META: 500,
  },


  // Link routing knobs (elbows + stems)
  links: {
    // ONE knob for ALL vertical stems (the "drop" length used to build elbows):
    // - parent drops down to the couple join line
    // - trunk from the couple join line down to the union point
    // - union-to-child elbow vertical stem (from union point to the elbow)
    STEM: 80,   // If your connectors look too "tall" or too "flat", change *only* this value.
  },

  // Spacing policy (mostly used when building the graph)
  spacing: {
    SPOUSE_GAP: 10,
    SIBLING_GAP: 35,
    CLUSTER_GAP: 20,
    COUPLE_KEEP_OUT_PAD: 12,
    ROW_EPS: 10,
  },

  // ViewBox framing / padding for the SVG viewport
  view: {
    minWidth: 1050,
    minHeight: 620,
    pad: 18,
    extra: 54,
  },
};