// static/js/timeline.js
// LineAgeMap Timeline — serpentine “single path” layout
// Builds from /api/tree/<family>
// Schema expected: { people:[{id,name,born,died,location:{city,region,country}, events?:[...] , photo?:... }], relationships:[...] }

(() => {
  const familyId = (window.TIMELINE_FAMILY_ID || "got").toLowerCase();
  const apiUrl = window.TIMELINE_API_URL || null;

  const CFG = window.TIMELINE_CFG || {};
  const CFG_V = CFG.vars || {};
  const CFG_S = CFG.safety || {};

  const elStatus = document.getElementById("tlStatus");
  const elSearch = document.getElementById("tlSearch");
  const chips = Array.from(document.querySelectorAll(".tlChip"));
  const root = document.getElementById("tlSnakeRoot");
  const svg = document.getElementById("tlSnakeSvg");
  const cardsWrap = document.getElementById("tlSnakeCards");

  const densitySel = document.getElementById("tlDensity");
  const colsSel = document.getElementById("tlCols");
  const sortBtn = document.getElementById("tlSort");

  let allEvents = [];
  let activeType = "all";
  let q = "";
  let sortOrder = (sortBtn?.dataset.order === "desc") ? "desc" : "asc";

  function setStatus(msg) { if (elStatus) elStatus.textContent = msg || ""; }

  function cssPx(el, name, fallback = 0) {
    const raw = getComputedStyle(el).getPropertyValue(name).trim();
    const n = parseFloat(raw);
    return Number.isFinite(n) ? n : fallback;
  }

  function readLayoutVars() {
    const el = (root?.querySelector(".tlSnakeCards") || cardsWrap || root);
    return {
      gapX: cssPx(el, "--tl-gap-x", (CFG_V.GAP_X ?? 24)),
      gapY: cssPx(el, "--tl-gap-y", (CFG_V.GAP_Y ?? 26)),
      padX: cssPx(el, "--tl-pad-x", (CFG_V.PAD_X ?? 34)),
      padY: cssPx(el, "--tl-pad-y", (CFG_V.PAD_Y ?? 34)),
      cardW: cssPx(el, "--tl-card-w", (CFG_V.CARD_W ?? 240)),
      cardH: cssPx(el, "--tl-card-h", (CFG_V.CARD_H ?? 92)),
      cols: parseInt(getComputedStyle(el).getPropertyValue("--tl-cols").trim(), 10) || (CFG_V.COLS ?? 3),
      elbowX: cssPx(el, "--tl-elbow-x", (CFG_V.ELBOW_X ?? 24)),
      elbowR: cssPx(el, "--tl-elbow-r", (CFG_V.ELBOW_R ?? 0)),          // NEW
      strokeW: cssPx(el, "--tl-stroke-w", (CFG_V.STROKE_W ?? 9)),       // NEW
      bleed: cssPx(el, "--tl-bleed", (CFG_V.BLEED ?? 34)),
    };
  }

  function safeDate(d) {
    if (!d) return null;
    const s = String(d).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T00:00:00");
    if (/^\d{4}-\d{2}$/.test(s)) return new Date(s + "-01T00:00:00");
    if (/^\d{4}$/.test(s)) return new Date(s + "-01-01T00:00:00");
    const parsed = new Date(s);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function fmtDate(d) {
    if (!d) return "";
    const dt = safeDate(d);
    if (!dt) return String(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth() + 1).padStart(2, "0");
    const day = String(dt.getDate()).padStart(2, "0");
    const orig = String(d).trim();
    if (/^\d{4}$/.test(orig)) return String(y);
    if (/^\d{4}-\d{2}$/.test(orig)) return `${y}-${m}`;
    return `${y}-${m}-${day}`;
  }

  function computeAge(born, died) {
    const b = safeDate(born);
    if (!b) return null;
    const end = died ? safeDate(died) : new Date();
    if (!end) return null;
    let age = end.getFullYear() - b.getFullYear();
    const m = end.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && end.getDate() < b.getDate())) age--;
    return age;
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function normalize(e) {
    return {
      id: e.id || (crypto?.randomUUID ? crypto.randomUUID() : String(Math.random())),
      type: e.type || "other",
      date: e.date || "",
      title: e.title || "",
      meta: e.meta || "",
      person: e.person || "",
      photo: e.photo || "",
    };
  }

  function pickPhoto(p) {
    const raw = p?.photo || p?.photo_url || p?.image || p?.avatar || "";
    return raw || "/static/img/placeholder-avatar.png";
  }

  function prettyWhere(loc) {
    if (!loc) return "";
    return [loc.city, loc.region, loc.country].filter(Boolean).join(", ");
  }

  function buildEvents(tree) {
    const people = Array.isArray(tree?.people) ? tree.people : [];
    const ev = [];

    const byId = new Map();
    for (const p of people) {
      if (p?.id) byId.set(String(p.id).toLowerCase(), p);
    }

    if (Array.isArray(tree?.events)) {
      for (const e of tree.events) {
        const type = e.type || "other";
        const date = e.date || "";
        const loc = e.location || {};
        const where = prettyWhere(loc);

        const ids = Array.isArray(e.people) ? e.people : [];
        const persons = ids
          .map(pid => byId.get(String(pid).toLowerCase()))
          .filter(Boolean);

        const names = persons.map(p => p.name).filter(Boolean);
        const personLabel = names.join(" & ") || (e.person || "");
        const photo = (persons[0] ? pickPhoto(persons[0]) : (e.photo || ""));

        let title = e.title || "";
        if (!title) {
          if (type === "marriage" && names.length >= 2) title = `Marriage of ${names[0]} & ${names[1]}`;
          else if (type === "move" && names.length >= 1) title = `${names[0]} moves`;
          else if (type === "birth" && names.length >= 1) title = names[0];
          else if (type === "death" && names.length >= 1) title = names[0];
          else title = personLabel || "Event";
        }

        const meta =
          e.meta ||
          e.description ||
          (type === "marriage"
            ? (where ? `Married in ${where}` : "Marriage")
            : type === "move"
              ? (where ? `Moved to ${where}` : "Move")
              : type === "birth"
                ? (where ? `Born in ${where}` : "Born")
                : type === "death"
                  ? (where ? `Died in ${where}` : "Died")
                  : (where || ""));

        ev.push(normalize({
          id: e.id,
          type,
          date,
          title,
          meta,
          person: personLabel,
          photo: e.photo || photo,
        }));
      }
    }

    for (const p of people) {
      const name = p?.name || "";
      const born = p?.born || "";
      const died = p?.died || "";
      const photo = pickPhoto(p);
      const where = prettyWhere(p?.location);

      if (born) {
        ev.push(normalize({
          type: "birth",
          date: born,
          title: name,
          meta: where ? `Born in ${where}` : "Born",
          person: name,
          photo,
        }));
      }

      if (died) {
        const age = computeAge(born, died);
        ev.push(normalize({
          type: "death",
          date: died,
          title: name,
          meta: (age != null) ? `Died • Age ${age}` : "Died",
          person: name,
          photo,
        }));
      }

      if (Array.isArray(p?.events)) {
        for (const ce of p.events) {
          const loc = ce?.location || null;
          const where2 = ce?.where || prettyWhere(loc);

          ev.push(normalize({
            type: ce?.type || "other",
            date: ce?.date || "",
            title: (ce?.title && ce.title !== "") ? ce.title : name,
            meta: ce?.meta || where2 || "",
            person: name,
            photo: ce?.photo || photo,
          }));
        }
      }
    }

    ev.sort((a, b) => (safeDate(a.date)?.getTime() ?? Infinity) - (safeDate(b.date)?.getTime() ?? Infinity));

    const seen = new Set();
    const out = [];
    for (const e of ev) {
      const key = `${e.type}|${fmtDate(e.date)}|${e.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }
    return out;
  }

  function matches(e) {
    if (activeType !== "all" && e.type !== activeType) return false;
    if (!q) return true;
    const hay = `${e.title} ${e.person} ${e.meta} ${e.type} ${e.date}`.toLowerCase();
    return hay.includes(q);
  }

  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const px = (v) => `${Math.round(v)}px`;

  function computeAutoCols(containerWidth, cardW, minGapX, paddingX) {
    const usable = containerWidth - paddingX * 2;
    const cols = Math.floor((usable + minGapX) / (cardW + minGapX));
    return clamp(cols, 1, 10);
  }

  function curveBetween(x1, y1, x2, y2) {
    const dx = Math.abs(x2 - x1);

    const pull = Math.min(
      clamp(dx * 0.35, 10, 120),
      Math.max(6, dx * 0.5)
    );

    return `C ${x1 + (x2 > x1 ? pull : -pull)} ${y1},
            ${x2 - (x2 > x1 ? pull : -pull)} ${y2},
            ${x2} ${y2}`;
  }

  function uTurn(x1, y1, x2, y2, dir, cardW, edgeOut, r, dropPad, minX, maxX) {
    const dropY = y2 - r - dropPad;

    // Cap how far the elbow can be from the node center.
    const stubMax = Math.max(18, Math.floor((maxX - minX - cardW) / 2) - 10);
    const want = (cardW / 2 + edgeOut);
    const used = Math.min(want, stubMax);

    const rawStartX = x1 + dir * used;
    const rawEndX = x2 + (-dir) * used;

    const startX = clamp(rawStartX, minX, maxX);
    const endX = clamp(rawEndX, minX, maxX);

    const sgn = (endX >= startX) ? 1 : -1;

    // FIX: radius must scale with available horizontal run or it balloons
    const run = Math.abs(endX - startX);
    const rr = Math.min(r, Math.max(6, Math.floor(run * 0.55)));
    const k = 0.55228475 * rr;

    return [
      `L ${startX} ${y1}`,
      `L ${startX} ${dropY}`,
      `C ${startX} ${dropY + k},
        ${startX + sgn * k} ${y2},
        ${startX + sgn * rr} ${y2}`,
      `L ${endX} ${y2}`,
      `L ${x2} ${y2}`
    ].join(" ");
  }

  function renderCards(model) {
    if (!cardsWrap) return;
    cardsWrap.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const e of model) {
      const card = document.createElement("article");
      card.className = "tlSCard";
      card.dataset.type = e.type;

      const photo = document.createElement("div");
      photo.className = "tlSPhoto";
      photo.style.backgroundImage = `url("${e.photo}")`;

      const body = document.createElement("div");
      body.className = "tlSBody";

      const top = document.createElement("div");
      top.className = "tlSTop";
      top.innerHTML = `
        <div class="tlSDate">${escapeHtml(fmtDate(e.date))}</div>
        <div class="tlSType tlSType--${escapeHtml(e.type)}">${escapeHtml(e.type.toUpperCase())}</div>
      `;

      const name = document.createElement("div");
      name.className = "tlSName";
      name.textContent = e.title || e.person || "Event";

      const meta = document.createElement("div");
      meta.className = "tlSMeta";
      meta.textContent = e.meta || "";

      body.append(top, name, meta);
      card.append(photo, body);
      frag.appendChild(card);
    }

    cardsWrap.appendChild(frag);
  }

  function outerSize(el) {
    const r = el.getBoundingClientRect();
    return { w: r.width, h: r.height };
  }

  let drawRaf = 0;
  function scheduleDraw() {
    cancelAnimationFrame(drawRaf);
    drawRaf = requestAnimationFrame(() => layoutAndDraw());
  }

  function layoutAndDraw() {
    if (!root || !svg || !cardsWrap) return;

    const density = densitySel?.value || root.getAttribute("data-density") || "airy";
    root.setAttribute("data-density", density);

    const V0 = readLayoutVars();
    const containerW = root.clientWidth;

    const cards = Array.from(cardsWrap.querySelectorAll(".tlSCard"));
    if (!cards.length) {
      svg.innerHTML = "";
      root.style.height = "0px";
      return;
    }

    const sample = cards[0];
    const prevTf = sample.style.transform;
    sample.style.transform = "translate(0px, 0px)";
    const sz = outerSize(sample);
    sample.style.transform = prevTf;

    const cardW = Math.round(sz.w);
    const cardH = Math.round(sz.h);

    const maxFit = computeAutoCols(containerW, cardW, V0.gapX, V0.padX);
    const cols = clamp(Math.min(V0.cols, maxFit), 1, 10);

    const padX = Math.max(Math.round(V0.padX), (CFG_S.MIN_PAD_X ?? 12));
    const frame = Math.max(padX, Math.round(containerW * 0.06));

    const minX = frame;
    const maxX = containerW - frame;

    const maxEdgeOutAllowed = Math.max(
      10,
      Math.floor((maxX - minX - cardW) / 2) - 6
    );

    // FIX: scale elbow geometry with gap + lane space (not cardW)
    const strokeW = Math.round(clamp(V0.strokeW || 9, 5, 12));
    const clearance = Math.round(clamp(strokeW * 0.9, 5, 10));

    const lane = (maxX - minX - cardW) / 2;
    const edgeSpace = Math.max(18, Math.floor(lane));

    const edgeOutFromGap = Math.round(clamp(V0.gapX * 0.85, 10, 48));
    const baseEdgeOut0 = Math.round(clamp(V0.elbowX || edgeOutFromGap, 10, 48)) + clearance;

    const autoR = Math.round(clamp(Math.min(V0.gapX, V0.gapY) * 0.42, 8, 18));
    const elbowR0 = Math.round((V0.elbowR && V0.elbowR > 0) ? V0.elbowR : autoR);
    const elbowR = Math.min(elbowR0, Math.round(clamp(edgeSpace * 0.45, 8, 18)));

    const rightBonus = Math.round(clamp(V0.gapX * 0.35, 6, 18));
    const dropPad = Math.round(clamp(V0.gapY * 0.55, 10, 22));

    const baseEdgeOut = Math.min(baseEdgeOut0, maxEdgeOutAllowed);

    const centers = [];
    for (let i = 0; i < cards.length; i++) {
      const row = Math.floor(i / cols);
      const pos = i % cols;
      const dir = (row % 2 === 0) ? 1 : -1;
      const col = (dir === 1) ? pos : (cols - 1 - pos);

      const contentW = cols * cardW + (cols - 1) * V0.gapX;

      const startX0 = Math.round((containerW - contentW) / 2);
      let startX = Math.max(padX, startX0);
      if (startX + contentW > containerW - padX) {
        startX = Math.max(padX, containerW - padX - contentW);
      }

      const x = startX + col * (cardW + V0.gapX) + cardW / 2;
      const y = V0.padY + row * (cardH + V0.gapY) + cardH / 2;

      cards[i].style.transform = `translate(${px(x - cardW / 2)}, ${px(y - cardH / 2)})`;
      centers.push({ x, y, row, dir });
    }

    const rows = Math.max(1, Math.ceil(cards.length / cols));
    const totalH = V0.padY * 2 + rows * cardH + (rows - 1) * V0.gapY;
    root.style.height = px(totalH);

    svg.setAttribute("width", containerW);
    svg.setAttribute("height", totalH);
    svg.setAttribute("viewBox", `0 0 ${containerW} ${totalH}`);
    svg.innerHTML = "";

    if (centers.length < 2) return;

    let d = `M ${centers[0].x} ${centers[0].y} `;
    for (let i = 0; i < centers.length - 1; i++) {
      const a = centers[i];
      const b = centers[i + 1];

      if (a.row === b.row) {
        d += curveBetween(a.x, a.y, b.x, b.y) + " ";
      } else {
        const edgeOutTurnRaw = (a.dir > 0) ? (baseEdgeOut + rightBonus) : baseEdgeOut;
        const edgeOutTurn = Math.min(edgeOutTurnRaw, maxEdgeOutAllowed);
        d += uTurn(a.x, a.y, b.x, b.y, a.dir, cardW, edgeOutTurn, elbowR, dropPad, minX, maxX) + " ";
      }
    }

    const last = centers[centers.length - 1];
    const endExtra = Math.round(clamp(cardW * 0.16, 16, 36));

    const tailXRaw = last.x + last.dir * (cardW / 2 + baseEdgeOut + endExtra);
    const tailX = clamp(tailXRaw, minX, maxX);

    d += curveBetween(last.x, last.y, tailX, last.y) + " ";

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", d.trim());
    path.setAttribute("class", "tlSPath");

    const dots = document.createElementNS("http://www.w3.org/2000/svg", "g");
    dots.setAttribute("class", "tlSDots");
    centers.forEach((p) => {
      const c = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      c.setAttribute("cx", p.x);
      c.setAttribute("cy", p.y);
      c.setAttribute("r", Math.round(clamp(cardW * 0.03, 3, 5)));
      dots.appendChild(c);
    });

    svg.appendChild(path);
    svg.appendChild(dots);
  }

  function render() {
    let filtered = allEvents.filter(matches);
    if (sortOrder === "desc") filtered = filtered.slice().reverse();

    if (!filtered.length) {
      setStatus("No matching events.");
      if (cardsWrap) cardsWrap.innerHTML = "";
      if (svg) svg.innerHTML = "";
      if (root) root.style.height = "0px";
      return;
    }

    setStatus(`${filtered.length} event${filtered.length === 1 ? "" : "s"}`);

    renderCards(filtered);
    scheduleDraw();
  }

  function setActiveChip(type) {
    activeType = type;
    chips.forEach(c => c.classList.toggle("is-active", c.dataset.type === type));
    render();
  }

  chips.forEach(c => c.addEventListener("click", () => setActiveChip(c.dataset.type)));
  if (elSearch) elSearch.addEventListener("input", (e) => { q = e.target.value.trim().toLowerCase(); render(); });

  if (densitySel) densitySel.addEventListener("change", () => render());
  if (colsSel) colsSel.addEventListener("change", () => render());

  if (sortBtn) {
    const sync = () => {
      sortBtn.dataset.order = sortOrder;
      sortBtn.textContent = (sortOrder === "desc") ? "Desc" : "Asc";
      sortBtn.setAttribute("aria-pressed", String(sortOrder === "desc"));
    };
    sync();
    sortBtn.addEventListener("click", () => {
      sortOrder = (sortOrder === "asc") ? "desc" : "asc";
      sync();
      render();
    });
  }

  window.addEventListener("resize", () => scheduleDraw());

  async function load() {
    try {
      setStatus("Loading timeline…");
      const url = apiUrl ? apiUrl : `/api/tree/${familyId}`;
      const r = await fetch(url, { headers: { "Accept": "application/json" } });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const tree = await r.json();
      allEvents = buildEvents(tree);
      render();
    } catch (err) {
      console.error(err);
      setStatus("Couldn’t load timeline. (Check console.)");
      if (cardsWrap) cardsWrap.innerHTML = "";
      if (svg) svg.innerHTML = "";
    }
  }

  load();
})();