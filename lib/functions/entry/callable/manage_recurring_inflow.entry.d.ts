/**
 * Manage Recurring Inflow Entry Point
 *
 * One callable for the Remove-Recover-Recurring actions on a recurring income:
 * `remove` (all / going_forward), `pause` (until a date), `restore` (forward-only
 * resume), and `delete` (permanent). Delegates to the generic manage orchestrator
 * with the inflow repo.
 *
 * @module entry/callable/manage_recurring_inflow
 */
import { FunctionResponse } from "../../types";
export declare const manage_recurring_inflow: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<unknown>>, unknown>;
//# sourceMappingURL=manage_recurring_inflow.entry.d.ts.map