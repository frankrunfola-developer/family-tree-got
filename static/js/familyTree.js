// static/js/familyTree.js
// Renderer for the family tree.
// IMPORTANT: person node.x/node.y are TOP-LEFT coordinates.
//            union node.x/node.y are CENTER coordinates.
// NOTE: We only "frame" the tree by computing a tight viewBox. We do NOT change layout math.

import { TREE_CFG } from "./treeConfig.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// unionId -> rendered join point (x/y) for unions when we draw custom couple joins.
const UNION_RENDER_POS = new Map();
const UNION_JOIN_Y = new Map();

let _LAST_NODES = null;
let _LAST_SVG = null;

function el(tag) {
  return document.createElementNS(SVG_NS, tag);
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function anchor(n, where) {
  const { CARD_W, CARD_H } = TREE_CFG.sizing;

  if (n.kind === "union") return { x: n.x, y: n.y };

  const cx = n.x + CARD_W / 2;
  const top = n.y;
  const bottom = n.y + CARD_H;
  const mid = n.y + CARD_H / 2;

  if (where === "top") return { x: cx, y: top };
  if (where === "bottom") return { x: cx, y: bottom };
  if (where === "mid") return { x: cx, y: mid };
  return { x: cx, y: mid };
}

function computeStemLen() {
  const guess = Number(TREE_CFG.dagre?.ranksep ?? 50) * 0.35;
  return Math.max(18, Math.min(60, guess));
}

function drawMarriageIcon(linksG, x, y) {
  const g = el("g");
  g.setAttribute("transform", `translate(${x}, ${y})`);
  g.setAttribute("opacity", "0.9");
  g.setAttribute("pointer-events", "none");

  const mkRing = (cx) => {
    const c = el("circle");
    c.setAttribute("cx", String(cx));
    c.setAttribute("cy", "0");
    c.setAttribute("r", "8.2");
    c.setAttribute("fill", "none");
    c.setAttribute("stroke", "var(--tree-link)");
    c.setAttribute("stroke-width", "1.6");
    return c;
  };

  g.appendChild(mkRing(-4.2));
  g.appendChild(mkRing(4.2));
  linksG.appendChild(g);
}

function drawPathCommon(path) {
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "var(--tree-link)");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
}

function drawElbowPath(path, a, b) {
  const stem = computeStemLen();
  const midY = a.y + stem;

  const d = [
    `M ${a.x} ${a.y}`,
    `L ${a.x} ${midY}`,
    `L ${b.x} ${midY}`,
    `L ${b.x} ${b.y}`,
  ].join(" ");

  path.setAttribute("d", d);
}

function buildNodeMap(nodes) {
  const m = new Map();
  for (const n of nodes) m.set(String(n.id), n);
  return m;
}

function applyViewBox(svg, nodes, opts = {}) {
  const { CARD_W, CARD_H } = TREE_CFG.sizing;
  const { minWidth, minHeight, pad, extra } = TREE_CFG.view;

  const mx = Number(TREE_CFG.dagre?.marginx ?? 0) || 0;
  const my = Number(TREE_CFG.dagre?.marginy ?? 0) || 0;

  const enforceMin = opts.enforceMin !== false;
  const padUsed = typeof opts.padOverride === "number" ? opts.padOverride : pad;
  const extraUsed =
    typeof opts.extraOverride === "number" ? opts.extraOverride : (extra ?? 0);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  for (const n of nodes) {
    if (n.kind === "union") {
      const p = UNION_RENDER_POS.get(String(n.id));
      const x = p ? p.x : n.x;
      const y = p ? p.y : n.y;

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      continue;
    }

    const left = n.x;
    const right = n.x + CARD_W;
    const top = n.y;
    const bottom = n.y + CARD_H;

    minX = Math.min(minX, left);
    maxX = Math.max(maxX, right);
    minY = Math.min(minY, top);
    maxY = Math.max(maxY, bottom);
  }

  if (!isFinite(minX) || !isFinite(minY)) {
    minX = 0;
    minY = 0;
    maxX = minWidth;
    maxY = minHeight;
  }

  let vbX = minX - padUsed - mx;
  let vbY = minY - padUsed - my;
  let vbW = (maxX - minX) + padUsed * 2 + mx * 2;
  let vbH = (maxY - minY) + padUsed * 2 + my * 2 + extraUsed;

  if (enforceMin) {
    if (vbW < minWidth) {
      const add = (minWidth - vbW) / 2;
      vbX -= add;
      vbW = minWidth;
    }
    if (vbH < minHeight) {
      const add = (minHeight - vbH) / 2;
      vbY -= add;
      vbH = minHeight;
    }
  }

  svg.setAttribute("viewBox", `${vbX} ${vbY} ${vbW} ${vbH}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
}

function pickMeta(raw) {
  if (!raw) return "";

  const direct =
    raw.meta ??
    raw.subtitle ??
    raw.subTitle ??
    raw.dates ??
    raw.date ??
    raw.birthDeath ??
    raw.lifespan ??
    raw.years ??
    raw.yearRange ??
    raw.displayYears ??
    raw.displayDate ??
    raw.life ??
    raw.lifeSpan ??
    null;

  if (typeof direct === "string" && direct.trim()) return direct.trim();

  const by =
    raw.birthYear ?? raw.birth_year ?? raw.bornYear ?? raw.born_year ??
    raw.birthDate ?? raw.birth_date ??
    raw.birth ?? raw.born ?? raw.b ??
    raw.startYear ?? raw.start_year ??
    null;

  const dy =
    raw.deathYear ?? raw.death_year ?? raw.diedYear ?? raw.died_year ??
    raw.deathDate ?? raw.death_date ??
    raw.death ?? raw.died ?? raw.d ??
    raw.endYear ?? raw.end_year ??
    null;

  const norm = (v) => {
    if (v == null) return null;
    const s = String(v).trim();
    if (!s) return null;
    const m = s.match(/^(\d{4})[-/]/);
    if (m) return m[1];
    return s;
  };

  const B = norm(by);
  const D = norm(dy);

  if (B && D) return `${B} – ${D}`;
  if (B) return /\bb\./i.test(B) ? B : `b. ${B}`;
  if (D) return /\bd\./i.test(D) ? D : `d. ${D}`;
  return "";
}

function drawCoupleJoin(linksG, parents, unionNode) {
  if (!unionNode || parents.length < 2) return;

  const ps = parents.slice().sort((a, b) => a.x - b.x);
  const left = ps[0];
  const right = ps[ps.length - 1];

  const unionId = String(unionNode.id);
  const { CARD_W, CARD_H } = TREE_CFG.sizing;

  // Union connector runs through the vertical middle of the parent cards.
  const coupleY = (left.y + right.y) / 2 + CARD_H / 2;

  // Only draw across the gap between the parent cards.
  const aL = { x: left.x + CARD_W, y: coupleY };
  const aR = { x: right.x, y: coupleY };

  const p3 = el("path");
  drawPathCommon(p3);
  p3.setAttribute("stroke-width", "3");
  p3.setAttribute("d", `M ${aL.x} ${coupleY} L ${aR.x} ${coupleY}`);
  linksG.appendChild(p3);

  const midX = (aL.x + aR.x) / 2;

  UNION_JOIN_Y.set(unionId, coupleY);
  UNION_RENDER_POS.set(unionId, { x: midX, y: coupleY });

  drawMarriageIcon(linksG, midX, coupleY - CARD_H * 0.42);
}

function drawUnionChildFan(linksG, unionId, joinY, childNodes) {
  if (!childNodes || !childNodes.length) return;

  const u = UNION_RENDER_POS.get(unionId);
  if (!u) return;

  const { CARD_W, CARD_H } = TREE_CFG.sizing;

  const minChildTopY = Math.min(...childNodes.map((c) => c.y));

  const parentBottomY = joinY + (CARD_H / 2);
  const pivotY = parentBottomY + (minChildTopY - parentBottomY) / 2;

  u.y = pivotY;
  UNION_RENDER_POS.set(unionId, u);

  const v = el("path");
  drawPathCommon(v);
  v.setAttribute("stroke-width", "2.8");
  v.setAttribute("d", `M ${u.x} ${joinY} L ${u.x} ${pivotY}`);
  linksG.appendChild(v);

  for (const c of childNodes) {
    const cx = c.x + CARD_W / 2;
    const cy = c.y;

    const ln = el("path");
    drawPathCommon(ln);
    ln.setAttribute("stroke-width", "2.4");
    ln.setAttribute("d", `M ${u.x} ${pivotY} L ${cx} ${cy}`);
    linksG.appendChild(ln);
  }
}

export function renderFamilyTree(svg, { nodes, links }) {
  clear(svg);
  UNION_RENDER_POS.clear();
  UNION_JOIN_Y.clear();

  _LAST_NODES = nodes;
  _LAST_SVG = svg;

  const viewport = el("g");
  viewport.setAttribute("class", "tree-viewport");
  svg.appendChild(viewport);

  const defs = el("defs");
  viewport.appendChild(defs);

  const nodeById = buildNodeMap(nodes);

  const parentsByUnion = new Map();
  const childrenByUnion = new Map();

  for (const lk of links) {
    const sid = lk.sourceId ?? lk.source;
    const tid = lk.targetId ?? lk.target;
    const s = nodeById.get(String(sid));
    const t = nodeById.get(String(tid));
    if (!s || !t) continue;

    if (t.kind === "union" && s.kind === "person") {
      const u = String(t.id);
      if (!parentsByUnion.has(u)) parentsByUnion.set(u, []);
      parentsByUnion.get(u).push(s);
    }

    if (s.kind === "union" && t.kind === "person") {
      const u = String(s.id);
      if (!childrenByUnion.has(u)) childrenByUnion.set(u, []);
      childrenByUnion.get(u).push(t);
    }
  }

  const nodesG = el("g");
  nodesG.setAttribute("class", "tree-nodes");
  viewport.appendChild(nodesG);

  const linksG = el("g");
  linksG.setAttribute("class", "tree-links");

  // Precompute custom joins
  for (const [uId, ps] of parentsByUnion.entries()) {
    if (ps.length >= 2) drawCoupleJoin(linksG, ps, nodeById.get(uId));
  }

  for (const [uId, ps] of parentsByUnion.entries()) {
    if (ps.length < 2) continue;
    const joinY = UNION_JOIN_Y.get(uId);
    const kids = childrenByUnion.get(uId) ?? [];
    if (Number.isFinite(joinY)) drawUnionChildFan(linksG, uId, joinY, kids);
  }

  // Normal links (skip unions with >=2 parents because we drew custom ones)
  for (const lk of links) {
    const sid = lk.sourceId ?? lk.source;
    const tid = lk.targetId ?? lk.target;
    const s = nodeById.get(String(sid));
    const t = nodeById.get(String(tid));
    if (!s || !t) continue;

    if (s.kind === "person" && t.kind === "union") {
      const uId = String(t.id);
      const ps = parentsByUnion.get(uId) ?? [];
      if (ps.length >= 2) continue;

      const path = el("path");
      drawPathCommon(path);
      drawElbowPath(path, anchor(s, "bottom"), anchor(t, "mid"));
      linksG.appendChild(path);
      continue;
    }

    if (s.kind === "union" && t.kind === "person") {
      const uId = String(s.id);
      const ps = parentsByUnion.get(uId) ?? [];
      if (ps.length >= 2) continue;

      const path = el("path");
      drawPathCommon(path);

      const p = UNION_RENDER_POS.get(uId);
      const from = p ? { x: p.x, y: p.y } : anchor(s, "mid");

      drawElbowPath(path, from, anchor(t, "top"));
      linksG.appendChild(path);
    }
  }

  // Draw nodes (people + union dots)
  const { CARD_W, CARD_H, CARD_R } = TREE_CFG.sizing;
  const BOTTOM_PANEL_H = Number(TREE_CFG.sizing.BOTTOM_PANEL_H ?? 45);

  for (const n of nodes) {
    if (n.kind === "union") {
      const c = el("circle");
      const p = UNION_RENDER_POS.get(String(n.id));
      c.setAttribute("cx", p ? p.x : n.x);
      c.setAttribute("cy", p ? p.y : n.y);
      c.setAttribute("r", "4.5");
      c.setAttribute("fill", "var(--tree-union-dot)");
      nodesG.appendChild(c);
      continue;
    }

    const g = el("g");
    g.setAttribute("transform", `translate(${n.x}, ${n.y})`);
    nodesG.appendChild(g);

    const card = el("rect");
    card.setAttribute("x", "0");
    card.setAttribute("y", "0");
    card.setAttribute("width", String(CARD_W));
    card.setAttribute("height", String(CARD_H));
    card.setAttribute("rx", String(CARD_R));
    card.setAttribute("ry", String(CARD_R));
    card.setAttribute("fill", "var(--tree-card-bg)");
    card.setAttribute("stroke", "var(--tree-card-stroke)");
    card.setAttribute("stroke-width", "1.5");
    g.appendChild(card);

    const clipId = `clip_${String(n.id).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    const clip = el("clipPath");
    clip.setAttribute("id", clipId);

    const photoH = Number(TREE_CFG.sizing.PHOTO_H ?? (CARD_H - BOTTOM_PANEL_H));
    const photoW = Math.min(CARD_W, Number(TREE_CFG.sizing.PHOTO_W ?? CARD_W));
    const photoX = Math.max(0, Math.round((CARD_W - photoW) / 2));
    const photoRR = Math.max(10, Math.round(CARD_R * 0.75));

    const clipRect = el("rect");
    clipRect.setAttribute("x", String(photoX));
    clipRect.setAttribute("y", "0");
    clipRect.setAttribute("width", String(photoW));
    clipRect.setAttribute("height", String(photoH));
    clipRect.setAttribute("rx", String(photoRR));
    clipRect.setAttribute("ry", String(photoRR));
    clip.appendChild(clipRect);
    defs.appendChild(clip);

    if (n.photoUrl) {
      const img = el("image");
      img.setAttribute("href", n.photoUrl);
      img.setAttribute("x", String(photoX));
      img.setAttribute("y", "0");
      img.setAttribute("width", String(photoW));
      img.setAttribute("height", String(photoH));
      img.setAttribute("preserveAspectRatio", "xMidYMid slice");
      img.setAttribute("clip-path", `url(#${clipId})`);
      g.appendChild(img);
    } else {
      const ph = el("rect");
      ph.setAttribute("x", String(photoX));
      ph.setAttribute("y", "0");
      ph.setAttribute("width", String(photoW));
      ph.setAttribute("height", String(photoH));
      ph.setAttribute("rx", String(photoRR));
      ph.setAttribute("ry", String(photoRR));
      ph.setAttribute("fill", "var(--tree-photo-ph)");
      g.appendChild(ph);
    }

    const sep = el("line");
    sep.setAttribute("x1", "10");
    sep.setAttribute("x2", String(CARD_W - 10));
    sep.setAttribute("y1", String(photoH));
    sep.setAttribute("y2", String(photoH));
    sep.setAttribute("stroke", "rgba(78,57,40,0.18)");
    sep.setAttribute("stroke-width", "1");
    g.appendChild(sep);

    const panel = el("rect");
    panel.setAttribute("x", "0");
    panel.setAttribute("y", String(CARD_H - BOTTOM_PANEL_H));
    panel.setAttribute("width", String(CARD_W));
    panel.setAttribute("height", String(BOTTOM_PANEL_H));
    panel.setAttribute("fill", "var(--tree-card-bg)");
    panel.setAttribute("opacity", "0.96");
    panel.setAttribute("stroke", "rgba(0,0,0,0.08)");
    panel.setAttribute("stroke-width", "1");
    g.appendChild(panel);

    const panelTop = CARD_H - BOTTOM_PANEL_H;
    const defaultNameY = panelTop + 8;
    const nameY = Number.isFinite(TREE_CFG.text?.NAME_Y) ? TREE_CFG.text.NAME_Y : defaultNameY;

    const defaultMetaY = nameY + TREE_CFG.fonts.NAME_PX + 6;
    const metaY = Number.isFinite(TREE_CFG.text?.META_Y) ? TREE_CFG.text.META_Y : defaultMetaY;

    const name = el("text");
    name.setAttribute("x", String(CARD_W / 2));
    name.setAttribute("y", String(nameY));
    name.setAttribute("text-anchor", "middle");
    name.setAttribute("dominant-baseline", "hanging");
    name.setAttribute(
      "style",
      [
        "fill: var(--tree-text-strong)",
        `font-size: ${TREE_CFG.fonts.NAME_PX}px`,
        `font-weight: ${TREE_CFG.fonts.WEIGHT_NAME}`,
        "font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        "pointer-events: none",
      ].join("; ")
    );
    name.textContent = (n.label ?? "").toString();
    g.appendChild(name);

    const meta = el("text");
    meta.setAttribute("x", String(CARD_W / 2));
    meta.setAttribute("y", String(metaY));
    meta.setAttribute("text-anchor", "middle");
    meta.setAttribute("dominant-baseline", "hanging");
    meta.setAttribute(
      "style",
      [
        "fill: var(--tree-text-soft)",
        `font-size: ${TREE_CFG.fonts.META_PX}px`,
        `font-weight: ${TREE_CFG.fonts.WEIGHT_META}`,
        "font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        "pointer-events: none",
      ].join("; ")
    );
    meta.textContent = pickMeta(n._raw);
    g.appendChild(meta);
  }

  // Put links on top (single append)
  viewport.appendChild(linksG);

  const isNarrow = window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
  applyViewBox(svg, nodes, {
    enforceMin: !isNarrow,
    padOverride: isNarrow ? 4 : undefined,
    extraOverride: isNarrow ? 0 : undefined,
  });

  return { viewport };
}

export function fitTreeToScreen(svgOverride = null, cfg = null) {
  const svg = svgOverride || _LAST_SVG;
  if (!svg || !_LAST_NODES || !_LAST_NODES.length) return;

  const extra =
    (cfg && cfg.view && Number.isFinite(cfg.view.fitExtra) && cfg.view.fitExtra >= 0)
      ? cfg.view.fitExtra
      : (cfg && cfg.view && Number.isFinite(cfg.view.pad) && cfg.view.pad >= 0)
        ? cfg.view.pad
        : 0;

  applyViewBox(svg, _LAST_NODES, { enforceMin: false, extraOverride: extra });
}