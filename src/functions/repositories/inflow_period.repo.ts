/**
 * Inflow Period Repository
 *
 * Handles persistence for inflow_periods collection.
 * Creates period-specific instances of recurring inflows.
 *
 * @module repositories/inflow_period
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

/**
 * Firestore collection name.
 */
const COLLECTION = "inflow_periods";

/**
 * Inflow period entity for persistence (snake_case - domain format).
 */
export interface InflowPeriodForPersistence {
  id: string;
  inflow_id: string;
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
  amount_allocated: number;
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

  // Inflow metadata (denormalized)
  description: string | null;
  frequency: string;
  income_type?: string;

  // Payment status
  is_paid: boolean;
  is_fully_paid: boolean;
  is_partially_paid: boolean;
  is_receipt_period: boolean;

  // Categorization
  internal_detailed_category: string | null;
  internal_primary_category: string | null;
  plaid_primary_category: string;
  plaid_detailed_category: string;

  // Status & control
  is_active: boolean;
  is_hidden: boolean;

  // Merchant info
  merchant: string | null;
  payee: string | null;

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

  // Multi-occurrence tracking
  number_of_occurrences_in_period: number;
  number_of_occurrences_paid: number;
  number_of_occurrences_unpaid: number;
  occurrence_due_dates: Timestamp[];
  occurrence_paid_flags: boolean[];
  occurrence_transaction_ids: (string | null)[];
  occurrence_amounts: number[];

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
function map_to_firestore_doc(entity: InflowPeriodForPersistence): Record<string, unknown> {
  return {
    id: entity.id,
    inflowId: entity.inflow_id,
    sourcePeriodId: entity.source_period_id,
    periodId: entity.source_period_id, // Alias for frontend compatibility

    // Ownership
    ownerId: entity.owner_id,
    userId: entity.owner_id, // Alias for frontend compatibility
    createdBy: entity.created_by,
    updatedBy: entity.updated_by,
    groupId: entity.group_id,
    groupIds: entity.group_ids,

    // Plaid identifiers
    accountId: entity.account_id,
    plaidItemId: entity.plaid_item_id,

    // Financial tracking
    actualAmount: entity.actual_amount,
    amountAllocated: entity.amount_allocated,
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

    // Inflow metadata
    description: entity.description,
    frequency: entity.frequency,
    incomeType: entity.income_type,

    // Payment status
    isPaid: entity.is_paid,
    isFullyPaid: entity.is_fully_paid,
    isPartiallyPaid: entity.is_partially_paid,
    isReceiptPeriod: entity.is_receipt_period,

    // Categorization
    internalDetailedCategory: entity.internal_detailed_category,
    internalPrimaryCategory: entity.internal_primary_category,
    plaidPrimaryCategory: entity.plaid_primary_category,
    plaidDetailedCategory: entity.plaid_detailed_category,

    // Status & control
    isActive: entity.is_active,
    isHidden: entity.is_hidden,

    // Merchant info
    merchant: entity.merchant,
    payee: entity.payee,

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

    // Multi-occurrence tracking
    numberOfOccurrencesInPeriod: entity.number_of_occurrences_in_period,
    numberOfOccurrencesPaid: entity.number_of_occurrences_paid,
    numberOfOccurrencesUnpaid: entity.number_of_occurrences_unpaid,
    occurrenceDueDates: entity.occurrence_due_dates,
    occurrencePaidFlags: entity.occurrence_paid_flags,
    occurrenceTransactionIds: entity.occurrence_transaction_ids,
    occurrenceAmounts: entity.occurrence_amounts,

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
 * Inflow Period Repository
 *
 * All write operations automatically create audit entries.
 */
export const inflow_period_repo = {
  /**
   * Saves a batch of inflow periods.
   *
   * Creates new inflow period documents for a recurring inflow.
   * Called when a new inflow is created or when periods need to be extended.
   */
  async save_batch(
    ctx: TraceContext,
    entities: InflowPeriodForPersistence[],
    user_id: string
  ): Promise<BatchWriteResult> {
    if (entities.length === 0) {
      return { results: [], count: 0, success: true };
    }

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
          create_write_result("inflow_period", entity.id, "replace", null, doc_data)
        );

        // Audit entry (async, non-blocking)
        record_audit_entry_async({
          user_id,
          action: "create",
          entity_type: "inflow_period",
          entity_id: entity.id,
          before: null,
          after: doc_data as Record<string, unknown>,
          trace_id: ctx.trace_id,
          metadata: {
            source: "api",
            context: { inflow_id: entity.inflow_id },
          },
        });
      }

      await batch.commit();
    }

    console.log(
      `[${ctx.trace_id}] inflow_period_repo.save_batch: saved=${results.length}`
    );

    return {
      results,
      count: entities.length,
      success: true,
    };
  },

  /**
   * Gets inflow periods by inflow ID.
   */
  async get_by_inflow_id(
    ctx: TraceContext,
    inflow_id: string
  ): Promise<string[]> {
    const db = getFirestore();
    const snapshot = await db
      .collection(COLLECTION)
      .where("inflowId", "==", inflow_id)
      .select() // Only need IDs
      .get();

    console.log(
      `[${ctx.trace_id}] inflow_period_repo.get_by_inflow_id: found=${snapshot.size}`
    );

    return snapshot.docs.map((doc) => doc.id);
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
   * Deletes all inflow periods for an inflow.
   *
   * Used when regenerating periods or soft-deleting an inflow.
   */
  async delete_by_inflow_id(
    ctx: TraceContext,
    inflow_id: string,
    user_id: string
  ): Promise<WriteResult[]> {
    const db = getFirestore();
    const results: WriteResult[] = [];

    // Get all periods for this inflow
    const snapshot = await db
      .collection(COLLECTION)
      .where("inflowId", "==", inflow_id)
      .get();

    if (snapshot.empty) {
      return results;
    }

    const chunks = chunk_for_batch(snapshot.docs);

    for (const chunk of chunks) {
      const batch = db.batch();

      for (const doc of chunk) {
        batch.delete(doc.ref);
        results.push(
          create_write_result("inflow_period", doc.id, "replace", doc.data(), null)
        );

        record_audit_entry_async({
          user_id,
          action: "delete",
          entity_type: "inflow_period",
          entity_id: doc.id,
          before: doc.data() as Record<string, unknown>,
          after: null,
          trace_id: ctx.trace_id,
          metadata: {
            source: "api",
            context: { inflow_id },
          },
        });
      }

      await batch.commit();
    }

    console.log(
      `[${ctx.trace_id}] inflow_period_repo.delete_by_inflow_id: deleted=${results.length}`
    );

    return results;
  },
};
