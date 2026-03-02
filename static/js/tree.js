// static/js/tree.js
// Dagre for Y-levels + deterministic recursive width layout for X.

import { renderFamilyTree, fitTreeToScreen } from "./familyTree.js";
import { TREE_CFG } from "./treeConfig.js";

function getRelPair(r) {
  if (r?.type === "spouse") return null;
  const parent = r.parentId ?? r.parent ?? r.sourceId ?? r.source ?? r.from ?? r.src;
  const child = r.childId ?? r.child ?? r.targetId ?? r.target ?? r.to ?? r.dst;
  if (!parent || !child) return null;
  return { parent: String(parent), child: String(child) };
}


function buildGeneDAG(data) {
  const people = Array.isArray(data.people) ? data.people : [];
  const relationships = Array.isArray(data.relationships) ? data.relationships : [];

  const personById = new Map(people.map((p) => [String(p.id), p]));
  const peopleSet = new Set([...personById.keys()]);

  const keyForParents = (ids) => ids.map(String).sort().join("|");
  const normPair = (a, b) => keyForParents([a, b]);

  // child -> Set(parents)
  const parentsByChild = new Map();

  // unionKey -> { parents: string[], children:Set<string> }
  const unions = new Map();

  const ensureUnion = (parentsArr) => {
    const parents = parentsArr.map(String).filter((id) => peopleSet.has(id));
    if (!parents.length) return null;

    const key = keyForParents(parents);
    if (!unions.has(key)) unions.set(key, { parents: parents.slice().sort(), children: new Set() });
    return key;
  };

  // 1) Spouse unions (even if no kids)
  for (const r of relationships) {
    if (r?.type !== "spouse") continue;
    const a = String(r.a ?? "");
    const b = String(r.b ?? "");
    if (!a || !b) continue;
    if (!peopleSet.has(a) || !peopleSet.has(b)) continue;
    ensureUnion([a, b]);
  }

  // 2) Parent links
  for (const r of relationships) {
    const pair = getRelPair(r);
    if (!pair) continue;

    const parent = String(pair.parent);
    const child = String(pair.child);
    if (!peopleSet.has(parent) || !peopleSet.has(child)) continue;

    if (!parentsByChild.has(child)) parentsByChild.set(child, new Set());
    parentsByChild.get(child).add(parent);
  }

  // 3) Attach children to unions
  for (const [childId, parentSet] of parentsByChild.entries()) {
    const parents = [...parentSet].map(String).filter((id) => peopleSet.has(id));
    if (!parents.length) continue;

    if (parents.length === 2) {
      const uKey = ensureUnion(parents);
      if (uKey) unions.get(uKey).children.add(String(childId));
      continue;
    }

    // Single-parent or multi-parent child (still render it deterministically)
    const uKey = ensureUnion(parents);
    if (uKey) unions.get(uKey).children.add(String(childId));
  }

  // 4) Build nodes
  const nodes = [];
  for (const p of people) {
    const id = String(p.id);
    nodes.push({
      id,
      kind: "person",
      label: p.name ?? p.label ?? id,
      photoUrl: p.photoUrl ?? p.photo ?? p.imageUrl ?? null,
      _raw: p,
    });
  }

  // union nodes use a stable id format: u:<parent1|parent2|...>
  for (const [uKey] of unions.entries()) {
    nodes.push({ id: `u:${uKey}`, kind: "union", label: "" });
  }

  // 5) Build edges (deduped)
  const edgeSet = new Set();
  const links = [];

  const addEdge = (s, t) => {
    const k = `${s}->${t}`;
    if (edgeSet.has(k)) return;
    edgeSet.add(k);
    links.push({ sourceId: s, targetId: t });
  };

  for (const [uKey, u] of unions.entries()) {
    const uId = `u:${uKey}`;

    // parents -> union
    for (const pid of u.parents) addEdge(String(pid), uId);

    // union -> kids
    for (const cid of u.children) addEdge(uId, String(cid));
  }

  return { nodes, links };
}


function dagreLayout(graphNodes, graphLinks, opts = {}) {
  const dagre = window.dagre;
  if (!dagre) throw new Error("Dagre not found. Ensure dagre.min.js loads before tree.js.");

  const cfg = { ...TREE_CFG.dagre, ...opts };

  const g = new dagre.graphlib.Graph();
  g.setGraph(cfg);
  g.setDefaultEdgeLabel(() => ({}));

  const PERSON_W = TREE_CFG.sizing.CARD_W;
  const PERSON_H = TREE_CFG.sizing.CARD_H;

  for (const n of graphNodes) {
    const isUnion = n.kind === "union";
    const w = isUnion ? 6 : PERSON_W;
    const h = isUnion ? 6 : PERSON_H;
    g.setNode(n.id, { width: w, height: h });
  }

  for (const e of graphLinks) g.setEdge(e.sourceId, e.targetId);

  dagre.layout(g);

  const placed = graphNodes.map((n) => {
    const dn = g.node(n.id);
    return { ...n, x: dn?.x ?? 0, y: dn?.y ?? 0 };
  });

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of placed) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }

  const pad = TREE_CFG.view.pad;
  for (const n of placed) {
    n.x = n.x - minX + pad;
    n.y = n.y - minY + pad;
    n._baseX = n.x;
    n._baseY = n.y;
  }

  return {
    nodes: placed,
    links: graphLinks.map((e) => ({ sourceId: String(e.sourceId), targetId: String(e.targetId) })),
    bounds: { width: (maxX - minX) + pad * 2, height: (maxY - minY) + pad * 2 },
  };
}

function recursiveWidthLayout(laidNodes, laidLinks, bounds) {
  const CARD_W = TREE_CFG.sizing.CARD_W;
  const CARD_OUTER_W = CARD_W + 24;
  const { SPOUSE_GAP, SIBLING_GAP, CLUSTER_GAP, ROW_EPS } = TREE_CFG.spacing;
  const MIN_GAP = 14;

  const byId = new Map(laidNodes.map((n) => [String(n.id), n]));
  const isUnion = (id) => byId.get(String(id))?.kind === "union";

  const unions = new Map();
  for (const l of laidLinks) {
    const s = String(l.sourceId);
    const t = String(l.targetId);

    if (isUnion(t) && !isUnion(s)) {
      if (!unions.has(t)) unions.set(t, { parents: new Set(), children: new Set() });
      unions.get(t).parents.add(s);
    } else if (isUnion(s) && !isUnion(t)) {
      if (!unions.has(s)) unions.set(s, { parents: new Set(), children: new Set() });
      unions.get(s).children.add(t);
    }
  }

  const unionsByParent = new Map();
  for (const [uId, pc] of unions.entries()) {
    for (const pid of pc.parents) {
      if (!unionsByParent.has(pid)) unionsByParent.set(pid, []);
      unionsByParent.get(pid).push(uId);
    }
  }

  const producedByUnion = new Map();
  for (const [uId, pc] of unions.entries()) {
    for (const cid of pc.children) producedByUnion.set(String(cid), String(uId));
  }

  const sortByBaseX = (ids) =>
    ids
      .map((id) => byId.get(String(id)))
      .filter(Boolean)
      .sort((a, b) => (a._baseX ?? a.x) - (b._baseX ?? b.x))
      .map((n) => String(n.id));

  const personWidthMemo = new Map();
  const unionWidthMemo = new Map();

  function personSubtreeWidth(personId, visiting = new Set()) {
    personId = String(personId);
    if (personWidthMemo.has(personId)) return personWidthMemo.get(personId);

    if (visiting.has(personId)) return CARD_OUTER_W;
    visiting.add(personId);

    const childUnions = unionsByParent.get(personId) ?? [];
    if (!childUnions.length) {
      personWidthMemo.set(personId, CARD_OUTER_W);
      visiting.delete(personId);
      return CARD_OUTER_W;
    }

    const widths = childUnions.map((uId) => unionSubtreeWidth(uId, visiting));
    const total = widths.reduce((a, b) => a + b, 0) + Math.max(0, widths.length - 1) * CLUSTER_GAP;

    const w = Math.max(CARD_W, total);
    personWidthMemo.set(personId, w);
    visiting.delete(personId);
    return w;
  }

  function unionSubtreeWidth(unionId, visiting = new Set()) {
    unionId = String(unionId);
    if (unionWidthMemo.has(unionId)) return unionWidthMemo.get(unionId);

    const pc = unions.get(unionId);
    if (!pc) {
      unionWidthMemo.set(unionId, CARD_OUTER_W);
      return CARD_OUTER_W;
    }

    const parentIds = sortByBaseX([...pc.parents]);
    const childIds = sortByBaseX([...pc.children]);

    const spouseBlockW =
      parentIds.length * CARD_OUTER_W + Math.max(0, parentIds.length - 1) * SPOUSE_GAP;

    const childWidths = childIds.map((cid) => personSubtreeWidth(cid, visiting));
    const childrenBlockW =
      childWidths.reduce((a, b) => a + b, 0) + Math.max(0, childWidths.length - 1) * SIBLING_GAP;

    const w = Math.max(spouseBlockW, childrenBlockW, CARD_OUTER_W);
    unionWidthMemo.set(unionId, w);
    return w;
  }

  const rootUnions = [];
  for (const [uId, pc] of unions.entries()) {
    const parentIds = [...pc.parents].map(String);
    const isRoot = parentIds.length > 0 && parentIds.every((pid) => !producedByUnion.has(pid));
    if (isRoot) rootUnions.push(uId);
  }

  rootUnions.sort((a, b) => {
    const ap = unions.get(a)?.parents ? sortByBaseX([...unions.get(a).parents]) : [];
    const bp = unions.get(b)?.parents ? sortByBaseX([...unions.get(b).parents]) : [];
    const ax = ap.length ? (byId.get(ap[0])?._baseX ?? byId.get(ap[0])?.x ?? 0) : 0;
    const bx = bp.length ? (byId.get(bp[0])?._baseX ?? byId.get(bp[0])?.x ?? 0) : 0;
    return ax - bx;
  });

  const assignedPerson = new Set();
  const ANCHOR_X = (bounds?.width ?? TREE_CFG.view.minWidth) / 2;

  function orderParentsOuterOutsiders(parentIds, unionCenterX) {
    const ordered = sortByBaseX(parentIds);
    const outsiders = ordered.filter((pid) => !producedByUnion.has(String(pid)));
    if (!outsiders.length) return ordered;

    const insiders = ordered.filter((pid) => producedByUnion.has(String(pid)));
    const outerIsLeft = unionCenterX < ANCHOR_X;
    return outerIsLeft ? [...outsiders, ...insiders] : [...insiders, ...outsiders];
  }

  function setSpousesAroundCenter(parentIds, centerX) {
    const parents = orderParentsOuterOutsiders(parentIds, centerX);
    const n = parents.length;
    if (!n) return;

    const fixed = [];
    const free = [];

    for (const pid of parents) {
      const p = byId.get(String(pid));
      if (!p) continue;
      if (assignedPerson.has(String(pid)) && typeof p.x === "number") fixed.push(String(pid));
      else free.push(String(pid));
    }

    // If nothing is fixed, do the normal symmetric placement
    if (!fixed.length) {
      const step = CARD_OUTER_W + SPOUSE_GAP;
      const totalW = (n - 1) * step;
      const startX = centerX - totalW / 2;

      for (let i = 0; i < n; i++) {
        const pid = String(parents[i]);
        const p = byId.get(pid);
        if (!p) continue;
        p.x = startX + i * step;
        assignedPerson.add(pid);
      }
      return;
    }

    // If at least one parent is fixed, anchor around the fixed parent(s)
    // Use the average fixed X as the couple center.
    const fixedXs = fixed
      .map((pid) => byId.get(pid)?.x)
      .filter((x) => typeof x === "number");

    const anchorX =
      fixedXs.length ? (fixedXs.reduce((a, b) => a + b, 0) / fixedXs.length) : centerX;

    // Build target slots around anchor
    const step = CARD_OUTER_W + SPOUSE_GAP;
    const totalW = (n - 1) * step;
    const startX = anchorX - totalW / 2;

    // First assign fixed parents to the nearest available slots (without moving them)
    const slots = [];
    for (let i = 0; i < n; i++) slots.push(startX + i * step);

    const usedSlot = new Array(n).fill(false);

    const takeNearestSlot = (x) => {
      let bestI = -1;
      let bestD = Infinity;
      for (let i = 0; i < n; i++) {
        if (usedSlot[i]) continue;
        const d = Math.abs(slots[i] - x);
        if (d < bestD) { bestD = d; bestI = i; }
      }
      if (bestI >= 0) usedSlot[bestI] = true;
      return bestI;
    };

    for (const pid of fixed) {
      const p = byId.get(pid);
      if (!p) continue;
      takeNearestSlot(p.x);
      assignedPerson.add(pid);
    }

    // Then place the remaining (free) parents into unused slots
    for (const pid of free) {
      const p = byId.get(pid);
      if (!p) continue;

      let i = usedSlot.findIndex((v) => !v);
      if (i < 0) i = 0;

      usedSlot[i] = true;
      p.x = slots[i];
      assignedPerson.add(pid);
    }
  }

  function setChildrenEven(childIds, centerX) {
    const kids = sortByBaseX(childIds);
    const n = kids.length;
    if (!n) return;

    if (n === 1) {
      const c = byId.get(kids[0]);
      if (c) {
        c.x = centerX;
        assignedPerson.add(kids[0]);
      }
      return;
    }

    const widths = kids.map((cid) => personSubtreeWidth(cid));
    const totalW = widths.reduce((a, b) => a + b, 0) + (n - 1) * SIBLING_GAP;
    let cursor = centerX - totalW / 2;

    for (let i = 0; i < n; i++) {
      const cid = kids[i];
      const w = widths[i];
      const mid = cursor + w / 2;

      const child = byId.get(cid);
      if (child) {
        child.x = mid;
        assignedPerson.add(cid);
      }

      cursor += w + SIBLING_GAP;
    }
  }

  function layoutUnion(unionId, centerX) {
    unionId = String(unionId);

    const pc = unions.get(unionId);
    if (!pc) return;

    const parents = [...pc.parents].map(String);
    const kids = [...pc.children].map(String);

    // If any parent is already assigned, anchor union center to that parent(s)
    const fixedParents = parents
      .map((pid) => byId.get(pid))
      .filter((p) => p && assignedPerson.has(String(p.id)) && typeof p.x === "number");

    if (fixedParents.length) {
      centerX = fixedParents.reduce((a, p) => a + p.x, 0) / fixedParents.length;
    }

    const u = byId.get(unionId);
    if (u) u.x = centerX;

    setSpousesAroundCenter(parents, centerX);
    setChildrenEven(kids, centerX);

    for (const cid of kids) {
      const child = byId.get(cid);
      if (!child) continue;

      const childUnions = unionsByParent.get(cid) ?? [];
      for (const cu of childUnions) layoutUnion(cu, child.x);
    }
  }

  const rootWs = rootUnions.map((uId) => unionSubtreeWidth(uId));
  const rootTotalW =
    rootWs.reduce((a, b) => a + b, 0) + Math.max(0, rootWs.length - 1) * CLUSTER_GAP;

  let cursor = ANCHOR_X - rootTotalW / 2;
  for (let i = 0; i < rootUnions.length; i++) {
    const uId = rootUnions[i];
    const w = rootWs[i];
    const mid = cursor + w / 2;

    layoutUnion(uId, mid);

    cursor += w + CLUSTER_GAP;


  function recenterUnionsToParents() {
    for (const [uId, pc] of unions.entries()) {
      const u = byId.get(String(uId));
      if (!u) continue;
      const px = [...pc.parents]
        .map((pid) => byId.get(String(pid))?.x)
        .filter((x) => typeof x === "number");
      if (!px.length) continue;
      u.x = px.reduce((a, b) => a + b, 0) / px.length;
    }
  }

  function enforceCoupleAdjacency() {
    const step = CARD_OUTER_W + SPOUSE_GAP;
    for (const [uId, pc] of unions.entries()) {
      const parents = [...pc.parents].map(String).filter((pid) => byId.get(pid)?.kind !== "union");
      if (parents.length !== 2) continue;

      const p1 = byId.get(parents[0]);
      const p2 = byId.get(parents[1]);
      const u = byId.get(String(uId));
      if (!p1 || !p2 || !u) continue;

      const cx = typeof u.x === "number" ? u.x : (p1.x + p2.x) / 2;
      const leftX = cx - step / 2;
      const rightX = cx + step / 2;

      // Keep original left/right ordering stable by baseX
      const p1Base = (p1._baseX ?? p1.x);
      const p2Base = (p2._baseX ?? p2.x);
      const leftIsP1 = p1Base <= p2Base;

      if (leftIsP1) {
        p1.x = leftX;
        p2.x = rightX;
      } else {
        p2.x = leftX;
        p1.x = rightX;
      }
      assignedPerson.add(String(p1.id));
      assignedPerson.add(String(p2.id));
      u.x = (p1.x + p2.x) / 2;
    }
  }

  function enforceNoOverlapByRow() {
    const rowBuckets = new Map();
    for (const n of laidNodes) {
      if (n.kind === "union") continue;
      const y = typeof n.y === "number" ? n.y : 0;
      const key = Math.round(y / ROW_EPS);
      if (!rowBuckets.has(key)) rowBuckets.set(key, []);
      rowBuckets.get(key).push(n);
    }

    for (const nodes of rowBuckets.values()) {
      nodes.sort((a, b) => a.x - b.x);
      let cursor = -Infinity;
      for (const n of nodes) {
        const half = CARD_OUTER_W / 2;
        const minX = cursor + half + MIN_GAP;
        if (n.x - half < minX) n.x = minX + half;
        cursor = n.x + half;
      }
    }
  }

  // Post-pass: keep couples adjacent and prevent horizontal overlaps.
  recenterUnionsToParents();
  enforceCoupleAdjacency();
  enforceNoOverlapByRow();
  recenterUnionsToParents();

  }

  for (const n of laidNodes) {
    if (n.kind === "union") continue;
    const id = String(n.id);
    if (!assignedPerson.has(id)) {
      n.x = typeof n._baseX === "number" ? n._baseX : n.x;
    }
  }

  let minX = Infinity, maxX = -Infinity;
  for (const n of laidNodes) {
    if (typeof n.x !== "number") continue;
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
  }

  const pad = TREE_CFG.view.pad;
  const shiftX = (minX === Infinity) ? 0 : (pad - minX);
  for (const n of laidNodes) n.x += shiftX;

  const newWidth = (maxX - minX) + pad * 2;
  return { nodes: laidNodes, width: newWidth };
}

function enablePanZoom(svg, viewport) {
  let scale = 1, tx = 0, ty = 0;
  const apply = () => viewport.setAttribute("transform", `translate(${tx}, ${ty}) scale(${scale})`);

  const reset = () => {
    scale = 1;
    tx = 0;
    ty = 0;
    apply();
  };

  svg.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;

      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.min(4, Math.max(0.2, scale * factor));

      const sx = (mx - tx) / scale;
      const sy = (my - ty) / scale;

      scale = newScale;
      tx = mx - sx * scale;
      ty = my - sy * scale;

      apply();
    },
    { passive: false }
  );

  let dragging = false, lastX = 0, lastY = 0;

  svg.addEventListener("pointerdown", (e) => {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    lastX = e.clientX;
    lastY = e.clientY;
  });

  svg.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    tx += e.clientX - lastX;
    ty += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  });

  svg.addEventListener("pointerup", (e) => {
    dragging = false;
    try { svg.releasePointerCapture(e.pointerId); } catch {}
  });

  apply();
  return { reset };
}

async function loadTreeData(treeName = "gupta") {
  const apiUrl = window.TREE_API_URL || null;
  const url = apiUrl ? apiUrl : `/api/tree/${encodeURIComponent(treeName)}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load tree JSON (${res.status})`);
  return await res.json();
}

function descendantsOnlyData(data, opts = {}) {
  const people = Array.isArray(data.people) ? data.people : [];
  const rels = Array.isArray(data.relationships) ? data.relationships : [];

  const peopleById = new Map(people.map((p) => [String(p.id), p]));
  const childrenByParent = new Map();
  const parentsByChild = new Map();
  const isChild = new Set();

  for (const r of rels) {
    const pair = getRelPair(r);
    if (!pair) continue;
    const parent = String(pair.parent);
    const child = String(pair.child);
    if (!peopleById.has(parent) || !peopleById.has(child)) continue;

    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(child);

    if (!parentsByChild.has(child)) parentsByChild.set(child, new Set());
    parentsByChild.get(child).add(parent);

    isChild.add(child);
  }

  const candidates = [];
  for (const [childId, parentSet] of parentsByChild.entries()) {
    const parents = [...parentSet];
    if (!parents.length) continue;
    const allTop = parents.every((pid) => !isChild.has(String(pid)));
    if (!allTop) continue;
    candidates.push({ parents });
  }

  const uniqKey = (parents) => parents.slice().sort().join("|");
  const uniq = new Map();
  for (const c of candidates) {
    const key = uniqKey(c.parents);
    if (!uniq.has(key)) uniq.set(key, c.parents);
  }

  const maxKidsPerParent = (() => {
    const v = opts.maxKidsPerParent;
    if (typeof v === "number" && isFinite(v) && v > 0) return Math.floor(v);
    return null;
  })();

  function collectDescendants(rootParents) {
    const keep = new Set(rootParents.map(String));
    const q = rootParents.map(String);

    while (q.length) {
      const cur = q.shift();
      let kids = childrenByParent.get(String(cur)) || [];

      if (maxKidsPerParent != null) kids = kids.slice(0, maxKidsPerParent);

      for (const kid of kids) {
        const k = String(kid);
        if (keep.has(k)) continue;
        keep.add(k);
        q.push(k);
      }
    }
    return keep;
  }

  let bestParents = null;
  let bestSize = -1;
  for (const parents of uniq.values()) {
    const keep = collectDescendants(parents);
    if (keep.size > bestSize) {
      bestSize = keep.size;
      bestParents = parents;
    }
  }

  if (!bestParents) {
    const roots = people.map((p) => String(p.id)).filter((id) => !isChild.has(id));
    let bestRoot = null;
    for (const r of roots) {
      const keep = collectDescendants([r]);
      if (keep.size > bestSize) {
        bestSize = keep.size;
        bestRoot = r;
      }
    }
    bestParents = bestRoot ? [bestRoot] : roots.slice(0, 1);
  }

  const keep = collectDescendants(bestParents || []);

  return {
    ...data,
    people: people.filter((p) => keep.has(String(p.id))),
    relationships: rels.filter((r) => {
      const pair = getRelPair(r);
      if (!pair) return false;
      return keep.has(String(pair.parent)) && keep.has(String(pair.child));
    }),
  };
}

function wireFitUI(svg, panZoomApi) {
  const btn = document.getElementById("fitTreeBtn");
  if (!btn) return;

  const doFit = () => {
    if (panZoomApi?.reset) panZoomApi.reset();
    requestAnimationFrame(() => fitTreeToScreen(svg));
  };

  btn.addEventListener("click", doFit);

  let t = null;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(doFit, 140);
  });
}

export async function initTree(treeName = "stark") {
  const svg = document.querySelector("#treeSvg");
  if (!svg) throw new Error("Missing #treeSvg element");

  svg.innerHTML = "";

  let data = await loadTreeData(treeName);

  const fullTree = window.TREE_FULL_TREE === true;
  const moreBtn = document.getElementById("treeMoreBtn");
  if (moreBtn) moreBtn.textContent = fullTree ? "Show Simple Tree" : "Show Full Tree";

  const descendantsOnly = (window.TREE_DESCENDANTS_ONLY !== false) && !fullTree;
  if (descendantsOnly) {
    const cfgMax = TREE_CFG.preview?.SIMPLE_MAX_KIDS_PER_PARENT ?? 2;
    const maxKids = Number(window.TREE_SIMPLE_MAX_KIDS ?? cfgMax);
    data = descendantsOnlyData(data, { maxKidsPerParent: maxKids });
  }

  const { nodes: graphNodes, links: graphLinks } = buildGeneDAG(data);

  const laid = dagreLayout(graphNodes, graphLinks, TREE_CFG.dagre);
  const laidX = recursiveWidthLayout(laid.nodes, laid.links, laid.bounds);

  const width = Math.max(TREE_CFG.view.minWidth, laidX.width + TREE_CFG.view.extra);
  const height = Math.max(TREE_CFG.view.minHeight, laid.bounds.height + TREE_CFG.view.extra);

  const result = renderFamilyTree(svg, {
    nodes: laidX.nodes,
    links: laid.links,
    width,
    height,
  });

  const panZoomApi = enablePanZoom(svg, result.viewport);
  wireFitUI(svg, panZoomApi);

  panZoomApi.reset();
  fitTreeToScreen(svg);

  const moreBtn2 = document.getElementById("treeMoreBtn");
  if (moreBtn2 && !moreBtn2._wired) {
    moreBtn2._wired = true;
    moreBtn2.addEventListener("click", () => {
      window.TREE_FULL_TREE = !(window.TREE_FULL_TREE === true);
      initTree(String(treeName).toLowerCase()).catch((e) => console.error(e));
    });
  }
}

function __lmBoot() {
  const svg = document.querySelector("#treeSvg");
  if (!svg) return;
  const fam = (window.TREE_FAMILY_ID || "stark");
  initTree(String(fam).toLowerCase()).catch((e) => console.error(e));
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", __lmBoot);
} else {
  __lmBoot();
}