import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { initializeOutflowSummaries, initializeGroupOutflowSummaries } from '../../utils/initializeOutflowSummaries';

/**
 * Trigger when a user document is created
 * Initializes outflow summary collections for the new user
 */
export const onUserCreated = onDocumentCreated({
  document: 'users/{userId}',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (event) => {
  const userId = event.params.userId;
  const userData = event.data?.data();

  console.log(`🆕 New user created: ${userId}`);

  try {
    // Initialize outflow summary collections
    await initializeOutflowSummaries(userId);

    // Initialize group outflow summaries if user belongs to groups
    if (userData?.groupIds && Array.isArray(userData.groupIds) && userData.groupIds.length > 0) {
      console.log(`📊 User belongs to ${userData.groupIds.length} group(s), initializing group summaries`);
      for (const groupId of userData.groupIds) {
        await initializeGroupOutflowSummaries(groupId);
      }
    }

    console.log(`✅ Successfully initialized summaries for user ${userId}`);
  } catch (error) {
    console.error(`❌ Error initializing summaries for user ${userId}:`, error);
    throw error; // Re-throw to ensure Cloud Functions retries
  }
});
