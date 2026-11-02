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
import { DomainResult } from "../../types";
import { Group } from "../../types/sharing.types";
import { PausedDayRange } from "../budgets/budget_pause.service";
export declare const GROUP_KEY_PREFIX = "group:";
/** The owner key of a group's budgets. */
export declare function group_view_key(group_id: string): string;
/** The group id inside an owner key, or null for a person's key. */
export declare function group_id_of_key(owner_key: string): string | null;
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
export declare function can_manage_budget(owner_key: string, actor_id: string, group: Group | null): boolean;
/** Maps a stored category id (slug or legacy Plaid code) to the first category it means. */
export type FirstOf = (category_id: string) => string;
export type MoveTarget = {
    type: "me";
} | {
    type: "group";
    group: Group | null;
};
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
export declare function plan_move_budget(budget: ViewBudget | null, actor_id: string, source_group: Group | null, target: MoveTarget, target_view_budgets: ViewBudget[], first_of?: FirstOf): DomainResult<MovePlan>;
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
    creates: Array<{
        source: ViewBudget;
        amount: number;
        category_ids?: string[];
    }>;
    /** Skipped: the group already has it ("Add mine" in the app). */
    conflicts: CopyConflict[];
}
/**
 * Copy the caller's Me budgets into a group (D32). Each copy is a new group
 * budget (same name, categories, cadence; amount as chosen); the originals stay.
 * A budget the group already has (same name or a shared category) is reported
 * as a conflict instead of creating a duplicate. Everything Else is never copied.
 */
export declare function plan_copy_budgets(group: Group | null, actor_id: string, items: CopyItem[], group_budgets: ViewBudget[], first_of?: FirstOf, allow_partial?: boolean): DomainResult<CopyPlan>;
/**
 * Budgets that leave a group with the people leaving (D13): the ones they moved
 * in go back to them. "all" (group deleted) returns every moved-in budget.
 * Budgets made or copied in the group stay.
 */
export declare function budgets_returned(group_budgets: ViewBudget[], leaving: string[] | "all"): Array<{
    budget_id: string;
    to_owner_key: string;
}>;
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
export declare const RETURN_PAUSE_END_ISO = "2099-12-31";
/** The pause an emptied returned budget gets: from today's UTC day on. PURE. */
export declare function return_pause_range(now_ms: number): PausedDayRange;
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
export declare function plan_budget_returns(group_budgets: ViewBudget[], leaving: string[] | "all", me_budgets: Record<string, ViewBudget[]>, first_of?: FirstOf): ReturnedBudget[];
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
export declare function returned_budget_notes(returns: ReturnedBudget[], user_id: string): ReturnedBudgetNote[];
//# sourceMappingURL=budget_view.service.d.ts.map