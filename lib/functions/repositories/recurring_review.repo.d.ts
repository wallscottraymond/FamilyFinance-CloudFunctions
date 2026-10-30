/**
 * Recurring Review Repository (Convert-To-Recurring Phase 1)
 *
 * Two collections:
 *   - `recurring_review_items/{uid}__{kind}__{hash}` — the "Bills to review" items the app listens
 *     to (owner read only, no client writes). NO trigger listens to this collection (R7).
 *   - `_recurring_review_state/{uid}` — server-only memory (suppressed Plaid txn ids, "Not a bill"
 *     vendors, detector throttle). One `get` per reader.
 *
 * Resolved items carry `expireAt` (console TTL policy on that field); open and dismissed items
 * never do (a dismissed item is the visible half of the "Not a bill" memory).
 *
 * @module repositories/recurring_review
 */
import { TraceContext } from "../types";
import { RecurringReviewState, ReviewItem, ReviewStateChange } from "../domain/recurring/review_item.service";
export declare const REVIEW_ITEMS_COLLECTION = "recurring_review_items";
export declare const REVIEW_STATE_COLLECTION = "_recurring_review_state";
/** Reserved (rules deny-all, purged); the detector throttle lives in the review state doc (X8). */
export declare const DETECTOR_STATE_COLLECTION = "_recurring_detector_state";
export declare const recurring_review_repo: {
    /** The user's review state, or null (1 read). */
    get_state(_ctx: TraceContext, user_id: string): Promise<RecurringReviewState | null>;
    /**
     * Apply a change to the user's review state ATOMICALLY: read-modify-write in one transaction, so
     * concurrent writers (a sync, an answer, the detector) never lose each other's change (e.g. a
     * "Not a bill" landing while a sync writes its held-out ids). Writes only when it changed.
     * Callers first check the change against the state they already read and skip this when it is a
     * no-op there (no extra read). Returns the previous (fresh) state and what changed.
     */
    apply_state_change(ctx: TraceContext, user_id: string, change: ReviewStateChange): Promise<{
        previous: RecurringReviewState | null;
        next: RecurringReviewState;
        changed: boolean;
        suppressed_changed: boolean;
    }>;
    /**
     * Undo a user's answer whose re-sync could not be queued — GUARDED, in one transaction: re-open
     * the item only if it still equals what the answer wrote AND the review state still holds its
     * pending track (a racing sync that already consumed the track, or a newer answer, wins), and
     * never for a user being erased. Removes the pending track in the same write. Returns whether
     * it rolled back, and whether the suppressed set changed (the caller bumps).
     */
    rollback_answer(_ctx: TraceContext, user_id: string, args: {
        answered: ReviewItem;
        original: ReviewItem;
    }): Promise<{
        rolled_back: boolean;
    }>;
    /** The items at these (deterministic) ids — one batched read; missing ids are absent (X8). */
    get_items_by_ids(_ctx: TraceContext, ids: string[]): Promise<Map<string, ReviewItem>>;
    /** One item (1 read), or null. */
    get_item(_ctx: TraceContext, id: string): Promise<ReviewItem | null>;
    /**
     * BACKGROUND writers (sync planner, detector, account removal): write items only where it is
     * still safe, in a transaction against the fresh docs (review round 3 defect 1). `seen` is each
     * item as the writer read it when planning (absent = it did not exist). An item that changed
     * since (a user's answer, a racing writer), was created or deleted since, or carries a user's
     * answer is SKIPPED — never reverted. Nothing is written for a user being erased (purge state
     * read in the same transaction). Costs one read per item written + 1 (only when items changed).
     * Returns the count written and the ids skipped.
     */
    write_items_guarded(ctx: TraceContext, user_id: string, list: ReviewItem[], seen: Map<string, ReviewItem>): Promise<{
        written: number;
        skipped: string[];
    }>;
    /** Upsert items (full replace — the domain built the whole item). Batched. Returns count.
     *  Only for the user's OWN answer (the answer callable) and tests — background writers use
     *  `write_items_guarded`. */
    upsert_items(ctx: TraceContext, list: ReviewItem[]): Promise<number>;
    /** The user's OPEN items on one account (account removal closes them, X19). */
    get_open_for_account(_ctx: TraceContext, user_id: string, account_id: string): Promise<ReviewItem[]>;
    /** The user's OPEN items (what the app's one listener sees; used by tests / tooling). */
    get_open_for_user(_ctx: TraceContext, user_id: string): Promise<ReviewItem[]>;
};
//# sourceMappingURL=recurring_review.repo.d.ts.map