"use strict";
/**
 * Outflow Period Summary Update on Update
 *
 * This trigger updates the outflow summary when an outflow_period is updated.
 * It recalculates the affected sourcePeriodId group to reflect changes in amounts or status.
 *
 * Memory: 256MiB, Timeout: 30s
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onOutflowPeriodUpdatedSummary = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const batchUpdateSummary_1 = require("../../utils/summaryOperations/batchUpdateSummary");
/**
 * Triggered when an outflow_period is updated
 * Updates user and group summaries by recalculating the affected period group
 */
exports.onOutflowPeriodUpdatedSummary = (0, firestore_1.onDocumentUpdated)({
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
            console.error('[onOutflowPeriodUpdatedSummary] No after data found');
            return;
        }
        // Check if relevant fields changed
        const relevantFieldsChanged = hasRelevantChanges(beforeData, afterData);
        if (!relevantFieldsChanged) {
            console.log(`[onOutflowPeriodUpdatedSummary] No relevant changes for ${outflowPeriodId}, skipping summary update`);
            return;
        }
        console.log('');
        console.log('[onOutflowPeriodUpdatedSummary] ════════════════════════════════════════════');
        console.log('[onOutflowPeriodUpdatedSummary] UPDATING OUTFLOW SUMMARY');
        console.log('[onOutflowPeriodUpdatedSummary] ════════════════════════════════════════════');
        console.log(`[onOutflowPeriodUpdatedSummary] Period ID: ${outflowPeriodId}`);
        console.log(`[onOutflowPeriodUpdatedSummary] Source Period: ${afterData.sourcePeriodId}`);
        console.log('');
        // Determine period type from source period ID
        const periodType = determinePeriodType(afterData.sourcePeriodId);
        // Update user summary
        const userSummaryId = (0, batchUpdateSummary_1.getSummaryId)(afterData.ownerId, 'user', periodType);
        console.log(`[onOutflowPeriodUpdatedSummary] Updating user summary: ${userSummaryId}`);
        await (0, batchUpdateSummary_1.batchUpdateSummary)({
            summaryId: userSummaryId,
            operations: [{
                    type: 'recalculate',
                    data: {
                        sourcePeriodId: afterData.sourcePeriodId,
                        ownerId: afterData.ownerId,
                        ownerType: 'user',
                        periodType
                    }
                }]
        });
        console.log(`[onOutflowPeriodUpdatedSummary] ✓ User summary updated successfully`);
        // Update group summary if period belongs to a group
        if (afterData.groupId) {
            const groupSummaryId = (0, batchUpdateSummary_1.getSummaryId)(afterData.groupId, 'group', periodType);
            console.log(`[onOutflowPeriodUpdatedSummary] Updating group summary: ${groupSummaryId}`);
            await (0, batchUpdateSummary_1.batchUpdateSummary)({
                summaryId: groupSummaryId,
                operations: [{
                        type: 'recalculate',
                        data: {
                            sourcePeriodId: afterData.sourcePeriodId,
                            ownerId: afterData.groupId,
                            ownerType: 'group',
                            periodType
                        }
                    }]
            });
            console.log(`[onOutflowPeriodUpdatedSummary] ✓ Group summary updated successfully`);
        }
        console.log('[onOutflowPeriodUpdatedSummary] ════════════════════════════════════════════');
        console.log('');
    }
    catch (error) {
        console.error('');
        console.error('[onOutflowPeriodUpdatedSummary] ❌ ERROR:', error);
        console.error('');
        // Don't throw - summary update failures shouldn't break period updates
    }
});
/**
 * Check if any relevant fields changed that would affect the summary
 */
function hasRelevantChanges(before, after) {
    return (before.totalAmountDue !== after.totalAmountDue ||
        before.totalAmountPaid !== after.totalAmountPaid ||
        before.totalAmountUnpaid !== after.totalAmountUnpaid ||
        before.amountWithheld !== after.amountWithheld ||
        before.averageAmount !== after.averageAmount ||
        before.isDuePeriod !== after.isDuePeriod ||
        before.status !== after.status ||
        before.isFullyPaid !== after.isFullyPaid ||
        before.isPartiallyPaid !== after.isPartiallyPaid ||
        before.isActive !== after.isActive);
}
/**
 * Determine PeriodType from sourcePeriodId format
 */
function determinePeriodType(sourcePeriodId) {
    const { PeriodType } = require('../../../../types');
    if (sourcePeriodId.includes('-M') && !sourcePeriodId.includes('-BM')) {
        return PeriodType.MONTHLY;
    }
    else if (sourcePeriodId.includes('-BM')) {
        return PeriodType.BI_MONTHLY;
    }
    else if (sourcePeriodId.includes('-W')) {
        return PeriodType.WEEKLY;
    }
    return PeriodType.MONTHLY;
}
//# sourceMappingURL=onOutflowPeriodUpdatedSummary.js.map