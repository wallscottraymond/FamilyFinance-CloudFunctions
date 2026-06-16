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
import { record_audit_entry_async } from "../audit";

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

  // Sync tracking
  last_synced_at?: Timestamp;
}

/**
 * Legacy Firestore document structure (camelCase).
 * Used for reading/writing to maintain backwards compatibility.
 */
/* eslint-disable @typescript-eslint/naming-convention */
interface LegacyOutflowDoc {
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

  // Sync tracking
  lastSyncedAt?: Timestamp;
}
/* eslint-enable @typescript-eslint/naming-convention */

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
    currency: entity.currency,

    description: entity.description,
    merchantName: entity.merchant_name,
    userCustomName: existing?.userCustomName ?? entity.user_custom_name,

    frequency: entity.frequency,
    firstDate: Timestamp.fromDate(entity.first_date),
    lastDate: Timestamp.fromDate(entity.last_date),
    predictedNextDate: entity.predicted_next_date
      ? Timestamp.fromDate(entity.predicted_next_date)
      : null,

    plaidPrimaryCategory: entity.plaid_primary_category,
    plaidDetailedCategory: entity.plaid_detailed_category,
    internalPrimaryCategory: existing?.internalPrimaryCategory ?? entity.internal_primary_category,
    internalDetailedCategory: existing?.internalDetailedCategory ?? entity.internal_detailed_category,

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

  /**
   * Saves a batch of outflows with upsert logic.
   *
   * For each outflow:
   * - If exists: update with Plaid data, preserve user modifications
   * - If new: create with pending_review status
   */
  async save_batch(
    ctx: TraceContext,
    entities: OutflowForPersistence[]
  ): Promise<BatchWriteResult> {
    if (entities.length === 0) {
      return { results: [], count: 0, success: true };
    }

    const db = getFirestore();
    const now = Timestamp.now();
    const results: WriteResult[] = [];

    // Get existing documents for upsert logic
    const stream_ids = entities.map((e) => e.id);
    const existing_map = await this.find_by_plaid_stream_ids(ctx, stream_ids);

    // Process in batches
    const chunks = chunk_for_batch(entities);

    for (const chunk of chunks) {
      const batch = db.batch();

      for (const entity of chunk) {
        const existing = existing_map.get(entity.id);
        const existing_doc = existing
          ? (await doc_ref(entity.id).get()).data() as LegacyOutflowDoc
          : null;

        const doc_data = map_persistence_to_doc(entity, now, existing_doc);
        batch.set(doc_ref(entity.id), doc_data);

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

      await batch.commit();
    }

    console.log(
      `[${ctx.trace_id}] outflow_repo.save_batch: saved=${results.length}`
    );

    return {
      results,
      count: entities.length,
      success: true,
    };
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
};
