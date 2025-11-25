/**
 * Budget Period Configuration Constants
 *
 * Centralized constants for budget period calculations and configurations.
 */
/**
 * Average days in a month for period calculations
 * Used for weekly budget allocation: (7 / AVG_DAYS_IN_MONTH)
 */
export declare const AVG_DAYS_IN_MONTH = 30.44;
/**
 * Period allocation multipliers
 */
export declare const PERIOD_MULTIPLIERS: {
    readonly MONTHLY: 1;
    readonly BI_MONTHLY: 0.5;
    readonly WEEKLY: number;
};
/**
 * Firestore batch operation limits
 */
export declare const BATCH_LIMITS: {
    readonly FIRESTORE_BATCH_SIZE: 500;
    readonly MAX_CHECKLIST_ITEMS: 20;
};
/**
 * Budget period extension settings
 */
export declare const EXTENSION_SETTINGS: {
    readonly RECURRING_PERIOD_MONTHS: 12;
    readonly SCHEDULED_EXTENSION_CRON: "0 2 1 * *";
};
//# sourceMappingURL=periodConfig.d.ts.map