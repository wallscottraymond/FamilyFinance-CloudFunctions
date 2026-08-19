/**
 * On Recurring Updated (Trigger) — Recurring-Period-Reconciliation Phase 4
 *
 * Fires when a recurring outflow/inflow doc changes. When its `transactionIds`
 * list GROWS (Plaid recurring detection / webhook), enqueue a `reconcile_recurring_period`
 * job so the new transactions align to periods and the period status updates.
 *
 * Field-guard: only enqueues when `transactionIds` actually changed (ignores
 * unrelated edits). Loop-safe: the reconcile job writes only to `*_periods`,
 * never back to the recurring doc, so it can't re-trigger this.
 *
 * @module entry/triggers/on_recurring_updated
 */

import { onDocumentWritten } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { create_trigger_trace } from "../../observability";
import { create_job } from "../../infrastructure/job_queue";
import { runUpdateOutflowPeriods } from "../../outflows/outflow_periods/utils/runUpdateOutflowPeriods";
import { runUpdateInflowPeriods } from "../../inflows/inflow_periods/utils/runUpdateInflowPeriods";
import { Outflow, Inflow } from "../../../types";

type RecurringType = "outflow" | "inflow";

/** True if the recurring doc's `transactionIds` grew/changed (the field-guard). */
export function transaction_ids_changed(
  before: Record<string, unknown> | null,
  after: Record<string, unknown>
): boolean {
  const b = (before?.transactionIds as string[] | undefined) ?? [];
  const a = (after.transactionIds as string[] | undefined) ?? [];
  if (a.length !== b.length) return true;
  const b_set = new Set(b);
  return a.some((id) => !b_set.has(id));
}

/**
 * The EFFECTIVE expected amount of a recurring doc = the user override when set,
 * else Plaid's average. Drives the materialized period amounts.
 */
function effective_amount(doc: Record<string, unknown> | null): number | undefined {
  if (!doc) return undefined;
  const override = doc.expectedAmountOverride as number | null | undefined;
  return (override ?? (doc.averageAmount as number | undefined));
}

/** Shared handler: enqueue a reconcile when the inbound list changed. Exported for tests. */
export async function handle_recurring_write(
  recurring_type: RecurringType,
  recurring_id: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
  event_id: string
): Promise<boolean> {
  if (!after) return false; // deletion → the removal cascade handles soft-delete
  const user_id =
    (after.userId as string | undefined) || (after.ownerId as string | undefined);
  if (!user_id) return false;

  const trace = create_trigger_trace(recurring_id, event_id);
  let did = false;

  // 1. `transactionIds` changed (Plaid recurring detection) → reconcile paid/received.
  if (transaction_ids_changed(before, after)) {
    await create_job(
      "reconcile_recurring_period",
      { recurring_id, recurring_type, user_id, trace_id: trace.trace_id },
      { trace_id: trace.trace_id }
    );
    did = true;
  }

  // 2. Effective EXPECTED AMOUNT changed (`expectedAmountOverride ?? averageAmount`)
  //    → recompute the MATERIALIZED period amounts so the summaries-backed list
  //    reflects it. Without this, a user's expected-amount override updates only the
  //    derive-aware detail screen; the list (summaries) shows the stale average.
  //    Gated to amount changes (rare), so no per-write cascade. runUpdate* recomputes
  //    amounts only here — its auto-match path is gated on transactionIds separately.
  if (before && effective_amount(before) !== effective_amount(after)) {
    const db = admin.firestore();
    try {
      if (recurring_type === "outflow") {
        await runUpdateOutflowPeriods(db, recurring_id, before as unknown as Outflow, after as unknown as Outflow);
      } else {
        await runUpdateInflowPeriods(db, recurring_id, before as unknown as Inflow, after as unknown as Inflow);
      }
      did = true;
    } catch (error) {
      // Non-fatal: an amount-recompute failure must not break the recurring update.
      console.error(`[on_recurring_updated] period amount recompute failed for ${recurring_type} ${recurring_id}:`, error);
    }
  }

  return did;
}

export const on_outflow_updated = onDocumentWritten(
  {
    document: "outflows/{recurringId}",
    region: "us-central1",
    memory: "256MiB",
    // eslint-disable-next-line @typescript-eslint/naming-convention
    timeoutSeconds: 60,
  },
  async (event) => {
    await handle_recurring_write(
      "outflow",
      event.params.recurringId,
      (event.data?.before?.data() as Record<string, unknown> | undefined) ?? null,
      (event.data?.after?.data() as Record<string, unknown> | undefined) ?? null,
      event.id
    );
  }
);

export const on_inflow_updated = onDocumentWritten(
  {
    document: "inflows/{recurringId}",
    region: "us-central1",
    memory: "256MiB",
    // eslint-disable-next-line @typescript-eslint/naming-convention
    timeoutSeconds: 60,
  },
  async (event) => {
    await handle_recurring_write(
      "inflow",
      event.params.recurringId,
      (event.data?.before?.data() as Record<string, unknown> | undefined) ?? null,
      (event.data?.after?.data() as Record<string, unknown> | undefined) ?? null,
      event.id
    );
  }
);
