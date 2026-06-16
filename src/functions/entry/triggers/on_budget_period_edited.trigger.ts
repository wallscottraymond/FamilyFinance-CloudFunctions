/**
 * On Budget Period Edited (Trigger)
 *
 * Syncs user-entered budget_period data — notes, checklist items, and modified
 * amount — across the overlapping periods of OTHER types for the same budget,
 * so an edit on a monthly period is reflected on the overlapping weekly /
 * bi-monthly periods (and vice versa).
 *
 * Thin trigger: extracts the before/after snapshots, applies an event-id
 * idempotency guard, and calls exactly ONE orchestrator
 * (`process_budget_period_edited`) which holds the change-detection, loop
 * prevention, and the cross-period sync. Restores the note/checklist/
 * modified-amount + pause/resume portions of the retired legacy
 * `onBudgetPeriodUpdated` trigger (rollover #6 still deferred).
 *
 * @module entry/triggers/on_budget_period_edited
 */

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import { BudgetPeriodDocument } from "../../../types";
import { create_trigger_trace } from "../../observability";
import {
  is_trigger_processed,
  mark_trigger_processed,
} from "../../repositories/infrastructure";
import { process_budget_period_edited_orchestrator } from "../../orchestrators/budgets/process_budget_period_edited.orchestrator";

export const on_budget_period_edited = onDocumentUpdated(
  {
    document: "budget_periods/{periodId}",
    region: "us-central1",
    memory: "256MiB",
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    timeoutSeconds: 30,
  },
  async (event) => {
    const period_id = event.params.periodId;
    const before = event.data?.before.data() as BudgetPeriodDocument | undefined;
    const after = event.data?.after.data() as BudgetPeriodDocument | undefined;
    if (!before || !after) {
      return;
    }

    const trace = create_trigger_trace(period_id, event.id);

    // Idempotency guard: triggers fire at-least-once, so skip replays of the
    // SAME event (key = trigger:${period_id}:${event.id}).
    if (await is_trigger_processed(trace, trace.idempotency_key)) {
      return;
    }

    await process_budget_period_edited_orchestrator(trace, {
      period_id,
      before,
      after,
    });

    await mark_trigger_processed(trace, trace.idempotency_key, period_id, event.id);
  }
);
