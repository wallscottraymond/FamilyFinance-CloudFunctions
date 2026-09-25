"use strict";
/**
 * create_rule — onCall entry to create a Rule Book rule.
 *
 * Auth → Zod shape validation → semantic validation (≥1 condition, ≥1 action) → per-user cap →
 * persist. Priority defaults to the bottom of the list.
 *
 * @module entry/callable/create_rule
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.create_rule = void 0;
const https_1 = require("firebase-functions/v2/https");
const observability_1 = require("../../observability");
const rules_repo_1 = require("../../repositories/rules.repo");
const rule_validation_service_1 = require("../../domain/rules/rule_validation.service");
const rules_crud_types_1 = require("../../types/rules_crud.types");
exports.create_rule = (0, https_1.onCall)(
// eslint-disable-next-line @typescript-eslint/naming-convention
{ maxInstances: 20 }, async (request) => {
    var _a, _b;
    if (!request.auth) {
        throw new https_1.HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = (0, observability_1.create_trace_context)(false);
    const parsed = rules_crud_types_1.create_rule_input_schema.safeParse(request.data);
    if (!parsed.success) {
        throw new https_1.HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const input = parsed.data;
    const conditions = input.conditions;
    const actions = input.actions;
    const errors = (0, rule_validation_service_1.validate_rule)(conditions, actions);
    if (errors.length > 0) {
        throw new https_1.HttpsError("invalid-argument", errors.join("; "));
    }
    const count = await rules_repo_1.rules_repo.count_rules(ctx, user_id);
    if (count >= rules_crud_types_1.MAX_RULES_PER_USER) {
        throw new https_1.HttpsError("resource-exhausted", `Rule limit reached (${rules_crud_types_1.MAX_RULES_PER_USER}).`);
    }
    // Default new rules to the bottom of the Rule Book (highest priority number = evaluated last).
    const priority = (_a = input.priority) !== null && _a !== void 0 ? _a : (count + 1) * 10;
    const rule_id = await rules_repo_1.rules_repo.create_rule(ctx, user_id, {
        name: input.name,
        conditions,
        actions,
        priority,
        is_active: (_b = input.is_active) !== null && _b !== void 0 ? _b : true,
    });
    return { rule_id };
});
//# sourceMappingURL=create_rule.entry.js.map