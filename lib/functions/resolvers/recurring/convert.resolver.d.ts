/**
 * Convert Resolver — READ-ONLY facts for converting a transaction into a bill / income, and for
 * previewing it (Convert-To-Recurring Phase 2).
 *
 * Authorization comes FIRST: the transaction's owner must be the caller (D24 — a group member can't
 * convert the other person's transaction, and nothing else is read for them, so nothing leaks).
 * Then it loads exactly what the pure rules need: the user's shown bills / income (what already
 * claims the payment, which Plaid payments belong to a live stream), the account's sharing
 * placement (D45) and the vendor's payments on that account (one query on the existing
 * `(userId, isActive, vendorKey, transactionDate)` index; the account is filtered in memory).
 *
 * @module resolvers/recurring/convert
 */
import { TraceContext } from "../../types";
import { ConvertFacts, ConvertTxnFacts } from "../../domain/recurring/convert_plan.service";
export type ConvertResolution = {
    ok: false;
    reason: "not_found" | "permission_denied";
} | {
    ok: true;
    facts: ConvertFacts;
    /** A record this transaction was already converted into (a double tap / a timed-out convert). */
    existing_conversion: {
        id: string;
        name: string;
        live: boolean;
        retro_done: boolean;
    } | null;
    /** Old, turned-off / stale records of the same direction + account + vendor (D41): a convert
     *  over them is a user-tapped "Same bill" — they end and merge into the new record. */
    old_bills: OldBill[];
};
export interface OldBill {
    id: string;
    removal_intervals: import("../../domain/recurring/recurring_suppression.service").RemovalInterval[];
    user_custom_name: string | null;
    expected_amount_override: number | null;
    user_frequency: string | null;
    last_payment_ms: number | null;
    merged_into_id: string | null;
    account_id: string | null;
    is_active: boolean;
}
type Raw = Record<string, unknown>;
/** The raw transaction doc → the facts the rules read. */
export declare function txn_facts(doc_id: string, d: Raw, in_shown_stream: boolean): ConvertTxnFacts;
export declare function resolve_convert_facts(ctx: TraceContext, user_id: string, transaction_id: string, now_ms: number, 
/** The split being converted (absent = the whole transaction). */
split_id?: string): Promise<ConvertResolution>;
export {};
//# sourceMappingURL=convert.resolver.d.ts.map