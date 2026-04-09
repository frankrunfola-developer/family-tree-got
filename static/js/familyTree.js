const SVG_NS = "http://www.w3.org/2000/svg";
const XLINK_NS = "http://www.w3.org/1999/xlink";
const STATE = { svg: null, viewBox: null, uid: 0 };

function svgEl(tag) {
  return document.createElementNS(SVG_NS, tag);
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

function line(parent, x1, y1, x2, y2, cls) {
  const el = svgEl("line");
  el.setAttribute("x1", String(x1));
  el.setAttribute("y1", String(y1));
  el.setAttribute("x2", String(x2));
  el.setAttribute("y2", String(y2));
  el.setAttribute("class", cls);
  parent.appendChild(el);
  return el;
}

function group(parent, cls = "") {
  const g = svgEl("g");
  if (cls) g.setAttribute("class", cls);
  parent.appendChild(g);
  return g;
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function cardImageHref(person) {
  const raw = person?.raw || {};
  return raw.photo || raw.image || raw.avatar || "/static/img/placeholder-avatar.png";
}

function wrapName(text, width) {
  const raw = String(text || "").trim() || "Unknown";
  const words = raw.split(/\s+/).filter(Boolean);
  if (!words.length) return [raw];

  const maxChars = width >= 124 ? 20 : width >= 112 ? 18 : width >= 100 ? 16 : 14;
  const maxLines = 3;

  if (raw.length <= maxChars) return [raw];
  if (words.length === 2 && raw.length <= maxChars + 2) return [raw];

  if (words.length >= 3) {
    const firstTwo = `${words[0]} ${words[1]}`;
    const remaining = words.slice(2).join(" ");
    if (firstTwo.length <= maxChars + 2 && remaining.length <= maxChars) {
      return [firstTwo, remaining];
    }
  }

  const lines = [];
  let current = "";

  for (const word of words) {
    const test = current ? `${current} ${word}` : word;
    if (test.length <= maxChars) {
      current = test;
      continue;
    }
    if (current) lines.push(current);
    current = word;

    if (lines.length === maxLines - 1) break;
  }

  if (current && lines.length < maxLines) lines.push(current);
  if (!lines.length) lines.push(raw.slice(0, maxChars));

  if (lines.length > maxLines) lines.length = maxLines;

  if (words.join(" ").length > lines.join(" ").length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, last.length - 1)).trim()}…`;
  }

  return lines;
}


function drawPersonCard(parent, person, x, y, metrics) {
  const { width, height, radius, photoWidth, photoHeight, bottomPanelHeight } = metrics.card;
  const shellInset = Math.max(3, Math.round(width * 0.028));
  const outerPadX = Math.max(7, Math.round(width * 0.058));
  const outerPadTop = Math.max(7, Math.round(height * 0.04));
  const plateHeight = Math.max(32, Math.round(bottomPanelHeight || 34));
  const imageW = Math.max(1, Math.min(width - (outerPadX * 2), Math.round(photoWidth || (width - (outerPadX * 2)))));
  const imageH = Math.max(1, Math.min(height - plateHeight - outerPadTop - 4, Math.round((photoHeight || (height - plateHeight - outerPadTop - 4)) * 1.14)));
  const imageX = x + ((width - imageW) / 2);
  const imageY = y + outerPadTop;

  const plateTop = imageY + imageH + 8;
  const plateBottom = y + height - 8;
  const textCenterX = x + (width / 2);
  const nameLines = wrapName(person.name, width - 6);
  const metaFont = clamp(Math.round(width * 0.085), 8, 10);
  const nameFont = clamp(Math.round(width * 0.104), 11, 14);
  const lineGap = Math.max(12, Math.round(nameFont * 0.98));
  const yearsText = person.yearsText || "";
  const hasYears = Boolean(yearsText);
  const nameBlockHeight = nameLines.length * lineGap;
  const desiredNameStartY = plateTop + 17;
  const desiredYearsY = desiredNameStartY + nameBlockHeight + (hasYears ? metaFont + 8 : 0);
  const maxYearsY = plateBottom;
  const yearsY = hasYears ? Math.min(maxYearsY, desiredYearsY) : plateBottom;
  const nameStartY = desiredNameStartY;

  const g = group(parent, "tree-node-wrap");

  const card = svgEl("rect");
  card.setAttribute("x", String(x));
  card.setAttribute("y", String(y));
  card.setAttribute("width", String(width));
  card.setAttribute("height", String(height));
  card.setAttribute("rx", String(radius));
  card.setAttribute("ry", String(radius));
  card.setAttribute("class", "tree-node-card");
  g.appendChild(card);

  const clipId = `treePhotoClip-${STATE.uid += 1}`;
  const defs = svgEl("defs");
  const clip = svgEl("clipPath");
  clip.setAttribute("id", clipId);

  const clipRect = svgEl("rect");
  clipRect.setAttribute("x", String(imageX));
  clipRect.setAttribute("y", String(imageY));
  clipRect.setAttribute("width", String(imageW));
  clipRect.setAttribute("height", String(imageH));
  clipRect.setAttribute("rx", String(Math.max(10, radius - 4)));
  clipRect.setAttribute("ry", String(Math.max(10, radius - 4)));
  clip.appendChild(clipRect);
  defs.appendChild(clip);
  g.appendChild(defs);

  const photoFrame = svgEl("rect");
  photoFrame.setAttribute("x", String(imageX));
  photoFrame.setAttribute("y", String(imageY));
  photoFrame.setAttribute("width", String(imageW));
  photoFrame.setAttribute("height", String(imageH));
  photoFrame.setAttribute("rx", String(Math.max(10, radius - 4)));
  photoFrame.setAttribute("ry", String(Math.max(10, radius - 4)));
  photoFrame.setAttribute("class", "tree-node-photo-frame");
  g.appendChild(photoFrame);

  const img = svgEl("image");
  img.setAttribute("x", String(imageX));
  img.setAttribute("y", String(imageY));
  img.setAttribute("width", String(imageW));
  img.setAttribute("height", String(imageH));
  img.setAttribute("clip-path", `url(#${clipId})`);
  img.setAttribute("preserveAspectRatio", "xMidYMid slice");
  img.setAttributeNS(XLINK_NS, "href", cardImageHref(person));
  img.setAttribute("href", cardImageHref(person));
  img.setAttribute("class", "tree-node-photo");
  g.appendChild(img);


  const divider = svgEl("line");
  divider.setAttribute("x1", String(x + 12));
  divider.setAttribute("y1", String(plateTop));
  divider.setAttribute("x2", String(x + width - 12));
  divider.setAttribute("y2", String(plateTop));
  divider.setAttribute("class", "tree-node-divider");
  g.appendChild(divider);

  const nameText = svgEl("text");
  nameText.setAttribute("x", String(textCenterX));
  nameText.setAttribute("y", String(nameStartY));
  nameText.setAttribute("class", "tree-node-name");
  nameText.setAttribute("style", `font-size:${nameFont}px`);
  nameLines.forEach((lineText, idx) => {
    const tspan = svgEl("tspan");
    tspan.setAttribute("x", String(textCenterX));
    tspan.setAttribute("dy", idx === 0 ? "0" : String(lineGap));
    tspan.textContent = lineText;
    nameText.appendChild(tspan);
  });
  g.appendChild(nameText);

  if (hasYears) {
    const yearsNode = svgEl("text");
    yearsNode.setAttribute("x", String(textCenterX));
    yearsNode.setAttribute("y", String(yearsY));
    yearsNode.setAttribute("class", "tree-node-meta tree-node-years");
    yearsNode.setAttribute("style", `font-size:${metaFont}px`);
    yearsNode.textContent = yearsText.replace(/^\((.*)\)$/,'$1');
    g.appendChild(yearsNode);
  }
}

export function renderFamilyTree(svg, scene) {
  STATE.svg = svg;
  STATE.viewBox = scene.viewBox;
  clear(svg);
  svg.setAttribute("viewBox", `${scene.viewBox.x} ${scene.viewBox.y} ${scene.viewBox.w} ${scene.viewBox.h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMin meet");
  svg.setAttribute("width", String(scene.viewBox.w));
  svg.setAttribute("height", String(scene.viewBox.h));
  svg.style.width = `${scene.viewBox.w}px`;
  svg.style.height = `${scene.viewBox.h}px`;
  svg.style.maxWidth = "none";
  svg.style.minWidth = "0";
  svg.style.flex = "none";

  const connectors = group(svg);
  const cards = group(svg);

  for (const seg of scene.segments) {
    line(connectors, seg.x1, seg.y1, seg.x2, seg.y2, seg.cls);
  }
  for (const card of scene.cards) {
    drawPersonCard(cards, card.person, card.x, card.y, scene.metrics);
  }
}

export function fitTreeToScreen() {
  if (!STATE.svg || !STATE.viewBox) return;
  STATE.svg.setAttribute("viewBox", `${STATE.viewBox.x} ${STATE.viewBox.y} ${STATE.viewBox.w} ${STATE.viewBox.h}`);
}
