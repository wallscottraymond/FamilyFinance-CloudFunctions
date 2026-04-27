"use strict";
/**
 * Handle Budget Date Changes Utility
 *
 * Manages period adjustments when budget date-related fields change:
 * - startDate: May add/remove periods at the beginning
 * - isOngoing: Changes from ongoing to limited or vice versa
 * - budgetEndDate: Sets when a budget should stop
 *
 * Strategy:
 * - Periods BEFORE new startDate → Mark inactive (preserve for history)
 * - Periods AFTER budgetEndDate → Mark inactive (preserve for history)
 * - Gaps in coverage → Generate new periods
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleBudgetDateChanges = handleBudgetDateChanges;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
// Note: getTodayUTC will be used when we need to filter periods relative to today
// function getTodayUTC(): Date {
//   const now = new Date();
//   return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
// }
/**
 * Check if startDate changed
 */
function hasStartDateChanged(before, after) {
    var _a, _b, _c, _d, _e, _f;
    const beforeStart = (_c = (_b = (_a = before.startDate) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : null;
    const afterStart = (_f = (_e = (_d = after.startDate) === null || _d === void 0 ? void 0 : _d.toMillis) === null || _e === void 0 ? void 0 : _e.call(_d)) !== null && _f !== void 0 ? _f : null;
    return beforeStart !== afterStart;
}
/**
 * Check if end date configuration changed (isOngoing or budgetEndDate)
 */
function hasEndDateConfigChanged(before, after) {
    var _a, _b, _c, _d, _e, _f;
    // Check isOngoing change
    if (before.isOngoing !== after.isOngoing) {
        return true;
    }
    // Check budgetEndDate change
    const beforeEnd = (_c = (_b = (_a = before.budgetEndDate) === null || _a === void 0 ? void 0 : _a.toMillis) === null || _b === void 0 ? void 0 : _b.call(_a)) !== null && _c !== void 0 ? _c : null;
    const afterEnd = (_f = (_e = (_d = after.budgetEndDate) === null || _d === void 0 ? void 0 : _d.toMillis) === null || _e === void 0 ? void 0 : _e.call(_d)) !== null && _f !== void 0 ? _f : null;
    return beforeEnd !== afterEnd;
}
/**
 * Main function: Handle budget date-related changes
 *
 * @param db - Firestore instance
 * @param budgetId - The budget ID
 * @param budgetBefore - Budget data before update
 * @param budgetAfter - Budget data after update
 * @returns Result with change statistics
 */
async function handleBudgetDateChanges(db, budgetId, budgetBefore, budgetAfter) {
    const result = {
        success: false,
        startDateChange: {
            detected: false,
            periodsDeactivated: 0,
            periodsGenerated: 0
        },
        endDateChange: {
            detected: false,
            periodsDeactivated: 0,
            periodsReactivated: 0
        },
        errors: []
    };
    try {
        const startDateChanged = hasStartDateChanged(budgetBefore, budgetAfter);
        const endDateConfigChanged = hasEndDateConfigChanged(budgetBefore, budgetAfter);
        if (!startDateChanged && !endDateConfigChanged) {
            console.log('[handleBudgetDateChanges] No date-related changes detected');
            result.success = true;
            return result;
        }
        console.log('[handleBudgetDateChanges] ════════════════════════════════════════════');
        console.log('[handleBudgetDateChanges] DATE CHANGES DETECTED');
        console.log('[handleBudgetDateChanges] ════════════════════════════════════════════');
        // Query all existing periods for this budget
        const periodsSnapshot = await db.collection('budget_periods')
            .where('budgetId', '==', budgetId)
            .get();
        console.log(`[handleBudgetDateChanges] Found ${periodsSnapshot.size} existing periods`);
        // Handle startDate changes
        if (startDateChanged) {
            result.startDateChange.detected = true;
            await handleStartDateChange(db, budgetId, budgetBefore, budgetAfter, periodsSnapshot.docs, result);
        }
        // Handle endDate/isOngoing changes
        if (endDateConfigChanged) {
            result.endDateChange.detected = true;
            await handleEndDateChange(db, budgetId, budgetBefore, budgetAfter, periodsSnapshot.docs, result);
        }
        result.success = true;
        console.log('[handleBudgetDateChanges] ════════════════════════════════════════════');
        console.log('[handleBudgetDateChanges] DATE CHANGES COMPLETE');
        console.log(`[handleBudgetDateChanges] Start: deactivated=${result.startDateChange.periodsDeactivated}, generated=${result.startDateChange.periodsGenerated}`);
        console.log(`[handleBudgetDateChanges] End: deactivated=${result.endDateChange.periodsDeactivated}, reactivated=${result.endDateChange.periodsReactivated}`);
        console.log('[handleBudgetDateChanges] ════════════════════════════════════════════');
    }
    catch (error) {
        console.error('[handleBudgetDateChanges] Error:', error);
        result.errors.push(error.message || 'Unknown error');
    }
    return result;
}
/**
 * Handle startDate changes
 *
 * - If startDate moved LATER: Deactivate periods before new startDate
 * - If startDate moved EARLIER: Generate new periods for the gap
 */
async function handleStartDateChange(db, budgetId, budgetBefore, budgetAfter, existingPeriods, result) {
    var _a, _b;
    const beforeStart = ((_a = budgetBefore.startDate) === null || _a === void 0 ? void 0 : _a.toDate()) || new Date();
    const afterStart = ((_b = budgetAfter.startDate) === null || _b === void 0 ? void 0 : _b.toDate()) || new Date();
    console.log(`[handleBudgetDateChanges] startDate: ${beforeStart.toISOString()} → ${afterStart.toISOString()}`);
    if (afterStart > beforeStart) {
        // StartDate moved LATER - deactivate periods before new startDate
        console.log('[handleBudgetDateChanges] startDate moved later, deactivating early periods');
        const batch = db.batch();
        let deactivatedCount = 0;
        for (const periodDoc of existingPeriods) {
            const period = periodDoc.data();
            const periodEnd = period.periodEnd.toDate();
            // If period ends before new startDate, deactivate it
            if (periodEnd < afterStart) {
                batch.update(periodDoc.ref, {
                    isActive: false,
                    updatedAt: firestore_1.Timestamp.now(),
                    deactivationReason: 'startDate_moved_later'
                });
                deactivatedCount++;
            }
        }
        if (deactivatedCount > 0) {
            await batch.commit();
            result.startDateChange.periodsDeactivated = deactivatedCount;
            console.log(`[handleBudgetDateChanges] Deactivated ${deactivatedCount} periods before new startDate`);
        }
    }
    else if (afterStart < beforeStart) {
        // StartDate moved EARLIER - need to generate periods for the gap
        console.log('[handleBudgetDateChanges] startDate moved earlier, generating new periods');
        // Find the earliest existing period
        let earliestPeriodStart = null;
        for (const periodDoc of existingPeriods) {
            const period = periodDoc.data();
            const periodStart = period.periodStart.toDate();
            if (!earliestPeriodStart || periodStart < earliestPeriodStart) {
                earliestPeriodStart = periodStart;
            }
        }
        if (earliestPeriodStart && afterStart < earliestPeriodStart) {
            // Generate periods from new startDate to just before earliest existing period
            console.log(`[handleBudgetDateChanges] Generating periods from ${afterStart.toISOString()} to ${earliestPeriodStart.toISOString()}`);
            // Calculate end date for new periods (day before earliest existing)
            const gapEndDate = new Date(earliestPeriodStart);
            gapEndDate.setDate(gapEndDate.getDate() - 1);
            // TODO: Implement selective period generation for date range
            // This would need to call generateBudgetPeriodsWithPrimeSystem with specific date range
            // For now, we just log that this should happen
            console.log(`[handleBudgetDateChanges] Would generate periods for gap: ${afterStart.toISOString()} to ${gapEndDate.toISOString()}`);
            // result.startDateChange.periodsGenerated = generatedCount;
        }
    }
}
/**
 * Handle endDate/isOngoing changes
 *
 * - If changing to limited (isOngoing=false with budgetEndDate): Deactivate periods after endDate
 * - If changing to ongoing (isOngoing=true): Reactivate periods that were deactivated due to endDate
 * - If budgetEndDate changed: Adjust which periods are active/inactive
 */
async function handleEndDateChange(db, budgetId, budgetBefore, budgetAfter, existingPeriods, result) {
    var _a, _b, _c, _d;
    const wasOngoing = (_a = budgetBefore.isOngoing) !== null && _a !== void 0 ? _a : true;
    const isNowOngoing = (_b = budgetAfter.isOngoing) !== null && _b !== void 0 ? _b : true;
    const oldEndDate = (_c = budgetBefore.budgetEndDate) === null || _c === void 0 ? void 0 : _c.toDate();
    const newEndDate = (_d = budgetAfter.budgetEndDate) === null || _d === void 0 ? void 0 : _d.toDate();
    console.log(`[handleBudgetDateChanges] isOngoing: ${wasOngoing} → ${isNowOngoing}`);
    console.log(`[handleBudgetDateChanges] budgetEndDate: ${(oldEndDate === null || oldEndDate === void 0 ? void 0 : oldEndDate.toISOString()) || 'none'} → ${(newEndDate === null || newEndDate === void 0 ? void 0 : newEndDate.toISOString()) || 'none'}`);
    const batch = db.batch();
    let deactivatedCount = 0;
    let reactivatedCount = 0;
    if (!isNowOngoing && newEndDate) {
        // Budget is now limited - deactivate periods after endDate
        console.log('[handleBudgetDateChanges] Budget now has end date, checking for periods to deactivate');
        for (const periodDoc of existingPeriods) {
            const period = periodDoc.data();
            const periodStart = period.periodStart.toDate();
            // If period starts after the budget end date, deactivate it
            if (periodStart > newEndDate) {
                // Only deactivate if currently active
                if (period.isActive !== false) {
                    batch.update(periodDoc.ref, {
                        isActive: false,
                        updatedAt: firestore_1.Timestamp.now(),
                        deactivationReason: 'budget_end_date_reached'
                    });
                    deactivatedCount++;
                }
            }
        }
    }
    else if (isNowOngoing && !wasOngoing) {
        // Budget changed from limited to ongoing - reactivate periods that were deactivated due to endDate
        console.log('[handleBudgetDateChanges] Budget now ongoing, checking for periods to reactivate');
        for (const periodDoc of existingPeriods) {
            const period = periodDoc.data();
            const deactivationReason = period.deactivationReason;
            // Reactivate periods that were deactivated due to budget end date
            if (period.isActive === false && deactivationReason === 'budget_end_date_reached') {
                batch.update(periodDoc.ref, {
                    isActive: true,
                    updatedAt: firestore_1.Timestamp.now(),
                    deactivationReason: admin.firestore.FieldValue.delete()
                });
                reactivatedCount++;
            }
        }
    }
    else if (!isNowOngoing && newEndDate && oldEndDate) {
        // budgetEndDate changed - adjust which periods are active
        console.log('[handleBudgetDateChanges] Budget end date changed, adjusting period status');
        for (const periodDoc of existingPeriods) {
            const period = periodDoc.data();
            const periodStart = period.periodStart.toDate();
            const deactivationReason = period.deactivationReason;
            if (periodStart > newEndDate) {
                // Should be inactive
                if (period.isActive !== false) {
                    batch.update(periodDoc.ref, {
                        isActive: false,
                        updatedAt: firestore_1.Timestamp.now(),
                        deactivationReason: 'budget_end_date_reached'
                    });
                    deactivatedCount++;
                }
            }
            else {
                // Should be active (if it was deactivated due to end date)
                if (period.isActive === false && deactivationReason === 'budget_end_date_reached') {
                    batch.update(periodDoc.ref, {
                        isActive: true,
                        updatedAt: firestore_1.Timestamp.now(),
                        deactivationReason: admin.firestore.FieldValue.delete()
                    });
                    reactivatedCount++;
                }
            }
        }
    }
    if (deactivatedCount > 0 || reactivatedCount > 0) {
        await batch.commit();
        result.endDateChange.periodsDeactivated = deactivatedCount;
        result.endDateChange.periodsReactivated = reactivatedCount;
        console.log(`[handleBudgetDateChanges] End date changes: deactivated=${deactivatedCount}, reactivated=${reactivatedCount}`);
    }
}
//# sourceMappingURL=handleBudgetDateChanges.js.map