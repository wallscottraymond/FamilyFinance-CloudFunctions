"use strict";
/**
 * Inflow Period Domain Service
 *
 * PURE business logic for calculating inflow periods.
 * No IO, no side effects, no async operations.
 *
 * @module domain/inflows/inflow_period
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compute_inflow_periods = compute_inflow_periods;
exports.validate_inflow_periods = validate_inflow_periods;
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../types");
/**
 * Get approximate cycle days for a frequency.
 */
function get_cycle_days(frequency) {
    switch (frequency.toUpperCase()) {
        case "WEEKLY":
            return 7;
        case "BIWEEKLY":
            return 14;
        case "SEMI_MONTHLY":
            return 15;
        case "MONTHLY":
            return 30;
        case "QUARTERLY":
            return 91;
        case "ANNUALLY":
            return 365;
        default:
            return 30;
    }
}
/**
 * Get number of days in a period.
 */
function get_period_days(start, end) {
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}
/**
 * Add frequency interval to a date.
 */
function add_frequency_interval(date, frequency) {
    const result = new Date(date);
    switch (frequency.toUpperCase()) {
        case "WEEKLY":
            result.setDate(result.getDate() + 7);
            break;
        case "BIWEEKLY":
            result.setDate(result.getDate() + 14);
            break;
        case "SEMI_MONTHLY":
            result.setDate(result.getDate() + 15);
            break;
        case "MONTHLY":
            result.setMonth(result.getMonth() + 1);
            break;
        case "QUARTERLY":
            result.setMonth(result.getMonth() + 3);
            break;
        case "ANNUALLY":
            result.setFullYear(result.getFullYear() + 1);
            break;
        default:
            result.setMonth(result.getMonth() + 1);
    }
    return result;
}
/**
 * Subtract frequency interval from a date.
 */
function subtract_frequency_interval(date, frequency) {
    const result = new Date(date);
    switch (frequency.toUpperCase()) {
        case "WEEKLY":
            result.setDate(result.getDate() - 7);
            break;
        case "BIWEEKLY":
            result.setDate(result.getDate() - 14);
            break;
        case "SEMI_MONTHLY":
            result.setDate(result.getDate() - 15);
            break;
        case "MONTHLY":
            result.setMonth(result.getMonth() - 1);
            break;
        case "QUARTERLY":
            result.setMonth(result.getMonth() - 3);
            break;
        case "ANNUALLY":
            result.setFullYear(result.getFullYear() - 1);
            break;
        default:
            result.setMonth(result.getMonth() - 1);
    }
    return result;
}
/**
 * Adjust date for month-end edge cases.
 */
function adjust_for_month_end(current_date, reference_date, frequency) {
    const freq = frequency.toUpperCase();
    if (freq !== "MONTHLY" && freq !== "QUARTERLY" && freq !== "ANNUALLY") {
        return current_date;
    }
    const original_day = reference_date.getDate();
    const current_month = current_date.getMonth();
    const current_year = current_date.getFullYear();
    const last_day_of_month = new Date(current_year, current_month + 1, 0).getDate();
    if (original_day > last_day_of_month) {
        return new Date(current_year, current_month, last_day_of_month);
    }
    return current_date;
}
/**
 * Calculate payment cycle information from inflow data.
 * PURE function - no IO.
 */
function calculate_payment_cycle(inflow) {
    const income_amount = Math.abs(inflow.average_amount);
    const cycle_days = get_cycle_days(inflow.frequency);
    const daily_rate = income_amount / cycle_days;
    const cycle_end_date = inflow.last_date;
    const cycle_start_ms = cycle_end_date.toDate().getTime() - cycle_days * 24 * 60 * 60 * 1000;
    const cycle_start_date = firestore_1.Timestamp.fromDate(new Date(cycle_start_ms));
    return {
        income_amount,
        cycle_days,
        daily_rate,
        cycle_start_date,
        cycle_end_date,
    };
}
/**
 * Calculate all income occurrences within a given period.
 * PURE function - no IO.
 */
function calculate_occurrences_in_period(inflow, source_period, cycle_info) {
    const period_start = source_period.start_date.toDate();
    const period_end = source_period.end_date.toDate();
    const frequency = inflow.frequency;
    const cycle_days = cycle_info.cycle_days;
    const amount_per_occurrence = cycle_info.income_amount;
    // Get reference date
    let reference_date;
    if (inflow.predicted_next_date) {
        reference_date = inflow.predicted_next_date.toDate();
    }
    else if (inflow.last_date) {
        reference_date = inflow.last_date.toDate();
    }
    else {
        reference_date = inflow.first_date.toDate();
    }
    // Find all occurrences that fall within the period
    const occurrence_due_dates = [];
    let current_date = new Date(reference_date);
    // If reference date is after period end, work backwards
    while (current_date > period_end) {
        current_date = subtract_frequency_interval(current_date, frequency);
    }
    // If reference date is before period start, work forwards
    while (current_date < period_start) {
        current_date = add_frequency_interval(current_date, frequency);
    }
    // Collect all occurrences within the period
    while (current_date <= period_end) {
        if (current_date >= period_start) {
            const adjusted = adjust_for_month_end(current_date, reference_date, frequency);
            occurrence_due_dates.push(firestore_1.Timestamp.fromDate(adjusted));
        }
        current_date = add_frequency_interval(current_date, frequency);
    }
    // Next expected date is after the period
    const next_expected_date = firestore_1.Timestamp.fromDate(adjust_for_month_end(current_date, reference_date, frequency));
    const number_of_occurrences = occurrence_due_dates.length;
    const total_expected_amount = number_of_occurrences * amount_per_occurrence;
    // Calculate amount allocated (proportional distribution)
    const period_days = get_period_days(period_start, period_end);
    const amount_allocated = Math.round((amount_per_occurrence * (period_days / cycle_days)) * 100) / 100;
    return {
        number_of_occurrences,
        occurrence_due_dates,
        total_expected_amount,
        next_expected_date,
        amount_allocated,
        cycle_days,
    };
}
/**
 * Calculate period amounts for budgeting.
 */
function calculate_period_amounts(source_period, cycle_info) {
    const period_start = source_period.start_date.toDate();
    const period_end = source_period.end_date.toDate();
    const days_in_period = get_period_days(period_start, period_end);
    const amount_earned = Math.round((cycle_info.daily_rate * days_in_period) * 100) / 100;
    return {
        amount_earned,
        daily_rate: cycle_info.daily_rate,
    };
}
/**
 * Generate inflow periods for a given inflow and set of source periods.
 *
 * PURE function - no IO, no side effects.
 *
 * @param inflow - The inflow to generate periods for
 * @param source_periods - The source periods to generate inflow periods for
 * @param now - Current timestamp (injected for determinism)
 * @returns DomainResult with inflow periods or validation errors
 */
function compute_inflow_periods(inflow, source_periods, now) {
    // Validation
    if (!inflow.is_active) {
        return (0, types_1.validation_failed)(["Inflow is not active"]);
    }
    if (source_periods.length === 0) {
        return (0, types_1.validation_failed)(["No source periods provided"]);
    }
    if (!inflow.frequency) {
        return (0, types_1.validation_failed)(["Inflow is missing frequency"]);
    }
    // Calculate cycle info once
    const cycle_info = calculate_payment_cycle(inflow);
    // Generate periods
    const entities = [];
    for (const source_period of source_periods) {
        // Calculate occurrences for this period
        const occurrences = calculate_occurrences_in_period(inflow, source_period, cycle_info);
        // Calculate period amounts
        const period_amounts = calculate_period_amounts(source_period, cycle_info);
        // Determine first/last/next due dates
        const first_due_date = occurrences.number_of_occurrences > 0
            ? occurrences.occurrence_due_dates[0]
            : null;
        const last_due_date = occurrences.number_of_occurrences > 0
            ? occurrences.occurrence_due_dates[occurrences.number_of_occurrences - 1]
            : null;
        const next_unpaid_due_date = first_due_date; // All unpaid at creation
        // Initialize occurrence tracking arrays
        const occurrence_paid_flags = new Array(occurrences.number_of_occurrences).fill(false);
        const occurrence_transaction_ids = new Array(occurrences.number_of_occurrences).fill(null);
        const occurrence_amounts = new Array(occurrences.number_of_occurrences).fill(0);
        // Build the period entity
        const period = {
            // Identity
            id: `${inflow.id}_${source_period.id}`,
            inflow_id: inflow.id,
            source_period_id: source_period.id,
            // Ownership
            owner_id: inflow.owner_id,
            created_by: inflow.created_by,
            updated_by: inflow.created_by,
            group_id: inflow.group_id,
            group_ids: inflow.group_ids,
            // Plaid identifiers
            account_id: inflow.account_id,
            plaid_item_id: inflow.plaid_item_id,
            // Financial tracking
            actual_amount: null,
            amount_allocated: occurrences.amount_allocated,
            amount_withheld: period_amounts.amount_earned,
            average_amount: cycle_info.income_amount,
            expected_amount: occurrences.total_expected_amount,
            amount_per_occurrence: cycle_info.income_amount,
            total_amount_due: occurrences.total_expected_amount,
            total_amount_paid: 0,
            total_amount_unpaid: occurrences.total_expected_amount,
            // Timestamps
            created_at: now,
            updated_at: now,
            last_calculated: now,
            // Payment cycle info
            currency: inflow.currency,
            cycle_days: cycle_info.cycle_days,
            cycle_start_date: cycle_info.cycle_start_date,
            cycle_end_date: cycle_info.cycle_end_date,
            daily_withholding_rate: period_amounts.daily_rate,
            // Inflow metadata (denormalized)
            description: inflow.description,
            frequency: inflow.frequency,
            income_type: inflow.income_type,
            // Payment status (all unpaid at creation)
            is_paid: false,
            is_fully_paid: false,
            is_partially_paid: false,
            is_receipt_period: occurrences.number_of_occurrences > 0,
            // Categorization
            internal_detailed_category: inflow.internal_detailed_category,
            internal_primary_category: inflow.internal_primary_category,
            plaid_primary_category: inflow.plaid_primary_category,
            plaid_detailed_category: inflow.plaid_detailed_category,
            // Status & control
            is_active: true,
            is_hidden: inflow.is_hidden,
            // Merchant info
            merchant: inflow.payer_name,
            payee: inflow.payer_name,
            // Period context
            period_start_date: source_period.start_date,
            period_end_date: source_period.end_date,
            period_type: source_period.type,
            // Prediction
            predicted_next_date: occurrences.next_expected_date,
            // User interaction
            rules: inflow.rules,
            tags: inflow.tags,
            type: inflow.income_type || "income",
            note: null,
            user_custom_name: inflow.user_custom_name,
            // Source
            source: inflow.source,
            // Transaction tracking
            transaction_ids: [],
            // Multi-occurrence tracking
            number_of_occurrences_in_period: occurrences.number_of_occurrences,
            number_of_occurrences_paid: 0,
            number_of_occurrences_unpaid: occurrences.number_of_occurrences,
            occurrence_due_dates: occurrences.occurrence_due_dates,
            occurrence_paid_flags,
            occurrence_transaction_ids,
            occurrence_amounts,
            // Progress metrics
            payment_progress_percentage: 0,
            dollar_progress_percentage: 0,
            // Due date tracking
            first_due_date_in_period: first_due_date,
            last_due_date_in_period: last_due_date,
            next_unpaid_due_date,
        };
        entities.push(period);
    }
    return (0, types_1.success_many)(entities);
}
/**
 * Validate inflow periods before persistence.
 *
 * PURE function - performs final validation checks.
 *
 * @param entities - Inflow periods to validate
 * @returns DomainResult with validated entities or errors
 */
function validate_inflow_periods(entities) {
    const validation_errors = [];
    for (const entity of entities) {
        if (!entity.id) {
            validation_errors.push("Inflow period missing id");
        }
        if (!entity.inflow_id) {
            validation_errors.push(`Period ${entity.id}: missing inflow_id`);
        }
        if (!entity.source_period_id) {
            validation_errors.push(`Period ${entity.id}: missing source_period_id`);
        }
        if (!entity.owner_id) {
            validation_errors.push(`Period ${entity.id}: missing owner_id`);
        }
        if (entity.average_amount < 0) {
            validation_errors.push(`Period ${entity.id}: negative average_amount`);
        }
    }
    if (validation_errors.length > 0) {
        return (0, types_1.validation_failed)(validation_errors);
    }
    return (0, types_1.success_many)(entities);
}
//# sourceMappingURL=inflow_period.service.js.map