import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/**
 * Grant admin role to a user.
 *
 * SECURITY: the CALLER must already be an admin. This prevents any
 * authenticated user from self-escalating to admin. The very first admin
 * must be bootstrapped out-of-band (Firebase console custom claim
 * `role: "admin"`, or the `users/{uid}.role` field + a token refresh).
 *
 * Target: defaults to the caller (re-affirm own admin); pass `data.targetUserId`
 * to promote another user.
 */
export const makeUserAdmin = onCall({
  region: "us-central1",
  memory: "256MiB",
  timeoutSeconds: 30,
  cors: true
}, async (request) => {
  console.log('🔧 makeUserAdmin called');

  if (!request.auth) {
    console.error('❌ makeUserAdmin: Not authenticated');
    throw new HttpsError('unauthenticated', 'Must be authenticated to make user admin');
  }

  // Only an existing admin may grant admin (prevents self-escalation)
  const callerIsAdmin = request.auth.token?.role === 'admin';
  if (!callerIsAdmin) {
    console.error(`❌ makeUserAdmin: Non-admin caller attempted escalation: ${request.auth.uid}`);
    throw new HttpsError('permission-denied', 'Only an existing admin can grant admin access');
  }

  const userId = (request.data?.targetUserId as string | undefined) || request.auth.uid;
  console.log(`👤 makeUserAdmin: admin ${request.auth.uid} promoting user ${userId}`);

  const db = admin.firestore();

  const isSelf = userId === request.auth.uid;

  try {
    // Update user document to admin role.
    // Only stamp email/displayName from the token when promoting SELF — otherwise
    // we'd overwrite the target user's identity with the caller's.
    console.log(`📝 Updating user document for ${userId}`);
    await db.collection("users").doc(userId).set({
      role: "admin",
      ...(isSelf ? {
        email: request.auth.token.email || "dev@example.com",
        displayName: request.auth.token.name || "Dev User",
      } : {}),
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    // Also set custom claims for role-based access
    console.log(`🔑 Setting custom claims for ${userId}`);
    await admin.auth().setCustomUserClaims(userId, {
      role: "admin",
    });

    console.log(`✅ Successfully made user ${userId} an admin`);

    return {
      success: true,
      message: "You are now an admin! Refresh the app to apply changes.",
      userId,
      role: "admin"
    };
  } catch (error: any) {
    console.error("❌ Error making user admin:", error);
    throw new HttpsError('internal', `Failed to make user admin: ${error.message}`);
  }
});
