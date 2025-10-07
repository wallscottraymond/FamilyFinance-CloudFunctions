/**
 * Test the deployed webhook endpoint directly
 *
 * This script sends a test webhook payload to verify the endpoint is working
 */

const crypto = require('crypto');

const WEBHOOK_URL = 'https://us-central1-family-budget-app-cb59b.cloudfunctions.net/plaidWebhook';
const WEBHOOK_SECRET = process.env.PLAID_WEBHOOK_SECRET || 'your-webhook-secret';

// Test webhook payload
const testPayload = {
  webhook_type: 'TRANSACTIONS',
  webhook_code: 'SYNC_UPDATES_AVAILABLE',
  item_id: '5p7loqoKKwH5X9nqePLMuBd4B78o1dFZok45Z', // One of your test items
  environment: 'sandbox',
  initial_update_complete: true,
  historical_update_complete: false,
  request_id: 'test-' + Date.now()
};

function generateWebhookSignature(payload, secret) {
  const bodyString = JSON.stringify(payload);
  return crypto
    .createHmac('sha256', secret)
    .update(bodyString)
    .digest('hex');
}

async function testWebhookEndpoint() {
  console.log('🧪 Testing webhook endpoint...');
  console.log(`📡 URL: ${WEBHOOK_URL}`);
  console.log(`📋 Payload:`, testPayload);

  try {
    const bodyString = JSON.stringify(testPayload);
    const signature = generateWebhookSignature(testPayload, WEBHOOK_SECRET);

    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'plaid-verification': signature
      },
      body: bodyString
    });

    console.log(`📊 Response Status: ${response.status} ${response.statusText}`);

    const responseText = await response.text();
    console.log(`📄 Response Body:`, responseText);

    if (response.ok) {
      console.log('✅ Webhook endpoint is working!');

      try {
        const responseData = JSON.parse(responseText);
        if (responseData.success) {
          console.log('🎉 Transaction sync was triggered successfully!');
          console.log(`📨 Message: ${responseData.message}`);
        }
      } catch (parseError) {
        console.log('⚠️ Response is not JSON, but request succeeded');
      }
    } else {
      console.log('❌ Webhook endpoint returned an error');
    }

  } catch (error) {
    console.error('❌ Error testing webhook endpoint:', error.message);
  }
}

// Instructions for manual testing
function printInstructions() {
  console.log('\\n📋 WEBHOOK SETUP INSTRUCTIONS:');
  console.log('================================');
  console.log('\\n1. 🔑 Set your Plaid webhook secret:');
  console.log('   export PLAID_WEBHOOK_SECRET="your-secret-here"');
  console.log('\\n2. 🔧 Configure Plaid items to use this webhook:');
  console.log('   node configure-plaid-webhook.js configure');
  console.log('\\n3. 🧪 Test a real webhook:');
  console.log('   node configure-plaid-webhook.js test');
  console.log('\\n4. 📊 Monitor Firebase Functions logs:');
  console.log('   firebase functions:log --only plaidWebhook');
  console.log('\\n5. 🔥 Or use the mobile app webhook testing:');
  console.log('   - Open Settings > Developer > Webhook Testing');
  console.log('   - Select an item and fire SYNC_UPDATES_AVAILABLE');
  console.log('\\n📡 Deployed webhook URL:');
  console.log('   ' + WEBHOOK_URL);
}

async function main() {
  const action = process.argv[2];

  if (action === 'test') {
    await testWebhookEndpoint();
  } else {
    printInstructions();

    if (process.env.PLAID_WEBHOOK_SECRET) {
      console.log('\\n🧪 Running endpoint test...');
      await testWebhookEndpoint();
    }
  }
}

main().catch(console.error);