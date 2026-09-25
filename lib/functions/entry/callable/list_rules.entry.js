"use strict";
/**
 * list_rules — onCall entry returning the caller's rules (active + inactive), priority-ordered,
 * for the Rule Book UI.
 *
 * @module entry/callable/list_rules
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.list_rules = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const rules_repo_1 = require("../../repositories/rules.repo");
exports.list_rules = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const ctx = (0, observability_1.create_trace_context)(false);
    const rules = await rules_repo_1.rules_repo.list_rules(ctx, request.auth.uid);
    return { rules };
});
//# sourceMappingURL=list_rules.entry.js.map