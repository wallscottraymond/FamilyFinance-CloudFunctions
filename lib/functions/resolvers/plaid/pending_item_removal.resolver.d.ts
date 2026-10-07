/**
 * Pending Item Removal Resolver
 *
 * READ-ONLY: the Plaid items whose removal failed during an account removal,
 * with decrypted access tokens for the retry. No mutations.
 *
 * @module resolvers/plaid/pending_item_removal
 */
import { TraceContext } from "../../types";
/** An item awaiting a retried Plaid removal. */
export interface PendingItemRemoval {
    item_doc_id: string;
    user_id: string;
    /** Decrypted access token, or null if missing/undecryptable */
    access_token: string | null;
}
/**
 * Resolves items flagged `removalPending`.
 *
 * @param ctx - Trace context
 * @returns Items to retry
 */
export declare function resolve_pending_item_removals(ctx: TraceContext): Promise<PendingItemRemoval[]>;
//# sourceMappingURL=pending_item_removal.resolver.d.ts.map