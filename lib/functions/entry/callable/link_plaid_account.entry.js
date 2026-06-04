"use strict";
/**
 * Link Plaid Account Entry Point
 *
 * Cloud Function entry for the complete Plaid Link flow.
 * Called after user completes Plaid Link to:
 * 1. Exchange the public token for access token
 * 2. Save the Plaid item
 * 3. Link accounts
 *
 * @module entry/callable/link_plaid_account
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.link_plaid_account = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const plaid_1 = require("../../orchestrators/plaid");
const types_1 = require("../../types");
// Plaid secrets - must be declared at entry point for runtime access
const PLAID_CLIENT_ID = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const PLAID_SECRET = (0, params_1.defineSecret)("PLAID_SECRET");
const TOKEN_ENCRYPTION_KEY = (0, params_1.defineSecret)("TOKEN_ENCRYPTION_KEY");
/**
 * Input schema for link_plaid_account.
 * Validates request payload using Zod.
 */
const link_plaid_account_input_schema = zod_1.z.object({
    /** Public token from Plaid Link */
    public_token: zod_1.z.string().min(1, "Public token is required"),
    /** Institution ID from Plaid Link metadata */
    institution_id: zod_1.z.string().min(1, "Institution ID is required"),
    /** Institution name from Plaid Link metadata */
    institution_name: zod_1.z.string().min(1, "Institution name is required"),
    /** Link session ID for idempotency */
    link_session_id: zod_1.z.string().min(1, "Link session ID is required"),
    /** Debug mode enables verbose logging */
    debug_mode: zod_1.z.boolean().optional(),
});
/**
 * Link a Plaid account - complete flow.
 *
 * This function:
 * 1. Authenticates the user
 * 2. Validates input
 * 3. Creates trace context
 * 4. Calls the orchestrator (exchange + save item + link accounts)
 * 5. Returns the result
 *
 * @param request.data.public_token - Public token from Plaid Link
 * @param request.data.institution_id - Institution ID from metadata
 * @param request.data.institution_name - Institution name from metadata
 * @param request.data.link_session_id - Link session ID for idempotency
 * @param request.data.debug_mode - Enable verbose logging (optional)
 * @returns Result with item_id and linked account info
 */
exports.link_plaid_account = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{
    maxInstances: 100,
    timeoutSeconds: 60, // Full flow can take time
    secrets: [PLAID_CLIENT_ID, PLAID_SECRET, TOKEN_ENCRYPTION_KEY],
}, async (request) => {
    var _a, _b;
    // =========================================================================
    // 1. AUTHENTICATION
    // =========================================================================
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "You must be logged in to link a bank account");
    }
    const user_id = request.auth.uid;
    // =========================================================================
    // 2. CREATE TRACE CONTEXT
    // =========================================================================
    const trace = (0, observability_1.create_trace_context)((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode);
    const span = (0, observability_1.create_span)(trace, "entry", "link_plaid_account");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        // =======================================================================
        // 3. INPUT VALIDATION
        // =======================================================================
        const input_result = link_plaid_account_input_schema.safeParse(request.data || {});
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
        const result = await (0, plaid_1.link_plaid_account_orchestrator)(Object.assign(Object.assign({}, trace), { input: {
                public_token: input.public_token,
                institution_id: input.institution_id,
                institution_name: input.institution_name,
                link_session_id: input.link_session_id,
            }, user_id, idempotency_key: `link_plaid_account:${user_id}:${input.link_session_id}` }));
        // =======================================================================
        // 5. HANDLE RESULT
        // =======================================================================
        if (!result.success) {
            (0, observability_1.log_operation_error)(span, new Error("Orchestrator failed"), {
                user_id,
                error_code: "LINK_PLAID_ACCOUNT_FAILED",
            });
            return (0, types_1.error_response)("LINK_PLAID_ACCOUNT_FAILED", ((_b = result.errors) === null || _b === void 0 ? void 0 : _b[0]) || "Unable to link bank account", trace.trace_id);
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
//# sourceMappingURL=link_plaid_account.entry.js.map