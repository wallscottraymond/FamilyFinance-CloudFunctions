"use strict";
/**
 * Regenerate Recurring Occurrences Orchestrator
 * (Recurring-Period-Reconciliation B — the `regenerate_recurring_occurrences` job body)
 *
 * Re-derives the occurrence data (`occurrenceDueDates`, `amountPerOccurrence`,
 * `numberOfOccurrencesInPeriod`, `expectedAmount`, ...) for a recurring doc's
 * EXISTING periods using the correct v2 generation domain, then MERGE-writes ONLY
 * those generation fields (preserving each period's reconciliation/payment state).
 * Finally enqueues a `reconcile_recurring_period` so status recomputes against the
 * corrected occurrence data.
 *
 * This fixes legacy periods that were generated without occurrence data (or with
 * stale/out-of-range dates), so multi-occurrence tracking ("paid twice" / weekly
 * bill in a monthly view) is accurate on the existing backlog — not just new docs.
 *
 * @module orchestrators/recurring/regenerate_recurring_occurrences
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.regenerate_recurring_occurrences_orchestrator = regenerate_recurring_occurrences_orchestrator;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const job_queue_1 = require("../../infrastructure/job_queue");
const outflows_1 = require("../../resolvers/outflows");
const inflows_1 = require("../../resolvers/inflows");
const outflows_2 = require("../../domain/outflows");
const inflows_2 = require("../../domain/inflows");
const outflow_period_repo_1 = require("../../repositories/outflow_period.repo");
const inflow_period_repo_1 = require("../../repositories/inflow_period.repo");
async function regenerate_recurring_occurrences_orchestrator(ctx, input) {
    var _a, _b, _c, _d;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "regenerate_recurring_occurrences");
    (0, observability_1.log_operation_start)(span, input.user_id);
    try {
        const now = firestore_1.Timestamp.now();
        let periods_updated = 0;
        if (input.recurring_type === "outflow") {
            // 1. Resolve outflow + source periods, 2. compute correct occurrence data.
            const deps = await (0, outflows_1.resolve_outflow_period_dependencies)(ctx, {
                outflow_id: input.recurring_id,
                user_id: input.user_id,
            });
            if (deps.source_periods.length > 0) {
                const computed = (0, outflows_2.compute_outflow_periods)(deps.outflow, deps.source_periods, now);
                if ((0, types_1.has_errors)(computed)) {
                    throw new Error(((_a = computed.validation_errors) !== null && _a !== void 0 ? _a : []).join("; "));
                }
                const validation = (0, outflows_2.validate_outflow_periods)((0, types_1.get_entities)(computed));
                if ((0, types_1.has_errors)(validation)) {
                    throw new Error(((_b = validation.validation_errors) !== null && _b !== void 0 ? _b : []).join("; "));
                }
                // 3. Merge occurrence fields into EXISTING periods only (preserve payments).
                const existing = new Set(await outflow_period_repo_1.outflow_period_repo.get_by_outflow_id(ctx, input.recurring_id));
                const to_update = (0, types_1.get_entities)(validation).filter((p) => existing.has(p.id));
                const writes = await outflow_period_repo_1.outflow_period_repo.update_occurrence_fields(ctx, to_update);
                periods_updated = writes.length;
            }
        }
        else {
            const deps = await (0, inflows_1.resolve_inflow_period_dependencies)(ctx, {
                inflow_id: input.recurring_id,
                user_id: input.user_id,
            });
            if (deps.source_periods.length > 0) {
                const computed = (0, inflows_2.compute_inflow_periods)(deps.inflow, deps.source_periods, now);
                if ((0, types_1.has_errors)(computed)) {
                    throw new Error(((_c = computed.validation_errors) !== null && _c !== void 0 ? _c : []).join("; "));
                }
                const validation = (0, inflows_2.validate_inflow_periods)((0, types_1.get_entities)(computed));
                if ((0, types_1.has_errors)(validation)) {
                    throw new Error(((_d = validation.validation_errors) !== null && _d !== void 0 ? _d : []).join("; "));
                }
                const existing = new Set(await inflow_period_repo_1.inflow_period_repo.get_by_inflow_id(ctx, input.recurring_id));
                const to_update = (0, types_1.get_entities)(validation).filter((p) => existing.has(p.id));
                const writes = await inflow_period_repo_1.inflow_period_repo.update_occurrence_fields(ctx, to_update);
                periods_updated = writes.length;
            }
        }
        // 4. Recompute reconciliation against the corrected occurrence data.
        await (0, job_queue_1.create_job)("reconcile_recurring_period", {
            recurring_id: input.recurring_id,
            recurring_type: input.recurring_type,
            user_id: input.user_id,
            trace_id: ctx.trace_id,
        }, { trace_id: ctx.trace_id });
        console.log(`[${ctx.trace_id}] regenerate_recurring_occurrences: ${input.recurring_type}=${input.recurring_id}, ` +
            `periods_updated=${periods_updated}, reconcile enqueued`);
        (0, observability_1.log_operation_success)(span, input.user_id);
        return { periods_updated, reconcile_enqueued: true, success: true };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: input.user_id, error_code: "REGENERATE_RECURRING_OCCURRENCES_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=regenerate_recurring_occurrences.orchestrator.js.map