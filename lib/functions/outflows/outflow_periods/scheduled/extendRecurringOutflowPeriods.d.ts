/**
 * Scheduled: Extend Recurring Outflow Periods
 *
 * Maintains a rolling forward window of outflow_periods so users always see upcoming bills,
 * mirroring the proven `extendRecurringInflowPeriods` / `extendRecurringBudgetPeriods` jobs
 * (outflows were the only pillar without a scheduled extender — they relied on a manual,
 * unauthenticated HTTP endpoint, now retired).
 *
 * COST NOTE (deliberate): this must NEVER scan the whole outflow_periods collection (~14K docs).
 * Per outflow it reads only the SINGLE latest period (`outflowId ==` + `orderBy periodEndDate desc`
 * + `limit(1)`) to find how far it's already materialized, then generates only BEYOND that up to
 * the rolling horizon. Reads/run ≈ (active outflows) + 1 per outflow — bounded, never the full set.
 *
 * Runs monthly on the 1st at 3:00 AM UTC (offset from the inflow job at 2:00 AM).
 *
 * @module outflows/outflow_periods/scheduled/extendRecurringOutflowPeriods
 */
import * as admin from "firebase-admin";
/**
 * One pass over every active outflow (exported for the emulator test). Returns counts.
 */
export declare function run_outflow_period_extension(db: admin.firestore.Firestore, now?: Date, opts?: {
    owner_id?: string;
}): Promise<{
    outflowsProcessed: number;
    periodsCreated: number;
    errors: number;
}>;
export declare const extendRecurringOutflowPeriods: import("firebase-functions/v2/scheduler").ScheduleFunction;
/**
 * Extend ONE outflow's materialized periods to `endDate` (the per-outflow body of the monthly job;
 * exported for tests). Returns the number of periods created.
 *
 * Look-back: re-covers LOOKBACK_DAYS before the latest period's end (never before the bill's first
 * date) and skips periods that already exist (`skip_existing`), so existing paid periods are never
 * overwritten.
 *
 * Removal windows (Convert-To-Recurring X20 / D27): a bill can be kept active while it is removed,
 * paused or ENDED going forward ("It ended" = a removal interval). `createOutflowPeriodsFromSource`
 * creates every new period with the intervals already applied (the same month rule
 * `apply_period_suppression` and the derive use, old and v2 records alike), so nothing is flipped
 * afterwards — the stored periods never drift from the derive.
 */
export declare function extendOutflowPeriodsFor(db: admin.firestore.Firestore, outflowDoc: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot, endDate: Date): Promise<number>;
//# sourceMappingURL=extendRecurringOutflowPeriods.d.ts.map