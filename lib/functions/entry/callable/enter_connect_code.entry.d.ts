/**
 * Enter Connect Code Entry Point (Account-Rooted-Sharing)
 *
 * The caller typed someone's code. Connects when both people have typed each other's code.
 *
 * @module entry/callable/enter_connect_code
 */
import { EnterConnectCodeResult } from "../../orchestrators/sharing/connect.orchestrator";
import { FunctionResponse } from "../../types";
/**
 * The caller typed someone's code. Connects when both people have typed each other's code.
 */
export declare const enter_connect_code: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<EnterConnectCodeResult>>, unknown>;
//# sourceMappingURL=enter_connect_code.entry.d.ts.map