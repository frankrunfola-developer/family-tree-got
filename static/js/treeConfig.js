
export const TREE_CFG = {
  dagre: {
    rankdir: "TB",
    ranksep: 50,
    nodesep: 50,
    marginx: 20,
    marginy: 20,
  },

  sizing: {
    CARD_W: 135,
    CARD_H: 205,
    CARD_R: 12,
    PHOTO_W: 135,
    PHOTO_H: 155,

    // Dagre needs a non-zero box for edge intersection math.
    // Union nodes render as dots but still participate in layout.
    UNION_W: 12,
    UNION_H: 12,
  },

  text: {
    NAME_Y: 155,
    META_Y: 185,
  },

  fonts: {
    NAME_PX: 22,
    META_PX: 18,
    WEIGHT_NAME: 700,
    WEIGHT_META: 500,
  },

  spacing: {
    SPOUSE_GAP: 40,
    SIBLING_GAP: 15,
    CLUSTER_GAP: 74,
  },

  preview: {
    SIMPLE_MAX_KIDS_PER_PARENT: 2,
  },

  view: {
    minWidth: 550,
    minHeight: 620,
    pad: 10,
    extra: 15,
    fitExtra: 18,
  },
};

// Convenience aliases used by static/js/tree.js
TREE_CFG.nodeW = TREE_CFG.sizing.CARD_W;
TREE_CFG.nodeH = TREE_CFG.sizing.CARD_H;
TREE_CFG.unionW = TREE_CFG.sizing.UNION_W;
TREE_CFG.unionH = TREE_CFG.sizing.UNION_H;
