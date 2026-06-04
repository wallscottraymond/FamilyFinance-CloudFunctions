/**
 * Transaction Repository
 *
 * Handles persistence for transaction entities.
 * All writes are audited automatically.
 *
 * NOTE: This repository uses snake_case internally but maps to/from
 * the legacy camelCase Firestore documents for backwards compatibility.
 *
 * @module repositories/transaction
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  WriteResult,
  TraceContext,
  create_write_result,
  chunk_for_batch,
} from "../types";
import {
  TransactionForPersistence,
  TransactionSplitForPersistence,
  PendingTransactionInfo,
} from "../types/plaid";
import { record_audit_entry_async } from "../audit";

/**
 * Firestore collection name.
 */
const COLLECTION = "transactions";

// ============================================================================
// Legacy Document Types (camelCase - for Firestore compatibility)
// ============================================================================

/**
 * Legacy Firestore document structure (camelCase).
 * Used for reading/writing to maintain backwards compatibility.
 *
 * NOTE: camelCase is intentional - this interfaces with existing Firestore documents.
 */
/* eslint-disable @typescript-eslint/naming-convention */
interface LegacyTransactionDoc {
  id: string;
  transactionId: string;
  userId?: string;
  ownerId: string;
  groupId: string | null;
  groupIds?: string[];
  isPrivate?: boolean;
  transactionDate: Timestamp;
  accountId: string;
  createdBy: string;
  updatedBy: string;
  currency: string;
  description: string;
  internalDetailedCategory: string | null;
  internalPrimaryCategory: string | null;
  plaidDetailedCategory: string;
  plaidPrimaryCategory: string;
  plaidItemId: string;
  source: "plaid" | "manual" | "import";
  transactionStatus: string;
  type: string | null;
  name: string;
  merchantName: string | null;
  amount?: number;
  isPending?: boolean;
  pendingTransactionId?: string | null;
  splits: LegacySplitDoc[];
  initialPlaidData: {
    plaidAccountId: string;
    plaidMerchantName: string | null;
    plaidName: string;
    plaidTransactionId: string;
    plaidPending: boolean;
    source: "plaid";
  };
  createdAt: Timestamp;
  updatedAt: Timestamp;
  isActive?: boolean;
  isDeleted?: boolean;
  deletionReason?: string;
}

interface LegacySplitDoc {
  splitId: string;
  budgetId: string;
  budgetName?: string;
  monthlyPeriodId: string | null;
  weeklyPeriodId: string | null;
  biWeeklyPeriodId: string | null;
  outflowId?: string | null;
  plaidPrimaryCategory: string;
  plaidDetailedCategory: string;
  internalPrimaryCategory: string | null;
  internalDetailedCategory: string | null;
  amount: number;
  description?: string | null;
  isDefault: boolean;
  isIgnored?: boolean;
  isRefund?: boolean;
  isTaxDeductible?: boolean;
  ignoredReason?: string | null;
  refundReason?: string | null;
  paymentType?: string;
  paymentDate: Timestamp;
  rules: string[];
  tags: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
/* eslint-enable @typescript-eslint/naming-convention */

// ============================================================================
// Mapping Functions
// ============================================================================

/**
 * Maps legacy Firestore document to PendingTransactionInfo.
 */
function map_to_pending_info(doc: LegacyTransactionDoc): PendingTransactionInfo {
  return {
    doc_id: doc.id,
    plaid_transaction_id: doc.transactionId,
    amount: doc.amount ?? doc.splits?.[0]?.amount ?? 0,
    splits: (doc.splits || []).map(s => ({
      split_id: s.splitId,
      amount: s.amount,
      budget_id: s.budgetId,
      outflow_id: s.outflowId || null,
      internal_primary_category: s.internalPrimaryCategory,
      internal_detailed_category: s.internalDetailedCategory,
      is_default: s.isDefault,
      tags: s.tags || [],
    })),
    internal_primary_category: doc.internalPrimaryCategory,
    internal_detailed_category: doc.internalDetailedCategory,
    description_override: doc.description !== doc.name ? doc.description : null,
    tags: doc.splits?.[0]?.tags || [],
  };
}

/**
 * Maps TransactionForPersistence to legacy Firestore document.
 */
function map_to_doc(
  entity: TransactionForPersistence,
  now: Timestamp
): LegacyTransactionDoc {
  const group_ids = entity.group_ids || [];

  return {
    id: entity.id || "",
    transactionId: entity.transaction_id,
    userId: entity.user_id,
    ownerId: entity.user_id,
    groupId: group_ids[0] || null,
    groupIds: group_ids,
    isPrivate: group_ids.length === 0,
    transactionDate: Timestamp.fromDate(entity.transaction_date),
    accountId: entity.account_id,
    createdBy: entity.user_id,
    updatedBy: entity.user_id,
    currency: entity.currency,
    description: entity.name,
    internalDetailedCategory: entity.internal_detailed_category,
    internalPrimaryCategory: entity.internal_primary_category,
    plaidDetailedCategory: entity.plaid_detailed_category,
    plaidPrimaryCategory: entity.plaid_primary_category,
    plaidItemId: entity.plaid_item_id,
    source: entity.source,
    transactionStatus: entity.is_pending ? "pending" : "approved",
    type: entity.type,
    name: entity.name,
    merchantName: entity.merchant_name,
    amount: entity.amount,
    isPending: entity.is_pending,
    pendingTransactionId: entity.pending_transaction_id,
    splits: entity.splits.map(s => map_split_to_doc(s, now)),
    initialPlaidData: {
      plaidAccountId: entity.initial_plaid_data.plaid_account_id,
      plaidMerchantName: entity.initial_plaid_data.plaid_merchant_name,
      plaidName: entity.initial_plaid_data.plaid_name,
      plaidTransactionId: entity.initial_plaid_data.plaid_transaction_id,
      plaidPending: entity.initial_plaid_data.plaid_pending,
      source: "plaid",
    },
    createdAt: now,
    updatedAt: now,
    isActive: entity.is_active,
    isDeleted: !entity.is_active,
  };
}

function map_split_to_doc(
  split: TransactionSplitForPersistence,
  now: Timestamp
): LegacySplitDoc {
  return {
    splitId: split.split_id,
    budgetId: split.budget_id,
    monthlyPeriodId: split.monthly_period_id,
    weeklyPeriodId: split.weekly_period_id,
    biWeeklyPeriodId: split.bi_weekly_period_id,
    outflowId: split.outflow_id,
    plaidPrimaryCategory: split.plaid_primary_category,
    plaidDetailedCategory: split.plaid_detailed_category,
    internalPrimaryCategory: split.internal_primary_category,
    internalDetailedCategory: split.internal_detailed_category,
    amount: split.amount,
    isDefault: split.is_default,
    isIgnored: split.is_ignored,
    isRefund: split.is_refund,
    isTaxDeductible: split.is_tax_deductible,
    paymentDate: Timestamp.fromDate(split.payment_date),
    rules: split.rules,
    tags: split.tags,
    createdAt: now,
    updatedAt: now,
  };
}

// ============================================================================
// Repository Functions
// ============================================================================

/**
 * Gets Firestore document reference.
 */
function doc_ref(id: string): FirebaseFirestore.DocumentReference {
  return getFirestore().collection(COLLECTION).doc(id);
}

/**
 * Transaction Repository
 *
 * All write operations automatically create audit entries.
 */
export const transaction_repo = {
  /**
   * Upserts transactions from Plaid sync.
   *
   * For each transaction:
   * - If exists (by plaidTransactionId): updates if materially changed
   * - If new: creates with full data
   *
   * @param ctx - Trace context
   * @param transactions - Transactions ready for persistence
   * @param user_id - User ID
   * @param plaid_item_id - Plaid item ID (for scoping)
   * @returns Upsert results with created/updated counts
   */
  async upsert_from_plaid_sync(
    ctx: TraceContext,
    transactions: TransactionForPersistence[],
    user_id: string,
    plaid_item_id: string
  ): Promise<{
    created: number;
    updated: number;
    results: Array<{
      plaid_transaction_id: string;
      doc_id: string;
      action: "created" | "updated";
    }>;
  }> {
    if (transactions.length === 0) {
      return { created: 0, updated: 0, results: [] };
    }

    const db = getFirestore();
    const now = Timestamp.now();
    let created = 0;
    let updated = 0;
    const results: Array<{
      plaid_transaction_id: string;
      doc_id: string;
      action: "created" | "updated";
    }> = [];

    // Process in batches
    const chunks = chunk_for_batch(transactions);

    for (const chunk of chunks) {
      const batch = db.batch();

      for (const txn of chunk) {
        // Check if transaction exists
        const existing = await this.get_by_plaid_transaction_id(
          ctx,
          user_id,
          txn.transaction_id
        );

        if (existing) {
          // UPDATE: Update the existing document
          const doc_data = map_to_doc({ ...txn, id: existing.doc_id }, now);
          doc_data.createdAt = existing.created_at; // Preserve original creation time
          doc_data.updatedAt = now;

          batch.update(doc_ref(existing.doc_id), doc_data as unknown as Record<string, unknown>);

          results.push({
            plaid_transaction_id: txn.transaction_id,
            doc_id: existing.doc_id,
            action: "updated",
          });
          updated++;

          // Audit entry
          record_audit_entry_async({
            user_id,
            action: "update",
            entity_type: "transaction",
            entity_id: existing.doc_id,
            before: { plaid_transaction_id: txn.transaction_id },
            after: doc_data as unknown as Record<string, unknown>,
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { plaid_sync: true } },
          });
        } else {
          // CREATE: New transaction
          const doc_id = db.collection(COLLECTION).doc().id;
          const doc_data = map_to_doc({ ...txn, id: doc_id }, now);

          batch.set(doc_ref(doc_id), doc_data);

          results.push({
            plaid_transaction_id: txn.transaction_id,
            doc_id,
            action: "created",
          });
          created++;

          // Audit entry
          record_audit_entry_async({
            user_id,
            action: "create",
            entity_type: "transaction",
            entity_id: doc_id,
            before: null,
            after: doc_data as unknown as Record<string, unknown>,
            trace_id: ctx.trace_id,
            metadata: { source: "api", context: { plaid_sync: true } },
          });
        }
      }

      await batch.commit();
    }

    console.log(
      `[${ctx.trace_id}] upsert_from_plaid_sync: created=${created}, updated=${updated}`
    );

    return { created, updated, results };
  },

  /**
   * Updates specific fields on a transaction.
   *
   * @param ctx - Trace context
   * @param doc_id - Document ID
   * @param updates - Field updates to apply
   * @returns Write result
   */
  async update_transaction_fields(
    ctx: TraceContext,
    doc_id: string,
    updates: Partial<{
      internal_primary_category: string | null;
      internal_detailed_category: string | null;
      splits: TransactionSplitForPersistence[];
      is_pending: boolean;
    }>
  ): Promise<WriteResult> {
    const now = Timestamp.now();
    const before_doc = await doc_ref(doc_id).get();

    if (!before_doc.exists) {
      throw new Error(`Transaction ${doc_id} not found`);
    }

    const before = before_doc.data() as LegacyTransactionDoc;

    /* eslint-disable @typescript-eslint/naming-convention */
    const update_data: Record<string, unknown> = {
      updatedAt: now,
    };

    if (updates.internal_primary_category !== undefined) {
      update_data.internalPrimaryCategory = updates.internal_primary_category;
    }
    if (updates.internal_detailed_category !== undefined) {
      update_data.internalDetailedCategory = updates.internal_detailed_category;
    }
    if (updates.splits !== undefined) {
      update_data.splits = updates.splits.map(s => map_split_to_doc(s, now));
    }
    if (updates.is_pending !== undefined) {
      update_data.isPending = updates.is_pending;
      update_data.transactionStatus = updates.is_pending ? "pending" : "approved";
    }
    /* eslint-enable @typescript-eslint/naming-convention */

    await doc_ref(doc_id).update(update_data);

    // Audit entry
    record_audit_entry_async({
      user_id: before.ownerId,
      action: "update",
      entity_type: "transaction",
      entity_id: doc_id,
      before: before as unknown as Record<string, unknown>,
      after: { ...before, ...update_data } as unknown as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api", context: { plaid_sync: true, field_update: true } },
    });

    return create_write_result("transaction", doc_id, "merge", before, { ...before, ...update_data });
  },

  /**
   * Soft-deletes transactions by Plaid transaction IDs.
   *
   * @param ctx - Trace context
   * @param user_id - User ID for verification
   * @param plaid_transaction_ids - Plaid transaction IDs to soft-delete
   * @param reason - Reason for deletion
   * @returns Write results
   */
  async soft_delete_by_plaid_ids(
    ctx: TraceContext,
    user_id: string,
    plaid_transaction_ids: string[],
    reason: string
  ): Promise<WriteResult[]> {
    if (plaid_transaction_ids.length === 0) {
      return [];
    }

    const db = getFirestore();
    const now = Timestamp.now();
    const results: WriteResult[] = [];

    // Query for all transactions by Plaid IDs
    const chunks = chunk_for_batch(plaid_transaction_ids);

    for (const chunk of chunks) {
      const snapshot = await db
        .collection(COLLECTION)
        .where("transactionId", "in", chunk)
        .where("ownerId", "==", user_id)
        .get();

      if (snapshot.empty) continue;

      const batch = db.batch();

      for (const doc of snapshot.docs) {
        const before = doc.data() as LegacyTransactionDoc;

        /* eslint-disable @typescript-eslint/naming-convention */
        const update_data = {
          isActive: false,
          isDeleted: true,
          deletionReason: reason,
          updatedAt: now,
        };
        /* eslint-enable @typescript-eslint/naming-convention */

        batch.update(doc.ref, update_data);

        results.push(
          create_write_result("transaction", doc.id, "merge", before, {
            ...before,
            ...update_data,
          })
        );

        // Audit entry
        record_audit_entry_async({
          user_id,
          action: "delete",
          entity_type: "transaction",
          entity_id: doc.id,
          before: before as unknown as Record<string, unknown>,
          after: { ...before, ...update_data } as unknown as Record<string, unknown>,
          trace_id: ctx.trace_id,
          metadata: { source: "api", context: { plaid_sync: true, reason } },
        });
      }

      await batch.commit();
    }

    console.log(
      `[${ctx.trace_id}] soft_delete_by_plaid_ids: deleted=${results.length}`
    );

    return results;
  },

  /**
   * Gets pending transactions for a Plaid item.
   *
   * Used by resolver to build the pending transaction lookup map
   * for pending->posted migration.
   *
   * @param ctx - Trace context
   * @param user_id - User ID
   * @param plaid_item_id - Plaid item ID
   * @returns Map of plaid_transaction_id -> PendingTransactionInfo
   */
  async get_pending_transactions_for_item(
    ctx: TraceContext,
    user_id: string,
    plaid_item_id: string
  ): Promise<Map<string, PendingTransactionInfo>> {
    const db = getFirestore();

    const snapshot = await db
      .collection(COLLECTION)
      .where("ownerId", "==", user_id)
      .where("plaidItemId", "==", plaid_item_id)
      .where("isPending", "==", true)
      .where("isActive", "==", true)
      .get();

    const result = new Map<string, PendingTransactionInfo>();

    for (const doc of snapshot.docs) {
      const data = doc.data() as LegacyTransactionDoc;
      result.set(data.transactionId, map_to_pending_info(data));
    }

    console.log(
      `[${ctx.trace_id}] get_pending_transactions_for_item: found=${result.size}`
    );

    return result;
  },

  /**
   * Gets a transaction by Plaid transaction ID.
   *
   * @param ctx - Trace context
   * @param user_id - User ID for scoping
   * @param plaid_transaction_id - Plaid transaction ID
   * @returns Transaction info or null if not found
   */
  async get_by_plaid_transaction_id(
    ctx: TraceContext,
    user_id: string,
    plaid_transaction_id: string
  ): Promise<{ doc_id: string; created_at: Timestamp } | null> {
    const db = getFirestore();

    const snapshot = await db
      .collection(COLLECTION)
      .where("transactionId", "==", plaid_transaction_id)
      .where("ownerId", "==", user_id)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return null;
    }

    const doc = snapshot.docs[0];
    const data = doc.data() as LegacyTransactionDoc;

    return {
      doc_id: doc.id,
      created_at: data.createdAt,
    };
  },

  /**
   * Gets transaction by document ID.
   *
   * @param ctx - Trace context
   * @param doc_id - Document ID
   * @returns Transaction document or null
   */
  async get_by_id(
    ctx: TraceContext,
    doc_id: string
  ): Promise<LegacyTransactionDoc | null> {
    const doc = await doc_ref(doc_id).get();

    if (!doc.exists) {
      return null;
    }

    return doc.data() as LegacyTransactionDoc;
  },

  /**
   * Writes the Transaction Assignment Engine's output: the updated splits array
   * (with the engine-owned assignment fields applied) plus the denormalized
   * `splitBudgetIds`. This is the engine's SINGLE write of split assignment.
   *
   * @param _ctx - Trace context
   * @param doc_id - Transaction document ID
   * @param updated_splits - The full splits array, with assignment fields applied
   * @param split_budget_ids - Distinct budget ids across the splits (queryable)
   */
  async apply_split_assignments(
    _ctx: TraceContext,
    doc_id: string,
    updated_splits: Array<Record<string, unknown>>,
    split_budget_ids: string[]
  ): Promise<void> {
    /* eslint-disable @typescript-eslint/naming-convention */
    await doc_ref(doc_id).update({
      splits: updated_splits,
      splitBudgetIds: split_budget_ids,
      updatedAt: Timestamp.now(),
    });
    /* eslint-enable @typescript-eslint/naming-convention */
  },

  /**
   * Counts active transactions for a specific account.
   *
   * Used by resolvers to determine cascade scope for account removal.
   *
   * @param ctx - Trace context
   * @param account_id - Plaid account ID
   * @param user_id - User ID for scoping
   * @returns Count of active transactions for the account
   */
  async count_by_account_id(
    ctx: TraceContext,
    account_id: string,
    user_id: string
  ): Promise<number> {
    const db = getFirestore();

    const snapshot = await db
      .collection(COLLECTION)
      .where("accountId", "==", account_id)
      .where("ownerId", "==", user_id)
      .where("isActive", "==", true)
      .count()
      .get();

    const count = snapshot.data().count;

    console.log(
      `[${ctx.trace_id}] count_by_account_id: account=${account_id}, count=${count}`
    );

    return count;
  },

  /**
   * Gets transaction IDs for a specific account.
   *
   * Used by resolvers to get affected transaction IDs for cascade operations.
   * Returns only IDs to minimize memory usage.
   *
   * @param ctx - Trace context
   * @param account_id - Plaid account ID
   * @param user_id - User ID for scoping
   * @param limit - Maximum number of IDs to return (default 1000)
   * @returns Array of transaction document IDs
   */
  async get_ids_by_account_id(
    ctx: TraceContext,
    account_id: string,
    user_id: string,
    limit: number = 1000
  ): Promise<string[]> {
    const db = getFirestore();

    const snapshot = await db
      .collection(COLLECTION)
      .where("accountId", "==", account_id)
      .where("ownerId", "==", user_id)
      .where("isActive", "==", true)
      .select() // Select no fields, just get document IDs
      .limit(limit)
      .get();

    const ids = snapshot.docs.map(doc => doc.id);

    console.log(
      `[${ctx.trace_id}] get_ids_by_account_id: account=${account_id}, found=${ids.length}`
    );

    return ids;
  },

  /**
   * Gets all active transaction IDs owned by a user.
   *
   * Queries by `userId` (the field the assignment engine + spend recompute use,
   * NOT `ownerId`) so the backfill's work-list matches exactly what
   * `recompute_budget_spent` will sum. Returns only IDs to bound memory.
   *
   * @param ctx - Trace context
   * @param user_id - User ID (matches the `userId` field)
   * @param limit - Maximum number of IDs to return (default 5000)
   * @returns Array of transaction document IDs
   */
  async get_ids_by_user_id(
    ctx: TraceContext,
    user_id: string,
    limit: number = 5000
  ): Promise<string[]> {
    const db = getFirestore();

    const snapshot = await db
      .collection(COLLECTION)
      .where("userId", "==", user_id)
      .where("isActive", "==", true)
      .select() // Document IDs only
      .limit(limit)
      .get();

    const ids = snapshot.docs.map((doc) => doc.id);

    console.log(
      `[${ctx.trace_id}] get_ids_by_user_id: user=${user_id}, found=${ids.length}`
    );

    return ids;
  },

  /**
   * Gets active transaction IDs that have at least one split assigned to a
   * budget. Splits are nested maps, so this scans the user's active
   * transactions (by ownerId AND userId, deduped) and filters in memory.
   * Used by the delete cascade to re-run assignment on a deleted budget's txns.
   *
   * @param ctx - Trace context
   * @param user_id - User ID
   * @param budget_id - Budget whose referencing transactions to find
   */
  async get_ids_referencing_budget(
    ctx: TraceContext,
    user_id: string,
    budget_id: string
  ): Promise<string[]> {
    const db = getFirestore();
    const [owner_snap, user_snap] = await Promise.all([
      db
        .collection(COLLECTION)
        .where("ownerId", "==", user_id)
        .where("isActive", "==", true)
        .get(),
      db
        .collection(COLLECTION)
        .where("userId", "==", user_id)
        .where("isActive", "==", true)
        .get(),
    ]);

    const matched = new Set<string>();
    for (const snap of [owner_snap, user_snap]) {
      snap.docs.forEach((doc) => {
        /* eslint-disable @typescript-eslint/naming-convention */
        const splits = (doc.data().splits ?? []) as Array<{ budgetId?: string }>;
        /* eslint-enable @typescript-eslint/naming-convention */
        if (splits.some((s) => s.budgetId === budget_id)) {
          matched.add(doc.id);
        }
      });
    }

    const ids = Array.from(matched);
    console.log(
      `[${ctx.trace_id}] get_ids_referencing_budget: budget=${budget_id}, found=${ids.length}`
    );
    return ids;
  },

  /**
   * Gets one transaction's raw doc data + id, or null if missing/inactive.
   * Returns the raw camelCase map so the assignment resolver can read-modify-
   * write nested splits onto it.
   */
  async get_raw_by_id(
    _ctx: TraceContext,
    transaction_id: string
  ): Promise<{ id: string; data: Record<string, unknown> } | null> {
    const doc = await getFirestore()
      .collection(COLLECTION)
      .doc(transaction_id)
      .get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data() as Record<string, unknown>;
    if (data.isActive === false) {
      return null;
    }
    return { id: doc.id, data };
  },

  /**
   * Gets active transactions (raw doc data + id) whose `transactionDate` falls
   * in [start_ms, end_ms]. Returns raw maps so callers (spend / re-home
   * resolvers) can map nested splits themselves.
   *
   * Composite index: `transactions(userId, transactionDate)`.
   */
  async get_active_in_date_range(
    _ctx: TraceContext,
    user_id: string,
    start_ms: number,
    end_ms: number
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION)
      .where("userId", "==", user_id)
      .where("transactionDate", ">=", Timestamp.fromMillis(start_ms))
      .where("transactionDate", "<=", Timestamp.fromMillis(end_ms))
      .get();
    return snapshot.docs
      .map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }))
      .filter((t) => t.data.isActive !== false);
  },

  /**
   * Updates cursor on plaid_item document.
   *
   * NOTE: This updates the plaid_items collection, not transactions.
   * Included here for convenience in the sync orchestrator.
   *
   * @param ctx - Trace context
   * @param item_doc_id - Plaid item document ID
   * @param cursor - New cursor value
   */
  async update_plaid_item_cursor(
    ctx: TraceContext,
    item_doc_id: string,
    cursor: string | null
  ): Promise<void> {
    const db = getFirestore();
    const now = Timestamp.now();

    await db.collection("plaid_items").doc(item_doc_id).update({
      cursor,
      /* eslint-disable @typescript-eslint/naming-convention */
      lastSyncedAt: now,
      updatedAt: now,
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    console.log(
      `[${ctx.trace_id}] update_plaid_item_cursor: item=${item_doc_id}, cursor=${cursor ? "updated" : "cleared"}`
    );
  },

};
