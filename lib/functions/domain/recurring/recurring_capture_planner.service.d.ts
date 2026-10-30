/**
 * Recurring Capture Planner (Convert-To-Recurring Phase 1) — what a recurring sync does with each
 * Plaid stream under the new capture rules. PURE: the orchestrator loads, this decides, repos write.
 *
 * It only ever changes behavior for (a) records stamped v2 and (b) NEW streams while the user's
 * flag is on. A record that existed without the stamp is passed through exactly as today (D13).
 *
 * Per stream:
 *   - OLD record (no stamp)   → saved as today; stale-marked as today.
 *   - v2 record               → ALWAYS saved (X10, whatever Plaid's status / frequency says);
 *                               `is_active` stays OURS, Plaid's flag goes to `plaid_is_active`;
 *                               a shown bill that CHANGES to Plaid-inactive opens "Still a bill?"
 *                               (X2, D5); back to active closes it. Never stale-marked: a v2 bill
 *                               Plaid stops returning is asked about instead (D19), a rejected one
 *                               is left alone (gap 8).
 *   - NEW stream, flag off    → today's handling (saved, unstamped).
 *   - NEW stream, flag on:
 *       first seen inactive   → today's handling (X2: no active bill, no question);
 *       tombstoned            → skipped (D17);
 *       answered "track" / "keep separate" → created v2 (with the picked schedule, D8);
 *       vendor "Not a bill"   → skipped (X14: a maturing stream checks dismissals);
 *       low confidence        → no record; one `suggested` item per vendor (D6/D8, X14) when the
 *                               stream may be suggested at all (no transfers; income gates, X17);
 *       mature                → created v2 (stamped at creation, X1).
 * Every NEW stream not saved has its Plaid transaction ids held out of fuzzy bill matching (X3)
 * — they're normal transactions, never linked to an old bill by a merchant guess.
 *
 * @module domain/recurring/recurring_capture_planner
 */
import type { InflowForPersistence, OutflowForPersistence } from "../../integrations/plaid/plaid_recurring_transformer";
import { PendingTrack, RecurringReviewState, ReviewDirection, ReviewItem, ReviewStateChange } from "./review_item.service";
import type { AbsorbedStream } from "./convert_recurring.service";
import { AbsorbWrite } from "./absorb.service";
/** A stored record as the planner sees it (see `CaptureRecordInfo` in the sync resolver). */
export interface PlannerRecord {
    id: string;
    direction: ReviewDirection;
    is_active: boolean;
    is_hidden: boolean;
    v2: boolean;
    plaid_is_active: boolean | null;
    plaid_inactive_ack_ms: number | null;
    merged_into_id: string | null;
    account_id: string;
    plaid_item_id: string;
    source: string;
    name: string;
    merchant_name: string | null;
    description: string | null;
    average_amount: number;
    frequency: string;
    plaid_status: string;
    plaid_detailed_category: string;
    first_date_ms: number;
    last_date_ms: number;
    removal_intervals: Array<{
        from_ms: number;
        to_ms: number | null;
        mode: string;
    }>;
    transaction_ids: string[];
    /** The user's own name for it (wins over Plaid's merchant / description in `name`). */
    custom_name?: string | null;
    vendor_key?: string | null;
    expected_amount_override?: number | null;
    user_frequency?: string | null;
    absorbed_streams?: AbsorbedStream[];
    absorbed_txn_ids?: string[];
}
/** One Plaid stream of the response (identified; on an active account). */
export interface PlannerStream {
    direction: ReviewDirection;
    stream_id: string;
    /** The transformed entity, or null when it failed validation (rejected). */
    entity: OutflowForPersistence | InflowForPersistence | null;
    raw_status: string;
    raw_frequency: string;
    raw_is_active: boolean;
    account_id: string;
    account_type: string | null;
    merchant_name: string | null;
    description: string | null;
    detailed_category: string;
    transaction_ids: string[];
    average_amount: number;
    predicted_next_ms: number | null;
    /** Plaid's first payment date of the stream (ms; 0 when unknown). */
    first_date_ms: number;
}
export interface CapturePlanInput {
    user_id: string;
    plaid_item_doc_id: string;
    now_ms: number;
    flag_on: boolean;
    streams: PlannerStream[];
    /** Stored records for the response's stream ids (ANY state). */
    existing: Map<string, PlannerRecord>;
    /** Today's stale candidates (this item's active records not among the VALID stream ids). */
    stale_candidates: PlannerRecord[];
    review_items: Map<string, ReviewItem>;
    state: RecurringReviewState | null;
    /**
     * Same-bill candidates beyond this response's own records (D7): the user's active records, and
     * — once loaded lazily (X9) — their inactive ones, with the user's active account ids (an
     * account-removal soft delete is never "stopped").
     */
    same_bill?: {
        candidates: PlannerRecord[];
        active_account_ids: Set<string>;
        inactive_loaded: boolean;
    };
    /**
     * The user's OTHER active Plaid items (round 4 defect 2) — loaded only when the plan asks
     * (`wants_other_items`): a track whose stream is gone from this item is handed to them rather
     * than lost. Undefined = not loaded.
     */
    other_item_doc_ids?: string[];
}
export interface CapturePlan {
    save_outflows: OutflowForPersistence[];
    save_inflows: InflowForPersistence[];
    /** Mark stale exactly as today (old records only). */
    stale_outflow_ids: string[];
    stale_inflow_ids: string[];
    /** v2 records Plaid stopped returning → `plaidIsActive=false` (+ "Still a bill?"). */
    plaid_inactive_outflow_ids: string[];
    plaid_inactive_inflow_ids: string[];
    /** Every item this sync wants to exist, at its current content (caller writes changed ones). */
    review_items: ReviewItem[];
    state_change: ReviewStateChange;
    /** A new v2 stream found no same-bill candidate among the loaded records: load the user's
     *  inactive records and plan again (X9 — lazy, ≈ never in steady state). */
    wants_inactive_records?: boolean;
    /** The state change that doesn't depend on any save (held-out ids of streams not saved, …). */
    base_change?: BaseChange;
    /** What each save brings with it (released ids, closed items) — dropped when its save fails
     *  (review round 3 defect 3). `state_change` = base_change + every effect. */
    save_effects?: SaveEffect[];
    /** A track's stream is gone from this item and no other stream / bill of its vendor is known:
     *  load the user's other Plaid items and plan again (round 4 defect 2 — ≈ never). */
    wants_other_items?: boolean;
    /** Other Plaid items a track was just handed to: the caller re-syncs them now. */
    handoff_item_doc_ids?: string[];
    /** Converted records that absorb a stream this sync (D42): one stamped write each. */
    absorbs?: AbsorbWrite[];
}
/** The state / item changes that follow from saving one stream's record. */
export interface SaveEffect {
    direction: ReviewDirection;
    stream_id: string;
    /** Held-out ids released because this stream's record now exists. */
    release: string[];
    /** Review items closed because of this save (e.g. "matured"). */
    item_ids: string[];
    /** Pending tracks this save fulfils (defect 4). */
    remove_pending: string[];
}
/** The part of a plan's state change that doesn't depend on a save. */
export interface BaseChange {
    add_suppressed: string[];
    remove_suppressed: string[];
    remove_pending_track_ids: string[];
    /** Pending tracks replaced in place (handed off / one fewer item awaited — defect 2). */
    add_pending_tracks?: PendingTrack[];
    /** This Plaid item's open suggested tiles, when they changed (defect 2). */
    set_suggested_owners?: {
        plaid_item_doc_id: string;
        item_ids: string[];
    };
    /** Round 5: the user's live Plaid items, when loaded and an owner entry names another one. */
    keep_owner_item_doc_ids?: string[];
}
/** base + effects → the state change; ids both held out and released end released (stream
 *  membership wins). PURE. */
export declare function compose_state_change(base: BaseChange, effects: SaveEffect[]): ReviewStateChange;
/**
 * A save batch failed for these directions: nothing that depended on those saves may land — the
 * held-out ids stay held, the items they would have closed stay as they are, so the next sync
 * (which sees no record yet) does it all again (review round 3 defect 3). PURE.
 */
export declare function drop_failed_saves(plan: CapturePlan, failed: Set<ReviewDirection>): CapturePlan;
/** The review-item ids a sync must look up for this response (X8: getAll, no query). */
export declare function review_ids_for_sync(user_id: string, streams: PlannerStream[], records: PlannerRecord[], 
/** Streams a converted record already absorbed: they never get a tile or a question, so their
 *  two item ids are not looked up on every sync (a missing doc is still billed). */
absorbed_stream_ids?: ReadonlySet<string>): string[];
/**
 * The vendor key a stream is suggested under; a stream with no merchant / description falls back
 * to its stream id under an UPPER-CASE prefix. Real vendor keys are always lower-cased
 * (`vendor_key_from_name`), so the fallback can never collide with a vendor — not even one named
 * "stream:<id>" (it used `stream:<id>`, which such a merchant would produce; extra test).
 */
export declare const STREAM_VENDOR_PREFIX = "STREAM:";
export declare function stream_vendor(s: {
    merchant_name: string | null;
    description: string | null;
    stream_id: string;
}): string;
/** Plan one recurring sync under the capture rules. PURE. */
export declare function plan_recurring_capture(input: CapturePlanInput): CapturePlan;
//# sourceMappingURL=recurring_capture_planner.service.d.ts.map