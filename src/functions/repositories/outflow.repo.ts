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
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  WriteResult,
  BatchWriteResult,
  ReadOptions,
  TraceContext,
  create_write_result,
  chunk_for_batch,
} from "../types";
import { OutflowForPersistence } from "../integrations/plaid/plaid_recurring_transformer";
import {
  RemovalInterval,
  RemovalMode,
  is_stored_period_active,
  resnap_period_decision,
  stored_occurrence_due_ms,
} from "../domain/recurring/recurring_suppression.service";
import { record_audit_entry_async } from "../audit";
import {
  ConvertDocFields,
  ConvertEntityView,
  carried_convert_fields,
  map_convert_fields_to_entity,
} from "./convert_doc_fields";
import { is_unchanged_recurring_doc } from "./recurring_doc_equality";
import {
  ManualSettledOccurrences,
  ManualSettledOccurrencesDoc,
  map_manual_settled_occurrences,
  write_manual_settlement,
} from "./manual_settlement_doc";

/**
 * Firestore collection name.
 */
const COLLECTION = "outflows";

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

  // Plaid references
  plaid_item_id: string;
  plaid_stream_id: string;
  account_id: string;

  // Financial data
  last_amount: number;
  average_amount: number;
  amount_min?: number;
  amount_max?: number;
  currency: string;
  // User-set expected amount ("this + future"). When non-null it OVERRIDES
  // `average_amount` everywhere the expected amount is derived. Preserved across
  // Plaid re-sync (Plaid never sets it), so it's sticky. null = use Plaid's average.
  expected_amount_override: number | null;

  // Description
  description: string | null;
  merchant_name: string | null;
  user_custom_name: string | null;

  // Timing
  frequency: string;
  first_date: Timestamp;
  last_date: Timestamp;
  predicted_next_date: Timestamp | null;

  // Categories
  plaid_primary_category: string;
  plaid_detailed_category: string;
  internal_primary_category: string | null;
  internal_detailed_category: string | null;

  // Classification
  expense_type: string;
  is_essential: boolean;
  type?: string;

  // Status
  status: string;
  source: string;
  plaid_status: string;
  plaid_confidence_level: string | null;
  is_hidden: boolean;
  is_user_modified: boolean;

  // References
  transaction_ids: string[];
  tags: string[];
  rules: unknown[];

  // User remove/pause state (Remove-Recover-Recurring). Suppression is derived on
  // read from `removal_intervals`; `removed_by_user` is a denorm ("has an open,
  // indefinite removal") for cheap filtering. Both preserved across Plaid re-sync.
  removed_by_user: boolean;
  removal_intervals: RemovalInterval[];

  // "Mark as paid / received" marks keyed by UTC due date `YYYY-MM-DD` (a payment made outside
  // the linked accounts). Applied on read by domain/recurring/manual_settlement — a real
  // payment always wins. Preserved across Plaid re-sync. Absent/empty = none.
  manual_settled_occurrences: ManualSettledOccurrences;

  // Convert-To-Recurring capture rules (Phase 1). All null on records created before the release /
  // with the flag off — those keep today's behavior forever (D13).
  /** `2` = created under the new capture rules (stamped at creation only). */
  capture_rules_version: number | null;
  /** Plaid's own active flag, kept for v2 records (their `is_active` is OURS, not Plaid's). */
  plaid_is_active: boolean | null;
  /** When the user answered "Still a bill" to a Plaid-inactive v2 record (ms). */
  plaid_inactive_ack_at_ms: number | null;
  /** Set when this record was merged into another (Phase 2) — hidden from Removed / no Restore. */
  merged_into_id: string | null;

  // Convert-To-Recurring Phase 2 (all server-only; absent on every record that predates it).
  /** Vendor key (D1), the converting transaction, the day it was created by the new path. */
  vendor_key?: string | null;
  converted_from_txn_id?: string | null;
  converted_at_ms?: number | null;
  /** Plaid streams absorbed into this record (D42) and the Plaid payment ids it claims. */
  absorbed_streams?: ConvertEntityView["absorbed_streams"];
  absorbed_txn_ids?: string[];
  /** Set on a record merged into another (D7 / D22 / D41): what undo needs. */
  merge_log?: ConvertEntityView["merge_log"];

  // Sync tracking
  last_synced_at?: Timestamp;
}

/** Stored (camelCase) shape of a removal interval on the outflow doc. */
/* eslint-disable @typescript-eslint/naming-convention */
interface RemovalIntervalDoc {
  fromMs: number;
  toMs: number | null;
  mode: RemovalMode;
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Legacy Firestore document structure (camelCase).
 * Used for reading/writing to maintain backwards compatibility.
 */
/* eslint-disable @typescript-eslint/naming-convention */
interface LegacyOutflowDoc extends ConvertDocFields {
  id: string;
  ownerId: string;
  createdBy: string;
  updatedBy: string;
  groupId?: string | null;
  groupIds?: string[];
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  // Plaid references
  plaidItemId: string;
  accountId: string;

  // Financial data
  lastAmount: number;
  averageAmount: number;
  currency: string;
  // User-set expected-amount override (see Outflow.expected_amount_override).
  expectedAmountOverride?: number | null;

  // Description
  description: string | null;
  merchantName: string | null;
  userCustomName: string | null;

  // Timing
  frequency: string;
  firstDate: Timestamp;
  lastDate: Timestamp;
  predictedNextDate: Timestamp | null;

  // Categories
  plaidPrimaryCategory: string;
  plaidDetailedCategory: string;
  internalPrimaryCategory: string | null;
  internalDetailedCategory: string | null;

  // Classification
  expenseType?: string;
  isEssential?: boolean;
  type?: string;

  // Status
  source: string;
  plaidStatus?: string;
  plaidConfidenceLevel?: string | null;
  isHidden: boolean;
  isUserModified: boolean;

  // References
  transactionIds: string[];
  tags: string[];
  rules: unknown[];

  // User remove/pause state (preserved across Plaid re-sync, like isHidden).
  removedByUser?: boolean;
  removalIntervals?: RemovalIntervalDoc[];
  // "Mark as paid / received" marks (see the entity field). Written only by the
  // set_occurrence_settled callable; preserved across Plaid re-sync.
  manualSettledOccurrences?: ManualSettledOccurrencesDoc;

  // Convert-To-Recurring capture rules (X1): every one is written ONLY when present (conditional
  // spread in `map_persistence_to_doc`), so a doc without them stays byte-identical across syncs.
  captureRulesVersion?: number;
  plaidIsActive?: boolean;
  plaidInactiveAckAt?: Timestamp;
  mergedIntoId?: string;
  /** The schedule the user picked when tracking a Plaid suggestion (D8); wins over Plaid's. */
  userFrequency?: string;

  // Sync tracking
  lastSyncedAt?: Timestamp;
}
/* eslint-enable @typescript-eslint/naming-convention */

/** Map stored interval docs → domain intervals (defaults to empty). */
function map_removal_intervals(docs?: RemovalIntervalDoc[]): RemovalInterval[] {
  return (docs ?? []).map((d) => ({ from_ms: d.fromMs, to_ms: d.toMs, mode: d.mode }));
}

/** Map domain intervals → stored interval docs. */
function to_removal_interval_docs(intervals: RemovalInterval[]): RemovalIntervalDoc[] {
  /* eslint-disable @typescript-eslint/naming-convention */
  return intervals.map((i) => ({ fromMs: i.from_ms, toMs: i.to_ms, mode: i.mode }));
  /* eslint-enable @typescript-eslint/naming-convention */
}

/**
 * Maps legacy Firestore document to Outflow entity.
 */
function map_to_entity(doc: LegacyOutflowDoc): Outflow {
  return {
    id: doc.id,
    user_id: doc.ownerId,
    group_ids: doc.groupIds ?? (doc.groupId ? [doc.groupId] : []),
    is_active: doc.isActive,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,

    plaid_item_id: doc.plaidItemId,
    plaid_stream_id: doc.id, // stream_id is the document ID
    account_id: doc.accountId,

    last_amount: doc.lastAmount,
    average_amount: doc.averageAmount,
    amount_min: undefined, // Legacy docs may not have this
    amount_max: undefined,
    currency: doc.currency,
    expected_amount_override: doc.expectedAmountOverride ?? null,

    description: doc.description,
    merchant_name: doc.merchantName,
    user_custom_name: doc.userCustomName,

    frequency: doc.frequency,
    first_date: doc.firstDate,
    last_date: doc.lastDate,
    predicted_next_date: doc.predictedNextDate,

    plaid_primary_category: doc.plaidPrimaryCategory,
    plaid_detailed_category: doc.plaidDetailedCategory,
    internal_primary_category: doc.internalPrimaryCategory,
    internal_detailed_category: doc.internalDetailedCategory,

    expense_type: doc.expenseType ?? "other",
    is_essential: doc.isEssential ?? false,
    type: doc.type,

    status: "active",
    source: doc.source,
    plaid_status: doc.plaidStatus ?? "UNKNOWN",
    plaid_confidence_level: doc.plaidConfidenceLevel ?? null,
    is_hidden: doc.isHidden,
    is_user_modified: doc.isUserModified,

    transaction_ids: doc.transactionIds,
    tags: doc.tags,
    rules: doc.rules,

    removed_by_user: doc.removedByUser ?? false,
    removal_intervals: map_removal_intervals(doc.removalIntervals),
    manual_settled_occurrences: map_manual_settled_occurrences(doc.manualSettledOccurrences),

    capture_rules_version: doc.captureRulesVersion ?? null,
    plaid_is_active: doc.plaidIsActive ?? null,
    plaid_inactive_ack_at_ms: doc.plaidInactiveAckAt?.toMillis?.() ?? null,
    merged_into_id: doc.mergedIntoId ?? null,
    ...map_convert_fields_to_entity(doc),

    last_synced_at: doc.lastSyncedAt,
  };
}

/**
 * Maps OutflowForPersistence to legacy Firestore document.
 */
function map_persistence_to_doc(
  entity: OutflowForPersistence,
  now: Timestamp,
  existing?: LegacyOutflowDoc | null
): LegacyOutflowDoc {
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    id: entity.id,
    ownerId: entity.owner_id,
    createdBy: entity.created_by,
    updatedBy: entity.updated_by,
    groupId: entity.group_ids[0] ?? null,
    groupIds: entity.group_ids,
    isActive: entity.is_active,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,

    plaidItemId: entity.plaid_item_id,
    accountId: entity.account_id,

    lastAmount: entity.last_amount,
    averageAmount: entity.average_amount,
    // Preserve the user's expected-amount override across Plaid re-sync (Plaid
    // refreshes averageAmount, but the override keeps driving the expected value).
    expectedAmountOverride: existing?.expectedAmountOverride ?? entity.expected_amount_override ?? null,
    currency: entity.currency,

    description: entity.description,
    merchantName: entity.merchant_name,
    userCustomName: existing?.userCustomName ?? entity.user_custom_name,

    // A schedule the user picked (tracking a Plaid suggestion, D8) wins over Plaid's guess.
    frequency: existing?.userFrequency ?? entity.user_frequency ?? entity.frequency,
    firstDate: Timestamp.fromDate(entity.first_date),
    lastDate: Timestamp.fromDate(entity.last_date),
    predictedNextDate: entity.predicted_next_date
      ? Timestamp.fromDate(entity.predicted_next_date)
      : null,

    plaidPrimaryCategory: entity.plaid_primary_category,
    plaidDetailedCategory: entity.plaid_detailed_category,
    internalPrimaryCategory: existing?.internalPrimaryCategory ?? entity.internal_primary_category,
    internalDetailedCategory:
      existing?.internalDetailedCategory ?? entity.internal_detailed_category,

    expenseType: entity.expense_type,
    isEssential: entity.is_essential,
    type: existing?.type ?? "recurring",

    source: entity.source,
    plaidStatus: entity.plaid_status,
    plaidConfidenceLevel: entity.plaid_confidence_level,
    isHidden: existing?.isHidden ?? entity.is_hidden,
    isUserModified: existing?.isUserModified ?? entity.is_user_modified,

    transactionIds: entity.transaction_ids,
    tags: existing?.tags ?? entity.tags,
    rules: existing?.rules ?? entity.rules,

    // Preserve user remove/pause state across re-sync (Plaid never sets these).
    removedByUser: existing?.removedByUser ?? false,
    removalIntervals: existing?.removalIntervals ?? [],
    // Preserve "Mark as paid / received" marks across re-sync (Plaid never sets them). Only
    // written when present, so a doc without marks is byte-identical (no rewrite fan-out).
    ...(existing?.manualSettledOccurrences
      ? { manualSettledOccurrences: existing.manualSettledOccurrences }
      : {}),

    // Convert-To-Recurring (X1): preserved with CONDITIONAL spreads, flag on or off — never
    // `?? null` (that would add a key to every existing doc and rewrite all of them on the first
    // sync). The stamp is only ever ADDED at creation (`entity.capture_rules_version` is set by the
    // capture planner for new records only); an existing doc keeps whatever it has.
    ...(existing?.captureRulesVersion !== undefined
      ? { captureRulesVersion: existing.captureRulesVersion }
      : !existing && entity.capture_rules_version !== undefined
        ? { captureRulesVersion: entity.capture_rules_version }
        : {}),
    ...(entity.plaid_is_active !== undefined
      ? { plaidIsActive: entity.plaid_is_active }
      : existing?.plaidIsActive !== undefined
        ? { plaidIsActive: existing.plaidIsActive }
        : {}),
    ...(existing?.plaidInactiveAckAt ? { plaidInactiveAckAt: existing.plaidInactiveAckAt } : {}),
    ...(existing?.mergedIntoId ? { mergedIntoId: existing.mergedIntoId } : {}),
    ...(existing?.userFrequency
      ? { userFrequency: existing.userFrequency }
      : entity.user_frequency
        ? { userFrequency: entity.user_frequency }
        : {}),
    // Convert-To-Recurring Phase 2: carried through this full-document set (conditional keys only).
    ...carried_convert_fields(existing, entity),

    lastSyncedAt: now,
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

/**
 * Gets Firestore document reference.
 */
function doc_ref(id: string): FirebaseFirestore.DocumentReference {
  return getFirestore().collection(COLLECTION).doc(id);
}

/**
 * Outflow Repository
 *
 * All write operations automatically create audit entries.
 */
export const outflow_repo = {
  /**
   * Reactivates (un-soft-deletes) the given outflow IDs in batches. The caller
   * decides which IDs to restore; the repo only persists isActive/restoredAt.
   * Returns the number of docs written.
   */
  async restore_by_ids(ctx: TraceContext, ids: string[]): Promise<number> {
    if (ids.length === 0) {
      return 0;
    }
    const db = getFirestore();
    const now = Timestamp.now();
    let restored = 0;
    for (const chunk of chunk_for_batch(ids)) {
      const batch = db.batch();
      for (const id of chunk) {
        /* eslint-disable @typescript-eslint/naming-convention */
        batch.update(doc_ref(id), { isActive: true, restoredAt: now });
        /* eslint-enable @typescript-eslint/naming-convention */
        restored++;
      }
      await batch.commit();
    }
    console.log(`[${ctx.trace_id}] outflow_repo.restore_by_ids: restored=${restored}`);
    return restored;
  },

  /**
   * Persist a user's remove/pause/restore state — the derived `removal_intervals`
   * (source of truth for on-read suppression) + the `removed_by_user` denorm.
   * Preserved across Plaid re-sync by `save_batch`. Records an audit entry.
   */
  async set_removal_intervals(
    ctx: TraceContext,
    id: string,
    intervals: RemovalInterval[],
    removed_by_user: boolean,
    user_id: string
  ): Promise<WriteResult> {
    const before_doc = await doc_ref(id).get();
    if (!before_doc.exists) {
      throw new Error(`Outflow ${id} not found`);
    }
    const before = before_doc.data() as LegacyOutflowDoc;
    const now = Timestamp.now();
    /* eslint-disable @typescript-eslint/naming-convention */
    const after: LegacyOutflowDoc = {
      ...before,
      removedByUser: removed_by_user,
      removalIntervals: to_removal_interval_docs(intervals),
      updatedAt: now,
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    await doc_ref(id).set(after);

    record_audit_entry_async({
      user_id,
      action: "update",
      entity_type: "recurring_outflow",
      entity_id: id,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api", context: { operation: "set_removal_intervals" } },
    });

    return create_write_result("outflow", id, "replace", before, after);
  },

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
  async apply_period_suppression(
    ctx: TraceContext,
    id: string,
    intervals: RemovalInterval[],
    user_id: string,
    opts: {
      dry_run?: boolean;
      touch_updated_at?: boolean;
      /** The one-off re-snap's scope (round 4 defect 4, `resnap_period_decision`): flip only
       *  periods still in the old whole-period rule's state where the month rule differs. */
      resnap?: boolean;
      /** Re-snap only: counts stored-active periods both rules say are inactive (not flipped). */
      stats?: { in_window_active: number };
    } = {}
  ): Promise<number> {
    const db = getFirestore();
    const snap = await db.collection("outflow_periods").where("outflowId", "==", id).get();
    const now = Timestamp.now();
    let flipped = 0;
    let batch = db.batch();
    let batched = 0;
    for (const doc of snap.docs) {
      const p = doc.data();
      const end_ms = (p.periodEndDate as Timestamp | undefined)?.toMillis();
      if (end_ms === undefined) continue;
      // D27: the derive's month rule (a sub-month period stays active while any of its
      // occurrences is in a month that isn't suppressed) — the picker matches the period page.
      let next_active: boolean;
      if (opts.resnap) {
        const d = resnap_period_decision(intervals, end_ms, stored_occurrence_due_ms(p), p.isActive !== false);
        if (d.in_window_active && opts.stats) opts.stats.in_window_active++;
        if (!d.flip) continue;
        next_active = d.next_active;
      } else {
        next_active = is_stored_period_active(intervals, end_ms, stored_occurrence_due_ms(p));
        if ((p.isActive !== false) === next_active) continue; // already in the right state
        // Round 5 test 8: a period turned on by a carried early payment (D28, `carryActive`) is
        // the reconcile's to keep or turn off — turning it off here only for the reconcile to turn
        // it back on was 2 writes on every call.
        if (p.carryActive === true && p.isActive !== false) continue;
      }
      flipped++;
      if (opts.dry_run) continue;
      // The one-off re-snap writes ONLY the flag (`touch_updated_at: false`).
      // eslint-disable-next-line @typescript-eslint/naming-convention
      batch.update(doc.ref, opts.touch_updated_at === false ? { isActive: next_active } : { isActive: next_active, updatedAt: now });
      if (++batched >= 450) {
        await batch.commit();
        batch = db.batch();
        batched = 0;
      }
    }
    if (batched > 0) await batch.commit();
    console.log(
      `[${ctx.trace_id}] outflow_repo.apply_period_suppression ${id}: ${opts.dry_run ? "would flip" : "flipped"} ${flipped}/${snap.size} periods (user ${user_id})`
    );
    return flipped;
  },

  /**
   * Set ("Mark as paid") or clear (null) ONE occurrence's manual mark, keyed by its UTC
   * due date `YYYY-MM-DD`, in a transaction. Only the `set_occurrence_settled` orchestrator
   * calls this. Records an audit entry.
   */
  async set_manual_settlement(
    ctx: TraceContext,
    id: string,
    date_key: string,
    mark: { amount: number; marked_by: string } | null,
    user_id: string
  ): Promise<WriteResult> {
    const { before, after } = await write_manual_settlement(COLLECTION, id, date_key, mark);
    /* eslint-disable @typescript-eslint/naming-convention */
    const before_part = { manualSettledOccurrences: before };
    const after_part = { manualSettledOccurrences: after };
    /* eslint-enable @typescript-eslint/naming-convention */
    record_audit_entry_async({
      user_id,
      action: "update",
      entity_type: "recurring_outflow",
      entity_id: id,
      before: before_part,
      after: after_part,
      trace_id: ctx.trace_id,
      metadata: { source: "api", context: { operation: "set_manual_settlement", date_key } },
    });
    return create_write_result("outflow", id, "merge", before_part, after_part);
  },

  /**
   * Permanently delete an outflow doc — irreversible ("Delete permanently").
   */
  async hard_delete(ctx: TraceContext, id: string, user_id: string): Promise<WriteResult> {
    const before_doc = await doc_ref(id).get();
    if (!before_doc.exists) {
      throw new Error(`Outflow ${id} not found`);
    }
    const before = before_doc.data() as LegacyOutflowDoc;
    await doc_ref(id).delete();

    record_audit_entry_async({
      user_id,
      action: "delete",
      entity_type: "recurring_outflow",
      entity_id: id,
      before: before as unknown as Record<string, unknown>,
      after: null,
      trace_id: ctx.trace_id,
      metadata: { source: "api", context: { operation: "hard_delete" } },
    });

    return create_write_result("outflow", id, "replace", before, null);
  },

  /**
   * Gets an outflow by ID.
   */
  async get_by_id(
    _ctx: TraceContext,
    id: string,
    options?: ReadOptions
  ): Promise<Outflow | null> {
    const doc = await doc_ref(id).get();

    if (!doc.exists) {
      return null;
    }

    const data = doc.data() as LegacyOutflowDoc;

    if (!data.isActive && !options?.include_deleted) {
      return null;
    }

    return map_to_entity(data);
  },

  /**
   * Gets all outflows for a user.
   */
  async get_by_user_id(
    _ctx: TraceContext,
    user_id: string,
    options?: ReadOptions
  ): Promise<Outflow[]> {
    const db = getFirestore();
    let query = db.collection(COLLECTION).where("ownerId", "==", user_id);

    if (!options?.include_deleted) {
      query = query.where("isActive", "==", true);
    }

    if (options?.order_by) {
      query = query.orderBy(options.order_by, options.order_direction ?? "asc");
    }

    if (options?.limit) {
      query = query.limit(options.limit);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => map_to_entity(doc.data() as LegacyOutflowDoc));
  },

  /**
   * Gets outflows by Plaid item ID.
   */
  async get_by_plaid_item_id(
    _ctx: TraceContext,
    plaid_item_id: string,
    options?: ReadOptions
  ): Promise<Outflow[]> {
    const db = getFirestore();
    let query = db.collection(COLLECTION).where("plaidItemId", "==", plaid_item_id);

    if (!options?.include_deleted) {
      query = query.where("isActive", "==", true);
    }

    const snapshot = await query.get();
    return snapshot.docs.map((doc) => map_to_entity(doc.data() as LegacyOutflowDoc));
  },

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
  async get_by_account_id(
    ctx: TraceContext,
    account_id: string,
    options?: ReadOptions
  ): Promise<Outflow[]> {
    const db = getFirestore();
    let query = db.collection(COLLECTION).where("accountId", "==", account_id);

    if (!options?.include_deleted) {
      query = query.where("isActive", "==", true);
    }

    const snapshot = await query.get();
    const outflows = snapshot.docs.map((doc) => map_to_entity(doc.data() as LegacyOutflowDoc));

    console.log(
      `[${ctx.trace_id}] get_by_account_id: account=${account_id}, found=${outflows.length}`
    );

    return outflows;
  },

  /**
   * Finds an outflow by Plaid stream ID.
   *
   * Since stream_id is used as the document ID, this is a direct lookup.
   */
  async find_by_plaid_stream_id(
    ctx: TraceContext,
    plaid_stream_id: string
  ): Promise<Outflow | null> {
    return this.get_by_id(ctx, plaid_stream_id);
  },

  /**
   * Finds all outflows by multiple Plaid stream IDs.
   *
   * Returns a Map for efficient lookup.
   */
  async find_by_plaid_stream_ids(
    _ctx: TraceContext,
    plaid_stream_ids: string[]
  ): Promise<Map<string, Outflow>> {
    const result = new Map<string, Outflow>();

    if (plaid_stream_ids.length === 0) {
      return result;
    }

    // Firestore 'in' queries limited to 30 items
    const chunks = chunk_for_batch(plaid_stream_ids, 30);

    for (const chunk of chunks) {
      const db = getFirestore();
      const snapshot = await db
        .collection(COLLECTION)
        .where("__name__", "in", chunk)
        .get();

      for (const doc of snapshot.docs) {
        const data = doc.data() as LegacyOutflowDoc;
        result.set(doc.id, map_to_entity(data));
      }
    }

    return result;
  },

  /** Map a raw stored doc (from `get_raw_by_ids`) to the entity — no read. */
  entity_from_raw(raw: Record<string, unknown>) {
    return map_to_entity(raw as unknown as LegacyOutflowDoc);
  },

  /**
   * The stored docs (raw camelCase, ANY state — active, inactive, stale) for the given ids, ONE
   * batched read. Missing ids are absent from the map. The recurring sync prefetches with this and
   * hands the map to `save_batch` (which then skips its own identical read).
   */
  async get_raw_by_ids(
    _ctx: TraceContext,
    ids: string[]
  ): Promise<Map<string, Record<string, unknown>>> {
    const out = new Map<string, Record<string, unknown>>();
    const db = getFirestore();
    for (const chunk of chunk_for_batch([...new Set(ids)])) {
      if (chunk.length === 0) continue;
      const snaps = await db.getAll(...chunk.map((id) => doc_ref(id)));
      for (const snap of snaps) {
        if (snap.exists) out.set(snap.id, snap.data() as Record<string, unknown>);
      }
    }
    return out;
  },

  /** A user's INACTIVE records (stopped / stale / soft-deleted) — loaded lazily by the capture
   *  planner only when a new v2 stream needs a same-bill candidate (X9). */
  /**
   * ACTIVE records that carry removal intervals (the D27 one-off re-snap's input): id, owner and
   * intervals only (`select`). All users unless `user_id`. Read-only.
   */
  async list_active_with_removal_intervals(
    _ctx: TraceContext,
    user_id?: string
  ): Promise<Array<{ id: string; owner_id: string; removal_intervals: RemovalInterval[]; v2: boolean }>> {
    let q = getFirestore().collection(COLLECTION).where("isActive", "==", true);
    if (user_id) q = q.where("ownerId", "==", user_id);
    const snap = await q.select("ownerId", "removalIntervals", "captureRulesVersion").get();
    return snap.docs
      .map((d) => ({
        id: d.id,
        owner_id: String(d.get("ownerId") ?? ""),
        v2: d.get("captureRulesVersion") === 2,
        removal_intervals: ((d.get("removalIntervals") ?? []) as Array<{ fromMs: number; toMs: number | null; mode: RemovalMode }>)
          .map((i) => ({ from_ms: i.fromMs, to_ms: i.toMs, mode: i.mode })),
      }))
      .filter((r) => r.removal_intervals.length > 0);
  },

  async get_inactive_by_user_id(_ctx: TraceContext, user_id: string): Promise<Outflow[]> {
    const snapshot = await getFirestore()
      .collection(COLLECTION)
      .where("ownerId", "==", user_id)
      .where("isActive", "==", false)
      .get();
    return snapshot.docs.map((doc) => map_to_entity(doc.data() as LegacyOutflowDoc));
  },

  /**
   * Record Plaid's opinion on v2 records Plaid stopped returning (D19: they are not stale-marked;
   * the user is asked "Still a bill?"). Writes only docs whose value changes. Stamped with the
   * sync run so the recurring trigger leaves the bump to the sync.
   */
  async set_plaid_is_active(
    ctx: TraceContext,
    ids: string[],
    value: boolean,
    user_id: string,
    run_id?: string
  ): Promise<number> {
    if (ids.length === 0) return 0;
    const db = getFirestore();
    const now = Timestamp.now();
    let written = 0;
    for (const chunk of chunk_for_batch(ids)) {
      const snaps = await db.getAll(...chunk.map((id) => doc_ref(id)));
      const batch = db.batch();
      let n = 0;
      for (const snap of snaps) {
        if (!snap.exists) continue;
        const before = snap.data() as LegacyOutflowDoc;
        if (before.plaidIsActive === value) continue;
        /* eslint-disable @typescript-eslint/naming-convention */
        const patch: Record<string, unknown> = { plaidIsActive: value, updatedAt: now };
        if (run_id) {
          patch.syncRunId = run_id;
          patch.lastWriteSource = "plaid_sync";
        }
        /* eslint-enable @typescript-eslint/naming-convention */
        batch.update(snap.ref, patch);
        n++;
        record_audit_entry_async({
          user_id,
          action: "update",
          entity_type: "recurring_outflow",
          entity_id: snap.id,
          before: { plaidIsActive: before.plaidIsActive ?? null },
          after: { plaidIsActive: value },
          trace_id: ctx.trace_id,
          metadata: { source: "api", context: { reason: "plaid_inactive_v2" } },
        });
      }
      if (n > 0) await batch.commit();
      written += n;
    }
    return written;
  },

  /** "Still a bill" answer on a v2 record: remember it (preserved across syncs) so it isn't asked again. */
  async set_plaid_inactive_ack(
    ctx: TraceContext,
    id: string,
    ack_ms: number,
    user_id: string
  ): Promise<void> {
    /* eslint-disable @typescript-eslint/naming-convention */
    await doc_ref(id).update({
      plaidInactiveAckAt: Timestamp.fromMillis(ack_ms),
      updatedAt: Timestamp.now(),
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    record_audit_entry_async({
      user_id,
      action: "update",
      entity_type: "recurring_outflow",
      entity_id: id,
      before: null,
      after: { plaidInactiveAckAt: ack_ms },
      trace_id: ctx.trace_id,
      metadata: { source: "api", context: { operation: "still_a_bill" } },
    });
  },

  /**
   * Saves a batch of outflows with upsert logic.
   *
   * For each outflow:
   * - If exists: update with Plaid data, preserve user modifications
   * - If new: create with pending_review status
   */
  async save_batch(
    ctx: TraceContext,
    entities: OutflowForPersistence[],
    /** Sync run writing these: stamped as `syncRunId` so the recurring triggers leave the
     *  period generation + reconcile to the sync (it does them once, inline). */
    run_id?: string,
    /** The stored docs for `entities` ids, already read by the caller (`get_raw_by_ids`) — a
     *  missing key means "doesn't exist". When given, this skips the read below, so the sync's
     *  read count is unchanged by the prefetch. */
    prefetched?: Map<string, Record<string, unknown>>
  ): Promise<BatchWriteResult & { written: RecurringWrittenDoc[] }> {
    if (entities.length === 0) {
      return { results: [], count: 0, success: true, written: [] };
    }
    const written: RecurringWrittenDoc[] = [];

    const db = getFirestore();
    const now = Timestamp.now();
    const results: WriteResult[] = [];

    // Get existing documents for upsert logic — ONE batched read of the raw docs (was an
    // `in` query for existence PLUS a per-doc `.get()` for the data: 2 reads per stream).
    const existing_docs = new Map<string, LegacyOutflowDoc>();
    if (prefetched) {
      for (const [id, d] of prefetched) existing_docs.set(id, d as unknown as LegacyOutflowDoc);
    } else {
      for (const ids of chunk_for_batch(entities.map((e) => e.id))) {
        const snaps = await db.getAll(...ids.map((id) => doc_ref(id)));
        for (const snap of snaps) {
          if (snap.exists) existing_docs.set(snap.id, snap.data() as LegacyOutflowDoc);
        }
      }
    }

    // Process in batches
    const chunks = chunk_for_batch(entities);
    let unchanged = 0;

    for (const chunk of chunks) {
      const batch = db.batch();
      let writes = 0;

      for (const entity of chunk) {
        const existing_doc = existing_docs.get(entity.id) ?? null;
        const existing = existing_doc !== null;

        const doc_data = map_persistence_to_doc(entity, now, existing_doc);
        // Skip a no-op rewrite (only the sync timestamps would change) — avoids a
        // pointless on_recurring_updated fan-out + derive-cache invalidation per stream.
        if (existing_doc && is_unchanged_recurring_doc(existing_doc, doc_data)) {
          unchanged++;
          continue;
        }
        const stamped = run_id
          ? { ...doc_data, syncRunId: run_id, lastWriteSource: "plaid_sync" }
          : doc_data;
        batch.set(doc_ref(entity.id), stamped);
        writes++;
        written.push({
          id: entity.id,
          kind: "outflow",
          created: !existing,
          before: existing_doc as unknown as Record<string, unknown> | null,
          after: stamped as unknown as Record<string, unknown>,
        });

        results.push(
          create_write_result(
            "outflow",
            entity.id,
            existing ? "replace" : "replace",
            existing_doc,
            doc_data
          )
        );

        // Audit entry (async)
        record_audit_entry_async({
          user_id: entity.owner_id,
          action: existing ? "update" : "create",
          entity_type: "recurring_outflow",
          entity_id: entity.id,
          before: existing_doc as unknown as Record<string, unknown> | null,
          after: doc_data as unknown as Record<string, unknown>,
          trace_id: ctx.trace_id,
          metadata: { source: "api" },
        });
      }

      if (writes > 0) await batch.commit();
    }

    console.log(
      `[${ctx.trace_id}] outflow_repo.save_batch: saved=${results.length} unchanged=${unchanged}`
    );

    return {
      results,
      count: entities.length,
      success: true,
      written,
    };
  },

  /**
   * A brand-new outflow document (and its ref), built by the SAME mapper `save_batch` uses, for a
   * caller that creates it inside its own Firestore transaction (Convert-To-Recurring: the record
   * and the converted split's pin land together). Stamped with the creator's run id so the
   * create / update triggers skip it — the creator generates the periods and runs the single
   * follow-up itself.
   */
  build_new_doc(
    entity: OutflowForPersistence,
    run_id: string
  ): { ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> } {
    const doc = map_persistence_to_doc(entity, Timestamp.now(), null);
    /* eslint-disable @typescript-eslint/naming-convention */
    return {
      ref: doc_ref(entity.id),
      data: { ...doc, syncRunId: run_id, lastWriteSource: "convert" } as unknown as Record<string, unknown>,
    };
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  /**
   * Soft-deletes an outflow.
   */
  async soft_delete(
    ctx: TraceContext,
    id: string,
    user_id: string
  ): Promise<WriteResult> {
    const before_doc = await doc_ref(id).get();

    if (!before_doc.exists) {
      throw new Error(`Outflow ${id} not found`);
    }

    const before = before_doc.data() as LegacyOutflowDoc;
    const now = Timestamp.now();

    /* eslint-disable @typescript-eslint/naming-convention */
    const after: LegacyOutflowDoc = {
      ...before,
      isActive: false,
      updatedAt: now,
    };
    /* eslint-enable @typescript-eslint/naming-convention */

    await doc_ref(id).set(after);

    record_audit_entry_async({
      user_id,
      action: "delete",
      entity_type: "recurring_outflow",
      entity_id: id,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api" },
    });

    return create_write_result("outflow", id, "replace", before, after);
  },

  /**
   * Marks outflows as inactive when Plaid no longer reports them.
   */
  async mark_stale(
    ctx: TraceContext,
    stream_ids: string[],
    user_id: string
  ): Promise<WriteResult[]> {
    if (stream_ids.length === 0) {
      return [];
    }

    const db = getFirestore();
    const now = Timestamp.now();
    const results: WriteResult[] = [];
    const chunks = chunk_for_batch(stream_ids);

    for (const chunk of chunks) {
      const batch = db.batch();

      for (const id of chunk) {
        const before_doc = await doc_ref(id).get();
        if (!before_doc.exists) continue;

        const before = before_doc.data() as LegacyOutflowDoc;

        /* eslint-disable @typescript-eslint/naming-convention */
        const after: LegacyOutflowDoc = {
          ...before,
          isActive: false,
          plaidStatus: "STALE",
          updatedAt: now,
        };
        /* eslint-enable @typescript-eslint/naming-convention */

        batch.set(doc_ref(id), after);

        results.push(create_write_result("outflow", id, "replace", before, after));

        record_audit_entry_async({
          user_id,
          action: "update",
          entity_type: "recurring_outflow",
          entity_id: id,
          before: before as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
          trace_id: ctx.trace_id,
          metadata: { source: "api", context: { reason: "marked_stale" } },
        });
      }

      await batch.commit();
    }

    return results;
  },

  /**
   * Mark recurring outflows as HIDDEN (durable exclusion of internal account
   * transfers). `isHidden` is preserved by `save_batch` across re-syncs, so once
   * set it survives Plaid recreating the stream. Idempotent.
   */
  async mark_hidden(
    ctx: TraceContext,
    stream_ids: string[],
    hidden: boolean,
    user_id: string
  ): Promise<WriteResult[]> {
    if (stream_ids.length === 0) {
      return [];
    }
    const db = getFirestore();
    const now = Timestamp.now();
    const results: WriteResult[] = [];
    for (const chunk of chunk_for_batch(stream_ids)) {
      const batch = db.batch();
      for (const id of chunk) {
        const before_doc = await doc_ref(id).get();
        if (!before_doc.exists) continue;
        const before = before_doc.data() as LegacyOutflowDoc;
        if (before.isHidden === hidden) continue; // idempotent
        // eslint-disable-next-line @typescript-eslint/naming-convention
        const after: LegacyOutflowDoc = { ...before, isHidden: hidden, updatedAt: now };
        batch.set(doc_ref(id), after);
        results.push(create_write_result("outflow", id, "replace", before, after));
        record_audit_entry_async({
          user_id,
          action: "update",
          entity_type: "recurring_outflow",
          entity_id: id,
          before: before as unknown as Record<string, unknown>,
          after: after as unknown as Record<string, unknown>,
          trace_id: ctx.trace_id,
          metadata: { source: "api", context: { reason: "internal_transfer_hidden" } },
        });
      }
      await batch.commit();
    }
    return results;
  },
};
