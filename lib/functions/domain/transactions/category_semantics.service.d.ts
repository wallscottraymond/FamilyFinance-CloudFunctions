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
/**
 * Money moving between the user's own accounts (and to/from savings, investments,
 * withdrawals) is tagged by Plaid with a `TRANSFER_IN_*` / `TRANSFER_OUT_*`
 * detailed category — even though our `type` maps those to income/expense by
 * sign. Such splits are NOT spending: they never auto-assign to a budget and are
 * excluded from budget totals. PURE.
 */
export declare function is_transfer_category(category: string | null | undefined): boolean;
/** Plaid's code for a credit card payment. Both sides carry it: the debit leaving the paying
 *  account and the credit arriving on the card. */
export declare const CARD_PAYMENT_CATEGORY = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
/**
 * A card payment moves money, it isn't spending: the purchases on a linked card already count.
 * Decided per split, on read — see `map_raw_split_to_on_read_match` (Trustworthy-Numbers D1). PURE.
 */
export declare function is_card_payment_category(category: string | null | undefined): boolean;
/**
 * A Plaid `INCOME_*` detailed category = real income (salary, wages, dividends).
 * It belongs to the recurring-income (inflow) system, never a spending budget —
 * excluded even when it hasn't been routed to an inflow yet. PURE.
 */
export declare function is_income_category(category: string | null | undefined): boolean;
//# sourceMappingURL=category_semantics.service.d.ts.map