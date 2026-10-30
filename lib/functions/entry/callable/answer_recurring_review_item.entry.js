"use strict";
/**
 * Answer Recurring Review Item Entry Point (Convert-To-Recurring Phase 1)
 *
 * One tap on a Bills-to-review tile: Track this bill / Not a bill (suggestions), Still a bill /
 * It ended, Keep separate. Owner-only (D15 / D24): the item id must be the caller's own; a group
 * member gets PermissionDenied. Delegates to the orchestrator.
 *
 * @module entry/callable/answer_recurring_review_item
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.answer_recurring_review_item = void 0;
const https_1 = require("firebase-functions/v2/https");
const zod_1 = require("zod");
const observability_1 = require("../../observability");
const answer_recurring_review_item_orchestrator_1 = require("../../orchestrators/recurring/answer_recurring_review_item.orchestrator");
const types_1 = require("../../types");
const schema = zod_1.z.object({
    item_id: zod_1.z.string().min(1, "item_id is required").max(300),
    answer: zod_1.z.enum(["track", "not_bill", "still_a_bill", "it_ended", "keep_separate", "same_bill"]),
    frequency: zod_1.z.enum(["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "yearly"]).nullable().optional(),
    name: zod_1.z.string().trim().min(1).max(120).optional(),
    amount: zod_1.z.number().positive().max(10000000).optional(),
    next_due_date: zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    debug_mode: zod_1.z.boolean().optional(),
});
exports.answer_recurring_review_item = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 50 }, async (request) => {
    var _a;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(ctx, "entry", "answer_recurring_review_item");
    (0, observability_1.log_operation_start)(span, user_id);
    try {
        const validation = schema.safeParse(request.data);
        if (!validation.success) {
            throw new https_1.HttpsError("invalid-argument", validation.error.issues.map((i) => i.message).join("; "), { trace_id: ctx.trace_id });
        }
        const { item_id, answer, frequency, name, amount, next_due_date } = validation.data;
        const result = await (0, answer_recurring_review_item_orchestrator_1.answer_recurring_review_item_orchestrator)(ctx, user_id, { item_id, answer, frequency: frequency !== null && frequency !== void 0 ? frequency : null, name, amount, next_due_date }, Date.now());
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(result, ctx.trace_id);
    }
    catch (error) {
        (0, observability_1.log_operation_error)(span, error instanceof Error ? error : new Error(String(error)), { user_id });
        if (error instanceof https_1.HttpsError)
            throw error;
        if (error instanceof types_1.DomainError) {
            const message = error.code === "VALIDATION_ERROR" ? error.message : (0, types_1.get_user_message)(error.code);
            throw new https_1.HttpsError((0, types_1.get_https_error_code)(error), message, { trace_id: ctx.trace_id, code: error.code });
        }
        throw new https_1.HttpsError("internal", "Failed to answer", { trace_id: ctx.trace_id });
    }
});
//# sourceMappingURL=answer_recurring_review_item.entry.js.map