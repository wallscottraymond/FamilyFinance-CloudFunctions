/**
 * Scheduled Budget Period Maintenance (v2 Prime/Non-Prime generator)
 *
 * Runs monthly to maintain a rolling ~1-year window of budget periods for
 * recurring, ongoing budgets. As of 2026-07-27 this uses the SAME v2 generator
 * as budget creation (`compute_budget_periods`) instead of the legacy
 * `getPrimePeriodType` path — so prime-cadence mapping has ONE source of truth
 * and `bi_monthly` budgets extend with real bi_monthly PRIME periods (the legacy
 * path silently clamped bi_monthly → monthly).
 *
 * Safety: `budget_period_repo.save_batch` OVERWRITES (set) and would reset a
 * period's `spent`, so we persist ONLY periods that don't already exist. The
 * source-period window is widened behind `today` so the current prime is present
 * for accurate non-prime derivation at the near boundary.
 *
 * Runs on the 1st of each month at 2:00 AM UTC. Memory: 512MiB, Timeout: 300s.
 */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
export declare const extendRecurringBudgetPeriods: import("firebase-functions/v2/scheduler").ScheduleFunction;
/**
 * Core of the scheduled extension, extracted so it can be driven directly in
 * integration tests. Returns a summary for logging/assertions.
 */
export declare function run_recurring_budget_period_extension(db: admin.firestore.Firestore, now: Timestamp): Promise<{
    budgetsProcessed: number;
    totalPeriodsCreated: number;
}>;
//# sourceMappingURL=extendRecurringBudgetPeriods.d.ts.map