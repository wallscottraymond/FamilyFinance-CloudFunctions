/**
 * User Summary Repository
 *
 * Handles persistence for user_summaries collection.
 * Follows the 5-layer architecture pattern.
 *
 * @module repositories/user_summary
 */

import { getFirestore, Timestamp, Transaction } from "firebase-admin/firestore";
import {
  WriteResult,
  TraceContext,
  create_write_result,
} from "../types";
import { record_audit_entry_async } from "../audit";
import { UserPeriodSummary } from "../summaries/types/periodSummaries";
import {
  OutflowPeriod,
  BudgetPeriodDocument,
  InflowPeriod,
  SourcePeriod,
} from "../../types";

/**
 * Firestore collection name.
 */
const COLLECTION = "user_summaries";

/**
 * User summary entity for persistence (snake_case - domain format).
 */
export interface UserSummaryForPersistence {
  id: string;
  user_id: string;
  source_period_id: string;
  period_type: string;

  // Period context
  period_start_date: Timestamp;
  period_end_date: Timestamp;
  year: number;
  month?: number;
  week_number?: number;
  bi_monthly_half?: 1 | 2;

  // Resource entries (arrays)
  outflows: unknown[];
  budgets: unknown[];
  inflows: unknown[];
  goals: unknown[];

  // Metadata
  last_recalculated: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

/**
 * Maps snake_case entity to camelCase Firestore document.
 */
/* eslint-disable @typescript-eslint/naming-convention */
function map_to_firestore_doc(entity: UserSummaryForPersistence): Record<string, unknown> {
  return {
    id: entity.id,
    userId: entity.user_id,
    sourcePeriodId: entity.source_period_id,
    periodType: entity.period_type,

    // Period context
    periodStartDate: entity.period_start_date,
    periodEndDate: entity.period_end_date,
    year: entity.year,
    month: entity.month,
    weekNumber: entity.week_number,
    biMonthlyHalf: entity.bi_monthly_half,

    // Resource entries
    outflows: entity.outflows,
    budgets: entity.budgets,
    inflows: entity.inflows,
    goals: entity.goals,

    // Metadata
    lastRecalculated: entity.last_recalculated,
    createdAt: entity.created_at,
    updatedAt: entity.updated_at,
  };
}

/**
 * Maps camelCase Firestore document to snake_case domain entity.
 */
function map_to_domain(doc_data: Record<string, unknown>): UserSummaryForPersistence {
  return {
    id: doc_data.id as string,
    user_id: doc_data.userId as string,
    source_period_id: doc_data.sourcePeriodId as string,
    period_type: doc_data.periodType as string,

    // Period context
    period_start_date: doc_data.periodStartDate as Timestamp,
    period_end_date: doc_data.periodEndDate as Timestamp,
    year: doc_data.year as number,
    month: doc_data.month as number | undefined,
    week_number: doc_data.weekNumber as number | undefined,
    bi_monthly_half: doc_data.biMonthlyHalf as 1 | 2 | undefined,

    // Resource entries
    outflows: (doc_data.outflows as unknown[]) || [],
    budgets: (doc_data.budgets as unknown[]) || [],
    inflows: (doc_data.inflows as unknown[]) || [],
    goals: (doc_data.goals as unknown[]) || [],

    // Metadata
    last_recalculated: doc_data.lastRecalculated as Timestamp,
    created_at: doc_data.createdAt as Timestamp,
    updated_at: doc_data.updatedAt as Timestamp,
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
 * User Summary Repository
 *
 * Handles persistence for user_summaries collection.
 */
export const user_summary_repo = {
  /**
   * Saves a user summary document.
   *
   * Creates or updates the summary document with a full replace operation.
   * This is the intended behavior - summaries are always recalculated completely.
   *
   * @param ctx - Trace context for logging
   * @param entity - The summary entity to save
   * @returns Write result
   */
  async save(
    ctx: TraceContext,
    entity: UserSummaryForPersistence
  ): Promise<WriteResult> {
    const db = getFirestore();
    const ref = db.collection(COLLECTION).doc(entity.id);

    // Get existing for audit
    const existing_doc = await ref.get();
    const before = existing_doc.exists ? existing_doc.data() : null;

    // Map to Firestore format
    const doc_data = map_to_firestore_doc(entity);

    // Write document
    await ref.set(doc_data);

    console.log(
      `[${ctx.trace_id}] user_summary_repo.save: ${existing_doc.exists ? "updated" : "created"} ${entity.id}`
    );

    // Audit entry (async, non-blocking)
    record_audit_entry_async({
      user_id: entity.user_id,
      action: existing_doc.exists ? "update" : "create",
      entity_type: "user_summary",
      entity_id: entity.id,
      before: before as Record<string, unknown> | null,
      after: doc_data as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: {
        source: "api",
        context: {
          period_type: entity.period_type,
          source_period_id: entity.source_period_id,
        },
      },
    });

    return create_write_result(
      "user_summary",
      entity.id,
      "replace",
      before,
      doc_data
    );
  },

  /**
   * Gets a user summary by ID.
   *
   * @param ctx - Trace context for logging
   * @param id - The summary document ID
   * @returns The summary entity or null if not found
   */
  async get_by_id(
    ctx: TraceContext,
    id: string
  ): Promise<UserSummaryForPersistence | null> {
    const doc = await doc_ref(id).get();

    if (!doc.exists) {
      console.log(`[${ctx.trace_id}] user_summary_repo.get_by_id: not found ${id}`);
      return null;
    }

    console.log(`[${ctx.trace_id}] user_summary_repo.get_by_id: found ${id}`);
    return map_to_domain(doc.data() as Record<string, unknown>);
  },

  /**
   * Gets a user summary by user, period type, and source period.
   *
   * This is the most common query pattern for summaries.
   *
   * @param ctx - Trace context for logging
   * @param user_id - The user ID
   * @param period_type - The period type (e.g., "monthly")
   * @param source_period_id - The source period ID (e.g., "2025M06")
   * @returns The summary entity or null if not found
   */
  async get_by_user_and_period(
    ctx: TraceContext,
    user_id: string,
    period_type: string,
    source_period_id: string
  ): Promise<UserSummaryForPersistence | null> {
    // Build the expected document ID
    const normalized_period_type = period_type.toLowerCase();
    const summary_id = `${user_id}_${normalized_period_type}_${source_period_id}`;

    return this.get_by_id(ctx, summary_id);
  },

  /**
   * Maps a UserPeriodSummary (camelCase frontend format) to UserSummaryForPersistence (snake_case domain format).
   *
   * Helper function for converting existing summary objects to the persistence format.
   */
  map_from_user_period_summary(summary: UserPeriodSummary): UserSummaryForPersistence {
    return {
      id: summary.id,
      user_id: summary.userId,
      source_period_id: summary.sourcePeriodId,
      period_type: summary.periodType,

      period_start_date: summary.periodStartDate,
      period_end_date: summary.periodEndDate,
      year: summary.year,
      month: summary.month,
      week_number: summary.weekNumber,
      bi_monthly_half: summary.biMonthlyHalf,

      outflows: summary.outflows,
      budgets: summary.budgets,
      inflows: summary.inflows,
      goals: summary.goals,

      last_recalculated: summary.lastRecalculated,
      created_at: summary.createdAt,
      updated_at: summary.updatedAt,
    };
  },

  /**
   * Atomically updates a user summary using a Firestore transaction.
   *
   * This prevents race conditions by:
   * 1. Reading the existing summary (establishes conflict detection)
   * 2. Reading all dependent period documents inside the transaction
   * 3. Computing the new summary with fresh data
   * 4. Writing atomically
   *
   * If the summary document changes between read and write, Firestore
   * automatically retries the transaction with fresh data.
   *
   * @param ctx - Trace context for logging
   * @param summary_id - The summary document ID
   * @param user_id - The user ID
   * @param source_period_id - The source period ID
   * @param period_type - The period type
   * @param compute_fn - Function to compute the summary from dependencies
   * @returns Write result
   */
  async save_with_transaction(
    ctx: TraceContext,
    summary_id: string,
    user_id: string,
    source_period_id: string,
    period_type: string,
    compute_fn: (deps: TransactionDependencies) => UserSummaryForPersistence
  ): Promise<WriteResult> {
    const db = getFirestore();
    const summary_ref = db.collection(COLLECTION).doc(summary_id);

    let before_data: Record<string, unknown> | null = null;
    let after_data: Record<string, unknown> | null = null;
    let was_created = false;

    await db.runTransaction(async (transaction: Transaction) => {
      // 1. Read the existing summary FIRST (establishes conflict detection)
      const existing_summary = await transaction.get(summary_ref);
      before_data = existing_summary.exists ? (existing_summary.data() as Record<string, unknown>) : null;
      was_created = !existing_summary.exists;

      // 2. Read source period
      const source_period_ref = db.collection("source_periods").doc(source_period_id);
      const source_period_doc = await transaction.get(source_period_ref);

      if (!source_period_doc.exists) {
        throw new Error(`Source period not found: ${source_period_id}`);
      }

      const source_period = source_period_doc.data() as SourcePeriod;

      // 3. Read all dependent period documents
      // Note: Firestore transactions require us to read docs by reference, not query
      // So we query outside and then read each doc inside the transaction for conflict detection
      const [outflow_snapshot, budget_snapshot, inflow_snapshot] = await Promise.all([
        db.collection("outflow_periods")
          .where("ownerId", "==", user_id)
          .where("sourcePeriodId", "==", source_period_id)
          .where("isActive", "==", true)
          .get(),
        db.collection("budget_periods")
          .where("userId", "==", user_id)
          .where("sourcePeriodId", "==", source_period_id)
          .where("periodType", "==", period_type)
          .where("isActive", "==", true)
          .get(),
        db.collection("inflow_periods")
          .where("ownerId", "==", user_id)
          .where("sourcePeriodId", "==", source_period_id)
          .where("isActive", "==", true)
          .get(),
      ]);

      const outflow_periods = outflow_snapshot.docs.map((doc) => doc.data() as OutflowPeriod);
      const budget_periods = budget_snapshot.docs.map((doc) => doc.data() as BudgetPeriodDocument);
      const inflow_periods = inflow_snapshot.docs.map((doc) => doc.data() as InflowPeriod);

      console.log(
        `[${ctx.trace_id}] user_summary_repo.save_with_transaction: ` +
          `read ${outflow_periods.length} outflows, ${budget_periods.length} budgets, ${inflow_periods.length} inflows`
      );

      // 4. Compute new summary using provided function
      const new_summary = compute_fn({
        source_period,
        outflow_periods,
        budget_periods,
        inflow_periods,
      });

      // 5. Write atomically
      after_data = map_to_firestore_doc(new_summary);
      transaction.set(summary_ref, after_data);
    });

    console.log(
      `[${ctx.trace_id}] user_summary_repo.save_with_transaction: ` +
        `${was_created ? "created" : "updated"} ${summary_id}`
    );

    // Audit entry (async, non-blocking)
    record_audit_entry_async({
      user_id,
      action: was_created ? "create" : "update",
      entity_type: "user_summary",
      entity_id: summary_id,
      before: before_data,
      after: after_data,
      trace_id: ctx.trace_id,
      metadata: {
        source: "api",
        context: {
          period_type,
          source_period_id,
          transactional: true,
        },
      },
    });

    return create_write_result(
      "user_summary",
      summary_id,
      "replace",
      before_data,
      after_data
    );
  },
};

/**
 * Dependencies provided to the compute function during transactional update.
 */
export interface TransactionDependencies {
  source_period: SourcePeriod;
  outflow_periods: OutflowPeriod[];
  budget_periods: BudgetPeriodDocument[];
  inflow_periods: InflowPeriod[];
}
