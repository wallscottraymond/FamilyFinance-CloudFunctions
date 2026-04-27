"use strict";
/**
 * Sync Notes to Overlapping Periods Utility
 *
 * When userNotes is updated on a budget_period, this utility syncs the notes
 * to all overlapping periods of OTHER budget types (same date range, different period type).
 *
 * Example:
 * - User adds note to Monthly period (2025-04-01 to 2025-04-30)
 * - Note syncs to overlapping Weekly periods (2025-W14, 2025-W15, etc.)
 * - Note syncs to overlapping Bi-Monthly periods (2025-BM04A, 2025-BM04B)
 *
 * Note: This syncs notes for the SAME BUDGET across different period types,
 * not across different budgets.
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
exports.syncNotesToOverlappingPeriods = syncNotesToOverlappingPeriods;
exports.syncChecklistToOverlappingPeriods = syncChecklistToOverlappingPeriods;
exports.syncModifiedAmountToOverlappingPeriods = syncModifiedAmountToOverlappingPeriods;
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../types");
/**
 * Get all period types except the source period's type
 */
function getOtherPeriodTypes(sourcePeriodType) {
    const allTypes = [types_1.PeriodType.MONTHLY, types_1.PeriodType.WEEKLY, types_1.PeriodType.BI_MONTHLY];
    return allTypes.filter(type => type !== sourcePeriodType);
}
/**
 * Check if two date ranges overlap
 * Two periods overlap if: periodA.start <= periodB.end AND periodA.end >= periodB.start
 */
function periodsOverlap(aStart, aEnd, bStart, bEnd) {
    return aStart <= bEnd && aEnd >= bStart;
}
/**
 * Sync notes from one budget period to all overlapping periods of other types
 *
 * @param db - Firestore instance
 * @param sourcePeriod - The period that was updated with new notes
 * @param newNotes - The new notes value to sync
 * @returns Result with sync statistics
 */
async function syncNotesToOverlappingPeriods(db, sourcePeriod, newNotes) {
    const result = {
        success: false,
        periodsQueried: 0,
        periodsUpdated: 0,
        periodTypes: [],
        errors: []
    };
    try {
        console.log('[syncNotesToOverlappingPeriods] ════════════════════════════════════════════');
        console.log('[syncNotesToOverlappingPeriods] SYNCING NOTES TO OVERLAPPING PERIODS');
        console.log('[syncNotesToOverlappingPeriods] ════════════════════════════════════════════');
        console.log(`[syncNotesToOverlappingPeriods] Source period: ${sourcePeriod.id}`);
        console.log(`[syncNotesToOverlappingPeriods] Source type: ${sourcePeriod.periodType}`);
        console.log(`[syncNotesToOverlappingPeriods] Budget ID: ${sourcePeriod.budgetId}`);
        console.log(`[syncNotesToOverlappingPeriods] Notes: "${newNotes === null || newNotes === void 0 ? void 0 : newNotes.substring(0, 50)}${((newNotes === null || newNotes === void 0 ? void 0 : newNotes.length) || 0) > 50 ? '...' : ''}"`);
        const sourceStart = sourcePeriod.periodStart.toDate();
        const sourceEnd = sourcePeriod.periodEnd.toDate();
        const otherTypes = getOtherPeriodTypes(sourcePeriod.periodType);
        console.log(`[syncNotesToOverlappingPeriods] Looking for overlapping periods of types: ${otherTypes.join(', ')}`);
        // Query all periods of other types for the same budget
        const periodsSnapshot = await db.collection('budget_periods')
            .where('budgetId', '==', sourcePeriod.budgetId)
            .where('periodType', 'in', otherTypes)
            .get();
        result.periodsQueried = periodsSnapshot.size;
        console.log(`[syncNotesToOverlappingPeriods] Found ${periodsSnapshot.size} periods of other types`);
        if (periodsSnapshot.empty) {
            console.log('[syncNotesToOverlappingPeriods] No other period types found for this budget');
            result.success = true;
            return result;
        }
        // Find overlapping periods and update their notes
        const batch = db.batch();
        let updatedCount = 0;
        const updatedTypes = new Set();
        for (const periodDoc of periodsSnapshot.docs) {
            const period = periodDoc.data();
            const periodStart = period.periodStart.toDate();
            const periodEnd = period.periodEnd.toDate();
            // Check if this period overlaps with the source period
            if (periodsOverlap(sourceStart, sourceEnd, periodStart, periodEnd)) {
                // Skip if notes are already the same
                if (period.userNotes === newNotes) {
                    console.log(`[syncNotesToOverlappingPeriods] Period ${periodDoc.id} already has same notes, skipping`);
                    continue;
                }
                batch.update(periodDoc.ref, {
                    userNotes: newNotes || null,
                    updatedAt: firestore_1.Timestamp.now(),
                    notesSyncedFrom: sourcePeriod.id,
                    notesSyncedAt: firestore_1.Timestamp.now()
                });
                updatedCount++;
                updatedTypes.add(String(period.periodType));
                console.log(`[syncNotesToOverlappingPeriods] Syncing to period ${periodDoc.id} (${period.periodType})`);
            }
        }
        if (updatedCount > 0) {
            await batch.commit();
            result.periodsUpdated = updatedCount;
            result.periodTypes = Array.from(updatedTypes);
            console.log(`[syncNotesToOverlappingPeriods] ✓ Synced notes to ${updatedCount} periods`);
        }
        else {
            console.log('[syncNotesToOverlappingPeriods] No overlapping periods needed update');
        }
        result.success = true;
        console.log('[syncNotesToOverlappingPeriods] ════════════════════════════════════════════');
    }
    catch (error) {
        console.error('[syncNotesToOverlappingPeriods] Error:', error);
        result.errors.push(error.message || 'Unknown error');
    }
    return result;
}
/**
 * Sync checklist items to overlapping periods
 * Similar to notes sync, but for checklistItems array
 *
 * @param db - Firestore instance
 * @param sourcePeriod - The period that was updated
 * @param newChecklistItems - The new checklist items to sync
 * @returns Result with sync statistics
 */
async function syncChecklistToOverlappingPeriods(db, sourcePeriod, newChecklistItems) {
    const result = {
        success: false,
        periodsQueried: 0,
        periodsUpdated: 0,
        periodTypes: [],
        errors: []
    };
    try {
        console.log('[syncChecklistToOverlappingPeriods] Syncing checklist items');
        console.log(`[syncChecklistToOverlappingPeriods] Source period: ${sourcePeriod.id}`);
        console.log(`[syncChecklistToOverlappingPeriods] Items count: ${(newChecklistItems === null || newChecklistItems === void 0 ? void 0 : newChecklistItems.length) || 0}`);
        const sourceStart = sourcePeriod.periodStart.toDate();
        const sourceEnd = sourcePeriod.periodEnd.toDate();
        const otherTypes = getOtherPeriodTypes(sourcePeriod.periodType);
        // Query all periods of other types for the same budget
        const periodsSnapshot = await db.collection('budget_periods')
            .where('budgetId', '==', sourcePeriod.budgetId)
            .where('periodType', 'in', otherTypes)
            .get();
        result.periodsQueried = periodsSnapshot.size;
        if (periodsSnapshot.empty) {
            result.success = true;
            return result;
        }
        const batch = db.batch();
        let updatedCount = 0;
        const updatedTypes = new Set();
        for (const periodDoc of periodsSnapshot.docs) {
            const period = periodDoc.data();
            const periodStart = period.periodStart.toDate();
            const periodEnd = period.periodEnd.toDate();
            if (periodsOverlap(sourceStart, sourceEnd, periodStart, periodEnd)) {
                batch.update(periodDoc.ref, {
                    checklistItems: newChecklistItems || [],
                    updatedAt: firestore_1.Timestamp.now(),
                    checklistSyncedFrom: sourcePeriod.id,
                    checklistSyncedAt: firestore_1.Timestamp.now()
                });
                updatedCount++;
                updatedTypes.add(String(period.periodType));
            }
        }
        if (updatedCount > 0) {
            await batch.commit();
            result.periodsUpdated = updatedCount;
            result.periodTypes = Array.from(updatedTypes);
        }
        result.success = true;
    }
    catch (error) {
        console.error('[syncChecklistToOverlappingPeriods] Error:', error);
        result.errors.push(error.message || 'Unknown error');
    }
    return result;
}
/**
 * Sync modifiedAmount to overlapping periods
 * When a user modifies the allocated amount for a specific period,
 * sync that modification to overlapping periods of other types
 *
 * @param db - Firestore instance
 * @param sourcePeriod - The period with the modified amount
 * @param newModifiedAmount - The new modified amount
 * @returns Result with sync statistics
 */
async function syncModifiedAmountToOverlappingPeriods(db, sourcePeriod, newModifiedAmount) {
    const result = {
        success: false,
        periodsQueried: 0,
        periodsUpdated: 0,
        periodTypes: [],
        errors: []
    };
    try {
        console.log('[syncModifiedAmountToOverlappingPeriods] Syncing modified amount');
        console.log(`[syncModifiedAmountToOverlappingPeriods] Source period: ${sourcePeriod.id}`);
        console.log(`[syncModifiedAmountToOverlappingPeriods] Modified amount: $${(newModifiedAmount === null || newModifiedAmount === void 0 ? void 0 : newModifiedAmount.toFixed(2)) || 'none'}`);
        const sourceStart = sourcePeriod.periodStart.toDate();
        const sourceEnd = sourcePeriod.periodEnd.toDate();
        const otherTypes = getOtherPeriodTypes(sourcePeriod.periodType);
        const periodsSnapshot = await db.collection('budget_periods')
            .where('budgetId', '==', sourcePeriod.budgetId)
            .where('periodType', 'in', otherTypes)
            .get();
        result.periodsQueried = periodsSnapshot.size;
        if (periodsSnapshot.empty) {
            result.success = true;
            return result;
        }
        const batch = db.batch();
        let updatedCount = 0;
        const updatedTypes = new Set();
        for (const periodDoc of periodsSnapshot.docs) {
            const period = periodDoc.data();
            const periodStart = period.periodStart.toDate();
            const periodEnd = period.periodEnd.toDate();
            if (periodsOverlap(sourceStart, sourceEnd, periodStart, periodEnd)) {
                const updates = {
                    isModified: newModifiedAmount !== undefined,
                    updatedAt: firestore_1.Timestamp.now(),
                    modifiedAmountSyncedFrom: sourcePeriod.id,
                    modifiedAmountSyncedAt: firestore_1.Timestamp.now()
                };
                if (newModifiedAmount !== undefined) {
                    // Calculate proportional amount for the overlapping period based on day coverage
                    // For simplicity, we'll use the same modified amount
                    // A more sophisticated approach would prorate based on overlap days
                    updates.modifiedAmount = newModifiedAmount;
                }
                else {
                    updates.modifiedAmount = admin.firestore.FieldValue.delete();
                }
                batch.update(periodDoc.ref, updates);
                updatedCount++;
                updatedTypes.add(String(period.periodType));
            }
        }
        if (updatedCount > 0) {
            await batch.commit();
            result.periodsUpdated = updatedCount;
            result.periodTypes = Array.from(updatedTypes);
        }
        result.success = true;
    }
    catch (error) {
        console.error('[syncModifiedAmountToOverlappingPeriods] Error:', error);
        result.errors.push(error.message || 'Unknown error');
    }
    return result;
}
//# sourceMappingURL=syncNotesToOverlappingPeriods.js.map