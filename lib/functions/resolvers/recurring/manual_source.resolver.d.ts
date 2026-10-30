/**
 * Manual Add Bill / Add Income source resolver (Convert-To-Recurring D43) — READ-ONLY.
 *
 * A hand-added record gets a D1 key ONLY when it comes from a REAL transaction of the caller (its
 * Plaid account + its vendor key); a typed name never makes a key (it would strip the record from
 * fuzzy matching without matching anything). An account the caller picks must be the caller's own
 * (a forged `accountId` is refused). Nothing is read when neither is given.
 *
 * @module resolvers/recurring/manual_source
 */
import { TraceContext } from "../../types";
export type ManualSource = {
    ok: true;
    account_id: string;
    vendor_key: string | null;
    vendor_source: string | null;
    txn_doc_id: string | null;
} | {
    ok: false;
    reason: "account_not_yours" | "transaction_not_yours" | "account_mismatch";
};
export declare function resolve_manual_source(ctx: TraceContext, user_id: string, input: {
    account_id?: string | null;
    source_transaction_id?: string | null;
}): Promise<ManualSource>;
//# sourceMappingURL=manual_source.resolver.d.ts.map