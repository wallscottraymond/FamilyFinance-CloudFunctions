"use strict";
/**
 * Assign Transaction Orchestrator
 *
 * The Transaction Assignment Engine's IO shell. Coordinates:
 *   resolver (load context once) → compute_transaction_assignment (pure core)
 *   → skip-if-unchanged → single write of the split assignment (+ splitBudgetIds)
 *   → scoped fan-out (recompute touched budgets).
 *
 * The engine is the SINGLE writer of split assignment fields. Per-split decisions
 * are logged for "why did this land in Everything Else?" troubleshooting.
 *
 * NOTE: the `recompute_budget_spent` fan-out job's handler ships with the
 * Budget-Transaction-Spend-Pipeline sub-project; until then the job is enqueued
 * and harmlessly ignored by `on_job_created`.
 *
 * @module orchestrators/transactions/assign_transaction
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assign_transaction_orchestrator = assign_transaction_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const job_queue_1 = require("../../infrastructure/job_queue");
const assignment_context_resolver_1 = require("../../resolvers/transactions/assignment_context.resolver");
const compute_transaction_assignment_service_1 = require("../../domain/transactions/compute_transaction_assignment.service");
const merge_assignment_1 = require("./merge_assignment");
const transaction_repo_1 = require("../../repositories/transaction.repo");
/**
 * Assign a transaction's splits.
 */
async function assign_transaction_orchestrator(ctx, input) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "assign_transaction");
    (0, observability_1.log_operation_start)(span, input.user_id);
    try {
        // 1. Resolve context once.
        const resolved = await (0, assignment_context_resolver_1.resolve_assignment_context)(ctx, input.user_id, input.transaction_id);
        if (!resolved) {
            (0, observability_1.log_operation_success)(span, input.user_id);
            return { found: false, changed: false, touched_budget_ids: [], assigned_splits: 0 };
        }
        // 2. Pure core.
        const result = (0, compute_transaction_assignment_service_1.compute_transaction_assignment)(resolved.splits_input, resolved.context);
        // 3. Decision logging: one compact line per split (category + date + the
        //    budget it landed on + why) — enough to answer "why this budget?".
        const cat_by_split = new Map(resolved.splits_input.map((s) => [s.split_id, s.plaid_match_category]));
        const txn_date_iso = new Date(resolved.context.txn_date_ms)
            .toISOString()
            .slice(0, 10);
        for (const s of result.splits) {
            console.log(JSON.stringify({
                severity: "DEBUG",
                message: "split assignment decision",
                trace_id: ctx.trace_id,
                transaction_id: input.transaction_id,
                split_id: s.split_id,
                category: (_a = cat_by_split.get(s.split_id)) !== null && _a !== void 0 ? _a : null,
                txn_date: txn_date_iso,
                budget_id: s.budget_id,
                reason: s.reason.budget,
            }));
            if (s.reason.tie) {
                console.warn(`[assign_transaction] category drift: split ${s.split_id} matched >1 real budget`);
            }
        }
        if (result.any_unassigned) {
            console.error(`[assign_transaction] no Everything Else budget for user ${input.user_id}` +
                " — split(s) left unassigned");
        }
        // 4. Merge the assignment onto the raw split maps + denormalize the matched
        //    budget's name. `name_changed` heals a drifted `budgetName` (the app
        //    defaults new splits to "General") even when the assignment is unchanged.
        const now = firestore_1.Timestamp.now();
        const { updated_splits, name_changed, split_budget_ids } = (0, merge_assignment_1.merge_assignment_onto_raw_splits)(resolved, result, now);
        // 5. Skip-if-unchanged (loop prevention). A budgetName-only drift still
        //    writes (display heal) but does NOT fan out a recompute (spend unmoved).
        if (!result.changed && !name_changed) {
            (0, observability_1.log_operation_success)(span, input.user_id);
            return {
                found: true,
                changed: false,
                touched_budget_ids: result.touched_budget_ids,
                assigned_splits: result.splits.length,
            };
        }
        // 6. Single write.
        await transaction_repo_1.transaction_repo.apply_split_assignments(ctx, resolved.transaction_doc_id, updated_splits, split_budget_ids);
        // 7. Scoped fan-out: recompute the touched budgets' spend — only when the
        //    assignment actually changed (a name-only heal doesn't move spend).
        if (result.changed) {
            await (0, job_queue_1.create_job)("recompute_budget_spent", {
                user_id: input.user_id,
                transaction_id: input.transaction_id,
                transaction_date_ms: resolved.context.txn_date_ms,
                budget_ids: result.touched_budget_ids,
            }, { trace_id: ctx.trace_id });
            // Recurring reconciliation fan-out (before ∪ after) — a set / cleared /
            // moved link reconciles the OLD recurring doc too (RPR Phase 5c).
            for (const outflow_id of result.touched_outflow_ids) {
                await (0, job_queue_1.create_job)("reconcile_recurring_period", {
                    recurring_id: outflow_id,
                    recurring_type: "outflow",
                    user_id: input.user_id,
                    trace_id: ctx.trace_id,
                }, { trace_id: ctx.trace_id });
            }
            for (const inflow_id of result.touched_inflow_ids) {
                await (0, job_queue_1.create_job)("reconcile_recurring_period", {
                    recurring_id: inflow_id,
                    recurring_type: "inflow",
                    user_id: input.user_id,
                    trace_id: ctx.trace_id,
                }, { trace_id: ctx.trace_id });
            }
        }
        (0, observability_1.log_operation_success)(span, input.user_id);
        return {
            found: true,
            changed: result.changed,
            touched_budget_ids: result.touched_budget_ids,
            assigned_splits: result.splits.length,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: input.user_id, error_code: "ASSIGN_TRANSACTION_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=assign_transaction.orchestrator.js.map