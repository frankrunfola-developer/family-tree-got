/* static/js/home-previews.js */
(() => {
  "use strict";

  const $ = (sel, root = document) => root.querySelector(sel);

  function safeText(s) {
    return String(s || "").trim();
  }

  function initials(name) {
    const parts = safeText(name).split(/\s+/).filter(Boolean);
    if (!parts.length) return "?";
    const a = parts[0][0] || "";
    const b = parts.length > 1 ? parts[parts.length - 1][0] : "";
    return (a + b).toUpperCase();
  }

  function photoUrl(photo) {
    const p = safeText(photo);
    if (!p) return null;
    // Data may store full static path ("/static/uploads/stark/x.png") OR just filename.
    if (p.startsWith("/")) return p;
    if (p.startsWith("static/")) return "/" + p;
    return `/static/uploads/stark/${p}`;
  }

  // ✅ NEW: turn birthplace/location objects into nice human text
  function placeText(placeLike) {
    if (!placeLike) return "";
    if (typeof placeLike === "string") return safeText(placeLike);

    // Common shapes:
    // { city, state, country }
    // { name }
    // { label }
    // { place: {...} }
    if (typeof placeLike === "object") {
      const p = placeLike.place && typeof placeLike.place === "object" ? placeLike.place : placeLike;

      const name =
        (typeof p.name === "string" && p.name) ||
        (typeof p.label === "string" && p.label) ||
        "";

      if (name) return safeText(name);

      const parts = [];
      if (typeof p.city === "string" && p.city) parts.push(p.city);
      if (typeof p.state === "string" && p.state) parts.push(p.state);
      if (typeof p.region === "string" && p.region) parts.push(p.region);
      if (typeof p.country === "string" && p.country) parts.push(p.country);

      return parts.map(safeText).filter(Boolean).join(", ");
    }

    return safeText(placeLike);
  }

  function avatar(person, size = 36) {
    const el = document.createElement("div");
    el.className = "avatar";
    el.style.width = `${size}px`;
    el.style.height = `${size}px`;

    const imgSrc = photoUrl(person?.photo);
    if (imgSrc) {
      const img = document.createElement("img");
      img.alt = safeText(person?.name);
      img.src = imgSrc;
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", () => {
        img.remove();
        const fallback = document.createElement("div");
        fallback.className = "avatar-fallback";
        fallback.textContent = initials(person?.name);
        el.appendChild(fallback);
      });
      el.appendChild(img);
    } else {
      const fallback = document.createElement("div");
      fallback.className = "avatar-fallback";
      fallback.textContent = initials(person?.name);
      el.appendChild(fallback);
    }

    return el;
  }

  function chip(person) {
    const el = document.createElement("div");
    el.className = "chip";

    const av = avatar(person, 34);
    el.appendChild(av);

    const name = document.createElement("div");
    name.className = "chip-name";
    name.textContent = safeText(person?.name);
    el.appendChild(name);

    return el;
  }

  async function loadStark() {
    const res = await fetch("/api/sample/stark/tree", { headers: { "Accept": "application/json" } });
    if (!res.ok) throw new Error(`Failed to load Stark sample (${res.status})`);
    return res.json();
  }

  function findByName(people, needle) {
    const n = needle.toLowerCase();
    return people.find(p => safeText(p.name).toLowerCase() === n) || null;
  }

  function renderTreePreview(rootEl, data) {
    const people = data?.people || [];

    // Hand-pick for a consistent, even preview (matches the mock). ✅
    const eddard = findByName(people, "Eddard Stark");
    const catelyn = findByName(people, "Catelyn Stark") || findByName(people, "Catelyn Tully");

    const jon = findByName(people, "Jon Snow");
    const arya = findByName(people, "Arya Stark");
    const bran = findByName(people, "Bran Stark");
    const sansa = findByName(people, "Sansa Stark");
    const robb = findByName(people, "Robb Stark");

    rootEl.classList.add("tree-preview");
    rootEl.innerHTML = "";

    const rowTop = document.createElement("div");
    rowTop.className = "row row-top";
    if (eddard) rowTop.appendChild(chip(eddard));
    if (catelyn) rowTop.appendChild(chip(catelyn));

    const rowMid = document.createElement("div");
    rowMid.className = "row row-mid";
    [jon, arya, bran].filter(Boolean).forEach(p => rowMid.appendChild(chip(p)));

    const rowBot = document.createElement("div");
    rowBot.className = "row row-bot";
    [sansa, robb].filter(Boolean).forEach(p => rowBot.appendChild(chip(p)));

    const connectors = document.createElement("div");
    connectors.className = "tree-connectors";

    rootEl.appendChild(rowTop);
    rootEl.appendChild(connectors);
    rootEl.appendChild(rowMid);
    rootEl.appendChild(rowBot);
  }

  function renderTimelinePreview(rootEl, data) {
    const people = data?.people || [];
    const picks = [
      findByName(people, "Jon Snow"),
      findByName(people, "Eddard Stark"),
      findByName(people, "Catelyn Stark") || findByName(people, "Catelyn Tully"),
      findByName(people, "Arya Stark"),
      findByName(people, "Sansa Stark"),
    ].filter(Boolean).slice(0, 4);

    rootEl.classList.add("timeline-preview");
    rootEl.innerHTML = "";

    picks.forEach((p, idx) => {
      const item = document.createElement("div");
      item.className = "t-item";

      item.appendChild(avatar(p, 38));

      const text = document.createElement("div");
      text.className = "t-text";

      const name = document.createElement("div");
      name.className = "t-name";
      name.textContent = safeText(p.name);

      const meta = document.createElement("div");
      meta.className = "t-meta";

      // ✅ FIX: handle object birthplace/location without "[object Object]"
      const place =
        placeText(p.birthPlace) ||
        placeText(p.location) ||
        placeText(p.birth) ||
        "Winterfell, Westeros";

      meta.textContent = place;

      text.appendChild(name);
      text.appendChild(meta);
      item.appendChild(text);

      if (idx !== picks.length - 1) {
        const hr = document.createElement("div");
        hr.className = "t-divider";
        rootEl.appendChild(item);
        rootEl.appendChild(hr);
      } else {
        rootEl.appendChild(item);
      }
    });
  }

  function renderMapPreview(rootEl, data) {
    const people = data?.people || [];

    const jon = findByName(people, "Jon Snow");
    const arya = findByName(people, "Arya Stark");
    const eddard = findByName(people, "Eddard Stark");

    rootEl.classList.add("map-preview");
    rootEl.innerHTML = "";

    const panel = document.createElement("div");
    panel.className = "map-panel";

    const markerA = document.createElement("div");
    markerA.className = "map-marker a";
    markerA.innerHTML = `<span class="pin"></span><span class="label">Toronto<br><small>2010</small></span>`;

    const markerB = document.createElement("div");
    markerB.className = "map-marker b";
    markerB.innerHTML = `<span class="pin"></span><span class="label">Mumbai<br><small>1984</small></span>`;

    const cluster = document.createElement("div");
    cluster.className = "map-cluster";
    [jon, arya, eddard].filter(Boolean).slice(0, 3).forEach((p) => cluster.appendChild(avatar(p, 44)));

    panel.appendChild(markerA);
    panel.appendChild(markerB);
    panel.appendChild(cluster);

    rootEl.appendChild(panel);
  }

  function injectPreviewStyles() {
    // Small scoped CSS for JS-created elements. Keeps your main CSS clean.
    const css = `
      .avatar{ border-radius: 999px; overflow:hidden; border: 2px solid rgba(90,60,40,.32); box-shadow: 0 6px 12px rgba(0,0,0,.10); background: rgba(255,255,255,.35); }
      .avatar img{ width:100%; height:100%; object-fit: cover; display:block; }
      .avatar-fallback{ width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial; font-weight: 700; color: rgba(43,30,20,.75); }

      .chip{ display:flex; align-items:center; gap:8px; padding:6px 10px; border-radius: 999px; background: rgba(255,255,255,.38); border: 1px solid rgba(90,60,40,.18); box-shadow: inset 0 1px 0 rgba(255,255,255,.45); }
      .chip-name{ font-family: var(--serif); font-size: 13px; color: rgba(43,30,20,.88); white-space: nowrap; }

      .tree-preview .row{ display:flex; justify-content:center; gap: 10px; flex-wrap: wrap; }
      .tree-preview .row-top{ margin-bottom: 10px; }
      .tree-preview .row-mid{ margin-top: 10px; }
      .tree-preview .row-bot{ margin-top: 10px; }
      .tree-preview .tree-connectors{ height: 16px; margin: 0 auto; width: 85%; border-top: 2px solid rgba(90,60,40,.18); position: relative; }
      .tree-preview .tree-connectors::before{ content:""; position:absolute; left: 25%; top:-2px; height: 16px; border-left: 2px solid rgba(90,60,40,.18); }
      .tree-preview .tree-connectors::after{ content:""; position:absolute; right: 25%; top:-2px; height: 16px; border-left: 2px solid rgba(90,60,40,.18); }

      .timeline-preview{ display:flex; flex-direction: column; gap: 10px; padding: 2px 6px; }
      .timeline-preview .t-item{ display:flex; align-items:center; gap: 10px; }
      .timeline-preview .t-name{ font-family: var(--serif); font-size: 14px; color: rgba(43,30,20,.88); }
      .timeline-preview .t-meta{ font-size: 12px; color: rgba(43,30,20,.62); }
      .timeline-preview .t-divider{ height:1px; background: rgba(90,60,40,.14); margin-left: 54px; }

      .map-preview .map-panel{ position: relative; height: 200px; border-radius: 12px; border: 1px solid rgba(90,60,40,.18);
        background:
          linear-gradient(180deg, rgba(255,255,255,.35), rgba(255,255,255,.12)),
          url('/static/img/world-muted.png');
        background-size: cover;
        background-position: center;
        box-shadow: inset 0 10px 20px rgba(0,0,0,.08);
        overflow:hidden;
        opacity: .95;
      }
      .map-preview .map-marker{ position:absolute; display:flex; gap:8px; align-items:flex-start; }
      .map-preview .map-marker .pin{ width: 10px; height: 10px; border-radius: 50%; background: rgba(170,125,70,.95); box-shadow: 0 0 0 2px rgba(255,255,255,.45); margin-top: 4px; }
      .map-preview .map-marker .label{ font-family: var(--serif); font-size: 12px; background: rgba(255,255,255,.55); padding: 6px 8px; border-radius: 10px; border: 1px solid rgba(90,60,40,.18); }
      .map-preview .map-marker.a{ top: 20px; right: 12px; }
      .map-preview .map-marker.b{ top: 96px; left: 12px; }
      .map-preview .map-cluster{ position:absolute; right: 12px; bottom: 10px; display:flex; gap: 6px; }

      @media (max-width: 380px){
        .map-preview .map-panel{ height: 170px; }
        .chip-name{ font-size: 12px; }
      }
    `;

    const style = document.createElement("style");
    style.textContent = css;
    document.head.appendChild(style);
  }

  async function init() {
    injectPreviewStyles();

    const treeRoot = document.querySelector('[data-preview="tree"]');
    const timelineRoot = document.querySelector('[data-preview="timeline"]');
    const mapRoot = document.querySelector('[data-preview="map"]');
    if (!treeRoot || !timelineRoot || !mapRoot) return;

    try {
      const data = await loadStark();
      renderTreePreview(treeRoot, data);
      renderTimelinePreview(timelineRoot, data);
      renderMapPreview(mapRoot, data);
    } catch (err) {
      console.error(err);
    }
  }

  document.addEventListener("DOMContentLoaded", init);
})();