/**
 * Manage Connection Entry Point (Account-Rooted-Sharing)
 *
 * Nickname, disconnect, block or report a connected person.
 *
 * @module entry/callable/manage_connection
 */
import { ManageConnectionResult } from "../../orchestrators/sharing/connections.orchestrator";
import { FunctionResponse } from "../../types";
/**
 * Nickname, disconnect, block or report a connected person.
 */
export declare const manage_connection: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<ManageConnectionResult>>, unknown>;
//# sourceMappingURL=manage_connection.entry.d.ts.map