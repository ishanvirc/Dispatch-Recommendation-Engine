/**
 * ============================================================
 * TOWING DISPATCH SYSTEM - Intelligent Dispatch Engine (dispatch.js)
 * ============================================================
 *
 * This file implements the AI-powered recommendation algorithm that helps
 * dispatchers choose the best truck for each job. It's the "brain" of the
 * dispatch decision-making process.
 *
 * WHAT THIS FILE DOES:
 * --------------------
 * 1. TRUCK SCORING - Evaluates each available truck based on multiple factors
 * 2. RECOMMENDATIONS - Ranks trucks from best to worst for each job
 * 3. UI RENDERING - Displays recommendation cards with score breakdowns
 * 4. DISPATCH ACTIONS - Handles the actual truck-to-job assignment
 * 5. ANALYTICS - Provides fleet performance metrics
 *
 * THE RECOMMENDATION ALGORITHM:
 * -----------------------------
 * Each truck is scored on three factors (0-100 points each):
 *
 * 1. DISTANCE SCORE (35% default weight)
 *    - Closer trucks score higher
 *    - Minimizes response time and fuel costs
 *
 * 2. REVENUE FAIRNESS SCORE (35% default weight)
 *    - Trucks with lower earnings score higher
 *    - Ensures work is distributed fairly among drivers
 *
 * 3. URGENCY SCORE (30% default weight)
 *    - Based on job's SLA time remaining
 *    - Urgent jobs boost overall scores to prioritize dispatch
 *
 * SCORING MODES:
 * - Balanced: Equal consideration of all factors (default)
 * - Fastest Response: Prioritizes nearest truck (70% distance weight)
 * - Revenue Fairness: Prioritizes trucks with lower earnings (60% revenue weight)
 *
 * DEPENDENCIES:
 * -------------
 * This file requires app.js to be loaded first because it uses:
 * - appState: Access to trucks and jobs data
 * - JOB_TYPES: Job configuration (SLA times)
 * - calculateDistance(): Distance calculation function
 * - assignTruckToJob(): Core assignment function
 *
 * Also uses functions from map.js:
 * - updateTruckMarker(): Update truck position on map
 * - panToTruck(): Center map on truck
 *
 * KEY CONCEPTS:
 * -------------
 * - Weighted scoring: Combining multiple factors with different importance levels
 * - Constraint filtering: Eliminating trucks that can't do certain jobs
 * - Real-time updates: Recalculating when mode changes or trucks move
 *
 * ============================================================
 */


/* ============================================================
   SECTION 1: SCORING CONFIGURATION
   ============================================================

   Defines the weight factors for different scoring modes.
   These weights determine how much each factor contributes
   to the final truck score.

   All weights in a mode must sum to 1.0 (100%)

   DESIGN DECISIONS:
   - "Balanced" gives equal weight to efficiency and fairness
   - "Fastest" prioritizes quick response for urgent situations
   - "Revenue" helps balance earnings when jobs aren't time-critical
   ============================================================ */

const SCORING_WEIGHTS = {
    /**
     * Balanced Mode (Default)
     * Best for typical operations where all factors matter equally.
     * Provides a good mix of speed, fairness, and urgency handling.
     */
    balanced: {
        distance: 0.35,      // 35% weight on proximity (how close is the truck?)
        revenue: 0.35,       // 35% weight on revenue fairness (has this driver earned less?)
        urgency: 0.30        // 30% weight on job urgency (is the SLA running out?)
    },

    /**
     * Fastest Response Mode
     * Use when response time is critical (e.g., police impounds, accidents).
     * Heavily favors the nearest available truck.
     */
    fastest: {
        distance: 0.70,      // 70% weight - distance is most important
        revenue: 0.10,       // 10% weight - still consider fairness slightly
        urgency: 0.20        // 20% weight - urgency matters for prioritization
    },

    /**
     * Revenue Fairness Mode
     * Use during slow periods or for lower-priority jobs.
     * Prioritizes giving work to drivers who've earned less today.
     */
    revenue: {
        distance: 0.20,      // 20% weight - still want reasonable distance
        revenue: 0.60,       // 60% weight - fairness is paramount
        urgency: 0.20        // 20% weight - some urgency consideration
    }
};


/* ============================================================
   SECTION 2: MAIN RECOMMENDATION FUNCTION
   ============================================================

   This is the core function that generates truck recommendations
   for a given job. It coordinates the entire scoring process.

   ALGORITHM FLOW:
   1. Get all trucks that CAN do this job (filter by constraints)
   2. Get the current scoring mode from the UI
   3. Score each truck on distance, revenue fairness, and urgency
   4. Calculate weighted total score for each truck
   5. Sort trucks by total score (highest first)
   6. Return the ranked list
   ============================================================ */

/**
 * Calculates truck recommendations for a specific job
 *
 * This is the main entry point for the recommendation engine.
 * Called whenever a job is selected or the scoring mode changes.
 *
 * @param {Object} job - The job object to find trucks for
 * @returns {Array} Array of recommendation objects, sorted by score (best first)
 *
 * @example
 * // Returns array like:
 * // [
 * //   { truck: {...}, scores: {...}, totalScore: 85.5, distance: 2.3, eta: 5 },
 * //   { truck: {...}, scores: {...}, totalScore: 72.1, distance: 5.1, eta: 11 },
 * //   ...
 * // ]
 */
function calculateRecommendations(job) {
    console.log(`Calculating recommendations for job ${job.id}`);

    // ===== STEP 1: Get Available Trucks =====
    // Filter out trucks that are busy or can't handle this job
    const availableTrucks = getAvailableTrucks(job);

    // If no trucks available, return empty array
    if (availableTrucks.length === 0) {
        console.log('No available trucks for this job');
        return [];
    }

    // ===== STEP 2: Get Scoring Mode =====
    // Read the current mode from the dropdown selector
    const mode = document.getElementById('recommendationMode').value;
    const weights = SCORING_WEIGHTS[mode];

    // ===== STEP 3: Score Each Truck =====
    // Array.map() transforms each truck into a recommendation object
    const recommendations = availableTrucks.map(truck => {
        // Calculate individual scores for this truck
        const scores = calculateTruckScores(truck, job);

        // Calculate weighted total score
        const totalScore = calculateTotalScore(scores, weights);

        // Build recommendation object
        return {
            truck: truck,                              // Reference to truck object
            scores: scores,                            // Individual score breakdown
            totalScore: totalScore,                    // Combined weighted score
            distance: scores.distance.value,           // Raw distance in km
            eta: calculateETA(truck, job)              // Estimated time of arrival in minutes
        };
    });

    // ===== STEP 4: Sort by Total Score =====
    // Higher scores are better, so we sort descending (b - a)
    recommendations.sort((a, b) => b.totalScore - a.totalScore);

    // ===== STEP 5: Log Results =====
    // Helpful for debugging and understanding algorithm behavior
    console.log(`Top 3 recommendations for ${job.id}:`,
        recommendations.slice(0, 3).map(r => ({
            truck: r.truck.id,
            score: r.totalScore.toFixed(2),
            distance: r.distance.toFixed(1) + 'km'
        }))
    );

    return recommendations;
}


/* ============================================================
   SECTION 3: TRUCK FILTERING
   ============================================================

   Not all trucks can handle all jobs. This section filters out
   trucks that don't meet the job's requirements.

   CONSTRAINTS CHECKED:
   1. Status: Must be 'available' (not busy with another job)
   2. Retail capability: Only flat deck trucks can do retail jobs
   3. Height restriction: Underground parking limits truck height
   4. Vehicle category: CAT2 jobs need heavy or flat deck trucks
   ============================================================ */

/**
 * Gets all trucks that can handle a specific job
 *
 * Filters the fleet based on job constraints to find only
 * trucks that are both available AND capable.
 *
 * @param {Object} job - The job to check against
 * @returns {Array} Array of truck objects that can handle this job
 *
 * @example
 * // For a retail job, only returns flat deck trucks that are available
 * // For a job with underground parking, only returns trucks under 3m tall
 */
function getAvailableTrucks(job) {
    // Convert trucks Map to array for filtering
    const trucks = Array.from(appState.trucks.values());

    // Filter using multiple conditions
    // Array.filter() keeps only items where callback returns true
    return trucks.filter(truck => {
        // ===== CONSTRAINT 1: Availability =====
        // Truck must not be currently assigned to another job
        if (truck.status !== 'available') {
            return false;
        }

        // ===== CONSTRAINT 2: Retail Capability =====
        // Only flat deck trucks can handle retail (dealership) jobs
        // This is because retail jobs often need specialized equipment
        if (job.type === 'retail' && !truck.canDoRetail) {
            return false;
        }

        // ===== CONSTRAINT 3: Height Restriction =====
        // Underground parking garages have height limits
        // Typical limit is 2.5-3.0 meters, we use 3.0m threshold
        if (job.hasUndergroundParking && truck.height > 3.0) {
            return false;
        }

        // ===== CONSTRAINT 4: Vehicle Category =====
        // CAT2 (larger vehicles) need heavy duty or flat deck trucks
        // Light duty trucks can only handle CAT1 (standard vehicles)
        if (job.vehicleCategory === 'CAT2' && truck.type === 'light_duty') {
            return false;
        }

        // Truck passed all constraints - it can do this job
        return true;
    });
}


/* ============================================================
   SECTION 4: SCORE CALCULATION
   ============================================================

   This section contains the scoring algorithms that evaluate
   each truck on the three key factors.

   All scores are normalized to 0-100 scale for fair comparison.
   Higher scores are always better.
   ============================================================ */

/**
 * Calculates all scores for a truck-job pair
 *
 * This is the main scoring function that evaluates a truck
 * on all three factors for a specific job.
 *
 * @param {Object} truck - The truck to evaluate
 * @param {Object} job - The job being evaluated for
 * @returns {Object} Scores object with distance, revenue, and urgency
 *
 * @example
 * // Returns:
 * // {
 * //   distance: { value: 3.5, score: 85 },
 * //   revenue: { value: 250, score: 60 },
 * //   urgency: { value: 75, score: 75 }
 * // }
 */
function calculateTruckScores(truck, job) {
    // ===== Distance Score =====
    // How close is this truck to the job?
    const distance = calculateDistance(truck.position, job.location);
    const distanceScore = calculateDistanceScore(distance);

    // ===== Revenue Fairness Score =====
    // How does this truck's earnings compare to others?
    const revenueScore = calculateRevenueScore(truck);

    // ===== Urgency Score =====
    // How urgent is this job? (based on SLA time remaining)
    const urgencyScore = calculateUrgencyScore(job);

    // Return all scores in a structured format
    // Each score includes both the raw value and the 0-100 score
    return {
        distance: { value: distance, score: distanceScore },
        revenue: { value: truck.totalRevenue, score: revenueScore },
        urgency: { value: urgencyScore, score: urgencyScore }
    };
}


/* ============================================================
   SECTION 4.1: DISTANCE SCORE
   ============================================================

   Distance scoring uses a non-linear curve to reward proximity.
   Very close trucks get high scores, but scores decrease more
   slowly as distance increases (diminishing penalty).

   SCORE TIERS:
   - 0-2 km:   100 points (optimal range)
   - 2-5 km:   80-100 points (good range)
   - 5-10 km:  50-80 points (acceptable range)
   - 10-20 km: 20-50 points (far but possible)
   - >20 km:   10-20 points (too far, minimum score)
   ============================================================ */

/**
 * Calculates distance score (0-100)
 *
 * Uses a piecewise linear function that heavily rewards
 * trucks within 2km but still gives partial credit to
 * trucks farther away.
 *
 * @param {number} distance - Distance in kilometers
 * @returns {number} Score from 0-100 (higher is better)
 *
 * @example
 * calculateDistanceScore(1)   // Returns 100 (within optimal range)
 * calculateDistanceScore(3.5) // Returns ~90 (good range)
 * calculateDistanceScore(15)  // Returns ~35 (far)
 */
function calculateDistanceScore(distance) {
    // Tier 1: Optimal range (0-2 km) - Maximum score
    if (distance <= 2) {
        return 100;
    }

    // Tier 2: Good range (2-5 km) - Score decreases from 100 to 80
    // Formula: 100 - (distance - 2) * (20/3) = 100 - (distance - 2) * 6.67
    if (distance <= 5) {
        return 100 - (distance - 2) * 6.67;
    }

    // Tier 3: Acceptable range (5-10 km) - Score decreases from 80 to 50
    // Formula: 80 - (distance - 5) * (30/5) = 80 - (distance - 5) * 6
    if (distance <= 10) {
        return 80 - (distance - 5) * 6;
    }

    // Tier 4: Far range (10-20 km) - Score decreases from 50 to 20
    // Formula: 50 - (distance - 10) * (30/10) = 50 - (distance - 10) * 3
    if (distance <= 20) {
        return 50 - (distance - 10) * 3;
    }

    // Tier 5: Very far (>20 km) - Minimum score with gradual decrease
    // Score continues to decrease but never goes below 10
    return Math.max(10, 20 - (distance - 20) * 0.5);
}


/* ============================================================
   SECTION 4.2: REVENUE FAIRNESS SCORE
   ============================================================

   Revenue scoring promotes equity among drivers by giving
   higher scores to trucks with below-average earnings.

   This prevents situations where some drivers get all the
   good jobs while others sit idle.

   SCORING APPROACH:
   - Calculate average revenue across all trucks
   - Trucks below average get scores 50-100
   - Trucks above average get scores 20-50
   ============================================================ */

/**
 * Calculates revenue fairness score (0-100)
 *
 * Compares this truck's earnings to the fleet average.
 * Trucks earning less than average score higher to give
 * them priority for the next job.
 *
 * @param {Object} truck - The truck to evaluate
 * @returns {number} Score from 0-100 (higher means truck deserves more work)
 *
 * @example
 * // If average revenue is $500:
 * calculateRevenueScore({totalRevenue: 300}) // Returns ~90 (needs work)
 * calculateRevenueScore({totalRevenue: 500}) // Returns 50 (at average)
 * calculateRevenueScore({totalRevenue: 700}) // Returns ~30 (getting plenty)
 */
function calculateRevenueScore(truck) {
    // Get all trucks and calculate average revenue
    const allTrucks = Array.from(appState.trucks.values());

    // Array.reduce() sums up all revenues, then divide by count
    const avgRevenue = allTrucks.reduce((sum, t) => sum + t.totalRevenue, 0) / allTrucks.length;

    // Calculate how far this truck is from average
    // Positive = below average (deserves more work)
    // Negative = above average (has gotten plenty)
    const revenueDiff = avgRevenue - truck.totalRevenue;

    if (revenueDiff <= 0) {
        // ===== Truck at or above average =====
        // Score starts at 50 and decreases based on how far above average
        // Minimum score is 20 (everyone gets some chance)
        return Math.max(20, 50 - Math.abs(revenueDiff) / 10);
    } else {
        // ===== Truck below average =====
        // Score starts at 50 and increases based on how far below average
        // Maximum score is 100 (cap the bonus)
        return Math.min(100, 50 + revenueDiff / 5);
    }
}


/* ============================================================
   SECTION 4.3: URGENCY SCORE
   ============================================================

   Urgency scoring is based on the job's SLA time remaining.
   More urgent jobs (less time remaining) get higher scores,
   which boosts all truck scores for that job.

   This ensures urgent jobs rise to the top of the queue
   and get dispatched quickly.

   SCORE TIERS:
   - >75% time remaining: 30 points (not urgent)
   - 50-75% remaining: 30-50 points (becoming urgent)
   - 25-50% remaining: 50-80 points (urgent)
   - <25% remaining: 80-100 points (critical)
   ============================================================ */

/**
 * Calculates urgency score based on SLA time remaining
 *
 * Jobs with less time remaining get higher scores, which
 * acts as a multiplier boosting all truck scores for
 * urgent jobs.
 *
 * @param {Object} job - The job to evaluate
 * @returns {number} Score from 30-100 (higher means more urgent)
 *
 * @example
 * // For a police job (15 min SLA):
 * // At 12 minutes remaining (80%): score ~30 (not urgent yet)
 * // At 5 minutes remaining (33%): score ~70 (getting urgent)
 * // At 2 minutes remaining (13%): score ~95 (critical!)
 */
function calculateUrgencyScore(job) {
    // Calculate time elapsed since job creation (in minutes)
    const timeElapsed = (new Date() - job.createdAt) / 60000;

    // Get the SLA limit for this job type
    const sla = JOB_TYPES[job.type].sla;

    // Calculate time remaining
    const timeRemaining = sla - timeElapsed;

    // Express as percentage of SLA remaining
    const percentRemaining = timeRemaining / sla;

    // ===== Tier 1: Not Urgent (>75% remaining) =====
    // Base score of 30 - low urgency boost
    if (percentRemaining > 0.75) {
        return 30;
    }

    // ===== Tier 2: Becoming Urgent (50-75% remaining) =====
    // Score increases from 30 to 50
    // Formula: 30 + (0.75 - percentRemaining) * 80
    if (percentRemaining > 0.50) {
        return 30 + (0.75 - percentRemaining) * 80;
    }

    // ===== Tier 3: Urgent (25-50% remaining) =====
    // Score increases from 50 to 80
    // Formula: 50 + (0.50 - percentRemaining) * 120
    if (percentRemaining > 0.25) {
        return 50 + (0.50 - percentRemaining) * 120;
    }

    // ===== Tier 4: Critical (<25% remaining) =====
    // Score increases from 80 to 100
    // Formula: 80 + (0.25 - percentRemaining) * 80, capped at 100
    return Math.min(100, 80 + (0.25 - percentRemaining) * 80);
}


/* ============================================================
   SECTION 5: SCORE COMBINATION
   ============================================================

   Combines individual scores using weighted average.
   The weights depend on the selected scoring mode.
   ============================================================ */

/**
 * Calculates the total weighted score
 *
 * Combines the three individual scores using the weights
 * from the current scoring mode.
 *
 * FORMULA: total = (distance × weight_d) + (revenue × weight_r) + (urgency × weight_u)
 *
 * @param {Object} scores - Object with distance, revenue, urgency scores
 * @param {Object} weights - Weight factors for current mode
 * @returns {number} Combined score (0-100)
 *
 * @example
 * // Balanced mode example:
 * // scores = { distance: {score: 80}, revenue: {score: 60}, urgency: {score: 50} }
 * // weights = { distance: 0.35, revenue: 0.35, urgency: 0.30 }
 * // total = 80*0.35 + 60*0.35 + 50*0.30 = 28 + 21 + 15 = 64
 */
function calculateTotalScore(scores, weights) {
    return (
        scores.distance.score * weights.distance +
        scores.revenue.score * weights.revenue +
        scores.urgency.score * weights.urgency
    );
}


/* ============================================================
   SECTION 6: ETA CALCULATION
   ============================================================

   Estimates how long it will take a truck to reach the job.
   Uses simple distance ÷ speed calculation.
   ============================================================ */

/**
 * Calculates estimated time of arrival in minutes
 *
 * Simple calculation based on distance and truck speed.
 * In a real system, this would use actual route planning.
 *
 * @param {Object} truck - The truck (contains baseSpeed)
 * @param {Object} job - The job (contains location)
 * @returns {number} ETA in minutes (rounded up)
 *
 * @example
 * // Truck at 50 km/h, job 10 km away:
 * // Time = 10 / 50 = 0.2 hours = 12 minutes
 */
function calculateETA(truck, job) {
    // Calculate straight-line distance
    const distance = calculateDistance(truck.position, job.location);

    // Calculate time in hours (distance ÷ speed)
    const timeInHours = distance / truck.baseSpeed;

    // Convert to minutes
    const timeInMinutes = timeInHours * 60;

    // Round up to nearest minute (ceil = ceiling function)
    return Math.ceil(timeInMinutes);
}


/* ============================================================
   SECTION 7: UI RENDERING
   ============================================================

   Functions that display recommendations in the dispatch panel.
   Each recommendation is shown as a card with:
   - Truck info (ID, type)
   - Score badge with star rating
   - Details (distance, ETA, revenue, job count)
   - Score breakdown bars
   - "RECOMMENDED" label for top pick
   ============================================================ */

/**
 * Displays recommendations in the UI
 *
 * Clears the recommendations list and populates it with
 * cards for the top 5 recommended trucks.
 *
 * @param {Array} recommendations - Sorted array of recommendation objects
 */
function showRecommendations(recommendations) {
    // Get the container element
    const recommendationsList = document.getElementById('recommendationsList');

    // Clear existing recommendations
    recommendationsList.innerHTML = '';

    // Handle empty case
    if (recommendations.length === 0) {
        recommendationsList.innerHTML = '<p class="empty-state">No available trucks for this job</p>';
        return;
    }

    // Show top 5 recommendations
    // Array.slice(0, 5) gets first 5 elements
    recommendations.slice(0, 5).forEach((rec, index) => {
        // First item (index 0) is the top pick
        const isTopPick = index === 0;

        // Create the recommendation card element
        const recommendationElement = createRecommendationElement(rec, isTopPick);

        // Add to the list
        recommendationsList.appendChild(recommendationElement);
    });
}

/**
 * Creates a recommendation card element
 *
 * Builds the HTML for a single truck recommendation,
 * including the score breakdown visualization.
 *
 * @param {Object} recommendation - The recommendation object
 * @param {boolean} isTopPick - Whether this is the #1 recommendation
 * @returns {HTMLElement} The recommendation card element
 */
function createRecommendationElement(recommendation, isTopPick) {
    const truck = recommendation.truck;
    const scores = recommendation.scores;

    // Create container div
    const element = document.createElement('div');
    element.className = `recommendation-item ${isTopPick ? 'top-pick' : ''}`;

    // Get star rating based on total score
    const starRating = getStarRating(recommendation.totalScore);

    // ===== Build HTML Content =====
    // Using template literal for multi-line HTML
    element.innerHTML = `
        <div class="recommendation-header">
            <div class="truck-info">
                <span class="truck-id">${truck.id}</span>
                <span class="truck-type">${truck.type.replace('_', ' ')}</span>
            </div>
            <span class="score-badge">${starRating} ${recommendation.totalScore.toFixed(0)}</span>
        </div>
        <div class="recommendation-details">
            <div class="detail-item">
                <span class="detail-icon">▸</span>
                <span>${recommendation.distance.toFixed(1)}km away</span>
            </div>
            <div class="detail-item">
                <span class="detail-icon">▸</span>
                <span>ETA: ${recommendation.eta}min</span>
            </div>
            <div class="detail-item">
                <span class="detail-icon">▸</span>
                <span>$${truck.totalRevenue.toFixed(0)} earned</span>
            </div>
            <div class="detail-item">
                <span class="detail-icon">▸</span>
                <span>${truck.jobsCompleted} jobs</span>
            </div>
        </div>
        <div class="score-breakdown">
            <div class="score-bar">
                <div class="score-label">Distance</div>
                <div class="score-fill" style="width: ${scores.distance.score}%; background: #4169e1;"></div>
                <span class="score-value">${scores.distance.score.toFixed(0)}</span>
            </div>
            <div class="score-bar">
                <div class="score-label">Fairness</div>
                <div class="score-fill" style="width: ${scores.revenue.score}%; background: #32cd32;"></div>
                <span class="score-value">${scores.revenue.score.toFixed(0)}</span>
            </div>
            <div class="score-bar">
                <div class="score-label">Urgency</div>
                <div class="score-fill" style="width: ${scores.urgency.score}%; background: #ff8c00;"></div>
                <span class="score-value">${scores.urgency.score.toFixed(0)}</span>
            </div>
        </div>
        ${isTopPick ? '<div class="top-pick-label"> RECOMMENDED</div>' : ''}
    `;

    // ===== Add Event Handlers =====

    // Click to dispatch this truck
    element.addEventListener('click', () => {
        dispatchTruck(truck.id, appState.selectedJobId);
    });

    // Hover to show truck on map
    element.addEventListener('mouseenter', () => {
        panToTruck(truck.id);
    });

    return element;
}

/**
 * Converts a score to a star rating visualization
 *
 * @param {number} score - Score from 0-100
 * @returns {string} Star emojis representing the rating
 *
 * @example
 * getStarRating(95) // Returns "⭐⭐⭐⭐⭐"
 * getStarRating(75) // Returns "⭐⭐⭐"
 * getStarRating(55) // Returns "⭐"
 */
function getStarRating(score) {
    if (score >= 90) return '⭐⭐⭐⭐⭐';  // 5 stars: Excellent
    if (score >= 80) return '⭐⭐⭐⭐';    // 4 stars: Very Good
    if (score >= 70) return '⭐⭐⭐';      // 3 stars: Good
    if (score >= 60) return '⭐⭐';        // 2 stars: Fair
    return '⭐';                           // 1 star: Poor match
}


/* ============================================================
   SECTION 8: DISPATCH ACTIONS
   ============================================================

   Handles the actual process of assigning a truck to a job.
   Includes confirmation dialog and success notification.
   ============================================================ */

/**
 * Dispatches a truck to a job
 *
 * Called when user clicks on a recommendation card.
 * Shows confirmation dialog, then assigns truck if confirmed.
 *
 * @param {string} truckId - ID of the truck to dispatch
 * @param {string} jobId - ID of the job to assign
 */
function dispatchTruck(truckId, jobId) {
    // Validate that a job is selected
    if (!jobId) {
        alert('Please select a job first');
        return;
    }

    // Get truck and job objects
    const truck = appState.trucks.get(truckId);
    const job = appState.jobs.get(jobId);

    // Validate both exist
    if (!truck || !job) return;

    // ===== Confirmation Dialog =====
    // confirm() shows a browser dialog with OK/Cancel buttons
    // Returns true if user clicks OK, false if Cancel
    const confirmed = confirm(`Dispatch ${truck.id} to ${job.type} job at ${job.address}?`);

    if (confirmed) {
        // ===== Perform Assignment =====
        // assignTruckToJob is defined in app.js
        if (assignTruckToJob(truckId, jobId)) {
            // Show success notification
            showDispatchSuccess(truck, job);

            // Update truck marker on map (show it's now busy)
            updateTruckMarker(truck);

            // Animate job removal from list
            const jobElement = document.getElementById(`job-${jobId}`);
            if (jobElement) {
                // Add slide-out animation
                jobElement.style.animation = 'slideOut 0.3s ease';
                // Remove element after animation completes
                setTimeout(() => jobElement.remove(), 300);
            }
        }
    }
}

/**
 * Shows a success notification after dispatch
 *
 * Creates a temporary notification element that appears
 * in the top-right corner and auto-dismisses after 3 seconds.
 *
 * @param {Object} truck - The dispatched truck
 * @param {Object} job - The assigned job
 */
function showDispatchSuccess(truck, job) {
    // Create notification element
    const notification = document.createElement('div');
    notification.className = 'dispatch-notification success';

    // Build notification content
    notification.innerHTML = `
        <div class="notification-content">
            <span class="notification-icon">✅</span>
            <div class="notification-text">
                <strong>Dispatch Successful!</strong>
                <p>${truck.id} assigned to ${job.type} job</p>
            </div>
        </div>
    `;

    // Add to document body (appears as overlay)
    document.body.appendChild(notification);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        notification.remove();
    }, 3000);
}


/* ============================================================
   SECTION 9: DYNAMIC STYLES
   ============================================================

   Injects additional CSS styles needed for the dispatch UI.
   Using JavaScript to add styles keeps all dispatch-related
   code in one file.

   This approach is useful for:
   - Component-specific styles
   - Styles that need to be added dynamically
   - Keeping related code together
   ============================================================ */

// Create a <style> element to hold our CSS
const dispatchStyles = document.createElement('style');

// Define the CSS rules as a template literal string
dispatchStyles.textContent = `
    /*
     * Score Breakdown Section
     * Shows visual bars for each scoring factor
     */
    .score-breakdown {
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid var(--border-color);
    }

    /*
     * Individual Score Bar
     * Contains label, fill bar, and value
     */
    .score-bar {
        display: flex;
        align-items: center;
        margin-bottom: 6px;
        position: relative;
        height: 20px;
    }

    /*
     * Score Label (Distance, Fairness, Urgency)
     */
    .score-label {
        font-size: 0.75rem;
        color: var(--text-secondary);
        width: 60px;
        flex-shrink: 0;  /* Don't allow label to shrink */
    }

    /*
     * Score Fill Bar
     * Width is set dynamically based on score (0-100%)
     */
    .score-fill {
        height: 100%;
        border-radius: 3px;
        transition: width 0.5s ease;  /* Smooth animation when score changes */
        position: relative;
        min-width: 20px;  /* Minimum visible width */
    }

    /*
     * Score Value (number displayed inside bar)
     */
    .score-value {
        position: absolute;
        right: 5px;
        font-size: 0.7rem;
        font-weight: 600;
        color: white;
        text-shadow: 1px 1px 2px rgba(0, 0, 0, 0.5);  /* Improves readability */
    }

    /*
     * Top Pick Label
     * Highlighted label for the best recommendation
     */
    .top-pick-label {
        background: var(--gradient-secondary);
        color: white;
        text-align: center;
        padding: 6px;
        border-radius: 5px;
        margin-top: 10px;
        font-size: 0.85rem;
        font-weight: 600;
        letter-spacing: 0.5px;
        animation: glow 2s ease-in-out infinite;  /* Pulsing glow effect */
    }

    /*
     * Glow Animation
     * Creates pulsing box-shadow effect for top pick
     */
    @keyframes glow {
        0%, 100% { box-shadow: 0 0 5px rgba(233, 69, 96, 0.5); }
        50% { box-shadow: 0 0 20px rgba(233, 69, 96, 0.8); }
    }

    /*
     * Dispatch Notification
     * Toast-style notification in top-right corner
     */
    .dispatch-notification {
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--bg-panel);
        border: 2px solid var(--accent-success);
        border-radius: 10px;
        padding: 1rem 1.5rem;
        box-shadow: 0 4px 20px rgba(50, 205, 50, 0.5);
        z-index: 2000;  /* Above everything else */
        animation: slideInRight 0.3s ease;
    }

    /*
     * Notification Content Layout
     */
    .notification-content {
        display: flex;
        align-items: center;
        gap: 1rem;
    }

    /*
     * Notification Icon (checkmark)
     */
    .notification-icon {
        font-size: 2rem;
    }

    /*
     * Notification Text Styling
     */
    .notification-text strong {
        display: block;
        margin-bottom: 0.3rem;
        color: var(--text-primary);
    }

    .notification-text p {
        margin: 0;
        color: var(--text-secondary);
        font-size: 0.9rem;
    }

    /*
     * Slide In Animation (for notification)
     */
    @keyframes slideInRight {
        from {
            transform: translateX(100%);
            opacity: 0;
        }
        to {
            transform: translateX(0);
            opacity: 1;
        }
    }

    /*
     * Slide Out Animation (for job cards being removed)
     */
    @keyframes slideOut {
        to {
            transform: translateX(-100%);
            opacity: 0;
        }
    }
`;

// Add the style element to the document head
// This makes all the CSS rules active
document.head.appendChild(dispatchStyles);


/* ============================================================
   SECTION 10: ANALYTICS FUNCTIONS
   ============================================================

   Functions for calculating fleet performance metrics.
   These could be used for dashboards, reports, or
   algorithm tuning.
   ============================================================ */

/**
 * Gets comprehensive dispatch analytics
 *
 * Calculates various performance metrics for the fleet.
 * Useful for management dashboards or optimization.
 *
 * @returns {Object} Analytics object with all metrics
 */
function getDispatchAnalytics() {
    const trucks = Array.from(appState.trucks.values());
    const jobs = Array.from(appState.jobs.values());

    // Calculate all metrics
    const analytics = {
        avgResponseTime: calculateAvgResponseTime(),
        revenueDistribution: calculateRevenueDistribution(trucks),
        jobCompletionRate: calculateCompletionRate(jobs),
        fleetUtilization: calculateFleetUtilization(trucks),
        hotZoneEfficiency: calculateHotZoneEfficiency(jobs)
    };

    return analytics;
}

/**
 * Calculates average response time
 *
 * In a real system, this would track actual response times.
 * Currently returns a simulated value for demonstration.
 *
 * @returns {number} Average response time in minutes
 */
function calculateAvgResponseTime() {
    // TODO: Implement actual tracking
    // This simulates 15-25 minute average
    return Math.floor(Math.random() * 10 + 15);
}

/**
 * Calculates revenue distribution statistics
 *
 * Uses standard deviation to measure how evenly revenue
 * is distributed across drivers. Lower std dev = more fair.
 *
 * @param {Array} trucks - Array of truck objects
 * @returns {Object} Distribution metrics
 */
function calculateRevenueDistribution(trucks) {
    // Get all revenue values
    const revenues = trucks.map(t => t.totalRevenue);

    // Calculate average
    const avg = revenues.reduce((a, b) => a + b, 0) / revenues.length;

    // Calculate standard deviation
    // stdDev = sqrt( sum((x - mean)²) / n )
    const stdDev = Math.sqrt(
        revenues.reduce((sum, r) => sum + Math.pow(r - avg, 2), 0) / revenues.length
    );

    return {
        average: avg,
        standardDeviation: stdDev,
        // Fairness score: 100 when stdDev is 0, decreases as stdDev increases
        fairnessScore: Math.max(0, 100 - (stdDev / avg) * 100)
    };
}

/**
 * Calculates job completion rate
 *
 * Percentage of jobs that have been completed vs total jobs.
 *
 * @param {Array} jobs - Array of job objects
 * @returns {number} Completion rate as percentage (0-100)
 */
function calculateCompletionRate(jobs) {
    const completed = jobs.filter(j => j.status === 'completed').length;
    return jobs.length > 0 ? (completed / jobs.length) * 100 : 0;
}

/**
 * Calculates fleet utilization
 *
 * Percentage of trucks currently busy with jobs.
 * Higher utilization = more efficient use of fleet.
 *
 * @param {Array} trucks - Array of truck objects
 * @returns {number} Utilization rate as percentage (0-100)
 */
function calculateFleetUtilization(trucks) {
    const busy = trucks.filter(t => t.status === 'busy').length;
    return (busy / trucks.length) * 100;
}

/**
 * Calculates hot zone efficiency
 *
 * Percentage of jobs within the 6km hot zone.
 * Higher = more jobs in optimal service area.
 *
 * @param {Array} jobs - Array of job objects
 * @returns {number} Hot zone percentage (0-100)
 */
function calculateHotZoneEfficiency(jobs) {
    const hotZoneJobs = jobs.filter(j => j.distance <= 6).length;
    return jobs.length > 0 ? (hotZoneJobs / jobs.length) * 100 : 0;
}


/* ============================================================
   SECTION 11: EXPORTS
   ============================================================

   Makes key functions available to other JavaScript files.
   These functions are attached to the window object so they
   can be called from app.js and elsewhere.
   ============================================================ */

// Export recommendation function (called by app.js when job is selected)
window.calculateRecommendations = calculateRecommendations;

// Export show function (called by app.js to display recommendations)
window.showRecommendations = showRecommendations;

// Export analytics function (available for dashboard/debugging)
window.getDispatchAnalytics = getDispatchAnalytics;
