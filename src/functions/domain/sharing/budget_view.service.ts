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
import { plan_view_arrival } from "../budgets/category_ownership.service";
import { PausedDayRange, day_from_iso, utc_day } from "../budgets/budget_pause.service";

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

/** Maps a stored category id (slug or legacy Plaid code) to the first category it means. */
export type FirstOf = (category_id: string) => string;
const identity: FirstOf = (c) => c;

/** The first budget in `others` that clashes (same name or a shared FIRST category — a legacy
 *  code and its slug are the same category, canon A3). */
function find_clash(b: ViewBudget, others: ViewBudget[], first_of: FirstOf): ViewBudget | null {
  const cats = new Set(b.category_ids.map(first_of));
  return (
    others.find(
      (o) =>
        o.id !== b.id &&
        !o.is_everything_else &&
        (normalize_name(o.name) === normalize_name(b.name) ||
          o.category_ids.some((c) => cats.has(first_of(c))))
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
  target_view_budgets: ViewBudget[],
  first_of: FirstOf = identity
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
  const clash = find_clash(budget, target_view_budgets, first_of);
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
  /** Partial overlap: the source's OTHER categories were copied (as `creates`); only these
   *  overlapping ones stay with the group's existing budget. Absent = nothing copied. */
  copied_category_ids?: string[];
}

export interface CopyPlan {
  /** New group budgets to create: settings from `source`, the chosen amount — and, for a partial
   *  overlap, only the categories the group doesn't already budget (`category_ids`). */
  creates: Array<{ source: ViewBudget; amount: number; category_ids?: string[] }>;
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
  group_budgets: ViewBudget[],
  first_of: FirstOf = identity,
  allow_partial = true
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
    const clash = find_clash(b, planned, first_of);
    if (clash) {
      // Only SOME categories overlap (and no name clash): copy the rest — each category still
      // has one budget in the group (X16). A same-name clash, or nothing left, copies nothing.
      const owned = new Set(
        planned
          .filter((o) => o.id !== b.id && !o.is_everything_else)
          .flatMap((o) => o.category_ids.map(first_of))
      );
      const name_clash = planned.some(
        (o) =>
          o.id !== b.id &&
          !o.is_everything_else &&
          normalize_name(o.name) === normalize_name(b.name)
      );
      const free = b.category_ids.filter((c) => !owned.has(first_of(c)));
      const partial = allow_partial && !name_clash && free.length > 0;
      conflicts.push({
        source_budget_id: b.id,
        existing_budget_id: clash.id,
        existing_name: clash.name,
        existing_amount: clash.amount,
        ...(partial ? { copied_category_ids: free } : {}),
      });
      if (partial) {
        creates.push({ source: b, amount: item.amount, category_ids: free });
        planned.push({ ...b, id: `planned:${b.id}`, category_ids: free });
      }
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

/** What happened to one budget that came back to its owner's Me view (shown to them — S1-M4). */
export interface ReturnedBudget {
  budget_id: string;
  name: string;
  to_owner_key: string;
  /** The categories it keeps (the ids it stores). */
  category_ids: string[];
  /** Categories the owner's Me view already budgets: they stay with that budget. */
  removed_category_ids: string[];
  /** It has no categories left, so it comes back paused (takes nothing from Everything Else). */
  paused: boolean;
}

/** The last day a returned, emptied budget stays paused ("until the user changes it"). */
export const RETURN_PAUSE_END_ISO = "2099-12-31";

/** The pause an emptied returned budget gets: from today's UTC day on. PURE. */
export function return_pause_range(now_ms: number): PausedDayRange {
  return { start_day: utc_day(now_ms), end_day: day_from_iso(RETURN_PAUSE_END_ISO)! };
}

/**
 * Budgets going back to the people leaving (D13), checked against the Me view each lands in
 * (Code-Health-Review S1-M4; user decision 2026-11-02): the budget ALREADY in Me keeps any
 * clashing category (canon A3, compared by first category); the returning budget comes back
 * WITHOUT those categories, and PAUSED if none are left. Nothing is deleted. A budget that
 * already returned counts for the next one going to the same person.
 *
 * `me_budgets`: owner key → the budgets currently in that person's Me view.
 * PURE.
 */
export function plan_budget_returns(
  group_budgets: ViewBudget[],
  leaving: string[] | "all",
  me_budgets: Record<string, ViewBudget[]>,
  first_of: FirstOf = identity
): ReturnedBudget[] {
  const planned: Record<string, ViewBudget[]> = {};
  const out: ReturnedBudget[] = [];
  for (const r of budgets_returned(group_budgets, leaving)) {
    const b = group_budgets.find((x) => x.id === r.budget_id)!;
    const view = (planned[r.to_owner_key] ??= [...(me_budgets[r.to_owner_key] ?? [])]);
    const { kept_category_ids, removed_category_ids } = plan_view_arrival({
      budget_id: b.id,
      category_ids: b.category_ids,
      view_budgets: view,
      first_of,
    });
    view.push({ ...b, owner_key: r.to_owner_key, category_ids: kept_category_ids });
    out.push({
      budget_id: b.id,
      name: b.name,
      to_owner_key: r.to_owner_key,
      category_ids: kept_category_ids,
      removed_category_ids,
      // Only a budget THIS return emptied (one that never had categories isn't touched).
      paused: kept_category_ids.length === 0 && removed_category_ids.length > 0,
    });
  }
  return out;
}

/** What the person who left is told about one budget that came back changed (S1-M4). */
export interface ReturnedBudgetNote {
  budget_id: string;
  name: string;
  /** Categories their Me view already budgets — they stayed with that budget. */
  removed_category_ids: string[];
  /** Nothing was left, so it came back paused. */
  paused: boolean;
}

/** The changed returns that landed in `user_id`'s Me view — what that person is told. PURE. */
export function returned_budget_notes(
  returns: ReturnedBudget[],
  user_id: string
): ReturnedBudgetNote[] {
  return returns
    .filter((r) => r.to_owner_key === user_id && r.removed_category_ids.length > 0)
    .map((r) => ({
      budget_id: r.budget_id,
      name: r.name,
      removed_category_ids: r.removed_category_ids,
      paused: r.paused,
    }));
}
