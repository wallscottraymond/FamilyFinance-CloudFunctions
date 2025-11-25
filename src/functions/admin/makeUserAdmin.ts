import { onCall } from "firebase-functions/v2/https";
import * as admin from "firebase-admin";

/**
 * Make the current user an admin (Development Only)
 * This bypasses normal security for local development
 */
export const makeUserAdmin = onCall(async (request) => {
  if (!request.auth) {
    throw new Error("Must be authenticated");
  }

  const userId = request.auth.uid;
  const db = admin.firestore();

  try {
    // Update user document to admin role
    await db.collection("users").doc(userId).set({
      role: "admin",
      email: request.auth.token.email || "dev@example.com",
      displayName: request.auth.token.name || "Dev User",
      updatedAt: admin.firestore.Timestamp.now(),
    }, { merge: true });

    // Also set custom claims for role-based access
    await admin.auth().setCustomUserClaims(userId, {
      role: "admin",
    });

    return {
      success: true,
      message: "You are now an admin! Refresh the app to apply changes.",
      userId,
      role: "admin"
    };
  } catch (error: any) {
    console.error("Error making user admin:", error);
    throw new Error(`Failed to make user admin: ${error.message}`);
  }
});
