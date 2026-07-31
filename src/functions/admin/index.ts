// Export administrative functions
export { generateSourcePeriods } from "./generateSourcePeriods";
export { updateCurrentPeriods } from "./updateCurrentPeriods";
export { clearAndRegeneratePeriods } from "./clearAndRegeneratePeriods";
export { testCurrentPeriods } from "./testCurrentPeriods";
export { verifyUTCPeriods } from "./verifyUTCPeriods";
export { fetchRecurringTransactionsAdmin } from "./fetchRecurringTransactionsAdmin";
export { uploadCategoriesData } from "./uploadCategoriesData";
export { analyzeTransactionCategories } from "./analyzeTransactionCategories";
export { auditTransactionAssignments } from "./auditTransactionAssignments";
export { verifyAccessControl } from "./verifyAccessControl";
export { createTestUserPeriodSummaries } from "./createTestUserPeriodSummaries";
export { debugUserSummaryUpdate } from "./debugUserSummaryUpdate";
export { fixBudgetPeriodUserIds } from "./fixBudgetPeriodUserIds";
export { fix_account_plaid_ids } from "./fix_account_plaid_ids";
export { makeUserAdmin } from "./makeUserAdmin";

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