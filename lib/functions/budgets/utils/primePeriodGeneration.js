"use strict";
/**
 * Prime Period Generation Utility
 *
 * Generates "prime" budget periods that match the budget's period type.
 * Prime periods are the authoritative source for budget allocation calculations.
 * Non-prime periods derive their amounts from overlapping prime periods.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPrimePeriodType = getPrimePeriodType;
exports.getNonPrimePeriodTypes = getNonPrimePeriodTypes;
exports.generatePrimeBudgetPeriods = generatePrimeBudgetPeriods;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../types");
/**
 * Maps a Budget's period field to the corresponding PeriodType
 *
 * @param budgetPeriod - The budget's period field (WEEKLY, MONTHLY, etc.)
 * @returns The corresponding PeriodType for prime period generation
 */
function getPrimePeriodType(budgetPeriod) {
    switch (budgetPeriod) {
        case types_1.BudgetPeriod.WEEKLY:
            return types_1.PeriodType.WEEKLY;
        case types_1.BudgetPeriod.MONTHLY:
            return types_1.PeriodType.MONTHLY;
        // BI_WEEKLY and BI_MONTHLY both map to BI_MONTHLY
        default:
            // For QUARTERLY, YEARLY, CUSTOM - default to MONTHLY
            return types_1.PeriodType.MONTHLY;
    }
}
/**
 * Returns the non-prime period types that should be generated for a budget
 *
 * @param budgetPeriod - The budget's period field
 * @returns Array of PeriodTypes that are non-prime for this budget
 */
function getNonPrimePeriodTypes(budgetPeriod) {
    const primePeriodType = getPrimePeriodType(budgetPeriod);
    // Return all period types except the prime type
    const allTypes = [types_1.PeriodType.WEEKLY, types_1.PeriodType.MONTHLY, types_1.PeriodType.BI_MONTHLY];
    return allTypes.filter(type => type !== primePeriodType);
}
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
 * Check if a budget period falls within the budget's active date range
 * Handles partial first/last periods when budget starts/ends mid-period
 */
function isWithinBudgetRange(periodStart, periodEnd, budgetStartDate, budgetEndDate) {
    const periodStartDate = periodStart.toDate();
    const periodEndDate = periodEnd.toDate();
    // Period overlaps with budget range if:
    // - Period starts before budget ends AND
    // - Period ends after budget starts
    return periodStartDate <= budgetEndDate && periodEndDate >= budgetStartDate;
}
/**
 * Calculate the actual start and end dates for a budget period,
 * considering the budget's start and end dates (for partial periods)
 */
function getActualPeriodDates(periodStart, periodEnd, budgetStartDate, budgetEndDate) {
    const periodStartDate = periodStart.toDate();
    const periodEndDate = periodEnd.toDate();
    // Use the later of period start or budget start
    const actualStart = periodStartDate < budgetStartDate ? budgetStartDate : periodStartDate;
    // Use the earlier of period end or budget end
    const actualEnd = periodEndDate > budgetEndDate ? budgetEndDate : periodEndDate;
    return { actualStart, actualEnd };
}
/**
 * Generate prime budget periods from source periods
 *
 * Prime periods:
 * - Match the budget's period type (budget.period)
 * - Have isPrime = true
 * - Calculate dailyRate = allocatedAmount / daysInPeriod
 * - Handle partial first/last periods (budget start/end mid-period)
 *
 * @param db - Firestore instance
 * @param budgetId - Budget document ID
 * @param budget - Budget document
 * @param startDate - Budget start date
 * @param endDate - Budget end date (for limited budgets) or 1 year from start (recurring)
 * @returns Array of prime budget period documents (not yet saved to Firestore)
 */
async function generatePrimeBudgetPeriods(db, budgetId, budget, startDate, endDate) {
    console.log(`[primePeriodGeneration] Generating PRIME periods for budget ${budgetId}`);
    console.log(`[primePeriodGeneration] Budget period type: ${budget.period}`);
    console.log(`[primePeriodGeneration] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    // Determine the prime period type
    const primePeriodType = getPrimePeriodType(budget.period);
    console.log(`[primePeriodGeneration] Prime period type: ${primePeriodType}`);
    // Query source_periods that match the prime period type and overlap with budget date range
    const sourcePeriodsQuery = db.collection('source_periods')
        .where('type', '==', primePeriodType)
        .where('endDate', '>=', firestore_1.Timestamp.fromDate(startDate))
        .where('startDate', '<=', firestore_1.Timestamp.fromDate(endDate));
    const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();
    if (sourcePeriodsSnapshot.empty) {
        console.warn(`[primePeriodGeneration] No ${primePeriodType} source periods found in date range`);
        return [];
    }
    console.log(`[primePeriodGeneration] Found ${sourcePeriodsSnapshot.size} ${primePeriodType} source periods`);
    const now = firestore_1.Timestamp.now();
    const primeBudgetPeriods = [];
    sourcePeriodsSnapshot.forEach((doc) => {
        var _a, _b, _c, _d, _e;
        const sourcePeriod = Object.assign({ id: doc.id }, doc.data());
        // Check if this period overlaps with the budget's date range
        if (!isWithinBudgetRange(sourcePeriod.startDate, sourcePeriod.endDate, startDate, endDate)) {
            return; // Skip periods outside budget range
        }
        // Calculate actual dates (handles partial first/last periods)
        const { actualStart, actualEnd } = getActualPeriodDates(sourcePeriod.startDate, sourcePeriod.endDate, startDate, endDate);
        // Calculate actual days in this specific period instance
        const actualStartTimestamp = firestore_1.Timestamp.fromDate(actualStart);
        const actualEndTimestamp = firestore_1.Timestamp.fromDate(actualEnd);
        const daysInPeriod = getDaysInPeriod(actualStartTimestamp, actualEndTimestamp);
        // Calculate allocated amount based on actual days
        // For prime periods: proportional allocation based on actual days vs full period days
        const fullPeriodDays = getDaysInPeriod(sourcePeriod.startDate, sourcePeriod.endDate);
        const allocatedAmount = (budget.amount * daysInPeriod) / fullPeriodDays;
        // Calculate daily rate for this prime period
        const dailyRate = allocatedAmount / daysInPeriod;
        console.log(`[primePeriodGeneration] Prime period ${sourcePeriod.id}:`, {
            fullPeriodDays,
            actualDays: daysInPeriod,
            allocatedAmount: allocatedAmount.toFixed(2),
            dailyRate: dailyRate.toFixed(2),
            actualStart: actualStart.toISOString().split('T')[0],
            actualEnd: actualEnd.toISOString().split('T')[0],
        });
        // Create prime budget period document
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
            periodStart: actualStartTimestamp,
            periodEnd: actualEndTimestamp,
            // Budget amounts
            allocatedAmount: Math.round(allocatedAmount * 100) / 100, // Round to 2 decimals
            originalAmount: Math.round(allocatedAmount * 100) / 100,
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
            // === PRIME PERIOD FIELDS ===
            isPrime: true,
            // Store dailyRate with 6 decimal precision for accurate non-prime calculations
            // Rounding to 2 decimals causes ~$10 loss per month when multiplied back
            dailyRate: Math.round(dailyRate * 1000000) / 1000000,
            daysInPeriod,
            primePeriodIds: [], // Prime periods don't reference other primes
            primePeriodBreakdown: [], // Prime periods have no breakdown
        };
        primeBudgetPeriods.push(budgetPeriod);
    });
    console.log(`[primePeriodGeneration] Generated ${primeBudgetPeriods.length} prime budget periods`);
    return primeBudgetPeriods;
}
//# sourceMappingURL=primePeriodGeneration.js.map