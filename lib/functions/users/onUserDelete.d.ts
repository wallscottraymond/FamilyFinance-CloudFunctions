import * as functions from "firebase-functions/v1";
/**
 * Clean up user data on account deletion
 * Note: Uses v1 API as there's no v2 equivalent for auth onDelete triggers.
 * The v2 identity module only provides blocking triggers (beforeUserCreated, beforeUserSignedIn).
 */
export declare const onUserDelete: functions.CloudFunction<import("firebase-admin/auth").UserRecord>;
//# sourceMappingURL=onUserDelete.d.ts.map