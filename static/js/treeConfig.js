export const TREE_CFG = {
  dagre: {
    rankdir: "TB",
    nodesep: 20,
    ranksep: 36,
    marginx: 6,
    marginy: 6,
  },

  layout: {
    minNodeGap: 20,
    rowTolerance: 22,
    spouseGap: 42,
    siblingGap: 22,
    clusterGap: 34,
    minPartnerGap: 42,
    coupleBarYRatio: 0.38,
    trunkDropMin: 30,
    trunkDropRatio: 0.58,
    trunkChildClearance: 24,
    trunkLaneRatio: 0.24,
    stemLen: 24,
    stemMin: 18,
    stemMax: 60,
  },

sizing: {
  CARD_W: 96,
  CARD_H: 152,
  CARD_R: 14,
  PHOTO_W: 84,
  PHOTO_H: 106,
  BOTTOM_PANEL_H: 38,
},
  view: {
    stackLastGeneration: true,
    partialChildrenVisible: 2,
    defaultPartial: true,
  },
};
