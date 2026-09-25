/**
 * Rules CRUD — Zod input schemas + types for the create/update/delete/list callables.
 * Zod validates the SHAPE at the entry layer; `domain/rules/rule_validation.service.ts` validates
 * the semantics (≥1 condition, ≥1 action).
 */

import { z } from "zod";
import { Rule } from "./rules.types";

/** Max rules per user — bounds the once-per-batch load cost (Read-Cost Plan rule #9). Generous. */
export const MAX_RULES_PER_USER = 300;

const rule_value_schema = z.union([z.string(), z.number()]);

const rule_condition_schema = z.object({
  variable: z.enum(["merchant", "date", "amount", "category", "account"]),
  operator: z.string().min(1),
  value: rule_value_schema,
  value2: rule_value_schema.optional(),
});

// Recursive group schema (flat in v1, but nesting-ready).
const rule_condition_group_schema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    op: z.enum(["AND", "OR"]),
    conditions: z.array(rule_condition_schema),
    nested: z.array(rule_condition_group_schema).optional(),
  })
);

const rule_split_spec_schema = z.object({
  percent: z.number().optional(),
  amount: z.number().optional(),
  budget_id: z.string().optional(),
  category: z.string().optional(),
});

const rule_actions_schema = z.object({
  assign_budget_id: z.string().optional(),
  assign_category: z.string().optional(),
  split: z.array(rule_split_spec_schema).optional(),
  ignore: z.boolean().optional(),
  mark_refund: z.boolean().optional(),
  make_recurring: z.enum(["outflow", "inflow"]).optional(),
  mark_income: z.boolean().optional(),
  require_note: z.boolean().optional(),
  require_review: z.boolean().optional(),
});

export const create_rule_input_schema = z.object({
  name: z.string().min(1, "name is required").max(100),
  conditions: rule_condition_group_schema,
  actions: rule_actions_schema,
  priority: z.number().int().optional(),
  is_active: z.boolean().optional(),
});
export type CreateRuleInput = z.infer<typeof create_rule_input_schema>;

export const update_rule_input_schema = z.object({
  rule_id: z.string().min(1),
  name: z.string().min(1).max(100).optional(),
  conditions: rule_condition_group_schema.optional(),
  actions: rule_actions_schema.optional(),
  priority: z.number().int().optional(),
  is_active: z.boolean().optional(),
});
export type UpdateRuleInput = z.infer<typeof update_rule_input_schema>;

export const delete_rule_input_schema = z.object({
  rule_id: z.string().min(1),
});

export interface CreateRuleResponse {
  rule_id: string;
}
export interface ListRulesResponse {
  rules: Rule[];
}
