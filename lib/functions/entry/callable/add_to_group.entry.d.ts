/**
 * Add To Group Entry Point (Account-Rooted-Sharing)
 *
 * Sends a join request to someone the caller is connected with.
 *
 * @module entry/callable/add_to_group
 */
import { SharingWriteResult } from "../../orchestrators/sharing/groups.orchestrator";
import { FunctionResponse } from "../../types";
/**
 * Sends a join request to someone the caller is connected with.
 */
export declare const add_to_group: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<SharingWriteResult>>, unknown>;
//# sourceMappingURL=add_to_group.entry.d.ts.map