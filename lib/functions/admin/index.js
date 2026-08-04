"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeUserAdmin = exports.createTestUserPeriodSummaries = exports.verifyAccessControl = exports.analyzeTransactionCategories = exports.uploadCategoriesData = exports.updateCurrentPeriods = exports.generateSourcePeriods = void 0;
// Export administrative functions
var generateSourcePeriods_1 = require("./generateSourcePeriods");
Object.defineProperty(exports, "generateSourcePeriods", { enumerable: true, get: function () { return generateSourcePeriods_1.generateSourcePeriods; } });
var updateCurrentPeriods_1 = require("./updateCurrentPeriods");
Object.defineProperty(exports, "updateCurrentPeriods", { enumerable: true, get: function () { return updateCurrentPeriods_1.updateCurrentPeriods; } });
var uploadCategoriesData_1 = require("./uploadCategoriesData");
Object.defineProperty(exports, "uploadCategoriesData", { enumerable: true, get: function () { return uploadCategoriesData_1.uploadCategoriesData; } });
var analyzeTransactionCategories_1 = require("./analyzeTransactionCategories");
Object.defineProperty(exports, "analyzeTransactionCategories", { enumerable: true, get: function () { return analyzeTransactionCategories_1.analyzeTransactionCategories; } });
var verifyAccessControl_1 = require("./verifyAccessControl");
Object.defineProperty(exports, "verifyAccessControl", { enumerable: true, get: function () { return verifyAccessControl_1.verifyAccessControl; } });
var createTestUserPeriodSummaries_1 = require("./createTestUserPeriodSummaries");
Object.defineProperty(exports, "createTestUserPeriodSummaries", { enumerable: true, get: function () { return createTestUserPeriodSummaries_1.createTestUserPeriodSummaries; } });
var makeUserAdmin_1 = require("./makeUserAdmin");
Object.defineProperty(exports, "makeUserAdmin", { enumerable: true, get: function () { return makeUserAdmin_1.makeUserAdmin; } });
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
//# sourceMappingURL=index.js.map