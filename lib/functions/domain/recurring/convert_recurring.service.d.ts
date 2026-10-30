/**
 * Convert-To-Recurring (Phase 2) — the pure heart of "Make this a bill / income".
 *
 * Everything here is deterministic and IO-free: the keys that link a vendor on an account to a
 * converted bill (D1), the schedule math (next due, first date, bounds), which past payments a
 * convert links (D2 / D46 — one per occurrence, the closest to its due date), the schedule guess
 * the preview suggests, and the record builder both convert and Add Bill / Add Income (D43) use.
 *
 * "Converted" in this module means a record created by the user through the new path:
 * `captureRulesVersion: 2` + `source: "manual"` + a stored `vendorKey` + an account. Nothing that
 * exists today carries all of them, so none of this touches an existing record (D13).
 *
 * @module domain/recurring/convert_recurring
 */
import type { InflowForPersistence, OutflowForPersistence } from "../../integrations/plaid/plaid_recurring_transformer";
import type { RemovalInterval } from "./recurring_suppression.service";
export type ConvertDirection = "outflow" | "inflow";
/** Schedules a convert / Add Bill can pick (yearly is allowed for convert, D17). */
export declare const CONVERT_FREQUENCIES: readonly ["weekly", "biweekly", "semimonthly", "monthly", "quarterly", "yearly"];
export type ConvertFrequency = (typeof CONVERT_FREQUENCIES)[number];
/** Input caps (a client value is never trusted: names and amounts are bounded). */
export declare const CONVERT_NAME_MAX = 120;
export declare const CONVERT_AMOUNT_MAX = 10000000;
/** D40: retro-link reaches back 12 months. */
export declare const RETRO_LINK_MONTHS = 12;
/**
 * The early-payment pad (D28): a payment up to 7 days before an occurrence still pays it. The
 * engine's D1 floor and the retro-link's date floor use this one constant.
 */
export declare const D1_EARLY_PAD_MS: number;
/** Bounds on the stored lists (P12: every array has a bound). */
export declare const MAX_ABSORBED_STREAMS = 20;
export declare const MAX_ABSORBED_TXN_IDS = 600;
/** A Plaid stream the converted bill absorbed (D42): recorded here, never saved as its own bill. */
export interface AbsorbedStream {
    stream_id: string;
    state: "absorbed" | "declined";
    at_ms: number;
    /** The Plaid payments of that stream the record claims (their union is `absorbed_txn_ids`). */
    txn_ids: string[];
    /** The stream's own vendor key (it can differ from the record's) — a delete remembers it too. */
    vendor_key?: string;
}
/** How a bill was merged into another (D7 / D22 / D41), kept so the merge can be undone (D18). */
export interface MergeLog {
    /** The bill this one was merged into. */
    into: string;
    at_ms: number;
    /** The old bill's removal intervals before the merge ended it. */
    prior_intervals: RemovalInterval[];
    /** What the new bill inherited from this one (null = nothing inherited for that field). */
    inherited_name: string | null;
    inherited_override: number | null;
    /** The old bill's active flag before the merge (the merge keeps it active; undo restores this). */
    prior_is_active?: boolean;
}
/** The key that links a payment (direction + account + vendor) to its converted bill(s). */
export declare function converted_key(direction: ConvertDirection, account_id: string, vendor_key: string): string;
/** A record the D1 matcher / fuzzy exclusion treats as "converted": v2 + manual + key + account. */
export declare function is_converted_candidate(r: {
    captureRulesVersion?: unknown;
    capture_rules_version?: unknown;
    source?: unknown;
    vendorKey?: unknown;
    vendor_key?: unknown;
    accountId?: unknown;
    account_id?: unknown;
}): boolean;
declare const utc_day_start: (ms: number) => number;
export { utc_day_start };
/** `YYYY-MM-DD` → UTC midnight ms, or null when it is not a real calendar date. */
export declare function parse_iso_date(s: string): number | null;
/** Roughly one cadence in ms (for bounds and guesses only — never for placing occurrences). */
export declare function cadence_ms(frequency: string): number;
/** The due date `n` cadences after (n > 0) or before (n < 0) `anchor_ms`, on the anchor's day. */
export declare function step_cadence(anchor_ms: number, frequency: string, n: number): number;
/** Next due is kept in [today − 1 cadence − 7 days, today + 1 year] (period writes stay bounded). */
export declare function clamp_next_due(next_due_ms: number, frequency: string, now_ms: number): {
    next_due_ms: number;
    clamped: boolean;
};
/** The first date is never earlier than now − 12 months − 1 cadence (caps stored periods ≈ 260). */
export declare function floor_first_date(first_ms: number, frequency: string, now_ms: number): number;
/** Dates of a schedule's occurrences between two instants (anchor = next due, no first-date guard). */
export declare function occurrences_between(frequency: string, next_due_ms: number, from_ms: number, to_ms: number): number[];
/** A past payment (a single-split transaction of the vendor on the bill's account). */
export interface PaymentCandidate {
    /** The transaction doc id. */
    id: string;
    /** Its Plaid transaction id (null for a manual transaction). */
    plaid_id: string | null;
    date_ms: number;
    amount: number;
}
export interface RetroSelection {
    /** The payments to link, oldest first (one per occurrence, incl. the source). */
    chosen: PaymentCandidate[];
    /** Candidates that stay normal transactions (no occurrence within 7 days, or a worse fit). */
    excluded: PaymentCandidate[];
    /** The occurrence due date the earliest chosen payment pays; null when none matched. */
    first_due_ms: number | null;
}
/**
 * D46: link at most ONE payment per occurrence — the one closest to its due date (ties: the
 * earlier payment, then the smaller id). A payment pays the occurrence nearest to it within 7
 * days (the earlier on a tie), exactly as the period page's matcher places it; one with no
 * occurrence in reach stays a normal transaction. The source payment (the one the user converted)
 * always counts and always claims the occurrence it pays. PURE and deterministic: the same
 * payments always give the same selection.
 */
export declare function select_retro_payments(input: {
    frequency: string;
    next_due_ms: number;
    payments: PaymentCandidate[];
    source?: PaymentCandidate | null;
    /** Payments before this are not candidates (12 months back, or the share date, D45). */
    floor_ms: number;
    now_ms: number;
}): RetroSelection;
/**
 * The record's first date: the earliest occurrence a linked payment pays (so it reads paid, never
 * "unpaid" before its first real payment), never later than the next due and never earlier than
 * the 12-month floor. With no payment in reach of an occurrence it is the last occurrence at or
 * before the source payment (else the next due).
 */
export declare function compute_first_date(input: {
    frequency: string;
    next_due_ms: number;
    selection: RetroSelection;
    source_date_ms: number;
    now_ms: number;
}): number;
export interface ScheduleGuess {
    frequency: ConvertFrequency;
    /** Median gap between payments, in days. */
    median_gap_days: number;
    /** The next due date: the last payment stepped forward by the cadence until it is not past. */
    next_due_ms: number;
}
/** Guess the schedule from payment dates (median gap → cadence). null when there is no pattern. */
export declare function guess_schedule(dates_ms: number[], now_ms: number): ScheduleGuess | null;
/**
 * Pin the source split to the new record (pure). A bill is pinned like the manual bill pin; an
 * income like the manual income pin (`apply_inflow_pin_to_split`). A "remove from bill" detach on
 * the split is replaced: converting is the user's explicit choice.
 */
export declare function apply_source_pin(split: Record<string, unknown>, direction: ConvertDirection, id: string): Record<string, unknown>;
export interface BuildConvertedInput {
    id: string;
    direction: ConvertDirection;
    user_id: string;
    name: string;
    amount: number;
    frequency: ConvertFrequency;
    /** UTC-midnight next due. */
    next_due_ms: number;
    /** UTC-midnight first date (see `compute_first_date`). */
    first_date_ms: number;
    /** The Plaid account id the payments come from; "" = no account (no D1 key). */
    account_id: string;
    /** The stored vendor key; null/"" = none (a hand-added record without a real transaction). */
    vendor_key: string | null;
    /** The raw vendor string `vendor_key` was made from (the record's merchant). */
    merchant_source: string | null;
    converted_from_txn_id: string | null;
    converted_from_split_ids?: string[];
    now_ms: number;
    /** Categories (the converting transaction's; defaults are the generic-services ones). */
    plaid_primary_category?: string;
    plaid_detailed_category?: string;
    /** Expected-amount override written at creation (so the average never drifts it). */
    expected_amount_override?: number | null;
    expense_type?: string;
    is_essential?: boolean;
    income_type?: string;
    is_regular_salary?: boolean;
    is_variable?: boolean;
    /** Hidden from creation (never for convert). */
    is_hidden?: boolean;
    /** Add Income keeps its own description / user-modified flag / settings (D43). */
    description?: string;
    is_user_modified?: boolean;
    income_extras?: Record<string, unknown>;
}
export interface BuildConvertedResult {
    errors?: string[];
    outflow?: OutflowForPersistence;
    inflow?: InflowForPersistence;
}
/** Validate and build the record to persist. PURE. */
export declare function build_converted_recurring(input: BuildConvertedInput): BuildConvertedResult;
//# sourceMappingURL=convert_recurring.service.d.ts.map