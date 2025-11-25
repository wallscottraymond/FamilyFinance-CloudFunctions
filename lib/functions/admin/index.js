"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeAllUserData = exports.removeAllUserTransactions = exports.removeAllUserInflows = exports.removeAllUserOutflows = exports.removeAllUserBudgets = exports.removeAllUserAccounts = exports.verifyAccessControl = exports.analyzeTransactionCategories = exports.uploadCategoriesData = exports.fetchRecurringTransactionsAdmin = exports.verifyUTCPeriods = exports.testCurrentPeriods = exports.clearAndRegeneratePeriods = exports.updateCurrentPeriods = exports.generateSourcePeriods = void 0;
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
var verifyAccessControl_1 = require("./verifyAccessControl");
Object.defineProperty(exports, "verifyAccessControl", { enumerable: true, get: function () { return verifyAccessControl_1.verifyAccessControl; } });
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
// User data cleanup functions
var cleanupUserData_1 = require("./cleanupUserData");
Object.defineProperty(exports, "removeAllUserAccounts", { enumerable: true, get: function () { return cleanupUserData_1.removeAllUserAccounts; } });
Object.defineProperty(exports, "removeAllUserBudgets", { enumerable: true, get: function () { return cleanupUserData_1.removeAllUserBudgets; } });
Object.defineProperty(exports, "removeAllUserOutflows", { enumerable: true, get: function () { return cleanupUserData_1.removeAllUserOutflows; } });
Object.defineProperty(exports, "removeAllUserInflows", { enumerable: true, get: function () { return cleanupUserData_1.removeAllUserInflows; } });
Object.defineProperty(exports, "removeAllUserTransactions", { enumerable: true, get: function () { return cleanupUserData_1.removeAllUserTransactions; } });
Object.defineProperty(exports, "removeAllUserData", { enumerable: true, get: function () { return cleanupUserData_1.removeAllUserData; } });
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