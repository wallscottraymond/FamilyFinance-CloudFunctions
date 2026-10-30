/**
 * Get Sharing Overview Entry Point (Account-Rooted-Sharing)
 *
 * Everything the Groups screen shows: groups, connected people, requests, limits.
 *
 * @module entry/callable/get_sharing_overview
 */
import { SharingOverview } from "../../domain/sharing/sharing_overview.service";
import { FunctionResponse } from "../../types";
/**
 * Everything the Groups screen shows: groups, connected people, requests, limits.
 */
export declare const get_sharing_overview: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<SharingOverview>>, unknown>;
//# sourceMappingURL=get_sharing_overview.entry.d.ts.map