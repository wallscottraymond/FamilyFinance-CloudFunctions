"use strict";
/**
 * Rules CRUD — Zod input schemas + types for the create/update/delete/list callables.
 * Zod validates the SHAPE at the entry layer; `domain/rules/rule_validation.service.ts` validates
 * the semantics (≥1 condition, ≥1 action).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.delete_rule_input_schema = exports.update_rule_input_schema = exports.create_rule_input_schema = exports.MAX_RULES_PER_USER = void 0;
const zod_1 = require("zod");
/** Max rules per user — bounds the once-per-batch load cost (Read-Cost Plan rule #9). Generous. */
exports.MAX_RULES_PER_USER = 300;
const rule_value_schema = zod_1.z.union([zod_1.z.string(), zod_1.z.number()]);
const rule_condition_schema = zod_1.z.object({
    variable: zod_1.z.enum(["merchant", "date", "amount", "category", "account", "tag"]),
    operator: zod_1.z.string().min(1),
    value: rule_value_schema,
    value2: rule_value_schema.optional(),
});
// Recursive group schema (flat in v1, but nesting-ready).
const rule_condition_group_schema = zod_1.z.lazy(() => zod_1.z.object({
    op: zod_1.z.enum(["AND", "OR"]),
    conditions: zod_1.z.array(rule_condition_schema),
    nested: zod_1.z.array(rule_condition_group_schema).optional(),
}));
const rule_split_spec_schema = zod_1.z.object({
    percent: zod_1.z.number().optional(),
    amount: zod_1.z.number().optional(),
    budget_id: zod_1.z.string().optional(),
    category: zod_1.z.string().optional(),
});
const rule_actions_schema = zod_1.z.object({
    assign_budget_id: zod_1.z.string().optional(),
    assign_category: zod_1.z.string().optional(),
    split: zod_1.z.array(rule_split_spec_schema).optional(),
    ignore: zod_1.z.boolean().optional(),
    mark_refund: zod_1.z.boolean().optional(),
    make_recurring: zod_1.z.enum(["outflow", "inflow"]).optional(),
    mark_income: zod_1.z.boolean().optional(),
    add_tag: zod_1.z.array(zod_1.z.string().min(1)).optional(),
    require_note: zod_1.z.boolean().optional(),
    require_review: zod_1.z.boolean().optional(),
});
exports.create_rule_input_schema = zod_1.z.object({
    name: zod_1.z.string().min(1, "name is required").max(100),
    conditions: rule_condition_group_schema,
    actions: rule_actions_schema,
    priority: zod_1.z.number().int().optional(),
    is_active: zod_1.z.boolean().optional(),
});
exports.update_rule_input_schema = zod_1.z.object({
    rule_id: zod_1.z.string().min(1),
    name: zod_1.z.string().min(1).max(100).optional(),
    conditions: rule_condition_group_schema.optional(),
    actions: rule_actions_schema.optional(),
    priority: zod_1.z.number().int().optional(),
    is_active: zod_1.z.boolean().optional(),
});
exports.delete_rule_input_schema = zod_1.z.object({
    rule_id: zod_1.z.string().min(1),
});
//# sourceMappingURL=rules_crud.types.js.map