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
  errors.push(...validate_split_specs(actions.split ?? []));
  return errors;
}

/** A split spec is exactly one of a percent in (0, 100] or a positive amount; percents add up
 *  to at most 100 (A1-H1). Application also caps portions, so this is the user-facing check. */
function validate_split_specs(specs: NonNullable<RuleActions["split"]>): string[] {
  const errors: string[] = [];
  let percent_total = 0;
  specs.forEach((spec, i) => {
    const n = i + 1;
    const has_percent = spec.percent !== undefined;
    const has_amount = spec.amount !== undefined;
    if (has_percent === has_amount) {
      errors.push(`Split ${n} needs either a percent or an amount.`);
      return;
    }
    if (has_percent) {
      const p = spec.percent as number;
      if (!Number.isFinite(p) || p <= 0 || p > 100) {
        errors.push(`Split ${n}: the percent must be more than 0 and at most 100.`);
      } else {
        percent_total += p;
      }
    } else {
      const a = spec.amount as number;
      if (!Number.isFinite(a) || a <= 0) {
        errors.push(`Split ${n}: the amount must be more than $0.`);
      }
    }
  });
  if (percent_total > 100 + 1e-9) {
    errors.push("Split percents add up to more than 100%.");
  }
  return errors;
}
