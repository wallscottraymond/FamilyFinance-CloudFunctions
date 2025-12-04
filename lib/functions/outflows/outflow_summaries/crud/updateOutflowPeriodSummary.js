"use strict";
/**
 * Update Outflow Period Summary
 *
 * Updates user and group summaries when an outflow period is updated.
 * This function is called from the centralized summary trigger when
 * an outflow_period document is modified.
 *
 * The function recalculates the affected period group to reflect changes
 * in amounts, status, or other relevant fields.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateOutflowPeriodSummary = updateOutflowPeriodSummary;
const batchUpdateSummary_1 = require("../utils/batchUpdateSummary");
const periodTypeHelpers_1 = require("../utils/periodTypeHelpers");
/**
 * Update outflow summaries for a modified period
 *
 * Updates both user and group summaries (if applicable) when an outflow
 * period is updated. This ensures the period-centric summary system stays
 * in sync with changes to amounts, status, or payment information.
 *
 * @param periodData - The updated outflow period data
 *
 * @throws Error if summary update fails (caller should catch and handle gracefully)
 *
 * @example
 * // Called from centralized trigger (summaries/triggers/outflowPeriodSummaryTriggers.ts)
 * try {
 *   await updateOutflowPeriodSummary(outflowPeriod);
 *   console.log('✓ Summary updated successfully');
 * } catch (error) {
 *   console.error('⚠️  Summary update failed:', error);
 *   // Don't re-throw - period update succeeds even if summary fails
 * }
 */
async function updateOutflowPeriodSummary(periodData) {
    console.log('[updateOutflowPeriodSummary] Updating outflow summaries...');
    // Determine period type from source period ID
    const periodType = (0, periodTypeHelpers_1.determinePeriodType)(periodData.sourcePeriodId);
    // Update user summary
    const userSummaryId = (0, batchUpdateSummary_1.getSummaryId)(periodData.ownerId, 'user', periodType);
    console.log(`[updateOutflowPeriodSummary] ✓ Updating user summary: ${userSummaryId}`);
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
    console.log(`[updateOutflowPeriodSummary] ✓ User summary updated successfully`);
    // Update group summary if period belongs to a group
    if (periodData.groupId) {
        const groupSummaryId = (0, batchUpdateSummary_1.getSummaryId)(periodData.groupId, 'group', periodType);
        console.log(`[updateOutflowPeriodSummary] ✓ Updating group summary: ${groupSummaryId}`);
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
        console.log(`[updateOutflowPeriodSummary] ✓ Group summary updated successfully`);
    }
    console.log('[updateOutflowPeriodSummary] ✓ Summary updates complete');
}
//# sourceMappingURL=updateOutflowPeriodSummary.js.map