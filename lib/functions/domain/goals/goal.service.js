"use strict";
/**
 * Goal Domain Service — Goals (Phase 1)
 *
 * PURE business logic for goals: input validation, per-period cadence
 * translation, and per-period measurement math. No IO, no Timestamps read from
 * the clock — everything is a function of its inputs (deterministic, unit-testable).
 *
 * Measurement is BALANCE-based (per the locked design): the resolver reads
 * balance snapshots + runs the partition allocation, then hands this service the
 * already-attributed numbers to shape into a GoalMeasurement.
 *
 * @module domain/goals/goal
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.validate_create_goal = validate_create_goal;
exports.compute_create_goal = compute_create_goal;
exports.compute_update_goal = compute_update_goal;
exports.goal_daily_rate = goal_daily_rate;
exports.amount_for_span = amount_for_span;
exports.cadence_days = cadence_days;
exports.compute_goal_measurement = compute_goal_measurement;
const firestore_1 = require("firebase-admin/firestore");
const domain_1 = require("../../types/domain");
/** Nominal days per cadence, used to translate a set-aside across cadences. */
const CADENCE_DAYS = {
    weekly: 7,
    bi_monthly: 365 / 24, // ~15.21 — two periods per month
    monthly: 365 / 12, // ~30.44
};
const GOAL_TYPES = [
    "debt_paydown",
    "big_purchase",
    "savings",
    "invest",
];
/**
 * Validate a goal-creation request. Returns the (unchanged) input on success or
 * a list of human-readable errors. PURE.
 */
function validate_create_goal(input) {
    const errors = [];
    if (!GOAL_TYPES.includes(input.goal_type)) {
        errors.push(`Invalid goal_type: ${input.goal_type}`);
    }
    if (!input.name || input.name.trim().length === 0) {
        errors.push("name is required");
    }
    if (!input.linked_account_id) {
        errors.push("linked_account_id is required");
    }
    if (!(input.per_period_amount > 0)) {
        errors.push("per_period_amount must be positive");
    }
    // Ongoing (savings/invest) may omit a target; purchase/debt need one.
    const requires_target = input.goal_type === "big_purchase" || input.goal_type === "debt_paydown";
    if (requires_target) {
        if (input.target_amount == null || !(input.target_amount > 0)) {
            errors.push(`${input.goal_type} requires a positive target_amount`);
        }
    }
    // Debt manual fields, when provided, must be sane (fallback when Plaid didn't enrich).
    if (input.apr != null && (input.apr < 0 || input.apr > 100)) {
        errors.push("apr must be between 0 and 100");
    }
    if (input.minimum_payment != null && input.minimum_payment < 0) {
        errors.push("minimum_payment cannot be negative");
    }
    if (input.extra_principal != null && input.extra_principal < 0) {
        errors.push("extra_principal cannot be negative");
    }
    return errors.length > 0 ? (0, domain_1.validation_failed)(errors) : (0, domain_1.success)(input);
}
/**
 * Assemble a new GoalEntity from a validated create input + resolver-supplied
 * dependencies (baseline balance, next priority rank) + injected clock. PURE.
 */
function compute_create_goal(params) {
    var _a, _b, _c, _d, _e;
    const { input } = params;
    const validation = validate_create_goal({
        goal_type: input.goal_type,
        name: input.name,
        linked_account_id: input.linked_account_id,
        target_amount: input.target_amount,
        home_cadence: input.home_cadence,
        per_period_amount: input.per_period_amount,
        baseline_counts_existing: input.baseline_counts_existing,
        apr: input.apr,
        minimum_payment: input.minimum_payment,
        extra_principal: input.extra_principal,
    });
    if (validation.validation_errors) {
        return (0, domain_1.validation_failed)(validation.validation_errors);
    }
    const group_ids = input.is_shared && input.group_id ? [input.group_id] : [];
    const is_private = group_ids.length === 0;
    const entity = {
        id: params.goal_id,
        user_id: params.user_id,
        group_ids,
        is_active: true,
        access: {
            owner_id: params.user_id,
            created_by: params.user_id,
            group_ids,
            is_private,
        },
        created_by: params.user_id,
        owner_id: params.user_id,
        is_private,
        goal_type: input.goal_type,
        name: input.name.trim(),
        status: "active",
        linked_account_id: input.linked_account_id,
        target_amount: (_a = input.target_amount) !== null && _a !== void 0 ? _a : null,
        end_date: input.end_date ? firestore_1.Timestamp.fromDate(new Date(input.end_date)) : null,
        home_cadence: input.home_cadence,
        per_period_amount: input.per_period_amount,
        baseline_balance: params.baseline_balance,
        baseline_counts_existing: input.baseline_counts_existing,
        priority_rank: params.priority_rank,
        draws_income: true, // locked default
        linked_recurring_id: (_b = input.linked_recurring_id) !== null && _b !== void 0 ? _b : null,
        apr: (_c = input.apr) !== null && _c !== void 0 ? _c : null,
        minimum_payment: (_d = input.minimum_payment) !== null && _d !== void 0 ? _d : null,
        extra_principal: (_e = input.extra_principal) !== null && _e !== void 0 ? _e : null,
        created_at: params.now,
        updated_at: params.now,
    };
    return (0, domain_1.success)(entity);
}
/**
 * Merge an update patch onto an existing goal → the full updated entity. PURE.
 * `undefined` leaves a field unchanged; `null` clears a nullable field.
 */
function compute_update_goal(params) {
    var _a, _b, _c, _d, _e, _f;
    const { existing, input } = params;
    const errors = [];
    if (input.name !== undefined && input.name.trim().length === 0) {
        errors.push("name cannot be empty");
    }
    if (input.per_period_amount !== undefined && !(input.per_period_amount > 0)) {
        errors.push("per_period_amount must be positive");
    }
    if (input.target_amount !== undefined &&
        input.target_amount !== null &&
        !(input.target_amount > 0)) {
        errors.push("target_amount must be positive");
    }
    if (errors.length > 0)
        return (0, domain_1.validation_failed)(errors);
    const pick = (next, prev) => next === undefined ? prev : next;
    const updated = Object.assign(Object.assign({}, existing), { name: input.name !== undefined ? input.name.trim() : existing.name, target_amount: pick(input.target_amount, (_a = existing.target_amount) !== null && _a !== void 0 ? _a : null), end_date: input.end_date === undefined
            ? (_b = existing.end_date) !== null && _b !== void 0 ? _b : null
            : input.end_date === null
                ? null
                : firestore_1.Timestamp.fromDate(new Date(input.end_date)), home_cadence: pick(input.home_cadence, existing.home_cadence), per_period_amount: pick(input.per_period_amount, existing.per_period_amount), priority_rank: pick(input.priority_rank, existing.priority_rank), status: pick(input.status, existing.status), linked_recurring_id: pick(input.linked_recurring_id, (_c = existing.linked_recurring_id) !== null && _c !== void 0 ? _c : null), apr: pick(input.apr, (_d = existing.apr) !== null && _d !== void 0 ? _d : null), minimum_payment: pick(input.minimum_payment, (_e = existing.minimum_payment) !== null && _e !== void 0 ? _e : null), extra_principal: pick(input.extra_principal, (_f = existing.extra_principal) !== null && _f !== void 0 ? _f : null), updated_at: params.now });
    return (0, domain_1.success)(updated);
}
/**
 * Daily set-aside rate implied by a per-period amount in a given home cadence.
 * PURE. e.g. $304.40/month → ~$10/day.
 */
function goal_daily_rate(per_period_amount, home_cadence) {
    return per_period_amount / CADENCE_DAYS[home_cadence];
}
/**
 * Translate a goal's per-period set-aside into the amount expected for a viewed
 * period spanning `span_days` days (the viewer's cadence). PURE.
 *
 * Prefer passing the viewed period's ACTUAL day span (from its source period) so
 * month-length variation is exact; callers without it can pass CADENCE_DAYS.
 */
function amount_for_span(per_period_amount, home_cadence, span_days) {
    const daily = goal_daily_rate(per_period_amount, home_cadence);
    return round2(daily * span_days);
}
/** Nominal day length of a cadence (for callers without a concrete period span). */
function cadence_days(cadence) {
    return CADENCE_DAYS[cadence];
}
/**
 * Shape a GoalMeasurement from already-resolved inputs. PURE.
 *
 * @param params.goal_type            drives debt (balance-drop) vs save (balance-growth) sign
 * @param params.target_for_period    expected set-aside this period (from amount_for_span)
 * @param params.attributed_progress  net progress attributed to THIS goal this period
 *                                     (post-partition; already signed so positive = good)
 * @param params.cumulative_progress  signed cumulative progress toward target (baseline-relative)
 * @param params.target_amount        goal target (null = ongoing)
 * @param params.data_incomplete      a needed snapshot was missing/stale
 */
function compute_goal_measurement(params) {
    const progress = round2(params.attributed_progress);
    const cumulative = round2(params.cumulative_progress);
    const target_reached = params.target_amount != null && cumulative >= params.target_amount;
    // Ongoing goals "meet" a period when progress ≥ the period's target set-aside.
    // Zero/negative target set-asides can't be "missed".
    const met = params.target_for_period <= 0 || progress >= params.target_for_period;
    return {
        goal_id: params.goal_id,
        period_id: params.period_id,
        target_for_period: round2(params.target_for_period),
        progress_for_period: progress,
        cumulative_progress: cumulative,
        met,
        target_reached,
        data_incomplete: params.data_incomplete,
    };
}
/** Round to 2 decimal places (currency). */
function round2(n) {
    return Math.round((n + Number.EPSILON) * 100) / 100;
}
//# sourceMappingURL=goal.service.js.map