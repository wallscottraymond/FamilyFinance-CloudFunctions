/**
 * Update Transaction Splits (orchestrator) — a split edit from the app, applied IMMEDIATELY
 * (canon O2, Transaction-Integrity-Review 3g) and read-consciously.
 *
 *   1. build the edit in memory (domain/transactions/split_edit: merge onto the stored splits,
 *      the one category edit rule, totals); re-categorized out of transfers → role "none";
 *   2. if the edit touches anything the engine decides on (split set, category, budget / bill
 *      pins), the engine assigns the transaction IN MEMORY (we hold it — no re-read);
 *      a status / note edit skips that (it only moves spend);
 *   3. write ONCE, stamped (`on_transaction_written` skips it), only if the doc is unchanged since
 *      it was read (else re-read + rebuild the edit on the newer doc — a sync or the re-assign
 *      engine is never overwritten with stale fields); bump the derive version RIGHT AFTER the
 *      write (so a crash later can't leave the period stale);
 *   4. follow-up: an assignment edit runs the one follow-up pass (reconcile, recompute, transfer
 *      re-check only when a category moved); a spend-only edit enqueues the coalesced recompute
 *      (repeated status taps merge into one).
 * If the in-memory assignment fails the edit is still written, unstamped — the trigger assigns it.
 *
 * @module orchestrators/transactions/update_transaction_splits
 */
import { TraceContext } from "../../types";
export interface UpdateTransactionSplitsInput {
    user_id: string;
    transaction_id: string;
    /** The stored transaction (already read + ownership-checked by the entry). The orchestrator
     *  re-reads it with its update time for the conditional write. */
    txn: Record<string, unknown>;
    splits: Array<Record<string, unknown>>;
    user_notes?: string;
    is_recurring?: boolean;
    /** `updatedAt` (ms) of the copy the app edited. When set, the edit is refused if the stored
     *  transaction changed since (it would overwrite that newer write; Code-Health-Review P4-H1).
     *  Older app builds don't send it. */
    base_updated_at_ms?: number;
}
/** The app edited an older copy of the transaction: it must re-read and re-apply. */
export declare class StaleSplitEditError extends Error {
    constructor(transaction_id: string);
}
export declare function update_transaction_splits_orchestrator(ctx: TraceContext, input: UpdateTransactionSplitsInput): Promise<Record<string, unknown>>;
//# sourceMappingURL=update_transaction_splits.orchestrator.d.ts.map