/**
 * Derive Budget Transactions Entry Point
 *
 * One callable: the transactions a budget owns FOR A PERIOD, resolved on read,
 * each tagged with a derived spend status (counted / ignored / refund) so the
 * budget-detail screen can show ignored items (incl. auto-ignored transfers) in a
 * dedicated section. Read-only; window hard-bounded.
 *
 * @module entry/callable/derive_budget_transactions
 */
import { FunctionResponse } from "../../types";
export declare const derive_budget_transactions: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<unknown>>, unknown>;
//# sourceMappingURL=derive_budget_transactions.entry.d.ts.map