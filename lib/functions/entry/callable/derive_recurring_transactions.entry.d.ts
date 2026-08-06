/**
 * Derive Recurring Transactions Entry Point
 *
 * One callable: all transactions belonging to a recurring inflow/outflow stream,
 * each flagged in-period for the viewed window, so the bill/income detail screen
 * can render "This Period" + "Historical" sections. Read-only.
 *
 * @module entry/callable/derive_recurring_transactions
 */
import { FunctionResponse } from "../../types";
export declare const derive_recurring_transactions: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<unknown>>, unknown>;
//# sourceMappingURL=derive_recurring_transactions.entry.d.ts.map