/**
 * Goal Repository — Goals (Phase 1)
 *
 * Persistence for the `goals` collection. Maps the internal snake_case
 * `GoalEntity` to/from a camelCase Firestore document (matching the rest of the
 * app's stored shape). Reads query by a single field (`ownerId`) and filter the
 * rest in memory, so no new composite indexes are needed (a user has few goals).
 *
 * @module repositories/goal
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../types";
import { GoalEntity } from "../types/goals/goal_entity.types";

const COLLECTION = "goals";

function doc_ref(id: string): FirebaseFirestore.DocumentReference {
  return getFirestore().collection(COLLECTION).doc(id);
}

/* eslint-disable @typescript-eslint/naming-convention */
/** camelCase stored shape. */
interface GoalDoc {
  id: string;
  userId: string;
  groupIds: string[];
  isActive: boolean;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  createdBy: string;
  ownerId: string;
  isPrivate: boolean;
  access: {
    ownerId: string;
    createdBy: string;
    groupIds: string[];
    isPrivate: boolean;
  };
  goalType: string;
  name: string;
  status: string;
  linkedAccountId: string;
  targetAmount?: number | null;
  endDate?: Timestamp | null;
  homeCadence: string;
  perPeriodAmount: number;
  baselineBalance: number;
  baselineCountsExisting: boolean;
  priorityRank: number;
  drawsIncome: boolean;
  linkedRecurringId?: string | null;
  apr?: number | null;
  minimumPayment?: number | null;
  extraPrincipal?: number | null;
}

function map_to_doc(e: GoalEntity): GoalDoc {
  return {
    id: e.id,
    userId: e.user_id,
    groupIds: e.group_ids,
    isActive: e.is_active,
    createdAt: e.created_at,
    updatedAt: e.updated_at,
    createdBy: e.created_by,
    ownerId: e.owner_id,
    isPrivate: e.is_private,
    access: {
      ownerId: e.access.owner_id,
      createdBy: e.access.created_by,
      groupIds: e.access.group_ids,
      isPrivate: e.access.is_private,
    },
    goalType: e.goal_type,
    name: e.name,
    status: e.status,
    linkedAccountId: e.linked_account_id,
    targetAmount: e.target_amount ?? null,
    endDate: e.end_date ?? null,
    homeCadence: e.home_cadence,
    perPeriodAmount: e.per_period_amount,
    baselineBalance: e.baseline_balance,
    baselineCountsExisting: e.baseline_counts_existing,
    priorityRank: e.priority_rank,
    drawsIncome: e.draws_income,
    linkedRecurringId: e.linked_recurring_id ?? null,
    apr: e.apr ?? null,
    minimumPayment: e.minimum_payment ?? null,
    extraPrincipal: e.extra_principal ?? null,
  };
}

function map_to_domain(d: GoalDoc): GoalEntity {
  return {
    id: d.id,
    user_id: d.userId,
    group_ids: d.groupIds ?? [],
    is_active: d.isActive,
    access: {
      owner_id: d.access?.ownerId ?? d.ownerId,
      created_by: d.access?.createdBy ?? d.createdBy,
      group_ids: d.access?.groupIds ?? d.groupIds ?? [],
      is_private: d.access?.isPrivate ?? d.isPrivate,
    },
    created_by: d.createdBy,
    owner_id: d.ownerId,
    is_private: d.isPrivate,
    goal_type: d.goalType as GoalEntity["goal_type"],
    name: d.name,
    status: d.status as GoalEntity["status"],
    linked_account_id: d.linkedAccountId,
    target_amount: d.targetAmount ?? null,
    end_date: d.endDate ?? null,
    home_cadence: d.homeCadence as GoalEntity["home_cadence"],
    per_period_amount: d.perPeriodAmount,
    baseline_balance: d.baselineBalance,
    baseline_counts_existing: d.baselineCountsExisting,
    priority_rank: d.priorityRank,
    draws_income: d.drawsIncome,
    linked_recurring_id: d.linkedRecurringId ?? null,
    apr: d.apr ?? null,
    minimum_payment: d.minimumPayment ?? null,
    extra_principal: d.extraPrincipal ?? null,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
  };
}
/* eslint-enable @typescript-eslint/naming-convention */

function strip_undefined<T extends Record<string, unknown>>(obj: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out as T;
}

export const goal_repo = {
  new_id(): string {
    return getFirestore().collection(COLLECTION).doc().id;
  },

  async save(_ctx: TraceContext, entity: GoalEntity): Promise<void> {
    const doc = strip_undefined(
      map_to_doc(entity) as unknown as Record<string, unknown>
    );
    await doc_ref(entity.id).set(doc);
  },

  async get_by_id(_ctx: TraceContext, id: string): Promise<GoalEntity | null> {
    const snap = await doc_ref(id).get();
    if (!snap.exists) return null;
    return map_to_domain(snap.data() as GoalDoc);
  },

  /** All of the user's active goals (single-field query + in-memory active filter). */
  async get_by_user(_ctx: TraceContext, user_id: string): Promise<GoalEntity[]> {
    const db = getFirestore();
    const snap = await db
      .collection(COLLECTION)
      .where("ownerId", "==", user_id)
      .get();
    return snap.docs
      .map((d) => map_to_domain(d.data() as GoalDoc))
      .filter((g) => g.is_active);
  },

  /** The user's active goals tied to one account (for priority rank + partition). */
  async get_by_account(
    ctx: TraceContext,
    user_id: string,
    account_id: string
  ): Promise<GoalEntity[]> {
    const all = await this.get_by_user(ctx, user_id);
    return all.filter((g) => g.linked_account_id === account_id);
  },

  /** Patch selected camelCase fields (always bumps updatedAt). */
  async update(
    _ctx: TraceContext,
    id: string,
    patch: Record<string, unknown>
  ): Promise<void> {
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    await doc_ref(id).update(strip_undefined({ ...patch, updatedAt: Timestamp.now() }));
  },

  /** Soft-delete: deactivate + archive (recoverable). */
  async soft_delete(_ctx: TraceContext, id: string): Promise<void> {
    /* eslint-disable @typescript-eslint/naming-convention */
    await doc_ref(id).update({
      isActive: false,
      status: "archived",
      updatedAt: Timestamp.now(),
    });
    /* eslint-enable @typescript-eslint/naming-convention */
  },
};
