/**
 * Scheduled Inflow Period Maintenance
 *
 * This Cloud Function runs monthly to maintain a rolling 1-year window
 * of inflow periods for recurring income sources.
 *
 * Features:
 * - Runs on the 1st of each month at 2:00 AM UTC (matches budget maintenance)
 * - Maintains 1-year rolling window for recurring inflows
 * - Creates inflow_periods for any missing source_periods
 * - Uses occurrence calculation for multi-payment tracking
 *
 * Memory: 512MiB, Timeout: 300s (5 minutes)
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";
import { SourcePeriod } from "../../../../types";
/**
 * Scheduled function to extend recurring inflow periods
 * Runs monthly on the 1st at 2:00 AM UTC
 */
export declare const extendRecurringInflowPeriods: import("firebase-functions/v2/scheduler").ScheduleFunction;
/**
 * Extend ONE inflow's materialized periods over `allSourcePeriods` (the per-inflow body of the
 * monthly job; exported for tests). Returns the number of periods created.
 *
 * Removal windows (Convert-To-Recurring X20 / D27): new periods are CREATED with the removal
 * intervals applied — the same month rule `apply_period_suppression` and the derive use — so a
 * removed / ended income never gets active periods inside its window (old and v2 records alike;
 * before, every new period was hard-coded active and only v2 records were flipped afterwards).
 */
export declare function extendInflowPeriodsFor(db: admin.firestore.Firestore, inflowDoc: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot, allSourcePeriods: SourcePeriod[], now: Timestamp): Promise<number>;
//# sourceMappingURL=extendRecurringInflowPeriods.d.ts.map