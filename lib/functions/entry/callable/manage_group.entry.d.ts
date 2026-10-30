/**
 * Manage Group Entry Point (Account-Rooted-Sharing)
 *
 * Rename, remove a member, hand over ownership, leave or delete a group.
 *
 * @module entry/callable/manage_group
 */
import { SharingWriteResult } from "../../orchestrators/sharing/groups.orchestrator";
import { FunctionResponse } from "../../types";
/**
 * Rename, remove a member, hand over ownership, leave or delete a group.
 */
export declare const manage_group: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<SharingWriteResult>>, unknown>;
//# sourceMappingURL=manage_group.entry.d.ts.map