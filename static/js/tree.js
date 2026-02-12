// tree.js
// Dagre layout + union nodes for genealogical structure.
// IMPORTANT: do NOT collapse unions (renderer uses them for couple+hub routing).
// Adds a post-layout spacing refinement so you can control:
// - spouse gap
// - sibling gap
// - extra gap between unrelated nodes/clusters

import { renderFamilyTree } from "./familyTree.js";

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

  // Dense base layout (we'll refine spacing after)
  const {
    rankdir = "TB",
    ranksep = 50,
    nodesep = 22,
    marginx = 12,
    marginy = 12,
  } = opts;

  const g = new dagre.graphlib.Graph();
  g.setGraph({ rankdir, ranksep, nodesep, marginx, marginy });
  g.setDefaultEdgeLabel(() => ({}));

  // MUST match card sizing in familyTree.js
  const PERSON_W = 190;
  const PERSON_H = 200;

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

  // Normalize
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of placed) {
    minX = Math.min(minX, n.x);
    minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x);
    maxY = Math.max(maxY, n.y);
  }

  const pad = 22;
  for (const n of placed) {
    n.x = n.x - minX + pad;
    n.y = n.y - minY + pad;
  }

  return {
    nodes: placed,
    links: graphLinks.map((e) => ({ sourceId: String(e.sourceId), targetId: String(e.targetId) })),
    bounds: { width: (maxX - minX) + pad * 2, height: (maxY - minY) + pad * 2 },
  };
}

// Post-layout spacing refinement:
// - spouses in same union: fixed gap
// - siblings under same union: fixed gap
// - unrelated nodes on same row: enforced minimum "cluster gap"
function refineSpacing(laidNodes, laidLinks, opts = {}) {
  const {
    SPOUSE_GAP = 14,      // gap BETWEEN spouse cards
    SIBLING_GAP = 12,     // gap BETWEEN sibling cards
    CLUSTER_GAP = 70,     // extra breathing room between unrelated nodes on a row
    CARD_W = 190,         // match familyTree.js
  } = opts;

  const byId = new Map(laidNodes.map((n) => [String(n.id), n]));
  const isUnion = (id) => byId.get(String(id))?.kind === "union";

  // unionId -> { parents:[], children:[] }
  const unions = new Map();

  for (const e of laidLinks) {
    const s = String(e.sourceId);
    const t = String(e.targetId);

    if (isUnion(t) && !isUnion(s)) {
      if (!unions.has(t)) unions.set(t, { parents: [], children: [] });
      unions.get(t).parents.push(s);
    } else if (isUnion(s) && !isUnion(t)) {
      if (!unions.has(s)) unions.set(s, { parents: [], children: [] });
      unions.get(s).children.push(t);
    }
  }

  function placeRowCentered(ids, cx, gap) {
    const arr = [...new Set(ids)].map((id) => byId.get(id)).filter(Boolean);
    arr.sort((a, b) => a.x - b.x);

    const step = CARD_W + gap;
    const totalW = arr.length > 0 ? (arr.length - 1) * step : 0;
    const startX = cx - totalW / 2;

    for (let i = 0; i < arr.length; i++) {
      arr[i].x = startX + i * step;
    }
  }

  // 1) Enforce spouse + sibling spacing per union
  for (const [uId, pc] of unions.entries()) {
    const u = byId.get(uId);
    if (!u) continue;

    const parentIds = pc.parents.filter((id) => byId.has(id));
    const childIds = pc.children.filter((id) => byId.has(id));

    if (parentIds.length) placeRowCentered(parentIds, u.x, SPOUSE_GAP);
    if (childIds.length) placeRowCentered(childIds, u.x, SIBLING_GAP);

    // Keep union centered between spouses (improves routing)
    if (parentIds.length >= 2) {
      const ps = parentIds
        .map((id) => byId.get(id))
        .filter(Boolean)
        .sort((a, b) => a.x - b.x);
      u.x = (ps[0].x + ps[ps.length - 1].x) / 2;
    }
  }

  // 2) Cluster separation (simple collision push on each y band)
  const bands = new Map();
  const BAND = 18; // y tolerance for "same row"

  for (const n of laidNodes) {
    if (n.kind === "union") continue;
    const key = Math.round(n.y / BAND);
    if (!bands.has(key)) bands.set(key, []);
    bands.get(key).push(n);
  }

  for (const [, row] of bands.entries()) {
    row.sort((a, b) => a.x - b.x);
    let lastRight = -Infinity;

    for (const n of row) {
      const left = n.x - CARD_W / 2;
      if (left < lastRight + CLUSTER_GAP) {
        const push = (lastRight + CLUSTER_GAP) - left;
        n.x += push;
      }
      lastRight = n.x + CARD_W / 2;
    }
  }

  return laidNodes;
}

function enablePanZoom(svg, viewport) {
  let scale = 1, tx = 0, ty = 0;
  const apply = () => viewport.setAttribute("transform", `translate(${tx}, ${ty}) scale(${scale})`);

  svg.addEventListener("wheel", (e) => {
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
  }, { passive: false });

  let dragging = false, lastX = 0, lastY = 0;

  svg.addEventListener("pointerdown", (e) => {
    dragging = true;
    svg.setPointerCapture(e.pointerId);
    lastX = e.clientX;
    lastY = e.clientY;
  });

  svg.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    tx += (e.clientX - lastX);
    ty += (e.clientY - lastY);
    lastX = e.clientX;
    lastY = e.clientY;
    apply();
  });

  svg.addEventListener("pointerup", (e) => {
    dragging = false;
    try { svg.releasePointerCapture(e.pointerId); } catch {}
  });

  apply();
}

async function loadTreeData(treeName = "gupta") {
  const res = await fetch(`/api/tree/${encodeURIComponent(treeName)}`);
  if (!res.ok) throw new Error(`Failed to load tree JSON (${res.status})`);
  return await res.json();
}

export async function initTree(treeName = "gupta") {
  const svg = document.querySelector("#treeSvg");
  if (!svg) throw new Error("Missing #treeSvg element");

  const data = await loadTreeData(treeName);
  const { nodes: graphNodes, links: graphLinks } = buildGeneDAG(data);

  const laid = dagreLayout(graphNodes, graphLinks, { rankdir: "TB" });

  // YOUR CONTROL KNOBS:
  refineSpacing(laid.nodes, laid.links, {
    SPOUSE_GAP: 12,   // tighter spouses
    SIBLING_GAP: 10,  // tighter siblings
    CLUSTER_GAP: 70,  // keep unrelated branches from crushing each other
    CARD_W: 190,
  });

  const result = renderFamilyTree(svg, {
    nodes: laid.nodes,
    links: laid.links,
    width: Math.max(1050, laid.bounds.width + 60),
    height: Math.max(620, laid.bounds.height + 60),
  });

  enablePanZoom(svg, result.viewport);
}

document.addEventListener("DOMContentLoaded", () => {
  const svg = document.querySelector("#treeSvg");
  if (!svg) return;
  initTree("gupta").catch((e) => console.error(e));
});
