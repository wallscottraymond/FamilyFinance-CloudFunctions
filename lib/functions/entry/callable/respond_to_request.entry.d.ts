/**
 * Respond To Request Entry Point (Account-Rooted-Sharing)
 *
 * Accepts or declines a request addressed to the caller.
 *
 * @module entry/callable/respond_to_request
 */
import { SharingWriteResult } from "../../orchestrators/sharing/groups.orchestrator";
import { FunctionResponse } from "../../types";
/**
 * Accepts or declines a request addressed to the caller.
 */
export declare const respond_to_request: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<SharingWriteResult>>, unknown>;
//# sourceMappingURL=respond_to_request.entry.d.ts.map