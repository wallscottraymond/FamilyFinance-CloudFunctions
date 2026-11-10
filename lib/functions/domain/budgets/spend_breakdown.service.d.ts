/**
 * Spend Breakdown Domain Service
 *
 * The pieces behind the Budgets page "Easy to change" tips, built from the SAME counted splits as a
 * budget period's `spent` (accumulated inside `compute_budget_spent`'s loop, so they can't drift):
 * where the money went (places) and what bank fees it held (fees). No reads of its own: the place
 * and fee fields ride on each split from the transactions derive already loaded.
 *
 * PURE: no IO.
 *
 * @module domain/budgets/spend_breakdown
 */
/** A bank-fee split's kind (from its Plaid `BANK_FEES_*` code). */
export type FeeKind = "atm" | "late" | "overdraft" | "foreign" | "other";
/** A purchase under this (dollars) counts as a small one. */
export declare const SMALL_PURCHASE_LIMIT = 25;
/** Places kept per budget period (by total, desc). */
export declare const TOP_PLACES = 8;
export interface PlaceSpend {
    key: string;
    name: string;
    /** Purchases (splits that add spend). */
    count: number;
    /** Purchases under SMALL_PURCHASE_LIMIT. */
    small_count: number;
    /** Net spend there, to the cent. */
    total: number;
}
export interface FeeSpend {
    kind: FeeKind;
    count: number;
    total: number;
}
/** Whether a Plaid code is a bank fee (the BANK_FEES primary). PURE. */
export declare function is_bank_fee_code(code: string | null | undefined): boolean;
/** A `BANK_FEES_*` code → its kind; null for any other code. PURE. */
export declare function fee_kind_of(code: string | null | undefined): FeeKind | null;
/**
 * A split's fee kind from its resolved category. A user pick of the Bank Fees category without a
 * specific detail carries a REPRESENTATIVE code (any fee), so its kind comes from Plaid's own code
 * when that is a fee too, else "other". PURE.
 */
export declare function split_fee_kind(resolved: {
    semantic_code: string;
    category_source: "plaid" | "user";
    second_category_id: string | null;
}, plaid_detailed: string | null | undefined): FeeKind | null;
/** Accumulates places + fees over a period's counted splits (one `add` per counted split). */
export declare class SpendBreakdownAccumulator {
    private readonly places;
    private readonly fees;
    /** `signed` = the split's contribution to `spent` (negative for a credit that nets it down). */
    add(split: {
        vendor_key?: string | null;
        place_name?: string | null;
        fee_kind?: FeeKind | null;
    }, signed: number): void;
    /** Top places by total (positive totals only), ties by count then name. */
    top_places(limit?: number): PlaceSpend[];
    /** Fee kinds charged in the period (at least one fee), by total desc. */
    fee_list(): FeeSpend[];
}
//# sourceMappingURL=spend_breakdown.service.d.ts.map