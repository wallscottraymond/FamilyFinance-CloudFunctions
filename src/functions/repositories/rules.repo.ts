/**
 * Rules Repository — persistence for the Transaction Rules Engine ("Rule Book").
 *
 * One Firestore doc per rule in the `rules` collection (no per-user-doc size ceiling / write
 * contention). Top-level fields are camelCase (`userId`/`isActive`/`priority`) for the query index;
 * the nested `conditions`/`actions` blobs use the domain shape (never queried, only loaded).
 *
 * COST: `get_active_rules` is the ONLY read the Rules Engine adds to the ingest path, and it runs
 * ONCE per sync batch (loaded above the per-txn loop — never per transaction). See the project's
 * Read-Cost Plan. Requires the composite index `(userId, isActive, priority)`.
 *
 * @module repositories/rules
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../types";
import {
  Rule,
  RuleActions,
  RuleConditionGroup,
} from "../types/rules.types";

const COLLECTION = "rules";
const col = (): FirebaseFirestore.CollectionReference =>
  getFirestore().collection(COLLECTION);

/** The editable fields of a rule (create takes all; update takes a partial). */
type RuleWriteFields = {
  name: string;
  conditions: RuleConditionGroup;
  actions: RuleActions;
  priority: number;
  is_active: boolean;
};

export const rules_repo = {
  /**
   * Loads a user's ACTIVE rules, ordered by `priority` ascending (Rule Book list order).
   * Call this ONCE per sync batch; evaluate the returned rules against the in-memory transactions.
   */
  async get_active_rules(_ctx: TraceContext, user_id: string): Promise<Rule[]> {
    const snap = await col()
      .where("userId", "==", user_id)
      .where("isActive", "==", true)
      .orderBy("priority", "asc")
      .get();
    return snap.docs.map((d) => map_to_domain(d.id, d.data()));
  },

  /** Loads ALL of a user's rules (active + inactive), priority-ordered — for the Rule Book UI. */
  async list_rules(_ctx: TraceContext, user_id: string): Promise<Rule[]> {
    const snap = await col()
      .where("userId", "==", user_id)
      .orderBy("priority", "asc")
      .get();
    return snap.docs.map((d) => map_to_domain(d.id, d.data()));
  },

  /** Counts a user's rules (for the per-user cap). */
  async count_rules(_ctx: TraceContext, user_id: string): Promise<number> {
    const agg = await col().where("userId", "==", user_id).count().get();
    return agg.data().count;
  },

  /** Creates a rule doc (camelCase top-level fields for the index; domain-shape nested blobs). */
  async create_rule(
    _ctx: TraceContext,
    user_id: string,
    rule: RuleWriteFields
  ): Promise<string> {
    const now = Timestamp.now();
    /* eslint-disable @typescript-eslint/naming-convention */
    const ref = await col().add({
      userId: user_id,
      name: rule.name,
      conditions: rule.conditions,
      actions: rule.actions,
      priority: rule.priority,
      isActive: rule.is_active,
      createdAt: now,
      updatedAt: now,
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    return ref.id;
  },

  /** Loads one rule (ownership-checked by the caller). */
  async get_rule(_ctx: TraceContext, rule_id: string): Promise<Rule | null> {
    const doc = await col().doc(rule_id).get();
    return doc.exists ? map_to_domain(doc.id, doc.data() as FirebaseFirestore.DocumentData) : null;
  },

  /** Patches a rule's editable fields (camelCase). Only provided fields are written. */
  async update_rule(
    _ctx: TraceContext,
    rule_id: string,
    patch: Partial<RuleWriteFields>
  ): Promise<void> {
    /* eslint-disable @typescript-eslint/naming-convention */
    const update: Record<string, unknown> = { updatedAt: Timestamp.now() };
    if (patch.name !== undefined) update.name = patch.name;
    if (patch.conditions !== undefined) update.conditions = patch.conditions;
    if (patch.actions !== undefined) update.actions = patch.actions;
    if (patch.priority !== undefined) update.priority = patch.priority;
    if (patch.is_active !== undefined) update.isActive = patch.is_active;
    /* eslint-enable @typescript-eslint/naming-convention */
    await col().doc(rule_id).update(update);
  },

  /** Hard-deletes a rule (rules carry no history to preserve). */
  async delete_rule(_ctx: TraceContext, rule_id: string): Promise<void> {
    await col().doc(rule_id).delete();
  },
};

/** Map a Firestore rule doc to the domain `Rule`. Malformed docs degrade to never-match. */
function map_to_domain(
  id: string,
  data: FirebaseFirestore.DocumentData
): Rule {
  /* eslint-disable @typescript-eslint/naming-convention */
  // camelCase = the stored Firestore field names (query/index convention).
  const d = data as {
    userId?: string;
    name?: string;
    conditions?: RuleConditionGroup;
    actions?: RuleActions;
    priority?: number;
    isActive?: boolean;
  };
  /* eslint-enable @typescript-eslint/naming-convention */
  return {
    id,
    user_id: d.userId ?? "",
    name: d.name ?? "",
    // An empty group never matches — a safe default if a doc is malformed.
    conditions: d.conditions ?? { op: "AND", conditions: [] },
    actions: d.actions ?? {},
    priority: typeof d.priority === "number" ? d.priority : 0,
    is_active: d.isActive === true,
  };
}
