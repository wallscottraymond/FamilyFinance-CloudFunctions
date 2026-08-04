/**
 * Internal-transfer detection (matched-pair).
 *
 * Plaid stamps `TRANSFER_OUT_ACCOUNT_TRANSFER` / `TRANSFER_IN_ACCOUNT_TRANSFER` on
 * BOTH money moving between the user's OWN accounts AND real external ACH payments
 * (mortgage, subscriptions). The category alone can't tell them apart — so we pair
 * them: a TRANSFER_OUT is INTERNAL only when it has a matching TRANSFER_IN of the
 * same amount on a DIFFERENT account within a few days (and vice-versa). Unpaired
 * transfers are EXTERNAL — real spending/bills — and must NOT be excluded.
 *
 * PURE: no IO. Greedy nearest-date pairing, each side consumed once.
 *
 * @module domain/transactions/internal_transfer
 */
export interface TransferForPairing {
    /** Stable id (transaction doc id). */
    id: string;
    /** Plaid transaction id — so callers can also match recurring-stream `transaction_ids`. */
    plaid_id: string | null;
    account_id: string;
    /** Absolute amount. */
    amount: number;
    date_ms: number;
    direction: "in" | "out";
}
export interface InternalTransferResult {
    /** Doc ids of transactions that are internal (own-account) transfers. */
    internal_ids: Set<string>;
    /** Plaid ids of the same (for matching recurring-stream `transaction_ids`). */
    internal_plaid_ids: Set<string>;
}
/**
 * Given the transfer transactions, return the ids of the INTERNAL ones (those with
 * a matching opposite-direction transfer of the same amount on another account).
 */
export declare function detect_internal_transfers(transfers: TransferForPairing[], opts?: {
    tolerance_days?: number;
}): InternalTransferResult;
//# sourceMappingURL=internal_transfer.service.d.ts.map