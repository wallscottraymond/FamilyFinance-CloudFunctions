/**
 * Unshare Account Entry Point (Account-Rooted-Sharing)
 *
 * The account owner makes a shared account private again (cancels a pending
 * share too).
 *
 * @module entry/callable/unshare_account
 */
import { ShareAccountResult } from "../../orchestrators/sharing/placement.orchestrator";
import { FunctionResponse } from "../../types";
/**
 * The account owner makes a shared account private again (cancels a pending
 * share too).
 */
export declare const unshare_account: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<ShareAccountResult>>, unknown>;
//# sourceMappingURL=unshare_account.entry.d.ts.map