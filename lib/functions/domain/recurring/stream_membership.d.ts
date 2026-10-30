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
 * Is this split OFF its bills? It must beat every automatic link — the engine's recurring
 * matcher AND Plaid stream `transactionIds` membership (derive + reconcile) — or the payment
 * silently re-attaches. Off when:
 *   - a manual bill DETACH ("remove from bill"): `outflowAssignmentSource: "manual"` with no
 *     `outflowId` (a manual pin to "none");
 *   - a manual BUDGET pin without a manual bill pin (canon A4: a budget pin detaches recurring —
 *     the engine stores no bill link, so the page and reconcile must not re-link it by stream).
 * A manual bill pin (with a bill) is ON that bill, whatever the budget. PURE.
 */
export declare function is_split_detached_from_outflow(split: unknown): boolean;
/** True when ANY split of the transaction is off its bills. PURE. (Readers use the per-split
 *  `splits_paying_recurring` / `is_split_on_stream`.) */
export declare function is_txn_detached_from_outflow(splits: ReadonlyArray<unknown> | null | undefined): boolean;
/**
 * Is this split OFF its income streams? A manual budget pin (canon A4 / A13: a pinned income
 * credit counts in the pinned budget; the engine stores no income link), or — Convert-To-Recurring
 * Phase 2 — a manual INCOME pin to a different income than `stream_id` (the user said this credit
 * pays that income, so it is not also the stream's payment). A pin to the stream's own income stays
 * on it. PURE.
 */
export declare function is_split_detached_from_inflow(split: unknown, stream_id?: string | null): boolean;
/** True when ANY split of the transaction is off its income streams. PURE. */
export declare function is_txn_detached_from_inflow(splits: ReadonlyArray<unknown> | null | undefined): boolean;
/**
 * The splits of a transaction that PAY recurring `recurring_id` (PURE) — THE per-split rule the
 * period page, reconcile, the recurring transaction list and the engine share:
 *   - splits explicitly linked to it (`outflowId` / `inflowId`), when there are any;
 *   - else, when the transaction is in its Plaid stream (`in_stream`), every split that isn't
 *     taken off (a "remove from bill" detach / a budget pin) and isn't linked elsewhere.
 * Taking ONE split off never unlinks the others (a pin on part of a split bill payment leaves
 * the rest paying the bill).
 */
export declare function splits_paying_recurring<T>(splits: ReadonlyArray<T>, kind: "outflow" | "inflow", recurring_id: string, in_stream: boolean): T[];
/**
 * Edge money (3d: a transfer crossing the view — stored role `edge_out` / `edge_in`) is never a
 * bill payment or a paycheck: every reader drops its recurring links (the period page's
 * `without_recurring_links`). PURE.
 */
export declare function is_edge_money(transfer_role: unknown): boolean;
/**
 * A split's PERIOD pin (`outflowPinnedPeriodId`, the two-stage bill picker) counts only on a MANUAL
 * bill link — the pin's own. A pin left behind on a link the engine re-made automatically (the pinned
 * bill went inactive / hidden / out of the view) is stale: that payment is placed by its date. The
 * period page and stored reconcile both decide with this. PURE.
 */
export declare function is_manual_period_pin(split: unknown): boolean;
/** Is this split ON its transaction's Plaid stream (member, not taken off)? PURE. */
export declare function is_split_on_stream(split: unknown, kind: "outflow" | "inflow", stream_id?: string | null): boolean;
/**
 * Does this split count as "other income received" (PURE)? A CREDIT (money in — a debit the
 * user mis-tagged as income isn't income received) whose EFFECTIVE category (`semantic_code`; a
 * user's pick decides, canon M7) means income, that isn't paying an income (on its stream, or
 * linked by `inflowId`) and isn't pinned to a budget (a pinned income credit counts in that
 * budget — canon A13 — never also as income).
 */
export declare function is_other_income_split(split: unknown, semantic_code: string, on_inflow_stream: boolean, is_credit: boolean): boolean;
//# sourceMappingURL=stream_membership.d.ts.map