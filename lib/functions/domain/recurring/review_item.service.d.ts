/**
 * Bills-to-review items + the per-user review state (Convert-To-Recurring Phase 1, D9 / D14 / X8).
 *
 * REVIEW ITEMS (`recurring_review_items`) are what the app shows: one per (owner, kind, subject),
 * at a DETERMINISTIC id so every writer is idempotent with no exists-query and every reader can
 * `getAll` the ids of the subjects it has in hand (X8):
 *   - `suggested`    — a possible bill / income (Plaid low-confidence stream, or the detector);
 *                      subject = direction + VENDOR KEY (X14: one tile per vendor, whatever found it)
 *   - `still_a_bill` — a v2 bill Plaid turned off / stopped returning; subject = the record id
 *   - `same_bill`    — a new Plaid stream that looks like a stopped bill's replacement; subject =
 *                      the new stream id
 * Vendor keys can contain "/" (e.g. "paypal /inst xfer"), so subjects are HASHED into the id.
 *
 * REVIEW STATE (`_recurring_review_state/{uid}`, server-only) is what the backend must remember:
 * the Plaid transaction ids held out of fuzzy bill matching (open + dismissed suggestions, X3),
 * the "Not a bill" vendor keys (D11), and the detector's daily throttle. One `get` per reader;
 * written only when its content changes.
 *
 * PURE: no IO (hashing is deterministic).
 *
 * @module domain/recurring/review_item
 */
export type ReviewKind = "suggested" | "still_a_bill" | "same_bill";
export type ReviewStatus = "open" | "resolved" | "dismissed";
export type ReviewDirection = "outflow" | "inflow";
export type ReviewSource = "plaid" | "detector";
/** User answers + the system's own closes (matured / back active / account removed). */
export type ReviewAnswer = "track" | "not_bill" | "still_a_bill" | "it_ended" | "keep_separate" | "same_bill"
/** The user made the vendor a bill / income by hand ("Make this a bill"): fulfils and creates
 *  NOTHING — a Plaid stream of the vendor on another account must not make a second bill. */
 | "converted" | "matured" | "auto_active" | "account_removed"
/** A "Track" / "Keep separate" whose bill could not be made (stream gone / rejected / its
 *  account removed): the held-out payments are released (defect 4). */
 | "track_unavailable"
/** A "Still a bill?" about a bill the user no longer sees (removed / paused / merged): the
 *  question is moot (defect 5). */
 | "not_shown"
/** A Plaid suggestion whose stream its own Plaid item no longer returns: the item lets go of the
 *  tile (round 4 defect 2) so another item's live stream of the vendor can take it over. */
 | "stream_gone";
/** A review item (snake_case domain shape; the repo maps it to the camelCase doc). */
export interface ReviewItem {
    id: string;
    user_id: string;
    kind: ReviewKind;
    direction: ReviewDirection;
    source: ReviewSource;
    status: ReviewStatus;
    answer: ReviewAnswer | null;
    /** The un-hashed subject (vendor key / record id / stream id) the id was built from. */
    subject_key: string;
    vendor_key: string | null;
    /** Plaid account id the payments come from (account removal closes its items). */
    account_id: string | null;
    /** plaid_items doc id (a "track" / "keep separate" answer re-syncs this item). */
    plaid_item_doc_id: string | null;
    /** Plaid stream id (Plaid suggestions / same-bill new stream). */
    stream_id: string | null;
    /** The record the question is about (still a bill: the bill; same bill: the stopped bill). */
    record_id: string | null;
    name: string;
    amount: number;
    /** Detected schedule (null = Plaid said UNKNOWN; the user picks one, D8). */
    frequency: string | null;
    plaid_status: string | null;
    category: string | null;
    /** The payments behind it (Plaid ids for Plaid streams; doc ids for the detector). Bounded. */
    transaction_ids: string[];
    next_due_ms: number | null;
    /** Answer detail: the schedule the user picked when tracking. */
    user_frequency: string | null;
    content_hash: string;
    created_at_ms: number;
    updated_at_ms: number;
    resolved_at_ms: number | null;
}
/** The per-user review state (snake_case domain shape). */
export interface RecurringReviewState {
    user_id: string;
    /** Plaid transaction ids held out of FUZZY bill / income matching (open + dismissed suggestions). */
    suppressed_txn_ids: string[];
    /** "Not a bill" / "Not income" vendor memory: `${direction}:${vendor_key}`. */
    dismissed_vendor_keys: string[];
    /** UTC day (YYYY-MM-DD) the possible-bill detector last ran fully. */
    detector_last_run_day: string | null;
    /**
     * "Track" / "Keep separate" answers whose bill doesn't exist yet (review round 3 defect 4). The
     * planner of that Plaid item resolves each one — bill saved (stamped or not) → released; stream
     * gone / rejected → released + the item closed `track_unavailable` — and account removal
     * resolves the ones on that account. So a track is never silently lost and its held-out ids
     * are never orphaned.
     */
    pending_tracks?: PendingTrack[];
    /**
     * The OPEN Plaid suggested tiles each Plaid item owns (round 4 defect 2). A sync loads its own
     * item's tiles even when the vendor is gone from the response, so a tile whose stream vanished
     * is let go (`stream_gone`) instead of staying owned by a stream no sync will ever see again
     * (another item's live stream of the vendor could never take it over). Absent on old docs.
     */
    suggested_owners?: SuggestedOwner[];
}
/** One open Plaid suggested tile and the Plaid item that owns it. */
export interface SuggestedOwner {
    item_id: string;
    plaid_item_doc_id: string;
}
/** A tracked item waiting for its bill (see `RecurringReviewState.pending_tracks`). */
export interface PendingTrack {
    item_id: string;
    plaid_item_doc_id: string | null;
    account_id: string | null;
    stream_id: string | null;
    since_ms: number;
    /**
     * Set when the track's own stream was gone from its Plaid item while the user has OTHER Plaid
     * items (round 4 defect 2): the track waits for one of them (`awaiting_item_doc_ids`) to save a
     * stream of the same vendor — or closes `track_unavailable` once every one of them has synced
     * without it, or after PENDING_HANDOFF_TTL_MS. `plaid_item_doc_id` is null then.
     */
    handed_off_ms?: number;
    awaiting_item_doc_ids?: string[];
}
/**
 * Bounds (CLAUDE.md write rule 9: every array field has a prune policy). The held-out ids are
 * capped DETERMINISTICALLY (review round 3 defect 6): the set is kept sorted and the first
 * MAX_SUPPRESSED_TXN_IDS ids are kept, so identical input always yields the identical stored set
 * — an insertion-order cap evicted a different subset each sync (each re-added id pushed another
 * out: a write + a derive bump + a re-assign on every sync). Vendor keys only ever grow by a
 * user's tap; their cap drops the oldest.
 */
export declare const MAX_SUPPRESSED_TXN_IDS = 5000;
export declare const MAX_DISMISSED_VENDOR_KEYS = 1000;
export declare const MAX_ITEM_TRANSACTION_IDS = 60;
export declare const MAX_PENDING_TRACKS = 200;
export declare const MAX_SUGGESTED_OWNERS = 1000;
/** A handed-off track no other item fulfilled within this is closed `track_unavailable`. */
export declare const PENDING_HANDOFF_TTL_MS: number;
/** Backstop: no track stays pending longer than this (round 4 test 7 — never pending forever). */
export declare const PENDING_TRACK_MAX_AGE_MS: number;
/** Resolved items expire (console TTL policy on `expireAt`); open + dismissed never carry it. */
export declare const RESOLVED_ITEM_TTL_MS: number;
/** The subject a `suggested` item is keyed by: direction + vendor key (X14). */
export declare function suggested_subject(direction: ReviewDirection, vendor_key: string): string;
/** Deterministic review-item id: `${uid}__${kind}__${sha1(subject)[0..24]}` (subjects may hold "/"). */
export declare function build_review_item_id(user_id: string, kind: ReviewKind, subject_key: string): string;
/** Parse the owner uid out of an item id (the prefix before the first `__`). */
export declare function owner_of_review_item_id(item_id: string): string | null;
/** The fields that, when changed, make an item worth rewriting (timestamps excluded). */
export declare function review_content_hash(item: Omit<ReviewItem, "content_hash" | "created_at_ms" | "updated_at_ms" | "id">): string;
/** Build a complete item from its parts (id + hash computed). */
export declare function make_review_item(parts: Omit<ReviewItem, "id" | "content_hash" | "created_at_ms" | "updated_at_ms">, now_ms: number, existing?: ReviewItem | null): ReviewItem;
/** Only items whose content changed are written (X8 / R5: an identical re-sync writes nothing). */
export declare function changed_items(next: ReviewItem[], existing: Map<string, ReviewItem>): ReviewItem[];
/** Answers the system writes itself — an item closed this way may open again. */
export declare const SYSTEM_CLOSE_ANSWERS: ReadonlySet<string>;
/** Has the USER answered this item (closed with a user answer)? A background writer (sync,
 *  detector, account removal) never overwrites such an item (review round 3 defect 1). */
export declare function is_user_answered(item: ReviewItem | null | undefined): boolean;
/**
 * Which of `next` a BACKGROUND writer may write, judged against the item as it is NOW (`current`,
 * read in the writer's transaction) and as the writer saw it when it planned (`seen`):
 *   - changed since it was read (another writer — an answer, a racing sync — got there first) →
 *     skip; the next run plans from the fresh item;
 *   - created since (not seen, now exists) or deleted since (seen, now gone — e.g. purged) → skip;
 *   - answered by the user → never overwritten.
 * PURE (review round 3 defect 1: a sync planned from an earlier read reverted "Not a bill" /
 * "Track" to open).
 */
export declare function may_background_write(current: ReviewItem | null, seen: ReviewItem | undefined, next?: ReviewItem): boolean;
/** Close an item with an answer (status from the answer). */
export declare function resolve_review_item(item: ReviewItem, answer: ReviewAnswer, now_ms: number, extra?: {
    user_frequency?: string | null;
}): ReviewItem;
export declare function empty_review_state(user_id: string): RecurringReviewState;
/** Hash of the derive-relevant part of the state: only the suppressed ids feed the derive. */
export declare function suppressed_hash(state: RecurringReviewState | null): string;
export interface ReviewStateChange {
    add_suppressed?: string[];
    remove_suppressed?: string[];
    add_dismissed_vendor_keys?: string[];
    /** Forget a "Not a bill" memory (the user converted the vendor after all). */
    remove_dismissed_vendor_keys?: string[];
    detector_last_run_day?: string;
    /** Track answers waiting for their bill (defect 4); an item id already pending is replaced. */
    add_pending_tracks?: PendingTrack[];
    remove_pending_track_ids?: string[];
    /** Replace the open suggested tiles one Plaid item owns (round 4 defect 2). */
    set_suggested_owners?: {
        plaid_item_doc_id: string;
        item_ids: string[];
    };
    /** Round 5: the user's Plaid items that still exist — owner entries of any other item are
     *  dropped (only sent when the sync already loaded the user's items). */
    keep_owner_item_doc_ids?: string[];
}
/**
 * Apply a change to the state. Returns the next state and what changed: `changed` → write it;
 * `suppressed_changed` → the derive's input changed too (bump the derive version, X3). PURE.
 */
export declare function apply_review_state_change(current: RecurringReviewState | null, user_id: string, change: ReviewStateChange): {
    next: RecurringReviewState;
    changed: boolean;
    suppressed_changed: boolean;
};
/** The deterministic held-out cap: sorted, first MAX_SUPPRESSED_TXN_IDS kept (defect 6). PURE. */
export declare function cap_suppressed_ids(ids: string[]): string[];
/** Is this vendor remembered as "Not a bill" / "Not income" for the user? */
export declare function is_vendor_dismissed(state: RecurringReviewState | null, direction: ReviewDirection, vendor_key: string | null): boolean;
/** UTC day key `YYYY-MM-DD`. */
export declare function utc_day(now_ms: number): string;
//# sourceMappingURL=review_item.service.d.ts.map