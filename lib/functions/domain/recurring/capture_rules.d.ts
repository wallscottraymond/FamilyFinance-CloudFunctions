/**
 * Capture rules v2 (Convert-To-Recurring Phase 1) — constants + pure predicates.
 *
 * OLD vs NEW records (D13): a bill / income record created while the per-user flag is on is
 * stamped `captureRulesVersion: 2` AT CREATION (never later). Every v2 rule keys off that stamp,
 * which every reader already loads with the record — no extra reads, no cutoff date, and a record
 * that exists without the stamp keeps today's behavior forever (Plaid's guesses, today's transfer
 * hiding, Plaid turning it on and off). Turning the flag off only stops NEW stamping (D16).
 *
 * PURE: no IO.
 *
 * @module domain/recurring/capture_rules
 */
/** The stamp written on records created under the new capture rules. */
export declare const CAPTURE_RULES_VERSION = 2;
/** Server-only per-user flag (`_feature_flags/convert_to_recurring_v1`, owner allowlist). */
export declare const CONVERT_TO_RECURRING_FLAG = "convert_to_recurring_v1";
/** Credit-card "payment" category: a real bill on the paying account; on the card it is not income. */
export declare const CARD_PAYMENT_CATEGORY = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
/** True when a record (doc or entity) carries the v2 stamp. */
export declare function is_v2_record(r: {
    captureRulesVersion?: unknown;
    capture_rules_version?: unknown;
} | null | undefined): boolean;
/** Plaid stream status, as Plaid reports it. */
export type PlaidStreamStatus = "MATURE" | "EARLY_DETECTION" | "TOMBSTONED" | "UNKNOWN" | string;
/**
 * A NEW Plaid stream Plaid itself is unsure of (D6 / D8): early detection, unknown status, or an
 * UNKNOWN frequency (the transformer silently maps that to monthly, inventing due dates). Reads
 * the RAW stream values, never the transformed ones (X10).
 */
export declare function is_low_confidence_stream(raw_status: unknown, raw_frequency: unknown): boolean;
/** A dead stream Plaid keeps reporting (D17: a NEW tombstoned stream is skipped). */
export declare function is_tombstoned_stream(raw_status: unknown): boolean;
/** Plaid's `TRANSFER_IN_*` / `TRANSFER_OUT_*` detailed codes (an own-account move or an ACH). */
export declare function is_transfer_detailed(detailed: string | null | undefined): boolean;
/** A card-side "payment received" credit (gap 3): hidden at creation and in the classifier (X7). */
export declare function is_card_payment_inflow(detailed: string | null | undefined): boolean;
/** Account types income suggestions never come from (X17: card / loan "credits" aren't income). */
export declare function is_credit_or_loan_account(account_type: string | null | undefined): boolean;
/**
 * May a Plaid low-confidence stream become a "suggested" tile at all (X14 / X17, B-P4)?
 *   - transfers never (an early own-account transfer stream is noise, not a bill);
 *   - income only for `INCOME_*` categories, and never on a credit / loan account.
 */
export declare function may_suggest_stream(direction: "outflow" | "inflow", detailed: string | null | undefined, account_type: string | null | undefined): boolean;
//# sourceMappingURL=capture_rules.d.ts.map