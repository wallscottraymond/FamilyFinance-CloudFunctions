"use strict";
/**
 * Get Widget Token Entry Point ([[iOS-Home-Screen-Widgets]] Phase 2)
 *
 * Signed-in callable: returns the account's read-only widget token (creating it on first
 * use). `rotate: true` revokes the old token and issues a new one ("Reset widget access").
 * The app stores it in the shared keychain for the widget extension's self-fetch.
 *
 * @module entry/callable/get_widget_token
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_widget_token = void 0;
const https_1 = require("firebase-functions/v2/https");
const params_1 = require("firebase-functions/params");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const get_widget_token_orchestrator_1 = require("../../orchestrators/widgets/get_widget_token.orchestrator");
const types_1 = require("../../types");
// The token is stored encrypted (same key as Plaid access tokens).
const TOKEN_ENCRYPTION_KEY = (0, params_1.defineSecret)("TOKEN_ENCRYPTION_KEY");
const schema = zod_1.z.object({
    rotate: zod_1.z.boolean().optional(),
    debug_mode: zod_1.z.boolean().optional(),
});
exports.get_widget_token = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20, secrets: [TOKEN_ENCRYPTION_KEY] }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "get_widget_token");
    (0, observability_1.log_operation_start)(span, user_id);
    const validation = schema.safeParse((_b = request.data) !== null && _b !== void 0 ? _b : {});
    if (!validation.success) {
        throw new https_1.HttpsError("invalid-argument", "Invalid request", { trace_id: ctx.trace_id });
    }
    try {
        const result = await (0, get_widget_token_orchestrator_1.get_widget_token_orchestrator)(ctx, user_id, {
            rotate: validation.data.rotate === true,
        });
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), {
            user_id,
        });
        throw new https_1.HttpsError("internal", "Failed to get widget token", { trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=get_widget_token.entry.js.map