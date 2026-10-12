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

/* eslint-disable @typescript-eslint/naming-convention */
type SplitPins = {
  outflowAssignmentSource?: unknown;
  outflowId?: unknown;
  budgetAssignmentSource?: unknown;
};
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Is this split OFF its bills? It must beat every automatic link — the engine's recurring
 * matcher AND Plaid stream `transactionIds` membership (derive + reconcile) — or the payment
 * silently re-attaches. Off when:
 *   - a manual bill DETACH ("remove from bill"): `outflowAssignmentSource: "manual"` with no
 *     `outflowId` (a manual pin to "none");
 *   - a manual BUDGET pin without a manual bill pin (canon A4: a budget pin detaches recurring —
 *     the engine stores no bill link, so the page and reconcile must not re-link it by stream).
 * A manual bill pin (with a bill) is ON that bill, whatever the budget. PURE.
 */
export function is_split_detached_from_outflow(split: unknown): boolean {
  const s = (split ?? {}) as SplitPins;
  if (s.outflowAssignmentSource === "manual") return !s.outflowId;
  return s.budgetAssignmentSource === "manual";
}

/** True when ANY split of the transaction is off its bills. PURE. (Readers use the per-split
 *  `splits_paying_recurring` / `is_split_on_stream`.) */
export function is_txn_detached_from_outflow(
  splits: ReadonlyArray<unknown> | null | undefined
): boolean {
  return (splits ?? []).some(is_split_detached_from_outflow);
}

/**
 * Is this split OFF its income streams? A manual budget pin (canon A4 / A13: a pinned income
 * credit counts in the pinned budget; the engine stores no income link). PURE.
 */
export function is_split_detached_from_inflow(split: unknown): boolean {
  return ((split ?? {}) as SplitPins).budgetAssignmentSource === "manual";
}

/** True when ANY split of the transaction is off its income streams. PURE. */
export function is_txn_detached_from_inflow(
  splits: ReadonlyArray<unknown> | null | undefined
): boolean {
  return (splits ?? []).some(is_split_detached_from_inflow);
}

/**
 * The splits of a transaction that PAY recurring `recurring_id` (PURE) — THE per-split rule the
 * period page, reconcile, the recurring transaction list and the engine share:
 *   - splits explicitly linked to it (`outflowId` / `inflowId`), when there are any;
 *   - else, when the transaction is in its Plaid stream (`in_stream`), every split that isn't
 *     taken off (a "remove from bill" detach / a budget pin) and isn't linked elsewhere.
 * Taking ONE split off never unlinks the others (a pin on part of a split bill payment leaves
 * the rest paying the bill).
 */
export function splits_paying_recurring<T>(
  splits: ReadonlyArray<T>,
  kind: "outflow" | "inflow",
  recurring_id: string,
  in_stream: boolean
): T[] {
  const field = kind === "outflow" ? "outflowId" : "inflowId";
  const link = (sp: T) => ((sp ?? {}) as Record<string, unknown>)[field] ?? null;
  const linked = splits.filter((sp) => link(sp) === recurring_id);
  if (linked.length || !in_stream) return linked;
  const off = kind === "outflow" ? is_split_detached_from_outflow : is_split_detached_from_inflow;
  return splits.filter((sp) => link(sp) === null && !off(sp));
}

/** Is this split ON its transaction's Plaid stream (member, not taken off)? PURE. */
export function is_split_on_stream(split: unknown, kind: "outflow" | "inflow"): boolean {
  return kind === "outflow"
    ? !is_split_detached_from_outflow(split)
    : !is_split_detached_from_inflow(split);
}

/**
 * Does this split count as "other income received" (PURE)? An INCOME-meaning split — by its
 * EFFECTIVE category (`semantic_code`; a user's pick decides, canon M7) — that isn't paying an
 * income (on its stream, or linked by `inflowId`) and isn't pinned to a budget (a pinned income
 * credit counts in that budget — canon A13 — never also as income).
 */
export function is_other_income_split(
  split: unknown,
  semantic_code: string,
  on_inflow_stream: boolean
): boolean {
  const sp = (split ?? {}) as Record<string, unknown>;
  return (
    semantic_code.startsWith("INCOME") &&
    !on_inflow_stream &&
    ((sp.inflowId as string | null | undefined) ?? null) === null &&
    sp.budgetAssignmentSource !== "manual"
  );
}

