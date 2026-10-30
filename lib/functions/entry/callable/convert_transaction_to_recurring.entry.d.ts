/**
 * Convert Transaction To Recurring Entry Point (Convert-To-Recurring Phase 2)
 *
 * "Make this a bill / income" from a transaction (or one split). Owner only (D24); flag-gated.
 * Returns the new record's id; a refusal comes back as `failed-precondition` with a `code` the sheet
 * shows (ALREADY_TRACKED carries the bill's id + name).
 *
 * @module entry/callable/convert_transaction_to_recurring
 */
import { FunctionResponse } from "../../types";
export declare const convert_transaction_to_recurring: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<unknown>>, unknown>;
//# sourceMappingURL=convert_transaction_to_recurring.entry.d.ts.map