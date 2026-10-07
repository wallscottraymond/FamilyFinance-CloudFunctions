/**
 * Create Manual Outflow Entry Point
 *
 * Creates a recurring bill the user enters by hand (Add Bill). Replaces the
 * app's call to `createRecurringOutflow`, which no longer exists, and the legacy
 * `createManualOutflow`, whose documents the derive path can't read (no root
 * `ownerId`).
 *
 * @module entry/callable/create_manual_outflow
 */
import { FunctionResponse } from "../../types";
/**
 * Creates a manual recurring bill.
 *
 * @returns The new outflow ID
 */
export declare const create_manual_outflow: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<{
    outflow_id: string;
}>>, unknown>;
//# sourceMappingURL=create_manual_outflow.entry.d.ts.map