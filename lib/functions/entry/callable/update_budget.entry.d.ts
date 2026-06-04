/**
 * Update Budget Entry Point
 *
 * onCall entry for updating a budget. Replaces the legacy onRequest HTTP
 * updateBudget function.
 *
 * @module entry/callable/update_budget
 */
import { FunctionResponse } from "../../types";
import { UpdateBudgetResponse } from "../../types/budgets/update_budget.types";
/**
 * Update a budget.
 */
export declare const update_budget: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<UpdateBudgetResponse>>, unknown>;
//# sourceMappingURL=update_budget.entry.d.ts.map