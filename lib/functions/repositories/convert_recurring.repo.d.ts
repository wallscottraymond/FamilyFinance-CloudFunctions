/**
 * Convert-To-Recurring repository: the ATOMIC create of a converted bill / income together with its
 * source split's pin — one Firestore transaction (review item 4). It reads the source transaction,
 * refuses when a split of it already pays a live record (the double tap, D44: only a transaction
 * already linked to a live bill is refused), then creates the record (stamped with the creator's
 * run id so the create / update triggers skip it) and pins the split(s) (the transaction write is
 * stamped `assignRunId`, so `on_transaction_written` skips it too). The creator then generates the
 * periods and runs ONE follow-up pass.
 *
 * @module repositories/convert_recurring
 */
import { TraceContext } from "../types";
import type { InflowForPersistence, OutflowForPersistence } from "../integrations/plaid/plaid_recurring_transformer";
import { ConvertDirection } from "../domain/recurring/convert_recurring.service";
/** At least the callable timeout (300 s) with margin: a resume never overlaps a slow original. */
export declare const RESUME_LEASE_MS = 330000;
export type CreateConvertedResult = {
    status: "created";
    id: string;
    /** The record as stored (for inline period generation). */
    record: Record<string, unknown>;
    /** The source transaction before / after the pin (the follow-up pass reads both). */
    source_before: Record<string, unknown>;
    source_after: Record<string, unknown>;
} | {
    status: "already_tracked";
    existing_id: string;
    existing_name: string;
}
/** A simultaneous tap of the SAME transaction/split(s): its record exists (still being finished while the lease is live). */
 | {
    status: "already_converted";
    existing_id: string;
    in_progress: boolean;
};
export declare const convert_recurring_repo: {
    create_with_source_pin(ctx: TraceContext, args: {
        direction: ConvertDirection;
        entity: OutflowForPersistence | InflowForPersistence;
        user_id: string;
        run_id: string;
        source_txn_doc_id: string;
        source_split_ids: string[];
    }): Promise<CreateConvertedResult>;
};
//# sourceMappingURL=convert_recurring.repo.d.ts.map