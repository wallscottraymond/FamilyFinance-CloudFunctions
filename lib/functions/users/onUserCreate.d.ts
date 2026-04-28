import * as functions from "firebase-functions/v1";
/**
 * Create user profile (triggered on user registration)
 * This function automatically creates a comprehensive user document in Firestore
 * when a new user registers via Firebase Authentication.
 * Note: Uses v1 API as v2 beforeUserCreated requires GCIP (Google Cloud Identity Platform).
 */
export declare const onUserCreate: functions.CloudFunction<import("firebase-admin/auth").UserRecord>;
//# sourceMappingURL=onUserCreate.d.ts.map