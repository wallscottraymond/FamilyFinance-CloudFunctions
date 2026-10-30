/**
 * Copy Budgets To Group Entry Point (Account-Rooted-Sharing)
 *
 * Copies the caller's budgets into a group (D32); clashes come back as
 * conflicts.
 *
 * @module entry/callable/copy_budgets_to_group
 */
import { BudgetViewResult } from "../../orchestrators/sharing/budget_view.orchestrator";
import { FunctionResponse } from "../../types";
/**
 * Copies the caller's budgets into a group (D32); clashes come back as
 * conflicts.
 */
export declare const copy_budgets_to_group: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<BudgetViewResult>>, unknown>;
//# sourceMappingURL=copy_budgets_to_group.entry.d.ts.map