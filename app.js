/**
 * ============================================================
 * TOWING DISPATCH MONITORING SYSTEM - Core Application Logic (app.js)
 * ============================================================
 *
 * This is the main JavaScript file that manages all core functionality of the dispatch monitoring system.
 *
 * WHAT THIS FILE DOES:
 * --------------------
 * 1. STATE MANAGEMENT - Keeps track of all trucks, jobs, and system data
 * 2. FLEET INITIALIZATION - Creates and configures the truck fleet
 * 3. JOB GENERATION - Creates new towing jobs with realistic data
 * 4. SIMULATION ENGINE - Runs the real-time updates (truck movement, job completion)
 * 5. UI RENDERING - Updates the display when data changes
 * 6. EVENT HANDLING - Responds to user interactions (clicks, filters, keyboard)
 * 7. PANEL RESIZING - Allows users to resize the three main panels
 *
 * DEPENDENCIES:
 * -------------
 * This file is loaded FIRST (after Leaflet.js) because other files depend on it:
 * - map.js needs: appState, calculateDistance()
 * - dispatch.js needs: appState, JOB_TYPES, assignTruckToJob(), calculateDistance()
 *
 * KEY JAVASCRIPT CONCEPTS USED:
 * -----------------------------
 * - Map objects: Like dictionaries/hash tables for fast key-value lookup
 * - Closures: Functions that remember their surrounding scope
 * - Event listeners: Code that runs when something happens (click, keypress, etc.)
 * - setInterval: Runs code repeatedly at specified intervals
 * - setTimeout: Runs code once after a delay
 * - localStorage: Browser storage that persists between sessions
 * - Array methods: filter(), map(), reduce(), sort() for data processing
 *
 * ARCHITECTURE PATTERN:
 * ---------------------
 * This file follows a module pattern where:
 * 1. All shared data lives in appState (single source of truth)
 * 2. Functions modify appState and update the UI
 * 3. Key functions are exported to window object for cross-file access
 *
 * ============================================================
 */


/* ============================================================
   SECTION 1: APPLICATION STATE MANAGEMENT
   ============================================================

   The appState object is the "single source of truth" for our entire
   application. This pattern (called "centralized state") makes it easier
   to understand where data lives and how it changes.

   All other parts of the application read from and write to this central location.

   We use JavaScript Map objects instead of regular objects because:
   - Maps maintain insertion order (useful for display)
   - Maps have better performance for frequent additions/deletions
   - Maps have built-in size property and iteration methods
   ============================================================ */

const appState = {
    /**
     * Collection of all towing jobs in the system
     * Key: jobId (string like "JOB-1234567890-123")
     * Value: job object with all job details
     */
    jobs: new Map(),

    /**
     * Collection of all trucks in the fleet
     * Key: truckId (string like "TRUCK-1")
     * Value: truck object with status, position, revenue, etc.
     */
    trucks: new Map(),

    /**
     * ID of the currently selected job (for dispatch panel)
     * null means no job is selected
     */
    selectedJobId: null,

    /**
     * Cumulative revenue for today
     * Updated each time a job is completed
     */
    totalRevenue: 0,

    /**
     * Current system time (used for simulation)
     * In this version, we use real browser time
     */
    systemTime: new Date(),

    /**
     * Milliseconds between simulation updates
     * 1000ms = 1 second (real-time simulation)
     * Lower = faster simulation, higher = slower
     */
    simulationSpeed: 1000,

    /**
     * Center point of the "hot zone" (primary service area)
     * This is the company headquarters location: 425 Industrial Avenue (City of Vancouver ByLaw Impound Yard)
     * Coordinates are in decimal degrees (latitude, longitude)
     */
    hotZoneCenter: { lat: 49.2697, lng: -123.0953 },

    /**
     * Radius of the hot zone in meters
     * 6000m = 6km - jobs within this area have no extra distance charge
     */
    hotZoneRadius: 6000
};


/* ============================================================
   SECTION 2: FLEET CONFIGURATION
   ============================================================

   This configuration defines the types of trucks in our fleet.
   Each truck type has different capabilities and limitations.

   BUSINESS RULES:
   - Flat deck trucks can handle retail jobs (car dealerships)
   - Heavy duty trucks handle larger vehicles (CAT3 jobs)
   - Light duty trucks handle underground parking and are fastest but have limitations
   ============================================================ */

const FLEET_CONFIG = {
    /**
     * Flat Deck Trucks
     * - Trucks with flat loading surface
     * - Can handle retail jobs (dealerships, car lots)
     * - Large height, slow speed
     */
    flatDeck: {
        count: 2,              // Number of this truck type in fleet
        type: 'flat_deck',     // Type identifier
        canDoRetail: true,     // Can accept retail (dealership) jobs
        height: 4.0,           // Height in meters (for parking garage access)
        baseSpeed: 45          // Average speed in km/h
    },

    /**
     * Heavy Duty Trucks
     * - Large trucks for bigger vehicles
     * - Required for CAT3 (larger vehicle) jobs
     * - Taller, slower, but more capable
     */
    heavyDuty: {
        count: 5,
        type: 'heavy_duty',
        canDoRetail: true,     
        height: 3.2,           
        baseSpeed: 50          
    },

    /**
     * Light Duty Trucks
     * - Standard tow trucks for typical vehicles
     * - Fastest response times
     * - Cannot handle CAT3 jobs
     */
    lightDuty: {
        count: 10,
        type: 'light_duty',
        canDoRetail: false,
        height: 2.2,           // Can access most parking structures
        baseSpeed: 60          // Fastest truck type
    }
};


/* ============================================================
   SECTION 3: JOB TYPE CONFIGURATION
   ============================================================

   Defines the different types of towing jobs the company handles.
   Each type has different urgency levels (SLA) and pricing.

   SLA = Service Level Agreement
   This is the maximum time allowed to arrive at the job site.
   Exceeding SLA can result in penalties or lost contracts.

   COLOR CODING (matches map.js markers):
   - Red    (#ff4444): Police   - highest urgency
   - Orange (#ff8c00): Bylaw    - high urgency
   - Blue   (#4169e1): Private  - medium urgency
   - Green  (#32cd32): Retail   - lower urgency
   ============================================================ */

const JOB_TYPES = {
    /**
     * Police Impounds
     * - Highest priority - 15 minute SLA
     * - Vehicles must be moved quickly for evidence/safety
     * - May include load time charges (vehicle processing)
     */
    police: {
        sla: 15,                // Must arrive within 15 minutes
        color: '#ff4444',    // Red - critical urgency
        priority: 4,          // Highest priority (1-4 scale)
        baseRate: 82.18      // Base charge in dollars
    },

    /**
     * Bylaw Enforcement
     * - High priority - 30 minute SLA
     * - Illegally parked vehicles, street cleaning, etc.
     */
    bylaw: {
        sla: 30,
        color: '#ff8c00',     // Orange - high urgency
        priority: 3,
        baseRate: 86.78       // Slightly higher base rate
    },

    /**
     * Private Requests
     * - Medium priority - 60 minute SLA
     * - Breakdown assistance, private property tows
     * - Some may have underground parking (height restrictions)
     */
    private: {
        sla: 60,
        color: '#4169e1',     // Blue - medium urgency
        priority: 2,
        baseRate: 82.18
    },

    /**
     * Retail (Dealership) Jobs
     * - Lower priority - 90 minute SLA
     * - Car dealership deliveries and pickups
     * - Requires flat deck truck capability
     */
    retail: {
        sla: 90,
        color: '#32cd32',     // Green - standard urgency
        priority: 1,            // Lowest priority
        baseRate: 82.18
    }
};


/* ============================================================
   SECTION 4: VANCOUVER STREET DATA
   ============================================================

   Array of real Vancouver street names for generating realistic
   job addresses. This makes the simulation more authentic and
   helps dispatchers practice with familiar locations.
   ============================================================ */

const VANCOUVER_STREETS = [
    'Granville St', 'Robson St', 'Hastings St', 'Broadway', 'Main St',
    'Commercial Dr', 'Cambie St', 'Oak St', 'Fraser St', 'Knight St',
    'Kingsway', 'Marine Dr', 'E 4th Ave', 'E 10th Ave', 'E 16th Ave',
    'Burrard St', 'Davie St', 'Denman St', 'Georgia St', 'Pender St',
    'Westminster Hwy', 'Lougheed Hwy', 'No. 3 Rd', 'No. 5 Rd', 'No. 6 Rd',
    'Steveston Hwy', 'Capilano Rd', 'Lonsdale Ave', 'Esplanade Ave',
    'Victoria Dr', 'Clark Dr', 'Adanac St', 'E 1st Ave', 'E 2nd Ave',
    'Richards St', 'Seymour St', 'Granville Ave', 'Cambie Rd', 'Kings Rd',
    'Boundary Rd', 'Vanness Ave', 'Templeton St', 'W 41st Ave', 'W 49th Ave'
];


/* ============================================================
   SECTION 5: APPLICATION INITIALIZATION
   ============================================================

   This section runs when the page loads. The DOMContentLoaded event
   fires when the HTML is fully parsed but before images/stylesheets
   are loaded - ideal time to initialize JavaScript.

   INITIALIZATION ORDER MATTERS:
   1. Initialize fleet (create trucks in memory)
   2. Set up event listeners (prepare for user interaction)
   3. Initialize panel resizers (make panels draggable)
   4. Initialize map (needs DOM to be ready)
   5. Start simulation (begin generating jobs and moving trucks)

   We use setTimeout for steps 4 and 5 to ensure:
   - The DOM is fully rendered
   - Other JavaScript files (map.js) are loaded
   - CSS dimensions are calculated (important for Leaflet)
   ============================================================ */

document.addEventListener('DOMContentLoaded', function() {
    console.log('Initializing Towing Dispatch System...');

    // STEP 1: Initialize the fleet
    // Creates all truck objects and adds them to appState.trucks
    initializeFleet();

    // STEP 2: Set up event listeners
    // Connects buttons, filters, and keyboard shortcuts to their handlers
    setupEventListeners();

    // STEP 3: Initialize panel resizers
    // Makes the dividers between panels draggable
    initPanelResizers();

    // STEP 4: Initialize the map (with delay)
    // setTimeout gives the DOM time to fully render
    // 250ms is enough for CSS to calculate panel dimensions
    setTimeout(() => {
        // Check if map.js loaded successfully
        if (typeof initializeMap === 'function') {
            initializeMap();
        } else {
            console.error('initializeMap function not found - check if map.js is loaded');
        }
    }, 250);

    // STEP 5: Start simulation and generate initial jobs
    // 500ms delay ensures map is ready before adding markers
    setTimeout(() => {
        // Begin the main simulation loop
        startSimulation();

        // Generate 5 initial jobs so the system isn't empty
        // This provides immediate data for the dispatcher to work with
        for (let i = 0; i < 5; i++) {
            generateJob();
        }

        // Update the jobs list display
        updateJobsDisplay();
    }, 500);
});


/* ============================================================
   SECTION 6: FLEET INITIALIZATION
   ============================================================

   Creates all trucks in our fleet based on FLEET_CONFIG.
   Each truck gets:
   - Unique ID (TRUCK-1, TRUCK-2, etc.)
   - Type-specific properties (speed, height, capabilities)
   - Random starting position (simulating trucks already on the road)
   - Initial status (available for dispatch)
   ============================================================ */

/**
 * Initializes the entire truck fleet based on configuration
 *
 * This function creates truck objects for each type defined in FLEET_CONFIG
 * and adds them to the appState.trucks Map.
 *
 * @example
 * // After running, appState.trucks will contain:
 * // "TRUCK-1" -> { id: "TRUCK-1", type: "flat_deck", status: "available", ... }
 * // "TRUCK-2" -> { id: "TRUCK-2", type: "flat_deck", status: "available", ... }
 * // ... and so on for all 17 trucks
 */
function initializeFleet() {
    // Counter for generating unique truck IDs
    let truckId = 1;

    /**
     * Helper function to create a single truck
     * Uses closure to access truckId counter from parent scope
     *
     * @param {Object} config - Truck type configuration from FLEET_CONFIG
     * @param {number} index - Index within this truck type (unused but available)
     * @returns {Object} The created truck object
     */
    const createTruck = (config, index) => {
        // Add speed variation (±25%) to simulate real-world differences
        // Math.random() returns 0-1, so 0.75 + (0-0.5) = 0.75-1.25 range
        // This means trucks of same type have slightly different speeds
        const speedVariation = 0.75 + (Math.random() * 0.5);

        // Create the truck object with all required properties
        const truck = {
            id: `TRUCK-${truckId++}`,           // Unique identifier (TRUCK-1, TRUCK-2, etc.)
            type: config.type,                  // Truck type (flat_deck, heavy_duty, light_duty)
            canDoRetail: config.canDoRetail,    // Whether truck can do retail jobs
            height: config.height,              // Height in meters (for parking restrictions)
            baseSpeed: config.baseSpeed * speedVariation, // Speed with random variation
            status: 'available',                // Current status: available, busy
            currentJob: null,                   // ID of assigned job (null if available)
            position: generateRandomPosition(), // Current GPS coordinates
            totalRevenue: 0,                    // Money earned by this truck today
            jobsCompleted: 0,                   // Number of jobs completed today
            lastUpdateTime: Date.now()          // Timestamp for position tracking
        };

        // Add truck to the global state Map
        appState.trucks.set(truck.id, truck);

        return truck;
    };

    // Create trucks for each type defined in FLEET_CONFIG
    // Using separate loops for clarity (could be combined)

    // Create flat deck trucks (2 trucks)
    for (let i = 0; i < FLEET_CONFIG.flatDeck.count; i++) {
        createTruck(FLEET_CONFIG.flatDeck, i);
    }

    // Create heavy duty trucks (5 trucks)
    for (let i = 0; i < FLEET_CONFIG.heavyDuty.count; i++) {
        createTruck(FLEET_CONFIG.heavyDuty, i);
    }

    // Create light duty trucks (10 trucks)
    for (let i = 0; i < FLEET_CONFIG.lightDuty.count; i++) {
        createTruck(FLEET_CONFIG.lightDuty, i);
    }

    // Log completion and update the UI
    console.log(`Fleet initialized with ${appState.trucks.size} trucks`);
    updateFleetStats();
}


/* ============================================================
   SECTION 7: JOB GENERATION
   ============================================================

   Creates new towing jobs with realistic data including:
   - Random job type (with weighted probabilities)
   - Random location (60% in hot zone, 40% outside)
   - Generated street address
   - Calculated revenue based on distance and type

   This simulates incoming service requests from police, bylaw,
   private citizens, and retail accounts.
   ============================================================ */

/**
 * Generates a new random towing job
 *
 * Creates a complete job object with all required properties,
 * adds it to the system, and updates both the UI and map.
 *
 * PROBABILITY DISTRIBUTION:
 * - 20% Police (high priority)
 * - 50% Bylaw (most common)
 * - 10% Private (less common)
 * - 20% Retail (regular business)
 *
 * @returns {Object} The created job object
 */
function generateJob() {
    // ===== STEP 1: Determine Job Type =====
    // Use weighted random selection to match real-world distribution
    // Math.random() returns a number between 0 and 1
    const jobTypeRoll = Math.random();
    let jobType;

    // Map random value ranges to job types
    if (jobTypeRoll < 0.20) {
        jobType = 'police';      // 0-0.20 = 20% chance
    } else if (jobTypeRoll < 0.70) {
        jobType = 'bylaw';       // 0.20-0.70 = 50% chance
    } else if (jobTypeRoll < 0.80) {
        jobType = 'private';     // 0.70-0.80 = 10% chance
    } else {
        jobType = 'retail';      // 0.80-1.00 = 20% chance
    }

    // ===== STEP 2: Generate Location =====
    // Creates GPS coordinates in or around Vancouver
    const location = generateJobLocation();

    // ===== STEP 3: Create Job Object =====
    // Build complete job with all required properties
    const job = {
        // Unique ID: "JOB-" + timestamp + random number
        // This ensures uniqueness even if jobs are created in same millisecond
        id: `JOB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,

        type: jobType,              // police, bylaw, private, or retail
        status: 'pending',          // pending, dispatched, or completed
        createdAt: new Date(),      // Timestamp for SLA tracking
        location: location,         // GPS coordinates { lat, lng }

        // Human-readable address (for display)
        address: generateAddress(location),

        // Vehicle category: CAT1 (standard) or CAT2 (larger vehicles)
        // 70% are standard vehicles, 30% are larger
        vehicleCategory: Math.random() < 0.7 ? 'CAT1' : 'CAT2',

        // Underground parking restriction (private jobs only, 30% chance)
        // If true, truck height must be under 3.0 meters
        hasUndergroundParking: jobType === 'private' && Math.random() < 0.3,

        // Police jobs have load time (vehicle processing at scene)
        // Random time between 0.5 and 2 hours
        loadTime: jobType === 'police' ? (0.5 + Math.random() * 1.5) : 0,

        // Distance from hot zone center (affects pricing)
        distance: calculateDistanceToHotZone(location),

        // Will be calculated below
        estimatedRevenue: 0,

        // Assigned truck ID (null until dispatched)
        assignedTruck: null,

        // Completion timestamp (null until completed)
        completedAt: null
    };

    // ===== STEP 4: Calculate Revenue =====
    // Based on distance, vehicle category, and load time
    job.estimatedRevenue = calculateJobRevenue(job);

    // ===== STEP 5: Add to System =====
    // Store in the central state Map
    appState.jobs.set(job.id, job);

    // ===== STEP 6: Update UI =====
    // Refresh the jobs list and statistics
    updateJobsDisplay();
    updateStats();

    // ===== STEP 7: Add Map Marker =====
    // Check if map.js is loaded before calling
    if (typeof addJobMarker === 'function') {
        addJobMarker(job);
    }

    console.log(`Generated new ${jobType} job: ${job.id}`);
    return job;
}

 
/* ============================================================
   SECTION 8: LOCATION GENERATION
   ============================================================

   Functions for generating random GPS coordinates.
   Uses the hot zone concept to concentrate jobs near HQ while
   still including some jobs in the greater Vancouver area.
   ============================================================ 
*/

/**
 * Generates a random job location
 *
 * 60% of jobs are within the hot zone (6km of HQ) for efficiency.
 * 40% are in the greater Vancouver area.
 *
 * Uses polar coordinates for hot zone to ensure even distribution
 * within the circular area (just using random lat/lng would cluster
 * points in the center).
 *
 * @returns {Object} Location with lat and lng properties
 */

function generateJobLocation() {
    // 60% of jobs within hot zone, 40% outside
    const inHotZone = Math.random() < 0.6;

    if (inHotZone) {
        // ===== Generate Within Hot Zone =====
        // Use polar coordinates for even distribution within circle

        // Random angle (0 to 2π radians = 360 degrees)
        const angle = Math.random() * 2 * Math.PI;

        // Random distance from center (0 to 6km)
        const distance = Math.random() * appState.hotZoneRadius;

        // Convert polar to cartesian coordinates
        // 111000 meters = approximately 1 degree of latitude
        // Longitude degrees are smaller near poles, so we adjust with cos(latitude)
        const lat = appState.hotZoneCenter.lat + (distance / 111000) * Math.cos(angle);
        const lng = appState.hotZoneCenter.lng + (distance / (111000 * Math.cos(appState.hotZoneCenter.lat * Math.PI / 180))) * Math.sin(angle);

        return { lat, lng };
    } else {
        // ===== Generate in Greater Vancouver =====
        // Simple random coordinates within city bounds
        // Latitude: 49.2 to 49.4 (north-south)
        // Longitude: -123.2 to -122.9 (west-east)
        const lat = 49.2 + Math.random() * 0.2;
        const lng = -123.2 + Math.random() * 0.3;

        return { lat, lng };
    }
}

/**
 * Generates a random starting position for trucks
 *
 * Similar to generateJobLocation but always uses the broader area
 * to simulate trucks being distributed across the city at start.
 *
 * @returns {Object} Position with lat and lng properties
 */
function generateRandomPosition() {
    const lat = 49.2 + Math.random() * 0.2;
    const lng = -123.2 + Math.random() * 0.3;
    return { lat, lng };
}

/**
 * Generates a realistic Vancouver street address
 *
 * Combines a random street number (100-9099) with a random
 * street name from our list of real Vancouver streets.
 *
 * @param {Object} location - GPS coordinates (not used in current implementation)
 * @returns {string} Street address like "1234 Granville St"
 */
function generateAddress(location) {
    // Random street number between 100 and 9099
    const streetNumber = Math.floor(Math.random() * 9000) + 100;

    // Random street from our Vancouver street list
    const street = VANCOUVER_STREETS[Math.floor(Math.random() * VANCOUVER_STREETS.length)];

    return `${streetNumber} ${street}`;
}


/* ============================================================
   SECTION 9: REVENUE CALCULATION
   ============================================================

   Implements the towing rate structure based on:
   - Base rate (depends on vehicle category)
   - Distance charge (for jobs outside 6km hot zone)
   - Load time charge (for police jobs)
   - Fuel surcharge (27% on total)

   This matches real-world towing industry pricing models.
   ============================================================ */

/**
 * Calculates the revenue for a job
 *
 * PRICING STRUCTURE:
 * 1. Base Rate: $82.18 (CAT1) or $86.78 (CAT2)
 * 2. Distance: $2.41/km (CAT1) or $2.80/km (CAT2) after first 6km
 * 3. Load Time: $77.85/hour for police jobs
 * 4. Fuel Surcharge: 27% of subtotal
 *
 * @param {Object} job - The job object
 * @returns {number} Total revenue rounded to 2 decimal places
 */
function calculateJobRevenue(job) {
    // Get configuration for this job type (not used for rate, but available)
    const jobConfig = JOB_TYPES[job.type];

    // Base rate depends on vehicle category
    // CAT1 = standard vehicles, CAT2 = larger vehicles
    const baseRate = job.vehicleCategory === 'CAT1' ? 82.18 : 86.78;

    // ===== Distance Charge =====
    // First 6km included in base rate, charge per km after that
    let distanceCharge = 0;
    if (job.distance > 6) {
        const extraKm = job.distance - 6;  // Kilometers beyond hot zone
        const perKmRate = job.vehicleCategory === 'CAT1' ? 2.41 : 2.80;
        distanceCharge = extraKm * perKmRate;
    }

    // ===== Load Time Charge =====
    // Only applies to police jobs (vehicle processing time)
    let loadTimeCharge = 0;
    if (job.type === 'police' && job.loadTime) {
        loadTimeCharge = job.loadTime * 77.85;  // $77.85 per hour
    }

    // ===== Calculate Total =====
    const subtotal = baseRate + distanceCharge + loadTimeCharge;

    // Apply 27% fuel surcharge (industry standard)
    const total = subtotal * 1.27;

    // Round to 2 decimal places for currency
    // Math.round(x * 100) / 100 is a common pattern for rounding
    return Math.round(total * 100) / 100;
}


/* ============================================================
   SECTION 10: DISTANCE CALCULATION
   ============================================================

   Implements the Haversine formula for calculating distance
   between two GPS coordinates on Earth's surface.

   This accounts for the curvature of the Earth, which is important
   for accurate distances over several kilometers.
   ============================================================ */

/**
 * Calculates distance from a location to the hot zone center
 *
 * @param {Object} location - Object with lat and lng properties
 * @returns {number} Distance in kilometers
 */
function calculateDistanceToHotZone(location) {
    // Use the general distance function with hot zone center
    return calculateDistance(appState.hotZoneCenter, location);
}

/**
 * Calculates distance between two GPS coordinates
 *
 * Uses the Haversine formula, which calculates the great-circle
 * distance between two points on a sphere (Earth).
 *
 * HAVERSINE FORMULA:
 * a = sin²(Δlat/2) + cos(lat1) × cos(lat2) × sin²(Δlng/2)
 * c = 2 × atan2(√a, √(1−a))
 * distance = R × c
 *
 * Where R is Earth's radius (6371 km)
 *
 * @param {Object} pos1 - First position { lat, lng }
 * @param {Object} pos2 - Second position { lat, lng }
 * @returns {number} Distance in kilometers
 */
function calculateDistance(pos1, pos2) {
    const R = 6371;  // Earth's radius in kilometers

    // Convert degrees to radians
    // Radians = Degrees × (π / 180)
    const lat1 = pos1.lat * Math.PI / 180;
    const lat2 = pos2.lat * Math.PI / 180;
    const deltaLat = (pos2.lat - pos1.lat) * Math.PI / 180;
    const deltaLng = (pos2.lng - pos1.lng) * Math.PI / 180;

    // Haversine formula
    const a = Math.sin(deltaLat/2) * Math.sin(deltaLat/2) +
              Math.cos(lat1) * Math.cos(lat2) *
              Math.sin(deltaLng/2) * Math.sin(deltaLng/2);

    // Central angle
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    // Distance = radius × central angle
    return R * c;
}


/* ============================================================
   SECTION 11: UI RENDERING FUNCTIONS
   ============================================================

   Functions that create and update the visual display.
   These functions read from appState and update the DOM
   (Document Object Model - the HTML structure).
   ============================================================ */

/**
 * Creates the HTML element for a single job
 *
 * Generates a job card with:
 * - Job type badge (color-coded)
 * - Address
 * - SLA timer (with urgency coloring)
 * - Revenue estimate
 * - Dispatch info (if assigned)
 *
 * @param {Object} job - The job object to render
 * @returns {HTMLElement} The job card element (not yet added to DOM)
 */
function renderJob(job) {
    // Create container div for the job card
    const jobElement = document.createElement('div');
    jobElement.className = 'job-item';
    jobElement.id = `job-${job.id}`;

    // Add data attributes for filtering
    // data-* attributes store custom data on elements
    jobElement.setAttribute('data-status', job.status);
    jobElement.setAttribute('data-type', job.type);

    // Add click handler to select this job
    // Arrow function () => preserves 'this' context
    jobElement.onclick = () => selectJob(job.id);

    // ===== Calculate SLA Status =====
    // How much time is left before SLA expires?
    const timeElapsed = (new Date() - job.createdAt) / 60000;  // Convert ms to minutes
    const timeRemaining = JOB_TYPES[job.type].sla - timeElapsed;

    // Color code based on urgency
    const slaClass = timeRemaining < 5 ? 'critical' :    // Less than 5 min = red
                     timeRemaining < 15 ? 'warning' :     // Less than 15 min = yellow
                     'safe';                              // Otherwise = green

    // ===== Add Status Classes =====
    if (job.status === 'dispatched') {
        jobElement.classList.add('dispatched');
    }

    if (timeRemaining < 5 && job.status === 'pending') {
        jobElement.classList.add('urgent');
    }

    // ===== Dispatch Info (if applicable) =====
    // Show which truck is assigned and when it was dispatched
    let dispatchInfo = '';
    if (job.status === 'dispatched' && job.dispatchedAt) {
        const dispatchElapsed = Math.floor((new Date() - job.dispatchedAt) / 60000);
        dispatchInfo = 
        `<div class="dispatch-info">
            <span class="dispatch-truck"> ${job.assignedTruck}</span>
            <span class="dispatch-time">${dispatchElapsed}min ago</span>
        </div>`;
    }

    // ===== Build HTML Content =====
    // Template literal (``) allows multi-line strings and ${} interpolation
    jobElement.innerHTML = `
        <div class="job-header">
            <span class="job-type ${job.type}">${job.type.toUpperCase()}</span>
            <span class="job-id">${job.id.substring(0, 12)}</span>
        </div>
        <div class="job-location">${job.address}</div>
        <div class="job-details">
            <span class="job-category">${job.vehicleCategory}</span>
            <span class="job-revenue">${job.estimatedRevenue}</span>
            <div class="job-sla">
                <span class="sla-timer ${slaClass}">${Math.floor(timeRemaining)}min</span>
            </div>
        </div>
        ${job.hasUndergroundParking ? '<div class="job-constraint"> Underground parking</div>' : ''}
        ${dispatchInfo}
    `;

    return jobElement;
}

/**
 * Updates the entire jobs list display
 *
 * This is the main function for refreshing the jobs panel.
 * It applies current filters, sorts jobs, and renders them.
 *
 * Called when:
 * - A new job is generated
 * - Filters are changed
 * - Search text is entered
 * - A job status changes
 */
function updateJobsDisplay() {
    // Get DOM elements
    const jobsList      = document.getElementById('jobsList');
    const statusFilter  = document.getElementById('jobStatusFilter').value;
    const typeFilter    = document.getElementById('jobTypeFilter').value;
    const searchTerm    = document.getElementById('jobSearch')?.value.toLowerCase() || '';

    // Clear current list
    jobsList.innerHTML = '';

    // Get all jobs from state
    const allJobs = Array.from(appState.jobs.values());

    // ===== Apply Filters =====
    // Array.filter() returns a new array with only matching items
    let filteredJobs = allJobs.filter(job => {
        // Status filter logic
        let statusMatch = false;
        if (statusFilter === 'active') {
            // "Active" means pending OR dispatched (not completed)
            statusMatch = job.status === 'pending' || job.status === 'dispatched';
        } else {
            statusMatch = job.status === statusFilter;
        }

        // Type filter logic
        const typeMatch = typeFilter === 'all' || job.type === typeFilter;

        // Search filter logic (matches address or job ID)
        const searchMatch = searchTerm === '' ||
                          job.address.toLowerCase().includes(searchTerm) ||
                          job.id.toLowerCase().includes(searchTerm);

        // Job must match ALL filters
        return statusMatch && typeMatch && searchMatch;
    });

    // ===== Sort Jobs =====
    // Array.sort() modifies array in place and returns it
    // Negative return = a before b, Positive = b before a, Zero = equal
    filteredJobs.sort((a, b) => {
        if (statusFilter === 'active') {
            // In active view, pending jobs come first
            if (a.status === 'pending' && b.status === 'dispatched') return -1;
            if (a.status === 'dispatched' && b.status === 'pending') return 1;

            // Within pending jobs, sort by urgency (least time remaining first)
            if (a.status === 'pending' && b.status === 'pending') {
                const aRemaining = JOB_TYPES[a.type].sla - ((new Date() - a.createdAt) / 60000);
                const bRemaining = JOB_TYPES[b.type].sla - ((new Date() - b.createdAt) / 60000);
                return aRemaining - bRemaining;  // Lower time = higher priority
            }

            // Within dispatched jobs, sort by dispatch time (most recent first)
            if (a.status === 'dispatched' && b.status === 'dispatched') {
                return b.dispatchedAt - a.dispatchedAt;
            }
        }

        // Default: newest first
        return b.createdAt - a.createdAt;
    });

    // ===== Render Jobs =====
    filteredJobs.forEach(job => {
        const jobElement = renderJob(job);
        jobsList.appendChild(jobElement);
    });

    // ===== Empty State =====
    // Show message if no jobs match filters
    if (filteredJobs.length === 0) {
        jobsList.innerHTML = '<div class="empty-state">No jobs match the current filters</div>';
    }
}

/**
 * Selects a job for dispatch
 *
 * When a dispatcher clicks on a job, this function:
 * 1. Updates the selection state
 * 2. Highlights the selected job in the list
 * 3. Centers the map on the job location
 * 4. Shows job details in the dispatch panel
 * 5. Calculates and displays truck recommendations
 *
 * @param {string} jobId - The ID of the job to select
 */
function selectJob(jobId) {
    // Update global state
    appState.selectedJobId = jobId;

    // Update visual selection in job list
    // Remove 'selected' class from all jobs, add to selected one
    document.querySelectorAll('.job-item').forEach(item => {
        item.classList.remove('selected');
    });
    document.getElementById(`job-${jobId}`).classList.add('selected');

    // Center map on selected job
    // Check if map.js function exists before calling
    if (typeof panToJob === 'function') {
        panToJob(jobId);
    }

    // Show job details in dispatch panel
    const job = appState.jobs.get(jobId);
    showSelectedJob(job);

    // Calculate and show truck recommendations
    // Check if dispatch.js function exists
    if (typeof calculateRecommendations === 'function') {
        const recommendations = calculateRecommendations(job);
        showRecommendations(recommendations);
    }
}

/**
 * Displays selected job details in the dispatch panel
 *
 * Shows the job's type, location, category, revenue, and any
 * special constraints (like underground parking).
 *
 * @param {Object} job - The job object to display
 */
function showSelectedJob(job) {
    const selectedJobDiv = document.getElementById('selectedJob');

    selectedJobDiv.innerHTML = `
        <div class="selected-job-info">
            <h3>Selected Job: ${job.id.substring(0, 12)}</h3>
            <p><strong>Type:</strong> ${job.type.toUpperCase()}</p>
            <p><strong>Location:</strong> ${job.address}</p>
            <p><strong>Category:</strong> ${job.vehicleCategory}</p>
            <p><strong>Revenue:</strong> $${job.estimatedRevenue}</p>
            ${job.hasUndergroundParking ? '<p><strong>⚠️ Underground parking - height restricted</strong></p>' : ''}
        </div>
    `;
}


/* ============================================================
   SECTION 12: STATISTICS UPDATES
   ============================================================

   Functions that update the header statistics bar.
   Called whenever jobs or trucks change state.
   ============================================================ */

/**
 * Updates the main statistics display
 *
 * Updates:
 * - Active jobs count (pending jobs)
 * - Total revenue earned today
 */
function updateStats() {
    // Count pending jobs (not dispatched or completed)
    const activeJobs = Array.from(appState.jobs.values())
        .filter(j => j.status === 'pending').length;

    document.getElementById('activeJobs').textContent = activeJobs;

    // Update total revenue with currency formatting
    document.getElementById('totalRevenue').textContent = `$${appState.totalRevenue.toFixed(2)}`;
}

/**
 * Updates fleet-related statistics
 *
 * Updates:
 * - Fleet status (available vs busy trucks)
 * - Jobs done count (total completed across all trucks)
 */
function updateFleetStats() {
    // Convert trucks Map to array for easier processing
    const trucks = Array.from(appState.trucks.values());

    // Count trucks by status
    const available = trucks.filter(t => t.status === 'available').length;
    const busy = trucks.filter(t => t.status === 'busy').length;

    // Sum up total jobs completed across all trucks
    // reduce() accumulates a single value from an array
    const totalJobs = trucks.reduce((sum, t) => sum + t.jobsCompleted, 0);

    // Update header stats display
    document.getElementById('fleetStatus').textContent = `${available} Available / ${busy} Busy`;
    document.getElementById('jobsDone').textContent = totalJobs;
}


/* ============================================================
   SECTION 13: SIMULATION ENGINE
   ============================================================

   The simulation engine runs the real-time updates that make
   the application feel alive. It handles:
   - System clock updates
   - Truck movement towards assigned jobs
   - Job completion detection
   - SLA timer updates
   - Random new job generation
   ============================================================ */

/**
 * Starts the main simulation loop
 *
 * Uses setInterval() to run updates at regular intervals.
 * Two separate intervals:
 * 1. Clock update (every 1 second)
 * 2. Main simulation (every simulationSpeed ms)
 */
function startSimulation() {
    // ===== Clock Update (every second) =====
    setInterval(() => {
        // Get current time and format as HH:MM
        const hours = new Date().getHours().toString().padStart(2, '0');
        const minutes = new Date().getMinutes().toString().padStart(2, '0');
        document.getElementById('systemTime').textContent = `${hours}:${minutes}`;
    }, 1000);

    // ===== Main Simulation Loop =====
    setInterval(() => {
        // Update truck positions (move towards their jobs)
        updateTruckPositions();

        // Check if any trucks have reached their destinations
        checkJobCompletions();

        // Update SLA countdown timers in job list
        updateSLATimers();

        // Random job generation (about 3% chance per tick)
        // This creates a new job roughly every 30-60 seconds
        if (Math.random() < 0.03) {
            generateJob();
        }

        // Refresh all statistics displays
        updateStats();
        updateFleetStats();
    }, appState.simulationSpeed);
}

/**
 * Updates positions of all busy trucks
 *
 * For each truck with an assigned job, calculates movement
 * towards the job location based on truck speed.
 */
function updateTruckPositions() {
    // Iterate over all trucks
    appState.trucks.forEach(truck => {
        // Only update busy trucks with assigned jobs
        if (truck.status === 'busy' && truck.currentJob) {
            const job = appState.jobs.get(truck.currentJob);

            if (job) {
                // Calculate remaining distance to job
                const distance = calculateDistance(truck.position, job.location);

                // Convert speed from km/h to km/s for per-tick calculation
                const speed = truck.baseSpeed / 3600;

                // Distance truck can travel in one simulation tick
                const moveDistance = speed * (appState.simulationSpeed / 1000);

                // Only move if not at destination (> 0.1km away)
                if (distance > 0.1) {
                    // Calculate interpolation ratio (how far to move as fraction of remaining distance)
                    // Math.min ensures we don't overshoot the destination
                    const ratio = Math.min(moveDistance / distance, 1);

                    // Linear interpolation of position
                    // newPos = oldPos + ratio * (destination - oldPos)
                    truck.position = {
                        lat: truck.position.lat + (job.location.lat - truck.position.lat) * ratio,
                        lng: truck.position.lng + (job.location.lng - truck.position.lng) * ratio
                    };

                    // Update truck marker on map
                    if (typeof updateTruckMarker === 'function') {
                        updateTruckMarker(truck);
                    }
                }
            }
        }
    });
}

/**
 * Checks if any trucks have reached their job destinations
 *
 * When a truck is within 0.1km of the job location, the job
 * is considered complete.
 */
function checkJobCompletions() {
    appState.trucks.forEach(truck => {
        if (truck.status === 'busy' && truck.currentJob) {
            const job = appState.jobs.get(truck.currentJob);

            if (job) {
                const distance = calculateDistance(truck.position, job.location);

                // Complete job when truck reaches destination (within 100m)
                if (distance < 0.1) {
                    completeJob(job, truck);
                }
            }
        }
    });
}

/**
 * Completes a job
 *
 * Updates both job and truck state, adds revenue, and removes
 * the job from the display.
 *
 * @param {Object} job - The job being completed
 * @param {Object} truck - The truck that completed the job
 */
function completeJob(job, truck) {
    // Update job status
    job.status = 'completed';
    job.completedAt = new Date();

    // Update truck status
    truck.status = 'available';
    truck.currentJob = null;
    truck.totalRevenue += job.estimatedRevenue;
    truck.jobsCompleted += 1;

    // Update global revenue
    appState.totalRevenue += job.estimatedRevenue;

    // Remove job from UI
    const jobElement = document.getElementById(`job-${job.id}`);
    if (jobElement) {
        jobElement.remove();
    }

    // Remove job marker from map
    if (typeof removeJobMarker === 'function') {
        removeJobMarker(job);
    }

    console.log(`Job ${job.id} completed by ${truck.id}. Revenue: $${job.estimatedRevenue}`);

    // Update statistics
    updateStats();
    updateFleetStats();
}

/**
 * Updates SLA timers in the jobs list
 *
 * Recalculates time remaining for each pending job and updates
 * the display with appropriate urgency coloring.
 */
function updateSLATimers() {
    appState.jobs.forEach(job => {
        // Only update pending jobs (dispatched jobs don't need SLA updates)
        if (job.status === 'pending') {
            const jobElement = document.getElementById(`job-${job.id}`);

            if (jobElement) {
                // Calculate time remaining
                const timeElapsed = (new Date() - job.createdAt) / 60000;
                const timeRemaining = JOB_TYPES[job.type].sla - timeElapsed;

                // Find and update the timer element
                const slaTimer = jobElement.querySelector('.sla-timer');

                if (slaTimer) {
                    // Update timer text (minimum 0)
                    slaTimer.textContent = `${Math.max(0, Math.floor(timeRemaining))}min`;

                    // Update urgency class
                    slaTimer.className = `sla-timer ${
                        timeRemaining < 5 ? 'critical' :
                        timeRemaining < 15 ? 'warning' :
                        'safe'
                    }`;

                    // Update job card urgent class
                    if (timeRemaining < 5) {
                        jobElement.classList.add('urgent');
                    } else {
                        jobElement.classList.remove('urgent');
                    }
                }
            }
        }
    });
}


/* ============================================================
   SECTION 14: EVENT LISTENERS
   ============================================================

   Sets up all user interaction handlers for the application.
   This function is called once during initialization.
   ============================================================ */

/**
 * Initializes all event listeners
 *
 * Connects UI elements to their handler functions:
 * - Buttons (generate job)
 * - Dropdowns (filters, recommendation mode)
 * - Text input (search)
 * - Keyboard shortcuts
 */
function setupEventListeners() {
    // ===== Generate Job Button =====
    document.getElementById('generateJob').addEventListener('click', generateJob);

    // ===== Filter Dropdowns =====
    // 'change' event fires when dropdown selection changes
    document.getElementById('jobTypeFilter').addEventListener('change', updateJobsDisplay);
    document.getElementById('jobStatusFilter').addEventListener('change', updateJobsDisplay);

    // ===== Search Input =====
    // 'input' event fires on every keystroke for real-time filtering
    const searchInput = document.getElementById('jobSearch');
    if (searchInput) {
        searchInput.addEventListener('input', updateJobsDisplay);
    }

    // ===== Recommendation Mode Selector =====
    // Recalculates recommendations when mode changes
    document.getElementById('recommendationMode').addEventListener('change', () => {
        if (appState.selectedJobId) {
            selectJob(appState.selectedJobId);  // Re-select to recalculate
        }
    });

    // ===== Keyboard Shortcuts =====
    // Provides quick access for power users
    document.addEventListener('keydown', (e) => {
        // Ctrl/Cmd + G: Generate new job
        if ((e.ctrlKey || e.metaKey) && e.key === 'g') {
            e.preventDefault();  // Prevent browser's default action
            generateJob();
        }

        // Ctrl/Cmd + F: Focus search box
        if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
            e.preventDefault();
            document.getElementById('jobSearch')?.focus();
        }

        // Escape: Clear selection
        if (e.key === 'Escape') {
            appState.selectedJobId = null;

            // Remove selection highlight from all jobs
            document.querySelectorAll('.job-item').forEach(item => {
                item.classList.remove('selected');
            });

            // Reset dispatch panel to empty state
            document.getElementById('selectedJob').innerHTML =
                '<p class="empty-state">Select a job to see recommendations</p>';
            document.getElementById('recommendationsList').innerHTML = '';
        }
    });
}

/**
 * Legacy filter function (now delegates to updateJobsDisplay)
 *
 * Kept for backwards compatibility if called from elsewhere.
 */
function filterJobs() {
    updateJobsDisplay();
}


/* ============================================================
   SECTION 15: UTILITY FUNCTIONS
   ============================================================

   Helper functions used by other parts of the application.
   ============================================================ */

/**
 * Assigns a truck to a job
 *
 * This is the core dispatch action. It:
 * 1. Validates that truck is available and job is pending
 * 2. Updates truck status to busy
 * 3. Updates job status to dispatched
 * 4. Refreshes the UI
 *
 * @param {string} truckId - ID of the truck to assign
 * @param {string} jobId - ID of the job to assign
 * @returns {boolean} True if assignment successful, false otherwise
 */
function assignTruckToJob(truckId, jobId) {
    // Get truck and job from state
    const truck = appState.trucks.get(truckId);
    const job = appState.jobs.get(jobId);

    // Validate both exist and are in correct states
    if (truck && job && truck.status === 'available' && job.status === 'pending') {
        // Update truck
        truck.status = 'busy';
        truck.currentJob = jobId;

        // Update job
        job.status = 'dispatched';
        job.assignedTruck = truckId;
        job.dispatchedAt = new Date();

        console.log(`Assigned ${truckId} to ${jobId}`);

        // Update UI
        updateStats();
        updateFleetStats();

        // Clear selection (job is now dispatched)
        appState.selectedJobId = null;
        document.getElementById('selectedJob').innerHTML =
            '<p class="empty-state">Select a job to see recommendations</p>';
        document.getElementById('recommendationsList').innerHTML = '';

        return true;
    }

    return false;
}


/* ============================================================
   SECTION 16: PANEL RESIZER FUNCTIONALITY
   ============================================================

   Implements draggable dividers between the three main panels.
   Users can resize panels by clicking and dragging the dividers.
   Panel sizes are saved to localStorage for persistence.

   TECHNICAL APPROACH:
   1. On mousedown: Record starting position and panel widths
   2. On mousemove: Calculate delta and resize panels
   3. On mouseup: Save sizes and cleanup
   ============================================================ */

/**
 * Initializes the panel resizer functionality
 *
 * Sets up mouse event handlers for the two resizer dividers.
 * Also restores any saved panel sizes from localStorage.
 */
function initPanelResizers() {
    // Get DOM elements
    const leftResizer = document.getElementById('resizer-left');
    const rightResizer = document.getElementById('resizer-right');
    const jobsPanel = document.querySelector('.jobs-panel');
    const dispatchPanel = document.querySelector('.dispatch-panel');
    const mainContent = document.querySelector('.main-content');

    // Validate elements exist
    if (!leftResizer || !rightResizer) {
        console.warn('Panel resizers not found');
        return;
    }

    // ===== State Variables =====
    // These track the current resize operation
    let isResizing = false;        // Is a resize in progress?
    let currentResizer = null;     // Which resizer is being dragged?
    let startX = 0;                // Mouse X at drag start
    let startWidthLeft = 0;        // Jobs panel width at drag start
    let startWidthRight = 0;       // Dispatch panel width at drag start

    // ===== Size Constraints =====
    // Minimum and maximum widths in pixels
    const constraints = {
        jobs: { min: 280, max: 500 },
        map: { min: 400 },              // Map only has minimum
        dispatch: { min: 300, max: 600 }
    };

    // ===== Restore Saved Sizes =====
    // localStorage persists data between browser sessions
    const savedSizes = localStorage.getItem('panelSizes');
    if (savedSizes) {
        try {
            const sizes = JSON.parse(savedSizes);

            // Apply saved widths using CSS flex property
            // flex: 0 0 Xpx means: don't grow, don't shrink, start at X pixels
            if (sizes.jobs) jobsPanel.style.flex = `0 0 ${sizes.jobs}px`;
            if (sizes.dispatch) dispatchPanel.style.flex = `0 0 ${sizes.dispatch}px`;

            // Tell Leaflet map to recalculate its size
            setTimeout(() => {
                if (typeof map !== 'undefined' && map.invalidateSize) {
                    map.invalidateSize();
                }
            }, 300);
        } catch (e) {
            console.warn('Failed to restore panel sizes:', e);
        }
    }

    /**
     * Saves current panel sizes to localStorage
     */
    function savePanelSizes() {
        const sizes = {
            jobs: jobsPanel.offsetWidth,
            dispatch: dispatchPanel.offsetWidth
        };
        localStorage.setItem('panelSizes', JSON.stringify(sizes));
    }

    /**
     * Handles start of resize operation
     *
     * @param {MouseEvent} e - The mousedown event
     * @param {string} resizer - Which resizer ('left' or 'right')
     */
    function startResize(e, resizer) {
        isResizing = true;
        currentResizer = resizer;
        startX = e.clientX;

        // Record starting widths
        if (resizer === 'left') {
            startWidthLeft = jobsPanel.offsetWidth;
        } else {
            startWidthRight = dispatchPanel.offsetWidth;
        }

        // Add visual feedback
        resizer === 'left' ? leftResizer.classList.add('dragging') : rightResizer.classList.add('dragging');

        // Change cursor for entire document during drag
        document.body.style.cursor = 'col-resize';

        // Prevent text selection during drag
        document.body.style.userSelect = 'none';

        e.preventDefault();
    }

    /**
     * Handles resize movement
     *
     * @param {MouseEvent} e - The mousemove event
     */
    function doResize(e) {
        if (!isResizing) return;

        // Calculate horizontal movement
        const dx = e.clientX - startX;
        const containerWidth = mainContent.offsetWidth - 16;  // Subtract padding

        if (currentResizer === 'left') {
            // ===== Resizing Jobs Panel (Left) =====
            let newWidth = startWidthLeft + dx;

            // Apply constraints
            newWidth = Math.max(constraints.jobs.min, Math.min(constraints.jobs.max, newWidth));

            // Check if map would be too small
            const remainingWidth = containerWidth - newWidth - dispatchPanel.offsetWidth - 16;
            if (remainingWidth >= constraints.map.min) {
                jobsPanel.style.flex = `0 0 ${newWidth}px`;
            }
        } else {
            // ===== Resizing Dispatch Panel (Right) =====
            // Note: dx is subtracted because dragging right shrinks dispatch panel
            let newWidth = startWidthRight - dx;

            // Apply constraints
            newWidth = Math.max(constraints.dispatch.min, Math.min(constraints.dispatch.max, newWidth));

            // Check if map would be too small
            const remainingWidth = containerWidth - jobsPanel.offsetWidth - newWidth - 16;
            if (remainingWidth >= constraints.map.min) {
                dispatchPanel.style.flex = `0 0 ${newWidth}px`;
            }
        }

        // Tell Leaflet to recalculate map size
        if (typeof map !== 'undefined' && map.invalidateSize) {
            map.invalidateSize();
        }
    }

    /**
     * Handles end of resize operation
     */
    function stopResize() {
        if (!isResizing) return;

        // Reset state
        isResizing = false;
        currentResizer = null;

        // Remove visual feedback
        leftResizer.classList.remove('dragging');
        rightResizer.classList.remove('dragging');
        document.body.style.cursor = '';
        document.body.style.userSelect = '';

        // Save new sizes
        savePanelSizes();

        // Final map size update
        if (typeof map !== 'undefined' && map.invalidateSize) {
            map.invalidateSize();
        }
    }

    // ===== Attach Event Listeners =====
    leftResizer.addEventListener('mousedown', (e) => startResize(e, 'left'));
    rightResizer.addEventListener('mousedown', (e) => startResize(e, 'right'));

    // mousemove and mouseup on document to catch events outside resizer
    document.addEventListener('mousemove', doResize);
    document.addEventListener('mouseup', stopResize);
}


/* ============================================================
   SECTION 17: EXPORTS
   ============================================================

   Makes key functions and data available to other JavaScript files.

   In the browser, each <script> file runs in the global scope,
   but variables defined with const/let are not automatically global.
   We explicitly attach them to the window object to share them.

   This pattern (explicit exports) makes dependencies clear:
   - map.js needs: appState
   - dispatch.js needs: appState, JOB_TYPES, assignTruckToJob, calculateDistance
   ============================================================ */

// Export application state for access from other modules
window.appState = appState;

// Export job type configuration for dispatch.js
window.JOB_TYPES = JOB_TYPES;

// Export the truck assignment function for dispatch.js
window.assignTruckToJob = assignTruckToJob;

// Export distance calculation for dispatch.js
window.calculateDistance = calculateDistance;
