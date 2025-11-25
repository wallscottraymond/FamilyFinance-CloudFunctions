import * as functions from "firebase-functions";
import { 
  deleteDocument 
} from "../../utils/firestore";

/**
 * Clean up user data on account deletion
 */
export const onUserDelete = functions.region("us-central1").runWith({
  memory: "256MB",
  timeoutSeconds: 30
}).auth.user().onDelete(async (userRecord) => {
  try {
    // Delete user document
    await deleteDocument("users", userRecord.uid);

    // Note: Transactions and other user data should be handled separately
    // depending on business requirements (anonymize vs delete)

    console.log(`Cleaned up data for deleted user ${userRecord.uid}`);
  } catch (error) {
    console.error(`Error cleaning up data for user ${userRecord.uid}:`, error);
  }
});