/* ----------------------------------------------------------------------------------
 File:    map.js
 Purpose: Accordion-driven Family Map UI (pins + tooltip + clustering + zoom/pan)
 Author:  Frank Runfola
 Date:    01/03/2025
 Notes:
   - Fetches window.MAP_API_URL which should return an object containing people:[...]
   - Builds accordion grouped by Country -> Region -> City (best-effort parsing)
   - Uses <img> stage architecture: image + pins share the same coordinate plane
   - Zoom/pan uses transform scale + translate on the stage (image + pins together)
   - Supports clustering when multiple people share coords

   UPDATED:
   - parseCoords supports location.xPct / location.yPct (your JSON shape)
   - Avatar config is OPTIONAL (no hard import that can break the page)
   - Soft edge-nudge so pins don’t look jammed against borders
   - Map-first UI (no grid / nested accordions)

   LATEST (Leader lines for clusters + keep avatars on map):
   - Singles: avatar sits exactly on location (no leader line)
   - Clusters: anchor dot marks true location; avatars float nearby (but CLAMPED inside map);
              leader lines drawn from each avatar to anchor.
---------------------------------------------------------------------------------- */

(() => {
  "use strict";

  // ------------------------------
  // Config
  // ------------------------------
  const API_URL = window.MAP_API_URL || "/api/sample/stark/tree";
  const FAMILY_ID = (window.MAP_FAMILY_ID || "stark").toLowerCase();
  const MAP_IMAGE_URL = window.MAP_IMAGE_URL;

  // OPTIONAL avatar config
  // You can set window.AVATAR_CONFIG = { objectPosition: "50% 28%", scale: 0.78 } before loading map.js
  const AVATAR = window.AVATAR_CONFIG || { objectPosition: "50% 28%", scale: 0.78 };

  if (!MAP_IMAGE_URL) {
    console.error("MAP_IMAGE_URL missing. Set window.MAP_IMAGE_URL before loading map.js");
  }

  const ROOT_ACC = document.getElementById("mapAccordion");

  // ------------------------------
  // Utilities
  // ------------------------------
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined) continue;
      if (k === "class") node.className = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "style") node.setAttribute("style", String(v));
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, String(v));
    }
    for (const child of children) node.appendChild(child);
    return node;
  }

  function toTitle(s) {
    if (!s) return "";
    return String(s).trim().toLowerCase().replace(/\b\w/g, (m) => m.toUpperCase());
  }

  function safeName(p) {
    return p?.name || p?.full_name || p?.display_name || p?.label || "Unknown";
  }

  function safePhoto(p) {
    return (
      p?.photo_url ||
      p?.photo ||
      p?.image_url ||
      p?.img ||
      p?.avatar_url ||
      "/static/img/placeholder-avatar.png"
    );
  }

  // One avatar builder (hard overrides to survive global img rules)
  function avatarImgEl(person, extraClass = "") {
    const scale = Number.isFinite(Number(AVATAR.scale)) ? Number(AVATAR.scale) : 0.82;

    return el("img", {
      class: extraClass,
      src: safePhoto(person),
      alt: "",
      style: `
        width: 100%;
        height: 100%;
        display: block;

        object-fit: cover;
        object-position: ${AVATAR.objectPosition};

        /* de-zoom crop inside circle */
        transform: scale(${scale});
        transform-origin: center;

        /* hard override for aggressive global img rules */
        max-width: 100% !important;
        max-height: 100% !important;
      `,
    });
  }

  function getContainBox(containerW, containerH, imgNaturalW, imgNaturalH) {
    if (!imgNaturalW || !imgNaturalH) {
      return { x: 0, y: 0, w: containerW, h: containerH };
    }
    const imgAspect = imgNaturalW / imgNaturalH;
    const boxAspect = containerW / containerH;

    let w, h, x, y;
    if (imgAspect > boxAspect) {
      w = containerW;
      h = containerW / imgAspect;
      x = 0;
      y = (containerH - h) / 2;
    } else {
      h = containerH;
      w = containerH * imgAspect;
      x = (containerW - w) / 2;
      y = 0;
    }
    return { x, y, w, h };
  }

  // ------------------------------
  // Location parsing (best effort)
  // ------------------------------
  function parseLocation(p) {
    const locObj =
      (Array.isArray(p?.locations) && p.locations[0]) ||
      p?.location ||
      p?.place ||
      p?.birth_place ||
      p?.birthPlace ||
      p?.residence ||
      p?.home ||
      "";

    let city = "";
    let region = "";
    let country = "";

    if (typeof locObj === "string") {
      const parts = locObj.split(",").map((x) => x.trim()).filter(Boolean);
      if (parts.length === 1) {
        city = parts[0];
      } else if (parts.length === 2) {
        city = parts[0];
        region = parts[1];
      } else if (parts.length >= 3) {
        city = parts[0];
        region = parts[1];
        country = parts.slice(2).join(", ");
      }
    } else if (locObj && typeof locObj === "object") {
      city = locObj.city || locObj.town || locObj.locality || "";
      region = locObj.region || locObj.state || locObj.province || locObj.area || "";
      country = locObj.country || locObj.nation || "";
    }

    // Westeros-style: "Winterfell, The North" (no country)
    if (!country && region) {
      country = region;
      region = "";
    }

    city = toTitle(city) || "Unknown City";
    region = toTitle(region);
    country = toTitle(country) || "Unknown";

    return { city, region, country, raw: locObj };
  }

  // ------------------------------
  // Coordinate parsing (best effort)
  // ------------------------------
  function parseCoords(p) {
    const candidates = [p?.map, p?.coords, p?.pin, p?.location, p?.place, p?.geo, p];

    let x = null;
    let y = null;

    for (const c of candidates) {
      if (!c || typeof c !== "object") continue;

      const cx =
        c.x ??
        c.xPct ??
        c.left ??
        c.lngPct ??
        c.lonPct ??
        c.px ??
        c.posX ??
        c.mapX ??
        c.pinX ??
        null;

      const cy =
        c.y ??
        c.yPct ??
        c.top ??
        c.latPct ??
        c.py ??
        c.posY ??
        c.mapY ??
        c.pinY ??
        null;

      if (Number.isFinite(Number(cx)) && Number.isFinite(Number(cy))) {
        x = Number(cx);
        y = Number(cy);
        break;
      }
    }

    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

    if (x >= 0 && x <= 1 && y >= 0 && y <= 1) {
      x *= 100;
      y *= 100;
    }

    x = clamp(x, 0, 100);
    y = clamp(y, 0, 100);

    return { x, y };
  }

  // ------------------------------
  // Grouping
  // ------------------------------
  function groupPeople(people) {
    const tree = new Map();

    for (const p of people) {
      const { country, region, city } = parseLocation(p);

      if (!tree.has(country)) tree.set(country, new Map());
      const regionMap = tree.get(country);

      const regionKey = region || "—";
      if (!regionMap.has(regionKey)) regionMap.set(regionKey, new Map());
      const cityMap = regionMap.get(regionKey);

      if (!cityMap.has(city)) cityMap.set(city, []);
      cityMap.get(city).push(p);
    }

    return tree;
  }

  function sortKeys(arr) {
    return arr.sort((a, b) => {
      if (a === "Unknown") return 1;
      if (b === "Unknown") return -1;
      if (a === "—") return 1;
      if (b === "—") return -1;
      return a.localeCompare(b);
    });
  }

  // ------------------------------
  // UI: Loading / Error
  // ------------------------------
  function setLoading() {
    if (!ROOT_ACC) return;
    ROOT_ACC.innerHTML = "";
    ROOT_ACC.appendChild(
      el("div", { class: "mapLoading" }, [
        el("div", { html: "<strong>Loading map…</strong>" }),
        el("div", {
          style: "margin-top:6px; opacity:0.85;",
          html: "Fetching family locations and pins.",
        }),
      ])
    );
  }

  function setError(msg) {
    if (!ROOT_ACC) return;
    ROOT_ACC.innerHTML = "";
    ROOT_ACC.appendChild(
      el("div", { class: "mapLoading" }, [
        el("div", { html: "<strong>Couldn’t load map.</strong>" }),
        el("div", { style: "margin-top:6px; opacity:0.85;", html: escapeHtml(msg) }),
      ])
    );
  }

  // ------------------------------
  // Tooltip
  // ------------------------------
  function buildPinTip(accMap) {
    const tip = el("div", { class: "pinTip" }, [
      el("div", { class: "pinTip__inner" }, [
        el("div", { class: "pinTip__name" }),
        el("div", { class: "pinTip__meta" }),
      ]),
    ]);
    accMap.appendChild(tip);

    const inner = tip.querySelector(".pinTip__inner");
    const nameEl = tip.querySelector(".pinTip__name");
    const metaEl = tip.querySelector(".pinTip__meta");

    function openAt(clientX, clientY, name, meta) {
      const rect = accMap.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      nameEl.textContent = name;
      metaEl.textContent = meta;

      tip.style.left = `${x}px`;
      tip.style.top = `${y}px`;
      tip.classList.add("open");

      requestAnimationFrame(() => {
        const tRect = inner.getBoundingClientRect();
        const aRect = accMap.getBoundingClientRect();

        let left = x - tRect.width / 2;
        let top = y - tRect.height - 14;

        left = clamp(left, 8, aRect.width - tRect.width - 8);
        top = clamp(top, 8, aRect.height - tRect.height - 14);

        tip.style.left = `${left}px`;
        tip.style.top = `${top}px`;
      });
    }

    function close() {
      tip.classList.remove("open");
    }

    accMap.addEventListener("click", (e) => {
      if (e.target === accMap) close();
    });

    return { openAt, close };
  }

  // ------------------------------
  // Map Canvas (IMG stage)
  // ------------------------------
  function buildMapCanvas() {
    const map = el("div", {
      class: "accMap",
      role: "group",
      "aria-label": "Map canvas",
    });

    const stage = el("div", { class: "mapStage" });

    const img = el("img", {
      class: "mapImage",
      src: MAP_IMAGE_URL || "",
      alt: "",
      draggable: "false",
    });

    // SVG overlay for leader lines (lives in stage so it zoom/pans with pins)
    const lines = el("svg", {
      class: "pinLines",
      viewBox: "0 0 100 100",
      preserveAspectRatio: "none",
      "aria-hidden": "true",
    });

    const pinLayer = el("div", { class: "pinLayer" });

    stage.appendChild(img);
    stage.appendChild(lines);
    stage.appendChild(pinLayer);
    map.appendChild(stage);

    return map;
  }

  // ------------------------------
  // Zoom/Pan (transform stage)
  // ------------------------------
  function attachZoomPan(accMap) {
    if (accMap.dataset.zoomPan === "1") return;
    accMap.dataset.zoomPan = "1";

    const stage = accMap.querySelector(".mapStage");
    if (!stage) return;

    const ui = el("div", { class: "mapZoomUI" }, [
      el("button", { class: "mapZoomBtn", type: "button", "aria-label": "Zoom in", html: "+" }),
      el("button", { class: "mapZoomBtn", type: "button", "aria-label": "Zoom out", html: "−" }),
      el("button", { class: "mapZoomBtn", type: "button", "aria-label": "Fit map", html: "⤢" }),
    ]);
    accMap.appendChild(ui);

    let scale = 1.0;
    let tx = 0;
    let ty = 0;

    const MIN = 1.0;
    const MAX = 3.2;
    const STEP = 0.18;

    function apply() {
      stage.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
      if (scale > 1.001) accMap.classList.add("isPannable");
      else accMap.classList.remove("isPannable");
    }

    function fit() {
      scale = 1.0;
      tx = 0;
      ty = 0;
      apply();
    }

    function zoomTo(nextScale, anchorClientX, anchorClientY) {
      const rect = accMap.getBoundingClientRect();
      const ax = clamp(anchorClientX - rect.left, 0, rect.width);
      const ay = clamp(anchorClientY - rect.top, 0, rect.height);

      const prev = scale;
      scale = clamp(nextScale, MIN, MAX);
      if (Math.abs(scale - prev) < 0.0001) return;

      const stageX = (ax - tx) / prev;
      const stageY = (ay - ty) / prev;

      tx = ax - stageX * scale;
      ty = ay - stageY * scale;

      apply();
    }

    function centerAnchor() {
      const r = accMap.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }

    const btns = ui.querySelectorAll(".mapZoomBtn");
    const btnIn = btns[0];
    const btnOut = btns[1];
    const btnFit = btns[2];

    btnIn.addEventListener("click", () => {
      const a = centerAnchor();
      zoomTo(scale + STEP, a.x, a.y);
    });

    btnOut.addEventListener("click", () => {
      const a = centerAnchor();
      zoomTo(scale - STEP, a.x, a.y);
    });

    btnFit.addEventListener("click", () => {
      fit();
    });

    accMap.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const dir = e.deltaY < 0 ? 1 : -1;
        zoomTo(scale + dir * STEP, e.clientX, e.clientY);
      },
      { passive: false }
    );

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    accMap.addEventListener("pointerdown", (e) => {
      if (scale <= 1.001) return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      accMap.classList.add("isDragging");
      accMap.setPointerCapture(e.pointerId);
    });

    accMap.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;

      tx += dx;
      ty += dy;
      apply();
    });

    const endDrag = () => {
      dragging = false;
      accMap.classList.remove("isDragging");
    };
    accMap.addEventListener("pointerup", endDrag);
    accMap.addEventListener("pointercancel", endDrag);

    fit();
  }

  // ------------------------------
  // Pins + clusters
  // ------------------------------
  function clusterByCoords(peopleWithCoords) {
    const m = new Map();
    for (const item of peopleWithCoords) {
      const key = `${item.coords.x.toFixed(2)}|${item.coords.y.toFixed(2)}`;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(item);
    }
    return m;
  }

  function spiralOffset(index, pinPx, gapPx) {
    const golden = 2.399963229728653;
    const angle = index * golden;

    const base = pinPx * 0.95 + gapPx;
    const growth = pinPx * 0.55 + gapPx * 0.65;

    const r = base + Math.sqrt(index) * growth;
    return { dx: Math.cos(angle) * r, dy: Math.sin(angle) * r, r };
  }

  function svgClear(svg) {
    if (!svg) return;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }

  function svgSetViewBox(svg, w, h) {
    if (!svg) return;
    svg.setAttribute("viewBox", `0 0 ${Math.max(1, Math.round(w))} ${Math.max(1, Math.round(h))}`);
  }

  function svgLine(svg, x1, y1, x2, y2, extraClass = "") {
    if (!svg) return;
    const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
    ln.setAttribute("x1", String(x1));
    ln.setAttribute("y1", String(y1));
    ln.setAttribute("x2", String(x2));
    ln.setAttribute("y2", String(y2));
    ln.setAttribute("class", `pinLine${extraClass ? " " + extraClass : ""}`);
    svg.appendChild(ln);
  }

  // Pick a good cluster badge location (still inside contain box)
  function chooseLabelPoint(anchorX, anchorY, box, rect, pinPx) {
    const dx = clamp(rect.width * 0.16, 110, 180);
    const dy = clamp(rect.height * 0.14, 90, 160);

    const candidates = [
      { x: anchorX + dx, y: anchorY - dy },
      { x: anchorX - dx, y: anchorY - dy },
      { x: anchorX + dx, y: anchorY + dy },
      { x: anchorX - dx, y: anchorY + dy },
    ];

    const margin = Math.max(14, Math.round(pinPx * 1.35));

    const clampToBox = (pt) => ({
      x: clamp(pt.x, box.x + margin, box.x + box.w - margin),
      y: clamp(pt.y, box.y + margin, box.y + box.h - margin),
    });

    const score = (pt) => {
      const edge = Math.min(
        pt.x - box.x,
        pt.y - box.y,
        box.x + box.w - pt.x,
        box.y + box.h - pt.y
      );
      const dist = Math.hypot(pt.x - anchorX, pt.y - anchorY);
      return edge * 1.6 + dist * 0.4;
    };

    let best = null;
    for (const c of candidates) {
      const clamped = clampToBox(c);
      const s = score(clamped);
      if (!best || s > best.s) best = { ...clamped, s };
    }

    return { x: best.x, y: best.y };
  }

  function renderPins(accMap, people, onSelect) {
    const pinLayer = accMap.querySelector(".pinLayer");
    if (!pinLayer) return;

    const svg = accMap.querySelector(".pinLines");

    pinLayer.innerHTML = "";
    svgClear(svg);

    const img = accMap.querySelector(".mapImage");
    const rect = accMap.getBoundingClientRect();

    if (img && !img.complete) {
      img.addEventListener("load", () => renderPins(accMap, people, onSelect), { once: true });
      return;
    }

    svgSetViewBox(svg, rect.width, rect.height);

    const box = getContainBox(rect.width, rect.height, img?.naturalWidth || 0, img?.naturalHeight || 0);

    const pctToPx = (coords) => {
      const px = box.x + (coords.x / 100) * box.w;
      const py = box.y + (coords.y / 100) * box.h;
      return { px, py };
    };

    const edgeNudge = (px, py) => {
      const margin = clamp(rect.width * 0.035, 18, 34);
      let x = px;
      let y = py;
      if (x - box.x < margin) x = box.x + margin;
      if (box.x + box.w - x < margin) x = box.x + box.w - margin;
      if (y - box.y < margin) y = box.y + margin;
      if (box.y + box.h - y < margin) y = box.y + box.h - margin;
      return { px: x, py: y };
    };

    // Approx matches CSS clamp(34px, 2.9vw, 54px)
    const pinPx = clamp(rect.width * 0.029, 34, 54);
    const gapPx = clamp(pinPx * 0.55, 16, 28);

    // Keep avatar centers inside visible image box
    const avatarClampMargin = Math.round(pinPx * 0.85 + 10); // room for ring + shadow

    const clampAvatarCenterToBox = (cx, cy) => ({
      x: clamp(cx, box.x + avatarClampMargin, box.x + box.w - avatarClampMargin),
      y: clamp(cy, box.y + avatarClampMargin, box.y + box.h - avatarClampMargin),
    });

    const tip = buildPinTip(accMap);

    const withCoords = [];
    for (const p of people) {
      const coords = parseCoords(p);
      if (!coords) continue;
      withCoords.push({ p, coords });
    }
    if (withCoords.length === 0) return;

    const clusters = clusterByCoords(withCoords);

    for (const items of clusters.values()) {
      // -------------------------
      // SINGLE PERSON PIN
      // -------------------------
      if (items.length === 1) {
        const { p, coords } = items[0];
        let { px, py } = pctToPx(coords);
        ({ px, py } = edgeNudge(px, py));

        const pin = el(
          "button",
          {
            class: "pin",
            type: "button",
            style: `left:${px}px; top:${py}px;`,
            "aria-label": `Show ${safeName(p)}`,
          },
          [avatarImgEl(p)]
        );

        pin.addEventListener("mouseenter", (e) => {
          const loc = parseLocation(p);
          tip.openAt(e.clientX, e.clientY, safeName(p), `${loc.city}${loc.country ? `, ${loc.country}` : ""}`);
        });
        pin.addEventListener("mouseleave", () => tip.close());

        pin.addEventListener("focus", () => {
          const r = pin.getBoundingClientRect();
          const loc = parseLocation(p);
          tip.openAt(r.left + r.width / 2, r.top, safeName(p), `${loc.city}${loc.country ? `, ${loc.country}` : ""}`);
        });
        pin.addEventListener("blur", () => tip.close());

        pin.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelect?.(p);
        });

        pinLayer.appendChild(pin);
        continue;
      }

      // -------------------------
      // CLUSTER (avatars stay on-map; lines to anchor)
      // -------------------------
      const anchorCoords = items[0].coords;
      let { px, py } = pctToPx(anchorCoords);
      ({ px, py } = edgeNudge(px, py));

      // Anchor dot at the true city location
      const anchor = el("div", {
        class: "pinAnchor",
        style: `left:${px}px; top:${py}px;`,
        "aria-hidden": "true",
      });
      pinLayer.appendChild(anchor);

      const n = items.length;

      // Badge base point (also clamped inside image)
      const label = chooseLabelPoint(px, py, box, rect, pinPx);
      const labelX = label.x;
      const labelY = label.y;

      // Center cluster badge sits at label point
      const head = items[0].p;
      const cluster = el(
        "button",
        {
          class: "pinCluster",
          type: "button",
          style: `left:${labelX}px; top:${labelY}px;`,
          "aria-label": `Show ${items.length} people at this location`,
        },
        [
          el("div", { class: "pinCluster__ring" }, [avatarImgEl(head)]),
          el("div", { class: "pinCluster__count", html: String(items.length) }),
        ]
      );

      cluster.addEventListener("mouseenter", (e) => {
        tip.openAt(e.clientX, e.clientY, `${items.length} people`, "Click for group");
      });
      cluster.addEventListener("mouseleave", () => tip.close());
      cluster.addEventListener("click", (e) => {
        e.stopPropagation();
        onSelect?.(null, items.map((x) => x.p));
      });

      pinLayer.appendChild(cluster);

      // Main subtle line from badge to anchor
      svgLine(svg, labelX, labelY, px, py, " pinLine--main");

      const useFan = n <= 3;

      for (let i = 0; i < n; i++) {
        const p = items[i].p;

        // Desired offsets
        let dx = 0;
        let dy = 0;

        if (useFan) {
          const spread = n === 2 ? 44 : 64;
          const start = -spread / 2;
          const angleDeg = start + (n === 1 ? 0 : i * (spread / (n - 1)));
          const angle = (angleDeg * Math.PI) / 180;

          const r = pinPx * 1.35 + gapPx;
          dx = Math.cos(angle) * r;
          dy = Math.sin(angle) * r;
        } else {
          ({ dx, dy } = spiralOffset(i + 4, pinPx, gapPx));
        }

        // Proposed avatar center
        const proposedX = labelX + dx;
        const proposedY = labelY + dy;

        // ✅ Clamp avatar center into the visible image area
        const clamped = clampAvatarCenterToBox(proposedX, proposedY);

        // ✅ Recompute actual dx/dy so the CSS transform lands exactly on the clamped point
        const finalDx = clamped.x - labelX;
        const finalDy = clamped.y - labelY;

        const pin = el(
          "button",
          {
            class: "pin",
            type: "button",
            style: `left:${labelX}px; top:${labelY}px; --dx:${Math.round(finalDx)}px; --dy:${Math.round(finalDy)}px;`,
            "aria-label": `Show ${safeName(p)}`,
          },
          [avatarImgEl(p)]
        );

        pin.addEventListener("mouseenter", (e) => {
          const loc = parseLocation(p);
          tip.openAt(e.clientX, e.clientY, safeName(p), `${loc.city}${loc.country ? `, ${loc.country}` : ""}`);
        });
        pin.addEventListener("mouseleave", () => tip.close());

        pin.addEventListener("focus", () => {
          const r = pin.getBoundingClientRect();
          const loc = parseLocation(p);
          tip.openAt(r.left + r.width / 2, r.top, safeName(p), `${loc.city}${loc.country ? `, ${loc.country}` : ""}`);
        });
        pin.addEventListener("blur", () => tip.close());

        pin.addEventListener("click", (e) => {
          e.stopPropagation();
          onSelect?.(p);
        });

        pinLayer.appendChild(pin);

        // ✅ Leader line from ACTUAL avatar center (clamped) to true anchor
        svgLine(svg, clamped.x, clamped.y, px, py, "");
      }
    }
  }

  // ------------------------------
  // Accordion Builders
  // ------------------------------
  function buildAcc(title, subText) {
    const details = el("details", { class: "acc" });
    const summary = el("summary", { class: "accHead" }, [
      el("div", {}, [
        el("div", { class: "accTitle", html: escapeHtml(title) }),
        subText
          ? el("div", { style: "margin-top:2px;font-size:12px;opacity:0.75;", html: escapeHtml(subText) })
          : el("span"),
      ]),
      el("div", { style: "opacity:0.75;font-weight:900;", html: "▾" }),
    ]);
    const body = el("div", { class: "accBody" });
    details.appendChild(summary);
    details.appendChild(body);
    return { details, body };
  }

  // ------------------------------
  // Render
  // ------------------------------
  function renderAccordion(people) {
    if (!ROOT_ACC) return;

    ROOT_ACC.innerHTML = "";

    const grouped = groupPeople(people);
    const countries = sortKeys(Array.from(grouped.keys()));

    if (countries.length === 0) {
      ROOT_ACC.appendChild(
        el("div", { class: "mapLoading" }, [
          el("div", { html: "<strong>No location data found.</strong>" }),
          el("div", {
            style: "margin-top:6px; opacity:0.85;",
            html: "Add location fields to people records to populate the map.",
          }),
        ])
      );
      return;
    }

    for (const country of countries) {
      const regionMap = grouped.get(country);

      const totalPeople = Array.from(regionMap.values())
        .flatMap((cityMap) => Array.from(cityMap.values()).flat())
        .length;

      const { details: cAcc, body: cBody } = buildAcc(
        country,
        `${totalPeople} ${totalPeople === 1 ? "person" : "people"}`
      );
      ROOT_ACC.appendChild(cAcc);

      const countryPeople = [];
      for (const cityMap of regionMap.values()) {
        for (const list of cityMap.values()) countryPeople.push(...list);
      }

      const map = buildMapCanvas();
      attachZoomPan(map);

      const rerender = () => renderPins(map, countryPeople, () => {});
      rerender();
      cBody.appendChild(map);

      // Re-render on resize so contain math + line geometry stay correct
      let raf = 0;
      const onResize = () => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(rerender);
      };
      window.addEventListener("resize", onResize);
    }

    const first = ROOT_ACC.querySelector("details.acc");
    if (first) first.open = true;
  }

  // ------------------------------
  // Fetch
  // ------------------------------
  async function load() {
    if (!ROOT_ACC) return;

    setLoading();

    try {
      const res = await fetch(API_URL, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${API_URL}`);

      const data = await res.json();
      const people = data?.people || data?.nodes || data?.members || data?.family?.people || [];

      if (!Array.isArray(people)) {
        throw new Error("API response did not contain an array of people/nodes.");
      }

      renderAccordion(people);
    } catch (err) {
      console.error(err);
      setError(err?.message || String(err));
    }
  }

  // ------------------------------
  // Init
  // ------------------------------
  document.addEventListener("DOMContentLoaded", load);
})();