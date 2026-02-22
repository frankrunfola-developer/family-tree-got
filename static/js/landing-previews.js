// static/js/landing-previews.js
// Renders the 3 mini previews on the marketing landing page.

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}

function photoOf(p) {
  if (!p) return "";
  return p.photoUrl || p.photo || p.imageUrl || "";
}

function renderTree(demo) {
  const coupleEl = document.getElementById("miniCouple");
  const kidsEl = document.getElementById("miniKids");
  if (!coupleEl || !kidsEl) return;

  const couple = (demo?.tree?.couple || []).filter(Boolean);
  const kids = (demo?.tree?.kids || []).filter(Boolean).slice(0, 6);

  const p1 = couple[0];
  const p2 = couple[1];
  const coupleLabel = [p1?.name, p2?.name].filter(Boolean).join("  +  ").replace("  +  ", " & ");

  coupleEl.innerHTML = `
    <div class="miniAvatarPair">
      ${[p1, p2]
        .filter(Boolean)
        .map((p) => {
          const src = photoOf(p);
          return `
            <div class="miniAvatarCircle" title="${esc(p.name)}">
              ${src ? `<img src="${esc(src)}" alt="" loading="lazy"/>` : ""}
            </div>`;
        })
        .join("")}
    </div>
    <div class="miniCoupleLabel">${esc(coupleLabel || "Family")}</div>
  `;

  kidsEl.innerHTML = kids
    .map((k) => {
      const src = photoOf(k);
      const first = String(k?.name || "").split(" ")[0] || k?.name || "";
      return `
        <div class="miniKid" title="${esc(k.name)}">
          <div class="miniKidAvatar">${src ? `<img src="${esc(src)}" alt="" loading="lazy"/>` : ""}</div>
          <div class="miniKidName">${esc(first)}</div>
        </div>`;
    })
    .join("");
}

function renderTimeline(demo) {
  const root = document.getElementById("miniTimeline");
  if (!root) return;
  const items = (demo?.timeline || []).filter(Boolean).slice(0, 6);

  root.innerHTML = items
    .map((it, idx) => {
      const src = it.photo || "";
      const born = it.born ? String(it.born) : "";
      const loc = it.location ? String(it.location) : "";
      const sub = [born, loc].filter(Boolean).join(" • ");
      return `
        <div class="miniTlRow">
          <div class="miniTlDot" aria-hidden="true"></div>
          <div class="miniTlAvatar">${src ? `<img src="${esc(src)}" alt="" loading="lazy"/>` : ""}</div>
          <div class="miniTlText">
            <div class="miniTlName">${esc(it.name || "")}</div>
            <div class="miniTlSub">${esc(sub)}</div>
          </div>
        </div>`;
    })
    .join("");
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function renderMap(demo) {
  const pins = document.getElementById("miniPins");
  if (!pins) return;

  const items = (demo?.map || []).filter(Boolean).slice(0, 6);

  // Equirectangular projection to percentages.
  // Works well for "world-muted.png".
  const toXY = (lat, lng) => {
    const x = ((Number(lng) + 180) / 360) * 100;
    const y = ((90 - Number(lat)) / 180) * 100;
    return { x: clamp(x, 3, 97), y: clamp(y, 6, 94) };
  };

  pins.innerHTML = items
    .map((p, i) => {
      const { x, y } = toXY(p.lat, p.lng);
      const src = p.photo || "";
      const label = p.label || "";
      const size = i === 0 ? 48 : i === 1 ? 42 : 34;
      return `
        <div class="miniPin" style="left:${x}%; top:${y}%; --pinSize:${size}px" title="${esc(p.name)}">
          <div class="miniPinFace">${src ? `<img src="${esc(src)}" alt="" loading="lazy"/>` : ""}</div>
          <div class="miniPinLabel">${esc(label)}</div>
        </div>`;
    })
    .join("");
}

document.addEventListener("DOMContentLoaded", () => {
  const demo = window.LANDING_DEMO;
  if (!demo) return;
  renderTree(demo);
  renderTimeline(demo);
  renderMap(demo);
});
