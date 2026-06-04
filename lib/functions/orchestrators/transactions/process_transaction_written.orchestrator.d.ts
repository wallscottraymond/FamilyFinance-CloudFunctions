/**
 * Process Transaction Written Orchestrator
 *
 * The control-flow brain behind the `on_transaction_written` trigger. Given a
 * transaction's before/after snapshots, it decides what async work to enqueue:
 *
 *   • DELETE          → recompute the budgets the gone splits referenced.
 *   • assignment edit → re-run the assignment engine (which fans out its own
 *                       recompute for the budgets it touches).
 *   • spend-only edit → recompute directly (assign would skip, since the
 *                       assignment didn't move).
 *
 * Relevance is decided by the pure field-guard (domain). Jobs are enqueued with
 * a per-event deduplication key so trigger replays of the SAME write collapse to
 * one job; genuine subsequent writes (new event id) still enqueue.
 *
 * @module orchestrators/transactions/process_transaction_written
 */
import { TraceContext } from "../../types";
/** Input: the written transaction's snapshots + the triggering event id. */
export interface ProcessTransactionWrittenInput {
    transaction_id: string;
    user_id: string;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    /** Firestore event id — seeds the per-event job deduplication keys. */
    event_id: string;
}
export declare function process_transaction_written_orchestrator(ctx: TraceContext, input: ProcessTransactionWrittenInput): Promise<void>;
//# sourceMappingURL=process_transaction_written.orchestrator.d.ts.map