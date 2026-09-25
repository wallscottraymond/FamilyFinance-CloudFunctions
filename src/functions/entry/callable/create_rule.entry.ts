/**
 * create_rule — onCall entry to create a Rule Book rule.
 *
 * Auth → Zod shape validation → semantic validation (≥1 condition, ≥1 action) → per-user cap →
 * persist. Priority defaults to the bottom of the list.
 *
 * @module entry/callable/create_rule
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { create_trace_context } from "../../observability";
import { rules_repo } from "../../repositories/rules.repo";
import { validate_rule } from "../../domain/rules/rule_validation.service";
import {
  create_rule_input_schema,
  CreateRuleResponse,
  MAX_RULES_PER_USER,
} from "../../types/rules_crud.types";
import { RuleActions, RuleConditionGroup } from "../../types/rules.types";

export const create_rule = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request): Promise<CreateRuleResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(false);

    const parsed = create_rule_input_schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        parsed.error.issues.map((i) => i.message).join("; ")
      );
    }
    const input = parsed.data;
    const conditions = input.conditions as RuleConditionGroup;
    const actions = input.actions as RuleActions;

    const errors = validate_rule(conditions, actions);
    if (errors.length > 0) {
      throw new HttpsError("invalid-argument", errors.join("; "));
    }

    const count = await rules_repo.count_rules(ctx, user_id);
    if (count >= MAX_RULES_PER_USER) {
      throw new HttpsError(
        "resource-exhausted",
        `Rule limit reached (${MAX_RULES_PER_USER}).`
      );
    }

    // Default new rules to the bottom of the Rule Book (highest priority number = evaluated last).
    const priority = input.priority ?? (count + 1) * 10;
    const rule_id = await rules_repo.create_rule(ctx, user_id, {
      name: input.name,
      conditions,
      actions,
      priority,
      is_active: input.is_active ?? true,
    });
    return { rule_id };
  }
);
