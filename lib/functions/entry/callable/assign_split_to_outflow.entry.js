"use strict";
/**
 * Assign Split → Bill (Outflow) Entry Point
 *
 * Manually pin a transaction split to a recurring bill (outflow), or clear the pin
 * (`outflow_id: null`). The pin is DURABLE: the split records
 * `outflowAssignmentSource="manual"`, which the Transaction Assignment Engine
 * preserves across Plaid re-syncs (mirrors the manual budget pin). The write sets the
 * queryable `splitOutflowIds` denorm and fires `on_transaction_written`, which enqueues
 * the recurring reconcile — so the bill marks paid (counting a pending payment as
 * paid·pending). This is the manual escape hatch for when auto-matching misses.
 *
 * @module entry/callable/assign_split_to_outflow
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.assign_split_to_outflow = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const transaction_repo_1 = require("../../repositories/transaction.repo");
const types_1 = require("../../types");
const schema = zod_1.z.object({
    transaction_id: zod_1.z.string().min(1, "transaction_id is required"),
    split_id: zod_1.z.string().min(1, "split_id is required"),
    /** The bill to pin to; null clears a manual pin (reverts to auto-derivation). */
    outflow_id: zod_1.z.string().min(1).nullable(),
    /** Clear the split's budget assignment when pinning to a bill (default: keep). */
    clear_budget: zod_1.z.boolean().optional(),
    debug_mode: zod_1.z.boolean().optional(),
});
exports.assign_split_to_outflow = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 50 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "assign_split_to_outflow");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = schema.safeParse(request.data);
        if (!validation.success) {
            throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((i) => i.message).join("; "), { trace_id: ctx.trace_id });
        }
        const { transaction_id, split_id, outflow_id, clear_budget } = validation.data;
        await transaction_repo_1.transaction_repo.pin_split_to_outflow(ctx, transaction_id, split_id, outflow_id, user_id, clear_budget === true);
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)({ transaction_id, split_id, outflow_id }, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        if (error instanceof https_1.HttpsError)
            throw error;
        if (error instanceof types_1.DomainError) {
            throw new https_1.HttpsError((0, types_1.get_https_error_code)(error), (0, types_1.get_user_message)(error.code), {
                trace_id: ctx.trace_id,
            });
        }
        throw new https_1.HttpsError("internal", "Failed to assign split to bill", {
            trace_id: ctx.trace_id,
        });
    }
});
//# sourceMappingURL=assign_split_to_outflow.entry.js.map