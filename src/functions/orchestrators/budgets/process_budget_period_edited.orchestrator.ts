/**
 * Process Budget Period Edited Orchestrator
 *
 * The control-flow brain behind the `on_budget_period_edited` trigger. Given a
 * budget_period's before/after snapshots it decides what (if anything) to sync
 * across the overlapping periods of OTHER types for the same budget:
 *   • notes / checklist / modified-amount edits → propagate via the sync utils
 *   • pause/resume (isActive flip)              → redistribute the allocation
 *
 * Loop prevention: the sync utils stamp `*SyncedAt`; if one increased, this
 * update was itself a sync, so we skip.
 *
 * NOTE (legacy coupling): the cross-period sync is still performed by the legacy
 * `budgets/utils/syncNotesToOverlappingPeriods` + `handleBudgetPeriodPauseResume`
 * helpers (they own the overlap query + writes for this legacy feature, like a
 * scoped repo). Repo-ifying them is tracked as follow-up; the orchestrator only
 * delegates to them.
 *
 * @module orchestrators/budgets/process_budget_period_edited
 */

import * as admin from "firebase-admin";
import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { BudgetPeriodDocument } from "../../../types";
import {
  syncNotesToOverlappingPeriods,
  syncChecklistToOverlappingPeriods,
  syncModifiedAmountToOverlappingPeriods,
} from "../../budgets/utils/syncNotesToOverlappingPeriods";
import { handleBudgetPeriodPauseResume } from "../../budgets/utils/handleBudgetPeriodPauseResume";

/** Input: the edited period's snapshots. */
export interface ProcessBudgetPeriodEditedInput {
  period_id: string;
  before: BudgetPeriodDocument;
  after: BudgetPeriodDocument;
}

/**
 * True when this update was itself written by a sync pass (a `*SyncedAt` stamp
 * increased) — in which case there is nothing to propagate.
 */
function is_sync_echo(
  before: BudgetPeriodDocument,
  after: BudgetPeriodDocument
): boolean {
  const ms = (v: { toMillis?: () => number } | undefined): number =>
    v?.toMillis?.() ?? 0;
  const a = after as unknown as Record<string, { toMillis?: () => number } | undefined>;
  const b = before as unknown as Record<string, { toMillis?: () => number } | undefined>;
  return (
    ms(a.notesSyncedAt) > ms(b.notesSyncedAt) ||
    ms(a.checklistSyncedAt) > ms(b.checklistSyncedAt) ||
    ms(a.modifiedAmountSyncedAt) > ms(b.modifiedAmountSyncedAt)
  );
}

export async function process_budget_period_edited_orchestrator(
  ctx: TraceContext,
  input: ProcessBudgetPeriodEditedInput
): Promise<void> {
  const span = create_span(ctx, "orchestrator", "process_budget_period_edited");
  log_operation_start(span, "system");

  const { period_id, before, after } = input;

  if (is_sync_echo(before, after)) {
    log_operation_success(span, "system");
    return;
  }

  // Detect which user-entered fields changed.
  const af = after as unknown as Record<string, unknown>;
  const bf = before as unknown as Record<string, unknown>;
  const notes_changed = before.userNotes !== after.userNotes;
  const checklist_changed =
    JSON.stringify(bf.checklistItems ?? []) !== JSON.stringify(af.checklistItems ?? []);
  const modified_changed =
    bf.modifiedAmount !== af.modifiedAmount || before.isModified !== after.isModified;
  // Period pause/resume — the "Pause This Period" toggle flips isActive.
  const active_changed = before.isActive !== after.isActive;

  if (!notes_changed && !checklist_changed && !modified_changed && !active_changed) {
    log_operation_success(span, "system");
    return;
  }

  const db = admin.firestore();
  const source: BudgetPeriodDocument = { ...after, id: period_id };

  try {
    if (notes_changed) {
      await syncNotesToOverlappingPeriods(db, source, after.userNotes);
    }
    if (checklist_changed) {
      await syncChecklistToOverlappingPeriods(
        db,
        source,
        (af.checklistItems as never[]) ?? []
      );
    }
    if (modified_changed) {
      await syncModifiedAmountToOverlappingPeriods(
        db,
        source,
        af.modifiedAmount as number | undefined
      );
    }
    if (active_changed) {
      // Pausing redistributes this period's allocation to Everything Else;
      // resuming restores it. The util writes allocatedAmount (not isActive),
      // so it does not re-trigger this handler.
      const is_pausing = before.isActive === true && after.isActive === false;
      await handleBudgetPeriodPauseResume(db, period_id, after, is_pausing);
    }
  } catch (error) {
    // Non-fatal — a sync failure must not break the period edit.
    console.error(
      `[process_budget_period_edited] sync failed for ${period_id}:`,
      error
    );
  }

  log_operation_success(span, "system");
}
