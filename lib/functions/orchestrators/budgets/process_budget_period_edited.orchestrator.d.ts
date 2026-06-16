/**
 * Process Budget Period Edited Orchestrator
 *
 * The control-flow brain behind the `on_budget_period_edited` trigger. Given a
 * budget_period's before/after snapshots it decides what (if anything) to sync
 * across the overlapping periods of OTHER types for the same budget:
 *   • notes / checklist / modified-amount edits → propagate via the sync utils
 *   • pause/resume (isActive flip)              → redistribute the allocation
 *
 * Loop prevention: the sync utils stamp `*SyncedAt`; if one increased, this
 * update was itself a sync, so we skip.
 *
 * NOTE (legacy coupling): the cross-period sync is still performed by the legacy
 * `budgets/utils/syncNotesToOverlappingPeriods` + `handleBudgetPeriodPauseResume`
 * helpers (they own the overlap query + writes for this legacy feature, like a
 * scoped repo). Repo-ifying them is tracked as follow-up; the orchestrator only
 * delegates to them.
 *
 * @module orchestrators/budgets/process_budget_period_edited
 */
import { TraceContext } from "../../types";
import { BudgetPeriodDocument } from "../../../types";
/** Input: the edited period's snapshots. */
export interface ProcessBudgetPeriodEditedInput {
    period_id: string;
    before: BudgetPeriodDocument;
    after: BudgetPeriodDocument;
}
export declare function process_budget_period_edited_orchestrator(ctx: TraceContext, input: ProcessBudgetPeriodEditedInput): Promise<void>;
//# sourceMappingURL=process_budget_period_edited.orchestrator.d.ts.map