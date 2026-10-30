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
    "add_tag",
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
    var _a;
    const errors = [];
    if (count_conditions(conditions) === 0) {
        errors.push("A rule must have at least one condition.");
    }
    if (!has_any_action(actions)) {
        errors.push("A rule must have at least one action.");
    }
    errors.push(...validate_split_specs((_a = actions.split) !== null && _a !== void 0 ? _a : []));
    return errors;
}
/** A split spec is exactly one of a percent in (0, 100] or a positive amount; percents add up
 *  to at most 100 (A1-H1). Application also caps portions, so this is the user-facing check. */
function validate_split_specs(specs) {
    const errors = [];
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
            const p = spec.percent;
            if (!Number.isFinite(p) || p <= 0 || p > 100) {
                errors.push(`Split ${n}: the percent must be more than 0 and at most 100.`);
            }
            else {
                percent_total += p;
            }
        }
        else {
            const a = spec.amount;
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
//# sourceMappingURL=rule_validation.service.js.map