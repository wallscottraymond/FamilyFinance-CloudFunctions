"use strict";
/**
 * Development & Testing Functions for Budgets
 *
 * These functions are designed to help with frontend testing and development.
 * They allow quick creation of test budgets and transactions to verify:
 * - Budget period generation
 * - User_summaries updates
 * - Spending calculations
 * - Budget system integration
 *
 * IMPORTANT: These functions should only be used in development/staging environments.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestBudgetSuite = exports.createTestTransaction = exports.createTestBudget = void 0;
var createTestBudget_1 = require("./createTestBudget");
Object.defineProperty(exports, "createTestBudget", { enumerable: true, get: function () { return createTestBudget_1.createTestBudget; } });
var createTestTransaction_1 = require("./createTestTransaction");
Object.defineProperty(exports, "createTestTransaction", { enumerable: true, get: function () { return createTestTransaction_1.createTestTransaction; } });
var createTestBudgetSuite_1 = require("./createTestBudgetSuite");
Object.defineProperty(exports, "createTestBudgetSuite", { enumerable: true, get: function () { return createTestBudgetSuite_1.createTestBudgetSuite; } });
//# sourceMappingURL=index.js.map