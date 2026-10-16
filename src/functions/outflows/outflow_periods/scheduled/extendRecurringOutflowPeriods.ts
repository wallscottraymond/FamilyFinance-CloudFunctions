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

import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";
import { RecurringOutflow } from "../../../../types";
import { createOutflowPeriodsFromSource } from "../crud/createOutflowPeriods";
import { outflow_repo } from "../../../repositories/outflow.repo";
import { is_v2_record } from "../../../domain/recurring/capture_rules";
import { RemovalMode } from "../../../domain/recurring/recurring_suppression.service";

/** How far ahead to keep outflow periods materialized (matches onOutflowCreated's horizon). */
const MONTHS_FORWARD = 15;

/**
 * Re-cover this many days before the latest materialized period's end. The latest period can be of
 * any type (a weekly one usually ends after the last monthly one), and the creator only keeps
 * source periods that START inside the window — so the window must reach back past the start of
 * every type's next period. Existing periods in the window are skipped (`skip_existing`), so this
 * only fills what is missing. (Before 2026-10-16 the window began the day after the latest END at
 * 23:59:59.999, which excluded every period starting at 00:00 that day: monthly periods were never
 * extended.)
 */
const LOOKBACK_DAYS = 40;

const DAY_MS = 24 * 60 * 60 * 1000;
const start_of_utc_day = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * One pass over every active outflow (exported for the emulator test). Returns counts.
 */
export async function run_outflow_period_extension(
  db: admin.firestore.Firestore,
  now: Date = new Date(),
  // Test-only scoping: the emulator is shared by parallel suites, so a test passes its own owner
  // and the run never touches (or races) other suites' outflows. Production omits it.
  opts: { owner_id?: string } = {}
): Promise<{ outflowsProcessed: number; periodsCreated: number; errors: number }> {
  // All active outflows across users. (Bounded read; NOT the period collection.)
  let activeQuery = db.collection("outflows").where("isActive", "==", true);
  if (opts.owner_id) activeQuery = activeQuery.where("ownerId", "==", opts.owner_id);
  const activeOutflowsSnapshot = await activeQuery.get();

  if (activeOutflowsSnapshot.empty) {
    console.log("[extendRecurringOutflowPeriods] No active outflows to maintain");
    return { outflowsProcessed: 0, periodsCreated: 0, errors: 0 };
  }

  console.log(
    `[extendRecurringOutflowPeriods] Maintaining ${activeOutflowsSnapshot.size} active outflows`
  );

  const endDate = new Date(now);
  endDate.setUTCMonth(endDate.getUTCMonth() + MONTHS_FORWARD);

  let outflowsProcessed = 0;
  let periodsCreated = 0;
  let errors = 0;

  for (const outflowDoc of activeOutflowsSnapshot.docs) {
    try {
      const created = await extendOutflowPeriodsFor(db, outflowDoc, endDate);
      outflowsProcessed++;
      periodsCreated += created;
    } catch (error) {
      errors++;
      console.error(
        `[extendRecurringOutflowPeriods] Failed to extend outflow ${outflowDoc.id}: ` +
          `${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  console.log(
    JSON.stringify({
      severity: "INFO",
      message: "Outflow period extension completed",
      outflowsProcessed,
      periodsCreated,
      errors,
      monthsForward: MONTHS_FORWARD,
    })
  );
  return { outflowsProcessed, periodsCreated, errors };
}

export const extendRecurringOutflowPeriods = onSchedule(
  {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    schedule: "0 3 1 * *", // 03:00 UTC on the 1st of each month
    timeZone: "UTC",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 540,
  },
  async () => {
    console.log("[extendRecurringOutflowPeriods] Starting scheduled outflow period extension...");
    await run_outflow_period_extension(admin.firestore());
  }
);

/**
 * Extend ONE outflow's materialized periods to `endDate` (the per-outflow body of the monthly job;
 * exported for tests). Returns the number of periods created.
 *
 * Look-back: re-covers LOOKBACK_DAYS before the latest period's end (never before the bill's first
 * date) and skips periods that already exist (`skip_existing`), so existing paid periods are never
 * overwritten.
 *
 * Convert-To-Recurring X20: a v2 bill can be kept active while it is ENDED going forward ("It
 * ended" = a removal interval). New periods are generated `isActive: true`, so for a v2 record with
 * removal intervals the new periods are then flipped to match them (the same
 * `apply_period_suppression` remove / restore uses) — the stored periods never drift from the
 * derive. Old records keep today's behavior (D13: no new writes to them).
 */
export async function extendOutflowPeriodsFor(
  db: admin.firestore.Firestore,
  outflowDoc: admin.firestore.QueryDocumentSnapshot | admin.firestore.DocumentSnapshot,
  endDate: Date
): Promise<number> {
  const outflow = outflowDoc.data() as RecurringOutflow;
  // Find ONLY the latest existing period (1 read) — the forward watermark. This is what
  // keeps the job off the full-collection scan.
  const latestSnapshot = await db
    .collection("outflow_periods")
    .where("outflowId", "==", outflowDoc.id)
    .orderBy("periodEndDate", "desc")
    .limit(1)
    .get();

  let startDate: Date;
  if (latestSnapshot.empty) {
    // No periods yet (rare for an active outflow) — materialize from its first occurrence.
    startDate = outflow.firstDate.toDate();
  } else {
    // Look back from the latest period's end (see LOOKBACK_DAYS), never before the bill began.
    const latestEnd: Date = latestSnapshot.docs[0].data().periodEndDate.toDate();
    startDate = new Date(start_of_utc_day(latestEnd).getTime() - LOOKBACK_DAYS * DAY_MS);
    const first = outflow.firstDate?.toDate?.();
    if (first && start_of_utc_day(first) > startDate) startDate = start_of_utc_day(first);
  }

  // Already covered to the horizon — nothing to add for this outflow.
  if (startDate >= endDate) {
    return 0;
  }

  const result = await createOutflowPeriodsFromSource(
    db,
    outflowDoc.id,
    outflow,
    startDate,
    endDate,
    { skip_existing: true }
  );

  const raw = outflow as unknown as {
    captureRulesVersion?: number;
    removalIntervals?: Array<{ fromMs: number; toMs: number | null; mode: RemovalMode }>;
    ownerId?: string;
  };
  if (is_v2_record(raw) && (raw.removalIntervals?.length ?? 0) > 0 && result.periodsCreated > 0) {
    await outflow_repo.apply_period_suppression(
      { trace_id: "extend_outflow_periods", span_id: outflowDoc.id },
      outflowDoc.id,
      (raw.removalIntervals ?? []).map((i) => ({ from_ms: i.fromMs, to_ms: i.toMs, mode: i.mode })),
      raw.ownerId ?? ""
    );
  }
  return result.periodsCreated;
}
