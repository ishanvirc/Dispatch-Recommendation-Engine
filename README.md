# Intelligent Dispatch Recommendation Engine

**A real-time fleet monitoring and intelligent dispatch recommendation prototype for towing operations.**

> **⚠️ Prototype Disclaimer:** This repository contains a **working prototype** built to demonstrate the core concepts behind an Intelligent Dispatch Recommendation Engine. The production system is currently under active development at Buster's Towing (All Tech Transport Ltd.) and **cannot be published due to confidentiality agreements and proprietary business logic**. This prototype uses simulated data and simplified algorithms to showcase the architecture and approach.

---

## Background

As an Operations Coordinator at All Tech Transport Ltd., I coordinate multi-stakeholder towing operations across ICBC, Vancouver Police Department, City of Vancouver Bylaw Enforcement, and private businesses — handling approximately **130,000 annual jobs** under real-time constraints.

Through operational data analysis, I identified systematic inefficiencies in dispatch workflows: trucks being assigned without considering revenue fairness, response time optimization, or constraint satisfaction (vehicle category, parking restrictions, equipment requirements). These findings directly motivated the design of this Intelligent Dispatch Recommendation Engine.

This prototype demonstrates the concepts and algorithms that underpin the production system.

---

## Features

### Real-Time Fleet Map
- Interactive Leaflet.js map centered on Vancouver, BC with dark CARTO tile layer
- Live truck position tracking with smooth movement animation
- Color-coded job markers (Police 🔴, Bylaw 🟠, Private 🔵, Retail 🟢)
- 6km hot zone visualization around company HQ (425 Industrial Avenue)
- Clickable markers with detailed popups for trucks and jobs

### Intelligent Dispatch Recommendation Engine
The core algorithm scores each available truck across three weighted factors:

| Factor | Description | Balanced | Fastest | Revenue Fairness |
|--------|-------------|----------|---------|------------------|
| **Distance** | Proximity to job site | 35% | 70% | 20% |
| **Revenue Fairness** | Equity of earnings across drivers | 35% | 10% | 60% |
| **Urgency** | SLA time remaining | 30% | 20% | 20% |

Three selectable dispatch modes allow operators to prioritize based on operational context.

### Constraint-Based Truck Filtering
Before scoring, the system filters out trucks that cannot physically handle a job:
- **Availability** — only idle trucks are considered
- **Retail capability** — only flat deck trucks can service dealership jobs
- **Height restrictions** — underground parking jobs exclude trucks over 3.0m
- **Vehicle category** — CAT2 (larger vehicles) require heavy duty or flat deck equipment

### Job Management
- Weighted random job generation reflecting real-world distribution (20% Police, 50% Bylaw, 10% Private, 20% Retail)
- SLA countdown timers with color-coded urgency indicators
- Filterable and searchable job queue
- Revenue calculation with base rates, distance charges, load time, and 27% fuel surcharge

### Fleet Configuration
| Type | Count | Height | Speed | Retail Capable |
|------|-------|--------|-------|----------------|
| Flat Deck | 2 | 4.0m | ~45 km/h | ✅ |
| Heavy Duty | 5 | 3.2m | ~50 km/h | ✅ |
| Light Duty | 10 | 2.2m | ~60 km/h | ❌ |

---

## Getting Started

### Prerequisites
- A modern web browser (Chrome, Firefox, Edge, or Safari)
- No server, build tools, or dependencies required — runs entirely client-side

### Installation & Usage

1. **Clone the repository:**
   ```bash
   git clone https://github.com/ishanvirc/Dispatch-Recommendation-Engine.git
   cd Dispatch-Recommendation-Engine
   ```

2. **Open the application:**
   ```bash
   # Simply open index.html in your browser
   open index.html        # macOS
   start index.html       # Windows
   xdg-open index.html    # Linux
   ```
   Or drag and drop `index.html` into any browser window.

3. **Interact with the system:**
   - Click **"Generate New Job"** to create new towing requests
   - Click any job in the left panel to select it and view dispatch recommendations on the right
   - Use the **recommendation mode dropdown** to switch between Balanced, Fastest Response, and Revenue Fairness
   - Click a recommendation card to dispatch that truck to the job
   - Watch trucks move toward their assigned jobs on the map in real time
   - Use the **filter dropdowns** and **search bar** to manage the job queue

### Keyboard Shortcuts
| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + G` | Generate new job |
| `Ctrl/Cmd + F` | Focus search box |
| `Escape` | Clear job selection |

---

## Project Structure

```
towing-dispatch-system/
├── index.html       # Main HTML — three-panel layout (jobs, map, dispatch)
├── styles.css       # Dark theme stylesheet with CSS custom properties
├── app.js           # Core logic: state management, fleet init, job generation, simulation
├── map.js           # Leaflet.js integration: markers, hot zone, popups, controls
├── dispatch.js      # Recommendation engine: scoring, filtering, ranking, UI
└── README.md
```

### Architecture

The application follows a centralized state pattern:

- **`appState`** (in `app.js`) is the single source of truth — all trucks, jobs, and system data live here
- **`app.js`** manages the simulation loop, job lifecycle, and fleet state
- **`map.js`** reads from `appState` to render and update map elements
- **`dispatch.js`** reads from `appState` to score trucks and render recommendations
- Cross-file communication uses explicit `window` exports

---

## How the Scoring Algorithm Works

When a dispatcher selects a job, the engine:

1. **Filters** the fleet to only trucks that satisfy all hard constraints
2. **Scores** each remaining truck on distance (0–100), revenue fairness (0–100), and urgency (0–100)
3. **Combines** scores using the selected mode's weights into a single composite score
4. **Ranks** trucks by composite score and presents the top 5 with full score breakdowns

The distance score uses a tiered piecewise function that heavily rewards trucks within 2km while still giving partial credit at longer ranges. Revenue fairness compares each truck's earnings against the fleet average, boosting trucks that have earned less. Urgency is derived from the job's SLA percentage remaining and acts as a global multiplier — ensuring critical jobs get dispatched faster regardless of mode.

---

## Technologies

- **Vanilla JavaScript** — no frameworks, no build step
- **Leaflet.js** — open-source interactive mapping
- **CARTO Dark Matter** — dark-themed map tiles
- **CSS Custom Properties** — consistent theming with variables
- **Haversine Formula** — accurate geographic distance calculation

---

## Production System (Confidential)

The production system under development at Buster's Towing extends this prototype with:

- Integration with live dispatch data (~130,000 jobs/year)
- Automated License Plate Recognition (ALPR) for gate operations
- Real GPS telemetry from fleet vehicles
- Historical performance analytics and reporting
- Role-based access for dispatchers, drivers, and management

These components involve proprietary business logic and operational data that cannot be shared publicly.

---

## License

This prototype is provided for demonstration and portfolio purposes.

---

## Contact

[**Ishan**](https://www.linkedin.com/in/ishanvirchoongh/?lipi=urn%3Ali%3Apage%3Ad_flagship3_profile_view_base_contact_details%3Bkn%2FOB8uqQESklX%2BSxpN1uA%3D%3D) — Operations Coordinator at All Tech Transport Ltd. | UBC Cognitive Systems Graduate

Feel free to open an issue or reach out with questions about the dispatch optimization approach.
