/**
 * Budget View Orchestrators (D9, D32, D13; PD6)
 *
 * move_budget: Me ↔ group. The budget keeps its id, settings and periods; its
 *   owner key changes (budget + every period). Moving out of Me re-runs the
 *   assignment engine on the mover's transactions that pointed at it.
 * copy_budgets_to_group: new group budgets with the same settings; originals
 *   stay (or move, with remove_from_me). Clashes come back as conflicts.
 * return_moved_in_budgets: on leave / removal / delete, budgets someone moved
 *   in go back to their Me view.
 *
 * @module orchestrators/sharing/budget_view
 */
import { OrchestratorContext, TraceContext } from "../../types";
import { ReturnedBudget, CopyConflict, CopySkip } from "../../domain/sharing/budget_view.service";
export interface BudgetViewResult {
    success: boolean;
    errors?: string[];
    budget_ids?: string[];
    conflicts?: CopyConflict[];
    /** copy: budgets that can't go to a group as they are, with why. */
    skipped?: CopySkip[];
}
/** Moves a budget between Me and a group. `to_group_id: null` = to Me. */
export declare function move_budget_orchestrator(ctx: OrchestratorContext<{
    budget_id: string;
    to_group_id: string | null;
}>): Promise<BudgetViewResult>;
export interface CopyBudgetsInput {
    group_id: string;
    items: Array<{
        budget_id: string;
        amount: number;
    }>;
    remove_from_me: boolean;
}
/** Copies (or moves) the caller's budgets into a group (D32). */
export declare function copy_budgets_to_group_orchestrator(ctx: OrchestratorContext<CopyBudgetsInput>): Promise<BudgetViewResult>;
/**
 * D13: budgets the leaving people moved in go back to their Me view. Called by
 * manage_group (leave / remove / delete) and account purge. Never throws.
 *
 * S1-M4 (user decision 2026-11-02): each lands in a Me view that may already budget some of its
 * categories (made while it sat in the group). The Me budget keeps them; the returning budget
 * comes back without them (category_ownership.plan_view_arrival, canon A3) — and PAUSED from
 * today when nothing is left, so it takes nothing from Everything Else. Nothing is deleted.
 * Categories / pause are written BEFORE the move, whose final derive bump covers them.
 *
 * @returns every return, with what changed (the caller tells the person concerned)
 */
export declare function return_moved_in_budgets(ctx: TraceContext, group_id: string, leaving: string[] | "all", actor_id: string): Promise<ReturnedBudget[]>;
//# sourceMappingURL=budget_view.orchestrator.d.ts.map