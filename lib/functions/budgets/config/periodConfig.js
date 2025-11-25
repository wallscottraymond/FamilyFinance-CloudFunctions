"use strict";
/**
 * Budget Period Configuration Constants
 *
 * Centralized constants for budget period calculations and configurations.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXTENSION_SETTINGS = exports.BATCH_LIMITS = exports.PERIOD_MULTIPLIERS = exports.AVG_DAYS_IN_MONTH = void 0;
/**
 * Average days in a month for period calculations
 * Used for weekly budget allocation: (7 / AVG_DAYS_IN_MONTH)
 */
exports.AVG_DAYS_IN_MONTH = 30.44;
/**
 * Period allocation multipliers
 */
exports.PERIOD_MULTIPLIERS = {
    MONTHLY: 1.0, // Full budget amount
    BI_MONTHLY: 0.5, // Half budget amount
    WEEKLY: 7 / exports.AVG_DAYS_IN_MONTH, // Weekly proportion
};
/**
 * Firestore batch operation limits
 */
exports.BATCH_LIMITS = {
    FIRESTORE_BATCH_SIZE: 500, // Maximum documents per batch write
    MAX_CHECKLIST_ITEMS: 20, // Maximum checklist items per budget period
};
/**
 * Budget period extension settings
 */
exports.EXTENSION_SETTINGS = {
    RECURRING_PERIOD_MONTHS: 12, // Generate 1 year of periods for recurring budgets
    SCHEDULED_EXTENSION_CRON: '0 2 1 * *', // Run monthly on the 1st at 2:00 AM UTC
};
//# sourceMappingURL=periodConfig.js.map