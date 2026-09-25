"use strict";
/**
 * delete_rule — onCall entry to delete a Rule Book rule (owner only).
 *
 * @module entry/callable/delete_rule
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delete_rule = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const rules_repo_1 = require("../../repositories/rules.repo");
const rules_crud_types_1 = require("../../types/rules_crud.types");
exports.delete_rule = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(false);
    const parsed = rules_crud_types_1.delete_rule_input_schema.safeParse(request.data);
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const existing = await rules_repo_1.rules_repo.get_rule(ctx, parsed.data.rule_id);
    if (!existing) {
        throw new https_1.HttpsError("not-found", "Rule not found");
    }
    if (existing.user_id !== user_id) {
        throw new https_1.HttpsError("permission-denied", "Not your rule");
    }
    await rules_repo_1.rules_repo.delete_rule(ctx, parsed.data.rule_id);
    return { success: true };
});
//# sourceMappingURL=delete_rule.entry.js.map