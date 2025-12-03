class ModernMapApp {
  constructor() {
    this.map = null;
    this.markers = [];
    this.markerCluster = null;
    this.routingControl = null;
    this.measureControl = null;
    this.currentMode = null;
    this.history = [];
    this.historyIndex = -1;
    
    // Modules
    this.ui = new UIManager(this);
    this.geocoder = new Geocoder();
    this.storage = new StorageManager();
    this.router = new RoutingManager(this);
    this.measure = new MeasurementManager(this);
    
    this.init();
  }
  
  async init() {
    try {
      await this.initMap();
      this.initModules();
      this.loadInitialData();
      this.bindEvents();
      this.ui.showToast('Map loaded successfully', 'success');
    } catch (error) {
      console.error('Failed to initialize map:', error);
      this.ui.showToast('Failed to load map', 'error');
    }
  }
  
  async initMap() {
    // Initialize map with modern settings
    this.map = L.map('map', {
      attributionControl: false,
      zoomControl: false,
      preferCanvas: true,
      maxZoom: 20,
      minZoom: 2
    }).setView([14.5995, 120.9842], 5);
    
    // Define tile layers
    this.tileLayers = {
      street: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '',
        maxZoom: 19
      }),
      satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: '',
        maxZoom: 19
      }),
      dark: L.tileLayer('https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png', {
        attribution: '',
        maxZoom: 20
      }),
      topographic: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '',
        maxZoom: 17
      })
    };
    
    // Add default layer
    this.tileLayers.street.addTo(this.map);
    this.currentTileLayer = 'street';
    
    // Initialize marker cluster
    this.markerCluster = L.markerClusterGroup({
      showCoverageOnHover: false,
      zoomToBoundsOnClick: true,
      chunkedLoading: true,
      iconCreateFunction: this.createClusterIcon.bind(this)
    }).addTo(this.map);
    
    // Add scale control
    L.control.scale({ imperial: false }).addTo(this.map);
    
    // Initialize coordinates display
    this.map.on('mousemove', this.handleMapMove.bind(this));
  }
  
  initModules() {
    // Initialize all modules
    this.ui.init();
    this.router.init();
    this.measure.init();
    
    // Load saved markers
    const savedMarkers = this.storage.loadMarkers();
    if (savedMarkers.length > 0) {
      savedMarkers.forEach(marker => this.addMarker(marker, false));
    } else {
      this.addDefaultMarkers();
    }
  }
  
  loadInitialData() {
    // Load any initial data needed
    this.ui.updateStats(this.markers.length);
  }
  
  bindEvents() {
    // Map events
    this.map.on('click', this.handleMapClick.bind(this));
    this.map.on('zoomend', this.handleZoomChange.bind(this));
    
    // Global keyboard shortcuts
    document.addEventListener('keydown', this.handleKeydown.bind(this));
    
    // Add history tracking for undo/redo
    this.saveToHistory();
  }
  
  // Marker Management
  addMarker(data, saveToStorage = true) {
    const marker = this.createMarker(data);
    
    const markerData = {
      id: Date.now() + Math.random(),
      ...data,
      marker: marker
    };
    
    this.markers.push(markerData);
    this.markerCluster.addLayer(marker);
    this.ui.addToSidebar(markerData);
    
    if (saveToStorage) {
      this.storage.saveMarkers(this.markers);
      this.saveToHistory();
    }
    
    this.ui.updateStats(this.markers.length);
    return markerData.id;
  }
  
  createMarker(data) {
    const icon = this.createMarkerIcon(data.icon || '📍');
    const marker = L.marker([data.lat, data.lng], { icon });
    
    const popupContent = this.ui.createPopupContent(data);
    marker.bindPopup(popupContent);
    
    // Add events
    marker.on('popupopen', () => {
      this.bindPopupEvents(data.id);
    });
    
    return marker;
  }
  
  createMarkerIcon(emoji) {
    return L.divIcon({
      html: `
        <div class="custom-marker">
          <div class="marker-icon">${emoji}</div>
          <div class="marker-pulse"></div>
        </div>
      `,
      className: 'custom-marker-icon',
      iconSize: [40, 40],
      iconAnchor: [20, 40]
    });
  }
  
  createClusterIcon(cluster) {
    const count = cluster.getChildCount();
    let sizeClass = 'small';
    let fontSize = '12px';
    
    if (count > 10 && count <= 50) {
      sizeClass = 'medium';
      fontSize = '14px';
    } else if (count > 50) {
      sizeClass = 'large';
      fontSize = '16px';
    }
    
    return L.divIcon({
      html: `<div class="marker-cluster ${sizeClass}">${count}</div>`,
      className: 'marker-cluster-custom',
      iconSize: L.point(40, 40)
    });
  }
  
  removeMarker(id) {
    const index = this.markers.findIndex(m => m.id === id);
    if (index === -1) return;
    
    const marker = this.markers[index];
    this.markerCluster.removeLayer(marker.marker);
    this.markers.splice(index, 1);
    this.ui.removeFromSidebar(id);
    
    this.storage.saveMarkers(this.markers);
    this.saveToHistory();
    this.ui.updateStats(this.markers.length);
    this.ui.showToast('Marker removed', 'info');
  }
  
  updateMarker(id, updates) {
    const marker = this.markers.find(m => m.id === id);
    if (!marker) return;
    
    Object.assign(marker, updates);
    
    // Update marker on map
    this.markerCluster.removeLayer(marker.marker);
    const newMarker = this.createMarker(marker);
    marker.marker = newMarker;
    this.markerCluster.addLayer(newMarker);
    
    // Update sidebar
    this.ui.updateSidebarItem(marker);
    
    this.storage.saveMarkers(this.markers);
    this.saveToHistory();
    this.ui.showToast('Marker updated', 'success');
  }
  
  // Map Controls
  changeTileLayer(layerName) {
    if (this.tileLayers[layerName] && this.currentTileLayer !== layerName) {
      this.map.removeLayer(this.tileLayers[this.currentTileLayer]);
      this.tileLayers[layerName].addTo(this.map);
      this.currentTileLayer = layerName;
      this.ui.updateLayerControl(layerName);
    }
  }
  
  zoomToLocation(lat, lng, zoom = 13) {
    this.map.setView([lat, lng], zoom);
  }
  
  fitBounds(bounds) {
    this.map.fitBounds(bounds, { padding: [50, 50] });
  }
  
  // Event Handlers
  handleMapClick(e) {
    switch (this.currentMode) {
      case 'addMarker':
        this.ui.openAddMarkerModal(e.latlng);
        break;
      case 'measure':
        this.measure.handleClick(e);
        break;
    }
  }
  
  handleMapMove(e) {
    this.ui.updateCoordinates(e.latlng);
  }
  
  handleZoomChange() {
    this.ui.updateZoomLevel(this.map.getZoom());
  }
  
  handleKeydown(e) {
    // Global keyboard shortcuts
    switch (e.key) {
      case 'Escape':
        this.setMode(null);
        break;
      case 'z':
        if (e.ctrlKey) this.undo();
        break;
      case 'y':
        if (e.ctrlKey) this.redo();
        break;
      case '+':
        if (e.ctrlKey) this.map.zoomIn();
        break;
      case '-':
        if (e.ctrlKey) this.map.zoomOut();
        break;
    }
  }
  
  // Mode Management
  setMode(mode) {
    this.currentMode = mode;
    this.ui.updateModeIndicator(mode);
    
    if (mode === 'measure') {
      this.measure.activate();
    } else {
      this.measure.deactivate();
    }
  }
  
  // History Management (Undo/Redo)
  saveToHistory() {
    const state = {
      markers: this.markers.map(m => ({
        lat: m.lat,
        lng: m.lng,
        title: m.title,
        description: m.description,
        icon: m.icon
      }))
    };
    
    // Remove future states if we're not at the end
    if (this.historyIndex < this.history.length - 1) {
      this.history = this.history.slice(0, this.historyIndex + 1);
    }
    
    this.history.push(JSON.stringify(state));
    this.historyIndex++;
    
    // Limit history size
    if (this.history.length > 50) {
      this.history.shift();
      this.historyIndex--;
    }
    
    this.ui.updateUndoRedoButtons(this.historyIndex, this.history.length);
  }
  
  undo() {
    if (this.historyIndex <= 0) return;
    
    this.historyIndex--;
    this.loadState(this.history[this.historyIndex]);
    this.ui.showToast('Undo performed', 'info');
  }
  
  redo() {
    if (this.historyIndex >= this.history.length - 1) return;
    
    this.historyIndex++;
    this.loadState(this.history[this.historyIndex]);
    this.ui.showToast('Redo performed', 'info');
  }
  
  loadState(stateStr) {
    const state = JSON.parse(stateStr);
    
    // Clear current markers
    this.markerCluster.clearLayers();
    this.markers = [];
    this.ui.clearSidebar();
    
    // Add markers from state
    state.markers.forEach(markerData => {
      this.addMarker(markerData, false);
    });
    
    this.storage.saveMarkers(this.markers);
    this.ui.updateStats(this.markers.length);
  }
  
  // Import/Export
  exportMarkers(format = 'json') {
    const data = this.markers.map(marker => ({
      lat: marker.lat,
      lng: marker.lng,
      title: marker.title,
      description: marker.description,
      icon: marker.icon,
      createdAt: marker.createdAt
    }));
    
    switch (format) {
      case 'json':
        this.exportJSON(data);
        break;
      case 'csv':
        this.exportCSV(data);
        break;
      case 'kml':
        this.exportKML(data);
        break;
    }
  }
  
  exportJSON(data) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    this.ui.downloadFile(url, 'markers.json');
    this.ui.showToast('Markers exported as JSON', 'success');
  }
  
  exportCSV(data) {
    const headers = ['Latitude', 'Longitude', 'Title', 'Description', 'Icon'];
    const rows = data.map(marker => [
      marker.lat,
      marker.lng,
      `"${marker.title.replace(/"/g, '""')}"`,
      `"${(marker.description || '').replace(/"/g, '""')}"`,
      marker.icon
    ]);
    
    const csv = [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    this.ui.downloadFile(url, 'markers.csv');
    this.ui.showToast('Markers exported as CSV', 'success');
  }
  
  exportKML(data) {
    const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>GeoExplorer Markers</name>
    ${data.map(marker => `
    <Placemark>
      <name>${this.escapeXML(marker.title)}</name>
      <description>${this.escapeXML(marker.description || '')}</description>
      <Point>
        <coordinates>${marker.lng},${marker.lat},0</coordinates>
      </Point>
    </Placemark>
    `).join('')}
  </Document>
</kml>`;
    
    const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
    const url = URL.createObjectURL(blob);
    this.ui.downloadFile(url, 'markers.kml');
    this.ui.showToast('Markers exported as KML', 'success');
  }
  
  async importMarkers(file) {
    try {
      const text = await file.text();
      let markers;
      
      if (file.name.endsWith('.json')) {
        markers = JSON.parse(text);
      } else if (file.name.endsWith('.csv')) {
        markers = this.parseCSV(text);
      } else if (file.name.endsWith('.kml')) {
        markers = await this.parseKML(text);
      } else {
        throw new Error('Unsupported file format');
      }
      
      markers.forEach(marker => {
        this.addMarker({
          lat: parseFloat(marker.lat),
          lng: parseFloat(marker.lng),
          title: marker.title,
          description: marker.description,
          icon: marker.icon || '📍'
        });
      });
      
      this.ui.showToast(`Imported ${markers.length} markers`, 'success');
    } catch (error) {
      this.ui.showToast(`Import failed: ${error.message}`, 'error');
    }
  }
  
  // Helper Methods
  addDefaultMarkers() {
    const defaultMarkers = [
      [48.8584, 2.2945, "Eiffel Tower", "Paris, France", "🗼"],
      [40.6892, -74.0445, "Statue of Liberty", "New York, USA", "🗽"],
      [51.5007, -0.1246, "Big Ben", "London, UK", "🕰️"],
      [35.6895, 139.6917, "Tokyo Tower", "Tokyo, Japan", "🗼"],
      [-33.8568, 151.2153, "Sydney Opera House", "Sydney, Australia", "🎭"]
    ];
    
    defaultMarkers.forEach(([lat, lng, title, desc, icon]) => {
      this.addMarker({ lat, lng, title, description: desc, icon });
    });
  }
  
  escapeXML(str) {
    return (str || '').replace(/[<>&'"]/g, char => ({
      '<': '&lt;',
      '>': '&gt;',
      '&': '&amp;',
      "'": '&apos;',
      '"': '&quot;'
    })[char]);
  }
  
  bindPopupEvents(markerId) {
    // This will be called when popup opens
    // Bind events to popup buttons
    setTimeout(() => {
      document.querySelectorAll('.popup-btn').forEach(btn => {
        const action = btn.dataset.action;
        const id = btn.dataset.markerId;
        
        if (id !== markerId.toString()) return;
        
        btn.addEventListener('click', () => {
          switch (action) {
            case 'zoom':
              this.zoomToMarker(id);
              break;
            case 'edit':
              this.ui.openEditMarkerModal(id);
              break;
            case 'delete':
              this.removeMarker(id);
              break;
            case 'route-from':
              this.router.setStartPoint(id);
              break;
            case 'route-to':
              this.router.setEndPoint(id);
              break;
          }
        });
      });
    }, 100);
  }
  
  zoomToMarker(id) {
    const marker = this.markers.find(m => m.id === id);
    if (marker) {
      this.zoomToLocation(marker.lat, marker.lng, 15);
      marker.marker.openPopup();
    }
  }
}

// UI Manager Module
class UIManager {
  constructor(app) {
    this.app = app;
    this.elements = {};
  }
  
  init() {
    this.cacheElements();
    this.bindEvents();
    this.initSidebar();
    this.initToastContainer();
  }
  
  cacheElements() {
    // Cache all DOM elements for better performance
    this.elements = {
      map: document.getElementById('map'),
      sidebar: document.querySelector('.sidebar'),
      sidebarToggle: document.querySelector('.sidebar-toggle'),
      searchInput: document.getElementById('search-input'),
      searchBtn: document.getElementById('search-btn'),
      locationsList: document.getElementById('locations-list'),
      markerCount: document.getElementById('marker-count'),
      latDisplay: document.getElementById('lat-display'),
      lngDisplay: document.getElementById('lng-display'),
      zoomIn: document.getElementById('zoom-in'),
      zoomOut: document.getElementById('zoom-out'),
      btnLocation: document.getElementById('btn-location'),
      btnAddMarker: document.getElementById('btn-add-marker'),
      btnRoute: document.getElementById('btn-route'),
      btnMeasure: document.getElementById('btn-measure'),
      btnExport: document.getElementById('btn-export'),
      btnClear: document.getElementById('btn-clear'),
      btnFullscreen: document.getElementById('btn-fullscreen'),
      btnUndo: document.getElementById('btn-undo'),
      btnRedo: document.getElementById('btn-redo'),
      btnImport: document.getElementById('btn-import'),
      styleOptions: document.querySelectorAll('.style-option'),
      modal: document.getElementById('marker-modal'),
      modalClose: document.querySelector('.modal-close'),
      markerForm: document.getElementById('marker-form'),
      cancelMarker: document.getElementById('cancel-marker')
    };
  }
  
  bindEvents() {
    // Bind all UI events
    this.elements.sidebarToggle?.addEventListener('click', () => {
      this.toggleSidebar();
    });
    
    this.elements.searchBtn.addEventListener('click', () => this.handleSearch());
    this.elements.searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.handleSearch();
    });
    
    this.elements.btnLocation.addEventListener('click', () => this.findUserLocation());
    this.elements.btnAddMarker.addEventListener('click', () => this.enableAddMode());
    this.elements.btnRoute.addEventListener('click', () => this.app.router.toggle());
    this.elements.btnMeasure.addEventListener('click', () => this.app.setMode('measure'));
    this.elements.btnExport.addEventListener('click', () => this.showExportMenu());
    this.elements.btnClear.addEventListener('click', () => this.clearAllMarkers());
    this.elements.btnFullscreen.addEventListener('click', () => this.toggleFullscreen());
    this.elements.btnUndo?.addEventListener('click', () => this.app.undo());
    this.elements.btnRedo?.addEventListener('click', () => this.app.redo());
    this.elements.btnImport?.addEventListener('click', () => this.showImportDialog());
    
    this.elements.zoomIn.addEventListener('click', () => this.app.map.zoomIn());
    this.elements.zoomOut.addEventListener('click', () => this.app.map.zoomOut());
    
    this.elements.styleOptions.forEach(option => {
      option.addEventListener('click', (e) => {
        const style = e.currentTarget.dataset.style;
        this.app.changeTileLayer(style);
        this.updateActiveStyle(style);
      });
    });
    
    // Modal events
    this.elements.modalClose.addEventListener('click', () => this.closeModal());
    this.elements.cancelMarker.addEventListener('click', () => this.closeModal());
    this.elements.markerForm.addEventListener('submit', (e) => this.handleMarkerFormSubmit(e));
    
    // Close modal on outside click
    this.elements.modal.addEventListener('click', (e) => {
      if (e.target === this.elements.modal) {
        this.closeModal();
      }
    });
    
    // File import
    const fileInput = document.getElementById('file-import');
    if (fileInput) {
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length > 0) {
          this.app.importMarkers(e.target.files[0]);
        }
      });
    }
  }
  
  // Sidebar Management
  initSidebar() {
    // Add collapsible sections
    const sections = document.querySelectorAll('.control-section');
    sections.forEach(section => {
      const title = section.querySelector('.section-title');
      const content = section.querySelector('.section-content');
      
      if (title && content) {
        title.style.cursor = 'pointer';
        title.addEventListener('click', () => {
          content.classList.toggle('collapsed');
        });
      }
    });
  }
  
  toggleSidebar() {
    this.elements.sidebar.classList.toggle('collapsed');
    const isCollapsed = this.elements.sidebar.classList.contains('collapsed');
    
    if (isCollapsed) {
      this.elements.sidebar.style.width = 'var(--sidebar-collapsed)';
      document.querySelectorAll('.sidebar-content').forEach(el => {
        el.style.display = 'none';
      });
    } else {
      this.elements.sidebar.style.width = 'var(--sidebar-width)';
      document.querySelectorAll('.sidebar-content').forEach(el => {
        el.style.display = 'block';
      });
    }
    
    setTimeout(() => {
      this.app.map.invalidateSize();
    }, 300);
  }
  
  // Search
  async handleSearch() {
    const query = this.elements.searchInput.value.trim();
    if (!query) {
      this.showToast('Please enter a search term', 'warning');
      return;
    }
    
    try {
      this.showLoading();
      const result = await this.app.geocoder.search(query);
      
      if (result) {
        this.app.map.setView([result.lat, result.lon], 13);
        
        // Add marker
        this.app.addMarker({
          lat: result.lat,
          lng: result.lon,
          title: result.display_name.split(',')[0],
          description: result.display_name,
          icon: '🔍'
        });
        
        this.showToast('Location found!', 'success');
      } else {
        this.showToast('Location not found', 'error');
      }
    } catch (error) {
      this.showToast(`Search failed: ${error.message}`, 'error');
    } finally {
      this.hideLoading();
    }
  }
  
  // Marker Management UI
  addToSidebar(markerData) {
    const item = document.createElement('div');
    item.className = 'location-item';
    item.dataset.id = markerData.id;
    
    item.innerHTML = `
      <div class="location-icon">${markerData.icon}</div>
      <div class="location-content">
        <div class="location-title">${markerData.title}</div>
        <div class="location-desc">${markerData.description || 'No description'}</div>
      </div>
      <div class="location-actions">
        <button class="location-action zoom-action" title="Zoom to marker">🔍</button>
        <button class="location-action edit-action" title="Edit marker">✏️</button>
        <button class="location-action delete-action" title="Delete marker">🗑️</button>
      </div>
    `;
    
    // Add event listeners
    item.querySelector('.zoom-action').addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.zoomToMarker(markerData.id);
    });
    
    item.querySelector('.edit-action').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openEditMarkerModal(markerData.id);
    });
    
    item.querySelector('.delete-action').addEventListener('click', (e) => {
      e.stopPropagation();
      this.app.removeMarker(markerData.id);
    });
    
    item.addEventListener('click', (e) => {
      if (!e.target.closest('.location-actions')) {
        this.app.zoomToMarker(markerData.id);
      }
    });
    
    this.elements.locationsList.appendChild(item);
  }
  
  removeFromSidebar(id) {
    const item = this.elements.locationsList.querySelector(`[data-id="${id}"]`);
    if (item) {
      item.remove();
    }
  }
  
  updateSidebarItem(markerData) {
    const item = this.elements.locationsList.querySelector(`[data-id="${markerData.id}"]`);
    if (item) {
      item.querySelector('.location-icon').textContent = markerData.icon;
      item.querySelector('.location-title').textContent = markerData.title;
      item.querySelector('.location-desc').textContent = markerData.description || 'No description';
    }
  }
  
  clearSidebar() {
    this.elements.locationsList.innerHTML = '';
  }
  
  // Modal Management
  openAddMarkerModal(latlng) {
    this.elements.modal.dataset.mode = 'add';
    this.elements.modal.dataset.lat = latlng.lat;
    this.elements.modal.dataset.lng = latlng.lng;
    
    document.querySelector('.modal-title').textContent = 'Add New Marker';
    document.getElementById('marker-title').value = '';
    document.getElementById('marker-desc').value = '';
    document.querySelector('input[name="marker-icon"][value="📍"]').checked = true;
    
    this.elements.modal.style.display = 'flex';
    document.getElementById('marker-title').focus();
  }
  
  openEditMarkerModal(markerId) {
    const marker = this.app.markers.find(m => m.id === markerId);
    if (!marker) return;
    
    this.elements.modal.dataset.mode = 'edit';
    this.elements.modal.dataset.markerId = markerId;
    
    document.querySelector('.modal-title').textContent = 'Edit Marker';
    document.getElementById('marker-title').value = marker.title;
    document.getElementById('marker-desc').value = marker.description || '';
    document.querySelector(`input[name="marker-icon"][value="${marker.icon || '📍'}"]`).checked = true;
    
    this.elements.modal.style.display = 'flex';
  }
  
  closeModal() {
    this.elements.modal.style.display = 'none';
    this.elements.markerForm.reset();
    this.app.setMode(null);
  }
  
  async handleMarkerFormSubmit(e) {
    e.preventDefault();
    
    const mode = this.elements.modal.dataset.mode;
    const title = document.getElementById('marker-title').value.trim();
    const description = document.getElementById('marker-desc').value.trim();
    const icon = document.querySelector('input[name="marker-icon"]:checked').value;
    
    if (!title) {
      this.showToast('Please enter a title', 'error');
      return;
    }
    
    if (mode === 'add') {
      const lat = parseFloat(this.elements.modal.dataset.lat);
      const lng = parseFloat(this.elements.modal.dataset.lng);
      
      this.app.addMarker({
        lat,
        lng,
        title,
        description,
        icon
      });
      
      this.showToast('Marker added successfully', 'success');
    } else if (mode === 'edit') {
      const markerId = this.elements.modal.dataset.markerId;
      
      this.app.updateMarker(markerId, {
        title,
        description,
        icon
      });
      
      this.showToast('Marker updated successfully', 'success');
    }
    
    this.closeModal();
  }
  
  // Popup Content
  createPopupContent(markerData) {
    return `
      <div class="modern-popup">
        <div class="popup-header">
          <div class="popup-icon">${markerData.icon}</div>
          <h3 class="popup-title">${markerData.title}</h3>
        </div>
        <div class="popup-body">
          ${markerData.description ? `<p class="popup-desc">${markerData.description}</p>` : ''}
          <div class="popup-coords">
            <span>Lat: ${markerData.lat.toFixed(6)}</span>
            <span>Lng: ${markerData.lng.toFixed(6)}</span>
          </div>
        </div>
        <div class="popup-actions">
          <button class="popup-btn" data-action="zoom" data-marker-id="${markerData.id}">
            <span>Zoom</span>
          </button>
          <button class="popup-btn" data-action="edit" data-marker-id="${markerData.id}">
            <span>Edit</span>
          </button>
          <button class="popup-btn" data-action="route-from" data-marker-id="${markerData.id}">
            <span>Route From</span>
          </button>
          <button class="popup-btn" data-action="route-to" data-marker-id="${markerData.id}">
            <span>Route To</span>
          </button>
          <button class="popup-btn delete" data-action="delete" data-marker-id="${markerData.id}">
            <span>Delete</span>
          </button>
        </div>
      </div>
    `;
  }
  
  // Location Services
  async findUserLocation() {
    if (!navigator.geolocation) {
      this.showToast('Geolocation not supported', 'error');
      return;
    }
    
    this.showLoading('Finding your location...');
    
    try {
      const position = await new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true,
          timeout: 10000,
          maximumAge: 0
        });
      });
      
      const { latitude, longitude } = position.coords;
      this.app.zoomToLocation(latitude, longitude, 15);
      
      this.app.addMarker({
        lat: latitude,
        lng: longitude,
        title: 'My Location',
        description: 'Your current position',
        icon: '📍'
      });
      
      this.showToast('Location found!', 'success');
    } catch (error) {
      let message = 'Unable to retrieve location';
      switch(error.code) {
        case error.PERMISSION_DENIED:
          message = 'Location access denied';
          break;
        case error.POSITION_UNAVAILABLE:
          message = 'Location unavailable';
          break;
        case error.TIMEOUT:
          message = 'Location request timeout';
          break;
      }
      this.showToast(message, 'error');
    } finally {
      this.hideLoading();
    }
  }
  
  // Export/Import
  showExportMenu() {
    // Create export menu
    const menu = document.createElement('div');
    menu.className = 'export-menu';
    menu.innerHTML = `
      <div class="export-option" data-format="json">Export as JSON</div>
      <div class="export-option" data-format="csv">Export as CSV</div>
      <div class="export-option" data-format="kml">Export as KML</div>
    `;
    
    // Position and show menu
    const btnRect = this.elements.btnExport.getBoundingClientRect();
    menu.style.position = 'fixed';
    menu.style.top = `${btnRect.bottom + 5}px`;
    menu.style.left = `${btnRect.left}px`;
    menu.style.zIndex = '1000';
    
    document.body.appendChild(menu);
    
    // Handle clicks
    menu.addEventListener('click', (e) => {
      const format = e.target.dataset.format;
      if (format) {
        this.app.exportMarkers(format);
        menu.remove();
      }
    });
    
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', function closeMenu(event) {
        if (!menu.contains(event.target) && event.target !== this.elements.btnExport) {
          menu.remove();
          document.removeEventListener('click', closeMenu);
        }
      });
    }, 0);
  }
  
  showImportDialog() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.csv,.kml';
    input.style.display = 'none';
    
    input.addEventListener('change', (e) => {
      if (e.target.files.length > 0) {
        this.app.importMarkers(e.target.files[0]);
      }
      input.remove();
    });
    
    document.body.appendChild(input);
    input.click();
  }
  
  downloadFile(url, filename) {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }
  
  // Clear All
  clearAllMarkers() {
    if (this.app.markers.length === 0) {
      this.showToast('No markers to clear', 'info');
      return;
    }
    
    if (confirm(`Are you sure you want to remove all ${this.app.markers.length} markers?`)) {
      this.app.markerCluster.clearLayers();
      this.app.markers = [];
      this.clearSidebar();
      this.app.storage.saveMarkers([]);
      this.app.saveToHistory();
      this.updateStats(0);
      this.showToast('All markers cleared', 'success');
    }
  }
  
  // Fullscreen
  toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        this.showToast('Error entering fullscreen', 'error');
      });
    } else {
      document.exitFullscreen();
    }
  }
  
  // Toast Notifications
  initToastContainer() {
    const container = document.createElement('div');
    container.className = 'toast-container';
    container.id = 'toast-container';
    document.body.appendChild(container);
  }
  
  showToast(message, type = 'info', duration = 4000) {
    const container = document.getElementById('toast-container') || this.initToastContainer();
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <div class="toast-icon">${this.getToastIcon(type)}</div>
      <div class="toast-message">${message}</div>
      <button class="toast-close">&times;</button>
    `;
    
    container.appendChild(toast);
    
    // Auto-remove after duration
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add('fade-out');
        setTimeout(() => toast.remove(), 300);
      }
    }, duration);
    
    // Close button
    toast.querySelector('.toast-close').addEventListener('click', () => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    });
  }
  
  getToastIcon(type) {
    const icons = {
      success: '✅',
      error: '❌',
      warning: '⚠️',
      info: 'ℹ️'
    };
    return icons[type] || icons.info;
  }
  
  // Loading States
  showLoading(message = 'Loading...') {
    let overlay = document.getElementById('loading-overlay');
    
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'loading-overlay';
      overlay.className = 'loading-overlay';
      overlay.innerHTML = `
        <div class="loading-spinner">
          <div class="spinner"></div>
          <div class="loading-text">${message}</div>
        </div>
      `;
      document.body.appendChild(overlay);
    }
    
    overlay.classList.add('active');
  }
  
  hideLoading() {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) {
      overlay.classList.remove('active');
      setTimeout(() => {
        if (overlay.classList.contains('active')) return;
        overlay.remove();
      }, 300);
    }
  }
  
  // UI Updates
  updateStats(count) {
    this.elements.markerCount.textContent = count;
  }
  
  updateCoordinates(latlng) {
    this.elements.latDisplay.textContent = latlng.lat.toFixed(6);
    this.elements.lngDisplay.textContent = latlng.lng.toFixed(6);
  }
  
  updateZoomLevel(zoom) {
    // Could update a zoom display if needed
  }
  
  updateActiveStyle(style) {
    this.elements.styleOptions.forEach(option => {
      option.classList.toggle('active', option.dataset.style === style);
    });
  }
  
  updateLayerControl(layerName) {
    // Update layer control UI
  }
  
  updateModeIndicator(mode) {
    // Update UI to show current mode
    document.querySelectorAll('.action-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.mode === mode);
    });
  }
  
  updateUndoRedoButtons(historyIndex, historyLength) {
    if (this.elements.btnUndo) {
      this.elements.btnUndo.disabled = historyIndex <= 0;
    }
    if (this.elements.btnRedo) {
      this.elements.btnRedo.disabled = historyIndex >= historyLength - 1;
    }
  }
  
  enableAddMode() {
    this.app.setMode('addMarker');
    this.showToast('Click anywhere on the map to add a marker', 'info');
  }
}

// Geocoder Module
class Geocoder {
  constructor() {
    this.cache = new Map();
  }
  
  async search(query) {
    // Check cache first
    if (this.cache.has(query)) {
      return this.cache.get(query);
    }
    
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&addressdetails=1`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      
      if (data && data.length > 0) {
        const result = {
          lat: parseFloat(data[0].lat),
          lon: parseFloat(data[0].lon),
          display_name: data[0].display_name,
          address: data[0].address
        };
        
        // Cache result
        this.cache.set(query, result);
        setTimeout(() => this.cache.delete(query), 300000); // Cache for 5 minutes
        
        return result;
      }
      
      return null;
    } catch (error) {
      console.error('Geocoding error:', error);
      throw error;
    }
  }
  
  async reverse(lat, lng) {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`
      );
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const data = await response.json();
      return data;
    } catch (error) {
      console.error('Reverse geocoding error:', error);
      return null;
    }
  }
}

// Storage Manager Module
class StorageManager {
  constructor() {
    this.storageKey = 'geoexplorer_markers_v2';
  }
  
  saveMarkers(markers) {
    try {
      const data = markers.map(marker => ({
        lat: marker.lat,
        lng: marker.lng,
        title: marker.title,
        description: marker.description || '',
        icon: marker.icon || '📍',
        createdAt: marker.createdAt || Date.now()
      }));
      
      localStorage.setItem(this.storageKey, JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('Failed to save markers:', error);
      return false;
    }
  }
  
  loadMarkers() {
    try {
      const data = localStorage.getItem(this.storageKey);
      if (!data) return [];
      
      return JSON.parse(data);
    } catch (error) {
      console.error('Failed to load markers:', error);
      return [];
    }
  }
  
  clearStorage() {
    try {
      localStorage.removeItem(this.storageKey);
      return true;
    } catch (error) {
      console.error('Failed to clear storage:', error);
      return false;
    }
  }
}

// Routing Manager Module
class RoutingManager {
  constructor(app) {
    this.app = app;
    this.control = null;
    this.startPoint = null;
    this.endPoint = null;
  }
  
  init() {
    // Initialize routing control if needed
  }
  
  toggle() {
    if (this.control) {
      this.clear();
      this.app.ui.showToast('Route cleared', 'info');
    } else {
      this.promptForRoute();
    }
  }
  
  async promptForRoute() {
    const start = prompt('Start location:', '');
    if (!start) return;
    
    const end = prompt('Destination:', '');
    if (!end) return;
    
    await this.calculateRoute(start, end);
  }
  
  async calculateRoute(start, end) {
    try {
      this.app.ui.showLoading('Calculating route...');
      
      // Geocode both locations
      const startResult = await this.app.geocoder.search(start);
      const endResult = await this.app.geocoder.search(end);
      
      if (!startResult || !endResult) {
        throw new Error('Could not find one or both locations');
      }
      
      // Clear existing route
      this.clear();
      
      // Create route
      this.control = L.Routing.control({
        waypoints: [
          L.latLng(startResult.lat, startResult.lon),
          L.latLng(endResult.lat, endResult.lon)
        ],
        routeWhileDragging: false,
        showAlternatives: true,
        lineOptions: {
          styles: [
            { color: '#3b82f6', weight: 6, opacity: 0.8 },
            { color: '#60a5fa', weight: 4, opacity: 0.6 }
          ]
        },
        altLineOptions: {
          styles: [
            { color: '#94a3b8', weight: 4, opacity: 0.6 }
          ]
        },
        createMarker: (i, waypoint, n) => {
          return L.marker(waypoint.latLng, {
            icon: L.divIcon({
              html: i === 0 ? 
                '<div class="route-marker start">A</div>' : 
                '<div class="route-marker end">B</div>',
              className: 'custom-route-marker',
              iconSize: [32, 32],
              iconAnchor: [16, 16]
            })
          });
        }
      }).addTo(this.app.map);
      
      // Add event listeners
      this.control.on('routesfound', (e) => {
        this.app.ui.hideLoading();
        const routes = e.routes;
        const summary = routes[0].summary;
        
        const distance = (summary.totalDistance / 1000).toFixed(2);
        const time = (summary.totalTime / 60).toFixed(0);
        
        this.app.ui.showToast(`Route found: ${distance} km, ~${time} minutes`, 'success');
      });
      
      this.control.on('routingerror', (e) => {
        this.app.ui.hideLoading();
        this.app.ui.showToast('Routing failed. Please try again.', 'error');
      });
      
    } catch (error) {
      this.app.ui.hideLoading();
      this.app.ui.showToast(`Routing error: ${error.message}`, 'error');
    }
  }
  
  setStartPoint(markerId) {
    const marker = this.app.markers.find(m => m.id === markerId);
    if (marker) {
      this.startPoint = marker;
      this.app.ui.showToast('Start point set', 'success');
    }
  }
  
  setEndPoint(markerId) {
    const marker = this.app.markers.find(m => m.id === markerId);
    if (marker) {
      this.endPoint = marker;
      this.app.ui.showToast('End point set', 'success');
      
      // If both points are set, calculate route
      if (this.startPoint) {
        this.calculateRouteFromMarkers();
      }
    }
  }
  
  async calculateRouteFromMarkers() {
    if (!this.startPoint || !this.endPoint) return;
    
    await this.calculateRoute(
      `${this.startPoint.lat},${this.startPoint.lng}`,
      `${this.endPoint.lat},${this.endPoint.lng}`
    );
  }
  
  clear() {
    if (this.control) {
      this.app.map.removeControl(this.control);
      this.control = null;
    }
    this.startPoint = null;
    this.endPoint = null;
  }
}

// Measurement Manager Module
class MeasurementManager {
  constructor(app) {
    this.app = app;
    this.isActive = false;
    this.points = [];
    this.lines = [];
    this.currentLine = null;
    this.totalDistance = 0;
  }
  
  init() {
    // Initialize measurement tools
  }
  
  activate() {
    this.isActive = true;
    this.clear();
    this.app.ui.showToast('Measurement mode activated. Click to start measuring.', 'info');
  }
  
  deactivate() {
    this.isActive = false;
    this.clear();
  }
  
  handleClick(e) {
    if (!this.isActive) return;
    
    this.points.push(e.latlng);
    
    if (this.points.length === 1) {
      // First point
      this.createMarker(e.latlng, 'Start');
    } else if (this.points.length === 2) {
      // Second point - create line
      this.currentLine = L.polyline([this.points[0], this.points[1]], {
        color: '#10b981',
        weight: 3,
        dashArray: '5, 5'
      }).addTo(this.app.map);
      
      this.lines.push(this.currentLine);
      this.updateDistance();
    } else {
      // Additional points - extend line
      this.currentLine.addLatLng(e.latlng);
      this.updateDistance();
    }
    
    // Add intermediate marker
    if (this.points.length > 1) {
      this.createMarker(e.latlng, `Point ${this.points.length}`);
    }
  }
  
  createMarker(latlng, label) {
    const marker = L.marker(latlng, {
      icon: L.divIcon({
        html: `<div class="measure-marker">${label}</div>`,
        className: 'measure-marker-icon',
        iconSize: [40, 20],
        iconAnchor: [20, 10]
      })
    }).addTo(this.app.map);
    
    marker.bindTooltip(label, { permanent: true, direction: 'top' });
    return marker;
  }
  
  updateDistance() {
    this.totalDistance = 0;
    
    for (let i = 0; i < this.points.length - 1; i++) {
      const p1 = this.points[i];
      const p2 = this.points[i + 1];
      this.totalDistance += this.calculateDistance(p1, p2);
    }
    
    // Update UI with distance
    this.app.ui.showToast(`Distance: ${this.totalDistance.toFixed(2)} km`, 'info');
    
    // Update distance display in stats
    const distanceDisplay = document.getElementById('distance-display');
    if (distanceDisplay) {
      distanceDisplay.textContent = `${this.totalDistance.toFixed(2)} km`;
    }
  }
  
  calculateDistance(p1, p2) {
    const R = 6371; // Earth's radius in km
    const dLat = (p2.lat - p1.lat) * Math.PI / 180;
    const dLon = (p2.lng - p1.lng) * Math.PI / 180;
    
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) *
      Math.sin(dLon/2) * Math.sin(dLon/2);
    
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  }
  
  clear() {
    // Remove all measurement markers and lines
    this.points = [];
    this.lines.forEach(line => this.app.map.removeLayer(line));
    this.lines = [];
    this.currentLine = null;
    this.totalDistance = 0;
  }
  
  finish() {
    if (this.points.length < 2) return;
    
    // Create a measurement summary
    const area = this.calculateArea();
    
    this.app.ui.showToast(
      `Measurement complete: ${this.totalDistance.toFixed(2)} km, Area: ${area.toFixed(2)} km²`,
      'success'
    );
    
    // Save measurement
    const measurement = {
      points: this.points,
      distance: this.totalDistance,
      area: area,
      timestamp: Date.now()
    };
    
    // Could save to storage or export
    this.clear();
    this.deactivate();
  }
  
  calculateArea() {
    if (this.points.length < 3) return 0;
    
    let area = 0;
    const n = this.points.length;
    
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const p1 = this.points[i];
      const p2 = this.points[j];
      
      area += p1.lng * p2.lat - p2.lng * p1.lat;
    }
    
    return Math.abs(area * 111.32 * 111.32 * 0.5); // Approximate area in km²
  }
}

// Initialize the app
document.addEventListener('DOMContentLoaded', () => {
  // Check for required libraries
  if (!window.L) {
    console.error('Leaflet library not loaded');
    return;
  }
  
  // Initialize app
  window.mapApp = new ModernMapApp();
  
  // Add error handling
  window.addEventListener('error', (event) => {
    console.error('Global error:', event.error);
    const toast = document.getElementById('toast-container');
    if (toast) {
      const errorToast = document.createElement('div');
      errorToast.className = 'toast error';
      errorToast.textContent = 'An error occurred. Please refresh the page.';
      toast.appendChild(errorToast);
      
      setTimeout(() => errorToast.remove(), 5000);
    }
  });
  
  // Add offline detection
  window.addEventListener('offline', () => {
    const toast = document.getElementById('toast-container');
    if (toast) {
      const offlineToast = document.createElement('div');
      offlineToast.className = 'toast warning';
      offlineToast.textContent = 'You are offline. Some features may not work.';
      toast.appendChild(offlineToast);
    }
  });
  
  window.addEventListener('online', () => {
    const toast = document.getElementById('toast-container');
    if (toast) {
      const onlineToast = document.createElement('div');
      onlineToast.className = 'toast success';
      onlineToast.textContent = 'You are back online.';
      toast.appendChild(onlineToast);
      setTimeout(() => onlineToast.remove(), 3000);
    }
  });
});
