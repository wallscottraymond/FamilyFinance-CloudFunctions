"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeUserAdmin = exports.fix_account_plaid_ids = exports.fixBudgetPeriodUserIds = exports.debugUserSummaryUpdate = exports.createTestUserPeriodSummaries = exports.verifyAccessControl = exports.auditTransactionAssignments = exports.analyzeTransactionCategories = exports.uploadCategoriesData = exports.fetchRecurringTransactionsAdmin = exports.verifyUTCPeriods = exports.testCurrentPeriods = exports.clearAndRegeneratePeriods = exports.updateCurrentPeriods = exports.generateSourcePeriods = void 0;
// Export administrative functions
var generateSourcePeriods_1 = require("./generateSourcePeriods");
Object.defineProperty(exports, "generateSourcePeriods", { enumerable: true, get: function () { return generateSourcePeriods_1.generateSourcePeriods; } });
var updateCurrentPeriods_1 = require("./updateCurrentPeriods");
Object.defineProperty(exports, "updateCurrentPeriods", { enumerable: true, get: function () { return updateCurrentPeriods_1.updateCurrentPeriods; } });
var clearAndRegeneratePeriods_1 = require("./clearAndRegeneratePeriods");
Object.defineProperty(exports, "clearAndRegeneratePeriods", { enumerable: true, get: function () { return clearAndRegeneratePeriods_1.clearAndRegeneratePeriods; } });
var testCurrentPeriods_1 = require("./testCurrentPeriods");
Object.defineProperty(exports, "testCurrentPeriods", { enumerable: true, get: function () { return testCurrentPeriods_1.testCurrentPeriods; } });
var verifyUTCPeriods_1 = require("./verifyUTCPeriods");
Object.defineProperty(exports, "verifyUTCPeriods", { enumerable: true, get: function () { return verifyUTCPeriods_1.verifyUTCPeriods; } });
var fetchRecurringTransactionsAdmin_1 = require("./fetchRecurringTransactionsAdmin");
Object.defineProperty(exports, "fetchRecurringTransactionsAdmin", { enumerable: true, get: function () { return fetchRecurringTransactionsAdmin_1.fetchRecurringTransactionsAdmin; } });
var uploadCategoriesData_1 = require("./uploadCategoriesData");
Object.defineProperty(exports, "uploadCategoriesData", { enumerable: true, get: function () { return uploadCategoriesData_1.uploadCategoriesData; } });
var analyzeTransactionCategories_1 = require("./analyzeTransactionCategories");
Object.defineProperty(exports, "analyzeTransactionCategories", { enumerable: true, get: function () { return analyzeTransactionCategories_1.analyzeTransactionCategories; } });
var auditTransactionAssignments_1 = require("./auditTransactionAssignments");
Object.defineProperty(exports, "auditTransactionAssignments", { enumerable: true, get: function () { return auditTransactionAssignments_1.auditTransactionAssignments; } });
var verifyAccessControl_1 = require("./verifyAccessControl");
Object.defineProperty(exports, "verifyAccessControl", { enumerable: true, get: function () { return verifyAccessControl_1.verifyAccessControl; } });
var createTestUserPeriodSummaries_1 = require("./createTestUserPeriodSummaries");
Object.defineProperty(exports, "createTestUserPeriodSummaries", { enumerable: true, get: function () { return createTestUserPeriodSummaries_1.createTestUserPeriodSummaries; } });
var debugUserSummaryUpdate_1 = require("./debugUserSummaryUpdate");
Object.defineProperty(exports, "debugUserSummaryUpdate", { enumerable: true, get: function () { return debugUserSummaryUpdate_1.debugUserSummaryUpdate; } });
var fixBudgetPeriodUserIds_1 = require("./fixBudgetPeriodUserIds");
Object.defineProperty(exports, "fixBudgetPeriodUserIds", { enumerable: true, get: function () { return fixBudgetPeriodUserIds_1.fixBudgetPeriodUserIds; } });
var fix_account_plaid_ids_1 = require("./fix_account_plaid_ids");
Object.defineProperty(exports, "fix_account_plaid_ids", { enumerable: true, get: function () { return fix_account_plaid_ids_1.fix_account_plaid_ids; } });
var makeUserAdmin_1 = require("./makeUserAdmin");
Object.defineProperty(exports, "makeUserAdmin", { enumerable: true, get: function () { return makeUserAdmin_1.makeUserAdmin; } });
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