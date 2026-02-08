/*
================================================================================
TOWING DISPATCH SYSTEM - Map Management Module (map.js)
================================================================================

This module handles all map-related functionality using Leaflet.js, an open-source
JavaScript library for interactive maps.

RESPONSIBILITIES:
- Initialize and configure the Leaflet map
- Create and manage job markers (color-coded by type)
- Create and manage truck markers (show real-time positions)
- Display the hot zone (6km service radius around HQ)
- Handle map interactions (clicks, panning, zooming)
- Create informative popups for jobs and trucks

DEPENDENCIES:
- Leaflet.js (loaded from CDN in index.html)
- app.js (for appState, JOB_TYPES, and other shared data)

LEAFLET BASICS FOR BEGINNERS:
- L.map(): Creates a map instance in a container element
- L.tileLayer(): Adds map tiles (the actual map images) from a provider
- L.marker(): Creates a pin/marker on the map
- L.circle(): Creates a circle overlay (used for hot zone)
- L.layerGroup(): Groups multiple markers for easier management
- L.divIcon(): Creates a custom marker using HTML/CSS instead of an image

================================================================================
*/


// =============================================================================
// GLOBAL VARIABLES
// =============================================================================

/*
    Map Instance
    The main Leaflet map object. All map operations go through this.
    Initialized as null and set in initializeMap().
*/
let map = null;

/*
    Layer Groups
    Leaflet uses "layers" to organize map elements. Layer groups allow us to:
    - Add/remove multiple markers at once
    - Toggle visibility of a group (like the hot zone)
    - Keep different types of markers organized
*/
let jobMarkersLayer = null;    // Contains all job markers
let truckMarkersLayer = null;  // Contains all truck markers
let hotZoneLayer = null;       // Contains the hot zone circle

/*
    Hot Zone Visibility Toggle
    Tracks whether the hot zone circle is currently visible on the map.
    Toggled by the hot zone button in the map controls.
*/
let hotZoneVisible = true;

/*
    Custom Icons Object
    Stores Leaflet DivIcon instances for each marker type.
    DivIcons allow us to use HTML/CSS for markers instead of images.

    Keys match job types for easy lookup: ICONS[job.type]
*/
const ICONS = {
    police: null,   // Red marker with police car emoji
    bylaw: null,    // Orange marker with construction emoji
    private: null,  // Blue marker with car emoji
    retail: null,   // Green marker with shopping cart emoji
    truck: null,    // Special truck marker
    base: null      // HQ building marker
};

/*
    Marker Storage Maps
    JavaScript Maps that store references to markers by ID.
    This allows us to:
    - Quickly find a marker to update its position
    - Remove a specific marker when a job is completed
    - Open a popup for a specific marker

    Key: job.id or truck.id
    Value: Leaflet marker instance
*/
const jobMarkers = new Map();
const truckMarkers = new Map();


// =============================================================================
// MAP INITIALIZATION
// =============================================================================

/**
 * Initializes the Leaflet map and all its components.
 *
 * This function:
 * 1. Waits for the container to have proper dimensions
 * 2. Creates the map centered on Vancouver
 * 3. Adds dark-themed map tiles from CARTO
 * 4. Sets up layer groups for organizing markers
 * 5. Creates custom marker icons
 * 6. Draws the hot zone circle
 * 7. Adds the HQ marker and truck markers
 * 8. Sets up map control buttons
 *
 * Called from app.js after DOM is ready.
 */
function initializeMap() {
    console.log('Initializing map...');

    /*
        setTimeout Explanation:
        We wait 100ms before initializing to ensure the map container
        has been rendered with proper dimensions. Leaflet needs to know
        the container size to render tiles correctly.
    */
    setTimeout(() => {
        // Get the map container element
        const mapContainer = document.getElementById('map');

        /*
            Dimension Check:
            Leaflet will fail silently if the container has 0 width/height.
            This commonly happens if:
            - CSS hasn't loaded yet
            - The container is hidden (display: none)
            - Flexbox hasn't calculated sizes yet

            If dimensions are 0, we retry after 500ms.
        */
        if (!mapContainer || mapContainer.offsetWidth === 0 || mapContainer.offsetHeight === 0) {
            console.error('Map container has no dimensions. Retrying...');
            setTimeout(initializeMap, 500);
            return;
        }

        console.log(`Map container dimensions: ${mapContainer.offsetWidth}x${mapContainer.offsetHeight}`);

        /*
            Create Map Instance
            L.map() creates the map in the specified container.

            Options:
            - center: [lat, lng] - Initial map center (Vancouver)
            - zoom: Initial zoom level (12 shows city-level detail)
            - zoomControl: Show +/- buttons
            - attributionControl: Hide attribution (we add it to tiles)
            - preferCanvas: Use canvas rendering for better performance
            - renderer: L.canvas() - Canvas renderer for many markers
        */
        map = L.map('map', {
            center: [49.2827, -123.1207], // Vancouver, BC coordinates
            zoom: 12,
            zoomControl: true,
            attributionControl: false,
            preferCanvas: true,
            renderer: L.canvas()
        });

        /*
            Add Tile Layer
            Tiles are the actual map images (roads, buildings, etc.)
            We use CARTO's dark theme to match our app's design.

            URL Template:
            {s} - Subdomain (a, b, c, d) for load balancing
            {z} - Zoom level
            {x}, {y} - Tile coordinates
            {r} - Retina flag for high-DPI displays

            Options:
            - attribution: Credit to data providers (required by license)
            - subdomains: Available subdomains for the tile server
            - maxZoom/minZoom: Zoom level limits
            - detectRetina: Use high-resolution tiles on retina displays
        */
        const tileLayer = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 19,
            minZoom: 10,
            errorTileUrl: '',      // Show nothing if tile fails to load
            detectRetina: true
        });

        // Add tile layer to map
        tileLayer.addTo(map);

        /*
            invalidateSize()
            Forces Leaflet to recalculate the map size.
            Needed when container size might have changed since creation.
        */
        map.invalidateSize();

        /*
            Initialize Layer Groups
            Layer groups are containers for multiple map elements.
            .addTo(map) immediately adds the group to the map.

            We can then add markers to these groups instead of directly to the map,
            making it easy to manage groups of related markers.
        */
        jobMarkersLayer = L.layerGroup().addTo(map);
        truckMarkersLayer = L.layerGroup().addTo(map);
        hotZoneLayer = L.layerGroup().addTo(map);

        // Create custom marker icons (defined below)
        createCustomIcons();

        // Draw the 6km hot zone circle around HQ
        drawHotZone();

        // Add the HQ building marker
        addBaseMarker();

        // Create markers for all trucks in the fleet
        initializeTruckMarkers();

        // Set up click handlers for map control buttons
        setupMapControls();

        /*
            Map Event Listener
            'click' event fires when the map is clicked (not a marker).
            Currently just logs the location, could be used for:
            - Manual job placement
            - Custom location selection
            - Debugging
        */
        map.on('click', handleMapClick);

        // Final size recalculation after everything is loaded
        setTimeout(() => {
            map.invalidateSize();
            console.log('Map initialization complete - final size invalidation done');
        }, 100);

        /*
            Tile Error Handling
            Listen for tile loading errors (e.g., network issues).
            Useful for debugging map display problems.
        */
        tileLayer.on('tileerror', function(error) {
            console.error('Tile loading error:', error);
        });

        console.log('Map initialization complete');
    }, 100);
}


// =============================================================================
// CUSTOM ICON CREATION
// =============================================================================

/**
 * Creates custom Leaflet DivIcon instances for all marker types.
 *
 * DivIcon allows us to use HTML and CSS to style markers instead of images.
 * This gives us more flexibility:
 * - Use emojis or icon fonts
 * - Apply CSS animations
 * - Change colors with CSS variables
 * - Add hover effects
 *
 * Icon positioning:
 * - iconSize: [width, height] of the icon container
 * - iconAnchor: [x, y] point of the icon that corresponds to the marker's location
 * - popupAnchor: [x, y] offset for the popup relative to iconAnchor
 */
function createCustomIcons() {
    // Base options shared by all job type icons
    const iconOptions = {
        iconSize: [30, 30],      // 30x30 pixel container
        iconAnchor: [15, 30],    // Anchor at bottom center (pin tip)
        popupAnchor: [0, -30],   // Popup appears above the marker
        className: 'custom-marker'
    };

    /*
        Police Job Icon
        Red marker with police car emoji.
        Highest priority jobs (15 min SLA).
    */
    ICONS.police = L.divIcon({
        ...iconOptions,  // Spread operator copies base options
        html: '<div class="marker-pin police-marker">🚔</div>',
        className: 'custom-marker police'
    });

    /*
        Bylaw Job Icon
        Orange marker with construction emoji.
        High priority (30 min SLA).
    */
    ICONS.bylaw = L.divIcon({
        ...iconOptions,
        html: '<div class="marker-pin bylaw-marker">🚧</div>',
        className: 'custom-marker bylaw'
    });

    /*
        Private Job Icon
        Blue marker with car emoji.
        Medium priority (60 min SLA).
    */
    ICONS.private = L.divIcon({
        ...iconOptions,
        html: '<div class="marker-pin private-marker">🚗</div>',
        className: 'custom-marker private'
    });

    /*
        Retail Job Icon
        Green marker with shopping cart emoji.
        Lower priority (90 min SLA).
    */
    ICONS.retail = L.divIcon({
        ...iconOptions,
        html: '<div class="marker-pin retail-marker">🛒</div>',
        className: 'custom-marker retail'
    });

    /*
        Truck Icon
        Special styling to distinguish from job markers.
        Larger size, different shape, pulsing animation.
        Changes color when busy (assigned to a job).
    */
    ICONS.truck = L.divIcon({
        iconSize: [35, 35],
        iconAnchor: [17, 17],    // Centered anchor (truck can face any direction)
        popupAnchor: [0, -20],
        html: '<div class="truck-marker">🚛</div>',
        className: 'custom-marker truck'
    });

    /*
        Base/HQ Icon
        Largest marker for the company headquarters.
        Square shape to differentiate from circular markers.
    */
    ICONS.base = L.divIcon({
        iconSize: [40, 40],
        iconAnchor: [20, 40],    // Bottom center anchor
        popupAnchor: [0, -40],
        html: '<div class="base-marker">🏢</div>',
        className: 'custom-marker base'
    });

    // Inject CSS styles for markers into the page
    addMarkerStyles();
}


// =============================================================================
// MARKER STYLES (Dynamically Injected CSS)
// =============================================================================

/**
 * Injects CSS styles for custom map markers into the document.
 *
 * We inject styles via JavaScript instead of putting them in styles.css because:
 * 1. Keeps all map-related code in one file
 * 2. Styles are only added when the map is initialized
 * 3. Easier to maintain marker styles alongside marker creation
 *
 * Styles include:
 * - Base marker pin shape (circle with triangle pointer)
 * - Color variations for each job type
 * - Truck marker with pulsing animation
 * - Base/HQ marker styling
 * - Popup content styling
 */
function addMarkerStyles() {
    // Create a <style> element
    const style = document.createElement('style');

    /*
        Template Literal for CSS
        Using backticks (`) allows multi-line strings and is
        easier to read than concatenated strings.
    */
    style.textContent = `
        /*
            Base Custom Marker
            Removes default Leaflet marker styling so our custom HTML shows.
        */
        .custom-marker {
            background: none;
            border: none;
        }

        /*
            Marker Pin Base Styles
            Creates a circular pin with hover effects.
        */
        .marker-pin {
            width: 30px;
            height: 30px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 16px;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
            cursor: pointer;
            transition: all 0.3s ease;
            position: relative;
        }

        /*
            Pin Pointer (Triangle at bottom)
            Uses CSS border trick to create a triangle.
            The ::after pseudo-element adds content after the marker.
        */
        .marker-pin::after {
            content: '';
            position: absolute;
            bottom: -8px;
            left: 50%;
            transform: translateX(-50%);
            width: 0;
            height: 0;
            /* Triangle created with transparent side borders */
            border-left: 6px solid transparent;
            border-right: 6px solid transparent;
            border-top: 8px solid inherit;  /* Color matches marker */
        }

        /* ===== JOB TYPE MARKER COLORS ===== */

        /* Police - Red (highest priority) */
        .police-marker {
            background: #ff4444;
            border: 2px solid #cc0000;
        }
        .police-marker::after {
            border-top-color: #ff4444;
        }

        /* Bylaw - Orange (high priority) */
        .bylaw-marker {
            background: #ff8c00;
            border: 2px solid #cc6600;
        }
        .bylaw-marker::after {
            border-top-color: #ff8c00;
        }

        /* Private - Blue (medium priority) */
        .private-marker {
            background: #4169e1;
            border: 2px solid #1a4acc;
        }
        .private-marker::after {
            border-top-color: #4169e1;
        }

        /* Retail - Green (lower priority) */
        .retail-marker {
            background: #32cd32;
            border: 2px solid #228b22;
        }
        .retail-marker::after {
            border-top-color: #32cd32;
        }

        /* ===== TRUCK MARKER ===== */
        .truck-marker {
            width: 35px;
            height: 35px;
            background: #0f3460;           /* Dark blue background */
            border: 3px solid #e94560;     /* Accent color border */
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 20px;
            box-shadow: 0 2px 10px rgba(233, 69, 96, 0.5);
            cursor: pointer;
            transition: all 0.3s ease;
            animation: truckPulse 2s infinite;  /* Continuous pulse */
        }

        /* Truck pulse animation - subtle scale effect */
        @keyframes truckPulse {
            0% { transform: scale(1); }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); }
        }

        /* Busy truck - inverted colors to show status */
        .truck-marker.busy {
            background: #e94560;
            border-color: #0f3460;
        }

        /* ===== BASE/HQ MARKER ===== */
        .base-marker {
            width: 40px;
            height: 40px;
            background: #1a1a2e;
            border: 3px solid #e94560;
            border-radius: 10px;           /* Rounded square, not circle */
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 24px;
            box-shadow: 0 4px 15px rgba(233, 69, 96, 0.6);
        }

        /* Marker hover effect */
        .marker-pin:hover {
            transform: translateY(-5px);   /* Lift up */
            box-shadow: 0 4px 15px rgba(0, 0, 0, 0.7);
        }

        /* ===== POPUP STYLES ===== */

        /* Popup container sizing */
        .leaflet-popup-content {
            margin: 0;
            min-width: 200px;
        }

        /* Popup content wrapper */
        .popup-content {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }

        /* Popup title */
        .popup-content h4 {
            margin: 0 0 8px 0;
            font-size: 14px;
            font-weight: 600;
        }

        /* Popup text */
        .popup-content p {
            margin: 4px 0;
            font-size: 12px;
            line-height: 1.4;
        }

        /* Popup stat row (label + value) */
        .popup-content .popup-stat {
            display: flex;
            justify-content: space-between;
            margin: 4px 0;
        }

        /* Stat label (left side) */
        .popup-content .popup-label {
            color: #a0a0a0;
        }

        /* Stat value (right side) */
        .popup-content .popup-value {
            font-weight: 600;
        }

        /* Dispatch button in popups (currently unused) */
        .popup-content .dispatch-btn {
            margin-top: 10px;
            width: 100%;
            padding: 6px 12px;
            background: linear-gradient(135deg, #e94560 0%, #ff4444 100%);
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 12px;
            font-weight: 500;
            transition: all 0.3s ease;
        }

        .popup-content .dispatch-btn:hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 8px rgba(233, 69, 96, 0.5);
        }
    `;

    // Append style element to document head
    document.head.appendChild(style);
}


// =============================================================================
// HOT ZONE VISUALIZATION
// =============================================================================

/**
 * Draws the hot zone circle on the map.
 *
 * The hot zone represents the primary service area around HQ (6km radius).
 * Jobs inside this zone are faster to reach and have better response times.
 *
 * Uses L.circle() which creates a geographically accurate circle
 * (the radius is in meters and scales correctly with zoom).
 */
function drawHotZone() {
    // Clear any existing hot zone (prevents duplicates on redraw)
    hotZoneLayer.clearLayers();

    /*
        L.circle() Parameters:
        1. Center coordinates: [lat, lng] from appState
        2. Options object:
           - radius: Size in meters (6000m = 6km)
           - color: Stroke color (border)
           - fillColor: Interior color
           - fillOpacity: How transparent the fill is (0.1 = very transparent)
           - weight: Stroke width in pixels
           - dashArray: Creates dashed border ('5, 10' = 5px dash, 10px gap)
    */
    const hotZone = L.circle(
        [appState.hotZoneCenter.lat, appState.hotZoneCenter.lng],
        {
            radius: appState.hotZoneRadius,  // 6000 meters from appState
            color: '#e94560',                 // Accent color for border
            fillColor: '#e94560',
            fillOpacity: 0.1,                 // Very subtle fill
            weight: 2,
            dashArray: '5, 10'                // Dashed line style
        }
    );

    // Add circle to the hot zone layer group
    hotZone.addTo(hotZoneLayer);
}


// =============================================================================
// BASE/HQ MARKER
// =============================================================================

/**
 * Adds the headquarters marker to the map.
 *
 * This is a fixed marker showing the company's main location.
 * Clicking it shows a popup with company info.
 * The hot zone circle is centered on this location.
 */
function addBaseMarker() {
    /*
        L.marker() Parameters:
        1. Coordinates: [lat, lng] - same as hot zone center
        2. Options: { icon: ... } - use our custom base icon
    */
    const baseMarker = L.marker(
        [appState.hotZoneCenter.lat, appState.hotZoneCenter.lng],
        { icon: ICONS.base }
    );

    /*
        bindPopup()
        Attaches a popup to the marker that appears when clicked.
        Takes HTML string for content.
    */
    baseMarker.bindPopup(`
        <div class="popup-content">
            <h4>🏢 Busters Towing HQ</h4>
            <p>425 Industrial Avenue</p>
            <p>Vancouver, BC</p>
            <div class="popup-stat">
                <span class="popup-label">Hot Zone Center</span>
                <span class="popup-value">6km radius</span>
            </div>
        </div>
    `);

    // Add directly to map (not a layer group) since it's permanent
    baseMarker.addTo(map);
}


// =============================================================================
// TRUCK MARKER MANAGEMENT
// =============================================================================

/**
 * Creates markers for all trucks in the fleet.
 *
 * Called once during map initialization.
 * Iterates through all trucks in appState and creates a marker for each.
 * Markers are stored in the truckMarkers Map for later updates.
 */
function initializeTruckMarkers() {
    /*
        appState.trucks is a JavaScript Map.
        .forEach() iterates over each truck object.
    */
    appState.trucks.forEach(truck => {
        /*
            Create marker at truck's current position.
            zIndexOffset: 1000 ensures trucks appear above job markers.
            (Higher zIndex = appears on top)
        */
        const marker = L.marker(
            [truck.position.lat, truck.position.lng],
            {
                icon: ICONS.truck,
                zIndexOffset: 1000
            }
        );

        // Attach popup with truck details
        marker.bindPopup(createTruckPopup(truck));

        // Add to truck markers layer group
        marker.addTo(truckMarkersLayer);

        // Store reference for later updates
        truckMarkers.set(truck.id, marker);
    });
}

/**
 * Updates a truck marker's position and appearance.
 *
 * Called from app.js whenever a truck moves or changes status.
 * Updates:
 * - Position (smooth animation)
 * - Visual state (busy vs available)
 * - Popup content (updated stats)
 *
 * @param {Object} truck - The truck object with updated data
 */
function updateTruckMarker(truck) {
    // Get the marker from our storage Map
    const marker = truckMarkers.get(truck.id);

    if (marker) {
        /*
            setLatLng()
            Moves the marker to new coordinates.
            Leaflet handles smooth animation automatically.
        */
        marker.setLatLng([truck.position.lat, truck.position.lng]);

        /*
            Update Visual State
            getElement() returns the DOM element for the marker.
            We add/remove 'busy' class to change colors.
        */
        const markerElement = marker.getElement();
        if (markerElement) {
            if (truck.status === 'busy') {
                markerElement.querySelector('.truck-marker')?.classList.add('busy');
            } else {
                markerElement.querySelector('.truck-marker')?.classList.remove('busy');
            }
        }

        /*
            Update Popup Content
            setPopupContent() replaces the popup HTML.
            This updates stats like revenue and job count.
        */
        marker.setPopupContent(createTruckPopup(truck));
    }
}


// =============================================================================
// JOB MARKER MANAGEMENT
// =============================================================================

/**
 * Adds a new job marker to the map.
 *
 * Called from app.js when a new job is generated.
 * Creates a color-coded marker at the job location with a popup.
 *
 * @param {Object} job - The job object containing location, type, etc.
 */
function addJobMarker(job) {
    // Get the appropriate icon for this job type
    const icon = ICONS[job.type];  // e.g., ICONS['police']

    // Create marker at job location
    const marker = L.marker(
        [job.location.lat, job.location.lng],
        { icon: icon }
    );

    // Attach popup with job details
    marker.bindPopup(createJobPopup(job));

    // Add to job markers layer group
    marker.addTo(jobMarkersLayer);

    // Store reference for later access
    jobMarkers.set(job.id, marker);

    /*
        Click Handler
        When marker is clicked, also select the job in the jobs panel.
        This keeps the UI synchronized.
    */
    marker.on('click', () => {
        selectJob(job.id);  // Function from app.js
    });

    /*
        Appearance Animation
        Add a CSS class after a short delay to trigger fade-in animation.
        Uses optional chaining (?.) in case element isn't ready yet.
    */
    setTimeout(() => {
        marker.getElement()?.classList.add('marker-appear');
    }, 50);
}

/**
 * Removes a job marker from the map.
 *
 * Called when a job is completed or cancelled.
 * Cleans up both the marker and the reference in our Map.
 *
 * @param {Object} job - The job object to remove
 */
function removeJobMarker(job) {
    // Get marker from our storage
    const marker = jobMarkers.get(job.id);

    if (marker) {
        // Remove from layer group (and map)
        jobMarkersLayer.removeLayer(marker);

        // Remove from our storage Map
        jobMarkers.delete(job.id);
    }
}


// =============================================================================
// POPUP CONTENT GENERATORS
// =============================================================================

/**
 * Generates HTML content for a job marker popup.
 *
 * Shows:
 * - Job type and ID
 * - Location address
 * - Vehicle category
 * - Estimated revenue
 * - Time remaining on SLA
 * - Warning if underground parking (height restricted)
 *
 * @param {Object} job - The job object
 * @returns {string} HTML string for the popup content
 */
function createJobPopup(job) {
    /*
        Calculate SLA Time Remaining
        job.createdAt is a Date object stored when job was created.
        We calculate minutes elapsed and subtract from the SLA limit.
    */
    const timeElapsed = (new Date() - job.createdAt) / 60000;  // Convert ms to minutes
    const timeRemaining = JOB_TYPES[job.type].sla - timeElapsed;

    /*
        Template Literal
        Backticks allow embedded expressions with ${...}
        and multi-line strings.
    */
    return `
        <div class="popup-content">
            <h4>${job.type.toUpperCase()} Job</h4>
            <div class="popup-stat">
                <span class="popup-label">ID:</span>
                <span class="popup-value">${job.id.substring(0, 12)}</span>
            </div>
            <div class="popup-stat">
                <span class="popup-label">Location:</span>
                <span class="popup-value">${job.address}</span>
            </div>
            <div class="popup-stat">
                <span class="popup-label">Category:</span>
                <span class="popup-value">${job.vehicleCategory}</span>
            </div>
            <div class="popup-stat">
                <span class="popup-label">Revenue:</span>
                <span class="popup-value">$${job.estimatedRevenue}</span>
            </div>
            <div class="popup-stat">
                <span class="popup-label">SLA:</span>
                <!-- Red text if less than 5 minutes remaining -->
                <span class="popup-value ${timeRemaining < 5 ? 'style="color: #ff4444;"' : ''}">${Math.floor(timeRemaining)}min remaining</span>
            </div>
            <!-- Conditional warning for underground parking -->
            ${job.hasUndergroundParking ? '<p style="color: #ff8c00;">⚠️ Underground parking</p>' : ''}
        </div>
    `;
}

/**
 * Generates HTML content for a truck marker popup.
 *
 * Shows:
 * - Truck ID and type
 * - Current status (available/busy with color)
 * - Vehicle specs (height, speed)
 * - Performance stats (revenue, jobs completed)
 *
 * @param {Object} truck - The truck object
 * @returns {string} HTML string for the popup content
 */
function createTruckPopup(truck) {
    /*
        Status Badge
        Different colored dot based on truck status.
        Green circle (●) for available, red for busy.
    */
    const statusBadge = truck.status === 'available'
        ? '<span style="color: #32cd32;">● Available</span>'
        : '<span style="color: #ff4444;">● Busy</span>';

    return `
        <div class="popup-content">
            <h4>🚛 ${truck.id}</h4>
            <div class="popup-stat">
                <span class="popup-label">Type:</span>
                <!-- Replace underscore and uppercase: heavy_duty -> HEAVY DUTY -->
                <span class="popup-value">${truck.type.replace('_', ' ').toUpperCase()}</span>
            </div>
            <div class="popup-stat">
                <span class="popup-label">Status:</span>
                <span class="popup-value">${statusBadge}</span>
            </div>
            <div class="popup-stat">
                <span class="popup-label">Height:</span>
                <span class="popup-value">${truck.height}m</span>
            </div>
            <div class="popup-stat">
                <span class="popup-label">Speed:</span>
                <span class="popup-value">${Math.round(truck.baseSpeed)}km/h</span>
            </div>
            <div class="popup-stat">
                <span class="popup-label">Revenue:</span>
                <span class="popup-value">$${truck.totalRevenue.toFixed(2)}</span>
            </div>
            <div class="popup-stat">
                <span class="popup-label">Jobs:</span>
                <span class="popup-value">${truck.jobsCompleted} completed</span>
            </div>
        </div>
    `;
}


// =============================================================================
// MAP CONTROLS
// =============================================================================

/**
 * Sets up event listeners for map control buttons.
 *
 * Buttons:
 * - centerMap: Pans map to center on HQ
 * - toggleHotZone: Shows/hides the hot zone circle
 */
function setupMapControls() {
    /*
        Center Map Button
        Pans and zooms the map to show HQ at zoom level 13.
        setView() takes [lat, lng] and zoom level.
    */
    document.getElementById('centerMap').addEventListener('click', () => {
        map.setView([appState.hotZoneCenter.lat, appState.hotZoneCenter.lng], 13);
    });

    /*
        Toggle Hot Zone Button
        Shows or hides the hot zone circle.
        Uses addTo() and removeLayer() to toggle visibility.
    */
    document.getElementById('toggleHotZone').addEventListener('click', () => {
        hotZoneVisible = !hotZoneVisible;

        if (hotZoneVisible) {
            hotZoneLayer.addTo(map);
        } else {
            map.removeLayer(hotZoneLayer);
        }
    });
}


// =============================================================================
// EVENT HANDLERS
// =============================================================================

/**
 * Handles clicks on the map (not on markers).
 *
 * Currently just logs the coordinates for debugging.
 * Could be extended for features like:
 * - Manual job placement
 * - Custom location selection
 * - Right-click context menus
 *
 * @param {Object} e - Leaflet event object containing latlng
 */
function handleMapClick(e) {
    console.log('Map clicked at:', e.latlng);
}


// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Pans the map to center on a specific job.
 * Also opens the job's popup.
 *
 * Called from app.js when a job is selected in the jobs panel.
 *
 * @param {string} jobId - The ID of the job to pan to
 */
function panToJob(jobId) {
    // Get job data from appState
    const job = appState.jobs.get(jobId);

    if (job) {
        // Pan map to job location
        map.panTo([job.location.lat, job.location.lng]);

        // Open the job's popup
        const marker = jobMarkers.get(jobId);
        if (marker) {
            marker.openPopup();
        }
    }
}

/**
 * Pans the map to center on a specific truck.
 * Also opens the truck's popup.
 *
 * @param {string} truckId - The ID of the truck to pan to
 */
function panToTruck(truckId) {
    // Get truck data from appState
    const truck = appState.trucks.get(truckId);

    if (truck) {
        // Pan map to truck location
        map.panTo([truck.position.lat, truck.position.lng]);

        // Open the truck's popup
        const marker = truckMarkers.get(truckId);
        if (marker) {
            marker.openPopup();
        }
    }
}


// =============================================================================
// EXPORTS (Make Functions Available Globally)
// =============================================================================

/*
    Export Functions to window Object

    Since we're not using ES6 modules, we attach functions to the
    global window object so other scripts (app.js, dispatch.js) can call them.

    This is the pattern used when scripts are loaded with <script> tags
    instead of using import/export.
*/
window.initializeMap = initializeMap;      // Called from app.js on page load
window.addJobMarker = addJobMarker;         // Called when new job is created
window.removeJobMarker = removeJobMarker;   // Called when job is completed
window.updateTruckMarker = updateTruckMarker; // Called when truck moves
window.panToJob = panToJob;                 // Called when job is selected
window.panToTruck = panToTruck;             // Called to focus on a truck
