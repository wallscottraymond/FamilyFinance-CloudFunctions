/**
 * Get Recurring Capabilities Entry Point (Convert-To-Recurring Phase 2): tells the app whether the
 * convert features are on for the caller (the app can't read `_feature_flags`). Returns only
 * `{enabled}`.
 *
 * @module entry/callable/get_recurring_capabilities
 */
import { FunctionResponse } from "../../types";
export declare const get_recurring_capabilities: import("firebase-functions/v2/https").CallableFunction<any, Promise<FunctionResponse<{
    enabled: boolean;
}>>, unknown>;
//# sourceMappingURL=get_recurring_capabilities.entry.d.ts.map