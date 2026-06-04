/**
 * Relink Attempt Repository
 *
 * Handles persistence for relink attempt tracking.
 * Used to track re-authentication attempts and their outcomes.
 *
 * @module repositories/plaid/relink_attempt
 */
import { TraceContext } from "../../types";
import { RelinkAttempt, RelinkAttemptInput } from "../../types/plaid/update_link_token.types";
/**
 * Relink Attempt Repository
 *
 * Provides methods for CRUD operations on relink attempts.
 */
export declare const relink_attempt_repo: {
    /**
     * Creates a new relink attempt record.
     *
     * @param ctx - Trace context
     * @param input - Relink attempt data
     * @returns The created document ID
     */
    create(ctx: TraceContext, input: RelinkAttemptInput): Promise<string>;
    /**
     * Marks a relink attempt as completed.
     *
     * @param ctx - Trace context
     * @param attempt_id - The attempt document ID
     * @param success - Whether the relink was successful
     */
    mark_completed(ctx: TraceContext, attempt_id: string, success: boolean): Promise<void>;
    /**
     * Marks all pending relink attempts for an item as successful.
     * Called when LOGIN_REPAIRED webhook is received.
     *
     * @param ctx - Trace context
     * @param item_id - The Plaid item document ID
     */
    mark_all_successful_for_item(ctx: TraceContext, item_id: string): Promise<number>;
    /**
     * Counts recent relink attempts for an item.
     *
     * @param ctx - Trace context
     * @param user_id - User ID
     * @param item_id - Item document ID
     * @returns Number of attempts in the window
     */
    count_recent(ctx: TraceContext, user_id: string, item_id: string): Promise<number>;
    /**
     * Gets the most recent relink attempt for an item.
     *
     * @param ctx - Trace context
     * @param item_id - Item document ID
     * @returns The most recent attempt or null
     */
    get_most_recent(ctx: TraceContext, item_id: string): Promise<RelinkAttempt | null>;
    /**
     * Cleans up old relink attempts (for scheduled cleanup).
     *
     * @param ctx - Trace context
     * @param retention_days - Number of days to retain attempts
     * @returns Number of deleted documents
     */
    cleanup_old_attempts(ctx: TraceContext, retention_days: number): Promise<number>;
};
//# sourceMappingURL=relink_attempt.repo.d.ts.map