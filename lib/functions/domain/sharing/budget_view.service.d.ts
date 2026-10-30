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
//# sourceMappingURL=budget_view.service.d.ts.map