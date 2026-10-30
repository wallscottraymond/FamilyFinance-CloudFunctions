/**
 * Undo Recurring Merge Entry Point (Convert-To-Recurring Phase 2): undo a same-bill merge (the old
 * bill is restored) or an absorbed Plaid stream (the next sync makes it a separate bill). Owner
 * only; flag-gated.
 *
 * @module entry/callable/undo_recurring_merge
 */
import { FunctionResponse } from "../../types";
export declare const undo_recurring_merge: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<unknown>>, unknown>;
//# sourceMappingURL=undo_recurring_merge.entry.d.ts.map