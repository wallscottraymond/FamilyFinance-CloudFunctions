"use strict";
/**
 * @file fixtures/index.ts
 * @description Main entry point for all test fixtures
 *
 * This module provides centralized test data for the FamilyFinance application.
 * All test data is pre-constructed with proper types and dynamic dates that
 * never go stale.
 *
 * STRUCTURE:
 * - constants: Test IDs (users, groups, accounts, budgets)
 * - categories: Category ID constants from categories-data.json
 * - dateHelpers: Dynamic date generators
 * - budgets/: Complete budget test scenarios
 *   - weeklyBudget: Weekly groceries budget
 *   - monthlyBudget: Monthly entertainment budget
 *   - biweeklyBudget: Bi-weekly transportation budget (shared)
 *
 * USAGE:
 * ```typescript
 * import { TEST_USER, CATEGORIES, weeklyGroceriesBudget } from '../fixtures';
 * ```
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDate = exports.toTimestamp = exports.now = exports.monthsAgoPeriodId = exports.currentBiMonthlyPeriodId = exports.currentWeekPeriodId = exports.currentMonthPeriodId = exports.dayOfMonthsAgo = exports.dayOfCurrentMonth = exports.monthsAgoEnd = exports.monthsAgoStart = exports.daysFromNow = exports.daysAgo = exports.currentWeekEnd = exports.currentWeekStart = exports.currentMonthEnd = exports.currentMonthStart = exports.SHOPPING_CATEGORIES = exports.UTILITIES_CATEGORIES = exports.ENTERTAINMENT_CATEGORIES = exports.TRANSPORTATION_CATEGORIES = exports.FOOD_AND_DRINK_CATEGORIES = exports.CATEGORIES = exports.generateTxnId = exports.TXN_PREFIX = exports.DEFAULTS = exports.TEST_BUDGET_ID = exports.TEST_ACCOUNT = exports.TEST_GROUP = exports.TEST_USER = void 0;
// ============================================================================
// CONSTANTS
// ============================================================================
var constants_1 = require("./constants");
Object.defineProperty(exports, "TEST_USER", { enumerable: true, get: function () { return constants_1.TEST_USER; } });
Object.defineProperty(exports, "TEST_GROUP", { enumerable: true, get: function () { return constants_1.TEST_GROUP; } });
Object.defineProperty(exports, "TEST_ACCOUNT", { enumerable: true, get: function () { return constants_1.TEST_ACCOUNT; } });
Object.defineProperty(exports, "TEST_BUDGET_ID", { enumerable: true, get: function () { return constants_1.TEST_BUDGET_ID; } });
Object.defineProperty(exports, "DEFAULTS", { enumerable: true, get: function () { return constants_1.DEFAULTS; } });
Object.defineProperty(exports, "TXN_PREFIX", { enumerable: true, get: function () { return constants_1.TXN_PREFIX; } });
Object.defineProperty(exports, "generateTxnId", { enumerable: true, get: function () { return constants_1.generateTxnId; } });
// ============================================================================
// CATEGORIES
// ============================================================================
var categories_1 = require("./categories");
Object.defineProperty(exports, "CATEGORIES", { enumerable: true, get: function () { return categories_1.CATEGORIES; } });
// Category groups
Object.defineProperty(exports, "FOOD_AND_DRINK_CATEGORIES", { enumerable: true, get: function () { return categories_1.FOOD_AND_DRINK_CATEGORIES; } });
Object.defineProperty(exports, "TRANSPORTATION_CATEGORIES", { enumerable: true, get: function () { return categories_1.TRANSPORTATION_CATEGORIES; } });
Object.defineProperty(exports, "ENTERTAINMENT_CATEGORIES", { enumerable: true, get: function () { return categories_1.ENTERTAINMENT_CATEGORIES; } });
Object.defineProperty(exports, "UTILITIES_CATEGORIES", { enumerable: true, get: function () { return categories_1.UTILITIES_CATEGORIES; } });
Object.defineProperty(exports, "SHOPPING_CATEGORIES", { enumerable: true, get: function () { return categories_1.SHOPPING_CATEGORIES; } });
// ============================================================================
// DATE HELPERS
// ============================================================================
var dateHelpers_1 = require("./dateHelpers");
// Current period
Object.defineProperty(exports, "currentMonthStart", { enumerable: true, get: function () { return dateHelpers_1.currentMonthStart; } });
Object.defineProperty(exports, "currentMonthEnd", { enumerable: true, get: function () { return dateHelpers_1.currentMonthEnd; } });
Object.defineProperty(exports, "currentWeekStart", { enumerable: true, get: function () { return dateHelpers_1.currentWeekStart; } });
Object.defineProperty(exports, "currentWeekEnd", { enumerable: true, get: function () { return dateHelpers_1.currentWeekEnd; } });
// Relative dates
Object.defineProperty(exports, "daysAgo", { enumerable: true, get: function () { return dateHelpers_1.daysAgo; } });
Object.defineProperty(exports, "daysFromNow", { enumerable: true, get: function () { return dateHelpers_1.daysFromNow; } });
Object.defineProperty(exports, "monthsAgoStart", { enumerable: true, get: function () { return dateHelpers_1.monthsAgoStart; } });
Object.defineProperty(exports, "monthsAgoEnd", { enumerable: true, get: function () { return dateHelpers_1.monthsAgoEnd; } });
Object.defineProperty(exports, "dayOfCurrentMonth", { enumerable: true, get: function () { return dateHelpers_1.dayOfCurrentMonth; } });
Object.defineProperty(exports, "dayOfMonthsAgo", { enumerable: true, get: function () { return dateHelpers_1.dayOfMonthsAgo; } });
// Period IDs
Object.defineProperty(exports, "currentMonthPeriodId", { enumerable: true, get: function () { return dateHelpers_1.currentMonthPeriodId; } });
Object.defineProperty(exports, "currentWeekPeriodId", { enumerable: true, get: function () { return dateHelpers_1.currentWeekPeriodId; } });
Object.defineProperty(exports, "currentBiMonthlyPeriodId", { enumerable: true, get: function () { return dateHelpers_1.currentBiMonthlyPeriodId; } });
Object.defineProperty(exports, "monthsAgoPeriodId", { enumerable: true, get: function () { return dateHelpers_1.monthsAgoPeriodId; } });
// Utilities
Object.defineProperty(exports, "now", { enumerable: true, get: function () { return dateHelpers_1.now; } });
Object.defineProperty(exports, "toTimestamp", { enumerable: true, get: function () { return dateHelpers_1.toTimestamp; } });
Object.defineProperty(exports, "createDate", { enumerable: true, get: function () { return dateHelpers_1.createDate; } });
// ============================================================================
// BUDGETS
// ============================================================================
__exportStar(require("./budgets"), exports);
//# sourceMappingURL=index.js.map