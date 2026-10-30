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
const feature_flags_1 = require("../../infrastructure/feature_flags");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const manual_source_resolver_1 = require("../../resolvers/recurring/manual_source.resolver");
const capture_rules_1 = require("../../domain/recurring/capture_rules");
const generate_periods_inline_1 = require("./generate_periods_inline");
const types_1 = require("../../types");
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
        // 3. REPOSITORY.
        if (await (0, feature_flags_1.is_convert_to_recurring_enabled)(ctx.user_id)) {
            // D43 (flag on): the same record, stamped v2 + manual; a D1 key ONLY from a real transaction;
            // never a retro-link. Created stamped, periods generated inline, one derive bump — no trigger
            // fan-out and no queued reconcile.
            const src = await (0, manual_source_resolver_1.resolve_manual_source)(ctx, ctx.user_id, ctx.input);
            if (!src.ok) {
                throw new types_1.ConvertRefusedError(src.reason === "account_not_yours" ? "ACCOUNT_NOT_YOURS" : "SOURCE_NOT_YOURS", "That account or transaction isn't yours");
            }
            const run_id = `manual_${(0, crypto_1.randomUUID)()}`;
            const entity = Object.assign(Object.assign(Object.assign({}, result.entity), { account_id: src.account_id, capture_rules_version: capture_rules_1.CAPTURE_RULES_VERSION, plaid_is_active: true }), (src.vendor_key && src.account_id ? { vendor_key: src.vendor_key, converted_at_ms: Date.now() } : {}));
            const saved = await outflow_repo_1.outflow_repo.save_batch(ctx, [entity], run_id);
            await (0, generate_periods_inline_1.generate_periods_inline)(ctx, ctx.user_id, saved.written.filter((w) => w.created));
            await (0, derive_version_repo_1.bump_derive_version)(ctx.user_id).catch(() => { });
        }
        else {
            // on_outflow_created generates periods; on_recurring_updated invalidates the derive cache.
            await outflow_repo_1.outflow_repo.save_batch(ctx, [result.entity]);
        }
        (0, observability_1.log_operation_success)(span, ctx.user_id);
        return { success: true, outflow_id };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id: ctx.user_id, error_code: "CREATE_MANUAL_OUTFLOW_FAILED" });
        throw error;
    }
}
//# sourceMappingURL=create_manual_outflow.orchestrator.js.map