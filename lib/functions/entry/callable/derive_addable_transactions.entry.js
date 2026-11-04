"use strict";
/**
 * derive_addable_transactions — onCall entry: what can be added to a budget by hand in a period
 * (Manual-Budgets). Read-only. A view the caller isn't a member of is refused by the scope check.
 *
 * @module entry/callable/derive_addable_transactions
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.derive_addable_transactions = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const derive_budget_transactions_orchestrator_1 = require("../../orchestrators/budgets/derive_budget_transactions.orchestrator");
const derive_scope_schema_1 = require("../../types/schemas/derive_scope.schema");
const MAX_WINDOW_MS = 370 * 24 * 60 * 60 * 1000;
const schema = zod_1.z
    .object({
    budget_id: zod_1.z.string().min(1).max(128),
    window_start_ms: zod_1.z.number().int().nonnegative(),
    window_end_ms: zod_1.z.number().int().nonnegative(),
    scope: derive_scope_schema_1.derive_scope_schema.optional(),
})
    .refine((d) => d.window_end_ms >= d.window_start_ms && d.window_end_ms - d.window_start_ms <= MAX_WINDOW_MS, {
    message: "window is invalid",
});
exports.derive_addable_transactions = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    const parsed = schema.safeParse(request.data);
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const ctx = (0, observability_1.create_trace_context)(false);
    try {
        const rows = await (0, derive_budget_transactions_orchestrator_1.derive_addable_transactions_orchestrator)(ctx, request.auth.uid, parsed.data.budget_id, parsed.data.window_start_ms, parsed.data.window_end_ms, parsed.data.scope);
        return { rows };
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        console.error(`[${ctx.trace_id}] derive_addable_transactions failed:`, error);
        throw new https_1.HttpsError("internal", "Could not load transactions");
    }
});
//# sourceMappingURL=derive_addable_transactions.entry.js.map