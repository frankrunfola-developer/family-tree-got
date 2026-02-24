// LineAgeMap Timeline — serpentine “single path” layout
// Builds from /api/tree/<family>
// Schema expected: { people:[{name,born,died,location:{city,region,country}, events?:[...] , photo?:... }], relationships:[...] }

(() => {
  const familyId = (window.TIMELINE_FAMILY_ID || "got").toLowerCase();
  const apiUrl = window.TIMELINE_API_URL || null;

  const elStatus = document.getElementById("tlStatus");
  const elSearch = document.getElementById("tlSearch");
  const chips = Array.from(document.querySelectorAll(".tlChip"));

  const root = document.getElementById("tlSnakeRoot");
  const svg  = document.getElementById("tlSnakeSvg");
  const cardsWrap = document.getElementById("tlSnakeCards");
  const densitySel = document.getElementById("tlDensity");
  const colsSel = document.getElementById("tlCols");
  const sortBtn = document.getElementById("tlSort");

  let allEvents = [];
  let activeType = "all";
  let q = "";
  let sortOrder = (sortBtn?.dataset.order === "desc") ? "desc" : "asc";

  function setStatus(msg){ if (elStatus) elStatus.textContent = msg || ""; }

  function safeDate(d){
    if (!d) return null;
    const s = String(d).trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(s + "T00:00:00");
    if (/^\d{4}-\d{2}$/.test(s)) return new Date(s + "-01T00:00:00");
    if (/^\d{4}$/.test(s)) return new Date(s + "-01-01T00:00:00");
    const parsed = new Date(s);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  function fmtDate(d){
    if (!d) return "";
    const dt = safeDate(d);
    if (!dt) return String(d);
    const y = dt.getFullYear();
    const m = String(dt.getMonth()+1).padStart(2,"0");
    const day = String(dt.getDate()).padStart(2,"0");
    const orig = String(d).trim();
    if (/^\d{4}$/.test(orig)) return String(y);
    if (/^\d{4}-\d{2}$/.test(orig)) return `${y}-${m}`;
    return `${y}-${m}-${day}`;
  }

  function computeAge(born, died){
    const b = safeDate(born);
    if (!b) return null;
    const end = died ? safeDate(died) : new Date();
    if (!end) return null;
    let age = end.getFullYear() - b.getFullYear();
    const m = end.getMonth() - b.getMonth();
    if (m < 0 || (m === 0 && end.getDate() < b.getDate())) age--;
    return age;
  }

  function escapeHtml(s){
    return String(s || "")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function normalize(e){
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

  function pickPhoto(p){
    // try a few likely keys; fall back to your placeholder
    const raw = p.photo || p.photo_url || p.image || p.avatar || "";
    return raw || "/static/img/placeholder-avatar.png";
  }

  function getPersonById(people, id){
    return people.find(p => String(p.id || "").toLowerCase() === String(id || "").toLowerCase());
  }

  function prettyWhere(loc){
    if (!loc) return "";
    const s = [loc.city, loc.region, loc.country].filter(Boolean).join(", ");
    return s;
  }

  function buildEvents(tree){
    const people = Array.isArray(tree.people) ? tree.people : [];
    const ev = [];

    // Index helpers
    const byId = new Map();
    for (const p of people){
      if (p?.id) byId.set(String(p.id).toLowerCase(), p);
    }

    // --- 1) Root-level explicit events (recommended) ---
    // schema: tree.events = [{id,type,date,title,people:[ids],location:{...},description?,meta?}]
    if (Array.isArray(tree.events)){
      for (const e of tree.events){
        const type = e.type || "other";
        const date = e.date || "";
        const loc  = e.location || {};
        const where = prettyWhere(loc);

        // Resolve people ids -> names + choose a representative photo
        const ids = Array.isArray(e.people) ? e.people : [];
        const persons = ids
          .map(pid => byId.get(String(pid).toLowerCase()))
          .filter(Boolean);

        const names = persons.map(p => p.name).filter(Boolean);
        const personLabel = names.join(" & ") || (e.person || "");
        const photo = (persons[0] ? pickPhoto(persons[0]) : (e.photo || ""));

        // Sensible default title if not provided
        let title = e.title || "";
        if (!title){
          if (type === "marriage" && names.length >= 2) title = `Marriage of ${names[0]} & ${names[1]}`;
          else if (type === "move" && names.length >= 1) title = `${names[0]} moves`;
          else if (type === "birth" && names.length >= 1) title = names[0];
          else if (type === "death" && names.length >= 1) title = names[0];
          else title = personLabel || "Event";
        }

        // Meta line (subtle descriptive line)
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

    // --- 2) Derived per-person birth/death + per-person custom events ---
    for (const p of people) {
      const name = p.name || "";
      const born = p.born || "";
      const died = p.died || "";
      const photo = pickPhoto(p);

      const where = prettyWhere(p.location);

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

      // Optional custom per-person events:
      // p.events = [{type,date,title,meta,where,photo?,location?}]
      if (Array.isArray(p.events)) {
        for (const ce of p.events) {
          const loc = ce.location || null;
          const where2 = ce.where || prettyWhere(loc);

          ev.push(normalize({
            type: ce.type || "other",
            date: ce.date || "",
            title: (ce.title && ce.title !== "") ? ce.title : name,
            meta: ce.meta || where2 || "",
            person: name,
            photo: ce.photo || photo,
          }));
        }
      }
    }

    // Old -> New default
    ev.sort((a,b) => (safeDate(a.date)?.getTime() ?? Infinity) - (safeDate(b.date)?.getTime() ?? Infinity));

    // Optional: de-dupe if you end up with repeats
    // (same type + date + title)
    const seen = new Set();
    const out = [];
    for (const e of ev){
      const key = `${e.type}|${fmtDate(e.date)}|${e.title}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(e);
    }

    return out;
  }


  function matches(e){
    if (activeType !== "all" && e.type !== activeType) return false;
    if (!q) return true;
    const hay = `${e.title} ${e.person} ${e.meta} ${e.type} ${e.date}`.toLowerCase();
    return hay.includes(q);
  }

  // --- serpentine layout helpers ---
  const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
  const px = (v) => `${Math.round(v)}px`;

  function computeAutoCols(containerWidth, cardW, gapX, paddingX){
    const usable = containerWidth - paddingX * 2;
    const cols = Math.floor((usable + gapX) / (cardW + gapX));
    return clamp(cols, 1, 6);
  }

  function curveBetween(x1, y1, x2, y2){
    const dx = Math.abs(x2 - x1);
    const pull = clamp(dx * 0.35, 40, 150);
    return `C ${x1 + (x2>x1? pull : -pull)} ${y1},
             ${x2 - (x2>x1? pull : -pull)} ${y2},
             ${x2} ${y2}`;
  }

function uTurn(x1, y1, x2, y2, dir, cardW, edgeOut, r){
  // x1,y1 and x2,y2 are CENTER points of cards
  // dir is direction of the row we’re leaving: +1 means L->R, -1 means R->L
  // We exit from the side edge of the leaving card, go straight down,
  // then turn and enter the next card from its side edge.

  const startX = x1 + dir * (cardW / 2 + edgeOut);       // exit from side of leaving card
  const endDir = -dir;                                   // next row runs opposite direction
  const endX   = x2 + endDir * (cardW / 2 + edgeOut);    // approach side of next card

  // Vertical “drop” ends a bit above y2 so the elbow is clean
  const dropY = y2 - r;

  // Corner math: we’ll do a single rounded elbow using a cubic
  // from vertical segment into horizontal segment.
  const k = 0.55228475 * r; // circle-to-cubic constant

  // Path:
  // - curve from center to startX on same y (keeps smooth into the side exit)
  // - straight down
  // - rounded corner into horizontal
  // - straight horizontal toward endX
  // - curve from endX into the next node center
  return [
    curveBetween(x1, y1, startX, y1),
    `L ${startX} ${dropY}`,
    // rounded elbow: vertical -> horizontal (towards endX)
    `C ${startX} ${dropY + k},
       ${startX + (endX > startX ? k : -k)} ${y2},
       ${startX + (endX > startX ? r : -r)} ${y2}`,
    `L ${endX} ${y2}`,
    curveBetween(endX, y2, x2, y2)
  ].join(" ");
}

  function renderCards(model){
    if (!cardsWrap) return;
    cardsWrap.innerHTML = "";
    const frag = document.createDocumentFragment();

    for (const e of model){
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

  function layoutAndDraw(){
    if (!root || !svg || !cardsWrap) return;

    const density = densitySel?.value || "airy";
    root.setAttribute("data-density", density);

    const containerW = root.clientWidth;
    const isMobile = containerW < 640;

    // --- sizing ---
    // Goal: tighter nodes + less empty space while keeping the “one-way snake” readable.
    const mobileScale = 0.70; // ~30% smaller on phones

    const baseCardW = (density === "airy") ? 320 : 290;
    const baseCardH = (density === "airy") ? 108 : 100;

    const cardW = isMobile ? Math.round((Math.min(360, containerW - 28)) * mobileScale) : baseCardW;
    const cardH = isMobile ? Math.round(112 * mobileScale) : baseCardH;

    // how far the line exits past the card edge, and elbow roundness for the 90° turn
    const edgeOut = isMobile ? Math.round(26 * mobileScale) : 24;
    const elbowR  = isMobile ? Math.round(18 * mobileScale) : 18;

    const baseGapX = (density === "airy") ? 70 : 60;
    // vertical breathing room between rows (tighter than before)
    const baseGapY = (density === "airy") ? 84 : 72;

    const gapX  = isMobile ? Math.round(34 * mobileScale) : baseGapX;
    const gapY  = isMobile ? Math.round(56 * mobileScale) : baseGapY;

    const basePadX = (density === "airy") ? 70 : 58;
    const basePadY = (density === "airy") ? 54 : 46;

    const padX  = isMobile ? Math.round(18 * mobileScale) : basePadX;
    const padY  = isMobile ? Math.round(18 * mobileScale) : basePadY;

    let cols;
    if (isMobile) {
      cols = 1;
    } else {
      cols = colsSel?.value || "auto";
      cols = (cols === "auto")
        ? computeAutoCols(containerW, cardW, gapX, padX)
        : parseInt(cols, 10);
      cols = clamp(cols || 3, 1, 6);
      if (containerW < 720) cols = clamp(cols, 1, 2);
    }

    cols = clamp(cols || 3, 1, 6);

    if (containerW < 720) cols = clamp(cols, 1, 2);

    cardsWrap.style.setProperty("--tl-card-w", px(cardW));
    cardsWrap.style.setProperty("--tl-card-h", px(cardH));
    cardsWrap.style.setProperty("--tl-gap-x", px(gapX));
    cardsWrap.style.setProperty("--tl-gap-y", px(gapY));
    cardsWrap.style.setProperty("--tl-pad-x", px(padX));
    cardsWrap.style.setProperty("--tl-pad-y", px(padY));
    cardsWrap.style.setProperty("--tl-cols", cols);

    const cards = Array.from(cardsWrap.querySelectorAll(".tlSCard"));

    const centers = [];
    for (let i = 0; i < cards.length; i++){
      const row = Math.floor(i / cols);
      const pos = i % cols;
      const dir = (row % 2 === 0) ? 1 : -1;
      const col = (dir === 1) ? pos : (cols - 1 - pos);

      const contentW = cols * cardW + (cols - 1) * gapX;
      const startX = Math.max(12, Math.round((containerW - contentW) / 2));

      const x = startX + col * (cardW + gapX) + cardW/2;
      const y = padY + row * (cardH + gapY) + cardH/2;

      cards[i].style.transform = `translate(${px(x - cardW/2)}, ${px(y - cardH/2)})`;

      centers.push({ x, y, row, dir });
    }

    const rows = Math.max(1, Math.ceil(cards.length / cols));
    const totalH = padY*2 + rows*cardH + (rows-1)*gapY;
    root.style.height = px(totalH);

    svg.setAttribute("width", containerW);
    svg.setAttribute("height", totalH);
    svg.setAttribute("viewBox", `0 0 ${containerW} ${totalH}`);
    svg.innerHTML = "";

    if (centers.length < 2) return;

    let d = `M ${centers[0].x} ${centers[0].y} `;
    for (let i = 0; i < centers.length - 1; i++){
      const a = centers[i];
      const b = centers[i+1];
      if (a.row === b.row){
        d += curveBetween(a.x, a.y, b.x, b.y) + " ";
      } else {
        d += uTurn(a.x, a.y, b.x, b.y, a.dir, cardW, edgeOut, elbowR) + " ";
      }

    }

    // Extend the tail past the final node a bit (so the line clearly exits the last card)
    const last = centers[centers.length - 1];
    const endExtra = isMobile ? Math.round(38 * mobileScale) : 34;
    const tailX = last.x + last.dir * (cardW / 2 + edgeOut + endExtra);
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
      c.setAttribute("r", isMobile ? 4 : 5);
      dots.appendChild(c);
    });

    svg.appendChild(path);
    svg.appendChild(dots);
  }

  function render(){
    let filtered = allEvents.filter(matches);

    // Apply sort order (default asc = oldest -> newest)
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
    layoutAndDraw();
  }

  function setActiveChip(type){
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

  // Resize: only re-layout (avoid rebuilding cards)
  let raf = 0;
  window.addEventListener("resize", () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => layoutAndDraw());
  });

  async function load(){
    try{
      setStatus("Loading timeline…");
      const url = apiUrl ? apiUrl : `/api/tree/${familyId}`;
      const r = await fetch(url, { headers: { "Accept":"application/json" } });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const tree = await r.json();
      allEvents = buildEvents(tree);
      render();
    } catch (err){
      console.error(err);
      setStatus("Couldn’t load timeline. (Check console.)");
      if (cardsWrap) cardsWrap.innerHTML = "";
      if (svg) svg.innerHTML = "";
    }
  }

  load();
})();
