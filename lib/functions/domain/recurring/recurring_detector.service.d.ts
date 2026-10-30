/**
 * "Possible bill" detector (Convert-To-Recurring D11 / D17 / X12 / X14 / X17) — PURE.
 *
 * Finds payments Plaid never made a bill from (Avant: irregular amounts and dates) in the
 * transactions the transfer classifier already loaded (~180 days — X12: no extra transaction read),
 * and proposes ONE `suggested` item per (direction, vendor) — the same subject a Plaid suggestion
 * uses, so a vendor never gets two tiles (X14).
 *
 * Only transactions NOT already accounted for: not in any bill / income stream (active, hidden or
 * inactive), not held out (a Plaid suggestion or a "Not a bill"), not linked to a bill / income by a
 * split, not an internal transfer or edge money, posted, the user's own.
 *
 * Gates:
 *   - rhythm: ≥ 3 payments, average gap ≥ 6 days, and the gaps fit ONE schedule — weekly,
 *     every 2 weeks, twice a month or monthly (no quarterly / yearly in Phase 1: too few samples
 *     in ~180 days, and yearly comes from Plaid or the convert button — D17); still going (the last
 *     payment within two cycles of now);
 *   - category: bills = clearly bill-like (rent & utilities, loans, insurance, medical, government);
 *     entertainment, personal care, transportation, food, shopping, travel and person-to-person
 *     transfers are skipped (D17). Income = `INCOME_*` only, never on a credit / loan account (X17);
 *   - memory: a vendor the user said "Not a bill" about is never suggested (D11); a vendor that
 *     already has a bill / income record isn't either; an item the user already answered, or a
 *     Plaid-sourced open item, is left alone (one tile per vendor).
 *
 * @module domain/recurring/recurring_detector
 */
import { RecurringReviewState, ReviewDirection, ReviewItem } from "./review_item.service";
/** At most this many of the most recent transactions are considered (bound; logged when hit). */
export declare const DETECTOR_TXN_CAP = 5000;
export declare const MIN_PAYMENTS = 3;
export declare const MIN_AVG_GAP_DAYS = 6;
/** A schedule the detector may propose: nominal gap + accepted gap band (days). */
export declare const DETECTOR_CADENCES: Array<{
    frequency: string;
    nominal: number;
    min: number;
    max: number;
}>;
/** Bill-like category (D11 / D17). */
export declare function is_bill_like_category(detailed: string | null | undefined): boolean;
/** Income category for the income side (X17). */
export declare function is_income_category(detailed: string | null | undefined): boolean;
/** The schedule a sorted list of payment dates fits, or null (all gaps in one band). PURE. */
export declare function fit_cadence(dates_ms: number[]): (typeof DETECTOR_CADENCES)[number] | null;
export interface DetectorTxn {
    id: string;
    data: Record<string, unknown>;
}
export interface DetectorInput {
    user_id: string;
    now_ms: number;
    txns: DetectorTxn[];
    /** Doc ids of internal (matched-pair) transfers in the window. */
    internal_txn_ids: Set<string>;
    /** Plaid ids in ANY bill / income stream (active, hidden or inactive). */
    record_txn_ids: Set<string>;
    /** Vendor keys (`${direction}:${vendor}`) that already have a bill / income record. */
    record_vendor_subjects: Set<string>;
    state: RecurringReviewState | null;
    /** Plaid account id → account type; only needed for income candidates (null = not loaded). */
    account_types: Map<string, string> | null;
    /** Items at the candidate subjects' ids (getAll, X8). */
    existing_items: Map<string, ReviewItem>;
}
export interface DetectorCandidate {
    direction: ReviewDirection;
    vendor_key: string;
    subject_key: string;
    item_id: string;
    name: string;
    amount: number;
    frequency: string;
    next_due_ms: number;
    account_id: string;
    category: string;
    transaction_ids: string[];
    payments: number;
}
/**
 * Step 1 — candidate vendors (no review-item knowledge yet; the caller then `getAll`s their ids).
 * Returns whether the transaction cap was hit (for the log).
 */
export declare function detect_candidates(input: Omit<DetectorInput, "existing_items">): {
    candidates: DetectorCandidate[];
    capped: boolean;
    needs_account_types: boolean;
};
/**
 * Step 2 — the items to write: a new open detector item per candidate, or a refresh of the
 * detector's own open item. Never touches an answered item or a Plaid-sourced one (X14). PURE.
 */
export declare function detector_items(user_id: string, now_ms: number, candidates: DetectorCandidate[], existing: Map<string, ReviewItem>): ReviewItem[];
//# sourceMappingURL=recurring_detector.service.d.ts.map