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

// ============================================================================
// CONSTANTS
// ============================================================================

export {
  TEST_USER,
  TEST_GROUP,
  TEST_ACCOUNT,
  TEST_BUDGET_ID,
  DEFAULTS,
  TXN_PREFIX,
  generateTxnId,
} from './constants';

// ============================================================================
// CATEGORIES
// ============================================================================

export {
  CATEGORIES,
  CategoryId,
  // Category groups
  FOOD_AND_DRINK_CATEGORIES,
  TRANSPORTATION_CATEGORIES,
  ENTERTAINMENT_CATEGORIES,
  UTILITIES_CATEGORIES,
  SHOPPING_CATEGORIES,
} from './categories';

// ============================================================================
// DATE HELPERS
// ============================================================================

export {
  // Current period
  currentMonthStart,
  currentMonthEnd,
  currentWeekStart,
  currentWeekEnd,
  // Relative dates
  daysAgo,
  daysFromNow,
  monthsAgoStart,
  monthsAgoEnd,
  dayOfCurrentMonth,
  dayOfMonthsAgo,
  // Period IDs
  currentMonthPeriodId,
  currentWeekPeriodId,
  currentBiMonthlyPeriodId,
  monthsAgoPeriodId,
  // Utilities
  now,
  toTimestamp,
  createDate,
} from './dateHelpers';

// ============================================================================
// BUDGETS
// ============================================================================

export * from './budgets';
