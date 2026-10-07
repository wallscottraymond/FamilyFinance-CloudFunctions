"use strict";
/**
 * Complete Relink Entry Point
 *
 * Called by the app right after Plaid update-mode Link succeeds. Plaid sends no
 * webhook for a repair done in our app, so without this the item would stay
 * flagged (and skipped by the scheduled syncs) until the self-heal pass ran.
 *
 * @module entry/callable/complete_relink
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.complete_relink = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const reauth_recovery_orchestrator_1 = require("../../orchestrators/plaid/reauth_recovery.orchestrator");
const types_1 = require("../../types");
// The probe decrypts the access token and calls Plaid; the refresh syncs data.
const PLAID_CLIENT_ID = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const PLAID_SECRET = (0, params_1.defineSecret)("PLAID_SECRET");
const TOKEN_ENCRYPTION_KEY = (0, params_1.defineSecret)("TOKEN_ENCRYPTION_KEY");
/**
 * Input schema for complete_relink.
 */
const complete_relink_input_schema = zod_1.z.object({
    /** The Plaid item document ID that was just re-authenticated */
    item_id: zod_1.z.string().min(1, "Item ID is required"),
    /** Debug mode enables verbose logging */
    debug_mode: zod_1.z.boolean().optional(),
});
/**
 * Confirms a reconnection, marks the item healthy, and refreshes its data.
 *
 * @param request.data.item_id - The Plaid item document ID
 * @returns Whether the item is repaired and its status
 */
exports.complete_relink = (0, https_1.onCall)(
/* eslint-disable @typescript-eslint/naming-convention */
{
    maxInstances: 20,
    timeoutSeconds: 120, // probe + balances + transactions + recurring
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET, TOKEN_ENCRYPTION_KEY],
}, 
/* eslint-enable @typescript-eslint/naming-convention */
async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be logged in to reconnect a bank account");
    }
    const user_id = request.auth.uid;
    const trace = (0, observability_1.create_trace_context)((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode);
    const span = (0, observability_1.create_span)(trace, "entry", "complete_relink");
    (0, observability_1.log_operation_start)(span, user_id);
    const input_result = complete_relink_input_schema.safeParse(request.data || {});
    if (!input_result.success) {
        (0, observability_1.log_operation_error)(span, new Error("Validation failed"), {
            user_id,
            error_code: "VALIDATION_ERROR",
        });
        return (0, types_1.error_response)("VALIDATION_ERROR", input_result.error.issues.map((issue) => issue.message).join(", "), trace.trace_id);
    }
    const result = await (0, reauth_recovery_orchestrator_1.complete_relink_orchestrator)(Object.assign(Object.assign({}, trace), { input: { item_id: input_result.data.item_id }, user_id, idempotency_key: `complete_relink:${input_result.data.item_id}:${trace.trace_id}` }));
    if (!result.success || !result.data) {
        (0, observability_1.log_operation_error)(span, new Error("Orchestrator failed"), {
            user_id,
            error_code: result.error_code || "COMPLETE_RELINK_FAILED",
        });
        return (0, types_1.error_response)(result.error_code || "COMPLETE_RELINK_FAILED", result.error || "Unable to confirm the reconnection", trace.trace_id);
    }
    (0, observability_1.log_operation_success)(span, user_id);
    return (0, types_1.success_response)(result.data, trace.trace_id);
});
//# sourceMappingURL=complete_relink.entry.js.map