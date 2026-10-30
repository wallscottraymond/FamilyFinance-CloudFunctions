/**
 * Outflow Repository
 *
 * Handles persistence for recurring expenses (outflows).
 * Supports Plaid sync with upsert logic.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/outflow
 */
import type { RecurringWrittenDoc } from "./recurring_doc_equality";
import { Timestamp } from "firebase-admin/firestore";
import { WriteResult, BatchWriteResult, ReadOptions, TraceContext } from "../types";
import { OutflowForPersistence } from "../integrations/plaid/plaid_recurring_transformer";
import { RemovalInterval } from "../domain/recurring/recurring_suppression.service";
import { ConvertEntityView } from "./convert_doc_fields";
import { ManualSettledOccurrences } from "./manual_settlement_doc";
/**
 * Outflow entity in snake_case (internal representation).
 */
export interface Outflow {
    id: string;
    user_id: string;
    group_ids: string[];
    is_active: boolean;
    created_at: Timestamp;
    updated_at: Timestamp;
    plaid_item_id: string;
    plaid_stream_id: string;
    account_id: string;
    last_amount: number;
    average_amount: number;
    amount_min?: number;
    amount_max?: number;
    currency: string;
    expected_amount_override: number | null;
    description: string | null;
    merchant_name: string | null;
    user_custom_name: string | null;
    frequency: string;
    first_date: Timestamp;
    last_date: Timestamp;
    predicted_next_date: Timestamp | null;
    plaid_primary_category: string;
    plaid_detailed_category: string;
    internal_primary_category: string | null;
    internal_detailed_category: string | null;
    expense_type: string;
    is_essential: boolean;
    type?: string;
    status: string;
    source: string;
    plaid_status: string;
    plaid_confidence_level: string | null;
    is_hidden: boolean;
    is_user_modified: boolean;
    transaction_ids: string[];
    tags: string[];
    rules: unknown[];
    removed_by_user: boolean;
    removal_intervals: RemovalInterval[];
    manual_settled_occurrences: ManualSettledOccurrences;
    /** `2` = created under the new capture rules (stamped at creation only). */
    capture_rules_version: number | null;
    /** Plaid's own active flag, kept for v2 records (their `is_active` is OURS, not Plaid's). */
    plaid_is_active: boolean | null;
    /** When the user answered "Still a bill" to a Plaid-inactive v2 record (ms). */
    plaid_inactive_ack_at_ms: number | null;
    /** Set when this record was merged into another (Phase 2) — hidden from Removed / no Restore. */
    merged_into_id: string | null;
    /** Vendor key (D1), the converting transaction, the day it was created by the new path. */
    vendor_key?: string | null;
    converted_from_txn_id?: string | null;
    converted_at_ms?: number | null;
    /** Plaid streams absorbed into this record (D42) and the Plaid payment ids it claims. */
    absorbed_streams?: ConvertEntityView["absorbed_streams"];
    absorbed_txn_ids?: string[];
    retro_txn_ids?: string[];
    retro_linked_at_ms?: number | null;
    converted_from_split_ids?: string[];
    /** The schedule the user picked when tracking a suggestion (D8). */
    user_frequency?: string | null;
    /** Set on a record merged into another (D7 / D22 / D41): what undo needs. */
    merge_log?: ConvertEntityView["merge_log"];
    last_synced_at?: Timestamp;
}
/**
 * Outflow Repository
 *
 * All write operations automatically create audit entries.
 */
export declare const outflow_repo: {
    /**
     * Reactivates (un-soft-deletes) the given outflow IDs in batches. The caller
     * decides which IDs to restore; the repo only persists isActive/restoredAt.
     * Returns the number of docs written.
     */
    /** Ids on this account that the account-removal cascade turned off (`deactivatedReason:
     *  "account_removed"`). A outflow the user had already removed is not among them. */
    get_ids_removed_with_account(_ctx: TraceContext, account_id: string): Promise<string[]>;
    restore_by_ids(ctx: TraceContext, ids: string[]): Promise<number>;
    /**
     * Persist a user's remove/pause/restore state — the derived `removal_intervals`
     * (source of truth for on-read suppression) + the `removed_by_user` denorm.
     * Preserved across Plaid re-sync by `save_batch`. Records an audit entry.
     */
    set_removal_intervals(ctx: TraceContext, id: string, intervals: RemovalInterval[], removed_by_user: boolean, user_id: string): Promise<WriteResult>;
    /**
     * Sync the outflow's materialized periods' `isActive` to the suppression state.
     * A period whose bucket END falls inside a removal interval → `isActive=false`, so it
     * drops out of `user_summaries` (whose builder queries only `isActive == true`) and
     * therefore out of the live list + totals; otherwise `isActive=true` (restore/reactivate).
     * Only docs whose flag actually changes are written, keeping the summary-recompute
     * fan-out minimal. The durable source of truth stays `removalIntervals` on the def
     * (survives Plaid re-sync); this just keeps the materialized read in step. Returns the
     * number of periods flipped.
     */
    apply_period_suppression(ctx: TraceContext, id: string, intervals: RemovalInterval[], user_id: string, opts?: {
        dry_run?: boolean;
        touch_updated_at?: boolean;
        /** The one-off re-snap's scope (round 4 defect 4, `resnap_period_decision`): flip only
         *  periods still in the old whole-period rule's state where the month rule differs. */
        resnap?: boolean;
        /** Re-snap only: counts stored-active periods both rules say are inactive (not flipped). */
        stats?: {
            in_window_active: number;
        };
    }): Promise<number>;
    /**
     * Set ("Mark as paid") or clear (null) ONE occurrence's manual mark, keyed by its UTC
     * due date `YYYY-MM-DD`, in a transaction. Only the `set_occurrence_settled` orchestrator
     * calls this. Records an audit entry.
     */
    set_manual_settlement(ctx: TraceContext, id: string, date_key: string, mark: {
        amount: number;
        marked_by: string;
    } | null, user_id: string): Promise<WriteResult>;
    /**
     * Delete every stored period of an outflow (its own aggregate) — the "Delete permanently" path,
     * before the doc itself: a period left behind stays a match candidate and shows in the summaries.
     */
    delete_periods(ctx: TraceContext, id: string, user_id: string): Promise<number>;
    /**
     * Permanently delete an outflow doc — irreversible ("Delete permanently").
     */
    hard_delete(ctx: TraceContext, id: string, user_id: string): Promise<WriteResult>;
    /**
     * Gets an outflow by ID.
     */
    get_by_id(_ctx: TraceContext, id: string, options?: ReadOptions): Promise<Outflow | null>;
    /**
     * Gets all outflows for a user.
     */
    get_by_user_id(_ctx: TraceContext, user_id: string, options?: ReadOptions): Promise<Outflow[]>;
    /**
     * Gets outflows by Plaid item ID.
     */
    get_by_plaid_item_id(_ctx: TraceContext, plaid_item_id: string, options?: ReadOptions): Promise<Outflow[]>;
    /**
     * Gets outflows by account ID.
     *
     * Used by resolvers to find recurring outflows linked to a specific account
     * for cascade operations (e.g., account removal).
     *
     * @param ctx - Trace context
     * @param account_id - Plaid account ID
     * @param options - Read options
     * @returns Array of outflow entities linked to this account
     */
    get_by_account_id(ctx: TraceContext, account_id: string, options?: ReadOptions): Promise<Outflow[]>;
    /**
     * Finds an outflow by Plaid stream ID.
     *
     * Since stream_id is used as the document ID, this is a direct lookup.
     */
    find_by_plaid_stream_id(ctx: TraceContext, plaid_stream_id: string): Promise<Outflow | null>;
    /**
     * Finds all outflows by multiple Plaid stream IDs.
     *
     * Returns a Map for efficient lookup.
     */
    find_by_plaid_stream_ids(_ctx: TraceContext, plaid_stream_ids: string[]): Promise<Map<string, Outflow>>;
    /** Map a raw stored doc (from `get_raw_by_ids`) to the entity — no read. */
    entity_from_raw(raw: Record<string, unknown>): Outflow;
    /**
     * The stored docs (raw camelCase, ANY state — active, inactive, stale) for the given ids, ONE
     * batched read. Missing ids are absent from the map. The recurring sync prefetches with this and
     * hands the map to `save_batch` (which then skips its own identical read).
     */
    get_raw_by_ids(_ctx: TraceContext, ids: string[]): Promise<Map<string, Record<string, unknown>>>;
    /** A user's INACTIVE records (stopped / stale / soft-deleted) — loaded lazily by the capture
     *  planner only when a new v2 stream needs a same-bill candidate (X9). */
    /**
     * ACTIVE records that carry removal intervals (the D27 one-off re-snap's input): id, owner and
     * intervals only (`select`). All users unless `user_id`. Read-only.
     */
    list_active_with_removal_intervals(_ctx: TraceContext, user_id?: string): Promise<Array<{
        id: string;
        owner_id: string;
        removal_intervals: RemovalInterval[];
        v2: boolean;
    }>>;
    get_inactive_by_user_id(_ctx: TraceContext, user_id: string): Promise<Outflow[]>;
    /**
     * Record Plaid's opinion on v2 records Plaid stopped returning (D19: they are not stale-marked;
     * the user is asked "Still a bill?"). Writes only docs whose value changes. Stamped with the
     * sync run so the recurring trigger leaves the bump to the sync.
     */
    set_plaid_is_active(ctx: TraceContext, ids: string[], value: boolean, user_id: string, run_id?: string): Promise<number>;
    /** "Still a bill" answer on a v2 record: remember it (preserved across syncs) so it isn't asked again. */
    set_plaid_inactive_ack(ctx: TraceContext, id: string, ack_ms: number, user_id: string): Promise<void>;
    /**
     * Saves a batch of outflows with upsert logic.
     *
     * For each outflow:
     * - If exists: update with Plaid data, preserve user modifications
     * - If new: create with pending_review status
     */
    save_batch(ctx: TraceContext, entities: OutflowForPersistence[], run_id?: string, prefetched?: Map<string, Record<string, unknown>>): Promise<BatchWriteResult & {
        written: RecurringWrittenDoc[];
    }>;
    /**
     * A brand-new outflow document (and its ref), built by the SAME mapper `save_batch` uses, for a
     * caller that creates it inside its own Firestore transaction (Convert-To-Recurring: the record
     * and the converted split's pin land together). Stamped with the creator's run id so the
     * create / update triggers skip it — the creator generates the periods and runs the single
     * follow-up itself.
     */
    build_new_doc(entity: OutflowForPersistence, run_id: string): {
        ref: FirebaseFirestore.DocumentReference;
        data: Record<string, unknown>;
    };
    /**
     * Record what an absorb changed on a converted outflow (D42): its absorbed streams and their payment
     * ids — nothing else, never Plaid's numbers. Stamped with the sync run so the update trigger
     * neither bumps nor reconciles (the sync does both once).
     */
    record_absorbed(_ctx: TraceContext, id: string, streams: import("../domain/recurring/convert_recurring.service").AbsorbedStream[], txn_ids: string[], run_id: string): Promise<void>;
    /**
     * Apply a same-bill merge to the OLD outflow in ONE stamped write: its end interval, `mergedIntoId`,
     * `mergeLog`, and active again (its history keeps showing). The caller flips the stored periods
     * (`apply_period_suppression`) and bumps after.
     */
    apply_merge(_ctx: TraceContext, id: string, plan: {
        intervals: RemovalInterval[];
        merged_into_id: string;
        merge_log: import("../domain/recurring/convert_recurring.service").MergeLog;
    }, run_id: string): Promise<void>;
    /** Undo a merge on the OLD outflow: its intervals back, the merge fields gone. One stamped write. */
    clear_merge(_ctx: TraceContext, id: string, intervals: RemovalInterval[], run_id: string, prior_is_active?: boolean): Promise<void>;
    /** The user's outflows merged into `into_id` (a delete of the target unmerges them). */
    get_merged_into(_ctx: TraceContext, user_id: string, into_id: string): Promise<Array<{
        id: string;
    }>>;
    /** Reset the inherited name / override on the NEW outflow (undo). Stamped. */
    revert_inherited(_ctx: TraceContext, id: string, fields: {
        name: boolean;
        override: boolean;
    }, run_id: string): Promise<void>;
    /**
     * Claim the right to RESUME a died convert: one resume at a time (a lease of 330 s: longer than the callable's 300 s timeout; it expires, so a died resume can be retried), so a
     * concurrent double tap returns the bill instead of repeating the work. Stamped.
     */
    claim_resume(_ctx: TraceContext, id: string, now_ms: number): Promise<boolean>;
    /** Does this outflow have any stored period? (A resumed convert generates them only when none exist.) */
    has_periods(_ctx: TraceContext, id: string): Promise<boolean>;
    /** The convert's periods + follow-up pass finished: a resume may skip them. Stamped (no trigger fan-out). */
    mark_follow_ups_done(_ctx: TraceContext, id: string, at_ms: number, run_id: string): Promise<void>;
    /** Give the resume lease back (a convert that could not finish: the next tap resumes at once). */
    release_resume_lease(_ctx: TraceContext, id: string, run_id: string): Promise<void>;
    /**
     * Stamp "the convert's retro-link finished" on a converted record. Stamped with the creator's run
     * id so the update trigger leaves the bump to the creator (no second bump, no reconcile).
     */
    mark_retro_linked(_ctx: TraceContext, id: string, at_ms: number, run_id: string): Promise<void>;
    /**
     * Soft-deletes an outflow.
     */
    soft_delete(ctx: TraceContext, id: string, user_id: string, reason?: "account_removed"): Promise<WriteResult>;
    /**
     * Marks outflows as inactive when Plaid no longer reports them.
     */
    mark_stale(ctx: TraceContext, stream_ids: string[], user_id: string): Promise<WriteResult[]>;
    /**
     * Mark recurring outflows as HIDDEN (durable exclusion of internal account
     * transfers). `isHidden` is preserved by `save_batch` across re-syncs, so once
     * set it survives Plaid recreating the stream. Idempotent.
     */
    mark_hidden(ctx: TraceContext, stream_ids: string[], hidden: boolean, user_id: string): Promise<WriteResult[]>;
};
//# sourceMappingURL=outflow.repo.d.ts.map