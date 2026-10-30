/**
 * Convert-To-Recurring: plan a convert (and its preview) — PURE.
 *
 * The resolver loads facts (the transaction, the vendor's other payments, what already claims
 * them, the account's sharing); this decides: may it convert, what record, which past payments
 * link (D2 / D40 / D45 / D46), and what the sheet should suggest. Every refusal is a code the app
 * shows; nothing here touches IO.
 *
 * Refusals: NO_VENDOR (no usable name), NO_ACCOUNT (a manual / anonymous transaction has no Plaid
 * account), TRANSFER (an own-account move or edge money), CARD_PAYMENT (a card's "payment
 * received" credit isn't income, the classifier would hide it), PENDING (the vendor key may change
 * when it posts), ALREADY_TRACKED (a shown bill already claims it, D12 / D44), OUT_OF_VIEW (before
 * the account was shared into a group — it would count in Me while the bill is in the group view).
 *
 * @module domain/recurring/convert_plan
 */
import type { InflowForPersistence, OutflowForPersistence } from "../../integrations/plaid/plaid_recurring_transformer";
import { ConvertDirection, ConvertFrequency, PaymentCandidate, RetroSelection, ScheduleGuess } from "./convert_recurring.service";
/** A transaction as the convert rules see it (the source, or one of the vendor's other payments). */
export interface ConvertTxnFacts {
    doc_id: string;
    plaid_id: string | null;
    type: string | null;
    account_id: string;
    date_ms: number;
    amount: number;
    is_pending: boolean;
    is_active: boolean;
    transfer_role: string | null;
    plaid_primary_category: string | null;
    plaid_detailed_category: string | null;
    /** The raw vendor string (merchant, else name, else description) and its stored key. */
    vendor_source: string | null;
    vendor_key: string | null;
    splits: Array<{
        split_id: string;
        outflow_id: string | null;
        inflow_id: string | null;
    }>;
    /** A shown (live) bill / income streams this payment through Plaid. */
    in_shown_stream: boolean;
}
export interface ConvertFacts {
    user_id: string;
    txn: ConvertTxnFacts;
    /** The vendor's other payments from the account's last RETRO months (unfiltered). */
    vendor_txns: ConvertTxnFacts[];
    /** A SHOWN bill / income that already claims the source (a split link or its Plaid stream). */
    claimed_by: {
        id: string;
        name: string;
    } | null;
    /** The account's sharing placement: the group + the date it was shared from (null = always). */
    placement: {
        group_id: string;
        shared_from_ms: number | null;
    } | null;
    now_ms: number;
}
export interface ConvertRequest {
    split_id?: string;
    name: string;
    amount: number;
    frequency: ConvertFrequency;
    /** `YYYY-MM-DD` */
    next_due_date: string;
    link_past: boolean;
}
export type Refusal = {
    ok: false;
    code: "NO_VENDOR" | "NO_ACCOUNT" | "TRANSFER" | "CARD_PAYMENT" | "PENDING" | "ALREADY_TRACKED" | "OUT_OF_VIEW" | "VALIDATION_ERROR" | "NOT_FOUND";
    message: string;
    details?: Record<string, unknown>;
};
export interface ConvertPlan {
    ok: true;
    direction: ConvertDirection;
    entity: OutflowForPersistence | InflowForPersistence;
    vendor_key: string;
    next_due_ms: number;
    first_date_ms: number;
    /** The splits of the source transaction the bill is pinned to. */
    source_split_ids: string[];
    selection: RetroSelection;
    /** Plaid ids of the past payments linked (stored on the record: D1 keeps them linked). */
    retro_plaid_ids: string[];
    /** Doc ids of the past payments to run the engine over (excludes the source). */
    retro_doc_ids: string[];
    /** The next due date was moved into the allowed range. */
    next_due_clamped: boolean;
}
/** The direction of money: out → bill, in → income. */
export declare function direction_of(type: string | null): ConvertDirection | null;
/** May this transaction be converted at all? (shared by the plan and the preview) */
export declare function check_convertible(facts: ConvertFacts): Refusal | null;
/** The date the retro-link reaches back to: 12 months, or the share date (D45) if later. */
export declare function retro_floor_ms(facts: ConvertFacts): number;
/**
 * The vendor's other payments a convert may link: same account + direction, single split, not
 * already linked to a bill / income or in a shown stream, not a transfer / pending / inactive. PURE.
 */
export declare function eligible_candidates(facts: ConvertFacts): PaymentCandidate[];
/** Plan a convert. PURE. */
export declare function plan_convert(facts: ConvertFacts, req: ConvertRequest, new_id: string): Refusal | ConvertPlan;
export interface ConvertPreview {
    ok: true;
    direction: ConvertDirection;
    /** Suggestions for the sheet. */
    suggested_name: string;
    suggested_amount: number;
    schedule_guess: ScheduleGuess | null;
    /** With the guessed schedule: payments that would link / stay normal transactions (null = no guess). */
    linkable_count: number | null;
    excluded_count: number | null;
    /** Payments of the vendor on this account the preview looked at. */
    vendor_payment_count: number;
}
/** What the "Make this a bill" sheet should offer for this transaction. PURE. */
export declare function build_preview(facts: ConvertFacts): Refusal | ConvertPreview;
//# sourceMappingURL=convert_plan.service.d.ts.map