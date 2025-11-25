/**
 * Budget Periods Auto-Generation
 *
 * This Cloud Function automatically creates budget_periods when a budget is created.
 * It queries the source_periods collection (single source of truth for all periods)
 * and creates budget_periods linked to existing source periods.
 *
 * Features:
 * - Uses source_periods as single source of truth (ensures consistency with outflow_periods)
 * - Multi-period type support (weekly, bi-monthly, monthly)
 * - Proportional amount calculation based on period type:
 *   • Monthly: Full budget amount
 *   • Bi-Monthly: Half budget amount (50%)
 *   • Weekly: Proportional amount (7/30.44 of monthly)
 * - Recurring budgets (budgetType: 'recurring'): 1 year of periods, extended by scheduled function
 * - Limited budgets (budgetType: 'limited'): Periods until specified end date
 * - Owner-based permissions with family role support
 * - Period ID format inherited from source periods for guaranteed consistency
 *
 * Architecture:
 * - Queries source_periods collection instead of generating periods independently
 * - Ensures budget_periods and outflow_periods use identical period definitions
 * - Single point of maintenance for period logic (source_periods generation)
 *
 * Memory: 512MiB, Timeout: 60s
 */
/**
 * Triggered when a budget is created
 * Automatically generates budget_periods with intelligent time horizon:
 * - Recurring budgets: 1 year of periods (12 monthly, 24 bi-monthly, 52 weekly) + scheduled extension
 * - Limited budgets: Periods until specified end date
 * - Default: 1 year of periods (12 monthly, 24 bi-monthly, 52 weekly)
 */
export declare const onBudgetCreate: import("firebase-functions/v2/core").CloudFunction<import("firebase-functions/v2/firestore").FirestoreEvent<import("firebase-functions/v2/firestore").QueryDocumentSnapshot | undefined, {
    budgetId: string;
}>>;
//# sourceMappingURL=onBudgetCreate.d.ts.map