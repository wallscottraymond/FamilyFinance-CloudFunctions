/**
 * Budget Period Repository
 *
 * Persistence for budget_periods. Scoped to what the budget CRUD migration
 * needs: listing and batch-deleting periods for a budget (the delete cascade).
 *
 * Period GENERATION (prime/non-prime allocation from source_periods) remains
 * owned by the existing budget period engine and is invoked from the create
 * cascade job — it is intentionally not reimplemented here.
 *
 * @module repositories/budget_period
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  TraceContext,
  WriteResult,
  create_write_result,
  chunk_for_batch,
} from "../types";
import { BudgetPeriodEntity } from "../types/budgets/budget_entity.types";

/**
 * Firestore collection name.
 */
const COLLECTION = "budget_periods";

/* eslint-disable @typescript-eslint/naming-convention */
interface LegacyBudgetPeriodDoc {
  id: string;
  budgetId: string;
  userId?: string;
  groupIds?: string[];
  periodId: string;
  periodType: string;
  periodStart: Timestamp;
  periodEnd: Timestamp;
  allocatedAmount: number;
  rolledOverAmount?: number;
  spent?: number;
  remaining?: number;
  dailyRate?: number;
  isActive: boolean;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Inclusive UTC-normalized day count between two timestamps.
 */
function day_count(start: Timestamp, end: Timestamp): number {
  const s = start.toDate();
  const e = end.toDate();
  const s_utc = Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate());
  const e_utc = Date.UTC(e.getUTCFullYear(), e.getUTCMonth(), e.getUTCDate());
  return Math.round((e_utc - s_utc) / (1000 * 60 * 60 * 24)) + 1;
}

/**
 * Maps a legacy budget period document to the entity.
 */
function map_to_entity(doc: LegacyBudgetPeriodDoc): BudgetPeriodEntity {
  const allocated = doc.allocatedAmount ?? 0;
  const rolled_over = doc.rolledOverAmount ?? 0;
  const spent = doc.spent ?? 0;
  return {
    id: doc.id,
    budget_id: doc.budgetId,
    user_id: doc.userId ?? "",
    group_ids: doc.groupIds ?? [],
    period_id: doc.periodId,
    period_type: (doc.periodType as BudgetPeriodEntity["period_type"]) ?? "monthly",
    allocated_amount: allocated,
    rolled_over_amount: rolled_over,
    effective_amount: allocated + rolled_over,
    spent,
    remaining: allocated + rolled_over - spent,
    daily_rate: doc.dailyRate ?? 0,
    start_date: doc.periodStart,
    end_date: doc.periodEnd,
    is_active: doc.isActive ?? true,
    created_at: doc.createdAt ?? doc.updatedAt ?? Timestamp.now(),
    updated_at: doc.updatedAt ?? Timestamp.now(),
  };
}

/**
 * Budget Period Repository.
 */
export const budget_period_repo = {
  /**
   * Returns the document IDs of all periods for a budget.
   * Used by the delete resolver to size the cascade.
   */
  async get_ids_by_budget_id(
    _ctx: TraceContext,
    budget_id: string
  ): Promise<string[]> {
    const snapshot = await getFirestore()
      .collection(COLLECTION)
      .where("budgetId", "==", budget_id)
      .select()
      .get();
    return snapshot.docs.map((doc) => doc.id);
  },

  /**
   * Returns all periods for a budget as entities.
   */
  async get_by_budget_id(
    _ctx: TraceContext,
    budget_id: string
  ): Promise<BudgetPeriodEntity[]> {
    const snapshot = await getFirestore()
      .collection(COLLECTION)
      .where("budgetId", "==", budget_id)
      .get();
    return snapshot.docs.map((doc) =>
      map_to_entity(doc.data() as LegacyBudgetPeriodDoc)
    );
  },

  /**
   * Hard-deletes all periods for a budget in batches (max 500 per batch).
   * Returns one WriteResult per deleted period.
   */
  async delete_by_budget_id(
    _ctx: TraceContext,
    budget_id: string
  ): Promise<WriteResult[]> {
    const ids = await this.get_ids_by_budget_id(_ctx, budget_id);
    return this.delete_by_ids(_ctx, ids);
  },

  /**
   * Hard-deletes periods by document ID in batches (max 500 per batch).
   */
  async delete_by_ids(
    _ctx: TraceContext,
    ids: string[]
  ): Promise<WriteResult[]> {
    if (ids.length === 0) {
      return [];
    }
    const db = getFirestore();
    const results: WriteResult[] = [];
    const chunks = chunk_for_batch(ids);

    for (const chunk of chunks) {
      const batch = db.batch();
      for (const id of chunk) {
        batch.delete(db.collection(COLLECTION).doc(id));
        results.push(
          create_write_result("budget_period", id, "replace", { id }, null)
        );
      }
      await batch.commit();
    }
    return results;
  },

  /**
   * Batch-saves generated budget periods (max 500 per batch).
   * Maps each entity to the legacy budget_periods document, defaulting the
   * fields the rest of the system reads (denormalized name, checklist, flags).
   *
   * @param ctx - Trace context
   * @param periods - Period entities to persist
   * @param budget_name - Denormalized budget name to store on each period
   */
  async save_batch(
    _ctx: TraceContext,
    periods: BudgetPeriodEntity[],
    budget_name: string
  ): Promise<WriteResult[]> {
    if (periods.length === 0) {
      return [];
    }
    const db = getFirestore();
    const now = Timestamp.now();
    const results: WriteResult[] = [];
    const chunks = chunk_for_batch(periods);

    for (const chunk of chunks) {
      const batch = db.batch();
      for (const period of chunk) {
        const days = day_count(period.start_date, period.end_date);
        /* eslint-disable @typescript-eslint/naming-convention */
        const doc_data = {
          id: period.id,
          budgetId: period.budget_id,
          budgetName: budget_name,
          userId: period.user_id,
          groupIds: period.group_ids,
          periodId: period.period_id,
          sourcePeriodId: period.period_id,
          periodType: period.period_type,
          periodStart: period.start_date,
          periodEnd: period.end_date,
          allocatedAmount: period.allocated_amount,
          originalAmount: period.allocated_amount,
          rolledOverAmount: period.rolled_over_amount,
          spent: period.spent,
          remaining: period.remaining,
          dailyRate: period.daily_rate,
          daysInPeriod: days,
          isModified: false,
          checklistItems: [],
          lastCalculated: now,
          isActive: period.is_active,
          createdAt: period.created_at ?? now,
          updatedAt: now,
        };
        /* eslint-enable @typescript-eslint/naming-convention */
        batch.set(db.collection(COLLECTION).doc(period.id), doc_data);
        results.push(
          create_write_result("budget_period", period.id, "replace", null, doc_data)
        );
      }
      await batch.commit();
    }
    return results;
  },

  /**
   * Updates allocation fields IN PLACE on existing periods (max 500 per batch).
   * Used when a budget's amount changes: recomputes allocatedAmount /
   * originalAmount / remaining / dailyRate while preserving everything else on
   * the period (userNotes, checklistItems, modifiedAmount, spent, etc.).
   */
  async update_allocations(
    _ctx: TraceContext,
    updates: Array<{
      id: string;
      allocated_amount: number;
      daily_rate: number;
      remaining: number;
    }>
  ): Promise<WriteResult[]> {
    if (updates.length === 0) {
      return [];
    }
    const db = getFirestore();
    const now = Timestamp.now();
    const results: WriteResult[] = [];
    const chunks = chunk_for_batch(updates);

    for (const chunk of chunks) {
      const batch = db.batch();
      for (const u of chunk) {
        /* eslint-disable @typescript-eslint/naming-convention */
        const update_data = {
          allocatedAmount: u.allocated_amount,
          originalAmount: u.allocated_amount,
          remaining: u.remaining,
          dailyRate: u.daily_rate,
          lastCalculated: now,
          updatedAt: now,
        };
        /* eslint-enable @typescript-eslint/naming-convention */
        batch.update(db.collection(COLLECTION).doc(u.id), update_data);
        results.push(
          create_write_result("budget_period", u.id, "merge", { id: u.id }, update_data)
        );
      }
      await batch.commit();
    }
    return results;
  },

  /**
   * Updates the denormalized budgetName on the given periods (max 500 per
   * batch). Used when a budget is renamed. Preserves all other period fields.
   */
  async update_names(
    _ctx: TraceContext,
    period_ids: string[],
    budget_name: string
  ): Promise<WriteResult[]> {
    if (period_ids.length === 0) {
      return [];
    }
    const db = getFirestore();
    const now = Timestamp.now();
    const results: WriteResult[] = [];
    const chunks = chunk_for_batch(period_ids);

    for (const chunk of chunks) {
      const batch = db.batch();
      for (const id of chunk) {
        /* eslint-disable @typescript-eslint/naming-convention */
        const update_data = { budgetName: budget_name, updatedAt: now };
        /* eslint-enable @typescript-eslint/naming-convention */
        batch.update(db.collection(COLLECTION).doc(id), update_data);
        results.push(
          create_write_result("budget_period", id, "merge", { id }, update_data)
        );
      }
      await batch.commit();
    }
    return results;
  },

  /**
   * Counts periods for a budget.
   */
  async count_by_budget_id(
    _ctx: TraceContext,
    budget_id: string
  ): Promise<number> {
    const snapshot = await getFirestore()
      .collection(COLLECTION)
      .where("budgetId", "==", budget_id)
      .count()
      .get();
    return snapshot.data().count;
  },
};
