/**
 * On Budget Period Edited (Trigger)
 *
 * Syncs user-entered budget_period data — notes, checklist items, and modified
 * amount — across the overlapping periods of OTHER types for the same budget,
 * so an edit on a monthly period is reflected on the overlapping weekly /
 * bi-monthly periods (and vice versa).
 *
 * Reuses the existing sync utilities. Loop prevention relies on the `*SyncedAt`
 * timestamps those utilities stamp on the periods they write — if a sync
 * timestamp increased, this update was itself a sync, so we skip.
 *
 * Also handles period pause/resume (the "Pause This Period" toggle flips the
 * period's `isActive`): redistributes the period's allocation to/from Everything
 * Else via `handleBudgetPeriodPauseResume`.
 *
 * This restores the note/checklist/modified-amount + pause/resume portions of
 * the retired legacy `onBudgetPeriodUpdated` trigger. It does NOT handle rollover
 * recalculation (#6, depends on the spent pipeline). It is safe alongside the v2
 * period-generation cascade, which never writes these fields on an UPDATE.
 *
 * @module entry/triggers/on_budget_period_edited
 */

import { onDocumentUpdated } from "firebase-functions/v2/firestore";
import * as admin from "firebase-admin";
import { BudgetPeriodDocument } from "../../../types";
import {
  syncNotesToOverlappingPeriods,
  syncChecklistToOverlappingPeriods,
  syncModifiedAmountToOverlappingPeriods,
} from "../../budgets/utils/syncNotesToOverlappingPeriods";
import { handleBudgetPeriodPauseResume } from "../../budgets/utils/handleBudgetPeriodPauseResume";

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

    // Loop prevention: skip writes the sync itself made (it stamps *SyncedAt).
    const ms = (v: { toMillis?: () => number } | undefined): number =>
      v?.toMillis?.() ?? 0;
    const a = after as unknown as Record<string, { toMillis?: () => number } | undefined>;
    const b = before as unknown as Record<string, { toMillis?: () => number } | undefined>;
    if (
      ms(a.notesSyncedAt) > ms(b.notesSyncedAt) ||
      ms(a.checklistSyncedAt) > ms(b.checklistSyncedAt) ||
      ms(a.modifiedAmountSyncedAt) > ms(b.modifiedAmountSyncedAt)
    ) {
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
        `[on_budget_period_edited] sync failed for ${period_id}:`,
        error
      );
    }
  }
);
