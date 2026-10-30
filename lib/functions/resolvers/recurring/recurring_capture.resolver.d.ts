/**
 * Recurring Capture Resolver (Convert-To-Recurring Phase 1) — READ-ONLY.
 *
 * What the capture planner needs beyond the sync's own reads, loaded only when the planner runs
 * (flag on, or the user has v2 records — X11):
 *   - the user's review state (ONE get, X8);
 *   - the review items at the deterministic ids of the subjects in this response (ONE getAll — no
 *     query, X8);
 *   - lazily, the user's INACTIVE records (same-bill candidates), only when a new v2 stream needs
 *     one (X9).
 *
 * @module resolvers/recurring/recurring_capture
 */
import { TraceContext } from "../../types";
import { RecurringReviewState, ReviewItem } from "../../domain/recurring/review_item.service";
import { CaptureRecordInfo } from "../plaid/recurring_sync.resolver";
export interface CaptureReviewContext {
    state: RecurringReviewState | null;
    items: Map<string, ReviewItem>;
}
export declare function resolve_capture_review_context(ctx: TraceContext, user_id: string, review_ids: string[], plaid_item_doc_id?: string): Promise<CaptureReviewContext>;
/** The user's inactive bills + income (same-bill candidates) + their active Plaid account ids. */
export declare function resolve_inactive_capture_records(ctx: TraceContext, user_id: string): Promise<{
    records: CaptureRecordInfo[];
    active_account_ids: Set<string>;
}>;
/** Raw prefetched docs → planner records (no reads). */
export declare function capture_records_from_raw(outflow_docs: Map<string, Record<string, unknown>>, inflow_docs: Map<string, Record<string, unknown>>): Map<string, CaptureRecordInfo>;
//# sourceMappingURL=recurring_capture.resolver.d.ts.map