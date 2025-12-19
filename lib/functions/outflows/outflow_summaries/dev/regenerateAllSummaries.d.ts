/**
 * Regenerate All Outflow Summaries with Occurrence Tracking Data
 *
 * This dev function recalculates all outflow summary documents to include
 * the new occurrence tracking fields that were added in the latest update.
 *
 * USE CASE: After deploying occurrence tracking changes, run this function
 * to populate existing summary documents with occurrence data.
 */
/**
 * Regenerate all outflow summaries for a user
 *
 * This function:
 * 1. Finds all unique (ownerId, periodType, sourcePeriodId) combinations
 * 2. Recalculates each period group with the new occurrence tracking fields
 * 3. Updates the summary documents
 *
 * @param userId - User ID to regenerate summaries for
 */
export declare const regenerateAllOutflowSummaries: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=regenerateAllSummaries.d.ts.map