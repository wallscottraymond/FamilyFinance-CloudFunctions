"use strict";
/**
 * Rollover Chain Calculation Utility
 *
 * Calculates and persists rollover amounts for budget periods.
 * Rollover chains are calculated per period type (weekly→weekly, monthly→monthly).
 *
 * Key behaviors:
 * - Calculates rollover sequentially through the period chain
 * - Persists rolledOverAmount to each period document
 * - Updates remaining to include rollover (allocated + rollover - spent)
 * - Respects per-budget and global rollover settings
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.recalculateRolloverChain = recalculateRolloverChain;
exports.recalculateRolloverForCurrentPeriods = recalculateRolloverForCurrentPeriods;
const firestore_1 = require("firebase-admin/firestore");
const rolloverCalculation_1 = require("./rolloverCalculation");
/**
 * Recalculate rollover for all periods of a budget, starting from a specific period.
 *
 * @param db - Firestore instance
 * @param budgetId - The budget ID to recalculate
 * @param startFromPeriodId - Optional: Start recalculation from this period (for efficiency)
 * @param periodTypes - Optional: Only recalculate specific period types
 * @returns Result with counts and any errors
 */
async function recalculateRolloverChain(db, budgetId, startFromPeriodId, periodTypes) {
    var _a, _b;
    const result = {
        success: true,
        periodsUpdated: 0,
        periodsByType: {},
        errors: [],
    };
    console.log('[recalculateRolloverChain] ════════════════════════════════════════════');
    console.log('[recalculateRolloverChain] STARTING ROLLOVER CHAIN CALCULATION');
    console.log('[recalculateRolloverChain] ════════════════════════════════════════════');
    console.log(`[recalculateRolloverChain] Budget ID: ${budgetId}`);
    console.log(`[recalculateRolloverChain] Start from period: ${startFromPeriodId || 'beginning'}`);
    console.log(`[recalculateRolloverChain] Period types: ${(periodTypes === null || periodTypes === void 0 ? void 0 : periodTypes.join(', ')) || 'all'}`);
    try {
        // 1. Fetch the budget to get rollover settings
        const budgetDoc = await db.collection('budgets').doc(budgetId).get();
        if (!budgetDoc.exists) {
            result.success = false;
            result.errors.push(`Budget ${budgetId} not found`);
            return result;
        }
        const budget = Object.assign({ id: budgetDoc.id }, budgetDoc.data());
        // 2. Fetch user's financial settings for global defaults
        const userId = budget.userId || budget.createdBy;
        let userFinancialSettings;
        if (!userId) {
            console.warn('[recalculateRolloverChain] No userId found on budget, using default settings');
        }
        try {
            if (userId) {
                const userDoc = await db.collection('users').doc(userId).get();
                if (userDoc.exists) {
                    const userData = userDoc.data();
                    userFinancialSettings = userData === null || userData === void 0 ? void 0 : userData.financialSettings;
                }
            }
        }
        catch (e) {
            console.warn('[recalculateRolloverChain] Could not fetch user settings, using defaults');
        }
        // 3. Get effective rollover settings
        const rolloverSettings = (0, rolloverCalculation_1.getEffectiveRolloverSettings)(budget, userFinancialSettings);
        console.log(`[recalculateRolloverChain] Rollover settings:`, {
            enabled: rolloverSettings.enabled,
            strategy: rolloverSettings.strategy,
            spreadPeriods: rolloverSettings.spreadPeriods,
        });
        // If rollover is disabled, clear rollover amounts
        if (!rolloverSettings.enabled) {
            console.log('[recalculateRolloverChain] Rollover disabled, clearing rollover amounts');
            const clearedCount = await clearRolloverAmounts(db, budgetId, periodTypes);
            result.periodsUpdated = clearedCount;
            console.log(`[recalculateRolloverChain] Cleared rollover from ${clearedCount} periods`);
            return result;
        }
        // 4. Fetch all periods for this budget
        let periodsQuery = db.collection('budget_periods')
            .where('budgetId', '==', budgetId)
            .where('isActive', '==', true);
        const periodsSnapshot = await periodsQuery.get();
        if (periodsSnapshot.empty) {
            console.log('[recalculateRolloverChain] No periods found for budget');
            return result;
        }
        console.log(`[recalculateRolloverChain] Found ${periodsSnapshot.size} total periods`);
        // 5. Group periods by type and sort by start date
        const periodsByType = new Map();
        periodsSnapshot.forEach(doc => {
            const period = Object.assign({ id: doc.id }, doc.data());
            const periodType = period.periodType;
            // Filter by period types if specified
            if (periodTypes && !periodTypes.includes(periodType)) {
                return;
            }
            if (!periodsByType.has(periodType)) {
                periodsByType.set(periodType, []);
            }
            periodsByType.get(periodType).push(period);
        });
        // 6. Sort each type's periods by start date
        for (const [type, periods] of periodsByType) {
            periods.sort((a, b) => {
                const aStart = getTimestamp(a.periodStart);
                const bStart = getTimestamp(b.periodStart);
                return aStart - bStart;
            });
            console.log(`[recalculateRolloverChain] ${type}: ${periods.length} periods`);
        }
        // 7. Calculate rollover for each type chain
        const batch = db.batch();
        let batchCount = 0;
        const MAX_BATCH_SIZE = 500;
        for (const [periodType, periods] of periodsByType) {
            console.log(`[recalculateRolloverChain] Processing ${periodType} chain...`);
            // Find starting index if startFromPeriodId specified
            let startIndex = 0;
            if (startFromPeriodId) {
                const foundIndex = periods.findIndex(p => p.id === startFromPeriodId);
                if (foundIndex > 0) {
                    // Start from the previous period so we have context
                    startIndex = foundIndex - 1;
                }
            }
            // Calculate rollover for each period in sequence
            for (let i = startIndex; i < periods.length; i++) {
                const currentPeriod = periods[i];
                const previousPeriod = i > 0 ? periods[i - 1] : null;
                const rolloverResult = (0, rolloverCalculation_1.calculateRolloverForPeriod)(currentPeriod, previousPeriod, rolloverSettings);
                // Check if update is needed
                const needsUpdate = hasRolloverChanged(currentPeriod, rolloverResult);
                if (needsUpdate) {
                    // Calculate new remaining with rollover
                    const allocated = (_a = currentPeriod.modifiedAmount) !== null && _a !== void 0 ? _a : currentPeriod.allocatedAmount;
                    const spent = (_b = currentPeriod.spent) !== null && _b !== void 0 ? _b : 0;
                    const newRemaining = Math.round((allocated + rolloverResult.rolledOverAmount - spent) * 100) / 100;
                    const periodRef = db.collection('budget_periods').doc(currentPeriod.id);
                    batch.update(periodRef, {
                        rolledOverAmount: rolloverResult.rolledOverAmount,
                        rolledOverFromPeriodId: rolloverResult.rolledOverFromPeriodId,
                        pendingRolloverDeduction: rolloverResult.pendingRolloverDeduction,
                        pendingRolloverPeriods: rolloverResult.pendingRolloverPeriods,
                        remaining: newRemaining,
                        rolloverCalculatedAt: firestore_1.Timestamp.now(),
                        updatedAt: firestore_1.Timestamp.now(),
                    });
                    batchCount++;
                    result.periodsUpdated++;
                    result.periodsByType[periodType] = (result.periodsByType[periodType] || 0) + 1;
                    // Update local period data for next iteration
                    currentPeriod.rolledOverAmount = rolloverResult.rolledOverAmount;
                    currentPeriod.pendingRolloverDeduction = rolloverResult.pendingRolloverDeduction;
                    currentPeriod.pendingRolloverPeriods = rolloverResult.pendingRolloverPeriods;
                    // Commit batch if approaching limit
                    if (batchCount >= MAX_BATCH_SIZE) {
                        await batch.commit();
                        console.log(`[recalculateRolloverChain] Committed batch of ${batchCount} updates`);
                        batchCount = 0;
                    }
                }
            }
        }
        // Commit any remaining updates
        if (batchCount > 0) {
            await batch.commit();
            console.log(`[recalculateRolloverChain] Committed final batch of ${batchCount} updates`);
        }
        console.log('[recalculateRolloverChain] ════════════════════════════════════════════');
        console.log('[recalculateRolloverChain] ROLLOVER CHAIN CALCULATION COMPLETE');
        console.log('[recalculateRolloverChain] ════════════════════════════════════════════');
        console.log(`[recalculateRolloverChain] Total periods updated: ${result.periodsUpdated}`);
        console.log(`[recalculateRolloverChain] By type:`, result.periodsByType);
        return result;
    }
    catch (error) {
        console.error('[recalculateRolloverChain] ❌ Error:', error);
        result.success = false;
        result.errors.push(error instanceof Error ? error.message : String(error));
        return result;
    }
}
/**
 * Clear rollover amounts for a budget's periods (when rollover is disabled)
 */
async function clearRolloverAmounts(db, budgetId, periodTypes) {
    let query = db.collection('budget_periods')
        .where('budgetId', '==', budgetId)
        .where('isActive', '==', true);
    const snapshot = await query.get();
    if (snapshot.empty)
        return 0;
    const batch = db.batch();
    let count = 0;
    snapshot.forEach(doc => {
        var _a, _b;
        const period = doc.data();
        // Filter by period types if specified
        if (periodTypes && !periodTypes.includes(period.periodType)) {
            return;
        }
        // Only update if there's rollover data to clear
        if (period.rolledOverAmount !== undefined && period.rolledOverAmount !== 0) {
            const allocated = (_a = period.modifiedAmount) !== null && _a !== void 0 ? _a : period.allocatedAmount;
            const spent = (_b = period.spent) !== null && _b !== void 0 ? _b : 0;
            batch.update(doc.ref, {
                rolledOverAmount: 0,
                rolledOverFromPeriodId: null,
                pendingRolloverDeduction: 0,
                pendingRolloverPeriods: 0,
                remaining: Math.round((allocated - spent) * 100) / 100,
                rolloverCalculatedAt: firestore_1.Timestamp.now(),
                updatedAt: firestore_1.Timestamp.now(),
            });
            count++;
        }
    });
    if (count > 0) {
        await batch.commit();
    }
    return count;
}
/**
 * Check if rollover values have changed
 */
function hasRolloverChanged(period, newRollover) {
    var _a, _b, _c;
    const currentRollover = (_a = period.rolledOverAmount) !== null && _a !== void 0 ? _a : 0;
    const currentPending = (_b = period.pendingRolloverDeduction) !== null && _b !== void 0 ? _b : 0;
    const currentPendingPeriods = (_c = period.pendingRolloverPeriods) !== null && _c !== void 0 ? _c : 0;
    return (Math.abs(currentRollover - newRollover.rolledOverAmount) > 0.001 ||
        Math.abs(currentPending - newRollover.pendingRolloverDeduction) > 0.001 ||
        currentPendingPeriods !== newRollover.pendingRolloverPeriods);
}
/**
 * Get milliseconds from a Firestore timestamp or date
 */
function getTimestamp(value) {
    if (value instanceof firestore_1.Timestamp) {
        return value.toMillis();
    }
    if (value === null || value === void 0 ? void 0 : value.toMillis) {
        return value.toMillis();
    }
    if (value instanceof Date) {
        return value.getTime();
    }
    return new Date(value).getTime();
}
/**
 * Recalculate rollover for periods that just became current.
 * Called by scheduled function to ensure rollover is calculated
 * even when no spending activity occurs.
 *
 * @param db - Firestore instance
 * @returns Count of budgets processed
 */
async function recalculateRolloverForCurrentPeriods(db) {
    const result = {
        budgetsProcessed: 0,
        periodsUpdated: 0,
        errors: [],
    };
    console.log('[recalculateRolloverForCurrentPeriods] Starting daily rollover check...');
    const now = firestore_1.Timestamp.now();
    try {
        // Find budget periods where today falls within the period range
        // and rollover hasn't been calculated recently
        const periodsSnapshot = await db.collection('budget_periods')
            .where('isActive', '==', true)
            .where('periodStart', '<=', now)
            .where('periodEnd', '>=', now)
            .get();
        if (periodsSnapshot.empty) {
            console.log('[recalculateRolloverForCurrentPeriods] No current periods found');
            return result;
        }
        console.log(`[recalculateRolloverForCurrentPeriods] Found ${periodsSnapshot.size} current periods`);
        // Group by budgetId to avoid recalculating same budget multiple times
        const budgetIds = new Set();
        periodsSnapshot.forEach(doc => {
            const period = doc.data();
            budgetIds.add(period.budgetId);
        });
        console.log(`[recalculateRolloverForCurrentPeriods] Processing ${budgetIds.size} unique budgets`);
        // Recalculate rollover for each budget
        for (const budgetId of budgetIds) {
            try {
                const chainResult = await recalculateRolloverChain(db, budgetId);
                if (chainResult.success) {
                    result.budgetsProcessed++;
                    result.periodsUpdated += chainResult.periodsUpdated;
                }
                else {
                    result.errors.push(...chainResult.errors);
                }
            }
            catch (error) {
                const errorMsg = `Failed to recalculate rollover for budget ${budgetId}: ${error}`;
                console.error('[recalculateRolloverForCurrentPeriods]', errorMsg);
                result.errors.push(errorMsg);
            }
        }
        console.log(`[recalculateRolloverForCurrentPeriods] Complete:`, result);
        return result;
    }
    catch (error) {
        console.error('[recalculateRolloverForCurrentPeriods] ❌ Error:', error);
        result.errors.push(error instanceof Error ? error.message : String(error));
        return result;
    }
}
//# sourceMappingURL=rolloverChainCalculation.js.map