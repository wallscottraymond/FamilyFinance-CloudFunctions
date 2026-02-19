"use strict";
/**
 * @file budgets/index.ts
 * @description Central export for all budget test fixtures
 *
 * USAGE:
 * import { weeklyGroceriesBudget, monthlyEntertainmentBudget } from '../fixtures/budgets';
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.TEST_BUDGET_MAP = exports.ALL_TEST_BUDGETS = exports.transportationTxn_split = exports.transportationTxn_pending = exports.transportationWeeklyPeriod = exports.transportationMonthlyPeriod = exports.transportationBiMonthlyPeriodSecond = exports.transportationBiMonthlyPeriodFirst = exports.biweeklyTransportationExpectedValues = exports.biweeklyCreditCardTransactions = exports.biweeklySharedTransactions = exports.biweeklyGasTransactions = exports.biweeklyTransportationTransactions = exports.biweeklyTransportationBudgetPeriods = exports.biweeklyTransportationBudget = exports.entertainmentTxn_split = exports.entertainmentTxn_subscription = exports.entertainmentBiMonthlyPeriod = exports.entertainmentWeeklyPeriod = exports.entertainmentMonthlyPeriodLastMonth = exports.entertainmentMonthlyPeriod = exports.monthlyEntertainmentExpectedValues = exports.monthlyEntertainmentCurrentMonthTransactions = exports.monthlyEntertainmentRecurringTransactions = exports.monthlyEntertainmentTransactions = exports.monthlyEntertainmentBudgetPeriods = exports.monthlyEntertainmentBudget = exports.weeklyTxn_excluded = exports.weeklyTxn_pending = exports.weeklyTxn_refund = exports.weeklyTxn_normal = exports.weeklyGroceriesBiMonthlyPeriod = exports.weeklyGroceriesMonthlyPeriod = exports.weeklyGroceriesWeeklyPeriod = exports.weeklyGroceriesExpectedValues = exports.weeklyGroceriesCurrentMonthSpent = exports.weeklyGroceriesCurrentMonthTransactions = exports.weeklyGroceriesActiveTransactions = exports.weeklyGroceriesTransactions = exports.weeklyGroceriesBudgetPeriods = exports.weeklyGroceriesBudget = void 0;
// Weekly Groceries Budget
var weeklyBudget_1 = require("./weeklyBudget");
Object.defineProperty(exports, "weeklyGroceriesBudget", { enumerable: true, get: function () { return weeklyBudget_1.weeklyGroceriesBudget; } });
Object.defineProperty(exports, "weeklyGroceriesBudgetPeriods", { enumerable: true, get: function () { return weeklyBudget_1.weeklyGroceriesBudgetPeriods; } });
Object.defineProperty(exports, "weeklyGroceriesTransactions", { enumerable: true, get: function () { return weeklyBudget_1.weeklyGroceriesTransactions; } });
Object.defineProperty(exports, "weeklyGroceriesActiveTransactions", { enumerable: true, get: function () { return weeklyBudget_1.weeklyGroceriesActiveTransactions; } });
Object.defineProperty(exports, "weeklyGroceriesCurrentMonthTransactions", { enumerable: true, get: function () { return weeklyBudget_1.weeklyGroceriesCurrentMonthTransactions; } });
Object.defineProperty(exports, "weeklyGroceriesCurrentMonthSpent", { enumerable: true, get: function () { return weeklyBudget_1.weeklyGroceriesCurrentMonthSpent; } });
Object.defineProperty(exports, "weeklyGroceriesExpectedValues", { enumerable: true, get: function () { return weeklyBudget_1.weeklyGroceriesExpectedValues; } });
// Individual periods
Object.defineProperty(exports, "weeklyGroceriesWeeklyPeriod", { enumerable: true, get: function () { return weeklyBudget_1.weeklyPeriodCurrent; } });
Object.defineProperty(exports, "weeklyGroceriesMonthlyPeriod", { enumerable: true, get: function () { return weeklyBudget_1.monthlyPeriodCurrent; } });
Object.defineProperty(exports, "weeklyGroceriesBiMonthlyPeriod", { enumerable: true, get: function () { return weeklyBudget_1.biMonthlyPeriodCurrent; } });
// Individual transactions
Object.defineProperty(exports, "weeklyTxn_normal", { enumerable: true, get: function () { return weeklyBudget_1.txn1_normalPurchase; } });
Object.defineProperty(exports, "weeklyTxn_refund", { enumerable: true, get: function () { return weeklyBudget_1.txn4_refund; } });
Object.defineProperty(exports, "weeklyTxn_pending", { enumerable: true, get: function () { return weeklyBudget_1.txn5_pending; } });
Object.defineProperty(exports, "weeklyTxn_excluded", { enumerable: true, get: function () { return weeklyBudget_1.txn6_excluded; } });
// Monthly Entertainment Budget
var monthlyBudget_1 = require("./monthlyBudget");
Object.defineProperty(exports, "monthlyEntertainmentBudget", { enumerable: true, get: function () { return monthlyBudget_1.monthlyEntertainmentBudget; } });
Object.defineProperty(exports, "monthlyEntertainmentBudgetPeriods", { enumerable: true, get: function () { return monthlyBudget_1.monthlyEntertainmentBudgetPeriods; } });
Object.defineProperty(exports, "monthlyEntertainmentTransactions", { enumerable: true, get: function () { return monthlyBudget_1.monthlyEntertainmentTransactions; } });
Object.defineProperty(exports, "monthlyEntertainmentRecurringTransactions", { enumerable: true, get: function () { return monthlyBudget_1.monthlyEntertainmentRecurringTransactions; } });
Object.defineProperty(exports, "monthlyEntertainmentCurrentMonthTransactions", { enumerable: true, get: function () { return monthlyBudget_1.monthlyEntertainmentCurrentMonthTransactions; } });
Object.defineProperty(exports, "monthlyEntertainmentExpectedValues", { enumerable: true, get: function () { return monthlyBudget_1.monthlyEntertainmentExpectedValues; } });
// Individual periods
Object.defineProperty(exports, "entertainmentMonthlyPeriod", { enumerable: true, get: function () { return monthlyBudget_1.monthlyPeriodCurrent; } });
Object.defineProperty(exports, "entertainmentMonthlyPeriodLastMonth", { enumerable: true, get: function () { return monthlyBudget_1.monthlyPeriodLastMonth; } });
Object.defineProperty(exports, "entertainmentWeeklyPeriod", { enumerable: true, get: function () { return monthlyBudget_1.weeklyPeriodCurrent; } });
Object.defineProperty(exports, "entertainmentBiMonthlyPeriod", { enumerable: true, get: function () { return monthlyBudget_1.biMonthlyPeriodCurrent; } });
// Individual transactions
Object.defineProperty(exports, "entertainmentTxn_subscription", { enumerable: true, get: function () { return monthlyBudget_1.txn1_netflixSubscription; } });
Object.defineProperty(exports, "entertainmentTxn_split", { enumerable: true, get: function () { return monthlyBudget_1.txn9_splitTransaction; } });
// Bi-weekly Transportation Budget
var biweeklyBudget_1 = require("./biweeklyBudget");
Object.defineProperty(exports, "biweeklyTransportationBudget", { enumerable: true, get: function () { return biweeklyBudget_1.biweeklyTransportationBudget; } });
Object.defineProperty(exports, "biweeklyTransportationBudgetPeriods", { enumerable: true, get: function () { return biweeklyBudget_1.biweeklyTransportationBudgetPeriods; } });
Object.defineProperty(exports, "biweeklyTransportationTransactions", { enumerable: true, get: function () { return biweeklyBudget_1.biweeklyTransportationTransactions; } });
Object.defineProperty(exports, "biweeklyGasTransactions", { enumerable: true, get: function () { return biweeklyBudget_1.biweeklyGasTransactions; } });
Object.defineProperty(exports, "biweeklySharedTransactions", { enumerable: true, get: function () { return biweeklyBudget_1.biweeklySharedTransactions; } });
Object.defineProperty(exports, "biweeklyCreditCardTransactions", { enumerable: true, get: function () { return biweeklyBudget_1.biweeklyCreditCardTransactions; } });
Object.defineProperty(exports, "biweeklyTransportationExpectedValues", { enumerable: true, get: function () { return biweeklyBudget_1.biweeklyTransportationExpectedValues; } });
// Individual periods
Object.defineProperty(exports, "transportationBiMonthlyPeriodFirst", { enumerable: true, get: function () { return biweeklyBudget_1.biMonthlyPeriodCurrentFirst; } });
Object.defineProperty(exports, "transportationBiMonthlyPeriodSecond", { enumerable: true, get: function () { return biweeklyBudget_1.biMonthlyPeriodCurrentSecond; } });
Object.defineProperty(exports, "transportationMonthlyPeriod", { enumerable: true, get: function () { return biweeklyBudget_1.monthlyPeriodCurrent; } });
Object.defineProperty(exports, "transportationWeeklyPeriod", { enumerable: true, get: function () { return biweeklyBudget_1.weeklyPeriodCurrent; } });
// Individual transactions
Object.defineProperty(exports, "transportationTxn_pending", { enumerable: true, get: function () { return biweeklyBudget_1.txn5_gasHoldPending; } });
Object.defineProperty(exports, "transportationTxn_split", { enumerable: true, get: function () { return biweeklyBudget_1.txn11_roadTripSplit; } });
// ============================================================================
// ALL BUDGETS (for iteration)
// ============================================================================
const weeklyBudget_2 = require("./weeklyBudget");
const monthlyBudget_2 = require("./monthlyBudget");
const biweeklyBudget_2 = require("./biweeklyBudget");
/** Array of all test budgets */
exports.ALL_TEST_BUDGETS = [
    weeklyBudget_2.weeklyGroceriesBudget,
    monthlyBudget_2.monthlyEntertainmentBudget,
    biweeklyBudget_2.biweeklyTransportationBudget,
];
/** Map of budget IDs to budgets */
exports.TEST_BUDGET_MAP = {
    [weeklyBudget_2.weeklyGroceriesBudget.id]: weeklyBudget_2.weeklyGroceriesBudget,
    [monthlyBudget_2.monthlyEntertainmentBudget.id]: monthlyBudget_2.monthlyEntertainmentBudget,
    [biweeklyBudget_2.biweeklyTransportationBudget.id]: biweeklyBudget_2.biweeklyTransportationBudget,
};
//# sourceMappingURL=index.js.map