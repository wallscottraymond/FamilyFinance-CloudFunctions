/**
 * Rules CRUD — Zod input schemas + types for the create/update/delete/list callables.
 * Zod validates the SHAPE at the entry layer; `domain/rules/rule_validation.service.ts` validates
 * the semantics (≥1 condition, ≥1 action).
 */
import { z } from "zod";
import { Rule } from "./rules.types";
/** Max rules per user — bounds the once-per-batch load cost (Read-Cost Plan rule #9). Generous. */
export declare const MAX_RULES_PER_USER = 300;
export declare const create_rule_input_schema: z.ZodObject<{
    name: z.ZodString;
    conditions: z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>;
    actions: z.ZodObject<{
        assign_budget_id: z.ZodOptional<z.ZodString>;
        assign_category: z.ZodOptional<z.ZodString>;
        split: z.ZodOptional<z.ZodArray<z.ZodObject<{
            percent: z.ZodOptional<z.ZodNumber>;
            amount: z.ZodOptional<z.ZodNumber>;
            budget_id: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        ignore: z.ZodOptional<z.ZodBoolean>;
        mark_refund: z.ZodOptional<z.ZodBoolean>;
        make_recurring: z.ZodOptional<z.ZodEnum<{
            outflow: "outflow";
            inflow: "inflow";
        }>>;
        mark_income: z.ZodOptional<z.ZodBoolean>;
        require_note: z.ZodOptional<z.ZodBoolean>;
        require_review: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>;
    priority: z.ZodOptional<z.ZodNumber>;
    is_active: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type CreateRuleInput = z.infer<typeof create_rule_input_schema>;
export declare const update_rule_input_schema: z.ZodObject<{
    rule_id: z.ZodString;
    name: z.ZodOptional<z.ZodString>;
    conditions: z.ZodOptional<z.ZodType<unknown, unknown, z.core.$ZodTypeInternals<unknown, unknown>>>;
    actions: z.ZodOptional<z.ZodObject<{
        assign_budget_id: z.ZodOptional<z.ZodString>;
        assign_category: z.ZodOptional<z.ZodString>;
        split: z.ZodOptional<z.ZodArray<z.ZodObject<{
            percent: z.ZodOptional<z.ZodNumber>;
            amount: z.ZodOptional<z.ZodNumber>;
            budget_id: z.ZodOptional<z.ZodString>;
            category: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>>;
        ignore: z.ZodOptional<z.ZodBoolean>;
        mark_refund: z.ZodOptional<z.ZodBoolean>;
        make_recurring: z.ZodOptional<z.ZodEnum<{
            outflow: "outflow";
            inflow: "inflow";
        }>>;
        mark_income: z.ZodOptional<z.ZodBoolean>;
        require_note: z.ZodOptional<z.ZodBoolean>;
        require_review: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strip>>;
    priority: z.ZodOptional<z.ZodNumber>;
    is_active: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strip>;
export type UpdateRuleInput = z.infer<typeof update_rule_input_schema>;
export declare const delete_rule_input_schema: z.ZodObject<{
    rule_id: z.ZodString;
}, z.core.$strip>;
export interface CreateRuleResponse {
    rule_id: string;
}
export interface ListRulesResponse {
    rules: Rule[];
}
//# sourceMappingURL=rules_crud.types.d.ts.map