"use strict";
/**
 * set_budget_pause — onCall entry: pause / resume a budget for exactly the days of one period
 * (Code-Health-Review M1-M1). Any member may pause a group budget, like every budget edit.
 *
 * @module entry/callable/set_budget_pause
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.set_budget_pause = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const set_budget_pause_orchestrator_1 = require("../../orchestrators/budgets/set_budget_pause.orchestrator");
const types_1 = require("../../types");
const set_budget_pause_types_1 = require("../../types/budgets/set_budget_pause.types");
exports.set_budget_pause = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const parsed = set_budget_pause_types_1.set_budget_pause_input_schema.safeParse(request.data);
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const ctx = (0, observability_1.create_trace_context)(false);
    try {
        return await (0, set_budget_pause_orchestrator_1.set_budget_pause_orchestrator)(ctx, request.auth.uid, parsed.data);
    }
    catch (error) {
        if (error instanceof https_1.HttpsError)
            throw error;
        if (error instanceof types_1.DomainError) {
            const message = error instanceof types_1.ValidationError ? error.message : (0, types_1.get_user_message)(error.code);
            throw new https_1.HttpsError((0, types_1.get_https_error_code)(error), message, { trace_id: ctx.trace_id });
        }
        console.error(`[${ctx.trace_id}] set_budget_pause failed:`, error);
        throw new https_1.HttpsError("internal", "Couldn't update the pause", { trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=set_budget_pause.entry.js.map