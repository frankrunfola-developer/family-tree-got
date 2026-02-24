// static/js/tree.js
// Dagre for Y-levels + deterministic recursive width layout for X.
// Guarantees:
// - NO node swapping (spouses keep a stable left-to-right order)
// - Even sibling spacing
// - If siblings need more width, their ENTIRE descendant subtrees recursively widen outward
// - Single child is centered under parents
// - If a spouse has no parents (not produced by a union), keep them on the OUTER side of the screen
//   so siblings stay tighter. Never swap a sibling with a spouse.

import { renderFamilyTree, fitTreeToScreen } from "./familyTree.js";
import { TREE_CFG } from "./treeConfig.js";

function getRelPair(r) {
  const parent =
    r.parentId ?? r.parent ?? r.sourceId ?? r.source ?? r.from ?? r.src;
  const child =
    r.childId ?? r.child ?? r.targetId ?? r.target ?? r.to ?? r.dst;
  if (!parent || !child) return null;
  return { parent: String(parent), child: String(child) };
}

function buildGeneDAG(data) {
  const people = Array.isArray(data.people) ? data.people : [];
  const relationships = Array.isArray(data.relationships) ? data.relationships : [];

  const personById = new Map(people.map((p) => [String(p.id), p]));
  const parentsByChild = new Map();

  for (const r of relationships) {
    const pair = getRelPair(r);
    if (!pair) continue;
    if (!parentsByChild.has(pair.child)) parentsByChild.set(pair.child, new Set());
    parentsByChild.get(pair.child).add(pair.parent);
  }

  const unionIdByKey = new Map();
  const unions = [];
  const edges = [];

  const unionKey = (parents) => [...parents].sort().join("|");

  for (const [childId, parentSet] of parentsByChild.entries()) {
    const parents = [...parentSet].filter((pid) => personById.has(pid));
    if (!parents.length) continue;

    const key = unionKey(parents);
    let unionId = unionIdByKey.get(key);

    if (!unionId) {
      unionId = `u:${key}`;
      unionIdByKey.set(key, unionId);
      unions.push({ id: unionId, kind: "union", parents });
      for (const pid of parents) edges.push({ sourceId: pid, targetId: unionId });
    }

    edges.push({ sourceId: unionId, targetId: childId });
  }

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

  for (const u of unions) nodes.push({ id: u.id, kind: "union", label: "" });

  // Ensure any referenced ids exist as nodes
  const seen = new Set(nodes.map((n) => n.id));
  for (const e of edges) {
    if (!seen.has(e.sourceId)) {
      nodes.push({ id: e.sourceId, kind: "person", label: e.sourceId });
      seen.add(e.sourceId);
    }
    if (!seen.has(e.targetId)) {
      nodes.push({ id: e.targetId, kind: "person", label: e.targetId });
      seen.add(e.targetId);
    }
  }

  return { nodes, links: edges };
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
    // dagre gives CENTER coordinates. We keep node.x/node.y as CENTER everywhere.
    return { ...n, x: dn?.x ?? 0, y: dn?.y ?? 0 };
  });

  // Normalize
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

    // freeze original X for stable spouse ordering
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
  const { SPOUSE_GAP, SIBLING_GAP, CLUSTER_GAP } = TREE_CFG.spacing;

  const byId = new Map(laidNodes.map((n) => [String(n.id), n]));
  const isUnion = (id) => byId.get(String(id))?.kind === "union";

  // unionId -> { parents:Set, children:Set }
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

  // personId -> unionIds where this person is a parent
  const unionsByParent = new Map();
  for (const [uId, pc] of unions.entries()) {
    for (const pid of pc.parents) {
      if (!unionsByParent.has(pid)) unionsByParent.set(pid, []);
      unionsByParent.get(pid).push(uId);
    }
  }

  // child-> union that produced them (for roots detection)
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

  // ---- Width computation (bottom-up) ----
  const personWidthMemo = new Map();
  const unionWidthMemo = new Map();

  function personSubtreeWidth(personId, visiting = new Set()) {
    personId = String(personId);
    if (personWidthMemo.has(personId)) return personWidthMemo.get(personId);

    if (visiting.has(personId)) return CARD_W;
    visiting.add(personId);

    const childUnions = unionsByParent.get(personId) ?? [];
    if (!childUnions.length) {
      personWidthMemo.set(personId, CARD_W);
      visiting.delete(personId);
      return CARD_W;
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
      unionWidthMemo.set(unionId, CARD_W);
      return CARD_W;
    }

    const parentIds = sortByBaseX([...pc.parents]);
    const childIds = sortByBaseX([...pc.children]);

    const spouseBlockW =
      parentIds.length * CARD_W + Math.max(0, parentIds.length - 1) * SPOUSE_GAP;

    const childWidths = childIds.map((cid) => personSubtreeWidth(cid, visiting));
    const childrenBlockW =
      childWidths.reduce((a, b) => a + b, 0) + Math.max(0, childWidths.length - 1) * SIBLING_GAP;

    const w = Math.max(spouseBlockW, childrenBlockW, CARD_W);
    unionWidthMemo.set(unionId, w);
    return w;
  }

  // ---- Find root unions (TOP of tree) ----
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

  // Global anchor used to define "outer part of the screen"
  const ANCHOR_X = (bounds?.width ?? TREE_CFG.view.minWidth) / 2;

  function orderParentsOuterOutsiders(parentIds, unionCenterX) {
    const ordered = sortByBaseX(parentIds);

    // Outsider = spouse that does NOT have a parent union (no parents in tree)
    const outsiders = ordered.filter((pid) => !producedByUnion.has(String(pid)));
    if (!outsiders.length) return ordered;

    const insiders = ordered.filter((pid) => producedByUnion.has(String(pid)));

    // "Outer side" depends on which half of the screen the union lives on
    const outerIsLeft = unionCenterX < ANCHOR_X;

    // Put outsiders on the outer end
    return outerIsLeft ? [...outsiders, ...insiders] : [...insiders, ...outsiders];
  }

  function setSpousesAroundCenter(parentIds, centerX) {
    const parents = orderParentsOuterOutsiders(parentIds, centerX);
    const n = parents.length;
    if (!n) return;

    const step = CARD_W + SPOUSE_GAP;
    const totalW = (n - 1) * step;
    const startX = centerX - totalW / 2;

    for (let i = 0; i < n; i++) {
      const pid = parents[i];
      const p = byId.get(pid);
      if (!p) continue;
      p.x = startX + i * step; // CENTER X
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
    const u = byId.get(unionId);
    if (u) u.x = centerX;

    const pc = unions.get(unionId);
    if (!pc) return;

    const parents = [...pc.parents].map(String);
    const kids = [...pc.children].map(String);

    setSpousesAroundCenter(parents, centerX);
    setChildrenEven(kids, centerX);

    for (const cid of kids) {
      const child = byId.get(cid);
      if (!child) continue;

      const childUnions = unionsByParent.get(cid) ?? [];
      for (const cu of childUnions) layoutUnion(cu, child.x);
    }
  }

  // Place root unions across the page, anchored to center
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
  }

  // Any person not assigned (isolated) keep at baseX
  for (const n of laidNodes) {
    if (n.kind === "union") continue;
    const id = String(n.id);
    if (!assignedPerson.has(id)) {
      n.x = typeof n._baseX === "number" ? n._baseX : n.x;
    }
  }

  // Re-normalize X after layout so the whole thing is tight in viewBox
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

/**
 * Pan/zoom modifies the <g> viewport transform.
 * Fit-to-screen must reset this transform, otherwise viewBox changes won't appear to "recenter".
 */
function enablePanZoom(svg, viewport) {
  let scale = 1, tx = 0, ty = 0;
  const apply = () => viewport.setAttribute("transform", `translate(${tx}, ${ty}) scale(${scale})`);

  const reset = () => {
    scale = 1;
    tx = 0;
    ty = 0;
    apply();
  };

  // Zoom under mouse
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

  // Pan (drag)
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

function subsetFamilyData(data, opts = {}) {
  // Build a small, readable "above the fold" slice: roots -> depth N.
  const depth = Number(opts.depth ?? 2);
  const maxPeople = Number(opts.maxPeople ?? 18);

  const people = Array.isArray(data.people) ? data.people : [];
  const rels = Array.isArray(data.relationships) ? data.relationships : [];

  const peopleById = new Map(people.map((p) => [String(p.id), p]));
  const childrenByParent = new Map();
  const isChild = new Set();

  for (const r of rels) {
    const pair = getRelPair(r);
    if (!pair) continue;
    const parent = String(pair.parent);
    const child = String(pair.child);
    if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
    childrenByParent.get(parent).push(child);
    isChild.add(child);
  }

  const roots = people
    .map((p) => String(p.id))
    .filter((id) => !isChild.has(id));

  const start = roots.length ? roots : people.slice(0, 2).map((p) => String(p.id));
  const keep = new Set();
  const q = start.map((id) => ({ id, d: 0 }));

  while (q.length && keep.size < maxPeople) {
    const cur = q.shift();
    if (!cur) break;
    if (keep.has(cur.id)) continue;
    if (!peopleById.has(cur.id)) continue;
    keep.add(cur.id);
    if (cur.d >= depth) continue;
    const kids = childrenByParent.get(cur.id) || [];
    for (const k of kids) {
      if (keep.size >= maxPeople) break;
      q.push({ id: String(k), d: cur.d + 1 });
    }
  }

  const keepRels = rels.filter((r) => {
    const pair = getRelPair(r);
    if (!pair) return false;
    return keep.has(String(pair.parent)) && keep.has(String(pair.child));
  });

  return {
    ...data,
    people: people.filter((p) => keep.has(String(p.id))),
    relationships: keepRels,
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

  // Keep it viewable on resize/orientation changes
  let t = null;
  window.addEventListener("resize", () => {
    clearTimeout(t);
    t = setTimeout(doFit, 140);
  });
}

export async function initTree(treeName = "stark") {
  const svg = document.querySelector("#treeSvg");
  if (!svg) throw new Error("Missing #treeSvg element");

  // Clear any previous render
  svg.innerHTML = "";

  let data = await loadTreeData(treeName);

  // Optional: condensed view for a bigger, easier-to-read first render.
  const isMobile = window.matchMedia && window.matchMedia("(max-width: 760px)").matches;
  const mobileOnly = window.TREE_PREVIEW_MOBILE_ONLY !== false;
  const previewMode = Boolean(window.TREE_PREVIEW_MODE) && (!mobileOnly || isMobile);
  const moreBtn = document.getElementById("treeMoreBtn");
  if (previewMode) {
    data = subsetFamilyData(data, {
      depth: window.TREE_PREVIEW_DEPTH ?? 2,
      maxPeople: window.TREE_PREVIEW_MAX ?? 18,
    });
    if (moreBtn) moreBtn.hidden = false;
  } else {
    if (moreBtn) moreBtn.hidden = true;
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

  // Start centered/tight
  panZoomApi.reset();
  fitTreeToScreen(svg);

  // One-click expand to full tree
  if (moreBtn && !moreBtn._wired) {
    moreBtn._wired = true;
    moreBtn.addEventListener("click", () => {
      window.TREE_PREVIEW_MODE = false;
      initTree(String(treeName).toLowerCase()).catch((e) => console.error(e));
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const svg = document.querySelector("#treeSvg");
  if (!svg) return;
  const fam = (window.TREE_FAMILY_ID || "stark");
  initTree(String(fam).toLowerCase()).catch((e) => console.error(e));
});