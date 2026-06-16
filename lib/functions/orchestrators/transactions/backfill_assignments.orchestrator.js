"use strict";
/**
 * Backfill Assignments Orchestrator
 *
 * One-shot migration: re-run the Transaction Assignment Engine over existing
 * data so split assignments become engine-authoritative AND every budget
 * period's `spent` is rebuilt (invalidation-based) off the assigned splits.
 * Intended to run once right after the hard cutover off the legacy increment
 * model. Fully idempotent — safe to re-run.
 *
 * Self-fanning (one job type, no coordinator proliferation):
 *   - no `user_id` → enumerate users, enqueue one `backfill_assignments` job
 *     per user (so each user is its own ≤5-min job).
 *   - with `user_id` → enqueue `assign_transaction` per transaction (re-assign;
 *     fans out a date-scoped recompute only where assignment CHANGED) AND a FULL
 *     `recompute_budget_spent` per budget (rebuilds spent for EVERY period,
 *     covering the periods where assignment did NOT change but the legacy
 *     increment left stale/`$0` spent).
 *
 * Why both passes: `assign_transaction` skips the recompute fan-out when nothing
 * changed (loop prevention), so a per-budget full recompute is required to
 * guarantee all spent is correct — including periods that have no transactions
 * but carry a phantom balance from the old model.
 *
 * @module orchestrators/transactions/backfill_assignments
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfill_assignments_orchestrator = backfill_assignments_orchestrator;
const observability_1 = require("../../observability");
const job_queue_1 = require("../../infrastructure/job_queue");
const budget_period_repo_1 = require("../../repositories/budget_period.repo");
const budgets_1 = require("../../domain/budgets");
const backfill_targets_resolver_1 = require("../../resolvers/transactions/backfill_targets.resolver");
/**
 * Delay applied to the per-budget full recompute so it runs AFTER the assign
 * jobs and any period-generation heal have settled — recompute then reads the
 * final assigned splits + existing periods. Delayed jobs are picked up by the
 * scheduled queue worker once due.
 */
const RECOMPUTE_DELAY_SECONDS = 180;
/** Bounded-concurrency enqueue so a large work-list doesn't open thousands of
 * sockets at once. Each create_job is a single Firestore write. */
const ENQUEUE_CHUNK = 50;
/** Transactions per `assign_transactions_batch` job. Each job resolves shared
 * context once and processes its slice within the job timeout. */
const ASSIGN_BATCH_SIZE = 100;
async function enqueue_chunked(thunks) {
    for (let i = 0; i < thunks.length; i += ENQUEUE_CHUNK) {
        const chunk = thunks.slice(i, i + ENQUEUE_CHUNK);
        await Promise.all(chunk.map((t) => t()));
    }
}
async function backfill_assignments_orchestrator(ctx, input) {
    var _a, _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "backfill_assignments");
    (0, observability_1.log_operation_start)(span, (_a = input.user_id) !== null && _a !== void 0 ? _a : "ALL");
    try {
        // Fan-out mode: enqueue one per-user backfill job.
        if (!input.user_id) {
            const user_ids = await (0, backfill_targets_resolver_1.resolve_backfill_user_ids)(ctx);
            await enqueue_chunked(user_ids.map((user_id) => () => (0, job_queue_1.create_job)("backfill_assignments", { user_id }, { trace_id: ctx.trace_id })));
            console.log(`[${ctx.trace_id}] backfill_assignments: fanned out ${user_ids.length} users`);
            (0, observability_1.log_operation_success)(span, "ALL");
            return { mode: "fan_out_users", users_enqueued: user_ids.length };
        }
        // Per-user mode: re-assign every txn, heal budgets missing periods, then
        // full-recompute every budget's spend.
        const { transaction_ids, budgets } = await (0, backfill_targets_resolver_1.resolve_user_backfill_targets)(ctx, input.user_id);
        // 1. Re-assign every transaction's splits, in batches. Each batch job
        //    resolves the shared context (budgets + categories) ONCE and reuses it
        //    across its transactions — instead of one job per transaction each
        //    re-reading budgets + the categories collection.
        const assign_batches = [];
        for (let i = 0; i < transaction_ids.length; i += ASSIGN_BATCH_SIZE) {
            assign_batches.push(transaction_ids.slice(i, i + ASSIGN_BATCH_SIZE));
        }
        await enqueue_chunked(assign_batches.map((batch_ids) => () => (0, job_queue_1.create_job)("assign_transactions_batch", { user_id: input.user_id, transaction_ids: batch_ids }, { trace_id: ctx.trace_id })));
        // 2. Heal: any budget with NO periods (the legacy Everything Else budget is
        //    created without the v2 cascade) gets its periods + summaries generated.
        //    Without periods it can't render in the app or hold spend.
        let budgets_healed = 0;
        for (const b of budgets) {
            const period_ids = await budget_period_repo_1.budget_period_repo.get_ids_by_budget_id(ctx, b.id);
            if (period_ids.length > 0) {
                continue;
            }
            const heal_payload = (0, budgets_1.build_self_provision_budget_created_payload)({
                budget_id: b.id,
                user_id: input.user_id,
                group_ids: b.group_ids,
                budget_name: b.name,
                category_ids: b.category_ids,
                amount: b.amount,
                period: b.period,
                start: b.start_date.toDate(),
                is_ongoing: b.is_ongoing,
                budget_end_date: b.budget_end_date ? b.budget_end_date.toDate() : null,
                // The Everything Else catch-all backdates its window to cover imported
                // historical transactions; regular budgets stay forward-from-start.
                coverage_start: b.is_system_everything_else
                    ? (0, budgets_1.compute_ee_coverage_start)(b.start_date.toDate())
                    : null,
            });
            await (0, job_queue_1.create_job)("process_budget_created", heal_payload, {
                trace_id: ctx.trace_id,
            });
            budgets_healed++;
        }
        // 3. Full recompute (no transaction_date_ms → all periods) per budget,
        //    DELAYED so it runs after the assigns + heal settle.
        await enqueue_chunked(budgets.map((b) => () => (0, job_queue_1.create_job)("recompute_budget_spent", { user_id: input.user_id, budget_ids: [b.id] }, { trace_id: ctx.trace_id, delay_seconds: RECOMPUTE_DELAY_SECONDS })));
        console.log(`[${ctx.trace_id}] backfill_assignments: user=${input.user_id} enqueued ` +
            `${transaction_ids.length} assign + ${budgets_healed} heal + ` +
            `${budgets.length} recompute jobs`);
        (0, observability_1.log_operation_success)(span, input.user_id);
        return {
            mode: "user",
            transactions_enqueued: transaction_ids.length,
            budgets_healed,
            budgets_enqueued: budgets.length,
        };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: (_b = input.user_id) !== null && _b !== void 0 ? _b : "ALL", error_code: "BACKFILL_ASSIGNMENTS_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=backfill_assignments.orchestrator.js.map