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
  const spousePairs = [];

  for (const rel of relationships) {
    if (!rel) continue;

    if (rel.type === "spouse" && rel.a && rel.b) {
      const a = ensurePerson(rel.a);
      const b = ensurePerson(rel.b);
      if (a && b) spousePairs.push([a, b]);
      continue;
    }

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
  const familyOrder = [];

  function ensureFamily(parentIds, sourceOrder = familyOrder.length) {
    const ids = uniq((parentIds || []).filter(Boolean).map(String)).slice(0, 2).sort();
    const key = ids.join("|") || `single:${sourceOrder}`;
    if (!familiesById.has(key)) {
      familiesById.set(key, {
        id: key,
        parentIds: ids,
        childIds: [],
        order: sourceOrder,
      });
      familyOrder.push(key);
    }
    return familiesById.get(key);
  }

  for (const [childId, parentSet] of parentSetByChild.entries()) {
    const parents = Array.from(parentSet).filter(Boolean).slice(0, 2).sort();
    const fam = ensureFamily(parents);
    if (!fam.childIds.includes(childId)) fam.childIds.push(childId);
  }

  for (const [a, b] of spousePairs) {
    ensureFamily([a, b]);
  }

  const childToParentFamilyIds = new Map();
  for (const fam of familiesById.values()) {
    for (const childId of fam.childIds) {
      if (!childToParentFamilyIds.has(childId)) childToParentFamilyIds.set(childId, []);
      childToParentFamilyIds.get(childId).push(fam.id);
    }
  }

  const familyIdsByParent = new Map();
  for (const fam of familiesById.values()) {
    for (const pid of fam.parentIds) {
      if (!familyIdsByParent.has(pid)) familyIdsByParent.set(pid, []);
      familyIdsByParent.get(pid).push(fam.id);
    }
  }

  const familyWeightMemo = new Map();
  function familyWeight(familyId, seen = new Set()) {
    if (familyWeightMemo.has(familyId)) return familyWeightMemo.get(familyId);
    if (seen.has(familyId)) return 0;
    seen.add(familyId);
    const fam = familiesById.get(familyId);
    if (!fam) return 0;
    let total = fam.childIds.length;
    for (const childId of fam.childIds) {
      const childHome = chooseHomeFamilyForPerson(childId, seen);
      if (childHome) total += familyWeight(childHome, seen);
    }
    seen.delete(familyId);
    familyWeightMemo.set(familyId, total);
    return total;
  }

  const homeFamilyMemo = new Map();
  function chooseHomeFamilyForPerson(personId, seen = new Set()) {
    if (homeFamilyMemo.has(personId)) return homeFamilyMemo.get(personId);
    const famIds = familyIdsByParent.get(personId) || [];
    if (!famIds.length) {
      homeFamilyMemo.set(personId, null);
      return null;
    }
    let best = famIds[0];
    let bestScore = -1;
    for (const famId of famIds) {
      const fam = familiesById.get(famId);
      const childCount = fam?.childIds?.length || 0;
      const score = (childCount * 1000) - (fam?.order || 0);
      if (score > bestScore) {
        bestScore = score;
        best = famId;
      }
    }
    homeFamilyMemo.set(personId, best);
    return best;
  }

  const parentFamilyByPerson = new Map();
  for (const personId of peopleById.keys()) {
    const parentFamIds = childToParentFamilyIds.get(personId) || [];
    if (parentFamIds.length) {
      parentFamIds.sort((a, b) => {
        const fa = familiesById.get(a);
        const fb = familiesById.get(b);
        return (fa?.order || 0) - (fb?.order || 0);
      });
      parentFamilyByPerson.set(personId, parentFamIds[0]);
    } else {
      parentFamilyByPerson.set(personId, null);
    }
  }

  const familyIncoming = new Map();
  for (const fam of familiesById.values()) familyIncoming.set(fam.id, 0);
  for (const fam of familiesById.values()) {
    for (const childId of fam.childIds) {
      const childHome = chooseHomeFamilyForPerson(childId);
      if (childHome && childHome !== fam.id && familiesById.has(childHome)) {
        familyIncoming.set(childHome, (familyIncoming.get(childHome) || 0) + 1);
      }
    }
  }

  const rootFamilyIds = Array.from(familiesById.values())
    .filter((fam) => (familyIncoming.get(fam.id) || 0) === 0)
    .sort((a, b) => a.order - b.order)
    .map((fam) => fam.id);

  const orderedRootIds = rootFamilyIds.length ? rootFamilyIds : Array.from(familiesById.keys());

  return {
    peopleById,
    familiesById,
    orderedRootIds,
    chooseHomeFamilyForPerson,
    parentFamilyByPerson,
  };
}


function buildRenderForest(model) {
  const {
    peopleById,
    familiesById,
    orderedRootIds,
    chooseHomeFamilyForPerson,
  } = model;

  const attachedFamilyIdsByHost = new Map();
  const attachedFamilyIds = new Set();

  for (const fam of familiesById.values()) {
    let hostId = null;
    for (const pid of fam.parentIds) {
      const homeId = chooseHomeFamilyForPerson(pid);
      if (homeId && homeId !== fam.id && familiesById.has(homeId)) {
        hostId = homeId;
        break;
      }
    }
    if (hostId) {
      attachedFamilyIds.add(fam.id);
      if (!attachedFamilyIdsByHost.has(hostId)) attachedFamilyIdsByHost.set(hostId, []);
      attachedFamilyIdsByHost.get(hostId).push(fam.id);
    }
  }

  const nodeMemo = new Map();

  function buildLeafPerson(personId) {
    return {
      id: `person:${personId}`,
      type: "person",
      personId,
      person: peopleById.get(personId),
      children: [],
      depth: 0,
    };
  }

  function buildUnionChildren(familyId, trail, depth) {
    const fam = familiesById.get(familyId);
    if (!fam) return [];
    const out = [];
    for (const childId of fam.childIds) {
      const childHome = chooseHomeFamilyForPerson(childId);
      if (childHome && childHome !== familyId && !trail.has(childHome)) {
        const childNode = buildFamilyNode(childHome, new Set(trail), depth + 1);
        if (childNode) {
          childNode.depth = depth + 1;
          childNode.inboundPersonId = childId;
          out.push(childNode);
          continue;
        }
      }
      const leaf = buildLeafPerson(childId);
      leaf.depth = depth + 1;
      out.push(leaf);
    }
    return out;
  }

  function buildFamilyNode(familyId, trail = new Set(), depth = 0) {
    if (nodeMemo.has(familyId)) return nodeMemo.get(familyId);
    const fam = familiesById.get(familyId);
    if (!fam || trail.has(familyId)) return null;
    trail.add(familyId);

    const primaryParentIds = fam.parentIds.slice(0, 2);
    const displayedParentIds = primaryParentIds.slice();
    const unions = [];

    unions.push({
      familyId: fam.id,
      parentIds: primaryParentIds.slice(),
      childNodes: buildUnionChildren(fam.id, new Set(trail), depth),
      anchorParentId: null,
      sideHint: 0,
    });

    const extras = (attachedFamilyIdsByHost.get(fam.id) || []).slice();
    const anchorSlots = new Map();
    for (const pid of primaryParentIds) anchorSlots.set(pid, { left: [], right: [] });

    for (const extraFamId of extras) {
      if (trail.has(extraFamId)) continue;
      const extraFam = familiesById.get(extraFamId);
      if (!extraFam) continue;
      const anchorParentId = extraFam.parentIds.find((pid) => chooseHomeFamilyForPerson(pid) === fam.id) || null;
      const partnerIds = extraFam.parentIds.filter((pid) => pid !== anchorParentId);
      const partnerId = partnerIds[0] || null;
      if (!anchorParentId || !partnerId) continue;

      if (!displayedParentIds.includes(partnerId)) displayedParentIds.push(partnerId);

      const anchorIndex = primaryParentIds.indexOf(anchorParentId);
      const defaultSide = anchorIndex <= 0 ? 1 : -1;
      const slot = anchorSlots.get(anchorParentId) || { left: [], right: [] };
      const sideHint = defaultSide > 0
        ? (slot.right.length <= slot.left.length ? 1 : -1)
        : (slot.left.length <= slot.right.length ? -1 : 1);
      if (sideHint < 0) slot.left.push(partnerId); else slot.right.push(partnerId);
      anchorSlots.set(anchorParentId, slot);

      unions.push({
        familyId: extraFam.id,
        parentIds: [anchorParentId, partnerId],
        childNodes: buildUnionChildren(extraFam.id, new Set([...trail, extraFamId]), depth),
        anchorParentId,
        sideHint,
      });
    }

    let orderedParentIds = displayedParentIds.slice();
    if (primaryParentIds.length === 2) {
      const [p0, p1] = primaryParentIds;
      const leftForP0 = unions.filter((u) => u.anchorParentId === p0 && u.sideHint < 0).map((u) => u.parentIds.find((pid) => pid !== p0)).filter(Boolean);
      const rightForP0 = unions.filter((u) => u.anchorParentId === p0 && u.sideHint > 0).map((u) => u.parentIds.find((pid) => pid !== p0)).filter(Boolean);
      const leftForP1 = unions.filter((u) => u.anchorParentId === p1 && u.sideHint < 0).map((u) => u.parentIds.find((pid) => pid !== p1)).filter(Boolean);
      const rightForP1 = unions.filter((u) => u.anchorParentId === p1 && u.sideHint > 0).map((u) => u.parentIds.find((pid) => pid !== p1)).filter(Boolean);
      orderedParentIds = uniq([
        ...leftForP0,
        ...leftForP1,
        p1,
        p0,
        ...rightForP0,
        ...rightForP1,
      ]).filter(Boolean);
    }

    const node = {
      id: `family:${familyId}`,
      type: "family",
      familyId,
      displayedParentIds: orderedParentIds,
      people: orderedParentIds.map((pid) => peopleById.get(pid)).filter(Boolean),
      unions,
      children: unions.flatMap((u) => u.childNodes),
      depth,
    };
    nodeMemo.set(familyId, node);
    return node;
  }

  const roots = [];
  for (const familyId of orderedRootIds) {
    if (attachedFamilyIds.has(familyId)) continue;
    const node = buildFamilyNode(familyId, new Set(), 0);
    if (node) roots.push(node);
  }

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
const rawScale = vw / 1280;
const scale = clamp(rawScale, 0.88, 1);

const scaleNum = (value, fallback, min = 1) =>
  Math.max(min, Math.round(cfgNum(value, fallback) * scale));

  const baseCardW = cfgNum(sizingCfg.CARD_W, 104);
  const baseCardH = cfgNum(sizingCfg.CARD_H, Math.round(baseCardW * 1.23));
  const baseRadius = cfgNum(sizingCfg.CARD_R, Math.max(8, Math.round(baseCardW * 0.10)));
  const baseBottomPanelH = cfgNum(sizingCfg.BOTTOM_PANEL_H, Math.max(34, Math.round(baseCardH * 0.34)));
  const basePhotoW = cfgNum(sizingCfg.PHOTO_W, baseCardW);
  const basePhotoH = cfgNum(sizingCfg.PHOTO_H, Math.max(1, baseCardH - baseBottomPanelH));

  const cardWidth = scaleNum(baseCardW, baseCardW, 78);
  const cardHeight = scaleNum(baseCardH, baseCardH, 96);
  const radius = scaleNum(baseRadius, baseRadius, 8);
  const bottomPanelH = scaleNum(baseBottomPanelH, baseBottomPanelH, 34);
  const photoW = Math.min(cardWidth, scaleNum(basePhotoW, basePhotoW, 56));
  const photoH = Math.min(cardHeight, scaleNum(basePhotoH, basePhotoH, 48));
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

function getNodeAttachSpec(node) {
  if (node.type !== "family") {
    return {
      y: node.top,
      joinX: node.unionX,
      leftX: node.unionX,
      rightX: node.unionX,
    };
  }

  const inboundX = Number.isFinite(node.cardCenters?.get?.(node.inboundPersonId))
    ? node.cardCenters.get(node.inboundPersonId)
    : null;
  if (Number.isFinite(inboundX)) {
    return {
      y: node.top,
      joinX: inboundX,
      leftX: inboundX,
      rightX: inboundX,
    };
  }

  const centers = Array.from(node.cardCenters?.values?.() || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!centers.length) {
    return {
      y: node.top,
      joinX: node.unionX,
      leftX: node.unionX,
      rightX: node.unionX,
    };
  }

  const leftX = centers[0];
  const rightX = centers[centers.length - 1];
  const joinX = Math.max(leftX, Math.min(rightX, node.unionX));

  return {
    y: node.top,
    joinX,
    leftX,
    rightX,
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
      cls: "tree-link tree-link-child",
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
  const rowLeft = node.centerX - (node.selfWidth / 2);
  let cursor = rowLeft;
  for (const pid of node.displayedParentIds) {
    const person = node.people.find((it) => it?.id === pid);
    if (person) cards.push({ person, x: cursor, y: top });
    cardCenters.set(pid, cursor + (CARD_W / 2));
    cursor += CARD_W + coupleGap;
  }

  node.contentLeft = rowLeft;
  node.cardCenters = cardCenters;
  node.unionX = (() => {
    const primary = node.primaryParentIds || node.displayedParentIds.slice(0, 2);
    const centers = primary.map((pid) => cardCenters.get(pid)).filter(Number.isFinite);
    if (!centers.length) return node.centerX;
    return centers.length === 1 ? centers[0] : (centers[0] + centers[centers.length - 1]) / 2;
  })();
  node.anchorTopY = top + CARD_H;
  node.attach = getNodeAttachSpec(node);

  for (const union of node.unions) {
    const centers = union.parentIds.map((pid) => cardCenters.get(pid)).filter(Number.isFinite);
    if (centers.length >= 2) {
      segments.push({
        x1: centers[0],
        y1: top + Math.round(CARD_H * 0.52),
        x2: centers[centers.length - 1],
        y2: top + Math.round(CARD_H * 0.52),
        cls: "tree-link tree-link-parent",
      });
    }
    union.unionX = centers.length >= 2 ? (centers[0] + centers[centers.length - 1]) / 2 : (centers[0] ?? node.unionX);
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
      .map((child) => ({ child, attach: getNodeAttachSpec(child) }))
      .filter((pt) => Number.isFinite(pt.attach.joinX) && Number.isFinite(pt.attach.y));
    const childXs = childTargets.map((pt) => pt.attach.joinX);
    const trunkTop = top + CARD_H;
    const trunkBottom = trunkTop + trunkDrop;

    if (union.verticalChildren && childTargets.length > 1) {
      const railTop = childTargets[0].attach.y;
      const railBottom = childTargets[childTargets.length - 1].attach.y;
      segments.push({ x1: union.unionX, y1: trunkTop, x2: union.unionX, y2: railTop, cls: "tree-link tree-link-child" });
      if (railBottom > railTop) {
        segments.push({ x1: union.unionX, y1: railTop, x2: union.unionX, y2: railBottom, cls: "tree-link tree-link-child" });
      }
      for (const pt of childTargets) {
        segments.push({ x1: union.unionX, y1: pt.attach.y, x2: pt.attach.joinX, y2: pt.attach.y, cls: "tree-link tree-link-child" });
        drawAttachSpan(segments, pt.attach);
      }
    } else if (childXs.length === 1) {
      const target = childTargets[0].attach;
      const joinY = Math.min(trunkBottom, target.y);
      segments.push({ x1: union.unionX, y1: trunkTop, x2: union.unionX, y2: joinY, cls: "tree-link tree-link-child" });
      if (union.unionX !== target.joinX) {
        segments.push({ x1: union.unionX, y1: joinY, x2: target.joinX, y2: joinY, cls: "tree-link tree-link-child" });
      }
      if (joinY !== target.y) {
        segments.push({ x1: target.joinX, y1: joinY, x2: target.joinX, y2: target.y, cls: "tree-link tree-link-child" });
      }
      drawAttachSpan(segments, target);
    } else if (childXs.length > 1) {
      const minX = Math.min(...childXs);
      const maxX = Math.max(...childXs);
      const highestAttachY = Math.min(...childTargets.map((pt) => pt.attach.y));
      const busLift = Math.max(12, childStem);
      const busY = Math.max(trunkTop + 10, highestAttachY - busLift);
      segments.push({ x1: union.unionX, y1: trunkTop, x2: union.unionX, y2: busY, cls: "tree-link tree-link-child" });
      segments.push({ x1: minX, y1: busY, x2: maxX, y2: busY, cls: "tree-link tree-link-child" });
      for (const pt of childTargets) {
        segments.push({ x1: pt.attach.joinX, y1: busY, x2: pt.attach.joinX, y2: pt.attach.y, cls: "tree-link tree-link-child" });
        drawAttachSpan(segments, pt.attach);
      }
    }

    cursorLeft = branchLeft + union.branchWidth + unionGroupGap;
  }
}

function buildScene(treeJson, previewMode) {
  const metrics = makeLayoutMetrics();
  const model = normalizeTree(treeJson);
  let roots = buildRenderForest(model);

  const partialChildrenVisible = Math.max(1, metrics.view.partialChildrenVisible ?? 3);
  if (previewMode) {
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
  }

  roots = roots.map((root) => measureNode(root, metrics));

  const segments = [];
  const cards = [];
  const { sidePad, topPad, bottomPad, clusterGap } = metrics.spacing;

  const totalWidth = roots.reduce((sum, root, idx) => sum + root.subtreeWidth + (idx > 0 ? clusterGap : 0), 0);
  let cursorLeft = sidePad;
  const top = topPad;
  for (const root of roots) {
    layoutNode(root, cursorLeft, top, metrics, segments, cards);
    cursorLeft += root.subtreeWidth + clusterGap;
  }

  const maxRight = cards.reduce((m, c) => Math.max(m, c.x + metrics.card.width), 0);
  const maxBottom = cards.reduce((m, c) => Math.max(m, c.y + metrics.card.height), 0);
  const viewBox = {
    x: 0,
    y: 0,
    w: Math.max(sidePad * 2 + totalWidth, maxRight + sidePad),
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
    const syncLabel = () => {
      toggleBtn.textContent = state.preview ? "See Full Tree" : "See Partial Tree";
    };
    syncLabel();
    toggleBtn.addEventListener("click", () => {
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
  const state = { preview: metrics.view.defaultPartial !== false, treeJson };

  const render = () => {
    try {
      const scene = buildScene(state.treeJson, state.preview);
      renderFamilyTree(svg, scene);
      fitTreeToScreen();
    } catch (err) {
      console.error("[LineAgeMap] tree render failed", err);
    }
  };

  wireToolbar(state, render);
  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
