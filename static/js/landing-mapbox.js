
document.addEventListener("DOMContentLoaded", async () => {
  const mapEl = document.getElementById("lmMap");
  if (!mapEl) return;

  let payload;
  try {
    const apiUrl = window.MAP_API_URL || '/api/family/current/people';
    const res = await fetch(apiUrl, { cache: 'no-store', credentials: 'same-origin' });
    if (!res.ok) throw new Error('Location data could not be loaded.');
    payload = await res.json();
  } catch (err) {
    console.error(err);
    mapEl.innerHTML = '<div class="map-empty-state">Location data could not be loaded.</div>';
    return;
  }

  const people = Array.isArray(payload.people) ? payload.people : [];
  const places = Array.isArray(payload.places) ? payload.places : [];
  if (!places.length) {
    mapEl.innerHTML = '<div class="map-empty-state">No landing-page map locations were found.</div>';
    return;
  }

  const byName = new Map(people.map((p) => [String(p.name || '').toLowerCase(), p]));
  const chipRow = document.getElementById('personChipRow');
  const selectorDetails = document.getElementById('mapSelectorDetails');
  const allActionBtn = document.querySelector('[data-action="all"]');
  const mapCard = mapEl.closest('.map-card-live');
  const mapFrame = mapEl.closest('.map-frame');
  const sequenceBanner = document.createElement('div');
  sequenceBanner.className = 'map-sequence-banner';
  sequenceBanner.innerHTML = '<span class="map-sequence-kicker">Active route</span><span class="map-sequence-value">—</span>';
  mapFrame?.before(sequenceBanner);
  const sequenceValue = sequenceBanner.querySelector('.map-sequence-value');

  let playbackActive = false;
  let adapter = null;
  let activePerson = null;
  let loopRaf = null;
  let playbackSequence = [];
  let playbackIndex = 0;
  let playbackStartedAt = 0;
  let loopCurrentPersonId = null;
  let endpointDots = [];
  const speedToggle = document.getElementById('mapSpeedToggle');
  let playbackSpeed = 'slow';
  const speedProfiles = {
    slow: { routeDuration: 2600, transitionDuration: 420 },
    medium: { routeDuration: 1800, transitionDuration: 300 },
    fast: { routeDuration: 1200, transitionDuration: 180 }
  };

  function setActiveUI(person, traveling = false) {
    activePerson = person || null;
    const activeName = person?.name || '';
    document.querySelectorAll('.person-chip').forEach((chip) => chip.classList.toggle('is-active', chip.dataset.personName === activeName));
    document.querySelectorAll('.person-card').forEach((card) => card.classList.toggle('is-active-map', card.dataset.personName === activeName));
    if (sequenceValue) {
      sequenceValue.textContent = person ? `${person.name}: ${pairLabel(person)}` : '—';
    }
  }

  function setActionMode(mode) {
    if (allActionBtn) allActionBtn.classList.toggle('is-active', mode === 'all' || mode === 'playing');
  }

  function stopLoop() {
    playbackActive = false;
    if (loopRaf) cancelAnimationFrame(loopRaf);
    loopRaf = null;
    setActionMode('stopped');
    adapter?.stopTraveler();
    if (activePerson) {
      setActiveUI(activePerson, false);
    }
  }

  function buildChip(person) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'person-chip';
    btn.dataset.personName = person.name;
    btn.textContent = person.name;
    btn.addEventListener('click', () => {
      stopLoop();
      adapter?.highlightPerson(person, { animateTraveler: false });
    });
    return btn;
  }

  people.forEach((person) => chipRow?.appendChild(buildChip(person)));

  document.querySelectorAll('.person-card[data-person-name]').forEach((card) => {
    card.addEventListener('click', () => {
      const person = byName.get(String(card.dataset.personName || '').toLowerCase());
      if (!person) return;
      stopLoop();
      adapter?.highlightPerson(person, { animateTraveler: false });
    });
  });

  function buildAvatarMarker(person) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'map-avatar-marker';
    el.style.backgroundImage = `url(${person.image})`;
    el.setAttribute('aria-label', person.name);
    el.addEventListener('click', () => {
      stopLoop();
      adapter?.highlightPerson(person, { animateTraveler: false });
    });
    return el;
  }

  function pairLabel(person) {
    if (!Array.isArray(person.path) || person.path.length < 2) return person.label || person.name;
    const start = person.path[0];
    const end = person.path[person.path.length - 1];
    const startPlace = places.find((place) => place.coords[0] === start[0] && place.coords[1] === start[1])?.name || 'Origin';
    const endPlace = places.find((place) => place.coords[0] === end[0] && place.coords[1] === end[1])?.name || 'Destination';
    return `${startPlace} → ${endPlace}`;
  }


  function buildEndpointDot(kind) {
    const el = document.createElement('span');
    el.className = `map-endpoint-dot map-endpoint-dot-${kind}`;
    return el;
  }

  function buildCityLabel(text) {
    const el = document.createElement('span');
    el.className = 'map-city-label';
    el.innerHTML = `<strong>${escapeHtml(text || '')}</strong>`;
    return el;
  }

  function endpointLabel(person, index) {
    if (!Array.isArray(person.path) || !person.path.length) return '';
    const targetCoords = person.path[index === 0 ? 0 : person.path.length - 1];
    const place = places.find((place) => place.coords[0] === targetCoords[0] && place.coords[1] === targetCoords[1]);
    if (place?.name) return place.name;
    const raw = index === 0 ? (person.origin_label || '') : (person.settlement_label || '');
    return String(raw).split(',')[0].trim() || (index === 0 ? 'Origin' : 'Destination');
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function clearEndpointDots() {
    endpointDots.forEach((marker) => {
      try { marker.remove(); } catch (err) {}
    });
    endpointDots = [];
  }

  function getPlaybackSequence() {
    return people.filter((person) => Array.isArray(person.path) && person.path.length > 1);
  }

  function fitLngLatBounds(coordsList) {
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    coordsList.forEach(([lng, lat]) => {
      minLng = Math.min(minLng, lng);
      minLat = Math.min(minLat, lat);
      maxLng = Math.max(maxLng, lng);
      maxLat = Math.max(maxLat, lat);
    });
    return [[minLat, minLng], [maxLat, maxLng]];
  }

  function interpolateCoords(path, progress) {
    if (!Array.isArray(path) || !path.length) return null;
    if (path.length === 1) return path[0];
    const distances = [0];
    let total = 0;
    for (let i = 1; i < path.length; i += 1) {
      const [lng1, lat1] = path[i - 1];
      const [lng2, lat2] = path[i];
      total += Math.hypot(lng2 - lng1, lat2 - lat1);
      distances.push(total);
    }
    const target = total * Math.min(Math.max(progress, 0), 1);
    for (let i = 1; i < distances.length; i += 1) {
      if (target <= distances[i]) {
        const span = distances[i] - distances[i - 1] || 1;
        const local = (target - distances[i - 1]) / span;
        const [lng1, lat1] = path[i - 1];
        const [lng2, lat2] = path[i];
        return [lng1 + ((lng2 - lng1) * local), lat1 + ((lat2 - lat1) * local)];
      }
    }
    return path[path.length - 1];
  }

  async function initMapbox(token) {
    if (!window.mapboxgl || !token) throw new Error('Missing Mapbox token.');
    mapboxgl.accessToken = token;
    const map = new mapboxgl.Map({
      container: 'lmMap',
      style: 'mapbox://styles/mapbox/light-v11',
      center: [-50, 39],
      zoom: 2.0,
      attributionControl: false
    });
    map.addControl(new mapboxgl.NavigationControl(), 'top-right');

    const ready = new Promise((resolve, reject) => {
      let settled = false;
      const done = (fn, value) => { if (!settled) { settled = true; fn(value); } };
      map.once('load', () => done(resolve));
      map.on('error', (evt) => {
        const msg = evt?.error?.message || '';
        if (evt?.error?.status === 401 || /access token|unauthorized|forbidden/i.test(msg)) {
          done(reject, new Error('Mapbox rejected the public token.'));
        }
      });
      setTimeout(() => done(reject, new Error('The map did not finish loading.')), 9000);
    });
    await ready;

    const allRoutes = {
      type: 'FeatureCollection',
      features: people
        .filter((person) => Array.isArray(person.path) && person.path.length > 1)
        .map((person) => ({
          type: 'Feature',
          properties: { id: person.id, name: person.name },
          geometry: { type: 'LineString', coordinates: person.path }
        }))
    };

    map.addSource('all-routes', { type: 'geojson', data: allRoutes });
    map.addLayer({
      id: 'all-routes-line',
      type: 'line',
      source: 'all-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#cda873', 'line-width': 2.5, 'line-opacity': 0, 'line-dasharray': [2, 1.25] }
    });
    map.addLayer({
      id: 'all-routes-arrows',
      type: 'symbol',
      source: 'all-routes',
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 90,
        'text-field': '➜',
        'text-size': 15,
        'text-keep-upright': false,
        'text-allow-overlap': true,
        'text-ignore-placement': true
      },
      paint: { 'text-color': '#b06f38', 'text-opacity': 0 }
    });


    const travelerEl = document.createElement('div');
    travelerEl.className = 'map-traveler-avatar';
    const travelerMarker = new mapboxgl.Marker({ element: travelerEl, anchor: 'center' }).setLngLat(places[0].coords).addTo(map);
    travelerEl.style.display = 'none';

    map.fitBounds(places.reduce((b, p) => b.extend(p.coords), new mapboxgl.LngLatBounds()), { padding: 48, maxZoom: 4.45, duration: 0 });

    let activeRouteId = null;
    let activeRouteArrowId = null;
    let currentPersonId = null;

    function clearActiveRoute() {
      if (activeRouteArrowId && map.getLayer(activeRouteArrowId)) map.removeLayer(activeRouteArrowId);
      if (activeRouteId && map.getLayer(activeRouteId)) map.removeLayer(activeRouteId);
      if (activeRouteId && map.getSource(activeRouteId)) map.removeSource(activeRouteId);
      activeRouteId = null;
      activeRouteArrowId = null;
    }

    function showAllRoutes() {
      clearEndpointDots();
      clearActiveRoute();
      travelerEl.style.display = 'none';
      if (map.getLayer('all-routes-line')) map.setPaintProperty('all-routes-line', 'line-opacity', 0.78);
      if (map.getLayer('all-routes-arrows')) map.setPaintProperty('all-routes-arrows', 'text-opacity', 0);
      map.fitBounds(places.reduce((b, p) => b.extend(p.coords), new mapboxgl.LngLatBounds()), { padding: 40, maxZoom: 5.15, duration: 350 });
      if (sequenceValue) sequenceValue.textContent = 'All migrations';
      document.querySelectorAll('.person-chip').forEach((chip) => chip.classList.remove('is-active'));
      document.querySelectorAll('.person-card').forEach((card) => card.classList.remove('is-active-map'));
    }

    return {
      showAllRoutes,
      highlightPerson(person, options = {}) {
        const animateTraveler = Boolean(options.animateTraveler);
        const skipCamera = Boolean(options.skipCamera);
        setActiveUI(person, animateTraveler);
        clearEndpointDots();
        clearAllRouteLayers();
        if (map.getLayer('all-routes-line')) {
          map.setPaintProperty('all-routes-line', 'line-opacity', 0);
        }
        if (map.getLayer('all-routes-arrows')) {
          map.setPaintProperty('all-routes-arrows', 'text-opacity', 0);
        }
        if (currentPersonId !== person.id) {
          clearActiveRoute();
          currentPersonId = person.id;
          if (Array.isArray(person.path) && person.path.length > 1) {
            const routeId = `route-${person.id}`;
            activeRouteId = routeId;
            activeRouteArrowId = `${routeId}-arrows`;
            map.addSource(routeId, { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: person.path } } });
            map.addLayer({
              id: routeId,
              type: 'line',
              source: routeId,
              layout: { 'line-cap': 'round', 'line-join': 'round' },
              paint: { 'line-color': '#8a5a34', 'line-width': 4.5, 'line-opacity': 0.96, 'line-dasharray': [0.85, 1.35] }
            });
            const startCoords = person.path[0];
            const endCoords = person.path[person.path.length - 1];
            const startDot = new mapboxgl.Marker({ element: buildEndpointDot('origin'), anchor: 'center' }).setLngLat(startCoords).addTo(map);
            const endDot = new mapboxgl.Marker({ element: buildEndpointDot('destination'), anchor: 'center' }).setLngLat(endCoords).addTo(map);
            const startLabel = new mapboxgl.Marker({ element: buildCityLabel(endpointLabel(person, 0)), anchor: 'left', offset: [22, -20] }).setLngLat(startCoords).addTo(map);
            const endLabel = new mapboxgl.Marker({ element: buildCityLabel(endpointLabel(person, 1)), anchor: 'left', offset: [22, 18] }).setLngLat(endCoords).addTo(map);
            endpointDots.push(startDot, endDot, startLabel, endLabel);
          }
        }
        if (!skipCamera) {
          if (Array.isArray(person.path) && person.path.length > 1) {
            map.fitBounds(person.path.reduce((b, c) => b.extend(c), new mapboxgl.LngLatBounds()), { padding: 36, maxZoom: 5.8, duration: animateTraveler ? 350 : 700 });
          } else if (Array.isArray(person.coords) && person.coords.length === 2) {
            map.flyTo({ center: person.coords, zoom: 5, duration: animateTraveler ? 350 : 700 });
          }
        }
      },
      setTravelerPosition(person, coords) {
        if (!coords || !person) return;
        travelerEl.style.display = 'block';
        travelerEl.style.backgroundImage = `url(${person.image})`;
        travelerMarker.setLngLat(coords);
      },
      stopTraveler() {
        travelerEl.style.display = 'none';
        clearEndpointDots();
      }
    };
  }

  function initLeaflet() {
    if (!window.L) throw new Error('Leaflet fallback is unavailable.');
    mapEl.innerHTML = '';
    const map = L.map('lmMap', { zoomControl: true, attributionControl: true });
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap contributors'
    }).addTo(map);


    const allLatLngs = [];
    people.forEach((person) => {
      if (Array.isArray(person.path) && person.path.length > 1) {
        const latlngs = person.path.map(([lng, lat]) => [lat, lng]);
        allLatLngs.push(...latlngs);
      }
    });

    let travelerIcon = L.divIcon({ className: 'leaflet-traveler', html: '<span class="map-traveler-avatar"></span>', iconSize: [42, 42], iconAnchor: [21, 21] });
    const travelerMarker = L.marker([places[0].coords[1], places[0].coords[0]], { icon: travelerIcon, opacity: 0 }).addTo(map);

    if (allLatLngs.length) {
      map.fitBounds(L.latLngBounds(allLatLngs), { padding: [44, 44], maxZoom: 4.45 });
    } else {
      map.fitBounds(fitLngLatBounds(places.map((p) => p.coords)), { padding: [44, 44], maxZoom: 4.45 });
    }

    let activeLine = null;
    let activeArrowMarkers = [];
    let currentPersonId = null;
    let allRouteLayers = [];

    function clearActiveRoute() {
      if (activeLine) map.removeLayer(activeLine);
      activeArrowMarkers.forEach((marker) => map.removeLayer(marker));
      activeArrowMarkers = [];
      activeLine = null;
    }

    function clearAllRouteLayers() {
      allRouteLayers.forEach((layer) => {
        try { map.removeLayer(layer); } catch (err) {}
      });
      allRouteLayers = [];
    }

    return {
      showAllRoutes() {
        clearEndpointDots();
        clearActiveRoute();
        clearAllRouteLayers();
        travelerMarker.setOpacity(0);
        people.forEach((person) => {
          if (!Array.isArray(person.path) || person.path.length < 2) return;
          const latlngs = person.path.map(([lng, lat]) => [lat, lng]);
          allRouteLayers.push(L.polyline(latlngs, { color: '#8a5a34', weight: 3.5, opacity: 0.74, dashArray: '4 8' }).addTo(map));
        });
        if (allLatLngs.length) {
          map.fitBounds(L.latLngBounds(allLatLngs), { padding: [36, 36], maxZoom: 5.15 });
        }
        if (sequenceValue) sequenceValue.textContent = 'All migrations';
        document.querySelectorAll('.person-chip').forEach((chip) => chip.classList.remove('is-active'));
        document.querySelectorAll('.person-card').forEach((card) => card.classList.remove('is-active-map'));
      },
      highlightPerson(person, options = {}) {
        const animateTraveler = Boolean(options.animateTraveler);
        const skipCamera = Boolean(options.skipCamera);
        setActiveUI(person, animateTraveler);
        clearEndpointDots();
        clearAllRouteLayers();
        if (currentPersonId !== person.id) {
          clearActiveRoute();
          currentPersonId = person.id;
          if (Array.isArray(person.path) && person.path.length > 1) {
            const latlngs = person.path.map(([lng, lat]) => [lat, lng]);
            activeLine = L.polyline(latlngs, { color: '#8a5a34', weight: 4, opacity: 0.96, dashArray: '4 8' }).addTo(map);
            const startDot = L.marker(latlngs[0], { icon: L.divIcon({ className: 'leaflet-endpoint', html: '<span class="map-endpoint-dot map-endpoint-dot-origin"></span>', iconSize: [18,18], iconAnchor: [9,9] }) }).addTo(map);
            const endDot = L.marker(latlngs[latlngs.length - 1], { icon: L.divIcon({ className: 'leaflet-endpoint', html: '<span class="map-endpoint-dot map-endpoint-dot-destination"></span>', iconSize: [18,18], iconAnchor: [9,9] }) }).addTo(map);
            const startLabel = L.marker(latlngs[0], { icon: L.divIcon({ className: 'leaflet-city-marker', html: `<span class="map-city-label"><strong>${escapeHtml(endpointLabel(person, 0))}</strong></span>`, iconSize: [160, 24], iconAnchor: [-18, 18] }) }).addTo(map);
            const endLabel = L.marker(latlngs[latlngs.length - 1], { icon: L.divIcon({ className: 'leaflet-city-marker', html: `<span class="map-city-label"><strong>${escapeHtml(endpointLabel(person, 1))}</strong></span>`, iconSize: [180, 24], iconAnchor: [-20, -14] }) }).addTo(map);
            endpointDots.push(startDot, endDot, startLabel, endLabel);
          }
        }
        if (!skipCamera) {
          if (Array.isArray(person.path) && person.path.length > 1) {
            const latlngs = person.path.map(([lng, lat]) => [lat, lng]);
            map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30], maxZoom: 5.8 });
          } else if (Array.isArray(person.coords) && person.coords.length === 2) {
            map.flyTo([person.coords[1], person.coords[0]], 5, { duration: animateTraveler ? 0.35 : 0.75 });
          }
        }
      },
      setTravelerPosition(person, coords) {
        if (!coords || !person) return;
        travelerIcon = L.divIcon({ className: 'leaflet-traveler', html: `<span class="map-traveler-avatar" style="background-image:url(${person.image})"></span>`, iconSize: [42, 42], iconAnchor: [21, 21] });
        travelerMarker.setIcon(travelerIcon);
        travelerMarker.setOpacity(1);
        travelerMarker.setLatLng([coords[1], coords[0]]);
      },
      stopTraveler() {
        travelerMarker.setOpacity(0);
        clearEndpointDots();
      }
    };
  }

  speedToggle?.querySelectorAll('.map-speed-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const nextSpeed = btn.dataset.speed || 'medium';
      if (!speedProfiles[nextSpeed]) return;
      playbackSpeed = nextSpeed;
      speedToggle.querySelectorAll('.map-speed-btn').forEach((item) => item.classList.toggle('is-active', item === btn));
      if (playbackActive) {
        stopLoop();
        startLoop();
      }
    });
  });

  function startLoop() {
    playbackSequence = getPlaybackSequence();
    if (!playbackSequence.length || !adapter) return;
    playbackActive = true;
    playbackIndex = 0;
    playbackStartedAt = performance.now();
    setActionMode('playing');
    if (selectorDetails) selectorDetails.open = false;
    loopCurrentPersonId = null;

    function frame(now) {
      if (!playbackActive) return;
      const { routeDuration, transitionDuration } = speedProfiles[playbackSpeed] || speedProfiles.medium;
      const cycleDuration = routeDuration + transitionDuration;
      const current = playbackSequence[playbackIndex];
      const elapsed = now - playbackStartedAt;
      if (loopCurrentPersonId !== current.id) {
        loopCurrentPersonId = current.id;
        adapter.highlightPerson(current, { animateTraveler: true, skipCamera: false });
      }
      if (elapsed <= routeDuration) {
        const progress = elapsed / routeDuration;
        adapter.highlightPerson(current, { animateTraveler: true, skipCamera: true });
        adapter.setTravelerPosition(current, interpolateCoords(current.path, progress));
        setActiveUI(current, true);
      } else if (elapsed >= cycleDuration) {
        playbackIndex = (playbackIndex + 1) % playbackSequence.length;
        playbackStartedAt = now;
      }
      loopRaf = requestAnimationFrame(frame);
    }

    loopRaf = requestAnimationFrame(frame);
  }


  allActionBtn?.addEventListener('click', () => {
    stopLoop();
    startLoop();
    if (selectorDetails) selectorDetails.open = false;
  });

  const token = String(window.MAPBOX_TOKEN || '').trim();
  try {
    adapter = await initMapbox(token);
  } catch (err) {
    console.warn('Mapbox failed, falling back to Leaflet.', err);
    try {
      adapter = initLeaflet();
    } catch (leafletErr) {
      console.error(leafletErr);
      mapEl.innerHTML = '<div class="map-empty-state">The map could not be loaded.</div>';
      return;
    }
  }

  setActionMode('all');
  if (adapter) {
    adapter.showAllRoutes?.();
  }
});
