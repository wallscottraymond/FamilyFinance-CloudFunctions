/**
 * Get My Connect Code Entry Point (Account-Rooted-Sharing)
 *
 * Shows the caller's connect code (issues a new one when asked or when it has expired).
 *
 * @module entry/callable/get_my_connect_code
 */
import { MyConnectCodeResult } from "../../orchestrators/sharing/connect.orchestrator";
import { FunctionResponse } from "../../types";
/**
 * Shows the caller's connect code (issues a new one when asked or when it has expired).
 */
export declare const get_my_connect_code: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<MyConnectCodeResult>>, unknown>;
//# sourceMappingURL=get_my_connect_code.entry.d.ts.map