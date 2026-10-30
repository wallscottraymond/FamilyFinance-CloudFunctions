/**
 * Assign Split → Income Entry Point (Convert-To-Recurring Phase 2)
 *
 * Manually pin a deposit's split to one of the caller's recurring incomes, or clear the pin
 * (`inflow_id: null`). The pin is durable (`inflowAssignmentSource: "manual"`): the assignment
 * engine preserves it across Plaid re-syncs and it beats Plaid stream membership. Owner only;
 * only money coming in; only an income in the transaction's own view. Flag-gated.
 *
 * @module entry/callable/assign_split_to_inflow
 */
import { FunctionResponse } from "../../types";
export declare const assign_split_to_inflow: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<unknown>>, unknown>;
//# sourceMappingURL=assign_split_to_inflow.entry.d.ts.map