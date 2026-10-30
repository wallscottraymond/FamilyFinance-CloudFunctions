/**
 * Transaction card payload (Tappable-Transaction-Rows)
 *
 * The slice of a stored transaction doc the app's `TransactionCard` (the one transaction row
 * used everywhere) renders: names, amount, date, pending, type / transfer role, note + tags,
 * and per split the category, budget, bill / income link and spend-status fields. The derive
 * callables that list transactions (budget detail, bill / income detail) already load the full
 * docs, so attaching this costs no extra reads. The app maps it with the SAME
 * `mapTransactionDoc` the Transactions list uses, so the row is identical everywhere.
 *
 * An ALLOWLIST (not the whole doc): keeps cached results small (`derived_budget_txn_cache` holds
 * a whole budget period in one doc — Everything Else can own hundreds of transactions) and keeps
 * raw Plaid data off the wire. Firestore Timestamps become epoch millis (a callable can't send a
 * Timestamp; `mapTransactionDoc` accepts millis).
 *
 * PURE: no IO.
 *
 * @module domain/transactions/transaction_card.service
 */
/** The card payload: `id` = the Firestore DOC id (what Transaction Detail loads). */
export type CardTransaction = {
    id: string;
} & Record<string, unknown>;
/** A stored transaction doc → the card payload. PURE. */
export declare function to_card_transaction(doc_id: string, data: Record<string, unknown>): CardTransaction;
//# sourceMappingURL=transaction_card.service.d.ts.map