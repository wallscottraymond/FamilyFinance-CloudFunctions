/**
 * Review hold-out loader (Convert-To-Recurring X3 / X11) — READ-ONLY.
 *
 * The review state doc (suppressed Plaid txn ids = the fuzzy-match hold-out) only exists for
 * users who have the feature. X11: zero extra reads for everyone else — so the doc is read only
 * when the user is flag-enabled (per-instance cached check) OR their already-loaded bills / income
 * include a v2 record (D16: v2 records keep v2 behavior whatever the flag says).
 *
 * @module resolvers/recurring/review_holdout
 */
import { TraceContext } from "../../types";
import { RecurringReviewState } from "../../domain/recurring/review_item.service";
export declare function load_review_state_if_relevant(ctx: TraceContext, user_id: string, loaded_records: Array<{
    capture_rules_version?: number | null;
}>, flag_on?: Promise<boolean>): Promise<RecurringReviewState | null>;
//# sourceMappingURL=review_holdout.resolver.d.ts.map