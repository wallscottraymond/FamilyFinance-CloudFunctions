/**
 * Move Budget Entry Point (Account-Rooted-Sharing)
 *
 * Moves a budget between Me and a group (D9): its settings and history come along.
 *
 * @module entry/callable/move_budget
 */
import { BudgetViewResult } from "../../orchestrators/sharing/budget_view.orchestrator";
import { FunctionResponse } from "../../types";
/**
 * Moves a budget between Me and a group (D9): its settings and history come along.
 */
export declare const move_budget: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<BudgetViewResult>>, unknown>;
//# sourceMappingURL=move_budget.entry.d.ts.map