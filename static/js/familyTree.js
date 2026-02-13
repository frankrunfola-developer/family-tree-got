// static/js/familyTree.js
// Renderer for the family tree.
// IMPORTANT: node.x/node.y are CENTER coordinates everywhere (Option A).

import { TREE_CFG } from "./treeConfig.js";

const SVG_NS = "http://www.w3.org/2000/svg";

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

function computeStemLen(a, b) {
  const maxStem = TREE_CFG.links.STEM_LEN ?? 10;
  const minStem = TREE_CFG.links.STEM_MIN ?? 6;
  const factor = TREE_CFG.links.STEM_FACTOR ?? 0;

  const gap = b.y - a.y;
  if (!(gap > 0)) return minStem;

  const adaptive = factor > 0 ? gap * factor : maxStem;
  return clamp(adaptive, minStem, maxStem);
}

function drawElbowPath(path, a, b) {
  const stem = computeStemLen(a, b);
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

function applyViewBox(svg, width, height) {
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("width", "100%");
  svg.setAttribute("height", "100%");
  svg.setAttribute("preserveAspectRatio", "xMidYMid meet");
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
  path.setAttribute("stroke-width", "2");
  path.setAttribute("stroke-linecap", "round");
  path.setAttribute("stroke-linejoin", "round");
}

function drawCoupleJoin(linksG, parents, unionNode) {
  if (!unionNode || parents.length < 2) return;

  // Sort parents left->right by center X
  const ps = parents.slice().sort((a, b) => a.x - b.x);

  const left = ps[0];
  const right = ps[ps.length - 1];

  const aL = anchor(left, "bottom");
  const aR = anchor(right, "bottom");
  const unionPt = anchor(unionNode, "mid");

  const trunkDesired = TREE_CFG.links.COUPLE_STEM ?? 14;

  // NEW: cap how tall the parent vertical drops can be
  // Default: same as couple trunk height (what you asked for)
  const parentMax = TREE_CFG.links.PARENT_STEM_MAX ?? trunkDesired;

  const maxBottom = Math.max(aL.y, aR.y);
  const minJoinY = maxBottom + 2;

  // Ideal joinY to get trunk height ~= trunkDesired:
  const targetJoinY = unionPt.y - trunkDesired;

  // But we clamp so parent->join verticals are never taller than parentMax
  const maxJoinY = minJoinY + parentMax;

  // Final joinY:
  const joinY = clamp(targetJoinY, minJoinY, maxJoinY);

  // Parent verticals (now capped)
  const p1 = el("path");
  drawPathCommon(p1);
  p1.setAttribute("d", `M ${aL.x} ${aL.y} L ${aL.x} ${joinY}`);
  linksG.appendChild(p1);

  const p2 = el("path");
  drawPathCommon(p2);
  p2.setAttribute("d", `M ${aR.x} ${aR.y} L ${aR.x} ${joinY}`);
  linksG.appendChild(p2);

  // Horizontal join between parents
  const p3 = el("path");
  drawPathCommon(p3);
  p3.setAttribute("d", `M ${aL.x} ${joinY} L ${aR.x} ${joinY}`);
  linksG.appendChild(p3);

  // Vertical trunk down to union (takes whatever remaining distance exists)
  const midX = (aL.x + aR.x) / 2;

  const p4 = el("path");
  drawPathCommon(p4);
  p4.setAttribute("d", `M ${midX} ${joinY} L ${midX} ${unionPt.y}`);
  linksG.appendChild(p4);
}

export function renderFamilyTree(svg, { nodes, links, width, height }) {
  clear(svg);
  applyViewBox(svg, width, height);

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

    // union -> child elbow
    if (s.kind === "union" && t.kind === "person") {
      const path = el("path");
      drawPathCommon(path);
      drawElbowPath(path, anchor(s, "mid"), anchor(t, "top"));
      linksG.appendChild(path);
      continue;
    }
  }

  // ---- Nodes layer ----
  const nodesG = el("g");
  nodesG.setAttribute("class", "tree-nodes");
  viewport.appendChild(nodesG);

  const { CARD_W, CARD_H, CARD_R, PHOTO_SIZE, PHOTO_R } = TREE_CFG.sizing;

  for (const n of nodes) {
    if (n.kind === "union") {
      const c = el("circle");
      c.setAttribute("cx", n.x);
      c.setAttribute("cy", n.y);
      c.setAttribute("r", "2.5");
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
    const clipCircle = el("circle");
    clipCircle.setAttribute("cx", String(CARD_W / 2));
    clipCircle.setAttribute("cy", String(PHOTO_SIZE / 2 + 14));
    clipCircle.setAttribute("r", String(PHOTO_R));
    clip.appendChild(clipCircle);
    defs.appendChild(clip);

    if (n.photoUrl) {
      const img = el("image");
      img.setAttribute("href", n.photoUrl);
      img.setAttribute("x", String(CARD_W / 2 - PHOTO_SIZE / 2));
      img.setAttribute("y", String(14));
      img.setAttribute("width", String(PHOTO_SIZE));
      img.setAttribute("height", String(PHOTO_SIZE));
      img.setAttribute("preserveAspectRatio", "xMidYMid slice");
      img.setAttribute("clip-path", `url(#${clipId})`);
      g.appendChild(img);
    } else {
      const ph = el("circle");
      ph.setAttribute("cx", String(CARD_W / 2));
      ph.setAttribute("cy", String(PHOTO_SIZE / 2 + 14));
      ph.setAttribute("r", String(PHOTO_R));
      ph.setAttribute("fill", "var(--tree-photo-ph)");
      g.appendChild(ph);
    }

    const ring = el("circle");
    ring.setAttribute("cx", String(CARD_W / 2));
    ring.setAttribute("cy", String(PHOTO_SIZE / 2 + 14));
    ring.setAttribute("r", String(PHOTO_R));
    ring.setAttribute("fill", "none");
    ring.setAttribute("stroke", "var(--tree-photo-ring)");
    ring.setAttribute("stroke-width", "2");
    g.appendChild(ring);

    const name = el("text");
    name.setAttribute("x", String(CARD_W / 2));
    name.setAttribute("y", String(TREE_CFG.text.NAME_Y));
    name.setAttribute("text-anchor", "middle");
    name.setAttribute("dominant-baseline", "middle");
    name.setAttribute(
      "style",
      [
        "fill: var(--tree-text-strong)",
        "font-size: 12.5px",
        "font-weight: 700",
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
        "font-size: 11px",
        "font-weight: 500",
        "font-family: system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif",
        "pointer-events: none",
      ].join("; ")
    );
    meta.textContent = pickMeta(n._raw);
    g.appendChild(meta);
  }

  return { viewport };
}
