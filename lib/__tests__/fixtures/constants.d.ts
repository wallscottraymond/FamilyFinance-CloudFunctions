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
export declare const TEST_USER: {
    /** Primary test user - owns most test resources */
    readonly PRIMARY: "test_user_001";
    /** Secondary test user - for sharing/permission tests */
    readonly SECONDARY: "test_user_002";
    /** User with ADMIN role */
    readonly ADMIN: "test_admin_001";
    /** User with VIEWER role (read-only) */
    readonly VIEWER: "test_viewer_001";
    /** User in a different group (for access denial tests) */
    readonly OTHER_GROUP: "test_other_group_user_001";
};
export declare const TEST_GROUP: {
    /** Primary test group - family/household */
    readonly PRIMARY: "test_group_001";
    /** Secondary group for multi-group tests */
    readonly SECONDARY: "test_group_002";
    /** Separate group for access denial tests */
    readonly OTHER: "test_other_group_001";
};
export declare const TEST_ACCOUNT: {
    /** Primary checking account */
    readonly CHECKING: "test_account_checking_001";
    /** Primary savings account */
    readonly SAVINGS: "test_account_savings_001";
    /** Primary credit card */
    readonly CREDIT_CARD: "test_account_credit_001";
    /** Plaid item ID */
    readonly PLAID_ITEM: "test_plaid_item_001";
    /** Institution name */
    readonly INSTITUTION_NAME: "Test Bank";
    /** Institution ID */
    readonly INSTITUTION_ID: "ins_test_001";
};
export declare const TEST_BUDGET_ID: {
    /** Weekly groceries budget */
    readonly WEEKLY_GROCERIES: "budget_weekly_groceries_001";
    /** Monthly entertainment budget */
    readonly MONTHLY_ENTERTAINMENT: "budget_monthly_entertainment_001";
    /** Bi-weekly transportation budget */
    readonly BIWEEKLY_TRANSPORTATION: "budget_biweekly_transportation_001";
    /** System "Everything Else" budget */
    readonly EVERYTHING_ELSE: "budget_everything_else_001";
};
export declare const DEFAULTS: {
    /** Default currency */
    readonly CURRENCY: "USD";
    /** Default alert threshold (percentage) */
    readonly ALERT_THRESHOLD: 80;
    /** Default timezone */
    readonly TIMEZONE: "America/Denver";
};
/** Generates a unique transaction ID with prefix */
export declare const generateTxnId: (prefix: string, index: number) => string;
/** Transaction ID prefixes by budget type */
export declare const TXN_PREFIX: {
    readonly WEEKLY: "txn_weekly";
    readonly MONTHLY: "txn_monthly";
    readonly BIWEEKLY: "txn_biweekly";
};
//# sourceMappingURL=constants.d.ts.map