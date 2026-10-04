"use strict";
/**
 * Coalesced per-write fan-out jobs (Read-Cost-Review-Round-3).
 *
 * Every transaction write used to enqueue its OWN `recompute_budget_spent` and
 * `reconcile_recurring_period` job (dedup keys carried the event id), so a Plaid sync landing 78
 * transactions ran 78 + 78 jobs (~50K reads on 2026-10-02). Both jobs recompute from CURRENT
 * Firestore state when they run, so a burst can safely collapse into one delayed run per key:
 *
 *   recompute_budget_spent      key = user + sorted budget ids + the transaction's UTC day
 *                               (recompute only touches the periods CONTAINING that date, so the
 *                               same budgets + same day = the same periods — exactly equivalent)
 *   reconcile_recurring_period  key = recurring type + id (reconciles that stream's own periods)
 *
 * `coalesce_job` merges only into a still-PENDING job; a write during a run gets a new job, so no
 * change is dropped. Screens are unaffected (they derive on read); only stored mirrors
 * (`budget_periods.spent`, `outflow_periods` reconciliation) settle after the delay + queue sweep.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.COALESCE_DELAY_SECONDS = void 0;
exports.recompute_coalesce_key = recompute_coalesce_key;
exports.reconcile_coalesce_key = reconcile_coalesce_key;
exports.enqueue_recompute_budget_spent = enqueue_recompute_budget_spent;
exports.enqueue_reconcile_recurring = enqueue_reconcile_recurring;
const job_queue_1 = require("./job_queue");
/** Collapse window for a burst of writes (debounce, like `update_user_summary`). */
exports.COALESCE_DELAY_SECONDS = 30;
const utc_day = (ms) => new Date(ms).toISOString().slice(0, 10);
function recompute_coalesce_key(user_id, budget_ids, transaction_date_ms) {
    return `recompute:${user_id}:${[...new Set(budget_ids)].sort().join(",")}:${utc_day(transaction_date_ms)}`;
}
function reconcile_coalesce_key(recurring_type, recurring_id) {
    return `reconcile:${recurring_type}:${recurring_id}`;
}
async function enqueue_recompute_budget_spent(input) {
    if (input.budget_ids.length === 0)
        return;
    await (0, job_queue_1.coalesce_job)("recompute_budget_spent", {
        deduplication_key: recompute_coalesce_key(input.user_id, input.budget_ids, input.transaction_date_ms),
        user_id: input.user_id,
        budget_ids: [...new Set(input.budget_ids)],
        transaction_date_ms: input.transaction_date_ms,
    }, { delay_seconds: exports.COALESCE_DELAY_SECONDS, trace_id: input.trace_id });
}
async function enqueue_reconcile_recurring(input) {
    await (0, job_queue_1.coalesce_job)("reconcile_recurring_period", {
        deduplication_key: reconcile_coalesce_key(input.recurring_type, input.recurring_id),
        recurring_id: input.recurring_id,
        recurring_type: input.recurring_type,
        user_id: input.user_id,
        trace_id: input.trace_id,
    }, { delay_seconds: exports.COALESCE_DELAY_SECONDS, trace_id: input.trace_id });
}
//# sourceMappingURL=coalesced_jobs.js.map