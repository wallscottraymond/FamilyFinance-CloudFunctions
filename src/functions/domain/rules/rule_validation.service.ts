/**
 * Rule validation — PURE domain service (no IO).
 *
 * Zod (at the entry layer) validates the SHAPE of a rule; this validates its SEMANTICS:
 * a rule must have at least one condition and at least one action. Prevents an empty-condition rule
 * (which would match every transaction) or an action-less rule (a no-op) from being saved.
 */

import {
  RuleActions,
  RuleConditionGroup,
} from "../../types/rules.types";

/** The action keys a rule may carry (used to check "at least one action"). */
const ACTION_KEYS: (keyof RuleActions)[] = [
  "assign_budget_id",
  "assign_category",
  "split",
  "ignore",
  "mark_refund",
  "make_recurring",
  "mark_income",
  "add_tag",
  "require_note",
  "require_review",
];

/** Count conditions anywhere in the group tree (direct + nested). */
export function count_conditions(group: RuleConditionGroup): number {
  const nested = group.nested ?? [];
  return (
    group.conditions.length +
    nested.reduce((sum, g) => sum + count_conditions(g), 0)
  );
}

/** True if the actions object has at least one meaningful action set. */
export function has_any_action(actions: RuleActions): boolean {
  return ACTION_KEYS.some((k) => {
    const v = actions[k];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== false;
  });
}

/** Validate rule semantics. Returns the list of errors (empty = valid). */
export function validate_rule(
  conditions: RuleConditionGroup,
  actions: RuleActions
): string[] {
  const errors: string[] = [];
  if (count_conditions(conditions) === 0) {
    errors.push("A rule must have at least one condition.");
  }
  if (!has_any_action(actions)) {
    errors.push("A rule must have at least one action.");
  }
  return errors;
}
