/**
 * @file budgets/index.ts
 * @description Central export for all budget test fixtures
 *
 * USAGE:
 * import { weeklyGroceriesBudget, monthlyEntertainmentBudget } from '../fixtures/budgets';
 */

// Weekly Groceries Budget
export {
  weeklyGroceriesBudget,
  weeklyGroceriesBudgetPeriods,
  weeklyGroceriesTransactions,
  weeklyGroceriesActiveTransactions,
  weeklyGroceriesCurrentMonthTransactions,
  weeklyGroceriesCurrentMonthSpent,
  weeklyGroceriesExpectedValues,
  // Individual periods
  weeklyPeriodCurrent as weeklyGroceriesWeeklyPeriod,
  monthlyPeriodCurrent as weeklyGroceriesMonthlyPeriod,
  biMonthlyPeriodCurrent as weeklyGroceriesBiMonthlyPeriod,
  // Individual transactions
  txn1_normalPurchase as weeklyTxn_normal,
  txn4_refund as weeklyTxn_refund,
  txn5_pending as weeklyTxn_pending,
  txn6_excluded as weeklyTxn_excluded,
} from './weeklyBudget';

// Monthly Entertainment Budget
export {
  monthlyEntertainmentBudget,
  monthlyEntertainmentBudgetPeriods,
  monthlyEntertainmentTransactions,
  monthlyEntertainmentRecurringTransactions,
  monthlyEntertainmentCurrentMonthTransactions,
  monthlyEntertainmentExpectedValues,
  // Individual periods
  monthlyPeriodCurrent as entertainmentMonthlyPeriod,
  monthlyPeriodLastMonth as entertainmentMonthlyPeriodLastMonth,
  weeklyPeriodCurrent as entertainmentWeeklyPeriod,
  biMonthlyPeriodCurrent as entertainmentBiMonthlyPeriod,
  // Individual transactions
  txn1_netflixSubscription as entertainmentTxn_subscription,
  txn9_splitTransaction as entertainmentTxn_split,
} from './monthlyBudget';

// Bi-weekly Transportation Budget
export {
  biweeklyTransportationBudget,
  biweeklyTransportationBudgetPeriods,
  biweeklyTransportationTransactions,
  biweeklyGasTransactions,
  biweeklySharedTransactions,
  biweeklyCreditCardTransactions,
  biweeklyTransportationExpectedValues,
  // Individual periods
  biMonthlyPeriodCurrentFirst as transportationBiMonthlyPeriodFirst,
  biMonthlyPeriodCurrentSecond as transportationBiMonthlyPeriodSecond,
  monthlyPeriodCurrent as transportationMonthlyPeriod,
  weeklyPeriodCurrent as transportationWeeklyPeriod,
  // Individual transactions
  txn5_gasHoldPending as transportationTxn_pending,
  txn11_roadTripSplit as transportationTxn_split,
} from './biweeklyBudget';

// ============================================================================
// ALL BUDGETS (for iteration)
// ============================================================================

import { weeklyGroceriesBudget } from './weeklyBudget';
import { monthlyEntertainmentBudget } from './monthlyBudget';
import { biweeklyTransportationBudget } from './biweeklyBudget';

/** Array of all test budgets */
export const ALL_TEST_BUDGETS = [
  weeklyGroceriesBudget,
  monthlyEntertainmentBudget,
  biweeklyTransportationBudget,
];

/** Map of budget IDs to budgets */
export const TEST_BUDGET_MAP = {
  [weeklyGroceriesBudget.id]: weeklyGroceriesBudget,
  [monthlyEntertainmentBudget.id]: monthlyEntertainmentBudget,
  [biweeklyTransportationBudget.id]: biweeklyTransportationBudget,
};
