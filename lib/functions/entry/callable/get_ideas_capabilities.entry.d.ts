/**
 * Get Ideas Capabilities Entry Point (Planning-Module v1): tells the app whether Ideas is on for
 * the caller (the app can't read `_feature_flags`). Returns only `{enabled}`.
 *
 * @module entry/callable/get_ideas_capabilities
 */
import { FunctionResponse } from "../../types";
export declare const get_ideas_capabilities: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<{
    enabled: boolean;
}>>, unknown>;
//# sourceMappingURL=get_ideas_capabilities.entry.d.ts.map