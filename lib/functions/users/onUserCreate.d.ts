import * as functions from "firebase-functions";
/**
 * Create user profile (triggered on user registration)
 * This function automatically creates a comprehensive user document in Firestore
 * when a new user registers via Firebase Authentication
 */
export declare const onUserCreate: functions.CloudFunction<import("firebase-admin/auth").UserRecord>;
//# sourceMappingURL=onUserCreate.d.ts.map