"use strict";
/**
 * Rule validation — PURE domain service (no IO).
 *
 * Zod (at the entry layer) validates the SHAPE of a rule; this validates its SEMANTICS:
 * a rule must have at least one condition and at least one action. Prevents an empty-condition rule
 * (which would match every transaction) or an action-less rule (a no-op) from being saved.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.count_conditions = count_conditions;
exports.has_any_action = has_any_action;
exports.validate_rule = validate_rule;
/** The action keys a rule may carry (used to check "at least one action"). */
const ACTION_KEYS = [
    "assign_budget_id",
    "assign_category",
    "split",
    "ignore",
    "mark_refund",
    "make_recurring",
    "mark_income",
    "require_note",
    "require_review",
];
/** Count conditions anywhere in the group tree (direct + nested). */
function count_conditions(group) {
    var _a;
    const nested = (_a = group.nested) !== null && _a !== void 0 ? _a : [];
    return (group.conditions.length +
        nested.reduce((sum, g) => sum + count_conditions(g), 0));
}
/** True if the actions object has at least one meaningful action set. */
function has_any_action(actions) {
    return ACTION_KEYS.some((k) => {
        const v = actions[k];
        return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== false;
    });
}
/** Validate rule semantics. Returns the list of errors (empty = valid). */
function validate_rule(conditions, actions) {
    const errors = [];
    if (count_conditions(conditions) === 0) {
        errors.push("A rule must have at least one condition.");
    }
    if (!has_any_action(actions)) {
        errors.push("A rule must have at least one action.");
    }
    return errors;
}
//# sourceMappingURL=rule_validation.service.js.map