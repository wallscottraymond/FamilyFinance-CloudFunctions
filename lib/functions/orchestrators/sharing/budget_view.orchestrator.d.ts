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
import { CopyConflict } from "../../domain/sharing/budget_view.service";
export interface BudgetViewResult {
    success: boolean;
    errors?: string[];
    budget_ids?: string[];
    conflicts?: CopyConflict[];
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
 */
export declare function return_moved_in_budgets(ctx: TraceContext, group_id: string, leaving: string[] | "all", actor_id: string): Promise<number>;
//# sourceMappingURL=budget_view.orchestrator.d.ts.map