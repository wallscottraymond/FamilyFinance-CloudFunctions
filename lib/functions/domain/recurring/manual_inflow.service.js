"use strict";
/**
 * Add Income on the new path (Convert-To-Recurring D43) — PURE.
 *
 * Builds a hand-added income through the same builder convert uses (v2 stamp, source manual, the
 * account + vendor key only when they come from a real transaction), and carries every setting the
 * Add Income form collects — income type, variability, hourly / commission / bonus / variable
 * config, `isUserClassified`, `isPrivate` — exactly as the legacy callable wrote them.
 *
 * @module domain/recurring/manual_inflow
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.to_convert_frequency = to_convert_frequency;
exports.build_manual_inflow = build_manual_inflow;
const convert_recurring_service_1 = require("./convert_recurring.service");
const frequency_1 = require("./frequency");
/** The form's frequency spelling (Plaid-style or lowercase) → a supported schedule; null = unknown. */
function to_convert_frequency(raw) {
    switch ((0, frequency_1.normalize_frequency)(raw)) {
        case "WEEKLY": return "weekly";
        case "BIWEEKLY": return "biweekly";
        case "SEMIMONTHLY": return "semimonthly";
        case "MONTHLY": return "monthly";
        case "QUARTERLY": return "quarterly";
        case "ANNUALLY": return "yearly";
        default: return null;
    }
}
function build_manual_inflow(req) {
    var _a, _b, _c, _d, _e;
    const day = (0, convert_recurring_service_1.utc_day_start)(req.first_expected_ms);
    const built = (0, convert_recurring_service_1.build_converted_recurring)({
        id: req.id, direction: "inflow", user_id: req.user_id, name: req.name, amount: req.amount, frequency: req.frequency,
        next_due_ms: req.first_expected_ms, first_date_ms: req.first_expected_ms, account_id: req.account_id,
        vendor_key: req.vendor_key, merchant_source: req.name, converted_from_txn_id: null, now_ms: req.now_ms,
        plaid_primary_category: "INCOME", plaid_detailed_category: "INCOME_OTHER",
        expected_amount_override: null, // hand-added income carries no override (as before)
        description: (_a = req.description) !== null && _a !== void 0 ? _a : req.name,
        is_user_modified: false,
        income_type: req.income_type,
        is_regular_salary: req.is_regular_salary,
        income_extras: {
            isPrivate: true,
            incomeVariability: req.income_variability,
            isUserClassified: true,
            hourlyConfig: (_b = req.hourly_config) !== null && _b !== void 0 ? _b : null,
            commissionConfig: (_c = req.commission_config) !== null && _c !== void 0 ? _c : null,
            bonusConfig: (_d = req.bonus_config) !== null && _d !== void 0 ? _d : null,
            variableConfig: (_e = req.variable_config) !== null && _e !== void 0 ? _e : null,
            plaidCategoryId: null,
            unofficialCurrency: null,
        },
    });
    void day;
    return built.errors ? { errors: built.errors } : { inflow: built.inflow };
}
//# sourceMappingURL=manual_inflow.service.js.map