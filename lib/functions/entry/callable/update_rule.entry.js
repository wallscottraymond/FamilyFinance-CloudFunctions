"use strict";
/**
 * update_rule — onCall entry to edit a Rule Book rule (owner only).
 *
 * @module entry/callable/update_rule
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.update_rule = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const rules_repo_1 = require("../../repositories/rules.repo");
const rule_validation_service_1 = require("../../domain/rules/rule_validation.service");
const rules_crud_types_1 = require("../../types/rules_crud.types");
exports.update_rule = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(false);
    const parsed = rules_crud_types_1.update_rule_input_schema.safeParse(request.data);
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const input = parsed.data;
    const existing = await rules_repo_1.rules_repo.get_rule(ctx, input.rule_id);
    if (!existing) {
        throw new https_1.HttpsError("not-found", "Rule not found");
    }
    if (existing.user_id !== user_id) {
        throw new https_1.HttpsError("permission-denied", "Not your rule");
    }
    // If conditions/actions are being changed, the RESULT must still be a valid rule.
    const conditions = (_a = input.conditions) !== null && _a !== void 0 ? _a : existing.conditions;
    const actions = (_b = input.actions) !== null && _b !== void 0 ? _b : existing.actions;
    const errors = (0, rule_validation_service_1.validate_rule)(conditions, actions);
    if (errors.length > 0) {
        throw new https_1.HttpsError("invalid-argument", errors.join("; "));
    }
    await rules_repo_1.rules_repo.update_rule(ctx, input.rule_id, {
        name: input.name,
        conditions: input.conditions,
        actions: input.actions,
        priority: input.priority,
        is_active: input.is_active,
    });
    return { success: true };
});
//# sourceMappingURL=update_rule.entry.js.map