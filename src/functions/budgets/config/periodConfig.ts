/**
 * Budget Period Configuration Constants
 *
 * Centralized constants for budget period calculations and configurations.
 */

/**
 * Average days in a month for period calculations
 * Used for weekly budget allocation: (7 / AVG_DAYS_IN_MONTH)
 */
export const AVG_DAYS_IN_MONTH = 30.44;

/**
 * Period allocation multipliers
 */
export const PERIOD_MULTIPLIERS = {
  MONTHLY: 1.0,        // Full budget amount
  BI_MONTHLY: 0.5,     // Half budget amount
  WEEKLY: 7 / AVG_DAYS_IN_MONTH,  // Weekly proportion
} as const;

/**
 * Firestore batch operation limits
 */
export const BATCH_LIMITS = {
  FIRESTORE_BATCH_SIZE: 500,  // Maximum documents per batch write
  MAX_CHECKLIST_ITEMS: 20,    // Maximum checklist items per budget period
} as const;

/**
 * Budget period extension settings
 */
export const EXTENSION_SETTINGS = {
  RECURRING_PERIOD_MONTHS: 12,  // Generate 1 year of periods for recurring budgets
  SCHEDULED_EXTENSION_CRON: '0 2 1 * *',  // Run monthly on the 1st at 2:00 AM UTC
} as const;
