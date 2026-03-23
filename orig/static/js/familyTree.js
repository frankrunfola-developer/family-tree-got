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
  const maxChars = width >= 160 ? 15 : 12;
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
    if (lines.length === 1) break;
  }
  if (current && lines.length < 2) lines.push(current);
  if (!lines.length) lines.push(raw.slice(0, maxChars));
  if (lines.length > 2) lines.length = 2;
  if (words.join(" ").length > lines.join(" ").length) {
    const last = lines[lines.length - 1];
    lines[lines.length - 1] = `${last.slice(0, Math.max(0, last.length - 1)).trim()}…`;
  }
  return lines;
}

function drawPersonCard(parent, person, x, y, metrics) {
  const { width, height, radius, imageRatio, photoWidth, photoHeight, bottomPanelHeight } = metrics.card;
  const imageW = Math.max(1, Math.min(width, Math.round(photoWidth || width)));
  const imageH = Math.max(1, Math.min(height - 18, Math.round(photoHeight || (height * imageRatio))));
  const textH = Math.max(30, Math.max(bottomPanelHeight || (height - imageH), height - imageH));
  const imageX = x + ((width - imageW) / 2);
  const imageY = y;
  const imageInnerH = imageH;
  const textTop = y + imageH;
  const textCenterX = x + (width / 2);
  const nameLines = wrapName(person.name, width);


  const metaFont = clamp(Math.round(width * 0.066), 9, 12);

  function fitNameToSingleLine(name, cardWidth) {
    const rawName = String(name || "").trim();

    let fontSize = clamp(Math.round(cardWidth * 0.096), 10, 16);

    const maxTextWidth = cardWidth - 16;

    const estWidth = (text, size) => text.length * size * 0.54;

    while (fontSize > 10 && estWidth(rawName, fontSize) > maxTextWidth) {
      fontSize -= 1;
    }

    if (estWidth(rawName, fontSize) <= maxTextWidth) {
      return { text: rawName, fontSize };
    }

    let trimmed = rawName;
    while (trimmed.length > 3 && estWidth(`${trimmed}…`, fontSize) > maxTextWidth) {
      trimmed = trimmed.slice(0, -1);
    }

    return {
      text: `${trimmed}…`,
      fontSize,
    };
  }

  const fittedName = fitNameToSingleLine(person.name, width);
  const nameFont = fittedName.fontSize;
  const singleLineName = fittedName.text;
  
  const metaGap = Math.max(9, Math.round(metaFont * 1.2));

  const yearsText = person.yearsText || "";
  const hasYears = Boolean(yearsText);

  const bottomPadding = Math.max(10, Math.round(textH * 0.16));
  const reservedBottomH = hasYears ? (metaGap + bottomPadding) : bottomPadding;

  const nameStartY = textTop + Math.max(16, Math.round(textH * 0.34));

  const g = group(parent, "tree-card-shadow");

  const rect = svgEl("rect");
  rect.setAttribute("x", String(x));
  rect.setAttribute("y", String(y));
  rect.setAttribute("width", String(width));
  rect.setAttribute("height", String(height));
  rect.setAttribute("rx", String(radius));
  rect.setAttribute("ry", String(radius));
  rect.setAttribute("class", "tree-card");
  g.appendChild(rect);

  const clipId = `treePhotoClip-${STATE.uid += 1}`;
  const defs = svgEl("defs");
  const clip = svgEl("clipPath");
  clip.setAttribute("id", clipId);

  const clipRect = svgEl("rect");
  clipRect.setAttribute("x", String(imageX));
  clipRect.setAttribute("y", String(imageY));
  clipRect.setAttribute("width", String(imageW));
  clipRect.setAttribute("height", String(imageInnerH));
  clipRect.setAttribute("rx", String(radius));
  clipRect.setAttribute("ry", String(radius));
  clip.appendChild(clipRect);
  defs.appendChild(clip);
  g.appendChild(defs);

  const photoFrame = svgEl("rect");
  photoFrame.setAttribute("x", String(imageX));
  photoFrame.setAttribute("y", String(imageY));
  photoFrame.setAttribute("width", String(imageW));
  photoFrame.setAttribute("height", String(imageInnerH));
  photoFrame.setAttribute("rx", String(radius));
  photoFrame.setAttribute("ry", String(radius));
  photoFrame.setAttribute("class", "tree-photo-frame");
  g.appendChild(photoFrame);

  const img = svgEl("image");
  img.setAttribute("x", String(imageX));
  img.setAttribute("y", String(imageY));
  img.setAttribute("width", String(imageW));
  img.setAttribute("height", String(imageInnerH));
  img.setAttribute("clip-path", `url(#${clipId})`);
  img.setAttribute("preserveAspectRatio", "xMidYMid slice");
  img.setAttributeNS(XLINK_NS, "href", cardImageHref(person));
  img.setAttribute("href", cardImageHref(person));
  g.appendChild(img);

  const divider = svgEl("line");
  divider.setAttribute("x1", String(x + 10));
  divider.setAttribute("y1", String(textTop));
  divider.setAttribute("x2", String(x + width - 10));
  divider.setAttribute("y2", String(textTop));
  divider.setAttribute("class", "tree-card-divider");
  g.appendChild(divider);

  const nameText = svgEl("text");
  nameText.setAttribute("x", String(textCenterX));
  nameText.setAttribute("y", String(nameStartY));
  nameText.setAttribute("class", "tree-name");
  nameText.setAttribute("style", `font-size:${nameFont}px`);
  nameText.textContent = singleLineName;
  g.appendChild(nameText);

  if (hasYears) {
    const yearsNode = svgEl("text");
    yearsNode.setAttribute("x", String(textCenterX));
    yearsNode.setAttribute("y", String(y + height - bottomPadding));
    yearsNode.setAttribute("class", "tree-card-meta");
    yearsNode.setAttribute("style", `font-size:${metaFont}px`);
    yearsNode.textContent = yearsText;
    g.appendChild(yearsNode);
  }
}
export function renderFamilyTree(svg, scene) {
  STATE.svg = svg;
  STATE.viewBox = scene.viewBox;
  clear(svg);
  svg.setAttribute("viewBox", `${scene.viewBox.x} ${scene.viewBox.y} ${scene.viewBox.w} ${scene.viewBox.h}`);
  svg.setAttribute("preserveAspectRatio", "xMidYMin meet");

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
