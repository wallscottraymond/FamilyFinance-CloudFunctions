/**
 * Recurring Detector Resolver — READ-ONLY lookups for the possible-bill detector.
 *
 * The classifier's scan already holds the window's transactions and the ACTIVE records. The
 * detector also must skip payments in INACTIVE streams (X14), so their stream ids are read here
 * (two small owner-scoped queries, once a day at most). Review items are looked up by their
 * deterministic ids (getAll, X8); account types only when an income candidate needs the gate.
 *
 * @module resolvers/recurring/recurring_detector
 */
import { TraceContext } from "../../types";
import { ReviewItem } from "../../domain/recurring/review_item.service";
export interface DetectorContext {
    record_txn_ids: Set<string>;
    record_vendor_subjects: Set<string>;
    load_items: (ids: string[]) => Promise<Map<string, ReviewItem>>;
    load_account_types: () => Promise<Map<string, string>>;
}
export declare function resolve_detector_context(ctx: TraceContext, user_id: string, scan: {
    records: Array<{
        kind: "outflow" | "inflow";
        transaction_ids: string[];
        merchant_name: string | null;
        description: string | null;
    }>;
}): Promise<DetectorContext>;
//# sourceMappingURL=recurring_detector.resolver.d.ts.map