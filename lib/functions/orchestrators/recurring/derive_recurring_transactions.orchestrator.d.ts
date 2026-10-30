/**
 * Derive Recurring Transactions (orchestrator)
 *
 * READ-ONLY: every transaction that pays a recurring inflow/outflow, for its detail screen.
 * Candidates = the stream's own `transaction_ids` (Plaid membership, matched to our docs by the
 * `transactionId` field) UNION the transactions whose splits are linked to it
 * (`splitOutflowIds` / `splitInflowIds`: hand-assigned bill pins + engine matches — a manual bill
 * has no Plaid stream at all). Each candidate then goes through THE per-split rule the period
 * page and reconcile use (`splits_paying_recurring`), so the list and the paid status agree.
 * Each row is flagged `in_period` for the currently-viewed window so the screen
 * can render a "This Period" section and a "Historical" (all-time) section.
 *
 * Row ids are Firestore DOC ids (Transaction Detail loads `transactions/{docId}`); each row
 * carries the card payload so the app renders the real transaction row (Tappable-Transaction-Rows).
 *
 * @module orchestrators/recurring/derive_recurring_transactions
 */
import { TraceContext } from "../../types";
import { CardTransaction } from "../../domain/transactions/transaction_card.service";
export type RecurringKind = "outflow" | "inflow";
export interface DerivedRecurringTransaction {
    /** Firestore DOC id (what Transaction Detail loads) — not the Plaid transaction id. */
    transaction_id: string;
    /** The splits paying this recurring (`splitId ?? id`). */
    split_ids: string[];
    date_ms: number;
    name: string;
    amount: number;
    is_pending: boolean;
    in_period: boolean;
    /** The transaction, for the app's shared transaction row. */
    card: CardTransaction;
}
export declare function derive_recurring_transactions_orchestrator(ctx: TraceContext, user_id: string, recurring_id: string, kind: RecurringKind, window_start_ms: number, window_end_ms: number): Promise<DerivedRecurringTransaction[]>;
//# sourceMappingURL=derive_recurring_transactions.orchestrator.d.ts.map