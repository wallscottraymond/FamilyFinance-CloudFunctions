"use strict";
/**
 * Plaid Transaction Transformer
 *
 * PURE functions that convert Plaid transaction data to domain formats.
 * NO async, NO IO, NO side effects.
 *
 * @module integrations/plaid/plaid_transaction_transformer
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.transform_plaid_transactions_to_domain = transform_plaid_transactions_to_domain;
exports.identify_pending_migrations = identify_pending_migrations;
exports.extract_removed_transaction_ids = extract_removed_transaction_ids;
exports.has_material_changes = has_material_changes;
exports.get_changed_fields = get_changed_fields;
exports.map_plaid_category_to_internal = map_plaid_category_to_internal;
// ============================================================================
// Transform Functions (PURE)
// ============================================================================
/**
 * Transforms Plaid transactions to domain entities.
 *
 * PURE FUNCTION - no IO, deterministic.
 * Does NOT add timestamps - repository handles that.
 *
 * @param plaid_transactions - Raw transactions from Plaid /transactions/sync added array
 * @param context - Transformation context
 * @returns Domain result with entities or validation errors
 */
function transform_plaid_transactions_to_domain(plaid_transactions, context) {
    var _a, _b, _c, _d, _e;
    const validation_errors = [];
    const entities = [];
    for (const plaid_txn of plaid_transactions) {
        // Validate required fields
        if (!plaid_txn.transaction_id) {
            validation_errors.push("Transaction missing transaction_id");
            continue;
        }
        if (!plaid_txn.account_id) {
            validation_errors.push(`Transaction ${plaid_txn.transaction_id} missing account_id`);
            continue;
        }
        // Determine transaction type based on amount
        // Plaid: positive = money out (expense), negative = money in (income)
        const amount = (_a = plaid_txn.amount) !== null && _a !== void 0 ? _a : 0;
        const type = determine_transaction_type(amount);
        // Extract categories
        const plaid_primary = ((_b = plaid_txn.personal_finance_category) === null || _b === void 0 ? void 0 : _b.primary) || "OTHER";
        const plaid_detailed = ((_c = plaid_txn.personal_finance_category) === null || _c === void 0 ? void 0 : _c.detailed) || "OTHER_OTHER";
        // Create default split (entire transaction amount)
        const default_split = create_default_split(plaid_txn.transaction_id, Math.abs(amount), plaid_txn.date, plaid_primary, plaid_detailed);
        // Transform to domain entity
        const entity = {
            // No id - repo will assign if new
            transaction_id: plaid_txn.transaction_id,
            user_id: context.user_id,
            group_ids: context.group_ids,
            is_active: true,
            // Plaid references
            plaid_item_id: context.plaid_item_id,
            account_id: plaid_txn.account_id,
            // Transaction details
            amount: Math.abs(amount), // Store as positive
            currency: plaid_txn.iso_currency_code || context.currency,
            transaction_date: new Date(plaid_txn.date),
            name: plaid_txn.name || "Unknown Transaction",
            merchant_name: plaid_txn.merchant_name || null,
            // Status
            is_pending: (_d = plaid_txn.pending) !== null && _d !== void 0 ? _d : false,
            pending_transaction_id: plaid_txn.pending_transaction_id || null,
            type,
            source: "plaid",
            // Categories
            plaid_primary_category: plaid_primary,
            plaid_detailed_category: plaid_detailed,
            internal_primary_category: null, // Will be set by category matching
            internal_detailed_category: null,
            // Default split
            splits: [default_split],
            // Preserve initial Plaid data
            initial_plaid_data: {
                plaid_account_id: plaid_txn.account_id,
                plaid_merchant_name: plaid_txn.merchant_name || null,
                plaid_name: plaid_txn.name || "",
                plaid_transaction_id: plaid_txn.transaction_id,
                plaid_pending: (_e = plaid_txn.pending) !== null && _e !== void 0 ? _e : false,
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
 * Identifies transactions that need pending->posted migration.
 *
 * When a pending transaction posts, Plaid:
 * 1. Adds it to the 'removed' array (old pending ID)
 * 2. Adds a NEW transaction to 'added' with a new ID
 * 3. The new transaction has pending_transaction_id pointing to the old ID
 *
 * PURE FUNCTION - no IO.
 *
 * @param added_transactions - Added transactions from Plaid sync
 * @param pending_lookup - Map of plaid_transaction_id -> our pending transaction info
 * @returns List of migrations to perform
 */
function identify_pending_migrations(added_transactions, pending_lookup) {
    var _a;
    const migrations = [];
    for (const plaid_txn of added_transactions) {
        // Check if this posted transaction links to a pending we have
        if (!plaid_txn.pending_transaction_id) {
            continue;
        }
        const pending = pending_lookup.get(plaid_txn.pending_transaction_id);
        if (!pending) {
            // We don't have the pending transaction - might have been deleted or never synced
            // This is not an error, just means we can't migrate user modifications
            continue;
        }
        const new_amount = Math.abs((_a = plaid_txn.amount) !== null && _a !== void 0 ? _a : 0);
        const old_amount = pending.amount;
        const amount_changed = Math.abs(new_amount - old_amount) > 0.01;
        migrations.push({
            posted_plaid_transaction_id: plaid_txn.transaction_id,
            pending_plaid_transaction_id: plaid_txn.pending_transaction_id,
            pending_transaction: pending,
            amount_changed,
            old_amount,
            new_amount,
        });
    }
    return migrations;
}
/**
 * Extracts transaction IDs from Plaid's removed array.
 *
 * PURE FUNCTION.
 *
 * @param removed - Removed transactions from Plaid sync
 * @returns Array of transaction IDs to soft-delete
 */
function extract_removed_transaction_ids(removed) {
    return removed
        .filter(r => r.transaction_id)
        .map(r => r.transaction_id);
}
/**
 * Checks if a transaction was materially modified.
 *
 * Material changes require re-running the formatting pipeline:
 * - Amount changed (more than $0.01)
 * - Date changed
 * - Pending status changed
 * - Category changed
 *
 * PURE FUNCTION.
 *
 * @param plaid_txn - Modified transaction from Plaid
 * @param existing - Our stored transaction data
 * @returns Whether material changes exist
 */
function has_material_changes(plaid_txn, existing) {
    var _a, _b, _c, _d;
    // Amount change
    const new_amount = Math.abs((_a = plaid_txn.amount) !== null && _a !== void 0 ? _a : 0);
    if (Math.abs(new_amount - existing.amount) > 0.01) {
        return true;
    }
    // Date change
    const new_date = new Date(plaid_txn.date);
    if (new_date.getTime() !== existing.transaction_date.getTime()) {
        return true;
    }
    // Pending status change
    const new_pending = (_b = plaid_txn.pending) !== null && _b !== void 0 ? _b : false;
    if (new_pending !== existing.is_pending) {
        return true;
    }
    // Category change
    const new_primary = ((_c = plaid_txn.personal_finance_category) === null || _c === void 0 ? void 0 : _c.primary) || "OTHER";
    const new_detailed = ((_d = plaid_txn.personal_finance_category) === null || _d === void 0 ? void 0 : _d.detailed) || "OTHER_OTHER";
    if (new_primary !== existing.plaid_primary_category ||
        new_detailed !== existing.plaid_detailed_category) {
        return true;
    }
    return false;
}
/**
 * Determines which fields changed in a modified transaction.
 *
 * PURE FUNCTION.
 */
function get_changed_fields(plaid_txn, existing) {
    var _a, _b, _c;
    const changed = [];
    const new_amount = Math.abs((_a = plaid_txn.amount) !== null && _a !== void 0 ? _a : 0);
    if (Math.abs(new_amount - existing.amount) > 0.01) {
        changed.push("amount");
    }
    const new_date = new Date(plaid_txn.date);
    if (new_date.getTime() !== existing.transaction_date.getTime()) {
        changed.push("date");
    }
    const new_pending = (_b = plaid_txn.pending) !== null && _b !== void 0 ? _b : false;
    if (new_pending !== existing.is_pending) {
        changed.push("pending");
    }
    const new_primary = ((_c = plaid_txn.personal_finance_category) === null || _c === void 0 ? void 0 : _c.primary) || "OTHER";
    if (new_primary !== existing.plaid_primary_category) {
        changed.push("category");
    }
    return changed;
}
// ============================================================================
// Helper Functions (PURE)
// ============================================================================
/**
 * Determines transaction type from Plaid amount.
 *
 * Plaid convention:
 * - Positive amount = money leaving account (expense)
 * - Negative amount = money entering account (income)
 *
 * PURE FUNCTION.
 */
function determine_transaction_type(amount) {
    if (amount < 0) {
        return "income";
    }
    return "expense";
}
/**
 * Creates a default split for a transaction.
 *
 * PURE FUNCTION - no timestamps (payment_date uses transaction date).
 */
function create_default_split(transaction_id, amount, date_string, plaid_primary, plaid_detailed) {
    return {
        split_id: `${transaction_id}_default`,
        amount,
        budget_id: "unassigned", // Will be set by budget matching
        outflow_id: null,
        monthly_period_id: null, // Will be set by period matching
        weekly_period_id: null,
        bi_weekly_period_id: null,
        plaid_primary_category: plaid_primary,
        plaid_detailed_category: plaid_detailed,
        internal_primary_category: null,
        internal_detailed_category: null,
        is_default: true,
        is_ignored: false,
        is_refund: false,
        is_tax_deductible: false,
        payment_date: new Date(date_string),
        tags: [],
        rules: [],
    };
}
/**
 * Maps Plaid category to internal category.
 *
 * PURE FUNCTION.
 *
 * This provides basic category mapping. The full category matching
 * is done by the existing matchCategoriesToTransactions utility.
 */
function map_plaid_category_to_internal(plaid_primary, plaid_detailed) {
    // Basic mapping - returns null to let existing category matcher handle it
    // This is a passthrough as the existing matchCategoriesToTransactions
    // utility does sophisticated merchant/keyword matching
    return {
        primary: null,
        detailed: null,
    };
}
//# sourceMappingURL=plaid_transaction_transformer.js.map