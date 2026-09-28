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
export function build_stream_membership_map(
  items: Array<{ id: string; transaction_ids?: string[] | null }>
): Map<string, string> {
  const map = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const item of items) {
    for (const tx_id of item.transaction_ids ?? []) {
      const existing = map.get(tx_id);
      if (existing !== undefined && existing !== item.id) {
        ambiguous.add(tx_id); // claimed by a different stream too → don't guess
      } else {
        map.set(tx_id, item.id);
      }
    }
  }
  for (const tx_id of ambiguous) map.delete(tx_id);
  return map;
}

/**
 * Manual bill DETACH ("remove from bill"): the user said this split is NOT a payment for
 * any bill. Stored as `outflowAssignmentSource: "manual"` with no `outflowId` (a manual
 * pin to "none"). It must beat every automatic link — the engine's recurring matcher AND
 * Plaid stream `transactionIds` membership (derive + reconcile) — or the payment silently
 * re-attaches. PURE.
 */
export function is_split_detached_from_outflow(split: unknown): boolean {
  // Firestore split field names (camelCase).
  // eslint-disable-next-line @typescript-eslint/naming-convention
  const s = (split ?? {}) as { outflowAssignmentSource?: unknown; outflowId?: unknown };
  return s.outflowAssignmentSource === "manual" && !s.outflowId;
}

/** True when ANY split of the transaction is manually detached from bills. PURE. */
export function is_txn_detached_from_outflow(
  splits: ReadonlyArray<unknown> | null | undefined
): boolean {
  return (splits ?? []).some(is_split_detached_from_outflow);
}
