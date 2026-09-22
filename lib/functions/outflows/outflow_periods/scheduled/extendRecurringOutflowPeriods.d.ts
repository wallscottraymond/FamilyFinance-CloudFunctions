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
export declare const extendRecurringOutflowPeriods: import("firebase-functions/v2/scheduler").ScheduleFunction;
//# sourceMappingURL=extendRecurringOutflowPeriods.d.ts.map