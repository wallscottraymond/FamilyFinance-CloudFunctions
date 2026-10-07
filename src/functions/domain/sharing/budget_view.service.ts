/**
 * Budgets belong to a view (D6, D9, D32, D13; PD6)
 *
 * A budget's owner key is its view: a uid for Me, "group:<groupId>" for a group.
 * Group budgets count only the group's money (derive, Phase 3). Moving keeps the
 * budget and its history; copying makes a new group budget with the same
 * settings. A budget moved in goes back to whoever brought it when they leave.
 *
 * PURE: no IO.
 *
 * @module domain/sharing/budget_view
 */

import { DomainResult, success, validation_failed } from "../../types";
import { Group } from "../../types/sharing.types";
import { is_member } from "./group.service";

export const GROUP_KEY_PREFIX = "group:";

/** The owner key of a group's budgets. */
export function group_view_key(group_id: string): string {
  return `${GROUP_KEY_PREFIX}${group_id}`;
}

/** The group id inside an owner key, or null for a person's key. */
export function group_id_of_key(owner_key: string): string | null {
  return owner_key.startsWith(GROUP_KEY_PREFIX)
    ? owner_key.slice(GROUP_KEY_PREFIX.length)
    : null;
}

/** The bits of a budget these rules need. */
export interface ViewBudget {
  id: string;
  owner_key: string;
  name: string;
  amount: number;
  category_ids: string[];
  is_everything_else: boolean;
  brought_by: string | null;
}

/**
 * Can `actor` edit / delete this budget? Me budgets: only their owner. Group
 * budgets: any member of that group (PD4: owner + full).
 */
export function can_manage_budget(
  owner_key: string,
  actor_id: string,
  group: Group | null
): boolean {
  const gid = group_id_of_key(owner_key);
  if (gid === null) return owner_key === actor_id;
  return !!group && group.id === gid && is_member(group, actor_id);
}

function normalize_name(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The first budget in `others` that clashes (same name or a shared category). */
function find_clash(b: ViewBudget, others: ViewBudget[]): ViewBudget | null {
  const cats = new Set(b.category_ids);
  return (
    others.find(
      (o) =>
        o.id !== b.id &&
        !o.is_everything_else &&
        (normalize_name(o.name) === normalize_name(b.name) ||
          o.category_ids.some((c) => cats.has(c)))
    ) ?? null
  );
}

export type MoveTarget = { type: "me" } | { type: "group"; group: Group | null };

export interface MovePlan {
  new_owner_key: string;
  brought_by: string | null;
}

/**
 * Move a budget between Me and a group (D9). Me → group: the budget's owner,
 * who must be a member. Group → Me: any member; it lands in the mover's Me.
 * Refused when the destination already has a budget with that name or one of
 * its categories (counting would be ambiguous). Everything Else never moves.
 */
export function plan_move_budget(
  budget: ViewBudget | null,
  actor_id: string,
  source_group: Group | null,
  target: MoveTarget,
  target_view_budgets: ViewBudget[]
): DomainResult<MovePlan> {
  if (!budget) return validation_failed(["This budget isn't available"]);
  if (budget.is_everything_else) return validation_failed(["Everything Else can't be moved"]);
  if (!can_manage_budget(budget.owner_key, actor_id, source_group)) {
    return validation_failed(["This budget isn't available"]);
  }
  const from_group = group_id_of_key(budget.owner_key);
  let new_owner_key: string;
  let brought_by: string | null;
  if (target.type === "me") {
    if (from_group === null) return validation_failed(["This budget is already yours"]);
    new_owner_key = actor_id;
    brought_by = null;
  } else {
    if (from_group !== null) {
      return validation_failed(["Move it to Me first, then to the other group"]);
    }
    if (!target.group || !is_member(target.group, actor_id)) {
      return validation_failed(["You're not in this group"]);
    }
    new_owner_key = group_view_key(target.group.id);
    brought_by = actor_id;
  }
  const clash = find_clash(budget, target_view_budgets);
  if (clash) {
    return validation_failed([
      `There's already a budget there for this (${clash.name}). Edit that one instead.`,
    ]);
  }
  return success({ new_owner_key, brought_by });
}

export interface CopyItem {
  budget: ViewBudget | null;
  amount: number;
}

export interface CopyConflict {
  source_budget_id: string;
  existing_budget_id: string;
  existing_name: string;
  existing_amount: number;
}

export interface CopyPlan {
  /** New group budgets to create: settings from `source`, the chosen amount. */
  creates: Array<{ source: ViewBudget; amount: number }>;
  /** Skipped: the group already has it ("Add mine" in the app). */
  conflicts: CopyConflict[];
}

/**
 * Copy the caller's Me budgets into a group (D32). Each copy is a new group
 * budget (same name, categories, cadence; amount as chosen); the originals stay.
 * A budget the group already has (same name or a shared category) is reported
 * as a conflict instead of creating a duplicate. Everything Else is never copied.
 */
export function plan_copy_budgets(
  group: Group | null,
  actor_id: string,
  items: CopyItem[],
  group_budgets: ViewBudget[]
): DomainResult<CopyPlan> {
  if (!is_member(group, actor_id)) return validation_failed(["You're not in this group"]);
  const errors: string[] = [];
  const creates: CopyPlan["creates"] = [];
  const conflicts: CopyConflict[] = [];
  const planned: ViewBudget[] = [...group_budgets];
  for (const item of items) {
    const b = item.budget;
    if (!b || b.owner_key !== actor_id) {
      errors.push("You can only copy your own budgets");
      continue;
    }
    if (b.is_everything_else) {
      errors.push("Everything Else can't be copied");
      continue;
    }
    if (!(item.amount > 0)) {
      errors.push(`Set an amount for ${b.name}`);
      continue;
    }
    const clash = find_clash(b, planned);
    if (clash) {
      conflicts.push({
        source_budget_id: b.id,
        existing_budget_id: clash.id,
        existing_name: clash.name,
        existing_amount: clash.amount,
      });
      continue;
    }
    creates.push({ source: b, amount: item.amount });
    planned.push({ ...b, id: `planned:${b.id}` });
  }
  if (errors.length) return validation_failed([...new Set(errors)]);
  return success({ creates, conflicts });
}

/**
 * Budgets that leave a group with the people leaving (D13): the ones they moved
 * in go back to them. "all" (group deleted) returns every moved-in budget.
 * Budgets made or copied in the group stay.
 */
export function budgets_returned(
  group_budgets: ViewBudget[],
  leaving: string[] | "all"
): Array<{ budget_id: string; to_owner_key: string }> {
  return group_budgets
    .filter((b) => b.brought_by && (leaving === "all" || leaving.includes(b.brought_by)))
    .map((b) => ({ budget_id: b.id, to_owner_key: b.brought_by! }));
}
