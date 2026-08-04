// Export administrative functions
export { generateSourcePeriods } from "./generateSourcePeriods";
export { updateCurrentPeriods } from "./updateCurrentPeriods";
export { uploadCategoriesData } from "./uploadCategoriesData";
export { analyzeTransactionCategories } from "./analyzeTransactionCategories";
export { verifyAccessControl } from "./verifyAccessControl";
export { createTestUserPeriodSummaries } from "./createTestUserPeriodSummaries";
export { makeUserAdmin } from "./makeUserAdmin";

// Deprecated admin/debug/migration functions — deleted from prod 2026-08-04
// (safe-hygiene cleanup). Exports removed so a full deploy won't recreate them:
//   clearAndRegeneratePeriods, testCurrentPeriods, verifyUTCPeriods,
//   fetchRecurringTransactionsAdmin, auditTransactionAssignments,
//   debugUserSummaryUpdate, fixBudgetPeriodUserIds, fix_account_plaid_ids

// Transaction splitting migration functions (DEPRECATED - stubbed out)
// export {
//   migrateTransactionsToSplits,
//   verifyTransactionSplitsMigration
// } from "./migrateTransactionsToSplits";

// RBAC migration functions (DEPRECATED - stubbed out)
// export {
//   migrateTransactionsRBAC,
//   verifyTransactionsRBAC
// } from "./migrateTransactionsRBAC";

// User data cleanup functions — RETIRED 2026-07-30. Replaced by the full-erase
// `purge_user_data` callable + job (revokes Plaid tokens, hard-deletes ALL
// user-keyed collections, admin/self auth, race-guarded). The legacy
// cleanupUserData functions skipped Plaid revocation + newer collections and
// were VIEWER-gated. Their deployed functions are removed on the next
// `firebase deploy --only functions` (which prunes deleted exports).

// Budget spending migration functions (temporarily disabled)
// export {
//   migrateTransactionBudgetSpending,
//   getMigrationStatus
// } from "./migrateTransactionBudgetSpending";

// Plaid modern sync migration functions (temporarily disabled)
// export {
//   migratePlaidToModernSync,
//   getPlaidMigrationRecommendations
// } from "./migratePlaidToModernSync";