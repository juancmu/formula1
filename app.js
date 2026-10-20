/**
 * F1 GRAND PRIX CIRCUITS & ROADS ATLAS - APP LOGIC
 * High-performance interactive map explorer for F1 GeoJSON tracks.
 */

(function () {
  'use strict';

  // State Management
  const state = {
    circuits: [],
    filteredCircuits: [],
    selectedCircuit: null,
    searchQuery: '',
    selectedRegion: 'all',
    selectedSort: 'name_asc',
    showAllTracksOnMap: false,
    currentTileLayer: 'satellite',
    simulation: {
      active: false,
      paused: false,
      animId: null,
      pointIndex: 0,
      subProgress: 0,
      lapTimeMs: 0,
      startTime: null,
      speedKmh: 240,
      chaseCam: true,
      carMarker: null
    }
  };

  // Map & Layer References
  let map = null;
  let baseLayers = {};
  let worldMarkersGroup = null;
  let activeTrackGroup = null;
  let allTracksLayerGroup = null;

  // DOM Elements
  const dom = {
    circuitsList: document.getElementById('circuitsList'),
    searchInput: document.getElementById('searchInput'),
    clearSearchBtn: document.getElementById('clearSearchBtn'),
    filterPills: document.querySelectorAll('.filter-pill'),
    sortSelect: document.getElementById('sortSelect'),
    sidebar: document.getElementById('sidebar'),
    sidebarToggleBtn: document.getElementById('sidebarToggleBtn'),
    totalCircuitsCount: document.getElementById('totalCircuitsCount'),
    totalDistanceKm: document.getElementById('totalDistanceKm'),
    totalCountriesCount: document.getElementById('totalCountriesCount'),
    worldOverviewBtn: document.getElementById('worldOverviewBtn'),
    // showAllTracksBtn: document.getElementById('showAllTracksBtn'),
    circuitHudCard: document.getElementById('circuitHudCard'),
    hudCountryTag: document.getElementById('hudCountryTag'),
    hudTitle: document.getElementById('hudTitle'),
    hudCloseBtn: document.getElementById('hudCloseBtn'),
    hudLengthKm: document.getElementById('hudLengthKm'),
    hudLengthMi: document.getElementById('hudLengthMi'),
    hudOpened: document.getElementById('hudOpened'),
    hudAltitude: document.getElementById('hudAltitude'),
    hudEstLapTime: document.getElementById('hudEstLapTime'),
    hudF1Years: document.getElementById('hudF1Years'),
    hudTotalGps: document.getElementById('hudTotalGps'),
    hudGpNameText: document.getElementById('hudGpNameText'),
    hudYearsChips: document.getElementById('hudYearsChips'),
    hudYearsChipsWrapper: document.getElementById('hudYearsChipsWrapper'),
    simStartBtn: document.getElementById('simStartBtn'),
    simStopBtn: document.getElementById('simStopBtn'),
    simStatusDot: document.getElementById('simStatusDot'),
    simStatusText: document.getElementById('simStatusText'),
    simTimer: document.getElementById('simTimer'),
    simProgressBar: document.getElementById('simProgressBar'),
    downloadGeoJsonBtn: document.getElementById('downloadGeoJsonBtn'),
    copyCoordsBtn: document.getElementById('copyCoordsBtn'),
    tileSatelliteBtn: document.getElementById('tileSatelliteBtn'),
    tileDarkBtn: document.getElementById('tileDarkBtn'),
    tileStreetsBtn: document.getElementById('tileStreetsBtn'),
    fileInput: document.getElementById('fileInput'),
    uploadBtn: document.getElementById('uploadBtn')
  };

  /**
   * Initialize Application
   */
  async function init() {
    loadCircuitsData();
    initMap();
    setupEventListeners();
    updateHeaderStats();
    applyFilterAndSort();
    renderCircuitsList();
    renderWorldMarkers();
  }

  /**
   * Load Circuits from circuits-data.js or fallback
   */
  function loadCircuitsData() {
    if (window.F1_CIRCUITS && Array.isArray(window.F1_CIRCUITS)) {
      state.circuits = window.F1_CIRCUITS;
      state.filteredCircuits = [...state.circuits];
    } else {
      console.warn('F1_CIRCUITS not loaded globally. Checking fallback...');
      state.circuits = [];
      state.filteredCircuits = [];
    }
  }

  /**
   * Initialize Leaflet Map
   */
  function initMap() {
    // Default world center view
    map = L.map('map', {
      center: [28.0, 15.0],
      zoom: 3,
      minZoom: 2,
      maxZoom: 19,
      zoomControl: false
    });

    // Custom Zoom Control placed top-left
    L.control.zoom({ position: 'topleft' }).addTo(map);

    // Tile Layers
    baseLayers.satellite = L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      {
        attribution: '&copy; Esri, Maxar, Earthstar Geographics',
        maxZoom: 19
      }
    );

    baseLayers.dark = L.tileLayer(
      'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
      {
        attribution: '&copy; <a href="https://carto.com/">CARTO</a> &copy; OpenStreetMap contributors',
        subdomains: 'abcd',
        maxZoom: 19
      }
    );

    baseLayers.streets = L.tileLayer(
      'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      {
        attribution: '&copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a> contributors',
        maxZoom: 19
      }
    );

    // Add default layer (Satellite is magnificent for F1 circuits)
    baseLayers.satellite.addTo(map);

    // Layer groups for vectors
    worldMarkersGroup = L.layerGroup().addTo(map);
    allTracksLayerGroup = L.layerGroup().addTo(map);
    activeTrackGroup = L.layerGroup().addTo(map);
  }

  /**
   * Switch Base Tile Layer
   */
  function setBaseTileLayer(layerKey) {
    if (layerKey === state.currentTileLayer) return;

    // Remove old layer
    if (baseLayers[state.currentTileLayer]) {
      map.removeLayer(baseLayers[state.currentTileLayer]);
    }

    // Add new layer
    if (baseLayers[layerKey]) {
      baseLayers[layerKey].addTo(map);
      state.currentTileLayer = layerKey;
    }

    // Update active button state
    [dom.tileSatelliteBtn, dom.tileDarkBtn, dom.tileStreetsBtn].forEach(btn => {
      if (btn) btn.classList.remove('active');
    });

    if (layerKey === 'satellite' && dom.tileSatelliteBtn) dom.tileSatelliteBtn.classList.add('active');
    if (layerKey === 'dark' && dom.tileDarkBtn) dom.tileDarkBtn.classList.add('active');
    if (layerKey === 'streets' && dom.tileStreetsBtn) dom.tileStreetsBtn.classList.add('active');
  }

  /**
   * Render SVG Thumbnail directly from LineString coordinates
   */
  function generateTrackSvg(coordinates, width = 68, height = 48, padding = 5) {
    if (!coordinates || coordinates.length < 2) {
      return `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><circle cx="${width/2}" cy="${height/2}" r="10" fill="#333"/></svg>`;
    }

    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;

    for (let i = 0; i < coordinates.length; i++) {
      const x = coordinates[i][0];
      const y = coordinates[i][1];
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    const rangeX = maxX - minX || 0.0001;
    const rangeY = maxY - minY || 0.0001;

    const innerW = width - padding * 2;
    const innerH = height - padding * 2;

    const scale = Math.min(innerW / rangeX, innerH / rangeY);
    const offsetX = padding + (innerW - rangeX * scale) / 2;
    const offsetY = padding + (innerH - rangeY * scale) / 2;

    let d = '';
    for (let i = 0; i < coordinates.length; i++) {
      const px = offsetX + (coordinates[i][0] - minX) * scale;
      // Invert Y so North is up
      const py = height - (offsetY + (coordinates[i][1] - minY) * scale);
      d += (i === 0 ? `M ${px.toFixed(1)} ${py.toFixed(1)}` : ` L ${px.toFixed(1)} ${py.toFixed(1)}`);
    }

    return `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
        <path d="${d}" fill="none" stroke="#00e5ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${offsetX + (coordinates[0][0] - minX) * scale}" cy="${height - (offsetY + (coordinates[0][1] - minY) * scale)}" r="2.5" fill="#e10600" />
      </svg>
    `;
  }

  /**
   * Update Header Stats Counters
   */
  function updateHeaderStats() {
    const totalCount = state.circuits.length;
    let totalLenM = 0;
    const countries = new Set();

    state.circuits.forEach(c => {
      totalLenM += (c.length || 0);
      if (c.country) countries.add(c.country);
    });

    const totalKm = Math.round(totalLenM / 1000);

    if (dom.totalCircuitsCount) dom.totalCircuitsCount.textContent = totalCount;
    if (dom.totalDistanceKm) dom.totalDistanceKm.textContent = `${totalKm} km`;
    if (dom.totalCountriesCount) dom.totalCountriesCount.textContent = countries.size;
  }

  /**
   * Filter and Sort Circuits
   */
  function applyFilterAndSort() {
    const query = state.searchQuery.toLowerCase().trim();
    const region = state.selectedRegion;

    state.filteredCircuits = state.circuits.filter(c => {
      // Search Match
      const matchesSearch = !query ||
        c.name.toLowerCase().includes(query) ||
        (c.location && c.location.toLowerCase().includes(query)) ||
        (c.country && c.country.toLowerCase().includes(query)) ||
        (c.opened && String(c.opened).includes(query)) ||
        (c.firstgp && String(c.firstgp).includes(query)) ||
        (c.f1Years && c.f1Years.toLowerCase().includes(query)) ||
        (c.grandPrix && c.grandPrix.toLowerCase().includes(query)) ||
        (Array.isArray(c.yearsList) && c.yearsList.some(y => String(y) === query || String(y).includes(query)));

      // Region Match
      let matchesRegion = true;
      if (region !== 'all') {
        matchesRegion = c.region && c.region.toLowerCase() === region.toLowerCase();
      }

      return matchesSearch && matchesRegion;
    });

    // Sorting
    switch (state.selectedSort) {
      case 'name_asc':
        state.filteredCircuits.sort((a, b) => a.name.localeCompare(b.name));
        break;
      case 'name_desc':
        state.filteredCircuits.sort((a, b) => b.name.localeCompare(a.name));
        break;
      case 'gps_desc':
        state.filteredCircuits.sort((a, b) => (b.totalGps || 0) - (a.totalGps || 0));
        break;
      case 'gps_asc':
        state.filteredCircuits.sort((a, b) => (a.totalGps || 0) - (b.totalGps || 0));
        break;
      case 'length_desc':
        state.filteredCircuits.sort((a, b) => (b.length || 0) - (a.length || 0));
        break;
      case 'length_asc':
        state.filteredCircuits.sort((a, b) => (a.length || 0) - (b.length || 0));
        break;
      case 'opened_desc':
        state.filteredCircuits.sort((a, b) => (b.opened || 0) - (a.opened || 0));
        break;
      case 'opened_asc':
        state.filteredCircuits.sort((a, b) => (a.opened || 0) - (b.opened || 0));
        break;
      case 'altitude_desc':
        state.filteredCircuits.sort((a, b) => (b.altitude || 0) - (a.altitude || 0));
        break;
      default:
        break;
    }
  }

  /**
   * Render Sidebar Circuit Cards
   */
  function renderCircuitsList() {
    if (!dom.circuitsList) return;

    if (state.filteredCircuits.length === 0) {
      dom.circuitsList.innerHTML = `
        <div class="empty-state">
          <i class="fa fa-flag-checkered"></i>
          <p>No F1 circuits match your search filters.</p>
        </div>
      `;
      return;
    }

    let html = '';
    state.filteredCircuits.forEach(c => {
      const isSelected = state.selectedCircuit && state.selectedCircuit.id === c.id;
      const km = (c.length / 1000).toFixed(2);
      const coords = c.geojson.features[0].geometry.coordinates;
      const svgThumb = generateTrackSvg(coords, 68, 50);

      html += `
        <div class="circuit-card ${isSelected ? 'active' : ''}" data-id="${c.id}">
          <div class="card-svg-thumb">
            ${svgThumb}
          </div>
          <div class="card-info">
            <div class="card-top-row">
              <span class="card-flag-location">
                <span class="card-flag">${c.flag || '🏁'}</span>
                <span>${c.location || c.country}</span>
              </span>
              <span class="card-year-badge">${c.totalGps !== undefined ? c.totalGps + ' GPs' : (c.opened ? c.opened : 'GP')}</span>
            </div>
            <div class="card-title" title="${c.name}">${c.name}</div>
            <div class="card-f1-years" title="${c.f1Years ? 'F1 Seasons: ' + c.f1Years : ''}">
              <i class="fa fa-flag-checkered"></i> <span>${c.f1Years || (c.firstgp ? 'GP ' + c.firstgp : 'F1 Track')}</span>
            </div>
            <div class="card-meta-row">
              <span class="card-meta-item">
                <i class="fa fa-road"></i>
                <strong>${km} km</strong>
              </span>
              <span class="card-meta-item">
                <i class="fa fa-trophy"></i>
                <span>${c.grandPrix ? c.grandPrix.split(',')[0].replace(' Grand Prix', ' GP') : (c.altitude ? c.altitude + ' m' : '—')}</span>
              </span>
            </div>
          </div>
        </div>
      `;
    });

    dom.circuitsList.innerHTML = html;

    // Attach click listeners to cards
    const cards = dom.circuitsList.querySelectorAll('.circuit-card');
    cards.forEach(card => {
      card.addEventListener('click', () => {
        const id = card.getAttribute('data-id');
        const circuit = state.circuits.find(c => c.id === id);
        if (circuit) {
          selectCircuit(circuit, true);
        }
      });
    });
  }

  /**
   * Render Global Markers on Map
   */
  function renderWorldMarkers() {
    worldMarkersGroup.clearLayers();

    state.circuits.forEach(c => {
      if (!c.center || c.center[0] === 0) return;

      const customIcon = L.divIcon({
        className: 'f1-circuit-marker',
        html: `
          <div class="f1-marker-pin ${state.selectedCircuit && state.selectedCircuit.id === c.id ? 'active' : ''}" title="${c.name}">
            <span>${c.flag || '🏁'}</span>
          </div>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16]
      });

      const marker = L.marker(c.center, { icon: customIcon });

      const km = (c.length / 1000).toFixed(2);
      const popupHtml = `
        <div class="popup-circuit-title">${c.name}</div>
        <div class="popup-circuit-loc">${c.flag || ''} ${c.location}, ${c.country}</div>
        <div class="popup-circuit-stats">
          <div>Length: <strong>${km} km</strong> (${(c.length * 0.000621371).toFixed(2)} mi)</div>
          <div>F1 Seasons: <strong style="color: #00e5ff;">${c.f1Years || 'N/A'}</strong> (${c.totalGps !== undefined ? c.totalGps : 0} GPs)</div>
          <div>Grand Prix: <strong>${c.grandPrix ? c.grandPrix.split(',')[0] : 'Formula 1'}</strong></div>
          <div>Inaugurated: <strong>${c.opened || 'N/A'}</strong> (1st GP: <strong>${c.firstgp || '—'}</strong>)</div>
        </div>
        <button class="popup-circuit-btn" onclick="window.F1_SELECT_CIRCUIT('${c.id}')">
          🏎️ Explore Track
        </button>
      `;

      marker.bindPopup(popupHtml, { minWidth: 220 });

      marker.on('click', () => {
        selectCircuit(c, false);
      });

      worldMarkersGroup.addLayer(marker);
    });
  }

  // Global helper for popup button click
  window.F1_SELECT_CIRCUIT = function (circuitId) {
    const circuit = state.circuits.find(c => c.id === circuitId);
    if (circuit) {
      selectCircuit(circuit, true);
      map.closePopup();
    }
  };

  /**
   * Select and Zoom into a Circuit
   */
  function selectCircuit(circuit, flyTo = true) {
    state.selectedCircuit = circuit;

    // Stop ongoing simulation if running
    stopSimulation();

    // Re-render card selection state in list
    const allCards = dom.circuitsList.querySelectorAll('.circuit-card');
    allCards.forEach(c => {
      if (c.getAttribute('data-id') === circuit.id) {
        c.classList.add('active');
        c.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } else {
        c.classList.remove('active');
      }
    });

    // Render active track vector on map
    renderActiveTrack(circuit, flyTo);

    // Update HUD
    updateCircuitHud(circuit);

    // Close mobile sidebar if open
    if (window.innerWidth <= 768 && dom.sidebar) {
      dom.sidebar.classList.add('collapsed');
    }
  }

  /**
   * Render the active track geometry on the map
   */
  function renderActiveTrack(circuit, flyTo = true) {
    activeTrackGroup.clearLayers();

    const feat = circuit.geojson.features[0];
    const coords = feat.geometry.coordinates; // [ [lon, lat], ... ]
    const latLngs = coords.map(pt => [pt[1], pt[0]]);

    // 1. Asphalt casing / outer track edge
    const roadCasing = L.polyline(latLngs, {
      color: '#080c14',
      weight: 12,
      opacity: 0.9,
      lineCap: 'round',
      lineJoin: 'round'
    });

    // 2. Neon / F1 Racing Line
    const racingLine = L.polyline(latLngs, {
      color: '#e10600',
      weight: 5,
      opacity: 1,
      lineCap: 'round',
      lineJoin: 'round'
    });

    // 3. Inner neon glow centerline
    const innerGlow = L.polyline(latLngs, {
      color: '#ffffff',
      weight: 1.5,
      opacity: 0.8,
      dashArray: '8, 8'
    });

    activeTrackGroup.addLayer(roadCasing);
    activeTrackGroup.addLayer(racingLine);
    activeTrackGroup.addLayer(innerGlow);

    // 4. Start / Finish Line Banner Marker
    const startPoint = latLngs[0];
    const gridIcon = L.divIcon({
      className: 'grid-marker-wrap',
      html: `<div class="grid-marker">🏁 START / FINISH</div>`,
      iconSize: [120, 24],
      iconAnchor: [60, 26]
    });
    const gridMarker = L.marker(startPoint, { icon: gridIcon });
    activeTrackGroup.addLayer(gridMarker);

    // 5. Bounding Box & Camera Zoom
    const bbox = circuit.bbox; // [minLon, minLat, maxLon, maxLat]
    if (bbox && flyTo) {
      const bounds = L.latLngBounds([
        [bbox[1], bbox[0]],
        [bbox[3], bbox[2]]
      ]);
      map.flyToBounds(bounds, {
        padding: [80, 80],
        maxZoom: 16,
        duration: 1.6
      });
    }
  }

  /**
   * Update the Circuit HUD (Bottom Right Floating Card)
   */
  function updateCircuitHud(circuit) {
    if (!circuit || !dom.circuitHudCard) return;

    const km = (circuit.length / 1000).toFixed(3);
    const miles = (circuit.length * 0.000621371).toFixed(2);

    // Calculate approximate Pole Lap Time at 230 km/h average
    const avgSpeedMs = (230 * 1000) / 3600;
    const estSeconds = circuit.length / avgSpeedMs;
    const estMin = Math.floor(estSeconds / 60);
    const estSec = (estSeconds % 60).toFixed(3);
    const lapTimeStr = `${estMin}:${estSec.padStart(6, '0')}`;

    dom.hudCountryTag.innerHTML = `<span>${circuit.flag || '🏁'}</span> <span>${circuit.location || ''}, ${circuit.country || ''}</span>`;
    dom.hudTitle.textContent = circuit.name;
    dom.hudLengthKm.textContent = `${km} km`;
    dom.hudLengthMi.textContent = `${miles} mi`;
    dom.hudOpened.textContent = circuit.opened ? `${circuit.opened} (GP ${circuit.firstgp || '—'})` : 'Historic';
    dom.hudAltitude.textContent = circuit.altitude ? `${circuit.altitude} m` : 'Sea Level';
    dom.hudEstLapTime.textContent = `~${lapTimeStr}`;

    // F1 Grand Prix Years & History
    if (dom.hudF1Years) {
      dom.hudF1Years.textContent = circuit.f1Years || (circuit.firstgp ? `Since ${circuit.firstgp}` : 'N/A');
    }
    if (dom.hudTotalGps) {
      dom.hudTotalGps.textContent = circuit.totalGps !== undefined ? `${circuit.totalGps} GP${circuit.totalGps === 1 ? '' : 's'}` : 'F1 GP';
    }
    if (dom.hudGpNameText) {
      dom.hudGpNameText.textContent = circuit.grandPrix || 'Formula 1 Grand Prix';
    }

    // Render Year Chips
    if (dom.hudYearsChips) {
      const years = Array.isArray(circuit.yearsList) ? circuit.yearsList : [];
      if (years.length > 0) {
        if (dom.hudYearsChipsWrapper) dom.hudYearsChipsWrapper.style.display = 'block';

        if (years.length <= 14) {
          // Direct chips display
          dom.hudYearsChips.innerHTML = years.map(y => `<span class="f1-year-chip" title="F1 Season ${y}">${y}</span>`).join('');
        } else {
          // Compact with toggle button for circuits with 15+ seasons
          const chipsHtml = years.map(y => `<span class="f1-year-chip" title="F1 Season ${y}">${y}</span>`).join('');
          dom.hudYearsChips.innerHTML = `
            <div id="chipsListInner" style="display: none; flex-wrap: wrap; gap: 4px; width: 100%; margin-bottom: 6px;">
              ${chipsHtml}
            </div>
            <button class="hud-years-toggle-btn" id="toggleYearsListBtn" type="button">
              <i class="fa fa-chevron-down"></i> View all ${years.length} individual years
            </button>
          `;
          const toggleBtn = dom.hudYearsChips.querySelector('#toggleYearsListBtn');
          const innerList = dom.hudYearsChips.querySelector('#chipsListInner');
          if (toggleBtn && innerList) {
            toggleBtn.onclick = (e) => {
              e.stopPropagation();
              const isHidden = innerList.style.display === 'none';
              innerList.style.display = isHidden ? 'flex' : 'none';
              toggleBtn.innerHTML = isHidden ?
                `<i class="fa fa-chevron-up"></i> Hide year list` :
                `<i class="fa fa-chevron-down"></i> View all ${years.length} individual years`;
            };
          }
        }
      } else {
        if (dom.hudYearsChipsWrapper) dom.hudYearsChipsWrapper.style.display = 'none';
        dom.hudYearsChips.innerHTML = '';
      }
    }

    // Reset Sim HUD UI
    dom.simProgressBar.style.width = '0%';
    dom.simTimer.textContent = '00:00.000';
    dom.simStatusDot.className = 'sim-indicator-dot';
    dom.simStatusText.textContent = 'Ready';
    dom.simStartBtn.innerHTML = '<i class="fa fa-play"></i> Simulate Lap';

    // Download GeoJSON button
    dom.downloadGeoJsonBtn.onclick = () => {
      downloadGeoJsonFile(circuit);
    };

    // Copy coords button
    dom.copyCoordsBtn.onclick = () => {
      const coordsText = JSON.stringify(circuit.geojson.features[0].geometry.coordinates);
      navigator.clipboard.writeText(coordsText).then(() => {
        alert(`Copied ${circuit.name} coordinates to clipboard!`);
      });
    };

    dom.circuitHudCard.classList.add('visible');
  }

  /**
   * Download GeoJSON file
   */
  function downloadGeoJsonFile(circuit) {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(circuit.geojson, null, 2));
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href", dataStr);
    downloadAnchor.setAttribute("download", `${circuit.filename || circuit.id + '.geojson'}`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  }

  /**
   * Toggle World Overview
   */
  function zoomToWorldOverview() {
    state.selectedCircuit = null;
    activeTrackGroup.clearLayers();
    stopSimulation();

    if (dom.circuitHudCard) {
      dom.circuitHudCard.classList.remove('visible');
    }

    const allCards = dom.circuitsList.querySelectorAll('.circuit-card');
    allCards.forEach(c => c.classList.remove('active'));

    map.flyTo([28.0, 15.0], 3, { duration: 1.5 });
  }

  /**
   * Toggle Rendering All 40 Tracks on Map
   */
  function toggleShowAllTracks() {
    state.showAllTracksOnMap = !state.showAllTracksOnMap;

    if (dom.showAllTracksBtn) {
      dom.showAllTracksBtn.classList.toggle('active', state.showAllTracksOnMap);
    }

    if (!state.showAllTracksOnMap) {
      allTracksLayerGroup.clearLayers();
      return;
    }

    allTracksLayerGroup.clearLayers();

    state.circuits.forEach(c => {
      const feat = c.geojson.features[0];
      const coords = feat.geometry.coordinates;
      const latLngs = coords.map(pt => [pt[1], pt[0]]);

      const polyline = L.polyline(latLngs, {
        color: '#ff2a44',
        weight: 3.5,
        opacity: 0.95
      });

      polyline.bindTooltip(`<b>${c.name}</b><br>${(c.length/1000).toFixed(2)} km`, {
        permanent: false,
        sticky: true
      });

      polyline.on('click', () => {
        selectCircuit(c, true);
      });

      allTracksLayerGroup.addLayer(polyline);
    });
  }

  /**
   * Lap Simulation (F1 Car Animation on GeoJSON Track)
   */
  function toggleLapSimulation() {
    if (!state.selectedCircuit) return;

    if (state.simulation.active) {
      stopSimulation();
    } else {
      startSimulation();
    }
  }

  function startSimulation() {
    const circuit = state.selectedCircuit;
    if (!circuit) return;

    const coords = circuit.geojson.features[0].geometry.coordinates;
    const latLngs = coords.map(pt => [pt[1], pt[0]]);

    if (latLngs.length < 2) return;

    state.simulation.active = true;
    state.simulation.paused = false;
    state.simulation.pointIndex = 0;
    state.simulation.subProgress = 0;
    state.simulation.startTime = performance.now();

    dom.simStatusDot.className = 'sim-indicator-dot running';
    dom.simStatusText.textContent = 'Racing...';
    dom.simStartBtn.innerHTML = '<i class="fa fa-pause"></i> Pause Lap';

    // Create or reset car marker
    if (state.simulation.carMarker) {
      activeTrackGroup.removeLayer(state.simulation.carMarker);
    }

    const carIcon = L.divIcon({
      className: 'f1-car-icon-wrap',
      html: `<div class="racing-car-marker" id="simCarMarker">🏎️</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14]
    });

    state.simulation.carMarker = L.marker(latLngs[0], { icon: carIcon, zIndexOffset: 1000 });
    activeTrackGroup.addLayer(state.simulation.carMarker);

    runSimulationLoop();
  }

  function runSimulationLoop() {
    if (!state.simulation.active) return;

    const circuit = state.selectedCircuit;
    const coords = circuit.geojson.features[0].geometry.coordinates;
    const latLngs = coords.map(pt => [pt[1], pt[0]]);
    const totalPoints = latLngs.length;

    const sim = state.simulation;
    const speedFactor = 0.045; // Speed multiplier for smooth traversal

    sim.subProgress += speedFactor;

    if (sim.subProgress >= 1.0) {
      sim.subProgress = 0;
      sim.pointIndex++;

      if (sim.pointIndex >= totalPoints - 1) {
        // Lap Completed!
        finishSimulation();
        return;
      }
    }

    // Interpolate position between current point and next point
    const p1 = latLngs[sim.pointIndex];
    const p2 = latLngs[sim.pointIndex + 1];

    const currentLat = p1[0] + (p2[0] - p1[0]) * sim.subProgress;
    const currentLng = p1[1] + (p2[1] - p1[1]) * sim.subProgress;
    const currentPos = [currentLat, currentLng];

    // Update car position
    if (sim.carMarker) {
      sim.carMarker.setLatLng(currentPos);
    }

    // Update Timer & Progress
    const elapsedMs = performance.now() - sim.startTime;
    const minutes = Math.floor(elapsedMs / 60000);
    const seconds = Math.floor((elapsedMs % 60000) / 1000);
    const ms = Math.floor(elapsedMs % 1000);
    dom.simTimer.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(ms).padStart(3, '0')}`;

    const totalProgress = ((sim.pointIndex + sim.subProgress) / totalPoints) * 100;
    dom.simProgressBar.style.width = `${Math.min(100, totalProgress)}%`;

    // Chase Cam: smooth pan if enabled
    if (sim.chaseCam && sim.pointIndex % 8 === 0 && sim.subProgress < speedFactor * 1.5) {
      map.panTo(currentPos, { animate: true, duration: 0.3 });
    }

    sim.animId = requestAnimationFrame(runSimulationLoop);
  }

  function stopSimulation() {
    state.simulation.active = false;
    if (state.simulation.animId) {
      cancelAnimationFrame(state.simulation.animId);
      state.simulation.animId = null;
    }

    if (state.simulation.carMarker) {
      activeTrackGroup.removeLayer(state.simulation.carMarker);
      state.simulation.carMarker = null;
    }

    if (dom.simStatusDot) dom.simStatusDot.className = 'sim-indicator-dot';
    if (dom.simStatusText) dom.simStatusText.textContent = 'Stopped';
    if (dom.simStartBtn) dom.simStartBtn.innerHTML = '<i class="fa fa-play"></i> Simulate Lap';
  }

  function finishSimulation() {
    stopSimulation();
    dom.simStatusDot.className = 'sim-indicator-dot';
    dom.simStatusText.textContent = '🏁 Lap Finished!';
    dom.simProgressBar.style.width = '100%';
  }

  /**
   * Handle Custom GeoJSON File Upload
   */
  function handleCustomGeoJson(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
      try {
        const geojson = JSON.parse(e.target.result);
        const feat = geojson.features ? geojson.features[0] : geojson;
        if (!feat || !feat.geometry || !feat.geometry.coordinates) {
          alert('Invalid GeoJSON format. Feature with LineString geometry required.');
          return;
        }

        const customCircuit = {
          filename: file.name,
          id: 'custom-' + Date.now(),
          name: (feat.properties && (feat.properties.Name || feat.properties.name)) || file.name.replace('.geojson', ''),
          location: (feat.properties && (feat.properties.Location || feat.properties.location)) || 'Custom Track',
          country: 'User Track',
          flag: '🏁',
          region: 'Other',
          opened: (feat.properties && feat.properties.opened) || new Date().getFullYear(),
          length: (feat.properties && feat.properties.length) || 5000,
          altitude: (feat.properties && feat.properties.altitude) || 0,
          bbox: geojson.bbox || feat.bbox,
          geojson: geojson
        };

        state.circuits.unshift(customCircuit);
        applyFilterAndSort();
        renderCircuitsList();
        renderWorldMarkers();
        selectCircuit(customCircuit, true);
        alert(`Successfully imported: ${customCircuit.name}!`);
      } catch (err) {
        alert('Error parsing GeoJSON: ' + err.message);
      }
    };
    reader.readAsText(file);
  }

  /**
   * Setup Event Listeners
   */
  function setupEventListeners() {
    // Search input
    dom.searchInput.addEventListener('input', (e) => {
      state.searchQuery = e.target.value;
      dom.clearSearchBtn.style.display = state.searchQuery ? 'block' : 'none';
      applyFilterAndSort();
      renderCircuitsList();
    });

    // Clear search
    dom.clearSearchBtn.addEventListener('click', () => {
      dom.searchInput.value = '';
      state.searchQuery = '';
      dom.clearSearchBtn.style.display = 'none';
      applyFilterAndSort();
      renderCircuitsList();
    });

    // Region filter pills
    dom.filterPills.forEach(pill => {
      pill.addEventListener('click', () => {
        dom.filterPills.forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        state.selectedRegion = pill.getAttribute('data-region');
        applyFilterAndSort();
        renderCircuitsList();
      });
    });

    // Sort select
    dom.sortSelect.addEventListener('change', (e) => {
      state.selectedSort = e.target.value;
      applyFilterAndSort();
      renderCircuitsList();
    });

    // World overview button
    dom.worldOverviewBtn.addEventListener('click', zoomToWorldOverview);

    // Show all tracks button
    // dom.showAllTracksBtn.addEventListener('click', toggleShowAllTracks);

    // Base Tile Switchers
    if (dom.tileSatelliteBtn) {
      dom.tileSatelliteBtn.addEventListener('click', () => setBaseTileLayer('satellite'));
    }
    if (dom.tileDarkBtn) {
      dom.tileDarkBtn.addEventListener('click', () => setBaseTileLayer('dark'));
    }
    if (dom.tileStreetsBtn) {
      dom.tileStreetsBtn.addEventListener('click', () => setBaseTileLayer('streets'));
    }

    // HUD Close Button
    dom.hudCloseBtn.addEventListener('click', () => {
      dom.circuitHudCard.classList.remove('visible');
      stopSimulation();
      activeTrackGroup.clearLayers();
      state.selectedCircuit = null;
      const allCards = dom.circuitsList.querySelectorAll('.circuit-card');
      allCards.forEach(c => c.classList.remove('active'));
    });

    // Sim Start / Stop
    dom.simStartBtn.addEventListener('click', toggleLapSimulation);
    dom.simStopBtn.addEventListener('click', stopSimulation);

    // Sidebar Mobile Toggle
    if (dom.sidebarToggleBtn) {
      dom.sidebarToggleBtn.addEventListener('click', () => {
        dom.sidebar.classList.toggle('collapsed');
      });
    }

    // Custom File Upload
    if (dom.uploadBtn && dom.fileInput) {
      dom.uploadBtn.addEventListener('click', () => dom.fileInput.click());
      dom.fileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          handleCustomGeoJson(e.target.files[0]);
        }
      });
    }

    // Window Resize
    window.addEventListener('resize', () => {
      if (map) map.invalidateSize();
    });
  }

  // Run on DOM Ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
