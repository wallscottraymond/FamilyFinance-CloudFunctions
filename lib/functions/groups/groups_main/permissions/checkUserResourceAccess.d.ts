import { CheckResourceAccessRequest, CheckResourceAccessResponse } from "../../../../types";
/**
 * Check if a user has access to a specific resource
 *
 * Checks:
 * 1. If user is the owner
 * 2. If user has direct share access
 * 3. If user is a member of a group that has access
 */
export declare const checkUserResourceAccess: import("firebase-functions/v2/https").CallableFunction<CheckResourceAccessRequest, Promise<CheckResourceAccessResponse>, unknown>;
//# sourceMappingURL=checkUserResourceAccess.d.ts.map