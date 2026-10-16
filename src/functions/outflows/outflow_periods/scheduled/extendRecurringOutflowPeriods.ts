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

    const db = admin.firestore();

    // All active outflows across users. (Bounded read; NOT the period collection.)
    const activeOutflowsSnapshot = await db
      .collection("outflows")
      .where("isActive", "==", true)
      .get();

    if (activeOutflowsSnapshot.empty) {
      console.log("[extendRecurringOutflowPeriods] No active outflows to maintain");
      return;
    }

    console.log(
      `[extendRecurringOutflowPeriods] Maintaining ${activeOutflowsSnapshot.size} active outflows`
    );

    const now = new Date();
    const endDate = new Date(now);
    endDate.setMonth(endDate.getMonth() + MONTHS_FORWARD);

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
  }
);

/**
 * Extend ONE outflow's materialized periods to `endDate` (the per-outflow body of the monthly job;
 * exported for tests). Returns the number of periods created.
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
    // Resume the day after the latest materialized period ends.
    startDate = latestSnapshot.docs[0].data().periodEndDate.toDate();
    startDate.setDate(startDate.getDate() + 1);
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
    endDate
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
