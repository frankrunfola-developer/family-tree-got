(() => {
  const token = (window.LINEAGEMAP_MAPBOX_TOKEN || '').trim();
  const mapEl = document.getElementById('lmMap');
  if (!mapEl || !window.mapboxgl || !token) return;

  mapboxgl.accessToken = token;

  const state = {
    map: null,
    markers: [],
    people: [],
    peopleByName: new Map(),
    activeId: null,
    animationFrame: null,
    progress: 0,
    playbackCoords: [],
  };

  const map = new mapboxgl.Map({
    container: mapEl,
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [-55, 35],
    zoom: 1.8,
    attributionControl: true,
  });
  state.map = map;
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');

  map.on('style.load', () => {
    try {
      map.setFog({});
      map.setPaintProperty('background', 'background-color', '#efe5d5');
    } catch (e) {}
    warmMapStyle(map);
  });

  fetch('/static/data/landing-locations.json')
    .then(r => r.json())
    .then(data => {
      state.people = data.people || [];
      state.people.forEach(p => state.peopleByName.set((p.name || '').toLowerCase(), p));
      renderChips(state.people);
      bindTreeClicks();
      map.on('load', () => setupMapData(data));
      if (map.loaded()) setupMapData(data);
    })
    .catch(err => {
      console.error('landing map data failed', err);
    });

  function warmMapStyle(map) {
    const fills = ['land', 'landcover', 'landuse'];
    map.getStyle().layers.forEach(layer => {
      try {
        if (fills.includes(layer['source-layer']) && layer.type === 'fill') {
          map.setPaintProperty(layer.id, 'fill-color', '#ece2d0');
        }
        if (layer.type === 'background') {
          map.setPaintProperty(layer.id, 'background-color', '#efe5d5');
        }
        if (layer.type === 'line' && /road|bridge|tunnel/.test(layer.id)) {
          map.setPaintProperty(layer.id, 'line-color', '#d7c0a0');
        }
        if (layer.type === 'fill' && /water/.test(layer.id)) {
          map.setPaintProperty(layer.id, 'fill-color', '#d9e6eb');
        }
      } catch (e) {}
    });
  }

  function setupMapData(data) {
    const map = state.map;
    if (map.getSource('routes')) return;

    map.addSource('routes', {
      type: 'geojson',
      data: routeCollection(state.people),
    });

    map.addSource('route-active', {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });

    map.addSource('route-playback', {
      type: 'geojson',
      data: emptyLine(),
    });

    map.addLayer({
      id: 'routes-base',
      type: 'line',
      source: 'routes',
      paint: {
        'line-color': '#a06c3c',
        'line-width': 3,
        'line-opacity': 0.34,
      },
    });

    map.addLayer({
      id: 'route-active-line',
      type: 'line',
      source: 'route-active',
      paint: {
        'line-color': '#8b5a30',
        'line-width': 4,
        'line-opacity': 0.92,
      },
    });

    map.addLayer({
      id: 'route-playback-line',
      type: 'line',
      source: 'route-playback',
      paint: {
        'line-color': '#d5a15d',
        'line-width': 4,
        'line-opacity': 0.96,
      },
    });

    addMarkers(state.people);
    fitAll();

    const playBtn = document.getElementById('playMigrationBtn');
    if (playBtn) playBtn.addEventListener('click', playMigration);
  }

  function routeCollection(people) {
    return {
      type: 'FeatureCollection',
      features: people.map(p => ({
        type: 'Feature',
        properties: { id: p.id, name: p.name },
        geometry: { type: 'LineString', coordinates: p.route },
      })),
    };
  }

  function emptyLine() {
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [] }, properties: {} }],
    };
  }

  function addMarkers(people) {
    state.markers.forEach(m => m.remove());
    state.markers = [];

    people.forEach(person => {
      const start = person.route[0];
      const end = person.route[person.route.length - 1];
      [
        { coords: start, klass: 'origin', label: `${person.name} · origin`, detail: person.origin_label },
        { coords: end, klass: 'settlement', label: `${person.name} · settlement`, detail: person.settlement_label },
      ].forEach(item => {
        const el = document.createElement('div');
        el.className = `lm-marker ${item.klass}`;
        const popup = new mapboxgl.Popup({ offset: 14, className: 'lm-popup' }).setHTML(
          `<h4>${person.name}</h4><p>${item.detail}</p>`
        );
        const marker = new mapboxgl.Marker({ element: el }).setLngLat(item.coords).setPopup(popup).addTo(state.map);
        state.markers.push(marker);
      });
    });
  }

  function fitAll() {
    const bounds = new mapboxgl.LngLatBounds();
    state.people.forEach(p => p.route.forEach(c => bounds.extend(c)));
    if (!bounds.isEmpty()) state.map.fitBounds(bounds, { padding: 40, duration: 0 });
  }

  function bindTreeClicks() {
    document.querySelectorAll('.person-card').forEach(card => {
      const name = card.querySelector('.person-name')?.textContent?.trim()?.toLowerCase();
      if (!name || !state.peopleByName.has(name)) return;
      card.style.cursor = 'pointer';
      card.addEventListener('click', () => activatePerson(state.peopleByName.get(name).id));
    });
  }

  function renderChips(people) {
    const wrap = document.getElementById('mapChips');
    if (!wrap) return;
    wrap.innerHTML = '';
    people.forEach(person => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'map-chip';
      btn.dataset.id = person.id;
      btn.textContent = person.name;
      btn.addEventListener('click', () => activatePerson(person.id));
      wrap.appendChild(btn);
    });
  }

  function activatePerson(id) {
    state.activeId = id;
    const person = state.people.find(p => p.id === id);
    if (!person) return;
    const source = state.map.getSource('route-active');
    if (source) {
      source.setData({
        type: 'FeatureCollection',
        features: [{ type: 'Feature', properties: { id }, geometry: { type: 'LineString', coordinates: person.route } }],
      });
    }
    document.querySelectorAll('.map-chip').forEach(chip => chip.classList.toggle('is-active', chip.dataset.id === id));
    const bounds = new mapboxgl.LngLatBounds();
    person.route.forEach(c => bounds.extend(c));
    state.map.fitBounds(bounds, { padding: 60, duration: 700, maxZoom: 4.5 });
  }

  function playMigration() {
    cancelAnimationFrame(state.animationFrame);
    const fullRoute = state.people.flatMap((person, index) => {
      const coords = person.route.slice();
      return index === 0 ? coords : coords.slice(1);
    });
    state.playbackCoords = fullRoute;
    state.progress = 2;
    stepPlayback();
  }

  function stepPlayback() {
    const source = state.map.getSource('route-playback');
    if (!source || !state.playbackCoords.length) return;
    const coords = state.playbackCoords.slice(0, state.progress);
    source.setData({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: coords }, properties: {} }],
    });
    state.progress += 1;
    if (state.progress <= state.playbackCoords.length) {
      state.animationFrame = requestAnimationFrame(stepPlayback);
    }
  }
})();
