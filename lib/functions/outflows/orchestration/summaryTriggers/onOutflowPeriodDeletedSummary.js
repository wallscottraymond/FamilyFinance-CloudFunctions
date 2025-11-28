"use strict";
/**
 * Outflow Period Summary Update on Deletion
 *
 * This trigger updates the outflow summary when an outflow_period is deleted.
 * It recalculates the affected sourcePeriodId group, potentially removing it if empty.
 *
 * Memory: 256MiB, Timeout: 30s
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.onOutflowPeriodDeletedSummary = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const batchUpdateSummary_1 = require("../../utils/summaryOperations/batchUpdateSummary");
/**
 * Triggered when an outflow_period is deleted
 * Updates user and group summaries by recalculating the affected period group
 * If this was the last period in the group, the entire sourcePeriodId key is removed
 */
exports.onOutflowPeriodDeletedSummary = (0, firestore_1.onDocumentDeleted)({
    document: 'outflow_periods/{outflowPeriodId}',
    region: 'us-central1',
    memory: '256MiB',
    timeoutSeconds: 30,
}, async (event) => {
    var _a;
    try {
        const outflowPeriodId = event.params.outflowPeriodId;
        const periodData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
        if (!periodData) {
            console.error('[onOutflowPeriodDeletedSummary] No period data found');
            return;
        }
        console.log('');
        console.log('[onOutflowPeriodDeletedSummary] ════════════════════════════════════════════');
        console.log('[onOutflowPeriodDeletedSummary] UPDATING OUTFLOW SUMMARY');
        console.log('[onOutflowPeriodDeletedSummary] ════════════════════════════════════════════');
        console.log(`[onOutflowPeriodDeletedSummary] Period ID: ${outflowPeriodId}`);
        console.log(`[onOutflowPeriodDeletedSummary] Source Period: ${periodData.sourcePeriodId}`);
        console.log('');
        // Determine period type from source period ID
        const periodType = determinePeriodType(periodData.sourcePeriodId);
        // Update user summary
        const userSummaryId = (0, batchUpdateSummary_1.getSummaryId)(periodData.ownerId, 'user', periodType);
        console.log(`[onOutflowPeriodDeletedSummary] Updating user summary: ${userSummaryId}`);
        await (0, batchUpdateSummary_1.batchUpdateSummary)({
            summaryId: userSummaryId,
            operations: [{
                    type: 'recalculate',
                    data: {
                        sourcePeriodId: periodData.sourcePeriodId,
                        ownerId: periodData.ownerId,
                        ownerType: 'user',
                        periodType
                    }
                }]
        });
        console.log(`[onOutflowPeriodDeletedSummary] ✓ User summary updated successfully`);
        // Update group summary if period belonged to a group
        if (periodData.groupId) {
            const groupSummaryId = (0, batchUpdateSummary_1.getSummaryId)(periodData.groupId, 'group', periodType);
            console.log(`[onOutflowPeriodDeletedSummary] Updating group summary: ${groupSummaryId}`);
            await (0, batchUpdateSummary_1.batchUpdateSummary)({
                summaryId: groupSummaryId,
                operations: [{
                        type: 'recalculate',
                        data: {
                            sourcePeriodId: periodData.sourcePeriodId,
                            ownerId: periodData.groupId,
                            ownerType: 'group',
                            periodType
                        }
                    }]
            });
            console.log(`[onOutflowPeriodDeletedSummary] ✓ Group summary updated successfully`);
        }
        console.log('[onOutflowPeriodDeletedSummary] ════════════════════════════════════════════');
        console.log('');
    }
    catch (error) {
        console.error('');
        console.error('[onOutflowPeriodDeletedSummary] ❌ ERROR:', error);
        console.error('');
        // Don't throw - summary update failures shouldn't break period deletion
    }
});
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
//# sourceMappingURL=onOutflowPeriodDeletedSummary.js.map