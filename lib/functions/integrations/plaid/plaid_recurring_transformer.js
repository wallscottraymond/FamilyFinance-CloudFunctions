"use strict";
/**
 * Plaid Recurring Transaction Transformer
 *
 * PURE functions that convert Plaid recurring transaction streams to domain formats.
 * NO async, NO IO, NO side effects.
 *
 * @module integrations/plaid/plaid_recurring_transformer
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.map_plaid_frequency_to_app = map_plaid_frequency_to_app;
exports.transform_inflow_streams = transform_inflow_streams;
exports.transform_outflow_streams = transform_outflow_streams;
exports.calculate_next_due_date = calculate_next_due_date;
// ============================================================================
// Frequency Mapping (PURE)
// ============================================================================
/**
 * Maps Plaid recurring frequency to app frequency.
 *
 * PURE FUNCTION.
 *
 * @param plaid_frequency - Plaid frequency enum value
 * @returns App frequency string
 */
function map_plaid_frequency_to_app(plaid_frequency) {
    const freq = String(plaid_frequency).toUpperCase();
    switch (freq) {
        case "WEEKLY":
            return "weekly";
        case "BIWEEKLY":
            return "biweekly";
        case "SEMI_MONTHLY":
            return "semimonthly";
        case "MONTHLY":
            return "monthly";
        case "ANNUALLY":
            return "yearly";
        case "UNKNOWN":
        default:
            return "monthly"; // Default to monthly for unknown
    }
}
// ============================================================================
// Inflow Transform (PURE)
// ============================================================================
/**
 * Transforms Plaid inflow streams (income) to domain entities.
 *
 * PURE FUNCTION - no IO, deterministic.
 * Does NOT add timestamps - repository handles that.
 *
 * @param inflow_streams - Raw inflow streams from Plaid RecurringTransactionsGetResponse
 * @param context - Transformation context
 * @returns Domain result with entities or validation errors
 */
function transform_inflow_streams(inflow_streams, context) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
    const validation_errors = [];
    const entities = [];
    for (const stream of inflow_streams) {
        // Validate required fields
        if (!stream.stream_id) {
            validation_errors.push("Inflow stream missing stream_id");
            continue;
        }
        if (!stream.account_id) {
            validation_errors.push(`Inflow stream ${stream.stream_id} missing account_id`);
            continue;
        }
        // Extract amounts (inflows are negative in Plaid, we store as positive)
        const last_amount = Math.abs((_b = (_a = stream.last_amount) === null || _a === void 0 ? void 0 : _a.amount) !== null && _b !== void 0 ? _b : 0);
        const average_amount = Math.abs((_d = (_c = stream.average_amount) === null || _c === void 0 ? void 0 : _c.amount) !== null && _d !== void 0 ? _d : 0);
        // Calculate min/max from available data (simplified - real calculation would use transaction history)
        const amount_min = Math.min(last_amount, average_amount);
        const amount_max = Math.max(last_amount, average_amount);
        // Determine if it's variable income (difference > 10%)
        const variance = average_amount > 0
            ? Math.abs(last_amount - average_amount) / average_amount
            : 0;
        const is_variable = variance > 0.1;
        // Extract categories
        const plaid_primary = (_f = (_e = stream.personal_finance_category) === null || _e === void 0 ? void 0 : _e.primary) !== null && _f !== void 0 ? _f : "INCOME";
        const plaid_detailed = (_h = (_g = stream.personal_finance_category) === null || _g === void 0 ? void 0 : _g.detailed) !== null && _h !== void 0 ? _h : "INCOME_OTHER";
        // Classify income type
        const income_type = classify_income_type(plaid_detailed);
        const is_regular_salary = plaid_detailed === "INCOME_WAGES";
        // Determine status - new Plaid items start as pending_review
        const status = "pending_review";
        const entity = {
            // Identity
            id: stream.stream_id,
            // Ownership
            owner_id: context.user_id,
            created_by: context.user_id,
            updated_by: context.user_id,
            group_ids: context.group_ids,
            // Plaid references
            plaid_item_id: context.plaid_item_id,
            plaid_stream_id: stream.stream_id,
            account_id: stream.account_id,
            // Financial data
            last_amount,
            average_amount,
            amount_min,
            amount_max,
            currency: (_k = (_j = stream.average_amount) === null || _j === void 0 ? void 0 : _j.iso_currency_code) !== null && _k !== void 0 ? _k : "USD",
            // Description
            description: (_l = stream.description) !== null && _l !== void 0 ? _l : null,
            payer_name: (_m = stream.merchant_name) !== null && _m !== void 0 ? _m : null,
            user_custom_name: null,
            // Timing
            frequency: map_plaid_frequency_to_app(stream.frequency),
            first_date: new Date(stream.first_date),
            last_date: new Date(stream.last_date),
            predicted_next_date: stream.predicted_next_date
                ? new Date(stream.predicted_next_date)
                : null,
            // Categories
            plaid_primary_category: plaid_primary,
            plaid_detailed_category: plaid_detailed,
            internal_primary_category: null,
            internal_detailed_category: null,
            // Classification
            income_type,
            is_regular_salary,
            is_variable,
            // Status
            status,
            source: "plaid",
            plaid_status: (_o = stream.status) !== null && _o !== void 0 ? _o : "UNKNOWN",
            plaid_confidence_level: (_q = (_p = stream.personal_finance_category) === null || _p === void 0 ? void 0 : _p.confidence_level) !== null && _q !== void 0 ? _q : null,
            is_active: (_r = stream.is_active) !== null && _r !== void 0 ? _r : true,
            is_hidden: false,
            is_user_modified: (_s = stream.is_user_modified) !== null && _s !== void 0 ? _s : false,
            // References
            transaction_ids: (_t = stream.transaction_ids) !== null && _t !== void 0 ? _t : [],
            tags: [],
            rules: [],
        };
        entities.push(entity);
    }
    if (validation_errors.length > 0) {
        return { entities, validation_errors };
    }
    return { entities };
}
// ============================================================================
// Outflow Transform (PURE)
// ============================================================================
/**
 * Transforms Plaid outflow streams (expenses) to domain entities.
 *
 * PURE FUNCTION - no IO, deterministic.
 * Does NOT add timestamps - repository handles that.
 *
 * @param outflow_streams - Raw outflow streams from Plaid RecurringTransactionsGetResponse
 * @param context - Transformation context
 * @returns Domain result with entities or validation errors
 */
function transform_outflow_streams(outflow_streams, context) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
    const validation_errors = [];
    const entities = [];
    for (const stream of outflow_streams) {
        // Validate required fields
        if (!stream.stream_id) {
            validation_errors.push("Outflow stream missing stream_id");
            continue;
        }
        if (!stream.account_id) {
            validation_errors.push(`Outflow stream ${stream.stream_id} missing account_id`);
            continue;
        }
        // Extract amounts (outflows are positive in Plaid, store as positive)
        const last_amount = Math.abs((_b = (_a = stream.last_amount) === null || _a === void 0 ? void 0 : _a.amount) !== null && _b !== void 0 ? _b : 0);
        const average_amount = Math.abs((_d = (_c = stream.average_amount) === null || _c === void 0 ? void 0 : _c.amount) !== null && _d !== void 0 ? _d : 0);
        // Calculate min/max from available data
        const amount_min = Math.min(last_amount, average_amount);
        const amount_max = Math.max(last_amount, average_amount);
        // Extract categories
        const plaid_primary = (_f = (_e = stream.personal_finance_category) === null || _e === void 0 ? void 0 : _e.primary) !== null && _f !== void 0 ? _f : "GENERAL_SERVICES";
        const plaid_detailed = (_h = (_g = stream.personal_finance_category) === null || _g === void 0 ? void 0 : _g.detailed) !== null && _h !== void 0 ? _h : "GENERAL_SERVICES_OTHER";
        // Classify expense type and essentiality
        const expense_type = classify_expense_type(plaid_detailed, stream.frequency);
        const is_essential = is_essential_expense(plaid_primary, plaid_detailed);
        // Determine status - new Plaid items start as pending_review
        const status = "pending_review";
        const entity = {
            // Identity
            id: stream.stream_id,
            // Ownership
            owner_id: context.user_id,
            created_by: context.user_id,
            updated_by: context.user_id,
            group_ids: context.group_ids,
            // Plaid references
            plaid_item_id: context.plaid_item_id,
            plaid_stream_id: stream.stream_id,
            account_id: stream.account_id,
            // Financial data
            last_amount,
            average_amount,
            amount_min,
            amount_max,
            currency: (_k = (_j = stream.average_amount) === null || _j === void 0 ? void 0 : _j.iso_currency_code) !== null && _k !== void 0 ? _k : "USD",
            // Description
            description: (_l = stream.description) !== null && _l !== void 0 ? _l : null,
            merchant_name: (_m = stream.merchant_name) !== null && _m !== void 0 ? _m : null,
            user_custom_name: null,
            // Timing
            frequency: map_plaid_frequency_to_app(stream.frequency),
            first_date: new Date(stream.first_date),
            last_date: new Date(stream.last_date),
            predicted_next_date: stream.predicted_next_date
                ? new Date(stream.predicted_next_date)
                : null,
            // Categories
            plaid_primary_category: plaid_primary,
            plaid_detailed_category: plaid_detailed,
            internal_primary_category: null,
            internal_detailed_category: null,
            // Classification
            expense_type,
            is_essential,
            // Status
            status,
            source: "plaid",
            plaid_status: (_o = stream.status) !== null && _o !== void 0 ? _o : "UNKNOWN",
            plaid_confidence_level: (_q = (_p = stream.personal_finance_category) === null || _p === void 0 ? void 0 : _p.confidence_level) !== null && _q !== void 0 ? _q : null,
            is_active: (_r = stream.is_active) !== null && _r !== void 0 ? _r : true,
            is_hidden: false,
            is_user_modified: (_s = stream.is_user_modified) !== null && _s !== void 0 ? _s : false,
            // References
            transaction_ids: (_t = stream.transaction_ids) !== null && _t !== void 0 ? _t : [],
            tags: [],
            rules: [],
        };
        entities.push(entity);
    }
    if (validation_errors.length > 0) {
        return { entities, validation_errors };
    }
    return { entities };
}
// ============================================================================
// Helper Functions (PURE)
// ============================================================================
/**
 * Classifies income type from Plaid detailed category.
 *
 * PURE FUNCTION.
 */
function classify_income_type(plaid_detailed) {
    const detailed = plaid_detailed.toUpperCase();
    if (detailed.includes("WAGES") || detailed.includes("SALARY")) {
        return "salary";
    }
    if (detailed.includes("DIVIDENDS") || detailed.includes("INTEREST")) {
        return "investment";
    }
    if (detailed.includes("RENTAL")) {
        return "rental";
    }
    if (detailed.includes("RETIREMENT") || detailed.includes("PENSION")) {
        return "pension";
    }
    if (detailed.includes("GOVERNMENT") || detailed.includes("TAX_REFUND")) {
        return "government";
    }
    if (detailed.includes("FREELANCE") || detailed.includes("CONTRACT")) {
        return "freelance";
    }
    return "other";
}
/**
 * Classifies expense type from Plaid detailed category.
 *
 * PURE FUNCTION.
 */
function classify_expense_type(plaid_detailed, frequency) {
    const detailed = plaid_detailed.toUpperCase();
    if (detailed.includes("UTILITIES") ||
        detailed.includes("ELECTRIC") ||
        detailed.includes("GAS") ||
        detailed.includes("WATER")) {
        return "utility";
    }
    if (detailed.includes("RENT") || detailed.includes("MORTGAGE")) {
        return "rent";
    }
    if (detailed.includes("INSURANCE")) {
        return "insurance";
    }
    if (detailed.includes("LOAN") || detailed.includes("CREDIT_CARD_PAYMENT")) {
        return "loan";
    }
    if (detailed.includes("TAX")) {
        return "tax";
    }
    // Default to subscription for monthly/annual recurring
    const freq = String(frequency).toUpperCase();
    if (freq === "MONTHLY" || freq === "ANNUALLY") {
        return "subscription";
    }
    return "other";
}
/**
 * Determines if expense is essential based on Plaid categories.
 *
 * PURE FUNCTION.
 */
function is_essential_expense(plaid_primary, plaid_detailed) {
    const primary = plaid_primary.toUpperCase();
    const detailed = plaid_detailed.toUpperCase();
    const essential_keywords = [
        "RENT",
        "MORTGAGE",
        "UTILITIES",
        "ELECTRIC",
        "GAS",
        "WATER",
        "INSURANCE",
        "LOAN",
        "HEALTHCARE",
        "MEDICAL",
        "PHARMACY",
        "GROCERIES",
    ];
    return essential_keywords.some((keyword) => primary.includes(keyword) || detailed.includes(keyword));
}
/**
 * Calculates next due date based on last date and frequency.
 *
 * PURE FUNCTION.
 *
 * @param last_date - Last occurrence date
 * @param frequency - App frequency
 * @returns Next predicted due date
 */
function calculate_next_due_date(last_date, frequency) {
    const next = new Date(last_date);
    switch (frequency) {
        case "weekly":
            next.setDate(next.getDate() + 7);
            break;
        case "biweekly":
            next.setDate(next.getDate() + 14);
            break;
        case "semimonthly":
            next.setDate(next.getDate() + 15);
            break;
        case "monthly":
            next.setMonth(next.getMonth() + 1);
            break;
        case "yearly":
            next.setFullYear(next.getFullYear() + 1);
            break;
        case "unknown":
        default:
            next.setMonth(next.getMonth() + 1);
            break;
    }
    return next;
}
//# sourceMappingURL=plaid_recurring_transformer.js.map