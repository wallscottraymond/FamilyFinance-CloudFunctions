/**
 * Preview Convert Transaction Entry Point (Convert-To-Recurring Phase 2): read-only suggestions for
 * the "Make this a bill" sheet (name, amount, schedule guess, how many past payments would link).
 * Owner only; flag-gated (`{enabled: false}` when off).
 *
 * @module entry/callable/preview_convert_transaction
 */
import { FunctionResponse } from "../../types";
export declare const preview_convert_transaction: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<unknown>>, unknown>;
//# sourceMappingURL=preview_convert_transaction.entry.d.ts.map