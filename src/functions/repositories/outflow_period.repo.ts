/**
 * Outflow Period Repository
 *
 * Handles persistence for outflow_periods collection.
 * Used to link transactions to recurring bills (outflows).
 *
 * @module repositories/outflow_period
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  WriteResult,
  BatchWriteResult,
  TraceContext,
  create_write_result,
  chunk_for_batch,
} from "../types";
import { record_audit_entry_async } from "../audit";
import { ReconciliationResult } from "../domain/recurring/period_reconciliation.service";

/**
 * Firestore collection name.
 */
const COLLECTION = "outflow_periods";

/**
 * Outflow period update structure (snake_case - domain format).
 * Matches the output from match_transaction_splits_to_outflows.
 */
export interface OutflowPeriodUpdate {
  period_id: string;
  transaction_split_ref: {
    transaction_id: string;
    split_id: string;
    amount: number;
    payment_date: Timestamp;
  };
}

/**
 * Outflow period entity for persistence (snake_case - domain format).
 */
export interface OutflowPeriodForPersistence {
  id: string;
  outflow_id: string;
  source_period_id: string;

  // Ownership
  owner_id: string;
  created_by: string;
  updated_by: string;
  group_id: string | null;
  group_ids: string[];

  // Plaid identifiers
  account_id: string;
  plaid_item_id: string;

  // Financial tracking
  actual_amount: number | null;
  amount_withheld: number;
  average_amount: number;
  expected_amount: number;
  amount_per_occurrence: number;
  total_amount_due: number;
  total_amount_paid: number;
  total_amount_unpaid: number;

  // Timestamps
  created_at: Timestamp;
  updated_at: Timestamp;
  last_calculated: Timestamp;

  // Payment cycle info
  currency: string;
  cycle_days: number;
  cycle_start_date: Timestamp;
  cycle_end_date: Timestamp;
  daily_withholding_rate: number;

  // Outflow metadata (denormalized)
  description: string | null;
  frequency: string;
  expense_type?: string;

  // Payment status
  is_paid: boolean;
  is_fully_paid: boolean;
  is_partially_paid: boolean;
  is_due_period: boolean;

  // Categorization
  internal_detailed_category: string | null;
  internal_primary_category: string | null;
  plaid_primary_category: string;
  plaid_detailed_category: string;

  // Status & control
  is_active: boolean;
  is_hidden: boolean;
  is_essential: boolean;

  // Merchant info
  merchant_name: string | null;

  // Period context
  period_start_date: Timestamp;
  period_end_date: Timestamp;
  period_type: string;

  // Prediction
  predicted_next_date: Timestamp | null;

  // User interaction
  rules: unknown[];
  tags: string[];
  type: string;
  note: string | null;
  user_custom_name: string | null;

  // Source
  source: string;

  // Transaction tracking
  transaction_ids: string[];
  transaction_splits: unknown[];

  // Multi-occurrence tracking
  number_of_occurrences_in_period: number;
  number_of_occurrences_paid: number;
  number_of_occurrences_unpaid: number;
  occurrence_due_dates: Timestamp[];
  occurrence_paid_flags: boolean[];
  occurrence_transaction_ids: (string | null)[];

  // Progress metrics
  payment_progress_percentage: number;
  dollar_progress_percentage: number;

  // Due date tracking
  first_due_date_in_period: Timestamp | null;
  last_due_date_in_period: Timestamp | null;
  next_unpaid_due_date: Timestamp | null;
}

/**
 * Maps snake_case entity to camelCase Firestore document.
 */
/* eslint-disable @typescript-eslint/naming-convention */
function map_to_firestore_doc(entity: OutflowPeriodForPersistence): Record<string, unknown> {
  return {
    id: entity.id,
    outflowId: entity.outflow_id,
    sourcePeriodId: entity.source_period_id,

    // Ownership
    ownerId: entity.owner_id,
    userId: entity.owner_id,
    createdBy: entity.created_by,
    updatedBy: entity.updated_by,
    groupId: entity.group_id,
    groupIds: entity.group_ids,

    // Plaid identifiers
    accountId: entity.account_id,
    itemId: entity.plaid_item_id,

    // Financial tracking
    actualAmount: entity.actual_amount,
    amountWithheld: entity.amount_withheld,
    averageAmount: entity.average_amount,
    expectedAmount: entity.expected_amount,
    amountPerOccurrence: entity.amount_per_occurrence,
    totalAmountDue: entity.total_amount_due,
    totalAmountPaid: entity.total_amount_paid,
    totalAmountUnpaid: entity.total_amount_unpaid,

    // Timestamps
    createdAt: entity.created_at,
    updatedAt: entity.updated_at,
    lastCalculated: entity.last_calculated,

    // Payment cycle info
    currency: entity.currency,
    cycleDays: entity.cycle_days,
    cycleStartDate: entity.cycle_start_date,
    cycleEndDate: entity.cycle_end_date,
    dailyWithholdingRate: entity.daily_withholding_rate,

    // Outflow metadata
    description: entity.description,
    frequency: entity.frequency,
    expenseType: entity.expense_type,

    // Payment status
    isPaid: entity.is_paid,
    isFullyPaid: entity.is_fully_paid,
    isPartiallyPaid: entity.is_partially_paid,
    isDuePeriod: entity.is_due_period,

    // Categorization
    internalDetailedCategory: entity.internal_detailed_category,
    internalPrimaryCategory: entity.internal_primary_category,
    plaidPrimaryCategory: entity.plaid_primary_category,
    plaidDetailedCategory: entity.plaid_detailed_category,

    // Status & control
    isActive: entity.is_active,
    isHidden: entity.is_hidden,
    isEssential: entity.is_essential,

    // Merchant info - include BOTH for compatibility
    // Legacy: uses `merchant` field, New: uses `merchantName`
    merchant: entity.merchant_name,
    merchantName: entity.merchant_name,
    payee: entity.merchant_name,

    // Period context
    periodStartDate: entity.period_start_date,
    periodEndDate: entity.period_end_date,
    periodType: entity.period_type,

    // Prediction
    predictedNextDate: entity.predicted_next_date,

    // User interaction
    rules: entity.rules,
    tags: entity.tags,
    type: entity.type,
    note: entity.note,
    userCustomName: entity.user_custom_name,

    // Source
    source: entity.source,

    // Transaction tracking
    transactionIds: entity.transaction_ids,
    transactionSplits: entity.transaction_splits,

    // Multi-occurrence tracking
    numberOfOccurrencesInPeriod: entity.number_of_occurrences_in_period,
    numberOfOccurrencesPaid: entity.number_of_occurrences_paid,
    numberOfOccurrencesUnpaid: entity.number_of_occurrences_unpaid,
    occurrenceDueDates: entity.occurrence_due_dates,
    occurrencePaidFlags: entity.occurrence_paid_flags,
    occurrenceTransactionIds: entity.occurrence_transaction_ids,

    // Progress metrics
    paymentProgressPercentage: entity.payment_progress_percentage,
    dollarProgressPercentage: entity.dollar_progress_percentage,

    // Due date tracking
    firstDueDateInPeriod: entity.first_due_date_in_period,
    lastDueDateInPeriod: entity.last_due_date_in_period,
    nextUnpaidDueDate: entity.next_unpaid_due_date,
  };
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Gets Firestore document reference.
 */
function doc_ref(id: string): FirebaseFirestore.DocumentReference {
  return getFirestore().collection(COLLECTION).doc(id);
}

/**
 * Outflow Period Repository
 *
 * Handles updates to outflow_periods when transactions are linked.
 */
export const outflow_period_repo = {
  /**
   * Saves a batch of outflow periods.
   *
   * Creates new outflow period documents for a recurring outflow.
   * Called when a new outflow is created or when periods need to be extended.
   */
  async save_batch(
    ctx: TraceContext,
    entities: OutflowPeriodForPersistence[],
    user_id: string
  ): Promise<BatchWriteResult> {
    if (entities.length === 0) {
      console.log(`[${ctx.trace_id}] outflow_period_repo.save_batch: no entities to save`);
      return { results: [], count: 0, success: true };
    }

    // ===== DIAGNOSTIC LOGGING =====
    const sample = entities[0];
    console.log(
      `[${ctx.trace_id}] outflow_period_repo.save_batch: ` +
        `count=${entities.length}, ` +
        `first_id=${sample.id}, ` +
        `owner_id=${sample.owner_id}, ` +
        `outflow_id=${sample.outflow_id}, ` +
        `is_active=${sample.is_active}`
    );
    // ===== END DIAGNOSTIC =====

    const db = getFirestore();
    const results: WriteResult[] = [];

    // Process in batches to respect Firestore limits
    const chunks = chunk_for_batch(entities);

    for (const chunk of chunks) {
      const batch = db.batch();

      for (const entity of chunk) {
        const doc_data = map_to_firestore_doc(entity);
        batch.set(doc_ref(entity.id), doc_data);

        results.push(
          create_write_result("outflow_period", entity.id, "replace", null, doc_data)
        );

        // Audit entry (async, non-blocking)
        record_audit_entry_async({
          user_id,
          action: "create",
          entity_type: "outflow_period",
          entity_id: entity.id,
          before: null,
          after: doc_data as Record<string, unknown>,
          trace_id: ctx.trace_id,
          metadata: {
            source: "api",
            context: { outflow_id: entity.outflow_id },
          },
        });
      }

      await batch.commit();
    }

    console.log(
      `[${ctx.trace_id}] outflow_period_repo.save_batch: saved=${results.length}`
    );

    return {
      results,
      count: entities.length,
      success: true,
    };
  },

  /**
   * Updates outflow periods with transaction split references.
   *
   * Called after transactions are persisted to link them to recurring bills.
   * This operation:
   * - Adds transaction split references to the period's transactionSplits array
   * - Sets the period status to 'paid'
   * - Creates audit entries for each update
   *
   * @param ctx - Trace context for logging
   * @param updates - Array of period updates to apply
   * @returns Write results for each updated period
   */
  async update_with_transaction_splits(
    ctx: TraceContext,
    updates: OutflowPeriodUpdate[]
  ): Promise<WriteResult[]> {
    if (updates.length === 0) {
      return [];
    }

    const db = getFirestore();
    const now = Timestamp.now();
    const results: WriteResult[] = [];

    // Idempotent read-modify-REPLACE per period (never a blind FieldValue.
    // arrayUnion — a webhook/trigger replay would double-record the payment).
    // Each period is its own aggregate, so one transaction per period.
    for (const update of updates) {
      const ref = db.collection(COLLECTION).doc(update.period_id);

      // Convert snake_case domain format to camelCase Firestore format
      /* eslint-disable @typescript-eslint/naming-convention */
      const transaction_split_ref_firestore = {
        transactionId: update.transaction_split_ref.transaction_id,
        splitId: update.transaction_split_ref.split_id,
        amount: update.transaction_split_ref.amount,
        paymentDate: update.transaction_split_ref.payment_date,
      };
      /* eslint-enable @typescript-eslint/naming-convention */

      const applied = await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
          return false;
        }
        /* eslint-disable @typescript-eslint/naming-convention */
        const existing = (snap.data()?.transactionSplits ?? []) as Array<{
          transactionId?: string;
          splitId?: string;
        }>;
        /* eslint-enable @typescript-eslint/naming-convention */
        // Drop any prior ref for the same (transaction, split), then append once.
        const deduped = existing.filter(
          (s) =>
            !(
              s.transactionId === transaction_split_ref_firestore.transactionId &&
              s.splitId === transaction_split_ref_firestore.splitId
            )
        );
        const next = [...deduped, transaction_split_ref_firestore];
        /* eslint-disable @typescript-eslint/naming-convention */
        tx.update(ref, {
          transactionSplits: next,
          status: "paid",
          updatedAt: now,
        });
        /* eslint-enable @typescript-eslint/naming-convention */
        return true;
      });

      if (!applied) {
        continue;
      }

      results.push(
        create_write_result("outflow_period", update.period_id, "merge", null, {
          transactionSplitRef: transaction_split_ref_firestore,
          status: "paid",
        })
      );

      // Audit entry (async, non-blocking)
      record_audit_entry_async({
        user_id: "system",
        action: "update",
        entity_type: "outflow_period",
        entity_id: update.period_id,
        before: null,
        after: {
          transactionSplitRef: transaction_split_ref_firestore,
          status: "paid",
        },
        trace_id: ctx.trace_id,
        metadata: {
          source: "api",
          context: {
            plaid_sync: true,
            transaction_id: update.transaction_split_ref.transaction_id,
          },
        },
      });
    }

    console.log(
      `[${ctx.trace_id}] outflow_period_repo.update_with_transaction_splits: updated=${results.length}`
    );

    return results;
  },

  /**
   * Removes transaction split references from outflow periods.
   *
   * Used when transactions are soft-deleted to unlink them from bills.
   *
   * @param ctx - Trace context
   * @param period_id - Outflow period ID
   * @param transaction_id - Transaction ID to remove
   * @param split_id - Split ID to remove
   * @param new_status - New status to set (computed by orchestrator/domain layer)
   * @returns Write result
   */
  async remove_transaction_split(
    ctx: TraceContext,
    period_id: string,
    transaction_id: string,
    split_id: string,
    new_status: string
  ): Promise<WriteResult | null> {
    const db = getFirestore();
    const now = Timestamp.now();
    const ref = db.collection(COLLECTION).doc(period_id);

    // Get current document to find the split reference
    const doc = await ref.get();
    if (!doc.exists) {
      console.warn(
        `[${ctx.trace_id}] outflow_period_repo.remove_transaction_split: period not found ${period_id}`
      );
      return null;
    }

    const data = doc.data();
    /* eslint-disable @typescript-eslint/naming-convention */
    const transactionSplits = (data?.transactionSplits || []) as Array<{
      transactionId: string;
      splitId: string;
    }>;

    // Find the specific split reference to remove
    const split_ref_to_remove = transactionSplits.find(
      (s) => s.transactionId === transaction_id && s.splitId === split_id
    );

    if (!split_ref_to_remove) {
      console.warn(
        `[${ctx.trace_id}] outflow_period_repo.remove_transaction_split: split not found in period`
      );
      return null;
    }

    // Read-modify-REPLACE (never a blind FieldValue.arrayRemove): write back the
    // filtered array. new_status is computed by orchestrator/domain, not here.
    const next_splits = transactionSplits.filter(
      (s) => !(s.transactionId === transaction_id && s.splitId === split_id)
    );

    await ref.update({
      transactionSplits: next_splits,
      status: new_status,
      updatedAt: now,
    });
    /* eslint-enable @typescript-eslint/naming-convention */

    // Audit entry
    record_audit_entry_async({
      user_id: "system",
      action: "update",
      entity_type: "outflow_period",
      entity_id: period_id,
      before: { transactionSplitRef: split_ref_to_remove, status: data?.status },
      after: { status: new_status },
      trace_id: ctx.trace_id,
      metadata: {
        source: "api",
        context: { transaction_removed: transaction_id },
      },
    });

    console.log(
      `[${ctx.trace_id}] outflow_period_repo.remove_transaction_split: removed from ${period_id}`
    );

    return create_write_result("outflow_period", period_id, "merge", data, {
      ...data,
      status: new_status,
    });
  },

  /**
   * Gets the raw doc data + id for a set of period IDs (missing docs skipped).
   * READ-ONLY — used by the summary resolver to group periods for recompute.
   */
  async get_by_ids(
    _ctx: TraceContext,
    period_ids: string[]
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    const docs = await Promise.all(
      period_ids.map((id) => getFirestore().collection(COLLECTION).doc(id).get())
    );
    return docs
      .filter((doc) => doc.exists)
      .map((doc) => ({ id: doc.id, data: doc.data() as Record<string, unknown> }));
  },

  /**
   * Gets outflow periods (raw doc data + id) whose `firstDueDateInPeriod` falls in
   * [start_ms, end_ms]. READ-ONLY — used by the recurring-match resolver to load
   * bill candidates around a transaction date. (Only DUE periods have a non-null
   * `firstDueDateInPeriod`, which is exactly the candidate set we want.)
   *
   * Composite index: `outflow_periods(userId, firstDueDateInPeriod)`.
   */
  async get_in_due_window(
    _ctx: TraceContext,
    user_id: string,
    start_ms: number,
    end_ms: number
  ): Promise<Array<{ id: string; data: Record<string, unknown> }>> {
    const snapshot = await getFirestore()
      .collection(COLLECTION)
      .where("userId", "==", user_id)
      .where("firstDueDateInPeriod", ">=", Timestamp.fromMillis(start_ms))
      .where("firstDueDateInPeriod", "<=", Timestamp.fromMillis(end_ms))
      .get();
    return snapshot.docs.map((doc) => ({
      id: doc.id,
      data: doc.data() as Record<string, unknown>,
    }));
  },

  /**
   * Soft-deletes (or restores) every outflow period for an account in one shot.
   * Sets `isActive` to `is_active` on all periods whose `accountId` matches and
   * whose current state differs (idempotent — re-running is a no-op).
   *
   * Used by the account-removal cascade (`is_active = false`) and the restore
   * flow (`is_active = true`). Queries by `accountId` only (single-field index)
   * and filters in memory to avoid a composite index; period counts per account
   * are bounded (hundreds), and writes are chunked into batches of ≤500.
   *
   * @returns number of periods updated
   */
  async set_active_by_account_id(
    ctx: TraceContext,
    account_id: string,
    is_active: boolean
  ): Promise<number> {
    const db = getFirestore();
    const now = Timestamp.now();

    const snapshot = await db
      .collection(COLLECTION)
      .where("accountId", "==", account_id)
      .get();

    const ids = snapshot.docs
      .filter((doc) => doc.get("isActive") !== is_active)
      .map((doc) => doc.id);

    if (ids.length === 0) {
      return 0;
    }

    let updated = 0;
    for (const chunk of chunk_for_batch(ids)) {
      const batch = db.batch();
      for (const id of chunk) {
        /* eslint-disable @typescript-eslint/naming-convention */
        batch.update(db.collection(COLLECTION).doc(id), {
          isActive: is_active,
          updatedAt: now,
        });
        /* eslint-enable @typescript-eslint/naming-convention */
        updated++;
      }
      await batch.commit();
    }

    console.log(
      `[${ctx.trace_id}] outflow_period.set_active_by_account_id: ` +
      `account=${account_id}, is_active=${is_active}, updated=${updated}`
    );
    return updated;
  },

  /**
   * Returns the period ids for a recurring outflow (mirror of
   * `inflow_period_repo.get_by_inflow_id`). The resolver loads the docs via
   * `get_by_ids` and filters active in memory.
   */
  async get_by_outflow_id(ctx: TraceContext, outflow_id: string): Promise<string[]> {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION)
      .where("outflowId", "==", outflow_id)
      .select()
      .get();
    console.log(
      `[${ctx.trace_id}] outflow_period_repo.get_by_outflow_id: found=${snapshot.size}`
    );
    return snapshot.docs.map((doc) => doc.id);
  },

  /**
   * Persists reconciliation status (Recurring-Period-Reconciliation Phase 3d).
   * Writes the `reconciliation` map + the denormalized legacy `isPaid`/`amountPaid`
   * fields in place, batched, **NOT** `increment` (invalidation model). The
   * orchestrator is responsible for NOT passing inactive periods.
   */
  async update_reconciliation(
    _ctx: TraceContext,
    results: ReconciliationResult[]
  ): Promise<WriteResult[]> {
    if (results.length === 0) {
      return [];
    }
    const db = getFirestore();
    const now = Timestamp.now();
    const write_results: WriteResult[] = [];

    for (const chunk of chunk_for_batch(results)) {
      const batch = db.batch();
      for (const r of chunk) {
        const is_complete = r.status === "complete" || r.status === "over";
        const occurrences_unpaid = Math.max(0, r.occurrences_expected - r.occurrences_paid);
        /* eslint-disable @typescript-eslint/naming-convention */
        const update_data = {
          reconciliation: {
            status: r.status,
            matchedAmount: r.matched_amount,
            pendingAmount: r.pending_amount,
            expectedAmount: r.expected_amount,
            occurrencesExpected: r.occurrences_expected,
            occurrencesPaid: r.occurrences_paid,
            occurrences: r.occurrences.map((o) => ({
              dueDate: Timestamp.fromMillis(o.due_date_ms),
              paid: o.paid,
              transactionId: o.transaction_id,
              amount: o.amount,
            })),
            matchedSplits: r.matched_splits.map((s) => ({
              transactionId: s.transaction_id,
              splitId: s.split_id,
              amount: s.amount,
              isPending: s.is_pending,
            })),
            lastReconciledAt: now,
          },
          // Denormalized legacy fields (kept readable through the FE cutover).
          isPaid: is_complete,
          isFullyPaid: is_complete,
          isPartiallyPaid: r.status === "partial",
          amountPaid: r.matched_amount,
          // Dollar amounts the user_summary / tiles read (paid vs expected).
          totalAmountDue: r.expected_amount,
          totalAmountPaid: r.matched_amount,
          totalAmountUnpaid: Math.max(0, r.expected_amount - r.matched_amount),
          numberOfOccurrencesInPeriod: r.occurrences_expected,
          numberOfOccurrencesPaid: r.occurrences_paid,
          numberOfOccurrencesUnpaid: occurrences_unpaid,
          updatedAt: now,
        };
        /* eslint-enable @typescript-eslint/naming-convention */
        batch.update(db.collection(COLLECTION).doc(r.period_id), update_data);
        write_results.push(
          create_write_result("outflow_period", r.period_id, "merge", { id: r.period_id }, update_data)
        );
      }
      await batch.commit();
    }

    return write_results;
  },

  /**
   * Merge-update ONLY the generation-derived occurrence fields on existing periods
   * (Recurring-Period-Reconciliation B — occurrence regeneration). Preserves the
   * payment/reconciliation state (`reconciliation`, `isPaid`, `transactionSplits`):
   * uses `batch.update`, so callers MUST pass only periods that already exist.
   */
  async update_occurrence_fields(
    _ctx: TraceContext,
    entities: OutflowPeriodForPersistence[]
  ): Promise<WriteResult[]> {
    if (entities.length === 0) {
      return [];
    }
    const db = getFirestore();
    const now = Timestamp.now();
    const write_results: WriteResult[] = [];

    for (const chunk of chunk_for_batch(entities)) {
      const batch = db.batch();
      for (const e of chunk) {
        /* eslint-disable @typescript-eslint/naming-convention */
        const update_data = {
          numberOfOccurrencesInPeriod: e.number_of_occurrences_in_period,
          occurrenceDueDates: e.occurrence_due_dates,
          amountPerOccurrence: e.amount_per_occurrence,
          expectedAmount: e.expected_amount,
          firstDueDateInPeriod: e.first_due_date_in_period,
          isDuePeriod: e.is_due_period,
          updatedAt: now,
        };
        /* eslint-enable @typescript-eslint/naming-convention */
        batch.update(db.collection(COLLECTION).doc(e.id), update_data);
        write_results.push(
          create_write_result("outflow_period", e.id, "merge", { id: e.id }, update_data)
        );
      }
      await batch.commit();
    }

    return write_results;
  },
};
