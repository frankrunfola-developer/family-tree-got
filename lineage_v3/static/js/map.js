/* ----------------------------------------------------------------------------------
 File:    map.js
 Purpose: Interactive Family Map (vector tiles + face markers)
 Author:  Frank Runfola
 Notes:
   - Uses Mapbox GL when MAPBOX_TOKEN is present, otherwise falls back to MapLibre + OSM
   - People data: window.MAP_API_URL must return { people:[...] } (tree endpoints)
---------------------------------------------------------------------------------- */

document.addEventListener("DOMContentLoaded", () => {
  boot().catch(err => console.error(err));
});


async function boot() {
  const MapLib = (() => {
    const token = (window.MAPBOX_TOKEN || "").trim();
    if (token && window.mapboxgl) return { engine: "mapbox", gl: window.mapboxgl, token };
    if (window.maplibregl) return { engine: "maplibre", gl: window.maplibregl, token: "" };
    return null;
  })();

  const elMap = document.getElementById("lmMap");
  if (!MapLib || !elMap) {
    console.warn("Map engine not available (mapboxgl/maplibregl missing) or #lmMap not found.");
    return;
  }
  const data = await fetchPeople();
  const features = toFeatures(data.people || []);
  const gl = MapLib.gl;

  if (MapLib.engine === "mapbox") gl.accessToken = MapLib.token;

  let map;
  try {
    map = new gl.Map({
    container: elMap,
    style: getStyle(MapLib),
    center: [-25, 25],
    zoom: 1.6,
    pitch: 0,
    attributionControl: false
    });
  } catch (e) {
    console.warn("Map init failed, using static fallback", e);
    const people = await fetchPeople();
    renderStaticMap(elMap, people);
    return;
  }

  if (map.addControl) {
    map.addControl(new gl.NavigationControl({ visualizePitch: true }), "top-right");
  }

  const spider = makeSpiderfy(map);

  map.on("load", () => {
    map.addSource("people", {
      type: "geojson",
      data: { type: "FeatureCollection", features },
      cluster: true,
      clusterRadius: 48,
      clusterMaxZoom: 10
    });

    // Invisible hit layer for clustered features (Option B: HTML cluster pins)
    map.addLayer({
      id: "cluster-hit",
      type: "circle",
      source: "people",
      filter: ["has", "point_count"],
      paint: {
        "circle-radius": 18,
        "circle-opacity": 0
      }
    });

    // Invisible hit layer for individual people
    map.addLayer({
      id: "unclustered-hit",
      type: "circle",
      source: "people",
      filter: ["!", ["has", "point_count"]],
      paint: {
        "circle-radius": 18,
        "circle-opacity": 0
      }
    });

    if (features.length) {
      fitToPeople(gl, map, features);
    }

    const markers = new Map(); // key -> gl.Marker
    const pop = new gl.Popup({ closeButton: true, closeOnClick: true, maxWidth: "320px" });

    function buildClusterMarker(gl, feature, popup, map) {
      const props = feature.properties || {};
      const count = Number(props.point_count || 0);

      const el = document.createElement("button");
      el.className = "lmClusterPin";
      el.type = "button";
      el.setAttribute("aria-label", `Cluster of ${count} people`);

      const img = document.createElement("img");
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.src = props.photo || "";
      el.appendChild(img);

      const badge = document.createElement("span");
      badge.className = "lmClusterBadge";
      badge.textContent = `+${Math.max(0, count - 1)}`;
      el.appendChild(badge);

      el.addEventListener("click", (ev) => {
        ev.stopPropagation();

        const clusterId = props.cluster_id;
        const center = feature.geometry.coordinates;

        const src = map.getSource("people");
        if (!src || !src.getClusterLeaves) return;

        src.getClusterLeaves(clusterId, 32, 0, (err, leaves) => {
          if (err) return;

          const z = map.getZoom();
          if (z < 5) {
            src.getClusterExpansionZoom(clusterId, (err2, zoom) => {
              if (err2) return;
              map.easeTo({ center, zoom: Math.min(zoom + 0.6, 9.5), duration: 520 });
            });
            return;
          }

          spider.show(center, leaves || [], popup);
        });
      });

      return new gl.Marker({ element: el, anchor: "center" }).setLngLat(feature.geometry.coordinates);
    }

    function syncMarkers() {
      spider.clear();

      const seenPeople = new Set();
      const seenClusters = new Set();

      // People currently visible (unclustered)
      const renderedPeople = map.queryRenderedFeatures({ layers: ["unclustered-hit"] }) || [];
      for (const f of renderedPeople) {
        const id = f.properties?.pid;
        if (!id) continue;

        const key = `p:${id}`;
        seenPeople.add(key);

        if (!markers.has(key)) {
          const m = buildFaceMarker(gl, f, pop, map);
          m.addTo(map);
          markers.set(key, m);
        }
      }

      // Cluster features come from the source, not from rendered layers
      const srcClusters = map.querySourceFeatures("people") || [];
      for (const f of srcClusters) {
        const props = f.properties || {};
        if (!props.cluster) continue;

        const clusterId = props.cluster_id;
        if (clusterId == null) continue;

        const key = `c:${clusterId}`;
        seenClusters.add(key);

        if (!markers.has(key)) {
          const src = map.getSource("people");
          if (!src || !src.getClusterLeaves) continue;

          // Use one representative leaf photo for the cluster pin
          src.getClusterLeaves(clusterId, 1, 0, (err, leaves) => {
            if (err) return;
            const leaf = (leaves && leaves[0]) ? leaves[0] : null;
            const leafProps = leaf?.properties || {};
            f.properties.photo =
              leafProps.photo ||
              leafProps.photoUrl ||
              leafProps.photo_url ||
              "";

            const m = buildClusterMarker(gl, f, pop, map);
            m.addTo(map);
            markers.set(key, m);
          });
        }
      }

      // Remove stale markers
      for (const [key, m] of markers.entries()) {
        if (key.startsWith("p:")) {
          if (!seenPeople.has(key)) {
            m.remove();
            markers.delete(key);
          }
        } else if (key.startsWith("c:")) {
          if (!seenClusters.has(key)) {
            m.remove();
            markers.delete(key);
          }
        }
      }
    }

    map.on("moveend", syncMarkers);
    map.on("zoomend", syncMarkers);
    map.on("idle", syncMarkers);

    // Clicking a cluster (via invisible hit layer) expands or spiderfies
    map.on("click", "cluster-hit", (e) => {
      const f = e.features && e.features[0];
      if (!f) return;

      const clusterId = f.properties.cluster_id;
      const center = f.geometry.coordinates;

      const src = map.getSource("people");
      if (!src || !src.getClusterLeaves) return;

      src.getClusterLeaves(clusterId, 32, 0, (err, leaves) => {
        if (err) return;

        const z = map.getZoom();
        if (z < 5) {
          src.getClusterExpansionZoom(clusterId, (err2, zoom) => {
            if (err2) return;
            map.easeTo({ center, zoom: Math.min(zoom + 0.6, 9.5), duration: 520 });
          });
          return;
        }

        spider.show(center, leaves || [], pop);
      });
    });

    // Clicking elsewhere clears spiderfy (but ignore clicks on cluster/people hit layers)
    map.on("click", (e) => {
      const hits = map.queryRenderedFeatures(e.point, { layers: ["cluster-hit", "unclustered-hit"] });
      if (hits && hits.length) return;
      spider.clear();
    });

    map.on("movestart", () => spider.clear());
  });
}

async function fetchPeople() {
  const url = window.MAP_API_URL;
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Map data fetch failed (${res.status})`);
  return await res.json();
}

function renderStaticMap(elMap, people) {
  // Guaranteed fallback: static image + percentage pins.
  elMap.innerHTML = "";
  elMap.style.position = "relative";
  elMap.style.overflow = "hidden";
  elMap.style.minHeight = elMap.style.minHeight || "420px";

  const imgUrl = window.MAP_IMG || "";
  const img = document.createElement("img");
  img.alt = "Map";
  img.src = imgUrl;
  img.style.width = "100%";
  img.style.height = "100%";
  img.style.objectFit = "cover";
  img.style.display = "block";
  elMap.appendChild(img);

  const layer = document.createElement("div");
  layer.style.position = "absolute";
  layer.style.inset = "0";
  elMap.appendChild(layer);

  for (const p of people || []) {
    const loc = p.location || {};
    const x = Number(loc.xPct);
    const y = Number(loc.yPct);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;

    const pin = document.createElement("button");
    pin.type = "button";
    pin.className = "lmPin";
    pin.title = p.name || "";
    pin.style.position = "absolute";
    pin.style.left = x + "%";
    pin.style.top = y + "%";
    pin.style.transform = "translate(-50%, -50%)";
    pin.style.width = "34px";
    pin.style.height = "34px";
    pin.style.borderRadius = "999px";
    pin.style.border = "2px solid rgba(0,0,0,0.25)";
    pin.style.background = "rgba(255,255,255,0.92)";
    pin.style.boxShadow = "0 6px 14px rgba(0,0,0,0.18)";
    pin.style.padding = "0";
    pin.style.overflow = "hidden";
    pin.style.cursor = "pointer";

    const a = document.createElement("img");
    a.alt = p.name || "";
    a.src = p.photo || "";
    a.style.width = "100%";
    a.style.height = "100%";
    a.style.objectFit = "cover";
    pin.appendChild(a);

    pin.addEventListener("click", () => {
      alert(p.name || "Person");
    });

    layer.appendChild(pin);
  }
}



function toFeatures(people) {
  const out = [];
  for (const p of people) {
    const loc = p.location || {};
    const lat = toNum(loc.lat);
    const lng = toNum(loc.lng);
    if (!isFinite(lat) || !isFinite(lng)) continue;

    out.push({
      type: "Feature",
      geometry: { type: "Point", coordinates: [lng, lat] },
      properties: {
        pid: p.id || "",
        name: p.name || "",
        born: p.born || "",
        died: p.died || "",
        photo: p.photo || "",
        city: loc.city || "",
        region: loc.region || "",
        country: loc.country || ""
      }
    });
  }
  return out;
}

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function getStyle(lib) {
  if (lib.engine === "mapbox") {
    return "mapbox://styles/mapbox/standard";
  }

  return {
    version: 8,
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors"
      }
    },
    layers: [
      { id: "osm", type: "raster", source: "osm" }
    ]
  };
}

function fitToPeople(gl, map, features) {
  // Use the active engine's LngLatBounds (Mapbox GL or MapLibre)
  const b = new gl.LngLatBounds(features[0].geometry.coordinates, features[0].geometry.coordinates);
  for (const f of features) b.extend(f.geometry.coordinates);
  map.fitBounds(b, { padding: 60, duration: 600, maxZoom: 6.8 });
}

function buildFaceMarker(gl, feature, popup, map) {
  const props = feature.properties || {};
  const el = document.createElement("button");
  el.className = "lmFacePin";
  el.type = "button";
  el.setAttribute("aria-label", props.name || "Person");

  const img = document.createElement("img");
  img.alt = props.name || "";
  img.loading = "lazy";
  img.decoding = "async";
  img.src = props.photo || "";
  el.appendChild(img);

  const coords = feature.geometry.coordinates;

  el.addEventListener("click", (ev) => {
    ev.stopPropagation();
    popup.setLngLat(coords).setHTML(renderPopup(props)).addTo(map);
  });

  return new gl.Marker({ element: el, anchor: "center" }).setLngLat(coords);
}

function renderPopup(p) {
  const name = esc(p.name || "");
  const born = esc(p.born || "");
  const died = esc(p.died || "");
  const life = [born, died].filter(Boolean).join(" — ");
  const loc = [p.city, p.region, p.country].filter(Boolean).map(esc).join(", ");
  const photo = esc(p.photo || "");

  return `
    <div class="lmPopRow">
      <div class="lmPopAvatar">${photo ? `<img src="${photo}" alt="${name}">` : ""}</div>
      <div>
        <div class="lmPopName">${name}</div>
        ${life ? `<div class="lmPopMeta">${life}</div>` : ""}
      </div>
    </div>
    ${loc ? `<div class="lmPopLoc">${loc}</div>` : ""}
  `;
}

function esc(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function makeSpiderfy(map) {
  const container = map.getCanvasContainer();
  const nodes = [];

  function clear() {
    while (nodes.length) nodes.pop().remove();
  }

  function show(centerLngLat, leaves, popup) {
    clear();

    const center = map.project(centerLngLat);
    const n = Math.min(leaves.length, 18);
    if (!n) return;

    const r = n <= 8 ? 52 : 64;

    const dot = document.createElement("div");
    dot.className = "lmSpiderDot";
    dot.style.left = `${center.x - 4}px`;
    dot.style.top = `${center.y - 4}px`;
    container.appendChild(dot);
    nodes.push(dot);

    for (let i = 0; i < n; i++) {
      const leaf = leaves[i];
      const props = leaf.properties || {};
      const ang = (Math.PI * 2 * i) / n;
      const dist = r + (i % 3) * 10;
      const p = { x: center.x + Math.cos(ang) * dist, y: center.y + Math.sin(ang) * dist };
      const lngLat = map.unproject(p);

      const line = document.createElement("div");
      line.className = "lmSpiderLine";

      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      const rot = Math.atan2(dy, dx);

      line.style.left = `${center.x}px`;
      line.style.top = `${center.y}px`;
      line.style.height = `${len}px`;
      line.style.transform = `rotate(${rot}rad)`;
      container.appendChild(line);
      nodes.push(line);

      const el = document.createElement("button");
      el.className = "lmFacePin";
      el.type = "button";
      el.style.position = "absolute";
      el.style.left = `${p.x - 18}px`;
      el.style.top = `${p.y - 18}px`;
      el.style.zIndex = "9";
      el.setAttribute("aria-label", props.name || "Person");

      const img = document.createElement("img");
      img.alt = props.name || "";
      img.loading = "lazy";
      img.decoding = "async";
      img.src = props.photo || "";
      el.appendChild(img);

      el.addEventListener("click", (ev) => {
        ev.stopPropagation();
        popup.setLngLat([lngLat.lng, lngLat.lat]).setHTML(renderPopup(props)).addTo(map);
      });

      container.appendChild(el);
      nodes.push(el);
    }
  }

  return { clear, show };
}
