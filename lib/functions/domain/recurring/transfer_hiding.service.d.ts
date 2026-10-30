/**
 * Transfer / card-payment hiding for recurring records (Convert-To-Recurring X7, gaps 3 + 5).
 *
 * OLD records (no v2 stamp) keep today's rule forever (D13): a transfer stream is hidden as soon as
 * ANY one of its transactions is an internal matched pair; card payments are never hidden.
 *
 * v2 records:
 *   - TRANSFER streams — the MAJORITY rule, counted only over the stream's transactions inside the
 *     classifier's loaded window (the stream's ids reach back 730 days, the pairing window is ~180;
 *     a 24-month stream with every in-window leg paired must hide):
 *       hide   when ≥ 2 in-window legs pair AND ≥ 50 % of the in-window legs pair;
 *       unhide only when < 25 % pair (HYSTERESIS: a borderline stream never flips as the window
 *       slides — each flip rewrites the record + its periods and forces an FE re-derive);
 *       no in-window legs → keep the current state.
 *   - a card-side "payment received" INFLOW (LOAN_PAYMENTS_CREDIT_CARD_PAYMENT) is ALWAYS hidden —
 *     at creation and here, so the self-correcting unhide never flips it back daily. The paying
 *     side (an outflow) is a real bill and stays.
 *
 * PURE: no IO.
 *
 * @module domain/recurring/transfer_hiding
 */
export declare const HIDE_RATIO = 0.5;
export declare const UNHIDE_RATIO = 0.25;
export declare const MIN_PAIRED = 2;
export interface HidingRecord {
    kind: "o" | "i";
    plaid_detailed_category: string;
    transaction_ids: string[] | undefined;
    is_hidden: boolean;
    v2: boolean;
}
/** Today's rule (old records): any one paired leg hides a transfer stream; card payments never. */
export declare function should_hide_v1(plaid_detailed_category: string, transaction_ids: string[] | undefined, internal_plaid_ids: Set<string>): boolean;
/** The v2 rule (see the module doc). Returns the TARGET hidden state. */
export declare function should_hide_v2(r: HidingRecord, window_plaid_ids: Set<string>, internal_plaid_ids: Set<string>): boolean;
/** The target hidden state for any record: v1 for old records, v2 for stamped ones. */
export declare function target_hidden(r: HidingRecord, window_plaid_ids: Set<string>, internal_plaid_ids: Set<string>): boolean;
//# sourceMappingURL=transfer_hiding.service.d.ts.map