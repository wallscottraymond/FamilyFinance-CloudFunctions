/**
 * Share Account Entry Point (Account-Rooted-Sharing)
 *
 * The account owner shares an account with a group (members accept; a group of
 * one applies at once).
 *
 * @module entry/callable/share_account
 */
import { ShareAccountResult } from "../../orchestrators/sharing/placement.orchestrator";
import { FunctionResponse } from "../../types";
/**
 * The account owner shares an account with a group (members accept; a group of
 * one applies at once).
 */
export declare const share_account: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<ShareAccountResult>>, unknown>;
//# sourceMappingURL=share_account.entry.d.ts.map