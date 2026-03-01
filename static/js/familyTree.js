// static/js/familyTree.js
// Renderer for the family tree.
// IMPORTANT: node.x/node.y are CENTER coordinates everywhere (Option A).
// NOTE: We only "frame" the tree by computing a tight viewBox. We do NOT change layout math.

import { TREE_CFG } from "./treeConfig.js";

const SVG_NS = "http://www.w3.org/2000/svg";

// unionId -> rendered Y for union join point (used when STEM forces uniform stems)
const UNION_RENDER_Y = new Map();

// Remember the last render so the "Fit to screen" button can re-frame the viewBox
let _LAST_NODES = null;
let _LAST_SVG = null;

function el(tag) {
  return document.createElementNS(SVG_NS, tag);
}

function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

function cardTopLeft(n) {
  const { CARD_W, CARD_H } = TREE_CFG.sizing;
  return { x: n.x - CARD_W / 2, y: n.y - CARD_H / 2 };
}

function anchor(n, where) {
  const { CARD_H } = TREE_CFG.sizing;

  // unions are points, people are cards (anchors depend on top/bottom of card)
  if (n.kind === "union") return { x: n.x, y: n.y };

  const top = n.y - CARD_H / 2;
  const bottom = n.y + CARD_H / 2;

  if (where === "top") return { x: n.x, y: top };
  if (where === "bottom") return { x: n.x, y: bottom };
  return { x: n.x, y: n.y };
}

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

function computeStemLen() {
  // All elbow routing uses ONE shared vertical stem length.
  // This keeps the tree visually consistent and makes tuning easy.
  const stem = TREE_CFG.links.STEM;
  return (typeof stem === "number" && isFinite(stem) && stem > 0) ? stem : 14;
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

  // Two rings with slight overlap
  g.appendChild(mkRing(-4.2));
  g.appendChild(mkRing(4.2));

  linksG.appendChild(g);
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

/**
 * Compute a tight viewBox around the actual tree bounds (cards + union points).
 * - For normal render we still enforce minWidth/minHeight so tiny trees don't over-zoom.
 * - For "Fit to screen" we disable min enforcement and remove extra bottom padding.
 */
function applyViewBox(svg, nodes, opts = {}) {
  const { CARD_W, CARD_H } = TREE_CFG.sizing;
  const { minWidth, minHeight, pad, extra } = TREE_CFG.view;

  const enforceMin = opts.enforceMin !== false; // default true
  const padUsed = typeof opts.padOverride === "number" ? opts.padOverride : pad;
  const extraUsed = typeof opts.extraOverride === "number" ? opts.extraOverride : (extra ?? 0);

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const n of nodes) {
    if (n.kind === "union") {
      // unions are points (but may be "render-shifted" when STEM is used)
      const uy = UNION_RENDER_Y.get(String(n.id));
      const y = uy != null ? uy : n.y;

      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      continue;
    }

    // people are cards: node.x/node.y are centers
    const left = n.x - CARD_W / 2;
    const right = n.x + CARD_W / 2;
    const top = n.y - CARD_H / 2;
    const bottom = n.y + CARD_H / 2;

    minX = Math.min(minX, left);
    maxX = Math.max(maxX, right);
    minY = Math.min(minY, top);
    maxY = Math.max(maxY, bottom);
  }

  // Safety fallback if nodes are empty/invalid
  if (!isFinite(minX) || !isFinite(minY)) {
    minX = 0;
    minY = 0;
    maxX = minWidth;
    maxY = minHeight;
  }

  // Tight bounds + padding
  let vbX = minX - padUsed;
  let vbY = minY - padUsed;
  let vbW = (maxX - minX) + padUsed * 2;
  let vbH = (maxY - minY) + padUsed * 2 + extraUsed;

  // Optional: Enforce minimum view size WITHOUT breaking centering
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
  // Keep scaling, but pin to top so it doesn't float with big vertical bands on tall screens
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

function drawPathCommon(path) {
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "var(--tree-link)");
  path.setAttribute("stroke-width", "1.6");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
}

function drawCoupleJoin(linksG, parents, unionNode) {
  if (!unionNode || parents.length < 2) return;

  // Sort parents left->right by center X
  const ps = parents.slice().sort((a, b) => a.x - b.x);

  const left = ps[0];
  const right = ps[ps.length - 1];

  const unionId = String(unionNode.id);

  const { CARD_W } = TREE_CFG.sizing;

  // "Inner wall" connection points (mid-height of each card)
  const aL = { x: left.x + CARD_W / 2, y: left.y };
  const aR = { x: right.x - CARD_W / 2, y: right.y };

  // Use the same vertical stem length everywhere (trunk and child elbows).
  const stem = computeStemLen();

  // Horizontal join line sits in the middle between the parents (at their mid-height)
  const joinY = (aL.y + aR.y) / 2;


  // Render the union join point one stem-length below the join line (visual anchoring only)
  const unionRenderY = joinY + stem;
  UNION_RENDER_Y.set(unionId, unionRenderY);

  // Horizontal join between parents (touches the INNER walls)
  const p3 = el("path");
  drawPathCommon(p3);
  p3.setAttribute("stroke-width", "3");
  p3.setAttribute("d", `M ${aL.x} ${joinY} L ${aR.x} ${joinY}`);
  linksG.appendChild(p3);

  // Vertical trunk down from the midpoint of the horizontal join
  const midX = (aL.x + aR.x) / 2;

  // put icon slightly ABOVE the horizontal join line
  drawMarriageIcon(linksG, midX, joinY - 20);
  
  const p4 = el("path");
  drawPathCommon(p4);
  p4.setAttribute("stroke-width", "2.8");
  p4.setAttribute("d", `M ${midX} ${joinY} L ${midX} ${unionRenderY}`);
  linksG.appendChild(p4);
}



export function renderFamilyTree(svg, { nodes, links, width, height }) {
  clear(svg);
  UNION_RENDER_Y.clear();

  // Persist the last render so the "Fit to screen" button can re-frame
  _LAST_NODES = nodes;
  _LAST_SVG = svg;

  // Treat tablet widths as "narrow" too; otherwise min viewBox enforcement adds big blank bands
  const isNarrow = window.matchMedia && window.matchMedia("(max-width: 900px)").matches;


  applyViewBox(svg, nodes, {
    enforceMin: !isNarrow,
    padOverride: isNarrow ? 4 : undefined,
    extraOverride: isNarrow ? 0 : undefined,
  });




  const viewport = el("g");
  viewport.setAttribute("class", "tree-viewport");
  svg.appendChild(viewport);

  const defs = el("defs");
  viewport.appendChild(defs);

  const nodeById = buildNodeMap(nodes);

  // Build union->parents map from links
  const parentsByUnion = new Map();
  for (const lk of links) {
    const s = nodeById.get(String(lk.sourceId));
    const t = nodeById.get(String(lk.targetId));
    if (!s || !t) continue;

    if (t.kind === "union" && s.kind === "person") {
      const u = String(t.id);
      if (!parentsByUnion.has(u)) parentsByUnion.set(u, []);
      parentsByUnion.get(u).push(s);
    }
  }

  // ---- Links layer ----
  const linksG = el("g");
  linksG.setAttribute("class", "tree-links");
  viewport.appendChild(linksG);

  // 1) Draw couple joins once per union (for 2+ parents)
  for (const [uId, ps] of parentsByUnion.entries()) {
    if (ps.length >= 2) {
      drawCoupleJoin(linksG, ps, nodeById.get(uId));
    }
  }

  // 2) Draw remaining links:
  //    - union -> child: always
  //    - person -> union: only when that union has <2 parents (single-parent case)
  for (const lk of links) {
    const s = nodeById.get(String(lk.sourceId));
    const t = nodeById.get(String(lk.targetId));
    if (!s || !t) continue;

    // Skip person->union if union has 2+ parents (couple join already drawn)
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

    // union -> child elbow (start at rendered union Y when present)
    if (s.kind === "union" && t.kind === "person") {
      const path = el("path");
      drawPathCommon(path);

      const uId = String(s.id);
      const y = UNION_RENDER_Y.get(uId);
      const from = y != null ? { x: s.x, y } : anchor(s, "mid");

      drawElbowPath(path, from, anchor(t, "top"));
      linksG.appendChild(path);
      continue;
    }
  }

  // ---- Nodes layer ----
  const nodesG = el("g");
  nodesG.setAttribute("class", "tree-nodes");
  viewport.appendChild(nodesG);

  const { CARD_W, CARD_H, CARD_R, PHOTO_H } = TREE_CFG.sizing;

  for (const n of nodes) {
    if (n.kind === "union") {
      const c = el("circle");
      c.setAttribute("cx", n.x);

      const y = UNION_RENDER_Y.get(String(n.id));
      c.setAttribute("cy", y != null ? y : n.y);

      c.setAttribute("r", "4.5");
      c.setAttribute("fill", "var(--tree-union-dot)");
      nodesG.appendChild(c);
      continue;
    }

    const g = el("g");
    const tl = cardTopLeft(n);
    g.setAttribute("transform", `translate(${tl.x}, ${tl.y})`);
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

    const PHOTO_H = Number(TREE_CFG.sizing.PHOTO_H ?? Math.round(CARD_H * 0.75));
    const PHOTO_RR = Math.max(10, Math.round(CARD_R * 0.75));

    const clipRect = el("rect");
    clipRect.setAttribute("x", "0");
    clipRect.setAttribute("y", "0");
    clipRect.setAttribute("width", String(CARD_W));
    clipRect.setAttribute("height", String(PHOTO_H));
    clipRect.setAttribute("rx", String(PHOTO_RR));
    clipRect.setAttribute("ry", String(PHOTO_RR));
    clip.appendChild(clipRect);
    defs.appendChild(clip);

    if (n.photoUrl) {
      const img = el("image");
      img.setAttribute("href", n.photoUrl);
      img.setAttribute("x", "0");
      img.setAttribute("y", "0");
      img.setAttribute("width", String(CARD_W));
      img.setAttribute("height", String(PHOTO_H));
      img.setAttribute("preserveAspectRatio", "xMidYMid slice");
      img.setAttribute("clip-path", `url(#${clipId})`);
      g.appendChild(img);
    } else {
      const ph = el("rect");
      ph.setAttribute("x", "0");
      ph.setAttribute("y", "0");
      ph.setAttribute("width", String(CARD_W));
      ph.setAttribute("height", String(PHOTO_H));
      ph.setAttribute("rx", String(PHOTO_RR));
      ph.setAttribute("ry", String(PHOTO_RR));
      ph.setAttribute("fill", "var(--tree-photo-ph)");
      g.appendChild(ph);
    }

    const sep = el("line");
    sep.setAttribute("x1", "10");
    sep.setAttribute("x2", String(CARD_W - 10));
    sep.setAttribute("y1", String(PHOTO_H));
    sep.setAttribute("y2", String(PHOTO_H));
    sep.setAttribute("stroke", "rgba(78,57,40,0.18)");
    sep.setAttribute("stroke-width", "1");
    g.appendChild(sep);

        const name = el("text");
    name.setAttribute("x", String(CARD_W / 2));
    name.setAttribute("y", String(TREE_CFG.text.NAME_Y));
    name.setAttribute("text-anchor", "middle");
    name.setAttribute("dominant-baseline", "middle");
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
    meta.setAttribute("y", String(TREE_CFG.text.META_Y));
    meta.setAttribute("text-anchor", "middle");
    meta.setAttribute("dominant-baseline", "middle");
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

  return { viewport };
}

/**
 * Re-apply the "camera framing" (tight viewBox) for the last rendered tree.
 * Used by the always-visible "Fit to screen" button.
 */
export function fitTreeToScreen(svgOverride = null) {
  const svg = svgOverride || _LAST_SVG;
  if (!svg || !_LAST_NODES || !_LAST_NODES.length) return;

  // Fit should be truly tight: no minimums, no extra bottom padding
  applyViewBox(svg, _LAST_NODES, { enforceMin: false, extraOverride: 0 });
}