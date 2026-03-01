/* landing-previews.js
   Visual mini-previews for landing cards:
     - Tree: avatar pills in 2 rows (root + children)
     - Timeline: 4 person rows with avatar + location
     - Map: parchment map background + pins + 2 avatars
   Data:
     GET /api/sample/<sample>/tree
*/

(function () {
  "use strict";

  const treeEl = document.getElementById("treePreview");
  const tlEl = document.getElementById("timelinePreview");
  const mapEl = document.getElementById("mapPreview");
  if (!treeEl && !tlEl && !mapEl) return;

  const url = new URL(window.location.href);
  const sample = (url.searchParams.get("sample") || "stark").toLowerCase();

  function esc(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function avatarHtml(p) {
    const name = p?.name || p?.id || "Unknown";
    const photo = p?.photo || "";
    if (photo) {
      return `<span class="pAvatar"><img src="${esc(photo)}" alt="${esc(name)}"></span>`;
    }
    return `<span class="pAvatar" aria-label="${esc(name)}"></span>`;
  }

  function locationLine(p) {
    const loc = p?.location || {};
    const parts = [loc.city, loc.region, loc.country].filter(Boolean);
    return parts.join(", ");
  }

  function getPeopleById(people) {
    const m = new Map();
    (people || []).forEach(p => m.set(String(p.id), p));
    return m;
  }

  function childrenOf(tree, parentId) {
    const rels = tree.relationships || [];
    return rels.filter(r => String(r.parentId) === String(parentId)).map(r => String(r.childId));
  }

  function pickRootishPerson(tree) {
    const people = tree.people || [];
    if (!people.length) return null;
    const rels = tree.relationships || [];
    const childSet = new Set(rels.map(r => String(r.childId)));
    return people.find(p => !childSet.has(String(p.id))) || people[0];
  }

  function hash01(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967295;
  }

  function renderTree(tree) {
    if (!treeEl) return;

    const people = tree.people || [];
    const byId = getPeopleById(people);
    const root = pickRootishPerson(tree);
    if (!root) return;

    const kids = childrenOf(tree, root.id)
      .map(id => byId.get(id))
      .filter(Boolean)
      .slice(0, 4);

    const node = (p) => `
      <div class="treeNode">
        ${avatarHtml(p)}
        <div>
          <div class="pName">${esc(p.name || p.id)}</div>
          <div class="pMeta">${esc([p.born, p.died].filter(Boolean).join("–"))}</div>
        </div>
      </div>
    `;

    treeEl.innerHTML = `
      <div class="treeMini">
        <div class="treeMiniRow">${node(root)}</div>
        <div class="treeMiniRow">${kids.length ? kids.map(node).join("") : ""}</div>
      </div>
    `;
  }

  function renderTimeline(tree) {
    if (!tlEl) return;

    const people = (tree.people || [])
      .filter(p => p && (p.name || p.id))
      .slice(0, 4);

    const row = (p) => `
      <div class="pItem">
        ${avatarHtml(p)}
        <div>
          <div class="pName">${esc(p.name || p.id)}</div>
          <div class="pMeta">${esc(locationLine(p))}</div>
        </div>
      </div>
    `;

    tlEl.innerHTML = `
      <div class="timelineMini pRow">
        ${people.map(row).join("")}
      </div>
    `;
  }

  function mapBgForSample(sampleId) {
    // If you have different filenames, change these two paths:
    const isWesteros = ["stark", "lannister", "got"].includes(sampleId);
    return isWesteros
      ? "/static/img/westeros.png"
      : "/static/img/world.png";
  }

  function renderMap(tree) {
    if (!mapEl) return;

    const bg = mapBgForSample(sample);

    // create some deterministic pins from locations (or from person id)
    const people = (tree.people || []).slice(0, 8);
    const pins = people.map(p => {
      const loc = p.location || {};
      const key = [loc.city, loc.region, loc.country, p.id].filter(Boolean).join("|") || String(p.id || "");
      const x = 0.12 + hash01("x:" + key) * 0.76; // keep inside frame
      const y = 0.12 + hash01("y:" + key) * 0.68;
      return { x, y };
    });

    const avatars = (tree.people || []).filter(p => p.photo).slice(0, 2);

    mapEl.innerHTML = `
      <div class="mapMini">
        <div class="mapMiniBg" style="background-image:url('${bg}')"></div>
        ${pins.slice(0, 5).map(p => `
          <span class="mapPin" style="left:${(p.x*100).toFixed(1)}%; top:${(p.y*100).toFixed(1)}%"></span>
        `).join("")}
        <div class="mapMiniAvatars">
          ${avatars.map(a => avatarHtml(a)).join("")}
        </div>
      </div>
    `;
  }

  async function run() {
    try {
      const res = await fetch(`/api/sample/${encodeURIComponent(sample)}/tree`, { credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const tree = await res.json();

      renderTree(tree);
      renderTimeline(tree);
      renderMap(tree);
    } catch (e) {
      // Fail quietly with minimal noise
      if (treeEl) treeEl.innerHTML = "";
      if (tlEl) tlEl.innerHTML = "";
      if (mapEl) mapEl.innerHTML = "";
      console.warn("landing-previews failed:", e);
    }
  }

  run();
})();