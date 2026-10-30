/**
 * Convert Transaction To Recurring Orchestrator (Convert-To-Recurring Phase 2, D1–D4, D40–D46).
 *
 * "Make this a bill / income": one tap on a transaction (or one split).
 *
 *   flag + purge → resolve (owner first, then facts) → plan (pure: refusals, record, which past
 *   payments link) → ONE Firestore transaction creates the record and pins the source split →
 *   periods generated inline → the chosen past payments assigned in memory by the engine (D1) →
 *   ONE follow-up pass (reconcile the record, recompute only the touched budget periods, one derive
 *   bump) → the vendor's review question closed `converted` → a `retroLinkedAt` marker.
 *
 * Cost shape: one convert is a bounded one-time cost and writes NOTHING per document through
 * triggers — every write is stamped (`syncRunId` on the record, `assignRunId` on transactions), 0
 * jobs, 1 derive bump, no transfer re-check, no classifier run. A timeout leaves a record without
 * `retroLinkedAt`; the next tap RESUMES it (never a second bill) — and never reopens a bill the
 * user removed meanwhile.
 *
 * @module orchestrators/recurring/convert_transaction_to_recurring
 */
import { TraceContext } from "../../types";
import { ConvertDirection, ConvertFrequency } from "../../domain/recurring/convert_recurring.service";
export interface ConvertInput {
    transaction_id: string;
    split_id?: string;
    name: string;
    amount: number;
    frequency: ConvertFrequency;
    next_due_date: string;
    link_past: boolean;
    review_item_id?: string;
}
export interface ConvertResult {
    id: string;
    direction: ConvertDirection;
    /** An earlier tap already created it (a double tap / a resumed convert). */
    already: boolean;
    /** …and it is still being finished (its lease hasn't run out): nothing was done by this tap; ask
     *  again in a moment. A convert that died is resumed by the first tap after the lease expires. */
    in_progress?: boolean;
    /** Past payments linked in addition to the source (D46: one per occurrence). */
    linked_past_count: number;
    first_date_ms: number | null;
    next_due_ms: number | null;
    next_due_clamped: boolean;
}
export declare function convert_transaction_to_recurring_orchestrator(ctx: TraceContext, user_id: string, input: ConvertInput, now_ms: number): Promise<ConvertResult>;
//# sourceMappingURL=convert_transaction_to_recurring.orchestrator.d.ts.map