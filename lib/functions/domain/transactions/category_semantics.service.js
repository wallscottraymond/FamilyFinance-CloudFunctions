"use strict";
/**
 * Plaid personal-finance category semantics.
 *
 * Pure string predicates that classify a Plaid detailed category as an internal
 * TRANSFER or real INCOME. Shared by BOTH the assignment engine (routing, at
 * ingestion) and the budget spend calc (read-time), so a transfer/income is
 * treated identically everywhere — new transactions, webhook syncs, backfills,
 * and other accounts all route the same way.
 *
 * @module domain/transactions/category_semantics
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.CARD_PAYMENT_CATEGORY = void 0;
exports.is_transfer_category = is_transfer_category;
exports.is_card_payment_category = is_card_payment_category;
exports.is_income_category = is_income_category;
/**
 * Money moving between the user's own accounts (and to/from savings, investments,
 * withdrawals) is tagged by Plaid with a `TRANSFER_IN_*` / `TRANSFER_OUT_*`
 * detailed category — even though our `type` maps those to income/expense by
 * sign. Such splits are NOT spending: they never auto-assign to a budget and are
 * excluded from budget totals. PURE.
 */
function is_transfer_category(category) {
    if (!category)
        return false;
    return category.startsWith("TRANSFER_IN") || category.startsWith("TRANSFER_OUT");
}
/** Plaid's code for a credit card payment. Both sides carry it: the debit leaving the paying
 *  account and the credit arriving on the card. */
exports.CARD_PAYMENT_CATEGORY = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
/**
 * A card payment moves money, it isn't spending: the purchases on a linked card already count.
 * Decided per split, on read — see `map_raw_split_to_on_read_match` (Trustworthy-Numbers D1). PURE.
 */
function is_card_payment_category(category) {
    return category === exports.CARD_PAYMENT_CATEGORY;
}
/**
 * A Plaid `INCOME_*` detailed category = real income (salary, wages, dividends).
 * It belongs to the recurring-income (inflow) system, never a spending budget —
 * excluded even when it hasn't been routed to an inflow yet. PURE.
 */
function is_income_category(category) {
    if (!category)
        return false;
    return category.startsWith("INCOME");
}
//# sourceMappingURL=category_semantics.service.js.map