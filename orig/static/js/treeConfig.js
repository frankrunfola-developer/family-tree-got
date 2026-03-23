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
    spouseGap: 30,
    siblingGap: 26,
    clusterGap: 34,
    minPartnerGap: 30,
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
  CARD_W: 168,
  CARD_H: 204,
  CARD_R: 11,
  PHOTO_W: 168,
  PHOTO_H: 152,
  BOTTOM_PANEL_H: 52,
},
  view: {
    stackLastGeneration: true,
    partialChildrenVisible: 2,
    defaultPartial: true,
  },
};
