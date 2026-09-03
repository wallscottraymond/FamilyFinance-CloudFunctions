"use strict";
/**
 * Plaid Transformer
 *
 * PURE functions that convert Plaid data formats to domain formats.
 * NO async, NO IO, NO side effects.
 *
 * @module integrations/plaid/plaid_transformer
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.plaid_accounts_to_data = plaid_accounts_to_data;
exports.plaid_liabilities_to_domain = plaid_liabilities_to_domain;
exports.transform_plaid_accounts_to_domain = transform_plaid_accounts_to_domain;
exports.transform_plaid_balances_to_updates = transform_plaid_balances_to_updates;
exports.get_account_category = get_account_category;
/**
 * PURE: map raw Plaid SDK accounts to the domain-input shape. No IO.
 */
function plaid_accounts_to_data(accounts) {
    return accounts.map((account) => ({
        account_id: account.account_id,
        name: account.name,
        official_name: account.official_name,
        type: account.type,
        subtype: account.subtype,
        mask: account.mask,
        balances: {
            current: account.balances.current,
            available: account.balances.available,
            limit: account.balances.limit,
            iso_currency_code: account.balances.iso_currency_code,
        },
    }));
}
// ============================================================================
// Liabilities (Investments-And-Liabilities-Modeling)
// ============================================================================
/** PURE: ISO/`YYYY-MM-DD` date string → epoch ms (undefined if absent/invalid). */
function liability_date_to_ms(s) {
    if (!s)
        return undefined;
    const ms = new Date(s).getTime();
    return Number.isNaN(ms) ? undefined : ms;
}
/** PURE: nullable number → undefined-normalized number. */
function liability_num(n) {
    return n === null || n === undefined ? undefined : n;
}
/** PURE: map a Plaid address-ish object → our LiabilityAddress. */
function liability_address(a) {
    var _a, _b, _c, _d, _e;
    if (!a)
        return undefined;
    const out = {
        street: (_a = a.street) !== null && _a !== void 0 ? _a : undefined,
        city: (_b = a.city) !== null && _b !== void 0 ? _b : undefined,
        region: (_c = a.region) !== null && _c !== void 0 ? _c : undefined,
        postalCode: (_d = a.postal_code) !== null && _d !== void 0 ? _d : undefined,
        country: (_e = a.country) !== null && _e !== void 0 ? _e : undefined,
    };
    return Object.values(out).some((v) => v !== undefined) ? out : undefined;
}
/**
 * PURE: convert a raw Plaid `liabilities` object into our discriminated
 * `LiabilityDetail`s keyed by `account_id`. Credit / mortgage / student only —
 * un-enriched loan types simply don't appear (→ no `liability` on the account).
 * No IO, no side effects.
 */
function plaid_liabilities_to_domain(liabilities) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t;
    const out = {};
    if (!liabilities)
        return out;
    for (const c of (_a = liabilities.credit) !== null && _a !== void 0 ? _a : []) {
        if (!c.account_id)
            continue;
        const aprs = ((_b = c.aprs) !== null && _b !== void 0 ? _b : []).map((a) => ({
            type: String(a.apr_type),
            percentage: a.apr_percentage,
            balanceSubjectToApr: liability_num(a.balance_subject_to_apr),
            interestChargeAmount: liability_num(a.interest_charge_amount),
        }));
        out[c.account_id] = {
            kind: "credit",
            aprs,
            lastStatementBalance: liability_num(c.last_statement_balance),
            lastStatementIssueDateMs: liability_date_to_ms(c.last_statement_issue_date),
            minimumPaymentAmount: liability_num(c.minimum_payment_amount),
            nextPaymentDueDateMs: liability_date_to_ms(c.next_payment_due_date),
            lastPaymentAmount: liability_num(c.last_payment_amount),
            lastPaymentDateMs: liability_date_to_ms(c.last_payment_date),
            isOverdue: (_c = c.is_overdue) !== null && _c !== void 0 ? _c : undefined,
        };
    }
    for (const m of (_d = liabilities.mortgage) !== null && _d !== void 0 ? _d : []) {
        if (!m.account_id)
            continue;
        const past_due = liability_num(m.past_due_amount);
        out[m.account_id] = {
            kind: "mortgage",
            interestRatePercentage: liability_num((_e = m.interest_rate) === null || _e === void 0 ? void 0 : _e.percentage),
            interestRateType: (_g = (_f = m.interest_rate) === null || _f === void 0 ? void 0 : _f.type) !== null && _g !== void 0 ? _g : undefined,
            originationDateMs: liability_date_to_ms(m.origination_date),
            originationPrincipalAmount: liability_num(m.origination_principal_amount),
            maturityDateMs: liability_date_to_ms(m.maturity_date),
            loanTerm: (_h = m.loan_term) !== null && _h !== void 0 ? _h : undefined,
            nextMonthlyPayment: liability_num(m.next_monthly_payment),
            nextPaymentDueDateMs: liability_date_to_ms(m.next_payment_due_date),
            lastPaymentAmount: liability_num(m.last_payment_amount),
            lastPaymentDateMs: liability_date_to_ms(m.last_payment_date),
            escrowBalance: liability_num(m.escrow_balance),
            currentLateFee: liability_num(m.current_late_fee),
            pastDueAmount: past_due,
            hasPmi: (_j = m.has_pmi) !== null && _j !== void 0 ? _j : undefined,
            hasPrepaymentPenalty: (_k = m.has_prepayment_penalty) !== null && _k !== void 0 ? _k : undefined,
            propertyAddress: liability_address(m.property_address),
            ytdInterestPaid: liability_num(m.ytd_interest_paid),
            ytdPrincipalPaid: liability_num(m.ytd_principal_paid),
            // Mortgage has no `is_overdue` — derive it.
            isOverdue: past_due !== undefined ? past_due > 0 : undefined,
        };
    }
    for (const s of (_l = liabilities.student) !== null && _l !== void 0 ? _l : []) {
        if (!s.account_id)
            continue;
        out[s.account_id] = {
            kind: "student",
            loanName: (_m = s.loan_name) !== null && _m !== void 0 ? _m : undefined,
            interestRatePercentage: liability_num(s.interest_rate_percentage),
            minimumPaymentAmount: liability_num(s.minimum_payment_amount),
            nextPaymentDueDateMs: liability_date_to_ms(s.next_payment_due_date),
            lastPaymentAmount: liability_num(s.last_payment_amount),
            lastPaymentDateMs: liability_date_to_ms(s.last_payment_date),
            lastStatementBalance: liability_num(s.last_statement_balance),
            lastStatementIssueDateMs: liability_date_to_ms(s.last_statement_issue_date),
            originationDateMs: liability_date_to_ms(s.origination_date),
            originationPrincipalAmount: liability_num(s.origination_principal_amount),
            outstandingInterestAmount: liability_num(s.outstanding_interest_amount),
            expectedPayoffDateMs: liability_date_to_ms(s.expected_payoff_date),
            loanStatusType: ((_o = s.loan_status) === null || _o === void 0 ? void 0 : _o.type) ? String(s.loan_status.type) : undefined,
            repaymentPlanType: ((_p = s.repayment_plan) === null || _p === void 0 ? void 0 : _p.type) ? String(s.repayment_plan.type) : undefined,
            repaymentPlanDescription: (_r = (_q = s.repayment_plan) === null || _q === void 0 ? void 0 : _q.description) !== null && _r !== void 0 ? _r : undefined,
            pslfEstimatedEligibilityDateMs: liability_date_to_ms((_s = s.pslf_status) === null || _s === void 0 ? void 0 : _s.estimated_eligibility_date),
            servicerAddress: liability_address(s.servicer_address),
            ytdInterestPaid: liability_num(s.ytd_interest_paid),
            ytdPrincipalPaid: liability_num(s.ytd_principal_paid),
            isOverdue: (_t = s.is_overdue) !== null && _t !== void 0 ? _t : undefined,
        };
    }
    return out;
}
/**
 * Transforms Plaid accounts to domain entities.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param plaid_accounts - Raw accounts from Plaid API
 * @param context - Transformation context
 * @returns Domain result with entities or validation errors
 */
function transform_plaid_accounts_to_domain(plaid_accounts, context) {
    var _a, _b, _c, _d, _e, _f;
    const validation_errors = [];
    const entities = [];
    for (const plaid_account of plaid_accounts) {
        // Validate required fields
        if (!plaid_account.account_id) {
            validation_errors.push("Account missing account_id");
            continue;
        }
        if (!plaid_account.type) {
            validation_errors.push(`Account ${plaid_account.account_id} missing type`);
            continue;
        }
        // Transform to domain entity
        const entity = {
            // Identity
            id: plaid_account.account_id,
            user_id: context.user_id,
            group_ids: context.group_ids,
            is_active: true,
            is_deleted: false,
            created_at: context.now,
            updated_at: context.now,
            // Plaid identifiers
            account_id: plaid_account.account_id,
            item_id: context.item_id,
            // Account details
            name: plaid_account.name || "Unnamed Account",
            mask: (_a = plaid_account.mask) !== null && _a !== void 0 ? _a : undefined,
            official_name: (_b = plaid_account.official_name) !== null && _b !== void 0 ? _b : undefined,
            account_type: plaid_account.type,
            account_subtype: plaid_account.subtype || "other",
            // Balances
            balances: {
                current: (_c = plaid_account.balances.current) !== null && _c !== void 0 ? _c : 0,
                available: (_d = plaid_account.balances.available) !== null && _d !== void 0 ? _d : undefined,
                limit: (_e = plaid_account.balances.limit) !== null && _e !== void 0 ? _e : undefined,
                iso_currency_code: (_f = plaid_account.balances.iso_currency_code) !== null && _f !== void 0 ? _f : "USD",
                last_updated: context.now,
            },
            // Institution
            institution: {
                id: context.institution.institution_id,
                name: context.institution.name,
            },
            // Sync settings
            is_sync_enabled: true,
            last_synced_at: context.now,
            // Access control
            access: {
                owner_id: context.user_id,
                created_by: context.user_id,
                group_ids: context.group_ids,
                is_private: context.group_ids.length === 0,
            },
        };
        entities.push(entity);
    }
    if (validation_errors.length > 0) {
        return { entities, validation_errors };
    }
    return { entities };
}
/**
 * Transforms Plaid balance data to update existing accounts.
 *
 * PURE FUNCTION - no IO, deterministic.
 *
 * @param plaid_accounts - Accounts with fresh balances from Plaid
 * @param now - Current timestamp
 * @returns Map of account_id to balance updates
 */
function transform_plaid_balances_to_updates(plaid_accounts, now) {
    var _a, _b, _c;
    const updates = new Map();
    for (const plaid_account of plaid_accounts) {
        if (!plaid_account.account_id)
            continue;
        updates.set(plaid_account.account_id, {
            current: (_a = plaid_account.balances.current) !== null && _a !== void 0 ? _a : 0,
            available: (_b = plaid_account.balances.available) !== null && _b !== void 0 ? _b : undefined,
            limit: (_c = plaid_account.balances.limit) !== null && _c !== void 0 ? _c : undefined,
        });
    }
    return updates;
}
/**
 * Maps Plaid account type to display-friendly category.
 *
 * PURE FUNCTION.
 */
function get_account_category(account_type, account_subtype) {
    const type_lower = account_type.toLowerCase();
    const subtype_lower = (account_subtype === null || account_subtype === void 0 ? void 0 : account_subtype.toLowerCase()) || "";
    if (type_lower === "depository") {
        if (subtype_lower === "checking")
            return "checking";
        if (subtype_lower === "savings")
            return "savings";
        return "bank";
    }
    if (type_lower === "credit") {
        return "credit_card";
    }
    if (type_lower === "loan") {
        if (subtype_lower === "mortgage")
            return "mortgage";
        if (subtype_lower === "auto")
            return "auto_loan";
        if (subtype_lower === "student")
            return "student_loan";
        return "loan";
    }
    if (type_lower === "investment") {
        if (subtype_lower === "401k" || subtype_lower === "401a")
            return "retirement";
        if (subtype_lower === "ira" || subtype_lower === "roth")
            return "retirement";
        return "investment";
    }
    return "other";
}
//# sourceMappingURL=plaid_transformer.js.map