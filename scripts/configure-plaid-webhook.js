/**
 * Configure Plaid Webhook URL for deployed Cloud Functions
 *
 * This script updates existing Plaid items to use the deployed webhook endpoint
 * for real-time transaction synchronization.
 */

const admin = require('firebase-admin');
const { PlaidApi, Configuration, PlaidEnvironments } = require('plaid');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'family-budget-app-cb59b'
  });
}

// Plaid configuration
const PLAID_CLIENT_ID = '6439737b3f59d500139a7d13';
const PLAID_SECRET = process.env.PLAID_SECRET || 'your-plaid-secret-here';
const WEBHOOK_URL = 'https://us-central1-family-budget-app-cb59b.cloudfunctions.net/plaidWebhook';

// Create Plaid client
const configuration = new Configuration({
  basePath: PlaidEnvironments.sandbox,
  baseOptions: {
    headers: {
      'PLAID-CLIENT-ID': PLAID_CLIENT_ID,
      'PLAID-SECRET': PLAID_SECRET,
    },
  },
});

const plaidClient = new PlaidApi(configuration);

async function configureWebhookForUser(userId = 'HIXw4Pp4FpX72aHU4BHbF9o54no1') {
  console.log(`🔧 Configuring webhooks for user: ${userId}`);

  try {
    const db = admin.firestore();

    // Get user's Plaid items
    const itemsQuery = await db.collection('users')
      .doc(userId)
      .collection('plaidItems')
      .where('isActive', '==', true)
      .get();

    console.log(`📋 Found ${itemsQuery.size} active Plaid items`);

    for (const itemDoc of itemsQuery.docs) {
      const itemData = itemDoc.data();
      console.log(`\\n🔧 Configuring item: ${itemData.itemId} (${itemData.institutionName})`);

      try {
        // Update item webhook using Plaid API
        const updateRequest = {
          access_token: itemData.accessToken,
          webhook: WEBHOOK_URL
        };

        const response = await plaidClient.itemWebhookUpdate(updateRequest);
        console.log(`✅ Webhook updated successfully for ${itemData.itemId}`);
        console.log(`   New webhook URL: ${response.data.item.webhook}`);

        // Update Firestore document with webhook info
        await itemDoc.ref.update({
          webhookUrl: WEBHOOK_URL,
          webhookUpdatedAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now()
        });

      } catch (error) {
        console.error(`❌ Failed to configure webhook for ${itemData.itemId}:`, error.response?.data || error.message);

        // Log the specific error for troubleshooting
        if (error.response?.data?.error_code) {
          const plaidError = error.response.data;
          console.error(`   Plaid Error: ${plaidError.error_code} - ${plaidError.error_message}`);
        }
      }
    }

    console.log(`\\n🎯 Webhook configuration complete!`);
    console.log(`📡 Webhook URL: ${WEBHOOK_URL}`);
    console.log(`🔔 Items will now send webhooks to your deployed Cloud Function`);

  } catch (error) {
    console.error('❌ Error configuring webhooks:', error);
  }
}

async function testWebhookConfiguration(userId = 'HIXw4Pp4FpX72aHU4BHbF9o54no1') {
  console.log(`\\n🧪 Testing webhook configuration...`);

  try {
    const db = admin.firestore();

    // Get a Plaid item to test with
    const itemsQuery = await db.collection('users')
      .doc(userId)
      .collection('plaidItems')
      .where('isActive', '==', true)
      .limit(1)
      .get();

    if (itemsQuery.empty) {
      console.log('❌ No active Plaid items found for testing');
      return;
    }

    const itemDoc = itemsQuery.docs[0];
    const itemData = itemDoc.data();

    console.log(`🧪 Testing with item: ${itemData.itemId} (${itemData.institutionName})`);

    // Fire a test webhook
    const fireWebhookRequest = {
      access_token: itemData.accessToken,
      webhook_code: 'SYNC_UPDATES_AVAILABLE'
    };

    const response = await plaidClient.sandboxItemFireWebhook(fireWebhookRequest);
    console.log(`✅ Test webhook fired successfully!`);
    console.log(`📨 Webhook should be received by: ${WEBHOOK_URL}`);
    console.log(`🔔 Check your Firebase Functions logs for webhook processing`);

  } catch (error) {
    console.error('❌ Error testing webhook:', error.response?.data || error.message);
  }
}

async function main() {
  const action = process.argv[2] || 'configure';
  const userId = process.argv[3] || 'HIXw4Pp4FpX72aHU4BHbF9o54no1';

  if (action === 'configure') {
    await configureWebhookForUser(userId);
  } else if (action === 'test') {
    await testWebhookConfiguration(userId);
  } else if (action === 'both') {
    await configureWebhookForUser(userId);
    await testWebhookConfiguration(userId);
  } else {
    console.log('Usage: node configure-plaid-webhook.js [configure|test|both] [userId]');
    console.log('Examples:');
    console.log('  node configure-plaid-webhook.js configure');
    console.log('  node configure-plaid-webhook.js test');
    console.log('  node configure-plaid-webhook.js both');
  }
}

// Run the script
main().catch(console.error);