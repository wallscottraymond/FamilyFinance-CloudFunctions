/**
 * update_rule — onCall entry to edit a Rule Book rule (owner only).
 *
 * @module entry/callable/update_rule
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { create_trace_context } from "../../observability";
import { rules_repo } from "../../repositories/rules.repo";
import { validate_rule } from "../../domain/rules/rule_validation.service";
import { update_rule_input_schema } from "../../types/rules_crud.types";
import { RuleActions, RuleConditionGroup } from "../../types/rules.types";

export const update_rule = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request): Promise<{ success: true }> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(false);

    const parsed = update_rule_input_schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        parsed.error.issues.map((i) => i.message).join("; ")
      );
    }
    const input = parsed.data;

    const existing = await rules_repo.get_rule(ctx, input.rule_id);
    if (!existing) {
      throw new HttpsError("not-found", "Rule not found");
    }
    if (existing.user_id !== user_id) {
      throw new HttpsError("permission-denied", "Not your rule");
    }

    // If conditions/actions are being changed, the RESULT must still be a valid rule.
    const conditions = (input.conditions as RuleConditionGroup) ?? existing.conditions;
    const actions = (input.actions as RuleActions) ?? existing.actions;
    const errors = validate_rule(conditions, actions);
    if (errors.length > 0) {
      throw new HttpsError("invalid-argument", errors.join("; "));
    }

    await rules_repo.update_rule(ctx, input.rule_id, {
      name: input.name,
      conditions: input.conditions as RuleConditionGroup | undefined,
      actions: input.actions as RuleActions | undefined,
      priority: input.priority,
      is_active: input.is_active,
    });
    return { success: true };
  }
);
