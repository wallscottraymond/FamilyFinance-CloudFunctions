"use strict";
/**
 * Non-Prime Period Generation Utility
 *
 * Generates "non-prime" budget periods that derive their allocated amounts
 * from overlapping prime periods using daily rate lookups.
 *
 * Algorithm (SUMPRODUCT equivalent):
 * For each day in the non-prime period:
 *   - Find which prime period contains that day
 *   - Get that prime's dailyRate
 *   - Add to running total
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.findOverlappingPrimePeriods = findOverlappingPrimePeriods;
exports.calculatePrimeContributions = calculatePrimeContributions;
exports.generateNonPrimeBudgetPeriods = generateNonPrimeBudgetPeriods;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Calculate the number of days in a period (inclusive)
 * Uses only date components (ignoring time) to avoid off-by-one errors
 * when end dates are stored with time 23:59:59.999
 */
function getDaysInPeriod(startDate, endDate) {
    const start = startDate.toDate();
    const end = endDate.toDate();
    // Normalize to UTC midnight to avoid timezone and time-of-day issues
    const startUTC = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const endUTC = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    // Calculate difference in days and add 1 for inclusive counting
    const diffDays = Math.round((endUTC - startUTC) / (1000 * 60 * 60 * 24));
    return diffDays + 1;
}
/**
 * Find all prime periods that overlap with the target date range
 *
 * @param targetStart - Target period start date
 * @param targetEnd - Target period end date
 * @param sortedPrimePeriods - Array of prime periods sorted by periodStart (ascending)
 * @returns Array of overlapping prime periods
 */
function findOverlappingPrimePeriods(targetStart, targetEnd, sortedPrimePeriods) {
    const overlapping = [];
    for (const prime of sortedPrimePeriods) {
        const primeStart = prime.periodStart.toDate();
        const primeEnd = prime.periodEnd.toDate();
        // Check if prime period overlaps with target period
        // Overlap if: prime starts before target ends AND prime ends after target starts
        if (primeStart <= targetEnd && primeEnd >= targetStart) {
            overlapping.push(prime);
        }
    }
    return overlapping;
}
/**
 * Calculate prime period contributions to a non-prime period
 *
 * Uses a day-by-day SUMPRODUCT approach:
 * - For each day in the target period
 * - Find which prime period contains that day
 * - Get that prime's daily rate
 * - Add to running total
 *
 * @param targetStart - Target period start date
 * @param targetEnd - Target period end date
 * @param overlappingPrimes - Prime periods that overlap with target
 * @returns Total allocated amount and detailed breakdown
 */
function calculatePrimeContributions(targetStart, targetEnd, overlappingPrimes) {
    if (overlappingPrimes.length === 0) {
        console.warn('[calculatePrimeContributions] No overlapping prime periods found');
        return { totalAmount: 0, breakdown: [] };
    }
    // Build a map of prime periods by their date ranges for fast lookup
    // Use UTC-normalized dates to avoid timezone issues
    const primesByDate = new Map();
    for (const prime of overlappingPrimes) {
        const primeStart = prime.periodStart.toDate();
        const primeEnd = prime.periodEnd.toDate();
        // Normalize to UTC date components to avoid timezone shifts
        let currentYear = primeStart.getUTCFullYear();
        let currentMonth = primeStart.getUTCMonth();
        let currentDay = primeStart.getUTCDate();
        const endYear = primeEnd.getUTCFullYear();
        const endMonth = primeEnd.getUTCMonth();
        const endDay = primeEnd.getUTCDate();
        // Add each day in the prime period to the map (inclusive of both start and end)
        while (currentYear < endYear ||
            (currentYear === endYear && currentMonth < endMonth) ||
            (currentYear === endYear && currentMonth === endMonth && currentDay <= endDay)) {
            const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;
            primesByDate.set(dateKey, prime);
            // Move to next day using UTC
            const nextDate = new Date(Date.UTC(currentYear, currentMonth, currentDay + 1));
            currentYear = nextDate.getUTCFullYear();
            currentMonth = nextDate.getUTCMonth();
            currentDay = nextDate.getUTCDate();
        }
    }
    // Track contributions from each prime period
    const contributionMap = new Map();
    let totalAmount = 0;
    // Iterate through each day in the target period using UTC-normalized dates
    let currentYear = targetStart.getUTCFullYear();
    let currentMonth = targetStart.getUTCMonth();
    let currentDay = targetStart.getUTCDate();
    const endYear = targetEnd.getUTCFullYear();
    const endMonth = targetEnd.getUTCMonth();
    const endDay = targetEnd.getUTCDate();
    while (currentYear < endYear ||
        (currentYear === endYear && currentMonth < endMonth) ||
        (currentYear === endYear && currentMonth === endMonth && currentDay <= endDay)) {
        const dateKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(currentDay).padStart(2, '0')}`;
        const prime = primesByDate.get(dateKey);
        if (prime) {
            // Found a prime period for this day
            const dailyRate = prime.dailyRate || 0;
            totalAmount += dailyRate;
            // Update contribution tracking
            const primeId = prime.id;
            if (!contributionMap.has(primeId)) {
                contributionMap.set(primeId, {
                    prime,
                    daysContributed: 0,
                    amountContributed: 0,
                    overlapStart: null,
                    overlapEnd: null,
                });
            }
            const contribution = contributionMap.get(primeId);
            contribution.daysContributed++;
            contribution.amountContributed += dailyRate;
            // Track overlap range
            if (contribution.overlapStart === null) {
                contribution.overlapStart = new Date(Date.UTC(currentYear, currentMonth, currentDay));
            }
            contribution.overlapEnd = new Date(Date.UTC(currentYear, currentMonth, currentDay));
        }
        else {
            console.warn(`[calculatePrimeContributions] No prime period found for date ${dateKey}`);
        }
        // Move to next day using UTC
        const nextDate = new Date(Date.UTC(currentYear, currentMonth, currentDay + 1));
        currentYear = nextDate.getUTCFullYear();
        currentMonth = nextDate.getUTCMonth();
        currentDay = nextDate.getUTCDate();
    }
    // Build breakdown array
    const breakdown = [];
    for (const [primeId, contribution] of contributionMap) {
        breakdown.push({
            primePeriodId: primeId,
            sourcePeriodId: contribution.prime.sourcePeriodId,
            daysContributed: contribution.daysContributed,
            dailyRate: contribution.prime.dailyRate || 0,
            amountContributed: Math.round(contribution.amountContributed * 100) / 100, // Round to 2 decimals
            overlapStart: firestore_1.Timestamp.fromDate(contribution.overlapStart),
            overlapEnd: firestore_1.Timestamp.fromDate(contribution.overlapEnd),
        });
    }
    // Calculate total days for verification
    const totalDaysCounted = breakdown.reduce((sum, b) => sum + b.daysContributed, 0);
    console.log('[calculatePrimeContributions] Calculation summary:', {
        targetRange: `${targetStart.toISOString().split('T')[0]} to ${targetEnd.toISOString().split('T')[0]}`,
        overlappingPrimes: overlappingPrimes.length,
        totalDaysCounted,
        totalAmount: totalAmount.toFixed(2),
        breakdownCount: breakdown.length,
        breakdownDetails: breakdown.map(b => ({
            primeId: b.primePeriodId.substring(0, 30),
            days: b.daysContributed,
            dailyRate: b.dailyRate.toFixed(6),
            amount: b.amountContributed.toFixed(2),
        })),
    });
    return {
        totalAmount: Math.round(totalAmount * 100) / 100, // Round to 2 decimals
        breakdown,
    };
}
/**
 * Generate non-prime budget periods for a specific period type
 *
 * Non-prime periods:
 * - Do NOT match the budget's period type
 * - Have isPrime = false
 * - Derive allocatedAmount from overlapping prime periods
 * - Include primePeriodIds and primePeriodBreakdown
 *
 * @param db - Firestore instance
 * @param budgetId - Budget document ID
 * @param budget - Budget document
 * @param primePeriods - Array of prime periods (MUST be sorted by periodStart)
 * @param startDate - Budget start date
 * @param endDate - Budget end date
 * @param targetPeriodType - The non-prime period type to generate
 * @returns Array of non-prime budget period documents (not yet saved to Firestore)
 */
async function generateNonPrimeBudgetPeriods(db, budgetId, budget, primePeriods, startDate, endDate, targetPeriodType) {
    console.log(`[nonPrimePeriodGeneration] Generating NON-PRIME ${targetPeriodType} periods for budget ${budgetId}`);
    console.log(`[nonPrimePeriodGeneration] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    console.log(`[nonPrimePeriodGeneration] Using ${primePeriods.length} prime periods as reference`);
    if (primePeriods.length === 0) {
        console.warn('[nonPrimePeriodGeneration] No prime periods provided - cannot generate non-prime periods');
        return [];
    }
    // Sort prime periods by start date (ascending) for efficient lookup
    const sortedPrimePeriods = [...primePeriods].sort((a, b) => a.periodStart.toMillis() - b.periodStart.toMillis());
    // Query source_periods that match the target period type and overlap with budget date range
    const sourcePeriodsQuery = db.collection('source_periods')
        .where('type', '==', targetPeriodType)
        .where('endDate', '>=', firestore_1.Timestamp.fromDate(startDate))
        .where('startDate', '<=', firestore_1.Timestamp.fromDate(endDate));
    const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();
    if (sourcePeriodsSnapshot.empty) {
        console.warn(`[nonPrimePeriodGeneration] No ${targetPeriodType} source periods found in date range`);
        return [];
    }
    console.log(`[nonPrimePeriodGeneration] Found ${sourcePeriodsSnapshot.size} ${targetPeriodType} source periods`);
    const now = firestore_1.Timestamp.now();
    const nonPrimeBudgetPeriods = [];
    sourcePeriodsSnapshot.forEach((doc) => {
        var _a, _b, _c, _d, _e;
        const sourcePeriod = Object.assign({ id: doc.id }, doc.data());
        const targetStart = sourcePeriod.startDate.toDate();
        const targetEnd = sourcePeriod.endDate.toDate();
        // Find overlapping prime periods
        const overlappingPrimes = findOverlappingPrimePeriods(targetStart, targetEnd, sortedPrimePeriods);
        if (overlappingPrimes.length === 0) {
            console.warn(`[nonPrimePeriodGeneration] No overlapping primes for ${sourcePeriod.id} - skipping`);
            return;
        }
        // Calculate allocated amount from prime contributions
        const { totalAmount, breakdown } = calculatePrimeContributions(targetStart, targetEnd, overlappingPrimes);
        // Calculate days in this period
        const daysInPeriod = getDaysInPeriod(sourcePeriod.startDate, sourcePeriod.endDate);
        // Calculate daily rate for this non-prime period (for reference)
        const dailyRate = totalAmount / daysInPeriod;
        // Extract prime period IDs
        const primePeriodIds = overlappingPrimes.map(p => p.id);
        console.log(`[nonPrimePeriodGeneration] Non-prime period ${sourcePeriod.id}:`, {
            daysInPeriod,
            allocatedAmount: totalAmount.toFixed(2),
            dailyRate: dailyRate.toFixed(2),
            overlappingPrimes: overlappingPrimes.length,
            primeContributions: breakdown.length,
        });
        // Create non-prime budget period document
        const budgetPeriod = {
            id: `${budgetId}_${doc.id}`,
            budgetId: budgetId,
            periodId: doc.id,
            sourcePeriodId: doc.id,
            // === INHERIT RBAC FIELDS FROM PARENT BUDGET ===
            createdBy: ((_a = budget.access) === null || _a === void 0 ? void 0 : _a.createdBy) || budget.createdBy,
            ownerId: ((_b = budget.access) === null || _b === void 0 ? void 0 : _b.ownerId) || budget.ownerId,
            groupId: budget.groupId,
            isPrivate: (_d = (_c = budget.access) === null || _c === void 0 ? void 0 : _c.isPrivate) !== null && _d !== void 0 ? _d : budget.isPrivate,
            accessibleBy: budget.accessibleBy,
            // === LEGACY FIELDS (Backward compatibility) ===
            familyId: String(budget.familyId || ''),
            userId: ((_e = budget.access) === null || _e === void 0 ? void 0 : _e.createdBy) || budget.createdBy,
            // Period context
            periodType: sourcePeriod.type,
            periodStart: sourcePeriod.startDate,
            periodEnd: sourcePeriod.endDate,
            // Budget amounts (derived from primes)
            allocatedAmount: totalAmount,
            originalAmount: totalAmount,
            // Budget metadata
            budgetName: budget.name,
            checklistItems: [],
            // User modification fields
            isModified: false,
            // System fields
            createdAt: now,
            updatedAt: now,
            lastCalculated: now,
            isActive: true,
            // === NON-PRIME PERIOD FIELDS ===
            isPrime: false,
            dailyRate: Math.round(dailyRate * 100) / 100, // Round to 2 decimals
            daysInPeriod,
            primePeriodIds,
            primePeriodBreakdown: breakdown,
        };
        nonPrimeBudgetPeriods.push(budgetPeriod);
    });
    console.log(`[nonPrimePeriodGeneration] Generated ${nonPrimeBudgetPeriods.length} non-prime ${targetPeriodType} periods`);
    return nonPrimeBudgetPeriods;
}
//# sourceMappingURL=nonPrimePeriodGeneration.js.map