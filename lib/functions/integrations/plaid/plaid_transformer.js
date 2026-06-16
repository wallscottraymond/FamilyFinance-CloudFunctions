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