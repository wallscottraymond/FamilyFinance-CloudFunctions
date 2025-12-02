"use strict";
/**
 * Delete Outflow Period Summary
 *
 * Updates user and group summaries when an outflow period is deleted.
 * This function is called from the centralized summary trigger when
 * an outflow_period document is removed.
 *
 * The function recalculates the affected period group to reflect the
 * deletion and ensure summary totals remain accurate.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteOutflowPeriodSummary = deleteOutflowPeriodSummary;
const batchUpdateSummary_1 = require("../../utils/summaryOperations/batchUpdateSummary");
const periodTypeHelpers_1 = require("../utils/periodTypeHelpers");
/**
 * Update outflow summaries for a deleted period
 *
 * Updates both user and group summaries (if applicable) when an outflow
 * period is deleted. This ensures the period-centric summary system stays
 * in sync and total amounts are recalculated without the deleted period.
 *
 * @param periodData - The deleted outflow period data (from before snapshot)
 *
 * @throws Error if summary update fails (caller should catch and handle gracefully)
 *
 * @example
 * // Called from centralized trigger (summaries/triggers/outflowPeriodSummaryTriggers.ts)
 * try {
 *   await deleteOutflowPeriodSummary(outflowPeriod);
 *   console.log('✓ Summary updated after deletion');
 * } catch (error) {
 *   console.error('⚠️  Summary update failed:', error);
 *   // Don't re-throw - period deletion succeeds even if summary fails
 * }
 */
async function deleteOutflowPeriodSummary(periodData) {
    console.log('[deleteOutflowPeriodSummary] Updating outflow summaries after deletion...');
    // Determine period type from source period ID
    const periodType = (0, periodTypeHelpers_1.determinePeriodType)(periodData.sourcePeriodId);
    // Update user summary (recalculate without deleted period)
    const userSummaryId = (0, batchUpdateSummary_1.getSummaryId)(periodData.ownerId, 'user', periodType);
    console.log(`[deleteOutflowPeriodSummary] ✓ Updating user summary: ${userSummaryId}`);
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
    console.log(`[deleteOutflowPeriodSummary] ✓ User summary updated successfully`);
    // Update group summary if period belonged to a group
    if (periodData.groupId) {
        const groupSummaryId = (0, batchUpdateSummary_1.getSummaryId)(periodData.groupId, 'group', periodType);
        console.log(`[deleteOutflowPeriodSummary] ✓ Updating group summary: ${groupSummaryId}`);
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
        console.log(`[deleteOutflowPeriodSummary] ✓ Group summary updated successfully`);
    }
    console.log('[deleteOutflowPeriodSummary] ✓ Summary updates complete after deletion');
}
//# sourceMappingURL=deleteOutflowPeriodSummary.js.map