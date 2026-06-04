/**
 * Delete Budget Entry Point
 *
 * onCall entry for deleting a budget. Replaces the legacy onRequest HTTP
 * deleteBudget function.
 *
 * @module entry/callable/delete_budget
 */
import { FunctionResponse } from "../../types";
import { DeleteBudgetResponse } from "../../types/budgets/delete_budget.types";
/**
 * Delete a budget.
 */
export declare const delete_budget: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<DeleteBudgetResponse>>, unknown>;
//# sourceMappingURL=delete_budget.entry.d.ts.map