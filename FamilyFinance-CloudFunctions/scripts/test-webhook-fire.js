/**
 * Test script to debug the fireTransactionWebhook function
 */

const admin = require('firebase-admin');
const { initializeApp } = require('firebase-admin/app');

// Initialize Firebase Admin
if (!admin.apps.length) {
  initializeApp({
    projectId: 'family-budget-app-cb59b'
  });
}

async function testWebhookFire() {
  console.log('🔥 Testing fireTransactionWebhook function...');

  try {
    // The user ID and item ID from the logs
    const userId = 'ZMdlWLc9pPa8TN5I1GQ5vcQ1xbt1';
    const itemId = '9e1VnXjq1rU8rEVDXnn3f8kKon46EkFRnwWZR';

    console.log(`🔍 Testing with userId: ${userId}, itemId: ${itemId}`);

    // Test if we can find the item directly in Firestore
    const db = admin.firestore();

    // First check subcollection
    console.log('🔍 Checking subcollection path...');
    const itemDoc = await db.collection('users')
      .doc(userId)
      .collection('plaidItems')
      .doc(itemId)
      .get();

    console.log(`🔍 Subcollection - Document exists: ${itemDoc.exists}`);
    if (itemDoc.exists) {
      const data = itemDoc.data();
      console.log(`🔍 Document data:`, {
        isActive: data?.isActive,
        institutionName: data?.institutionName,
        hasAccessToken: !!data?.accessToken,
        allFields: Object.keys(data || {})
      });
    }

    // Also check top-level collection
    console.log('🔍 Checking top-level collection...');
    const topLevelQuery = await db.collection('plaid_items')
      .where('itemId', '==', itemId)
      .where('userId', '==', userId)
      .limit(1)
      .get();

    console.log(`🔍 Top-level - Found documents: ${topLevelQuery.size}`);

    // Also list all items for this user to see what we have
    console.log('🔍 Listing all user plaidItems...');
    const allItemsQuery = await db.collection('users')
      .doc(userId)
      .collection('plaidItems')
      .where('isActive', '==', true)
      .get();

    console.log(`🔍 Total active items for user: ${allItemsQuery.size}`);
    allItemsQuery.docs.forEach((doc, index) => {
      const data = doc.data();
      console.log(`🔍 Item ${index + 1}: ${doc.id} - ${data.institutionName} (active: ${data.isActive})`);
    });

  } catch (error) {
    console.error('❌ Error testing webhook:', error);
  }
}

testWebhookFire();