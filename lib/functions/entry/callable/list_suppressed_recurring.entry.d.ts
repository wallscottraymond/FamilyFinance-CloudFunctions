/**
 * List Suppressed Recurring Entry Point
 *
 * Read-only callable for the recovery screen: returns the user's currently
 * removed/paused recurring bills + income (with computed state). No input.
 *
 * @module entry/callable/list_suppressed_recurring
 */
import { ListSuppressedRecurringResult } from "../../orchestrators/recurring/list_suppressed_recurring.orchestrator";
import { FunctionResponse } from "../../types";
export declare const list_suppressed_recurring: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<ListSuppressedRecurringResult>>, unknown>;
//# sourceMappingURL=list_suppressed_recurring.entry.d.ts.map