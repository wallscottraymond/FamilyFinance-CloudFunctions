"use strict";
/**
 * List Suppressed Recurring Orchestrator
 *
 * READ-ONLY: the user's currently removed/paused recurring items (bills + income)
 * for the recovery screen. Suppression state is computed SERVER-SIDE from each
 * item's `removal_intervals` (single source of truth) — so a pause that has
 * auto-resumed is correctly excluded without any write. Active items are omitted.
 *
 * @module orchestrators/recurring/list_suppressed_recurring
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.list_suppressed_recurring_orchestrator = list_suppressed_recurring_orchestrator;
const observability_1 = require("../../observability");
const outflow_repo_1 = require("../../repositories/outflow.repo");
const inflow_repo_1 = require("../../repositories/inflow.repo");
const recurring_suppression_service_1 = require("../../domain/recurring/recurring_suppression.service");
async function list_suppressed_recurring_orchestrator(ctx, user_id, now_ms) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "list_suppressed_recurring");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const [outflows, inflows] = await Promise.all([
            outflow_repo_1.outflow_repo.get_by_user_id(ctx, user_id, { include_deleted: true }),
            inflow_repo_1.inflow_repo.get_by_user_id(ctx, user_id, { include_deleted: true }),
        ]);
        const items = [];
        for (const o of outflows) {
            const state = (0, recurring_suppression_service_1.current_removal_state)(o.removal_intervals, now_ms);
            if (state.status === "active")
                continue;
            items.push({
                kind: "outflow",
                id: o.id,
                name: o.user_custom_name || o.merchant_name || o.description || "Bill",
                status: state.status,
                resume_ms: state.resume_ms,
            });
        }
        for (const i of inflows) {
            const state = (0, recurring_suppression_service_1.current_removal_state)(i.removal_intervals, now_ms);
            if (state.status === "active")
                continue;
            items.push({
                kind: "inflow",
                id: i.id,
                name: i.user_custom_name || i.payer_name || i.description || "Income",
                status: state.status,
                resume_ms: state.resume_ms,
            });
        }
        (0, observability_1.log_operation_success)(span, user_id);
        return { items };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        throw error;
    }
}
//# sourceMappingURL=list_suppressed_recurring.orchestrator.js.map