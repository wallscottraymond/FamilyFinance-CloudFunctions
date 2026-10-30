"use strict";
/**
 * Assign Split → Income Orchestrator (Convert-To-Recurring Phase 2): pin a deposit's split to one
 * of the caller's incomes, or clear the pin.
 *
 *   flag → resolve facts (read-only) → plan (pure: owner, credit, view) → pin (one Firestore
 *   transaction that re-checks both owners) → bump the derive version AFTER the write.
 *
 * The pin write is unstamped, like the bill pin: `on_transaction_written` re-runs the assignment
 * engine for the transaction and reconciles the touched incomes (1 assign job + reconciles — a
 * user tap, not a fan-out).
 *
 * @module orchestrators/recurring/assign_split_to_inflow
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assign_split_to_inflow_orchestrator = assign_split_to_inflow_orchestrator;
const types_1 = require("../../types");
const observability_1 = require("../../observability");
const feature_flags_1 = require("../../infrastructure/feature_flags");
const purge_guard_1 = require("../../infrastructure/purge_guard");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const derive_version_repo_1 = require("../../repositories/derive_version.repo");
const inflow_pin_resolver_1 = require("../../resolvers/recurring/inflow_pin.resolver");
const inflow_pin_service_1 = require("../../domain/recurring/inflow_pin.service");
async function assign_split_to_inflow_orchestrator(ctx, user_id, input) {
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "assign_split_to_inflow");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        if (!(await (0, feature_flags_1.is_convert_to_recurring_enabled)(user_id))) {
            throw new types_1.ConvertRefusedError("FEATURE_OFF", "Assigning a deposit to an income isn't available on this account yet");
        }
        if (await (0, purge_guard_1.is_user_purging)(user_id)) {
            throw new types_1.ConvertRefusedError("PURGING", "This account is being erased");
        }
        // 1. Resolve (read-only).
        const facts = await (0, inflow_pin_resolver_1.resolve_inflow_pin_facts)(ctx, user_id, input.transaction_id, input.inflow_id);
        if (!facts)
            throw new types_1.NotFoundError("transaction", input.transaction_id);
        // 2. Plan (pure).
        const plan = (0, inflow_pin_service_1.plan_inflow_pin)(user_id, facts, input.split_id, input.inflow_id);
        if (!plan.ok) {
            if (plan.code === "PERMISSION_DENIED")
                throw new types_1.PermissionDeniedError("assign_split_to_inflow", input.transaction_id);
            if (plan.code === "NOT_FOUND")
                throw new types_1.NotFoundError("transaction_split", input.split_id);
            throw new types_1.ConvertRefusedError(plan.code, plan.message);
        }
        // 3. Write (the repo re-checks both owners inside its transaction), then bump AFTER the write.
        await transaction_repo_1.transaction_repo.pin_split_to_inflow(ctx, input.transaction_id, input.split_id, input.inflow_id, user_id, (split) => (0, inflow_pin_service_1.apply_inflow_pin_to_split)(split, input.inflow_id));
        await (0, derive_version_repo_1.bump_derive_version)(user_id).catch(() => { });
        (0, observability_1.log_operation_success)(span, user_id);
        return { transaction_id: input.transaction_id, split_id: input.split_id, inflow_id: input.inflow_id };
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        throw error;
    }
}
//# sourceMappingURL=assign_split_to_inflow.orchestrator.js.map