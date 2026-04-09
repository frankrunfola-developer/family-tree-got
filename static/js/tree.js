import { TREE_CFG } from "./treeConfig.js";
import { renderFamilyTree, fitTreeToScreen } from "./familyTree.js";

function cfgNum(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function $(sel) {
  return document.querySelector(sel);
}

function safeText(v) {
  return v == null ? "" : String(v);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function pairKey(a, b) {
  const ids = [a, b].filter(Boolean).map(String).sort();
  return ids.join("|") || "_";
}

function makePerson(raw) {
  //console.log(JSON.stringify(raw, null, 2));
  const birth = raw.birthDate ?? raw.birth_date ?? raw.birthYear ?? raw.birth_year ?? raw.birth ?? raw.born ?? null;
  const death = raw.deathDate ?? raw.death_date ?? raw.deathYear ?? raw.death_year ?? raw.death ?? raw.died ?? null;

  const birthStr = birth ? String(birth) : "";
  const deathStr = death ? String(death) : "";
  //console.log("birthText="+birthText + " deathText="+deathText)
  let yearsText = "";
  if (birthStr || deathStr) {
    yearsText = `(${birthStr}-${deathStr})`;
  }

  return {
    id: String(raw.id),
    name: safeText(raw.name || raw.label || raw.id),
    gender: raw.gender || null,
    birth,
    death,
    yearsText,
    raw,
  };
}
function normalizeTree(treeJson) {
  const people = Array.isArray(treeJson?.people) ? treeJson.people : [];
  const relationships = Array.isArray(treeJson?.relationships) ? treeJson.relationships : [];

  const peopleById = new Map();
  for (const p of people) {
    if (!p?.id) continue;
    peopleById.set(String(p.id), makePerson(p));
  }

  const ensurePerson = (id) => {
    if (!id) return null;
    const sid = String(id);
    if (!peopleById.has(sid)) {
      peopleById.set(sid, makePerson({ id: sid, name: sid }));
    }
    return sid;
  };

  const parentSetByChild = new Map();

  for (const rel of relationships) {
    if (!rel) continue;

    if (rel.childId && rel.parentId) {
      const child = ensurePerson(rel.childId);
      const parent = ensurePerson(rel.parentId);
      if (child && parent) {
        if (!parentSetByChild.has(child)) parentSetByChild.set(child, new Set());
        parentSetByChild.get(child).add(parent);
      }
      if (rel.otherParentId) {
        const other = ensurePerson(rel.otherParentId);
        if (child && other) {
          if (!parentSetByChild.has(child)) parentSetByChild.set(child, new Set());
          parentSetByChild.get(child).add(other);
        }
      }
      continue;
    }

    if (rel.child && rel.parent) {
      const child = ensurePerson(rel.child);
      const parent = ensurePerson(rel.parent);
      if (child && parent) {
        if (!parentSetByChild.has(child)) parentSetByChild.set(child, new Set());
        parentSetByChild.get(child).add(parent);
      }
    }
  }

  const familiesById = new Map();
  let familyOrder = 0;
  const ensureFamily = (parentIds) => {
    const displayIds = uniq((parentIds || []).filter(Boolean).map(String)).slice(0, 2);
    const key = displayIds.slice().sort().join('|');
    if (!key) return null;
    if (!familiesById.has(key)) {
      familiesById.set(key, { id: key, parentIds: displayIds, childIds: [], order: familyOrder++ });
    }
    return familiesById.get(key);
  };

  for (const [childId, parentSet] of parentSetByChild.entries()) {
    const fam = ensureFamily(Array.from(parentSet));
    if (!fam) continue;
    if (!fam.childIds.includes(childId)) fam.childIds.push(childId);
  }

  const childToParentFamilyIds = new Map();
  const familyIdsByParent = new Map();
  for (const fam of familiesById.values()) {
    for (const childId of fam.childIds) {
      if (!childToParentFamilyIds.has(childId)) childToParentFamilyIds.set(childId, []);
      childToParentFamilyIds.get(childId).push(fam.id);
    }
    for (const pid of fam.parentIds) {
      if (!familyIdsByParent.has(pid)) familyIdsByParent.set(pid, []);
      familyIdsByParent.get(pid).push(fam.id);
    }
  }

  const homeFamilyMemo = new Map();
  function chooseHomeFamilyForPerson(personId) {
    if (homeFamilyMemo.has(personId)) return homeFamilyMemo.get(personId);
    const famIds = (familyIdsByParent.get(personId) || []).slice();
    if (!famIds.length) {
      homeFamilyMemo.set(personId, null);
      return null;
    }
    famIds.sort((a, b) => {
      const fa = familiesById.get(a);
      const fb = familiesById.get(b);
      const childDelta = (fb?.childIds?.length || 0) - (fa?.childIds?.length || 0);
      if (childDelta !== 0) return childDelta;
      return (fa?.order || 0) - (fb?.order || 0);
    });
    homeFamilyMemo.set(personId, famIds[0]);
    return famIds[0];
  }

  const familyIncoming = new Map();
  for (const fam of familiesById.values()) familyIncoming.set(fam.id, 0);
  for (const fam of familiesById.values()) {
    for (const pid of fam.parentIds) {
      const parentOriginFamilies = childToParentFamilyIds.get(pid) || [];
      for (const originId of parentOriginFamilies) {
        familyIncoming.set(fam.id, (familyIncoming.get(fam.id) || 0) + 1);
      }
    }
  }

  const orderedRootIds = Array.from(familiesById.values())
    .filter((fam) => (familyIncoming.get(fam.id) || 0) === 0)
    .sort((a, b) => a.order - b.order)
    .map((fam) => fam.id);

  return {
    peopleById,
    familiesById,
    orderedRootIds: orderedRootIds.length ? orderedRootIds : Array.from(familiesById.keys()),
    chooseHomeFamilyForPerson,
  };
}

function buildRenderForest(model) {
  const { peopleById, familiesById, orderedRootIds, chooseHomeFamilyForPerson } = model;
  const nodeMemo = new Map();

  function buildLeafPerson(personId) {
    return {
      id: `person:${personId}`,
      type: 'person',
      personId,
      person: peopleById.get(personId),
      children: [],
      depth: 0,
    };
  }

  function buildFamilyNode(familyId, trail = new Set(), depth = 0, inboundPersonId = null) {
    if (trail.has(familyId)) return null;
    const memoKey = `${familyId}|${inboundPersonId || ''}`;
    if (nodeMemo.has(memoKey)) return structuredClone(nodeMemo.get(memoKey));
    const fam = familiesById.get(familyId);
    if (!fam) return null;

    const nextTrail = new Set(trail);
    nextTrail.add(familyId);

    const childNodes = [];
    for (const childId of fam.childIds) {
      const childHome = chooseHomeFamilyForPerson(childId);
      if (childHome && childHome !== familyId && !nextTrail.has(childHome)) {
        const sub = buildFamilyNode(childHome, nextTrail, depth + 1, childId);
        if (sub) {
          sub.depth = depth + 1;
          childNodes.push(sub);
          continue;
        }
      }
      const leaf = buildLeafPerson(childId);
      leaf.depth = depth + 1;
      childNodes.push(leaf);
    }

    const node = {
      id: `family:${familyId}`,
      type: 'family',
      familyId,
      displayedParentIds: fam.parentIds.slice(),
      people: fam.parentIds.map((pid) => peopleById.get(pid)).filter(Boolean),
      unions: [{
        familyId: fam.id,
        parentIds: fam.parentIds.slice(),
        childNodes,
        anchorParentId: null,
        sideHint: 0,
      }],
      children: childNodes,
      depth,
      inboundPersonId,
    };
    nodeMemo.set(memoKey, node);
    return structuredClone(node);
  }

  const roots = orderedRootIds
    .map((familyId) => buildFamilyNode(familyId, new Set(), 0, null))
    .filter(Boolean);

  if (!roots.length) {
    const people = Array.from(peopleById.values()).slice(0, 1).map((p) => buildLeafPerson(p.id));
    return people;
  }

  return roots;
}

function makeLayoutMetrics() {
  const sizingCfg = TREE_CFG?.sizing || {};
  const layoutCfg = TREE_CFG?.layout || {};
  const viewCfg = TREE_CFG?.view || {};

const vw = Math.max(320, window.innerWidth || 1280);
const scaleStart = 550;
const minScale = 0.62;
const scale = vw >= scaleStart
  ? 1
  : clamp(minScale + (((vw - 320) / (scaleStart - 320)) * (1 - minScale)), minScale, 1);

const scaleNum = (value, fallback, min = 1) =>
  Math.max(min, Math.round(cfgNum(value, fallback) * scale));

  const baseCardW = cfgNum(sizingCfg.CARD_W, 104);
  const baseCardH = cfgNum(sizingCfg.CARD_H, Math.round(baseCardW * 1.23));
  const baseRadius = cfgNum(sizingCfg.CARD_R, Math.max(8, Math.round(baseCardW * 0.10)));
  const baseBottomPanelH = cfgNum(sizingCfg.BOTTOM_PANEL_H, Math.max(34, Math.round(baseCardH * 0.34)));
  const basePhotoW = cfgNum(sizingCfg.PHOTO_W, baseCardW);
  const basePhotoH = cfgNum(sizingCfg.PHOTO_H, Math.max(1, baseCardH - baseBottomPanelH));

  const cardWidth = scaleNum(baseCardW, baseCardW, 72);
  const cardHeight = Math.round(scaleNum(baseCardH * 1.15, baseCardH * 1.15, 120));
  const radius = scaleNum(baseRadius, baseRadius, 8);
  const bottomPanelH = Math.round(scaleNum(baseBottomPanelH * 1.12, baseBottomPanelH * 1.12, 34) * 1.04);
  const photoW = Math.min(cardWidth, scaleNum(basePhotoW, basePhotoW, 62));
  const photoH = Math.min(cardHeight, scaleNum(basePhotoH, basePhotoH, 62));
  const imageRatio = Math.max(0.40, Math.min(0.82, photoH / cardHeight));

  return {
    card: {
      width: cardWidth,
      height: cardHeight,
      radius,
      padding: 0,
      photoWidth: Math.max(1, photoW),
      photoHeight: Math.max(1, photoH),
      bottomPanelHeight: Math.max(1, Math.min(cardHeight - 16, bottomPanelH)),
      imageRatio,
    },
    spacing: {
      coupleGap: scaleNum(layoutCfg.spouseGap, 26, 14),
      siblingGap: scaleNum(layoutCfg.siblingGap, 22, 12),
      clusterGap: scaleNum(layoutCfg.clusterGap, 28, 16),
      generationGap: Math.max(26, scaleNum(TREE_CFG?.dagre?.ranksep, 40, 20) + 6),
      stackGap: Math.max(8, scaleNum(layoutCfg.minNodeGap, 18, 8)),
      sidePad: scaleNum(TREE_CFG?.dagre?.marginx, 20, 0),
      topPad: scaleNum(TREE_CFG?.dagre?.marginy, 20, 0),
      bottomPad: scaleNum(TREE_CFG?.dagre?.marginy, 20, 0),
      trunkDrop: Math.max(16, scaleNum(layoutCfg.trunkDropMin, 24, 16)),
      childStem: Math.max(10, scaleNum(layoutCfg.stemLen, 20, 10)),
      unionGroupGap: Math.max(16, scaleNum(layoutCfg.clusterGap, 28, 16)),
      partnerBranchGap: Math.max(cardWidth + 12, cardWidth + scaleNum(layoutCfg.minPartnerGap, 24, 14)),
    },
    view: {
      partialChildrenVisible: Math.max(1, cfgNum(viewCfg.partialChildrenVisible, 3)),
      defaultPartial: viewCfg.defaultPartial !== false,
      stackLastGeneration: viewCfg.stackLastGeneration !== false,
    },
  };
}


function measureChildrenList(children, metrics, depth) {
  if (!children.length) {
    return { children: [], width: 0, height: 0, vertical: false };
  }
  const measured = children.map((child) => measureNode(child, metrics));
  const allLeafChildren = measured.every((child) => child.type !== "family");
  const vertical = metrics.view.stackLastGeneration !== false
    && allLeafChildren
    && measured.length > 1;
  if (vertical) {
    const width = Math.max(...measured.map((child) => child.subtreeWidth));
    const height = measured.reduce((sum, child, idx) => sum + child.subtreeHeight + (idx > 0 ? metrics.spacing.stackGap : 0), 0);
    return { children: measured, width, height, vertical };
  }
  const width = measured.reduce((sum, child, idx) => sum + child.subtreeWidth + (idx > 0 ? metrics.spacing.siblingGap : 0), 0);
  const height = Math.max(...measured.map((child) => child.subtreeHeight));
  return { children: measured, width, height, vertical };
}

function measureNode(node, metrics) {
  const { width: CARD_W, height: CARD_H } = metrics.card;
  const { coupleGap, generationGap, unionGroupGap } = metrics.spacing;

  if (node.type !== "family") {
    node.selfWidth = CARD_W;
    node.subtreeWidth = CARD_W;
    node.subtreeHeight = CARD_H;
    return node;
  }

  node.primaryParentIds = node.unions[0]?.parentIds?.slice() || node.displayedParentIds.slice(0, 2);
  node.extraParentIds = node.displayedParentIds.filter((pid) => !node.primaryParentIds.includes(pid));
  node.selfWidth = Math.max(1, node.displayedParentIds.length) * CARD_W + Math.max(0, node.displayedParentIds.length - 1) * coupleGap;

  node.unions = node.unions.map((union) => {
    const measuredGroup = measureChildrenList(union.childNodes || [], metrics, node.depth + 1);
    return {
      ...union,
      childNodes: measuredGroup.children,
      branchWidth: measuredGroup.width,
      branchHeight: measuredGroup.height,
      verticalChildren: measuredGroup.vertical,
      subtreeWidth: measuredGroup.width,
      subtreeHeight: measuredGroup.height,
    };
  });

  const nonEmptyUnions = node.unions.filter((union) => union.childNodes.length);
  if (!nonEmptyUnions.length) {
    node.subtreeWidth = node.selfWidth;
    node.subtreeHeight = CARD_H;
    return node;
  }

  const childrenWidth = nonEmptyUnions.reduce((sum, union, idx) => sum + union.branchWidth + (idx > 0 ? unionGroupGap : 0), 0);
  const childrenHeight = Math.max(...nonEmptyUnions.map((union) => union.branchHeight));
  node.subtreeWidth = Math.max(node.selfWidth, childrenWidth);
  node.subtreeHeight = CARD_H + generationGap + childrenHeight;
  return node;
}

function layoutChildrenList(children, left, top, metrics, segments, cards, vertical = false) {
  if (!children.length) return [];
  const out = [];
  if (vertical) {
    let cursorTop = top;
    for (const child of children) {
      const childLeft = left + ((Math.max(...children.map((c) => c.subtreeWidth)) - child.subtreeWidth) / 2);
      layoutNode(child, childLeft, cursorTop, metrics, segments, cards);
      out.push(child);
      cursorTop += child.subtreeHeight + metrics.spacing.stackGap;
    }
    return out;
  }
  let cursorLeft = left;
  for (const child of children) {
    layoutNode(child, cursorLeft, top, metrics, segments, cards);
    out.push(child);
    cursorLeft += child.subtreeWidth + metrics.spacing.siblingGap;
  }
  return out;
}

function getNodeAttachSpec(node, metrics) {
  const stem = Math.max(12, Math.round((metrics?.spacing?.childStem ?? 18) * 0.9));
  if (node.type !== "family") {
    return {
      y: node.top,
      stemTopY: node.top - stem,
      joinX: node.unionX,
      leftX: node.unionX,
      rightX: node.unionX,
    };
  }

  const inboundX = node.inboundPersonId && node.cardCenters instanceof Map
    ? node.cardCenters.get(node.inboundPersonId)
    : null;
  const joinX = Number.isFinite(inboundX) ? inboundX : node.unionX;
  return {
    y: node.top,
    stemTopY: node.top - stem,
    joinX,
    leftX: joinX,
    rightX: joinX,
  };
}

function drawAttachSpan(segments, attach) {
  if (!attach) return;
  if (attach.rightX > attach.leftX) {
    segments.push({
      x1: attach.leftX,
      y1: attach.y,
      x2: attach.rightX,
      y2: attach.y,
      cls: "tree-connector tree-connector-child",
    });
  }
}

function layoutNode(node, left, top, metrics, segments, cards) {
  const { width: CARD_W, height: CARD_H } = metrics.card;
  const { coupleGap, generationGap, trunkDrop, childStem, unionGroupGap } = metrics.spacing;

  node.left = left;
  node.top = top;
  node.centerX = left + (node.subtreeWidth / 2);

  if (node.type !== "family") {
    node.contentLeft = node.centerX - (CARD_W / 2);
    cards.push({ person: node.person, x: node.contentLeft, y: top });
    node.unionX = node.contentLeft + (CARD_W / 2);
    node.anchorTopY = top + CARD_H;
    node.attach = { y: top, joinX: node.unionX, leftX: node.unionX, rightX: node.unionX };
    return;
  }

  const cardCenters = new Map();
  const cardLefts = new Map();
  const rowLeft = node.centerX - (node.selfWidth / 2);
  let cursor = rowLeft;
  for (const pid of node.displayedParentIds) {
    const person = node.people.find((it) => it?.id === pid);
    if (person) cards.push({ person, x: cursor, y: top });
    cardLefts.set(pid, cursor);
    cardCenters.set(pid, cursor + (CARD_W / 2));
    cursor += CARD_W + coupleGap;
  }

  node.contentLeft = rowLeft;
  node.cardCenters = cardCenters;
  node.cardLefts = cardLefts;
  node.unionX = (() => {
    const primary = node.primaryParentIds || node.displayedParentIds.slice(0, 2);
    const centers = primary.map((pid) => cardCenters.get(pid)).filter(Number.isFinite);
    if (!centers.length) return node.centerX;
    return centers.length === 1 ? centers[0] : (centers[0] + centers[centers.length - 1]) / 2;
  })();
  node.anchorTopY = top + CARD_H;
  node.attachY = top - childStem;
  node.attach = getNodeAttachSpec(node, metrics);

  if (node.depth > 0) {
    segments.push({
      x1: node.unionX,
      y1: node.attach.y,
      x2: node.unionX,
      y2: top,
      cls: "tree-connector tree-connector-child",
    });
  }

  for (const union of node.unions) {
    const centers = union.parentIds.map((pid) => cardCenters.get(pid)).filter(Number.isFinite);
    const orderedParents = union.parentIds
      .map((pid) => ({ pid, cx: cardCenters.get(pid), left: cardLefts.get(pid) }))
      .filter((pt) => Number.isFinite(pt.cx) && Number.isFinite(pt.left))
      .sort((a, b) => a.cx - b.cx);
    const parentMidY = top + Math.round(CARD_H / 2);
    const innerInset = Math.max(12, Math.round(CARD_W * 0.16));
    let connectorXs = orderedParents.map((pt) => pt.cx);

    if (orderedParents.length >= 2) {
      connectorXs = orderedParents.map((pt, idx) => {
        if (idx === 0) return pt.left + CARD_W - innerInset;
        if (idx === orderedParents.length - 1) return pt.left + innerInset;
        return pt.cx;
      });
      segments.push({
        x1: connectorXs[0],
        y1: parentMidY,
        x2: connectorXs[connectorXs.length - 1],
        y2: parentMidY,
        cls: "tree-connector tree-connector-parent",
      });
    }
    union.unionX = connectorXs.length >= 2 ? (connectorXs[0] + connectorXs[connectorXs.length - 1]) / 2 : (connectorXs[0] ?? centers[0] ?? node.unionX);
    union.unionY = parentMidY;
  }

  const activeUnions = node.unions.filter((union) => union.childNodes.length);
  if (!activeUnions.length) return;

  const childrenTop = top + CARD_H + generationGap;
  const subtreeLeft = node.centerX - (node.subtreeWidth / 2);
  const subtreeRight = subtreeLeft + node.subtreeWidth;
  let cursorLeft = subtreeLeft;

  for (const union of activeUnions) {
    const desiredLeft = union.unionX - (union.branchWidth / 2);
    const maxLeft = subtreeRight - union.branchWidth;
    const branchLeft = Math.max(cursorLeft, Math.min(desiredLeft, maxLeft));
    const laidOut = layoutChildrenList(union.childNodes, branchLeft, childrenTop, metrics, segments, cards, union.verticalChildren);
    const childTargets = laidOut
      .map((child) => ({ child, attach: getNodeAttachSpec(child, metrics) }))
      .filter((pt) => Number.isFinite(pt.attach.joinX) && Number.isFinite(pt.attach.y));
    const childXs = childTargets.map((pt) => pt.attach.joinX);
    const trunkTop = (union.unionY ?? (top + CARD_H)) - 1;
    const trunkBottom = Math.max(top + CARD_H + 10, trunkTop + trunkDrop);

    if (union.verticalChildren && childTargets.length > 1) {
      const railTop = Math.min(...childTargets.map((pt) => pt.attach.stemTopY));
      const railBottom = Math.max(...childTargets.map((pt) => pt.attach.stemTopY));
      segments.push({ x1: union.unionX, y1: trunkTop, x2: union.unionX, y2: railTop + 1, cls: "tree-connector tree-connector-child" });
      if (railBottom > railTop) {
        segments.push({ x1: union.unionX, y1: railTop, x2: union.unionX, y2: railBottom, cls: "tree-connector tree-connector-child" });
      }
      for (const pt of childTargets) {
        segments.push({ x1: union.unionX, y1: pt.attach.stemTopY, x2: pt.attach.joinX, y2: pt.attach.stemTopY, cls: "tree-connector tree-connector-child" });
        segments.push({ x1: pt.attach.joinX, y1: pt.attach.stemTopY, x2: pt.attach.joinX, y2: pt.attach.y, cls: "tree-connector tree-connector-child" });
        drawAttachSpan(segments, pt.attach);
      }
    } else if (childXs.length === 1) {
      const target = childTargets[0].attach;
      const parentBottomY = top + CARD_H;
      const joinY = target.stemTopY > parentBottomY
        ? Math.round(parentBottomY + ((target.stemTopY - parentBottomY) / 2))
        : Math.min(parentBottomY, target.stemTopY);
      segments.push({ x1: union.unionX, y1: trunkTop, x2: union.unionX, y2: joinY + 1, cls: "tree-connector tree-connector-child" });
      if (union.unionX !== target.joinX) {
        segments.push({ x1: union.unionX, y1: joinY, x2: target.joinX, y2: joinY, cls: "tree-connector tree-connector-child" });
      }
      segments.push({ x1: target.joinX, y1: joinY, x2: target.joinX, y2: target.y, cls: "tree-connector tree-connector-child" });
      drawAttachSpan(segments, target);
    } else if (childXs.length > 1) {
      const orderedTargets = childTargets.slice().sort((a, b) => (a.attach.joinX - b.attach.joinX) || (a.attach.y - b.attach.y));
      const highestStemTop = Math.min(...orderedTargets.map((pt) => pt.attach.stemTopY));
      const parentBottomY = top + CARD_H;
      const joinY = highestStemTop > parentBottomY
        ? Math.round(parentBottomY + ((highestStemTop - parentBottomY) / 2))
        : highestStemTop;
      segments.push({ x1: union.unionX, y1: trunkTop, x2: union.unionX, y2: joinY + 1, cls: "tree-connector tree-connector-child" });
      segments.push({ x1: orderedTargets[0].attach.joinX, y1: joinY, x2: orderedTargets[orderedTargets.length - 1].attach.joinX, y2: joinY, cls: "tree-connector tree-connector-child" });
      for (const pt of orderedTargets) {
        segments.push({ x1: pt.attach.joinX, y1: joinY, x2: pt.attach.joinX, y2: pt.attach.y, cls: "tree-connector tree-connector-child" });
        drawAttachSpan(segments, pt.attach);
      }
    }

    cursorLeft = branchLeft + union.branchWidth + unionGroupGap;
  }
}


function estimateNodeDepth(node) {
  if (!node || node.type !== "family") return 1;
  const unionChildren = (node.unions || []).flatMap((union) => union.childNodes || []);
  if (!unionChildren.length) return 1;
  return 1 + Math.max(...unionChildren.map((child) => estimateNodeDepth(child)));
}

function chooseLineageChild(children) {
  if (!children.length) return null;
  const scored = children.map((child) => {
    const depth = estimateNodeDepth(child);
    let yearScore = -Infinity;
    if (child?.type === "person") {
      const birth = Number(child?.person?.birth ?? child?.person?.raw?.birthYear ?? child?.person?.raw?.born ?? NaN);
      if (Number.isFinite(birth)) yearScore = birth;
    } else if (child?.type === "family") {
      const people = child.people || [];
      const births = people
        .map((p) => Number(p?.birth ?? p?.raw?.birthYear ?? p?.raw?.born ?? NaN))
        .filter(Number.isFinite);
      if (births.length) yearScore = Math.max(...births);
    }
    return { child, depth, yearScore };
  });
  scored.sort((a, b) => {
    if (b.depth !== a.depth) return b.depth - a.depth;
    return b.yearScore - a.yearScore;
  });
  return scored[0]?.child || null;
}

function buildLineageSlice(roots) {
  const root = roots[0];
  if (!root) return roots;
  const cloneNode = (node) => structuredClone(node);

  function walk(node) {
    const current = cloneNode(node);
    if (current.type !== "family") return current;
    const allChildren = (current.unions || []).flatMap((union) => union.childNodes || []);
    const chosen = chooseLineageChild(allChildren);
    current.unions = (current.unions || []).map((union) => {
      const found = (union.childNodes || []).find((child) => child.id === chosen?.id);
      return {
        ...union,
        childNodes: found ? [walk(found)] : [],
      };
    }).filter((union) => union.childNodes.length);
    current.children = current.unions.flatMap((union) => union.childNodes || []);
    return current;
  }

  return [walk(root)];
}

function buildPartialSlice(roots, partialChildrenVisible) {
  const trim = (node) => {
    if (node.type !== "family") return;
    node.unions = (node.unions || []).map((union) => {
      const limitedChildren = (union.childNodes || []).slice(0, partialChildrenVisible);
      limitedChildren.forEach((child) => trim(child));
      return {
        ...union,
        childNodes: limitedChildren,
      };
    });
    node.children = node.unions.flatMap((union) => union.childNodes || []);
  };
  roots.forEach((root) => trim(root));
  return roots;
}

function buildScene(treeJson, previewMode, renderMode = "tree") {
  const metrics = makeLayoutMetrics();
  const model = normalizeTree(treeJson);
  let roots = buildRenderForest(model);

  const partialChildrenVisible = Math.max(1, metrics.view.partialChildrenVisible ?? 3);
  if (renderMode === "landing") {
    roots = buildLineageSlice(roots);
  } else if (previewMode) {
    roots = buildPartialSlice(roots, partialChildrenVisible);
  }

  roots = roots.map((root) => measureNode(root, metrics));

  const segments = [];
  const cards = [];
  const { sidePad, topPad, bottomPad, clusterGap } = metrics.spacing;

  const totalWidth = roots.reduce((sum, root, idx) => sum + root.subtreeWidth + (idx > 0 ? clusterGap : 0), 0);
  const extraLeadPad = Math.max(sidePad, 18);
  let cursorLeft = extraLeadPad;
  const top = topPad;
  const estimatedWidth = Math.max((extraLeadPad * 2) + totalWidth, 0);
  for (const root of roots) {
    layoutNode(root, cursorLeft, top, metrics, segments, cards);
    cursorLeft += root.subtreeWidth + clusterGap;
  }

  const maxRight = cards.reduce((m, c) => Math.max(m, c.x + metrics.card.width), 0);
  const maxBottom = cards.reduce((m, c) => Math.max(m, c.y + metrics.card.height), 0);
  const viewBox = {
    x: 0,
    y: 0,
    w: Math.max(estimatedWidth, maxRight + extraLeadPad),
    h: Math.max(topPad + bottomPad + metrics.card.height, maxBottom + bottomPad),
  };

  return { cards, segments, viewBox, metrics };
}

async function fetchTreeJson() {
  const url = window.TREE_API_URL;
  if (!url) throw new Error("TREE_API_URL is not set");
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Tree API ${res.status} ${res.statusText}`);
  return res.json();
}

function wireToolbar(state, render) {
  const fitBtn = $("#fitTreeBtn");
  if (fitBtn) fitBtn.addEventListener("click", () => fitTreeToScreen());

  const toggleBtn = $("#treeDepthToggleBtn") || $("#treeMoreBtn") || $("#btnFull");
  if (toggleBtn) {
    const isLandingToggle = toggleBtn.textContent.trim().toLowerCase().includes("view full tree");
    const syncLabel = () => {
      if (isLandingToggle) return;
      toggleBtn.textContent = state.preview ? "See Full Tree" : "See Partial Tree";
    };
    syncLabel();
    toggleBtn.addEventListener("click", () => {
      if (isLandingToggle) {
        window.location.href = "/tree";
        return;
      }
      state.preview = !state.preview;
      syncLabel();
      render();
    });
  }
}

async function boot() {
  const svg = $("#treeSvg");
  if (!svg) return;

  let treeJson;
  try {
    treeJson = await fetchTreeJson();
  } catch (err) {
    console.error("[LineAgeMap] tree API failed", err);
    return;
  }

  const metrics = makeLayoutMetrics();
  const renderMode = document.body.classList.contains("landing-page") && document.querySelector(".treeCanvas--landing")
    ? "landing"
    : "tree";
  const state = { preview: renderMode === "landing" ? true : (metrics.view.defaultPartial !== false), treeJson };

  const render = () => {
    try {
      const scene = buildScene(state.treeJson, state.preview, renderMode);
      renderFamilyTree(svg, scene);
      fitTreeToScreen();
    } catch (err) {
      console.error("[LineAgeMap] tree render failed", err);
    }
  };

  wireToolbar(state, render);
  const toggleBtn = $("#treeDepthToggleBtn") || $("#treeMoreBtn") || $("#btnFull");
  if (renderMode === "landing" && toggleBtn) {
    toggleBtn.textContent = "View Full Tree";
  }
  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
