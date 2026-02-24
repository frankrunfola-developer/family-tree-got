/* landing-previews.js
   Mini previews for landing cards (Tree / Timeline / Map)
   Uses same sample_id (from URL ?sample=) and /api/sample/<sid>/tree
*/

(function () {
  "use strict";

  function getSampleId() {
    const url = new URL(window.location.href);
    return (url.searchParams.get("sample") || "stark").toLowerCase();
  }

  async function fetchTree(sampleId) {
    const res = await fetch(`/api/sample/${encodeURIComponent(sampleId)}/tree`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Failed to load sample ${sampleId}`);
    return await res.json();
  }

  function byIdMap(people) {
    const m = new Map();
    (people || []).forEach(p => m.set(String(p.id), p));
    return m;
  }

  // ---------- TREE PREVIEW (roots + 1 gen) ----------
  function renderTreePreview(container, tree) {
    if (!container) return;

    const people = tree.people || [];
    const rels = tree.relationships || [];
    const peopleById = byIdMap(people);

    // Find roots: anyone who is NOT a child in parent/child links
    const childIds = new Set();
    rels.forEach(r => {
      const c = r.childId ?? r.child ?? r.target ?? r.targetId;
      if (c != null) childIds.add(String(c));
    });

    let roots = people.filter(p => !childIds.has(String(p.id)));
    if (!roots.length) roots = people.slice(0, 2);
    roots = roots.slice(0, 2);

    // For the first root, show up to 3 children
    function childrenOf(pid) {
      const out = [];
      rels.forEach(r => {
        const parent = r.parentId ?? r.parent ?? r.source ?? r.sourceId;
        const child  = r.childId ?? r.child ?? r.target ?? r.targetId;
        if (String(parent) === String(pid) && child != null) {
          const cp = peopleById.get(String(child));
          if (cp) out.push(cp);
        }
      });
      return out.slice(0, 3);
    }

    const root = roots[0];
    const rootKids = root ? childrenOf(root.id) : [];

    container.innerHTML = `
      <div class="miniTree">
        <div class="miniTreeRow">
          ${root ? miniPersonPill(root) : ""}
          ${roots[1] ? miniPersonPill(roots[1]) : ""}
        </div>
        <div class="miniTreeLines"></div>
        <div class="miniTreeRow miniTreeRow--kids">
          ${rootKids.map(miniPersonPill).join("")}
        </div>
      </div>
    `;
  }

  function miniPersonPill(p) {
    const photo = p.photo || "";
    const name = p.name || "Unknown";
    const img = photo
      ? `<img class="miniAvatar" src="${photo}" alt="${escapeHtml(name)}">`
      : `<div class="miniAvatar miniAvatar--ph" aria-hidden="true"></div>`;

    return `
      <div class="miniPill" title="${escapeHtml(name)}">
        ${img}
        <div class="miniName">${escapeHtml(shortName(name))}</div>
      </div>
    `;
  }

  function shortName(name) {
    if (name.length <= 16) return name;
    return name.slice(0, 14) + "…";
  }

  // ---------- TIMELINE PREVIEW (top 4 people) ----------
  function renderTimelinePreview(container, tree) {
    if (!container) return;
    const people = (tree.people || []).slice();

    // Prefer those with photo and location first
    people.sort((a, b) => {
      const ap = a.photo ? 1 : 0;
      const bp = b.photo ? 1 : 0;
      const al = a.location && (a.location.city || a.location.country) ? 1 : 0;
      const bl = b.location && (b.location.city || b.location.country) ? 1 : 0;
      return (bp + bl) - (ap + al);
    });

    const rows = people.slice(0, 4).map(p => {
      const name = p.name || "Unknown";
      const loc = fmtLocation(p.location);
      const photo = p.photo || "";
      const img = photo
        ? `<img class="miniAvatar" src="${photo}" alt="${escapeHtml(name)}">`
        : `<div class="miniAvatar miniAvatar--ph" aria-hidden="true"></div>`;

      return `
        <div class="miniRow">
          ${img}
          <div class="miniRowText">
            <div class="miniRowName">${escapeHtml(name)}</div>
            <div class="miniRowSub">${escapeHtml(loc || " ")}</div>
          </div>
        </div>
      `;
    }).join("");

    container.innerHTML = `<div class="miniTimeline">${rows}</div>`;
  }

  function fmtLocation(loc) {
    if (!loc) return "";
    const parts = [];
    if (loc.city) parts.push(loc.city);
    if (loc.region) parts.push(loc.region);
    if (loc.country) parts.push(loc.country);
    return parts.join(", ");
  }

  // ---------- MAP PREVIEW (pins) ----------
  function renderMapPreview(container, tree) {
    if (!container) return;
    const people = (tree.people || []).filter(p => p.location).slice(0, 6);

    const pins = people.map((p, idx) => {
      const name = p.name || "Unknown";
      const photo = p.photo || "";

      const xPct = p.location?.xPct;
      const yPct = p.location?.yPct;

      let left, top;
      if (typeof xPct === "number" && typeof yPct === "number") {
        left = `${xPct}%`;
        top  = `${yPct}%`;
      } else {
        // fallback layout inside preview box
        const cols = 3;
        const r = Math.floor(idx / cols);
        const c = idx % cols;
        left = `${18 + c * 28}%`;
        top  = `${22 + r * 26}%`;
      }

      const img = photo
        ? `<img class="miniPinAvatar" src="${photo}" alt="${escapeHtml(name)}">`
        : `<div class="miniPinAvatar miniPinAvatar--ph" aria-hidden="true"></div>`;

      return `
        <div class="miniPin" style="left:${left}; top:${top};" title="${escapeHtml(name)}">
          ${img}
        </div>
      `;
    }).join("");

    container.innerHTML = `
      <div class="miniMap">
        <div class="miniMapBg"></div>
        ${pins}
      </div>
    `;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  // ---------- BOOT ----------
  async function boot() {
    const treeEl = document.getElementById("treePreview");
    const tlEl   = document.getElementById("timelinePreview");
    const mapEl  = document.getElementById("mapPreview");
    if (!treeEl && !tlEl && !mapEl) return;

    const sid = getSampleId();
    try {
      const tree = await fetchTree(sid);
      renderTreePreview(treeEl, tree);
      renderTimelinePreview(tlEl, tree);
      renderMapPreview(mapEl, tree);
    } catch (e) {
      // fail soft
      // console.debug(e);
    }
  }

  document.addEventListener("DOMContentLoaded", boot);
})();