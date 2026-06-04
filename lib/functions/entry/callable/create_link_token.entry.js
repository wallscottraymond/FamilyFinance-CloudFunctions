"use strict";
/**
 * Create Link Token Entry Point
 *
 * Cloud Function entry for creating Plaid Link tokens.
 * Enables users to connect bank accounts via Plaid Link.
 *
 * @module entry/callable/create_link_token
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_link_token = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const plaid_1 = require("../../orchestrators/plaid");
const types_1 = require("../../types");
// Plaid secrets - must be declared at entry point for runtime access
const PLAID_CLIENT_ID = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const PLAID_SECRET = (0, params_1.defineSecret)("PLAID_SECRET");
/**
 * Input schema for create_link_token.
 * Validates request payload using Zod.
 */
const create_link_token_input_schema = zod_1.z.object({
    /** Access token for update mode (re-authentication). Optional. */
    access_token: zod_1.z.string().optional(),
    /** Redirect URI for OAuth flows. Optional. */
    redirect_uri: zod_1.z.string().url().optional(),
    /** Debug mode enables verbose logging */
    debug_mode: zod_1.z.boolean().optional(),
});
/**
 * Create a Plaid Link token for account connection.
 *
 * This function:
 * 1. Authenticates the user
 * 2. Validates input
 * 3. Creates trace context
 * 4. Calls the orchestrator
 * 5. Returns the link token
 *
 * Supports:
 * - Normal mode: Create link token for new account connection
 * - Update mode: Create link token for re-authentication (when credentials expire)
 *
 * @param request.data.access_token - For update mode (re-auth). Optional.
 * @param request.data.redirect_uri - For OAuth flows. Optional.
 * @param request.data.debug_mode - Enable verbose logging. Optional.
 * @returns Link token response
 */
exports.create_link_token = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{
    maxInstances: 100,
    timeoutSeconds: 30, // Plaid API can be slow
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET], // Required for Plaid API access
}, async (request) => {
    var _a, _b;
    // =========================================================================
    // 1. AUTHENTICATION
    // =========================================================================
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be logged in to create a link token");
    }
    const user_id = request.auth.uid;
    // =========================================================================
    // 2. CREATE TRACE CONTEXT
    // =========================================================================
    const trace = (0, observability_1.create_trace_context)((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode);
    const span = (0, observability_1.create_span)(trace, "entry", "create_link_token");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        // =======================================================================
        // 3. INPUT VALIDATION
        // =======================================================================
        const input_result = create_link_token_input_schema.safeParse(request.data || {});
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
        const result = await (0, plaid_1.create_link_token_orchestrator)(Object.assign(Object.assign({}, trace), { input: {
                access_token: input.access_token,
                redirect_uri: input.redirect_uri,
            }, user_id, idempotency_key: `create_link_token:${user_id}:${Date.now()}` }));
        // =======================================================================
        // 5. HANDLE RESULT
        // =======================================================================
        if (!result.success) {
            (0, observability_1.log_operation_error)(span, new Error("Orchestrator failed"), {
                user_id,
                error_code: "CREATE_LINK_TOKEN_FAILED",
            });
            return (0, types_1.error_response)("CREATE_LINK_TOKEN_FAILED", ((_b = result.errors) === null || _b === void 0 ? void 0 : _b[0]) || "Unable to create link token", trace.trace_id);
        }
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result.data, trace.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id, error_code: "INTERNAL_ERROR" });
        // Return generic error message (per project decisions)
        return (0, types_1.error_response)("INTERNAL_ERROR", "Unable to connect to bank. Please try again later.", trace.trace_id);
    }
});
//# sourceMappingURL=create_link_token.entry.js.map