/**
 * Create Budget Entry Point
 *
 * onCall entry for creating a budget in the layered architecture.
 *
 * @module entry/callable/create_budget
 */
import { FunctionResponse } from "../../types";
import { CreateBudgetResponse } from "../../types/budgets/create_budget.types";
/**
 * Create a budget.
 */
export declare const create_budget: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<CreateBudgetResponse>>, unknown>;
//# sourceMappingURL=create_budget.entry.d.ts.map