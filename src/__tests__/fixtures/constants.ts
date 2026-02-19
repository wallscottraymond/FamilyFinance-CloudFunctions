/**
 * @file constants.ts
 * @description Centralized test IDs and constants for consistent test data
 *
 * PURPOSE:
 * - Single source of truth for test user IDs, group IDs, account IDs
 * - Ensures consistency across all test files
 * - Makes test data relationships clear and traceable
 *
 * USAGE:
 * import { TEST_USER, TEST_ACCOUNT } from '../fixtures/constants';
 */

// ============================================================================
// TEST USERS
// ============================================================================

export const TEST_USER = {
  /** Primary test user - owns most test resources */
  PRIMARY: 'test_user_001',
  /** Secondary test user - for sharing/permission tests */
  SECONDARY: 'test_user_002',
  /** User with ADMIN role */
  ADMIN: 'test_admin_001',
  /** User with VIEWER role (read-only) */
  VIEWER: 'test_viewer_001',
  /** User in a different group (for access denial tests) */
  OTHER_GROUP: 'test_other_group_user_001',
} as const;

// ============================================================================
// TEST GROUPS
// ============================================================================

export const TEST_GROUP = {
  /** Primary test group - family/household */
  PRIMARY: 'test_group_001',
  /** Secondary group for multi-group tests */
  SECONDARY: 'test_group_002',
  /** Separate group for access denial tests */
  OTHER: 'test_other_group_001',
} as const;

// ============================================================================
// TEST ACCOUNTS (Bank/Plaid)
// ============================================================================

export const TEST_ACCOUNT = {
  /** Primary checking account */
  CHECKING: 'test_account_checking_001',
  /** Primary savings account */
  SAVINGS: 'test_account_savings_001',
  /** Primary credit card */
  CREDIT_CARD: 'test_account_credit_001',
  /** Plaid item ID */
  PLAID_ITEM: 'test_plaid_item_001',
  /** Institution name */
  INSTITUTION_NAME: 'Test Bank',
  /** Institution ID */
  INSTITUTION_ID: 'ins_test_001',
} as const;

// ============================================================================
// TEST BUDGET IDs
// ============================================================================

export const TEST_BUDGET_ID = {
  /** Weekly groceries budget */
  WEEKLY_GROCERIES: 'budget_weekly_groceries_001',
  /** Monthly entertainment budget */
  MONTHLY_ENTERTAINMENT: 'budget_monthly_entertainment_001',
  /** Bi-weekly transportation budget */
  BIWEEKLY_TRANSPORTATION: 'budget_biweekly_transportation_001',
  /** System "Everything Else" budget */
  EVERYTHING_ELSE: 'budget_everything_else_001',
} as const;

// ============================================================================
// DEFAULT VALUES
// ============================================================================

export const DEFAULTS = {
  /** Default currency */
  CURRENCY: 'USD',
  /** Default alert threshold (percentage) */
  ALERT_THRESHOLD: 80,
  /** Default timezone */
  TIMEZONE: 'America/Denver',
} as const;

// ============================================================================
// TRANSACTION ID GENERATORS
// ============================================================================

/** Generates a unique transaction ID with prefix */
export const generateTxnId = (prefix: string, index: number): string => {
  return `${prefix}_${String(index).padStart(3, '0')}`;
};

/** Transaction ID prefixes by budget type */
export const TXN_PREFIX = {
  WEEKLY: 'txn_weekly',
  MONTHLY: 'txn_monthly',
  BIWEEKLY: 'txn_biweekly',
} as const;
