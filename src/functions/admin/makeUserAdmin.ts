import { onCall, HttpsError } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/**
 * Make the current user an admin (Development Only)
 * This bypasses normal security for local development
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

  const userId = request.auth.uid;
  console.log(`👤 makeUserAdmin: Processing for user ${userId}`);

  const db = admin.firestore();

  try {
    // Update user document to admin role
    console.log(`📝 Updating user document for ${userId}`);
    await db.collection("users").doc(userId).set({
      role: "admin",
      email: request.auth.token.email || "dev@example.com",
      displayName: request.auth.token.name || "Dev User",
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
