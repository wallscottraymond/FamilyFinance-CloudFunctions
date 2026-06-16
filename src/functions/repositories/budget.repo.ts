/**
 * Budget Repository
 *
 * Handles persistence for budget entities. All writes are audited.
 *
 * NOTE: This repository uses snake_case internally (BudgetEntity) but maps
 * to/from the legacy camelCase Firestore documents (the `Budget` interface in
 * src/types/index.ts) for backwards compatibility.
 *
 * @module repositories/budget
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import {
  WriteResult,
  ReadOptions,
  TraceContext,
  create_write_result,
} from "../types";
import { BudgetEntity } from "../types/budgets/budget_entity.types";
import { record_audit_entry_async } from "../audit";

/**
 * Firestore collection name.
 */
const COLLECTION = "budgets";

/**
 * Safety cap on the per-field budget queries in `get_by_user_id`. A real user
 * has at most a few hundred budgets; this bounds the scan so a runaway/abusive
 * account can't turn an assignment read into a full-collection scan. If a query
 * ever hits the cap we log a warning (silent truncation would read as "all
 * budgets" when it isn't).
 */
const MAX_BUDGETS_PER_USER = 1000;

/**
 * Legacy Firestore document structure (camelCase).
 * NOTE: camelCase is intentional - this interfaces with existing documents.
 */
/* eslint-disable @typescript-eslint/naming-convention */
interface LegacyBudgetDoc {
  id: string;
  userId: string;
  groupIds?: string[];
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy?: string;
  ownerId?: string;
  isPrivate?: boolean;
  access?: {
    ownerId: string;
    createdBy: string;
    groupIds: string[];
    isPrivate: boolean;
  };
  name: string;
  description?: string;
  amount: number;
  currency?: string;
  categoryIds?: string[];
  period: string;
  budgetType?: string;
  startDate: Timestamp;
  endDate: Timestamp;
  spent?: number;
  remaining?: number;
  alertThreshold?: number;
  selectedStartPeriod?: string;
  endPeriod?: string;
  totalPeriods?: number;
  activePeriodRange?: {
    startPeriod: string;
    endPeriod: string;
  };
  lastExtended?: Timestamp;
  isOngoing?: boolean;
  budgetEndDate?: Timestamp;
  isSystemEverythingElse?: boolean;
  rolloverEnabled?: boolean;
  rolloverStrategy?: "immediate" | "spread";
  rolloverSpreadPeriods?: number;
  // Legacy fields kept for compatibility with the old code paths
  familyId?: string;
  groupId?: string | null;
  accessibleBy?: string[];
  memberIds?: string[];
  isShared?: boolean;
}

/**
 * Maps legacy Firestore document to BudgetEntity.
 */
function map_to_entity(doc: LegacyBudgetDoc): BudgetEntity {
  const group_ids = doc.groupIds ?? [];
  return {
    id: doc.id,
    user_id: doc.userId,
    group_ids,
    is_active: doc.isActive,
    access: doc.access
      ? {
        owner_id: doc.access.ownerId,
        created_by: doc.access.createdBy,
        group_ids: doc.access.groupIds,
        is_private: doc.access.isPrivate,
      }
      : {
        owner_id: doc.ownerId ?? doc.userId,
        created_by: doc.createdBy ?? doc.userId,
        group_ids,
        is_private: group_ids.length === 0,
      },
    created_by: doc.createdBy ?? doc.userId,
    owner_id: doc.ownerId ?? doc.userId,
    is_private: doc.isPrivate ?? group_ids.length === 0,
    name: doc.name,
    description: doc.description,
    amount: doc.amount,
    currency: doc.currency ?? "USD",
    category_ids: doc.categoryIds ?? [],
    period: (doc.period as BudgetEntity["period"]) ?? "monthly",
    budget_type: (doc.budgetType as BudgetEntity["budget_type"]) ?? "recurring",
    start_date: doc.startDate,
    end_date: doc.endDate,
    spent: doc.spent ?? 0,
    remaining: doc.remaining ?? doc.amount,
    alert_threshold: doc.alertThreshold ?? 80,
    selected_start_period: doc.selectedStartPeriod,
    end_period: doc.endPeriod,
    total_periods: doc.totalPeriods,
    active_period_range: doc.activePeriodRange
      ? {
        start_period: doc.activePeriodRange.startPeriod,
        end_period: doc.activePeriodRange.endPeriod,
      }
      : undefined,
    last_extended: doc.lastExtended,
    is_ongoing: doc.isOngoing ?? true,
    budget_end_date: doc.budgetEndDate,
    is_system_everything_else: doc.isSystemEverythingElse,
    rollover_enabled: doc.rolloverEnabled,
    rollover_strategy: doc.rolloverStrategy,
    rollover_spread_periods: doc.rolloverSpreadPeriods,
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

/**
 * Maps BudgetEntity to legacy Firestore document.
 * Preserves the legacy compatibility fields the rest of the system reads.
 */
function map_to_doc(entity: BudgetEntity): LegacyBudgetDoc {
  const single_group_id = entity.group_ids[0] ?? null;
  return {
    id: entity.id,
    userId: entity.user_id,
    groupIds: entity.group_ids,
    isActive: entity.is_active,
    createdAt: entity.created_at,
    updatedAt: entity.updated_at,
    createdBy: entity.created_by,
    ownerId: entity.owner_id,
    isPrivate: entity.is_private,
    access: {
      ownerId: entity.access.owner_id,
      createdBy: entity.access.created_by,
      groupIds: entity.access.group_ids,
      isPrivate: entity.access.is_private,
    },
    name: entity.name,
    description: entity.description,
    amount: entity.amount,
    currency: entity.currency,
    categoryIds: entity.category_ids,
    period: entity.period,
    budgetType: entity.budget_type,
    startDate: entity.start_date,
    endDate: entity.end_date,
    spent: entity.spent,
    remaining: entity.remaining,
    alertThreshold: entity.alert_threshold,
    selectedStartPeriod: entity.selected_start_period,
    endPeriod: entity.end_period,
    totalPeriods: entity.total_periods,
    activePeriodRange: entity.active_period_range
      ? {
        startPeriod: entity.active_period_range.start_period,
        endPeriod: entity.active_period_range.end_period,
      }
      : undefined,
    lastExtended: entity.last_extended,
    isOngoing: entity.is_ongoing,
    budgetEndDate: entity.budget_end_date,
    isSystemEverythingElse: entity.is_system_everything_else,
    rolloverEnabled: entity.rollover_enabled,
    rolloverStrategy: entity.rollover_strategy,
    rolloverSpreadPeriods: entity.rollover_spread_periods,
    // Legacy compatibility fields
    familyId: entity.is_private ? undefined : single_group_id ?? undefined,
    groupId: single_group_id,
    accessibleBy: [entity.user_id],
    memberIds: [entity.user_id],
    isShared: !entity.is_private,
  };
}
/* eslint-enable @typescript-eslint/naming-convention */

/**
 * Removes undefined values so Firestore set() does not reject them.
 */
function strip_undefined<T extends Record<string, unknown>>(obj: T): T {
  const out = {} as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      out[key] = value;
    }
  }
  return out as T;
}

/**
 * Gets Firestore document reference.
 */
function doc_ref(id: string): FirebaseFirestore.DocumentReference {
  return getFirestore().collection(COLLECTION).doc(id);
}

/**
 * Budget Repository.
 * All write operations automatically create audit entries.
 */
export const budget_repo = {
  /**
   * Generates a new budget document ID without writing.
   */
  new_id(): string {
    return getFirestore().collection(COLLECTION).doc().id;
  },

  /**
   * Gets a budget by ID.
   */
  async get_by_id(
    _ctx: TraceContext,
    id: string,
    options?: ReadOptions
  ): Promise<BudgetEntity | null> {
    const doc = await doc_ref(id).get();
    if (!doc.exists) {
      return null;
    }
    const data = doc.data() as LegacyBudgetDoc;
    if (!data.isActive && !options?.include_deleted) {
      return null;
    }
    // Always source the entity id from the doc ref — legacy-created docs (e.g.
    // the Everything Else budget) don't denormalize an `id` field into data.
    return map_to_entity({ ...data, id: doc.id });
  },

  /**
   * Gets all active budgets for a user.
   *
   * Queries by both createdBy (RBAC) and userId (legacy) and dedupes,
   * matching the legacy category-ownership behavior.
   */
  async get_by_user_id(
    _ctx: TraceContext,
    user_id: string,
    options?: ReadOptions
  ): Promise<BudgetEntity[]> {
    const db = getFirestore();
    const include_deleted = options?.include_deleted ?? false;

    const build = (field: string): FirebaseFirestore.Query => {
      let q = db.collection(COLLECTION).where(field, "==", user_id);
      if (!include_deleted) {
        q = q.where("isActive", "==", true);
      }
      return q.limit(MAX_BUDGETS_PER_USER);
    };

    const [created_by_snap, user_id_snap] = await Promise.all([
      build("createdBy").get(),
      build("userId").get(),
    ]);

    for (const [field, snap] of [
      ["createdBy", created_by_snap],
      ["userId", user_id_snap],
    ] as const) {
      if (snap.size >= MAX_BUDGETS_PER_USER) {
        console.warn(
          `[budget_repo.get_by_user_id] user=${user_id} hit the ${MAX_BUDGETS_PER_USER} ` +
            `budget cap on "${field}" — results may be truncated`
        );
      }
    }

    const by_id = new Map<string, BudgetEntity>();
    for (const snap of [created_by_snap, user_id_snap]) {
      snap.docs.forEach((doc) => {
        if (!by_id.has(doc.id)) {
          // Source the id from the doc ref — legacy-created docs (Everything
          // Else) don't store an `id` field in their data.
          by_id.set(
            doc.id,
            map_to_entity({ ...(doc.data() as LegacyBudgetDoc), id: doc.id })
          );
        }
      });
    }
    return Array.from(by_id.values());
  },

  /**
   * Counts active budgets for a user (used for the budget limit).
   */
  async count_by_user_id(
    _ctx: TraceContext,
    user_id: string
  ): Promise<number> {
    const budgets = await this.get_by_user_id(_ctx, user_id);
    return budgets.length;
  },

  /**
   * Finds the user's system "Everything Else" budget, if any.
   */
  async find_everything_else(
    _ctx: TraceContext,
    user_id: string
  ): Promise<BudgetEntity | null> {
    const budgets = await this.get_by_user_id(_ctx, user_id);
    return budgets.find((b) => b.is_system_everything_else === true) ?? null;
  },

  /**
   * Atomically removes category IDs from a budget's categoryIds array.
   * Idempotent: removing an absent category is a no-op.
   */
  async remove_category_ids(
    ctx: TraceContext,
    id: string,
    category_ids: string[],
    user_id: string
  ): Promise<WriteResult> {
    if (category_ids.length === 0) {
      return create_write_result("budget", id, "merge", { id }, { id });
    }
    // Read-modify-REPLACE: recompute the full categoryIds array and set it,
    // never a blind FieldValue.arrayRemove. Atomic within this one budget
    // aggregate (the only guide-sanctioned use of a Firestore transaction).
    const remove_set = new Set(category_ids);
    await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(doc_ref(id));
      const current = (snap.data()?.categoryIds as string[] | undefined) ?? [];
      const next = current.filter((c) => !remove_set.has(c));
      /* eslint-disable @typescript-eslint/naming-convention */
      tx.update(doc_ref(id), { categoryIds: next, updatedAt: Timestamp.now() });
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    record_audit_entry_async({
      user_id,
      action: "update",
      entity_type: "budget",
      entity_id: id,
      before: null,
      after: { removed_category_ids: category_ids } as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api", context: { category_transfer: "remove" } },
    });

    return create_write_result(
      "budget",
      id,
      "merge",
      { category_ids: "before" },
      { removed: category_ids }
    );
  },

  /**
   * Atomically adds category IDs to a budget's categoryIds array.
   * Idempotent: adding an existing category is a no-op.
   */
  async add_category_ids(
    ctx: TraceContext,
    id: string,
    category_ids: string[],
    user_id: string
  ): Promise<WriteResult> {
    if (category_ids.length === 0) {
      return create_write_result("budget", id, "merge", { id }, { id });
    }
    // Read-modify-REPLACE: recompute the deduped categoryIds array and set it,
    // never a blind FieldValue.arrayUnion. Atomic within this one budget aggregate.
    await getFirestore().runTransaction(async (tx) => {
      const snap = await tx.get(doc_ref(id));
      const current = (snap.data()?.categoryIds as string[] | undefined) ?? [];
      const next = [...new Set([...current, ...category_ids])];
      /* eslint-disable @typescript-eslint/naming-convention */
      tx.update(doc_ref(id), { categoryIds: next, updatedAt: Timestamp.now() });
      /* eslint-enable @typescript-eslint/naming-convention */
    });

    record_audit_entry_async({
      user_id,
      action: "update",
      entity_type: "budget",
      entity_id: id,
      before: null,
      after: { added_category_ids: category_ids } as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api", context: { category_transfer: "add" } },
    });

    return create_write_result(
      "budget",
      id,
      "merge",
      { category_ids: "before" },
      { added: category_ids }
    );
  },

  /**
   * Writes back period-range metadata after budget periods are generated.
   * Mirrors the legacy `updateBudgetPeriodRange`: sets activePeriodRange +
   * lastExtended for all budgets, and the extension flags for recurring ones.
   */
  async set_period_range(
    ctx: TraceContext,
    id: string,
    start_period_id: string,
    end_period_id: string,
    generation_end: Timestamp,
    is_recurring: boolean,
    user_id: string
  ): Promise<WriteResult> {
    const now = Timestamp.now();
    /* eslint-disable @typescript-eslint/naming-convention */
    const update_data: Record<string, unknown> = {
      activePeriodRange: {
        startPeriod: start_period_id,
        endPeriod: end_period_id,
      },
      lastExtended: now,
      updatedAt: now,
    };
    if (is_recurring) {
      update_data.periodsGeneratedUntil = generation_end;
      update_data.canExtendPeriods = true;
      update_data.needsScheduledExtension = true;
    }
    /* eslint-enable @typescript-eslint/naming-convention */

    await doc_ref(id).update(update_data);

    record_audit_entry_async({
      user_id,
      action: "update",
      entity_type: "budget",
      entity_id: id,
      before: null,
      after: update_data as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api", context: { period_range: true } },
    });

    return create_write_result(
      "budget",
      id,
      "merge",
      { active_period_range: "before" },
      update_data
    );
  },

  /**
   * Saves a budget (create or update).
   */
  async save(ctx: TraceContext, entity: BudgetEntity): Promise<WriteResult> {
    if (!entity.id) {
      throw new Error("Budget ID is required");
    }
    if (!entity.user_id) {
      throw new Error("User ID is required");
    }

    const before_doc = await doc_ref(entity.id).get();
    const before = before_doc.exists
      ? (before_doc.data() as LegacyBudgetDoc)
      : null;

    const entity_to_save: BudgetEntity = {
      ...entity,
      updated_at: Timestamp.now(),
    };
    const doc_data = strip_undefined(
      map_to_doc(entity_to_save) as unknown as Record<string, unknown>
    );
    await doc_ref(entity.id).set(doc_data);

    record_audit_entry_async({
      user_id: entity.user_id,
      action: before ? "update" : "create",
      entity_type: "budget",
      entity_id: entity.id,
      before: before as Record<string, unknown> | null,
      after: doc_data as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api" },
    });

    return create_write_result(
      "budget",
      entity.id,
      "replace",
      before,
      doc_data
    );
  },

  /**
   * Updates only the category ownership for a budget (claim/release).
   * Used by the cascade job to transfer categories without a full rewrite.
   */
  async set_category_ids(
    ctx: TraceContext,
    id: string,
    category_ids: string[],
    user_id: string
  ): Promise<WriteResult> {
    const before_doc = await doc_ref(id).get();
    if (!before_doc.exists) {
      throw new Error(`Budget ${id} not found`);
    }
    const before = before_doc.data() as LegacyBudgetDoc;
    const now = Timestamp.now();
    /* eslint-disable @typescript-eslint/naming-convention */
    const update_data = {
      categoryIds: category_ids,
      updatedAt: now,
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    await doc_ref(id).update(update_data);
    const after = { ...before, ...update_data };

    record_audit_entry_async({
      user_id,
      action: "update",
      entity_type: "budget",
      entity_id: id,
      before: before as unknown as Record<string, unknown>,
      after: after as unknown as Record<string, unknown>,
      trace_id: ctx.trace_id,
      metadata: { source: "api", context: { category_transfer: true } },
    });

    return create_write_result("budget", id, "merge", before, after);
  },

  /**
   * Hard-deletes a budget document.
   * Matches the legacy delete semantics (the cascade job removes periods and
   * reassigns transaction splits separately).
   */
  async hard_delete(
    ctx: TraceContext,
    id: string,
    user_id: string
  ): Promise<WriteResult> {
    const before_doc = await doc_ref(id).get();
    if (!before_doc.exists) {
      throw new Error(`Budget ${id} not found`);
    }
    const before = before_doc.data() as LegacyBudgetDoc;

    await doc_ref(id).delete();

    record_audit_entry_async({
      user_id,
      action: "delete",
      entity_type: "budget",
      entity_id: id,
      before: before as unknown as Record<string, unknown>,
      after: null,
      trace_id: ctx.trace_id,
      metadata: { source: "api" },
    });

    return create_write_result("budget", id, "replace", before, null);
  },

  /**
   * Checks if a budget exists.
   */
  async exists(_ctx: TraceContext, id: string): Promise<boolean> {
    const doc = await doc_ref(id).get();
    return doc.exists;
  },
};
