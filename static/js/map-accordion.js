/*
  Country → State/Province → City accordion (mobile-first).
  - Uses your existing world-muted.png as the single map texture.
  - "Zoom" is done via background-size + background-position.
  - Adjust BBOX entries to taste (fast to tune by eye).
*/
(async () => {
  const FAMILY_NAME = "gupta";
  const MAP_IMG = `url('/static/img/world-muted.png')`;

  // Background "zoom presets" (percentages). Tweak these.
  // size = background-size (bigger => more zoom). pos = background-position.
  const BBOX = {
    // Countries
    "Canada": { size: "220%", pos: "28% 28%" },
    "India": { size: "260%", pos: "63% 46%" },
    "United States": { size: "210%", pos: "23% 46%" },

    // Provinces / States (examples)
    "Ontario": { size: "520%", pos: "33% 34%" },
    "New York": { size: "620%", pos: "28% 40%" },
    "California": { size: "420%", pos: "14% 54%" },
    "West Bengal": { size: "720%", pos: "67% 44%" },
    "Maharashtra": { size: "650%", pos: "60% 52%" },
  };

  const FLAGS = { "Canada":"🇨🇦", "India":"🇮🇳", "United States":"🇺🇸" };

  const $ = (sel, el=document) => el.querySelector(sel);

  function parseYear(val){
    if (val == null) return null;
    const n = parseInt(String(val).trim(), 10);
    return Number.isFinite(n) ? n : null;
  }
  function calcAge(bornStr, diedStr){
    const born = parseYear(bornStr);
    if (!born) return null;
    const died = parseYear(diedStr);
    const end = died || new Date().getFullYear();
    const age = end - born;
    return (age >= 0 && age <= 130) ? age : null;
  }
  function safe(v){ return (v ?? "").toString(); }

  // projection relative to world map image (equirectangular)
  function project(lat, lng, width, height){
    return { x: (lng + 180) / 360 * width, y: (90 - lat) / 180 * height };
  }

  function groupBy(arr, keyFn){
    const m = new Map();
    for (const item of arr){
      const k = keyFn(item) || "—";
      const a = m.get(k) || [];
      a.push(item);
      m.set(k, a);
    }
    return m;
  }

  function buildChevron(){
    const s = document.createElement("span");
    s.className = "accChevron";
    s.innerHTML = `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 9l6 6 6-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>`;
    return s;
  }

  function makeAccItem({title, flag, count, open=false}){
    const item = document.createElement("div");
    item.className = "accItem";
    item.dataset.open = open ? "true" : "false";

    const head = document.createElement("div");
    head.className = "accHead";
    head.innerHTML = `
      <div class="accLeft">
        <span class="accFlag">${flag || ""}</span>
        <div class="accTitle">${title}</div>
        <div class="accMeta">(${count})</div>
      </div>
    `;
    const chev = buildChevron();
    head.appendChild(chev);

    const body = document.createElement("div");
    body.className = "accBody";

    head.addEventListener("click", () => {
      item.dataset.open = (item.dataset.open === "true") ? "false" : "true";
    });

    item.appendChild(head);
    item.appendChild(body);
    return { item, body };
  }

  function makeMapCanvas(presetKey){
    const wrap = document.createElement("div");
    wrap.className = "mapCard";
    const canvas = document.createElement("div");
    canvas.className = "mapCanvas";
    canvas.style.setProperty("--map-img", MAP_IMG);
    const p = BBOX[presetKey] || null;
    canvas.style.setProperty("--map-size", p?.size || "180%");
    canvas.style.setProperty("--map-pos", p?.pos || "50% 50%");
    const pins = document.createElement("div");
    pins.className = "pinLayer";
    canvas.appendChild(pins);
    wrap.appendChild(canvas);
    return { wrap, canvas, pins };
  }

  function placePins(canvasEl, pinsLayer, people){
    pinsLayer.innerHTML = "";
    const rect = canvasEl.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;

    // group by identical coords to show stack count
    const groups = groupBy(people, p => `${p.loc.lat},${p.loc.lng}`);

    for (const [key, arr] of groups.entries()){
      const base = project(arr[0].loc.lat, arr[0].loc.lng, w, h);
      const n = arr.length;
      // slight spiral offset so faces don't perfectly overlap
      for (let i=0;i<n;i++){
        const p = arr[i];
        const angle = (i / Math.max(1,n)) * Math.PI * 2;
        const r = n === 1 ? 0 : Math.min(18, 8 + i*3);
        const x = base.x + Math.cos(angle)*r;
        const y = base.y + Math.sin(angle)*r;

        const pin = document.createElement("div");
        pin.className = "facePin";
        if (n > 1 && i === 0) pin.setAttribute("data-count", String(n));
        pin.style.left = `${x}px`;
        pin.style.top = `${y}px`;

        const img = document.createElement("img");
        img.src = p.photo || "/static/img/placeholder-avatar.png";
        img.alt = p.name;

        const dot = document.createElement("span");
        dot.className = "faceDot";

        const card = document.createElement("div");
        card.className = "infoCard";
        const age = calcAge(p.born, p.died);
        const place = [p.loc.city, p.loc.region].filter(Boolean).join(", ");
        const line2 = (age != null) ? `Age ${age} • ${place}` : place;
        card.innerHTML = `<div class="infoName">${p.name}</div>
                          <div class="infoSub">${line2}</div>`;

        pin.appendChild(img);
        pin.appendChild(dot);
        pin.appendChild(card);

        // mobile tap => show one floating card (simple)
        pin.addEventListener("click", (e) => {
          if (window.matchMedia("(hover: hover)").matches) return;
          // remove any existing card
          const existing = pinsLayer.querySelector(".infoCard--mobile");
          if (existing) existing.remove();

          const mobile = document.createElement("div");
          mobile.className = "infoCard infoCard--mobile";
          mobile.style.opacity = "1";
          mobile.style.pointerEvents = "auto";
          mobile.style.transform = "translate(-10%, -118%)";
          mobile.innerHTML = card.innerHTML;

          const closeBtn = document.createElement("div");
          closeBtn.style.cssText = "margin-top:6px;font-weight:900;font-size:12px;color:#7a5a45;cursor:pointer;";
          closeBtn.textContent = "Close";
          closeBtn.addEventListener("click", () => mobile.remove());
          mobile.appendChild(closeBtn);

          pin.appendChild(mobile);
          e.stopPropagation();
        });

        pinsLayer.appendChild(pin);
      }
    }
  }

  async function load(){
    const res = await fetch(`/api/tree/${FAMILY_NAME}`);
    const data = await res.json();
    const peopleRaw = Array.isArray(data.people) ? data.people : [];
    // alive with location
    const people = peopleRaw
      .filter(p => !p.died)
      .map(p => {
        const loc = p.location || p.current || {};
        return {
          name: safe(p.name),
          born: p.born,
          died: p.died,
          photo: p.photo,
          loc: {
            country: safe(loc.country),
            region: safe(loc.region),
            city: safe(loc.city),
            lat: loc.lat,
            lng: loc.lng
          }
        };
      })
      .filter(p => p.loc.lat != null && p.loc.lng != null && p.loc.country);

    return people;
  }

  const root = document.getElementById("mapAccordion");
  if (!root) return;

  const people = await load();

  const byCountry = groupBy(people, p => p.loc.country);
  const countries = Array.from(byCountry.keys()).sort((a,b)=>a.localeCompare(b));

  root.innerHTML = "";

  // render countries
  for (const c of countries){
    const arrC = byCountry.get(c) || [];
    const { item, body } = makeAccItem({ title: c, flag: FLAGS[c] || "🌍", count: arrC.length, open: false });

    const { wrap, canvas, pins } = makeMapCanvas(c);
    body.appendChild(wrap);

    // states within country
    const byState = groupBy(arrC, p => p.loc.region || "—");
    const states = Array.from(byState.keys()).filter(k=>k!=="—").sort((a,b)=>a.localeCompare(b));
    if (states.length){
      const sub = document.createElement("div");
      sub.className = "subAcc";
      body.appendChild(sub);

      for (const s of states){
        const arrS = byState.get(s) || [];
        const { item: sItem, body: sBody } = makeAccItem({ title: s, flag: "📍", count: arrS.length, open: false });
        sItem.classList.add("subItem");

        const { wrap: sWrap, canvas: sCanvas, pins: sPins } = makeMapCanvas(s);
        sBody.appendChild(sWrap);

        // cities row
        const byCity = groupBy(arrS, p => p.loc.city || "—");
        const cities = Array.from(byCity.keys()).filter(k=>k!=="—").sort((a,b)=>a.localeCompare(b));
        if (cities.length){
          const row = document.createElement("div");
          row.className = "cityRow";
          for (const city of cities){
            const count = (byCity.get(city) || []).length;
            const pill = document.createElement("button");
            pill.type = "button";
            pill.className = "cityPill";
            pill.textContent = `${city} (${count})`;
            pill.addEventListener("click", () => {
              // city zoom: we approximate by nudging map position toward first person in that city
              const peopleCity = byCity.get(city) || [];
              if (!peopleCity.length) return;
              const p0 = peopleCity[0];
              // translate lat/lng to world percent for background-position
              const xPct = ((p0.loc.lng + 180) / 360) * 100;
              const yPct = ((90 - p0.loc.lat) / 180) * 100;
              sCanvas.style.setProperty("--map-size", "950%");
              sCanvas.style.setProperty("--map-pos", `${xPct}% ${yPct}%`);
              placePins(sCanvas, sPins, arrS);
            });
            row.appendChild(pill);
          }
          sBody.appendChild(row);
        }

        sub.appendChild(sItem);

        // deferred pin layout on open/resize
        const layout = () => {
          placePins(sCanvas, sPins, arrS);
        };
        // place when opened
        sItem.querySelector(".accHead").addEventListener("click", () => {
          setTimeout(layout, 50);
        });
        window.addEventListener("resize", () => {
          if (sItem.dataset.open === "true") layout();
        });

        // initial for states closed: none
      }
    }

    root.appendChild(item);

    const layoutCountry = () => placePins(canvas, pins, arrC);
    item.querySelector(".accHead").addEventListener("click", () => setTimeout(layoutCountry, 50));
    window.addEventListener("resize", () => { if (item.dataset.open === "true") layoutCountry(); });
  }

  // Close mobile pop card on background tap
  document.addEventListener("click", () => {
    const m = document.querySelector(".infoCard--mobile");
    if (m) m.remove();
  });
})();
