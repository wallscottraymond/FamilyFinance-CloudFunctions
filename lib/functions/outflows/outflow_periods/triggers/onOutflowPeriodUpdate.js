"use strict";
/**
 * Outflow Period Post-Update Orchestration
 *
 * This Cloud Function is triggered when an outflow_period is updated.
 * It handles post-update operations including summary recalculation.
 *
 * Memory: 256MiB, Timeout: 30s
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
exports.onOutflowPeriodUpdate = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const matchAllTransactionsToOccurrences_1 = require("../utils/matchAllTransactionsToOccurrences");
const updateOutflowPeriodSummary_1 = require("../../outflow_summaries/crud/updateOutflowPeriodSummary");
/**
 * Triggered when an outflow_period is updated
 * Updates summaries to reflect changes
 */
exports.onOutflowPeriodUpdate = (0, firestore_1.onDocumentUpdated)({
    document: 'outflow_periods/{outflowPeriodId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (event) => {
    var _a, _b;
    try {
        const outflowPeriodId = event.params.outflowPeriodId;
        const beforeData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
        const afterData = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
        if (!afterData) {
            console.error('[onOutflowPeriodUpdate] No after data found');
            return;
        }
        console.log('');
        console.log('[onOutflowPeriodUpdate] ════════════════════════════════════════════');
        console.log('[onOutflowPeriodUpdate] OUTFLOW PERIOD UPDATED');
        console.log('[onOutflowPeriodUpdate] ════════════════════════════════════════════');
        console.log(`[onOutflowPeriodUpdate] Period ID: ${outflowPeriodId}`);
        console.log(`[onOutflowPeriodUpdate] Source Period: ${afterData.sourcePeriodId}`);
        console.log('');
        const db = admin.firestore();
        // CRITICAL: Detect if ONLY occurrence tracking fields changed
        // This prevents infinite trigger loops when our own matching system updates the document
        const onlyOccurrenceFieldsChanged = detectOnlyOccurrenceFieldsChanged(beforeData, afterData);
        if (onlyOccurrenceFieldsChanged) {
            console.log('[onOutflowPeriodUpdate] Only occurrence tracking fields changed (likely from our own update), skipping occurrence matching to prevent loop');
            // Still update summaries, but skip occurrence matching
            await updateSummaryOnly(afterData);
            return;
        }
        // Step 1: Check if transactionSplits changed - re-match to occurrences if so
        const beforeSplits = (beforeData === null || beforeData === void 0 ? void 0 : beforeData.transactionSplits) || [];
        const afterSplits = afterData.transactionSplits || [];
        const transactionSplitsChanged = JSON.stringify(beforeSplits) !== JSON.stringify(afterSplits);
        if (transactionSplitsChanged) {
            console.log('[onOutflowPeriodUpdate] Step 1: Transaction splits changed, re-matching to occurrences...');
            console.log(`[onOutflowPeriodUpdate] Before: ${beforeSplits.length} splits, After: ${afterSplits.length} splits`);
            // Only run occurrence matching if this period has occurrences to track
            if (afterData.occurrenceDueDates && afterData.occurrenceDueDates.length > 0) {
                try {
                    console.log(`[onOutflowPeriodUpdate] Period has ${afterData.occurrenceDueDates.length} occurrences, running occurrence matching...`);
                    await (0, matchAllTransactionsToOccurrences_1.matchAllTransactionsToOccurrences)(db, outflowPeriodId, afterData);
                    console.log('[onOutflowPeriodUpdate] ✓ Occurrence matching complete');
                }
                catch (occurrenceError) {
                    console.error('[onOutflowPeriodUpdate] ⚠️  Occurrence matching failed:', occurrenceError);
                    // Don't throw - occurrence matching failures shouldn't break the update
                }
            }
            else {
                console.log('[onOutflowPeriodUpdate] Period has no occurrences to track, skipping occurrence matching');
            }
            console.log('');
        }
        else {
            console.log('[onOutflowPeriodUpdate] Transaction splits unchanged, skipping occurrence matching');
            console.log('');
        }
        // FINAL STEP: Update outflow summaries (non-critical)
        console.log('[onOutflowPeriodUpdate] Updating outflow summaries...');
        try {
            await (0, updateOutflowPeriodSummary_1.updateOutflowPeriodSummary)(afterData);
            console.log('[onOutflowPeriodUpdate] ✓ Summaries updated successfully');
        }
        catch (summaryError) {
            console.error('[onOutflowPeriodUpdate] ⚠️  Summary update failed:', summaryError);
            // Don't throw - summary failures shouldn't break the update
            // Summaries can be recalculated via manual API call if needed
        }
        console.log('[onOutflowPeriodUpdate] ════════════════════════════════════════════');
        console.log('');
    }
    catch (error) {
        console.error('');
        console.error('[onOutflowPeriodUpdate] ❌ ERROR:', error);
        console.error('');
        // Don't throw - we don't want to break period updates
    }
});
/**
 * Helper function to detect if ONLY occurrence tracking fields changed
 * This prevents infinite trigger loops when our own occurrence matching updates the document
 */
function detectOnlyOccurrenceFieldsChanged(before, after) {
    if (!before)
        return false;
    // Fields that our occurrence matching system updates
    const occurrenceFields = [
        'occurrencePaidFlags',
        'occurrenceTransactionIds',
        'numberOfOccurrencesPaid',
        'numberOfOccurrencesUnpaid',
        'updatedAt'
    ];
    // Check if any non-occurrence fields changed
    const afterKeys = Object.keys(after);
    // Get all changed field names
    const changedFields = [];
    // Check for modified fields
    for (const key of afterKeys) {
        if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
            changedFields.push(key);
        }
    }
    // If no fields changed, return false
    if (changedFields.length === 0) {
        return false;
    }
    // Check if ALL changed fields are occurrence fields
    const allChangesAreOccurrenceFields = changedFields.every(field => occurrenceFields.includes(field));
    return allChangesAreOccurrenceFields;
}
/**
 * Helper function to update summaries only (without running occurrence matching)
 */
async function updateSummaryOnly(afterData) {
    try {
        await (0, updateOutflowPeriodSummary_1.updateOutflowPeriodSummary)(afterData);
        console.log('[onOutflowPeriodUpdate] ✓ Summaries updated successfully');
        console.log('[onOutflowPeriodUpdate] ════════════════════════════════════════════');
        console.log('');
    }
    catch (summaryError) {
        console.error('[onOutflowPeriodUpdate] ⚠️  Summary update failed:', summaryError);
        console.log('[onOutflowPeriodUpdate] ════════════════════════════════════════════');
        console.log('');
    }
}
//# sourceMappingURL=onOutflowPeriodUpdate.js.map