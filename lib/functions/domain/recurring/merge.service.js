"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.plan_merge_old_into_new = plan_merge_old_into_new;
exports.plan_undo_merge = plan_undo_merge;
const recurring_suppression_service_1 = require("./recurring_suppression.service");
/** The old bill's end + the log undo needs. null = already merged (idempotent). PURE. */
function plan_merge_old_into_new(old, into_id, now_ms, month_start_ms) {
    if (old.merged_into_id)
        return null;
    return {
        intervals: (0, recurring_suppression_service_1.apply_end_at)(old.removal_intervals, old.last_payment_ms, now_ms, month_start_ms),
        merge_log: Object.assign({ into: into_id, at_ms: now_ms, prior_intervals: old.removal_intervals, inherited_name: old.user_custom_name, inherited_override: old.expected_amount_override }, (old.is_active !== undefined ? { prior_is_active: old.is_active } : {})),
        reactivate: true,
    };
}
/** What undoing a merge restores. `target` is null when the merge target no longer exists. PURE. */
function plan_undo_merge(log, target) {
    return {
        restore_intervals: log.prior_intervals,
        revert_target_name: !!target && log.inherited_name !== null && target.user_custom_name === log.inherited_name,
        revert_target_override: !!target && log.inherited_override !== null && target.expected_amount_override === log.inherited_override,
    };
}
//# sourceMappingURL=merge.service.js.map