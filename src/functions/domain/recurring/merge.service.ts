/**
 * Same-bill merge and its undo (Convert-To-Recurring D7 / D18 / D22 / D41) — PURE.
 *
 * "Same bill": the OLD bill ends (`apply_end_at`: removed from the month AFTER its last payment, so
 * every month up to it keeps its history, paid marks and pins) and the NEW bill continues, keeping
 * the user's name / amount / schedule. The old record is kept ACTIVE (even if Plaid had turned it
 * off, so its past periods still show), marked `mergedIntoId` and exempt from Plaid's active flag
 * and from stale-marking; `mergeLog` remembers what undo needs. It stays out of the Removed list
 * (so a Restore can't double count). A user-tapped merge may write the old bill (D18).
 *
 * @module domain/recurring/merge
 */

import {
  RemovalInterval,
  apply_end_at,
} from "./recurring_suppression.service";
import type { MergeLog } from "./convert_recurring.service";

export interface MergeOldBill {
  id: string;
  removal_intervals: RemovalInterval[];
  user_custom_name: string | null;
  expected_amount_override: number | null;
  user_frequency: string | null;
  /** Plaid's last payment date for it (ms), or null. */
  last_payment_ms: number | null;
  merged_into_id: string | null;
  is_active?: boolean;
}

export interface MergePlan {
  intervals: RemovalInterval[];
  merge_log: MergeLog;
  /** Keep (or make) the old record active so its history keeps showing. */
  reactivate: true;
}

/** The old bill's end + the log undo needs. null = already merged (idempotent). PURE. */
export function plan_merge_old_into_new(
  old: MergeOldBill,
  into_id: string,
  now_ms: number,
  month_start_ms: number
): MergePlan | null {
  if (old.merged_into_id) return null;
  return {
    intervals: apply_end_at(old.removal_intervals, old.last_payment_ms, now_ms, month_start_ms),
    merge_log: {
      into: into_id,
      at_ms: now_ms,
      prior_intervals: old.removal_intervals,
      inherited_name: old.user_custom_name,
      inherited_override: old.expected_amount_override,
      ...(old.is_active !== undefined ? { prior_is_active: old.is_active } : {}),
    },
    reactivate: true,
  };
}

export interface UndoTarget {
  user_custom_name: string | null;
  expected_amount_override: number | null;
}

export interface UndoPlan {
  /** The old bill's intervals as they were before the merge. */
  restore_intervals: RemovalInterval[];
  /** Reset the new bill's inherited name / override — only where the user hasn't changed them since. */
  revert_target_name: boolean;
  revert_target_override: boolean;
}

/** What undoing a merge restores. `target` is null when the merge target no longer exists. PURE. */
export function plan_undo_merge(log: MergeLog, target: UndoTarget | null): UndoPlan {
  return {
    restore_intervals: log.prior_intervals,
    revert_target_name: !!target && log.inherited_name !== null && target.user_custom_name === log.inherited_name,
    revert_target_override: !!target && log.inherited_override !== null && target.expected_amount_override === log.inherited_override,
  };
}
