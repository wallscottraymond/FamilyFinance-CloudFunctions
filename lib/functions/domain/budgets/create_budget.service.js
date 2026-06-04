"use strict";
/**
 * Create Budget Domain Service
 *
 * Pure, deterministic computation of a new budget entity from normalized input
 * and resolved dependencies. Enforces business rules (budget limit, end-date
 * validity). NO async, NO IO, NO side effects, NO logging.
 *
 * @module domain/budgets/create_budget
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compute_create_budget = compute_create_budget;
const firestore_1 = require("firebase-admin/firestore");
const create_budget_types_1 = require("../../types/budgets/create_budget.types");
/**
 * Compute a new budget entity.
 *
 * PURE FUNCTION - all non-determinism (id, now) is injected.
 *
 * @param compute - Identity, normalized input, resolved deps, and clock
 * @returns The budget entity or validation errors
 */
function compute_create_budget(compute) {
    var _a;
    const { budget_id, user_id, input, dependencies, now } = compute;
    const validation_errors = [];
    if (!budget_id) {
        validation_errors.push("budget_id is required");
    }
    if (!user_id) {
        validation_errors.push("user_id is required");
    }
    if (!input.name || input.name.trim().length === 0) {
        validation_errors.push("name is required");
    }
    if (input.amount <= 0) {
        validation_errors.push("amount must be positive");
    }
    if (!input.category_ids || input.category_ids.length === 0) {
        validation_errors.push("at least one category is required");
    }
    if (dependencies.existing_budget_count >= create_budget_types_1.MAX_BUDGETS_PER_USER) {
        validation_errors.push(`budget limit reached (${create_budget_types_1.MAX_BUDGETS_PER_USER} budgets per user)`);
    }
    const start = parse_date(input.start_date);
    if (!start) {
        validation_errors.push("start_date must be a valid date");
    }
    // Fixed end date validation
    let budget_end = null;
    if (input.is_ongoing === false) {
        budget_end = input.budget_end_date ? parse_date(input.budget_end_date) : null;
        if (!budget_end) {
            validation_errors.push("budget_end_date is required and must be valid when is_ongoing is false");
        }
        else if (start && budget_end <= start) {
            validation_errors.push("budget_end_date must be after start_date");
        }
    }
    if (validation_errors.length > 0) {
        return { validation_errors };
    }
    const start_date = start;
    const legacy_end = input.end_date
        ? (_a = parse_date(input.end_date)) !== null && _a !== void 0 ? _a : compute_legacy_end_date(start_date, input.period)
        : compute_legacy_end_date(start_date, input.period);
    const group_ids = dependencies.group_ids;
    const is_private = group_ids.length === 0;
    const entity = {
        id: budget_id,
        user_id,
        group_ids,
        is_active: true,
        access: {
            owner_id: user_id,
            created_by: user_id,
            group_ids,
            is_private,
        },
        created_by: user_id,
        owner_id: user_id,
        is_private,
        name: input.name.trim(),
        description: input.description,
        amount: input.amount,
        currency: dependencies.currency,
        category_ids: input.category_ids,
        period: input.period,
        budget_type: input.budget_type,
        start_date: firestore_1.Timestamp.fromDate(start_date),
        end_date: firestore_1.Timestamp.fromDate(legacy_end),
        spent: 0,
        remaining: input.amount,
        alert_threshold: input.alert_threshold,
        selected_start_period: input.selected_start_period,
        is_ongoing: input.is_ongoing,
        budget_end_date: budget_end ? firestore_1.Timestamp.fromDate(budget_end) : undefined,
        is_system_everything_else: false,
        created_at: now,
        updated_at: now,
    };
    return { entity };
}
/**
 * Parse an ISO date string; returns null if invalid.
 *
 * PURE helper.
 */
function parse_date(value) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}
/**
 * Auto-calculate the legacy end_date from the period cadence.
 *
 * PURE helper.
 */
function compute_legacy_end_date(start, period) {
    const end = new Date(start.getTime());
    switch (period) {
        case "weekly":
            end.setUTCDate(end.getUTCDate() + 7);
            break;
        case "monthly":
            end.setUTCMonth(end.getUTCMonth() + 1);
            break;
        case "quarterly":
            end.setUTCMonth(end.getUTCMonth() + 3);
            break;
        case "yearly":
            end.setUTCFullYear(end.getUTCFullYear() + 1);
            break;
        default:
            end.setUTCMonth(end.getUTCMonth() + 1);
    }
    return end;
}
//# sourceMappingURL=create_budget.service.js.map