"use strict";
/**
 * User Summary Domain Service
 *
 * Pure functions for computing user period summaries.
 * NO I/O, NO await, NO repository imports.
 *
 * @module domain/summaries/user_summary
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.compute_user_period_summary = compute_user_period_summary;
exports.validate_user_period_summary = validate_user_period_summary;
const types_1 = require("../../types");
const types_2 = require("../../../types");
// ============================================================================
// PURE HELPER FUNCTIONS
// ============================================================================
/**
 * Calculate days until a date from a reference time.
 * PURE: Takes reference time as parameter.
 */
function calculate_days_until(date, now) {
    if (!date)
        return 0;
    const target_date = date.toDate();
    const diff_ms = target_date.getTime() - now.getTime();
    return Math.ceil(diff_ms / (1000 * 60 * 60 * 24));
}
/**
 * Determine confidence level based on income type and data quality.
 * PURE: No external dependencies.
 */
function determine_confidence_level(is_regular_salary, has_plaid_prediction) {
    if (is_regular_salary && has_plaid_prediction)
        return "high";
    if (is_regular_salary)
        return "high";
    if (has_plaid_prediction)
        return "medium";
    return "low";
}
// ============================================================================
// ENTRY COMPUTATION FUNCTIONS (PURE)
// ============================================================================
/**
 * Computes outflow entries from outflow periods.
 * PURE: No I/O, deterministic.
 */
function compute_outflow_entries(outflow_periods) {
    return outflow_periods.map((period) => {
        // Handle field name mismatch: Firestore uses merchantName, type uses merchant
        const raw_period = period;
        const merchant_value = raw_period.merchantName || period.merchant || "Unknown";
        return {
            // === IDENTITY ===
            outflowId: period.outflowId,
            outflowPeriodId: period.id,
            description: period.description || "Unknown",
            merchant: merchant_value,
            userCustomName: period.userCustomName || undefined,
            // === AMOUNTS ===
            totalAmountDue: period.totalAmountDue || 0,
            totalAmountPaid: period.totalAmountPaid || 0,
            totalAmountUnpaid: period.totalAmountUnpaid || 0,
            totalAmountWithheld: period.amountWithheld || 0,
            averageAmount: period.averageAmount || 0,
            // === STATUS ===
            isDuePeriod: period.isDuePeriod,
            duePeriodCount: period.isDuePeriod ? 1 : 0,
            dueDate: period.dueDate || period.predictedNextDate || undefined,
            status: period.status || types_2.OutflowPeriodStatus.PENDING,
            // === PERIOD-SPECIFIC DATES ===
            firstDueDateInPeriod: period.firstDueDateInPeriod || undefined,
            nextUnpaidDueDate: period.nextUnpaidDueDate || undefined,
            // === PROGRESS METRICS ===
            paymentProgressPercentage: period.paymentProgressPercentage || 0,
            fullyPaidCount: period.numberOfOccurrencesPaid || 0,
            unpaidCount: period.numberOfOccurrencesUnpaid || 0,
            itemCount: period.numberOfOccurrencesInPeriod || 1,
            // === GROUPING ===
            groupId: period.groupId || "",
        };
    });
}
/**
 * Computes budget entries from budget periods.
 * PURE: No I/O, deterministic.
 */
function compute_budget_entries(budget_periods) {
    return budget_periods.map((period) => {
        var _a, _b, _c;
        const allocated_amount = period.modifiedAmount || period.allocatedAmount;
        const spent_amount = period.spent || 0;
        const rolled_over_amount = period.rolledOverAmount || 0;
        const has_rollover = rolled_over_amount !== 0;
        const effective_amount = allocated_amount + rolled_over_amount;
        const remaining_amount = effective_amount - spent_amount;
        // Calculate checklist completion
        const checklist_items_count = ((_a = period.checklistItems) === null || _a === void 0 ? void 0 : _a.length) || 0;
        const checklist_items_completed = ((_b = period.checklistItems) === null || _b === void 0 ? void 0 : _b.filter((item) => item.isChecked).length) || 0;
        const checklist_progress_percentage = checklist_items_count > 0
            ? Math.round((checklist_items_completed / checklist_items_count) * 100)
            : 0;
        // Calculate progress percentage
        const progress_percentage = effective_amount > 0
            ? Math.round((spent_amount / effective_amount) * 100)
            : effective_amount < 0
                ? 100
                : 0;
        const is_over_budget = spent_amount > effective_amount;
        const overage_amount = is_over_budget ? spent_amount - effective_amount : undefined;
        return {
            // === IDENTITY ===
            budgetId: period.budgetId,
            budgetPeriodId: period.id || "",
            budgetName: period.budgetName || "Unnamed Budget",
            categoryId: "uncategorized",
            // === AMOUNTS ===
            maxAmount: allocated_amount,
            totalAllocated: allocated_amount,
            totalSpent: spent_amount,
            totalRemaining: remaining_amount,
            averageBudget: allocated_amount,
            // === ROLLOVER ===
            rolledOverAmount: has_rollover ? rolled_over_amount : undefined,
            effectiveAmount: has_rollover ? effective_amount : undefined,
            hasRollover: has_rollover || undefined,
            // === USER INPUT ===
            userNotes: period.userNotes,
            // === PROGRESS METRICS ===
            progressPercentage: progress_percentage,
            checklistItemsCount: checklist_items_count > 0 ? checklist_items_count : undefined,
            checklistItemsCompleted: checklist_items_count > 0 ? checklist_items_completed : undefined,
            checklistProgressPercentage: checklist_items_count > 0 ? checklist_progress_percentage : undefined,
            // === STATUS ===
            isOverBudget: is_over_budget,
            overageAmount: overage_amount,
            // === GROUPING ===
            groupId: ((_c = period.groupIds) === null || _c === void 0 ? void 0 : _c[0]) || "",
        };
    });
}
/**
 * Computes inflow entries from inflow periods.
 * PURE: No I/O, deterministic (now is passed as parameter).
 */
function compute_inflow_entries(inflow_periods, now) {
    return inflow_periods.map((period) => {
        var _a;
        const expected_amount = period.totalAmountDue || 0;
        const received_amount = period.totalAmountPaid || 0;
        const pending_amount = expected_amount - received_amount;
        // Determine if regular salary
        const plaid_category = ((_a = period.plaidDetailedCategory) === null || _a === void 0 ? void 0 : _a.toUpperCase()) || "";
        const is_regular_salary = period.isRegularSalary === true ||
            plaid_category.includes("WAGES") ||
            plaid_category.includes("SALARY");
        // Determine income type
        let income_type = period.incomeType || "other";
        if (!period.incomeType || period.incomeType === "other") {
            if (plaid_category.includes("WAGES") || plaid_category.includes("SALARY")) {
                income_type = "salary";
            }
            else if (plaid_category.includes("FREELANCE") ||
                plaid_category.includes("CONTRACT")) {
                income_type = "freelance";
            }
            else if (plaid_category.includes("INVESTMENT") ||
                plaid_category.includes("DIVIDEND")) {
                income_type = "investment";
            }
        }
        // Calculate progress percentages
        const occurrence_count = period.numberOfOccurrencesInPeriod || 0;
        const occurrences_paid = period.numberOfOccurrencesPaid || 0;
        const receipt_progress_percentage = occurrence_count > 0
            ? Math.round((occurrences_paid / occurrence_count) * 100)
            : 0;
        const dollar_progress_percentage = expected_amount > 0
            ? Math.round((received_amount / expected_amount) * 100)
            : 0;
        // Build prediction data
        let next_payment_prediction;
        const has_plaid_prediction = !!period.predictedNextDate;
        const next_date = period.nextUnpaidDueDate || period.predictedNextDate;
        if (next_date && !period.isFullyPaid) {
            next_payment_prediction = {
                expectedDate: next_date,
                expectedAmount: period.amountPerOccurrence || period.averageAmount || 0,
                confidenceLevel: determine_confidence_level(is_regular_salary, has_plaid_prediction),
                predictionMethod: has_plaid_prediction ? "plaid" : "frequency",
                daysUntilPayment: calculate_days_until(next_date, now),
            };
        }
        return {
            // === IDENTITY ===
            inflowId: period.inflowId,
            inflowPeriodId: period.id,
            description: period.description || "Unknown",
            source: period.merchant || period.payee || period.source || "Unknown",
            userCustomName: period.userCustomName || undefined,
            // === AMOUNTS ===
            totalExpected: expected_amount,
            totalReceived: received_amount,
            totalPending: pending_amount,
            averageAmount: period.averageAmount || 0,
            amountPerOccurrence: period.amountPerOccurrence || period.averageAmount || 0,
            amountAllocated: period.amountAllocated || 0,
            // === STATUS ===
            isReceiptPeriod: period.isReceiptPeriod,
            expectedDate: period.predictedNextDate || undefined,
            isRegularSalary: is_regular_salary,
            // === PROGRESS METRICS ===
            receiptProgressPercentage: receipt_progress_percentage,
            dollarProgressPercentage: dollar_progress_percentage,
            isFullyReceived: period.isFullyPaid || false,
            isPending: pending_amount > 0,
            // === OCCURRENCE TRACKING ===
            occurrenceCount: occurrence_count,
            occurrencesPaid: occurrences_paid,
            occurrenceDueDates: period.occurrenceDueDates || [],
            firstDueDateInPeriod: period.firstDueDateInPeriod || undefined,
            lastDueDateInPeriod: period.lastDueDateInPeriod || undefined,
            nextUnpaidDueDate: period.nextUnpaidDueDate || undefined,
            // === PREDICTION ===
            nextPaymentPrediction: next_payment_prediction,
            // === GROUPING ===
            groupId: period.groupId || "",
            // === INCOME TYPE ===
            incomeType: income_type,
        };
    });
}
/**
 * Computes goal entries (stub - goals not yet implemented).
 * PURE: Returns empty array.
 */
function compute_goal_entries() {
    return [];
}
// ============================================================================
// MAIN DOMAIN FUNCTIONS
// ============================================================================
/**
 * Computes a complete user period summary from resource periods.
 *
 * PURE FUNCTION: No I/O, deterministic, no side effects.
 *
 * @param input - Input containing all resource periods and context
 * @returns DomainResult with computed summary or validation errors
 */
function compute_user_period_summary(input) {
    // Validate input
    if (!input.user_id) {
        return (0, types_1.validation_failed)(["user_id is required"]);
    }
    if (!input.source_period) {
        return (0, types_1.validation_failed)(["source_period is required"]);
    }
    const { user_id, source_period, outflow_periods, budget_periods, inflow_periods, now } = input;
    // Normalize period type for document ID
    const normalized_period_type = source_period.type.toLowerCase();
    const summary_id = `${user_id}_${normalized_period_type}_${source_period.periodId}`;
    // Convert reference time for pure calculations
    const now_date = now.toDate();
    // Compute entries (all pure functions)
    const outflows = compute_outflow_entries(outflow_periods);
    const budgets = compute_budget_entries(budget_periods);
    const inflows = compute_inflow_entries(inflow_periods, now_date);
    const goals = compute_goal_entries();
    // Build the summary entity
    const entity = {
        // Identity
        id: summary_id,
        user_id,
        source_period_id: source_period.periodId,
        period_type: source_period.type,
        // Period context
        period_start_date: source_period.startDate,
        period_end_date: source_period.endDate,
        year: source_period.year,
        month: source_period.metadata.month,
        week_number: source_period.metadata.weekNumber,
        bi_monthly_half: source_period.metadata.biMonthlyHalf,
        // Resource entries
        outflows,
        budgets,
        inflows,
        goals,
        // Metadata
        last_recalculated: now,
        created_at: now,
        updated_at: now,
    };
    return (0, types_1.success)(entity);
}
/**
 * Validates a user period summary before persistence.
 *
 * PURE FUNCTION: No I/O, deterministic.
 *
 * @param entity - The summary to validate
 * @returns DomainResult with entity or validation errors
 */
function validate_user_period_summary(entity) {
    const errors = [];
    if (!entity.id) {
        errors.push("id is required");
    }
    if (!entity.user_id) {
        errors.push("user_id is required");
    }
    if (!entity.source_period_id) {
        errors.push("source_period_id is required");
    }
    if (!entity.period_type) {
        errors.push("period_type is required");
    }
    if (errors.length > 0) {
        return (0, types_1.validation_failed)(errors);
    }
    return (0, types_1.success)(entity);
}
//# sourceMappingURL=user_summary.service.js.map