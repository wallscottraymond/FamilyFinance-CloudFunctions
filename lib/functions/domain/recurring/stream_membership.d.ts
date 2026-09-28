/**
 * Recurring stream membership map (shared by the derive read-path + the assignment engine).
 *
 * Builds `Plaid transaction id → recurring id` from a set of recurring definitions'
 * `transactionIds` (Plaid's authoritative stream membership). Used to link a transaction
 * to its bill/income deterministically — the reliable signal the fuzzy period matcher misses.
 *
 * CONFLICT RULE: if the SAME Plaid transaction id appears in TWO different streams
 * (Plaid over-assignment — e.g. one payment claimed by two credit-card bills), we do NOT
 * guess a winner (that was a non-deterministic last-writer-wins bug). The ambiguous id is
 * EXCLUDED from the map, so it falls back to fuzzy matching / stays unattributed rather than
 * being force-linked to an arbitrary bill. Deterministic regardless of input order.
 *
 * PURE: no IO.
 *
 * @module domain/recurring/stream_membership
 */
/** Build the `txn id → recurring id` map, excluding ids claimed by 2+ streams. PURE. */
export declare function build_stream_membership_map(items: Array<{
    id: string;
    transaction_ids?: string[] | null;
}>): Map<string, string>;
/**
 * Manual bill DETACH ("remove from bill"): the user said this split is NOT a payment for
 * any bill. Stored as `outflowAssignmentSource: "manual"` with no `outflowId` (a manual
 * pin to "none"). It must beat every automatic link — the engine's recurring matcher AND
 * Plaid stream `transactionIds` membership (derive + reconcile) — or the payment silently
 * re-attaches. PURE.
 */
export declare function is_split_detached_from_outflow(split: unknown): boolean;
/** True when ANY split of the transaction is manually detached from bills. PURE. */
export declare function is_txn_detached_from_outflow(splits: ReadonlyArray<unknown> | null | undefined): boolean;
//# sourceMappingURL=stream_membership.d.ts.map