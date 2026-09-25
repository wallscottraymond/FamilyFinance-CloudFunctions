/**
 * Rule validation — PURE domain service (no IO).
 *
 * Zod (at the entry layer) validates the SHAPE of a rule; this validates its SEMANTICS:
 * a rule must have at least one condition and at least one action. Prevents an empty-condition rule
 * (which would match every transaction) or an action-less rule (a no-op) from being saved.
 */
import { RuleActions, RuleConditionGroup } from "../../types/rules.types";
/** Count conditions anywhere in the group tree (direct + nested). */
export declare function count_conditions(group: RuleConditionGroup): number;
/** True if the actions object has at least one meaningful action set. */
export declare function has_any_action(actions: RuleActions): boolean;
/** Validate rule semantics. Returns the list of errors (empty = valid). */
export declare function validate_rule(conditions: RuleConditionGroup, actions: RuleActions): string[];
//# sourceMappingURL=rule_validation.service.d.ts.map