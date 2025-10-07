/**
 * Create a test Plaid item for webhook testing
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'family-budget-app-cb59b'
  });
}

async function createTestPlaidItem() {
  const db = admin.firestore();

  const testItem = {
    itemId: 'test_webhook_item_123',
    userId: 'test_user_123',
    institutionId: 'ins_test',
    institutionName: 'Test Bank',
    accessToken: 'test_access_token_encrypted',
    cursor: null,
    products: ['transactions'],
    status: 'GOOD',
    isActive: true,
    webhookUrl: 'https://us-central1-family-budget-app-cb59b.cloudfunctions.net/plaidWebhook',
    createdAt: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
    lastSyncedAt: null
  };

  try {
    // Add to top-level collection for easy testing
    await db.collection('plaid_items').add(testItem);
    console.log('✅ Test Plaid item created successfully!');
    console.log('🔧 Test item ID: test_webhook_item_123');
    console.log('👤 Test user ID: test_user_123');
    console.log('📡 Now you can test with:');
    console.log(`curl -X POST "https://us-central1-family-budget-app-cb59b.cloudfunctions.net/plaidWebhook" \\
  -H "Content-Type: application/json" \\
  -H "plaid-verification: test-signature" \\
  -d '{"webhook_type":"TRANSACTIONS","webhook_code":"SYNC_UPDATES_AVAILABLE","item_id":"test_webhook_item_123","environment":"sandbox","request_id":"test-manual"}'`);
  } catch (error) {
    console.error('❌ Error creating test item:', error);
  }
}

createTestPlaidItem().catch(console.error);