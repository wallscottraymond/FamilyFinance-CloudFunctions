"use strict";
/**
 * Create Manual Outflow Orchestrator
 *
 * Creates a user-entered recurring bill (one Plaid didn't detect). Stored in the
 * same shape as a Plaid bill, so the period page, Home and widgets show it via
 * derive-on-read with no special case.
 *
 * @module orchestrators/recurring/create_manual_outflow
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_manual_outflow_orchestrator = create_manual_outflow_orchestrator;
const crypto_1 = require("crypto");
const firestore_1 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const manual_outflow_resolver_1 = require("../../resolvers/recurring/manual_outflow.resolver");
const manual_outflow_service_1 = require("../../domain/recurring/manual_outflow.service");
const outflow_repo_1 = require("../../repositories/outflow.repo");
/**
 * Orchestrates manual bill creation.
 *
 * @param ctx - Orchestrator context
 * @returns The new outflow ID, or validation errors
 */
async function create_manual_outflow_orchestrator(ctx) {
    var _a;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "create_manual_outflow");
    (0, observability_1.log_operation_start)(span, ctx.user_id);
    try {
        // 1. RESOLVER (no dependencies for a new bill)
        await (0, manual_outflow_resolver_1.resolve_create_manual_outflow_dependencies)(ctx);
        // 2. DOMAIN
        const outflow_id = `manual_${(0, crypto_1.randomUUID)()}`;
        const result = (0, manual_outflow_service_1.build_manual_outflow)({
            id: outflow_id,
            user_id: ctx.user_id,
            name: ctx.input.name,
            merchant_name: ctx.input.merchant_name,
            amount: ctx.input.amount,
            frequency: ctx.input.frequency,
            expense_type: ctx.input.expense_type,
            is_essential: ctx.input.is_essential,
            due_day: ctx.input.due_day,
            now_ms: firestore_1.Timestamp.now().toMillis(),
        });
        if (result.validation_errors || !result.entity) {
            return { success: false, errors: (_a = result.validation_errors) !== null && _a !== void 0 ? _a : ["Invalid bill"] };
        }
        // 3. REPOSITORY — on_outflow_created generates periods; on_recurring_updated
        // invalidates the derive cache.
        await outflow_repo_1.outflow_repo.save_batch(ctx, [result.entity]);
        (0, observability_1.log_operation_success)(span, ctx.user_id);
        return { success: true, outflow_id };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: ctx.user_id, error_code: "CREATE_MANUAL_OUTFLOW_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=create_manual_outflow.orchestrator.js.map