"use strict";
/**
 * Outflow Period Post-Update Orchestration
 *
 * This Cloud Function is triggered when an outflow_period is updated.
 * It handles post-update operations including summary recalculation.
 *
 * Memory: 256MiB, Timeout: 30s
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onOutflowPeriodUpdate = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
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
    var _a;
    try {
        const outflowPeriodId = event.params.outflowPeriodId;
        const afterData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.after.data();
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
        // Future orchestration steps could go here
        // Example: Re-validate period status, check payment consistency, etc.
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
//# sourceMappingURL=onOutflowPeriodUpdate.js.map