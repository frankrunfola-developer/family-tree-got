/* static/js/tree.js */

import { TREE_CFG } from "./treeConfig.js";
import { renderFamilyTree, fitTreeToScreen } from "./familyTree.js";

function $(sel) {
  return document.querySelector(sel);
}

function uniq(arr) {
  return Array.from(new Set(arr));
}

function byId(list) {
  const m = new Map();
  for (const it of list) m.set(it.id, it);
  return m;
}

function safeText(v) {
  return (v == null ? "" : String(v));
}

function makePersonNode(p) {
  return {
    id: p.id,
    kind: "person",
    label: safeText(p.name || p.label || p.id),
    gender: p.gender || null,
    birthYear: p.birthYear || p.birth_year || null,
    deathYear: p.deathYear || p.death_year || null,
    photoUrl: p.photoUrl || p.photo_url || p.photo || null,
  };
}

function unionKey(a, b) {
  const x = a || "_";
  const y = b || "_";
  return x < y ? `u:${x}:${y}` : `u:${y}:${x}`;
}

function buildGraph(treeJson, { previewMode, previewDepth }) {
  const people = Array.isArray(treeJson?.people) ? treeJson.people : [];
  const rels = Array.isArray(treeJson?.relationships) ? treeJson.relationships : [];

  const personNodes = people.map(makePersonNode);
  const peopleById = byId(personNodes);

  const unions = new Map();

  for (const r of rels) {
    const childId = r.childId;
    const p1 = r.parentId;
    const p2 = r.otherParentId || null;

    if (!childId || !p1) continue;
    if (!peopleById.has(childId) || !peopleById.has(p1)) continue;
    if (p2 && !peopleById.has(p2)) continue;

    const uId = unionKey(p1, p2);
    if (!unions.has(uId)) {
      unions.set(uId, {
        id: uId,
        kind: "union",
        parents: uniq([p1, p2].filter(Boolean)),
        childIds: new Set(),
      });
    }
    unions.get(uId).childIds.add(childId);
  }

  let nodes = [
    ...personNodes,
    ...Array.from(unions.values()).map(u => ({
      id: u.id,
      kind: "union",
      parents: u.parents,
    })),
  ];

  let links = [];
  for (const u of unions.values()) {
    for (const pId of u.parents) links.push({ source: pId, target: u.id });
    for (const cId of u.childIds) links.push({ source: u.id, target: cId });
  }

  if (previewMode && previewDepth > 0) {
    const childIds = new Set(rels.map(r => r.childId).filter(Boolean));
    const roots = personNodes.map(p => p.id).filter(id => !childIds.has(id));

    const start = roots.length ? [roots[0]] : (personNodes[0] ? [personNodes[0].id] : []);
    const keep = new Set(start);
    const q = start.map(id => ({ id, depth: 0 }));

    const parentToChildren = new Map();
    for (const r of rels) {
      if (!r.parentId || !r.childId) continue;
      if (!parentToChildren.has(r.parentId)) parentToChildren.set(r.parentId, []);
      parentToChildren.get(r.parentId).push(r.childId);
      if (r.otherParentId) {
        if (!parentToChildren.has(r.otherParentId)) parentToChildren.set(r.otherParentId, []);
        parentToChildren.get(r.otherParentId).push(r.childId);
      }
    }

    while (q.length) {
      const cur = q.shift();
      if (cur.depth >= previewDepth) continue;
      const kids = parentToChildren.get(cur.id) || [];
      for (const k of kids) {
        if (!keep.has(k)) {
          keep.add(k);
          q.push({ id: k, depth: cur.depth + 1 });
        }
      }
    }

    const keptPeople = new Set(Array.from(keep));
    const keptUnions = new Set();

    for (const u of unions.values()) {
      const parentKept = u.parents.some(p => keptPeople.has(p));
      const childKept = Array.from(u.childIds).some(c => keptPeople.has(c));
      if (parentKept && childKept) keptUnions.add(u.id);
    }

    nodes = nodes.filter(n => (n.kind === "person" ? keptPeople.has(n.id) : keptUnions.has(n.id)));
    const keepNode = new Set(nodes.map(n => n.id));
    links = links.filter(l => keepNode.has(l.source) && keepNode.has(l.target));
  }

  return { nodes, links };
}

function layoutWithDagre(nodes, links) {
  if (!window.dagre) throw new Error("dagre is missing (window.dagre not found)");

  const g = new window.dagre.graphlib.Graph();
  g.setGraph({
    rankdir: TREE_CFG?.dagre?.rankdir || "TB",
    nodesep: (TREE_CFG?.dagre?.nodesep ?? TREE_CFG.nodeSep ?? 50),
    ranksep: (TREE_CFG?.dagre?.ranksep ?? TREE_CFG.rankSep ?? 50),
    marginx: (TREE_CFG?.dagre?.marginx ?? 0),
    marginy: (TREE_CFG?.dagre?.marginy ?? 0),
    edgesep: 6,
  });
  g.setDefaultEdgeLabel(() => ({}));

  const nodeW = TREE_CFG.nodeW ?? TREE_CFG.sizing?.CARD_W ?? 260;
  const nodeH = TREE_CFG.nodeH ?? TREE_CFG.sizing?.CARD_H ?? 280;
  const unionW = TREE_CFG.unionW ?? TREE_CFG.sizing?.UNION_W ?? 12;
  const unionH = TREE_CFG.unionH ?? TREE_CFG.sizing?.UNION_H ?? 12;

  for (const n of nodes) {
    const w = n.kind === "union" ? unionW : nodeW;
    const h = n.kind === "union" ? unionH : nodeH;
    g.setNode(n.id, { width: w, height: h });
  }

  for (const e of links) {
    if (!g.hasNode(e.source) || !g.hasNode(e.target)) continue;
    g.setEdge(e.source, e.target);
  }

  window.dagre.layout(g);

  const byNodeId = new Map(nodes.map(n => [n.id, n]));
  for (const id of g.nodes()) {
    const pos = g.node(id);
    const n = byNodeId.get(id);
    if (!n || !pos) continue;

    if (n.kind === "union") {
      n.x = pos.x;
      n.y = pos.y;
    } else {
      n.x = pos.x - (nodeW / 2);
      n.y = pos.y - (nodeH / 2);
    }
  }
}

function centerChildrenUnderParents(nodes, links) {
  const { CARD_W } = TREE_CFG.sizing;

  const byId = new Map(nodes.map(n => [n.id, n]));
  const out = new Map();
  for (const e of links) {
    if (!out.has(e.source)) out.set(e.source, []);
    out.get(e.source).push(e.target);
  }

  const unionChildren = new Map();
  for (const e of links) {
    const src = byId.get(e.source);
    if (src && src.kind === "union") {
      if (!unionChildren.has(e.source)) unionChildren.set(e.source, []);
      unionChildren.get(e.source).push(e.target);
    }
  }

  const unions = nodes
    .filter(n => n.kind === "union" && Number.isFinite(n.x) && Number.isFinite(n.y))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));

  const shiftSubtree = (rootId, dx, touched) => {
    const stack = [rootId];
    while (stack.length) {
      const id = stack.pop();
      if (touched.has(id)) continue;
      touched.add(id);

      const n = byId.get(id);
      if (n) {
        if (n.kind === "union") n.x += dx;
        else n.x += dx;
      }

      const kids = out.get(id) || [];
      for (const k of kids) stack.push(k);
    }
  };

  for (const u of unions) {
    const kids = unionChildren.get(u.id) || [];
    if (kids.length < 2) continue;

    const centers = [];
    for (const cId of kids) {
      const c = byId.get(cId);
      if (!c || !Number.isFinite(c.x)) continue;
      const cx = c.kind === "union" ? c.x : (c.x + CARD_W / 2);
      centers.push(cx);
    }
    if (centers.length < 2) continue;

    const min = Math.min(...centers);
    const max = Math.max(...centers);
    const spanCenter = (min + max) / 2;
    const dx = u.x - spanCenter;

    if (Math.abs(dx) < 0.5) continue;

    const touched = new Set();
    for (const cId of kids) shiftSubtree(cId, dx, touched);
  }
}


async function fetchTreeJson() {
  const url = window.TREE_API_URL;
  if (!url) throw new Error("TREE_API_URL is not set");

  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`Tree API ${res.status} ${res.statusText}`);
  return res.json();
}

function wireToolbar(renderFull) {
  const btnFit = $("#btnFit");
  if (btnFit) btnFit.addEventListener("click", () => fitTreeToScreen());

  const btnFull = $("#btnFull");
  if (btnFull) btnFull.addEventListener("click", renderFull);
}

async function boot() {
  const svg = $("#treeSvg");
  if (!svg) return;

  let treeJson;
  try {
    treeJson = await fetchTreeJson();
  } catch (e) {
    console.error("[LineAgeMap] tree API failed", e);
    return;
  }

  const state = { treeJson, preview: !!window.TREE_PREVIEW_MODE };
  const previewDepth = Number(window.TREE_PREVIEW_DEPTH || 2);

  const render = () => {
    const { nodes, links } = buildGraph(state.treeJson, {
      previewMode: state.preview,
      previewDepth,
    });

    try {
      layoutWithDagre(nodes, links);
      centerChildrenUnderParents(nodes, links);
      renderFamilyTree(svg, { nodes, links });
      fitTreeToScreen();
    } catch (e) {
      console.error("[LineAgeMap] tree render failed", e);
    }
  };

  const renderFull = () => {
    state.preview = false;
    render();
  };

  wireToolbar(renderFull);
  render();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
