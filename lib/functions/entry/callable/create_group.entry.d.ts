/**
 * Create Group Entry Point (Account-Rooted-Sharing)
 *
 * Creates a group (the caller owns it) and sends join requests to connected people.
 *
 * @module entry/callable/create_group
 */
import { SharingWriteResult } from "../../orchestrators/sharing/groups.orchestrator";
import { FunctionResponse } from "../../types";
/**
 * Creates a group (the caller owns it) and sends join requests to connected people.
 */
export declare const create_group: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<SharingWriteResult>>, unknown>;
//# sourceMappingURL=create_group.entry.d.ts.map