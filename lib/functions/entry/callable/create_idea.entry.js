"use strict";
/**
 * Create Idea Entry Point (Planning-Module v1, Ideas). Adds an idea to the caller's Me list or a
 * group's list; only the title is required. The client-made idea id dedupes retries.
 *
 * @module entry/callable/create_idea
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_idea = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const idea_orchestrator_1 = require("../../orchestrators/ideas/idea.orchestrator");
const types_1 = require("../../types");
const ideas_types_1 = require("../../types/ideas.types");
exports.create_idea = (0, https_1.onCall)(
/* eslint-disable-next-line @typescript-eslint/naming-convention */
{ maxInstances: 20 }, async (request) => {
    var _a;
    if (!request.auth)
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    const user_id = request.auth.uid;
    const trace = (0, observability_1.create_trace_context)(((_a = request.data) === null || _a === void 0 ? void 0 : _a.debug_mode) === true);
    const span = (0, observability_1.create_span)(trace, "entry", "create_idea");
    (0, observability_1.log_operation_start)(span, user_id);
    const validation = ideas_types_1.create_idea_input_schema.safeParse(request.data || {});
    if (!validation.success) {
        const message = validation.error.issues.map((i) => i.message).join("; ");
        (0, observability_1.log_operation_error)(span, new Error(message), { user_id });
        return (0, types_1.error_response)("VALIDATION_ERROR", message, trace.trace_id);
    }
    try {
        const outcome = await (0, idea_orchestrator_1.create_idea_orchestrator)(Object.assign(Object.assign({}, trace), { input: validation.data, user_id, idempotency_key: `create_idea:${validation.data.idea_id}` }));
        if (!outcome.success)
            return (0, types_1.error_response)(outcome.code, outcome.message, trace.trace_id);
        (0, observability_1.log_operation_success)(span, user_id);
        return (0, types_1.success_response)(outcome.data, trace.trace_id);
    }
    catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        (0, observability_1.log_operation_error)(span, err, { user_id });
        const msg = "Couldn't save the idea. Please try again.";
        return (0, types_1.error_response)("INTERNAL_ERROR", msg, trace.trace_id);
    }
});
//# sourceMappingURL=create_idea.entry.js.map