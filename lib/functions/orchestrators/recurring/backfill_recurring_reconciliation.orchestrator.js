"use strict";
/**
 * Backfill Recurring Reconciliation Orchestrator
 * (Recurring-Period-Reconciliation Phase 7)
 *
 * Self-fanning coordinator (one job type):
 *   - no `user_id` → enumerate users, enqueue one per-user `backfill_recurring_reconciliation`.
 *   - with `user_id` → enqueue a `reconcile_recurring_period` per ACTIVE recurring
 *     outflow + inflow for that user.
 *
 * Reuses the Phase 3 reconcile job (idempotent) — safe to re-run.
 *
 * @module orchestrators/recurring/backfill_recurring_reconciliation
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.backfill_recurring_reconciliation_orchestrator = backfill_recurring_reconciliation_orchestrator;
const observability_1 = require("../../observability");
const job_queue_1 = require("../../infrastructure/job_queue");
const outflow_repo_1 = require("../../repositories/outflow.repo");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const backfill_targets_resolver_1 = require("../../resolvers/transactions/backfill_targets.resolver");
async function backfill_recurring_reconciliation_orchestrator(ctx, input) {
    var _a, _b;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "backfill_recurring_reconciliation");
    (0, observability_1.log_operation_start)(span, (_a = input.user_id) !== null && _a !== void 0 ? _a : "ALL");
    try {
        // Fan out per user.
        if (!input.user_id) {
            const user_ids = await (0, backfill_targets_resolver_1.resolve_backfill_user_ids)(ctx);
            for (const user_id of user_ids) {
                await (0, job_queue_1.create_job)("backfill_recurring_reconciliation", { user_id, regenerate: input.regenerate }, { trace_id: ctx.trace_id });
            }
            console.log(`[${ctx.trace_id}] backfill_recurring_reconciliation: fanned out ${user_ids.length} users`);
            (0, observability_1.log_operation_success)(span, "ALL");
            return { mode: "fan_out_users", users_enqueued: user_ids.length };
        }
        // Per user → one job per active recurring doc. `regenerate` re-derives occurrence
        // data first (each regen job enqueues its own reconcile); otherwise reconcile.
        const outflows = await outflow_repo_1.outflow_repo.get_by_user_id(ctx, input.user_id);
        const inflows = await inflow_repo_1.inflow_repo.get_by_user_id(ctx, input.user_id);
        const job_type = input.regenerate
            ? "regenerate_recurring_occurrences"
            : "reconcile_recurring_period";
        let enqueued = 0;
        for (const o of outflows) {
            await (0, job_queue_1.create_job)(job_type, {
                recurring_id: o.id,
                recurring_type: "outflow",
                user_id: input.user_id,
                trace_id: ctx.trace_id,
            }, { trace_id: ctx.trace_id });
            enqueued++;
        }
        for (const i of inflows) {
            await (0, job_queue_1.create_job)(job_type, {
                recurring_id: i.id,
                recurring_type: "inflow",
                user_id: input.user_id,
                trace_id: ctx.trace_id,
            }, { trace_id: ctx.trace_id });
            enqueued++;
        }
        console.log(`[${ctx.trace_id}] backfill_recurring_reconciliation: user=${input.user_id}, ` +
            `outflows=${outflows.length}, inflows=${inflows.length}`);
        (0, observability_1.log_operation_success)(span, input.user_id);
        return { mode: "user", reconciles_enqueued: enqueued };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), {
            user_id: (_b = input.user_id) !== null && _b !== void 0 ? _b : "ALL",
            error_code: "BACKFILL_RECURRING_RECONCILIATION_FAILED",
        });
        throw error;
    }
}
//# sourceMappingURL=backfill_recurring_reconciliation.orchestrator.js.map