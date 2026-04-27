/**
 * Delete budget (hard delete)
 *
 * Permanently deletes:
 * - The budget document
 * - All budget_periods for this budget
 * - Removes budget from user_summary
 * - Reassigns transaction splits to "Everything Else" budget
 */
export declare const deleteBudget: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=deleteBudget.d.ts.map