"use strict";
/**
 * Process Transaction Written Orchestrator
 *
 * The control-flow brain behind the `on_transaction_written` trigger. Given a
 * transaction's before/after snapshots, it decides what async work to enqueue:
 *
 *   • DELETE          → recompute the budgets the gone splits referenced.
 *   • assignment edit → re-run the assignment engine (which fans out its own
 *                       recompute for the budgets it touches).
 *   • spend-only edit → recompute directly (assign would skip, since the
 *                       assignment didn't move).
 *
 * Relevance is decided by the pure field-guard (domain). Jobs are enqueued with
 * a per-event deduplication key so trigger replays of the SAME write collapse to
 * one job; genuine subsequent writes (new event id) still enqueue.
 *
 * @module orchestrators/transactions/process_transaction_written
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.process_transaction_written_orchestrator = process_transaction_written_orchestrator;
const observability_1 = require("../../observability");
const job_queue_1 = require("../../infrastructure/job_queue");
const assignment_field_guard_service_1 = require("../../domain/transactions/assignment_field_guard.service");
/**
 * Distinct budget ids referenced by a transaction's splits (the denormalized
 * `splitBudgetIds` if present, else mapped off the splits array), excluding the
 * `unassigned` sentinel. Used to scope recompute fan-out.
 */
function budget_ids_from_doc(doc) {
    var _a;
    const denorm = doc.splitBudgetIds;
    const ids = denorm
        ? denorm
        : ((_a = doc.splits) !== null && _a !== void 0 ? _a : [])
            .map((s) => s.budgetId)
            .filter((id) => !!id);
    return Array.from(new Set(ids)).filter((id) => id !== "unassigned");
}
async function process_transaction_written_orchestrator(ctx, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "process_transaction_written");
    (0, observability_1.log_operation_start)(span, input.user_id);
    const { transaction_id, user_id, before, after, event_id } = input;
    const recompute_key = `recompute:${transaction_id}:${event_id}`;
    // DELETE: the doc is gone, so `assign_transaction` (which reads it) can't
    // discover the touched budgets. Recompute directly from the `before` snapshot
    // — recompute is invalidation-based, so the gone splits drop out of the query.
    if (!after && before) {
        const budget_ids = budget_ids_from_doc(before);
        const txn_date = before.transactionDate;
        if (budget_ids.length > 0 && txn_date) {
            await (0, job_queue_1.create_job_if_not_exists)("recompute_budget_spent", {
                deduplication_key: recompute_key,
                user_id,
                budget_ids,
                transaction_date_ms: txn_date.toMillis(),
            }, { trace_id: ctx.trace_id });
        }
        (0, observability_1.log_operation_success)(span, user_id);
        return;
    }
    const assignment_relevant = (0, assignment_field_guard_service_1.is_assignment_relevant_change)(before, after);
    const spend_relevant = (0, assignment_field_guard_service_1.is_spend_relevant_change)(before, after);
    // Cosmetic edit (notes/tags/description) — nothing to do.
    if (!assignment_relevant && !spend_relevant) {
        (0, observability_1.log_operation_success)(span, user_id);
        return;
    }
    // Assignment change (category / budget pin / split add-remove): re-run
    // assignment, which fans out a recompute for the budgets it touches.
    if (assignment_relevant) {
        await (0, job_queue_1.create_job_if_not_exists)("assign_transaction", {
            deduplication_key: `assign:${transaction_id}:${event_id}`,
            user_id,
            transaction_id,
        }, { trace_id: ctx.trace_id });
    }
    // Spend-only change (split amount, isIgnored, pending→posted, date) that
    // doesn't move the assignment — assign skips its recompute, so trigger one
    // directly for the affected budgets (before ∪ after splits).
    if (spend_relevant && after) {
        const budget_ids = [
            ...new Set([
                ...budget_ids_from_doc(before !== null && before !== void 0 ? before : {}),
                ...budget_ids_from_doc(after),
            ]),
        ];
        const txn_date = after.transactionDate;
        if (budget_ids.length > 0 && txn_date) {
            await (0, job_queue_1.create_job_if_not_exists)("recompute_budget_spent", {
                deduplication_key: recompute_key,
                user_id,
                budget_ids,
                transaction_date_ms: txn_date.toMillis(),
            }, { trace_id: ctx.trace_id });
        }
    }
    (0, observability_1.log_operation_success)(span, user_id);
}
//# sourceMappingURL=process_transaction_written.orchestrator.js.map