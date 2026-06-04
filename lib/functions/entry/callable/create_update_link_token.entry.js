"use strict";
/**
 * Create Update Link Token Entry Point
 *
 * Cloud Function entry for creating Plaid Link tokens in update mode.
 * Used for re-authentication when bank connections enter error states.
 *
 * @module entry/callable/create_update_link_token
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_update_link_token = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const create_update_link_token_orchestrator_1 = require("../../orchestrators/plaid/create_update_link_token.orchestrator");
const types_1 = require("../../types");
// Plaid secrets - must be declared at entry point for runtime access
const PLAID_CLIENT_ID = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const PLAID_SECRET = (0, params_1.defineSecret)("PLAID_SECRET");
// Token encryption key - required for decrypting access tokens
const TOKEN_ENCRYPTION_KEY = (0, params_1.defineSecret)("TOKEN_ENCRYPTION_KEY");
/**
 * Input schema for create_update_link_token.
 * Validates request payload using Zod.
 */
const create_update_link_token_input_schema = zod_1.z.object({
    /** The Plaid item document ID to create update token for */
    item_id: zod_1.z.string().min(1, "Item ID is required"),
    /** Idempotency key to prevent duplicate requests */
    idempotency_key: zod_1.z.string().uuid("Idempotency key must be a valid UUID"),
    /** Debug mode enables verbose logging */
    debug_mode: zod_1.z.boolean().optional(),
});
/**
 * Create a Plaid Link token for re-authentication (update mode).
 *
 * This function:
 * 1. Authenticates the user
 * 2. Validates input
 * 3. Creates trace context
 * 4. Calls the orchestrator
 * 5. Returns the link token for update mode
 *
 * Used when:
 * - User's bank connection enters error state (ITEM_LOGIN_REQUIRED)
 * - OAuth consent is expiring (PENDING_EXPIRATION)
 * - User wants to proactively re-authenticate
 *
 * @param request.data.item_id - The Plaid item document ID
 * @param request.data.idempotency_key - UUID to prevent duplicate requests
 * @param request.data.debug_mode - Enable verbose logging. Optional.
 * @returns Link token response for update mode
 */
exports.create_update_link_token = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{
    maxInstances: 100,
    timeoutSeconds: 30, // Plaid API can be slow
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET, TOKEN_ENCRYPTION_KEY],
}, async (request) => {
    var _a, _b;
    // =========================================================================
    // 1. AUTHENTICATION
    // =========================================================================
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be logged in to reconnect a bank account");
    }
    const user_id = request.auth.uid;
    // =========================================================================
    // 2. CREATE TRACE CONTEXT
    // =========================================================================
    const trace = (0, observability_1.create_trace_context)((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode);
    const span = (0, observability_1.create_span)(trace, "entry", "create_update_link_token");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        // =======================================================================
        // 3. INPUT VALIDATION
        // =======================================================================
        const input_result = create_update_link_token_input_schema.safeParse(request.data || {});
        if (!input_result.success) {
            (0, observability_1.log_operation_error)(span, new Error("Validation failed"), {
                user_id,
                error_code: "VALIDATION_ERROR",
            });
            const error_messages = input_result.error.issues.map((issue) => issue.message).join(", ");
            return (0, types_1.error_response)("VALIDATION_ERROR", error_messages || "Invalid input", trace.trace_id);
        }
        const input = input_result.data;
        // =======================================================================
        // 4. CALL ORCHESTRATOR
        // =======================================================================
        const result = await (0, create_update_link_token_orchestrator_1.create_update_link_token_orchestrator)(Object.assign(Object.assign({}, trace), { input: {
                item_id: input.item_id,
                idempotency_key: input.idempotency_key,
            }, user_id, idempotency_key: input.idempotency_key }));
        // =======================================================================
        // 5. HANDLE RESULT
        // =======================================================================
        if (!result.success) {
            (0, observability_1.log_operation_error)(span, new Error("Orchestrator failed"), {
                user_id,
                error_code: result.relink_disabled
                    ? "RELINK_DISABLED"
                    : "CREATE_UPDATE_LINK_TOKEN_FAILED",
            });
            // Include special handling for disabled relink
            if (result.relink_disabled && result.disabled_reason) {
                return (0, types_1.error_response)("RELINK_DISABLED", result.disabled_reason, trace.trace_id);
            }
            return (0, types_1.error_response)("CREATE_UPDATE_LINK_TOKEN_FAILED", ((_b = result.errors) === null || _b === void 0 ? void 0 : _b[0]) || "Unable to prepare reconnection", trace.trace_id);
        }
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result.data, trace.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "INTERNAL_ERROR" });
        // Return generic error message (per project decisions)
        return (0, types_1.error_response)("INTERNAL_ERROR", "Unable to prepare reconnection. Please try again later.", trace.trace_id);
    }
});
//# sourceMappingURL=create_update_link_token.entry.js.map