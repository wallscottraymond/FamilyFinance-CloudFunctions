"use strict";
/**
 * Get Accounts Entry Point
 *
 * Cloud Function entry for retrieving user accounts.
 * Read-only operation - returns all accounts for the authenticated user.
 *
 * @module entry/callable/get_accounts
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_account = exports.get_accounts = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const accounts_1 = require("../../orchestrators/accounts");
const types_1 = require("../../types");
/**
 * Input schema for get_accounts.
 * All fields are optional for this read operation.
 */
const get_accounts_input_schema = zod_1.z.object({
    /** Include inactive/deleted accounts */
    include_inactive: zod_1.z.boolean().optional(),
    /** Debug mode enables verbose logging */
    debug_mode: zod_1.z.boolean().optional(),
}).optional();
/**
 * Input schema for get_account (single account).
 */
const get_account_input_schema = zod_1.z.object({
    /** Account ID to retrieve */
    account_id: zod_1.z.string().min(1, "account_id is required"),
    /** Debug mode enables verbose logging */
    debug_mode: zod_1.z.boolean().optional(),
});
/**
 * Maps internal account to response DTO.
 * Transforms field names to client-friendly format.
 */
function map_account_to_response(account) {
    return {
        id: account.id,
        account_id: account.account_id,
        item_id: account.item_id,
        name: account.name,
        mask: account.mask,
        official_name: account.official_name,
        account_type: account.account_type,
        account_subtype: account.account_subtype,
        balances: {
            current: account.balances.current,
            available: account.balances.available,
            limit: account.balances.limit,
            currency_code: account.balances.iso_currency_code,
        },
        institution: {
            id: account.institution.id,
            name: account.institution.name,
            logo: account.institution.logo,
        },
        is_sync_enabled: account.is_sync_enabled,
    };
}
/**
 * Get all accounts for the authenticated user.
 *
 * @param request.data.include_inactive - Include deleted accounts
 * @param request.data.debug_mode - Enable verbose logging
 * @returns User's accounts
 */
exports.get_accounts = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 100 }, async (request) => {
    var _a;
    // 1. Authentication check
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    // 2. Create trace context (root of trace)
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "get_accounts");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        // 3. Validate input
        const validation = get_accounts_input_schema.safeParse(request.data);
        if (!validation.success) {
            const messages = validation.error.issues.map((issue) => issue.message);
            throw new https_1.HttpsError("invalid-argument", messages.join("; "), { trace_id: ctx.trace_id });
        }
        const input = validation.data;
        // 4. Call orchestrator (exactly one)
        const result = await (0, accounts_1.get_accounts_orchestrator)(ctx, user_id, input);
        // 5. Map response to client DTO
        const response_data = {
            accounts: result.accounts.map((account) => map_account_to_response(account)),
            count: result.count,
        };
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(response_data, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        // Re-throw HttpsError as-is
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        // Convert other errors
        throw new https_1.HttpsError("internal", "Failed to get accounts", { trace_id: ctx.trace_id });
    }
});
/**
 * Get a single account by ID.
 *
 * @param request.data.account_id - Account ID to retrieve
 * @param request.data.debug_mode - Enable verbose logging
 * @returns The account or null if not found/unauthorized
 */
exports.get_account = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 100 }, async (request) => {
    var _a;
    // 1. Authentication check
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    // 2. Create trace context
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "get_account");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        // 3. Validate input
        const validation = get_account_input_schema.safeParse(request.data);
        if (!validation.success) {
            const messages = validation.error.issues.map((issue) => issue.message);
            throw new https_1.HttpsError("invalid-argument", messages.join("; "), { trace_id: ctx.trace_id });
        }
        const input = validation.data;
        // 4. Get user's group memberships for access check
        // TODO: Fetch from user profile when user_repo is available
        const user_group_ids = [];
        // 5. Call orchestrator
        const account = await (0, accounts_1.get_account_orchestrator)(ctx, user_id, input.account_id, user_group_ids);
        // 6. Map response to client DTO
        const response_data = account
            ? map_account_to_response(account)
            : null;
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(response_data, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError("internal", "Failed to get account", { trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=get_accounts.entry.js.map