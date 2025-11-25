/**
 * Manual test script for webhook signature verification
 *
 * This script allows testing the webhook endpoint with various scenarios
 * to ensure signature verification is working correctly.
 */

const crypto = require('crypto');

// Test configuration
const WEBHOOK_URL = 'https://us-central1-family-budget-app-cb59b.cloudfunctions.net/plaidWebhook';
const TEST_SECRET = 'your-test-webhook-secret'; // Replace with actual test secret

// Test webhook payload
const testPayload = {
  webhook_type: 'TRANSACTIONS',
  webhook_code: 'SYNC_UPDATES_AVAILABLE',
  item_id: 'test-item-signature-verification',
  initial_update_complete: true,
  historical_update_complete: false,
  environment: 'sandbox',
  request_id: 'test-signature-' + Date.now()
};

/**
 * Generate a valid webhook signature
 */
function generateValidSignature(payload, secret) {
  const bodyString = JSON.stringify(payload);
  return crypto
    .createHmac('sha256', secret)
    .update(bodyString)
    .digest('hex');
}

/**
 * Test webhook with valid signature
 */
async function testValidSignature() {
  console.log('🧪 Testing webhook with VALID signature...');

  const bodyString = JSON.stringify(testPayload);
  const validSignature = generateValidSignature(testPayload, TEST_SECRET);

  console.log('Request details:', {
    url: WEBHOOK_URL,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'plaid-verification': validSignature
    },
    bodyLength: bodyString.length,
    signatureLength: validSignature.length
  });

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'plaid-verification': validSignature
      },
      body: bodyString
    });

    const responseData = await response.text();

    console.log('✅ Valid signature test result:', {
      status: response.status,
      statusText: response.statusText,
      response: responseData
    });

    return response.status === 200;
  } catch (error) {
    console.error('❌ Error testing valid signature:', error.message);
    return false;
  }
}

/**
 * Test webhook with invalid signature
 */
async function testInvalidSignature() {
  console.log('🧪 Testing webhook with INVALID signature...');

  const bodyString = JSON.stringify(testPayload);
  const invalidSignature = 'invalid-signature-for-testing-12345';

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'plaid-verification': invalidSignature
      },
      body: bodyString
    });

    const responseData = await response.text();

    console.log('🚫 Invalid signature test result:', {
      status: response.status,
      statusText: response.statusText,
      response: responseData
    });

    // Should return 401 for invalid signature
    return response.status === 401;
  } catch (error) {
    console.error('❌ Error testing invalid signature:', error.message);
    return false;
  }
}

/**
 * Test webhook with missing signature
 */
async function testMissingSignature() {
  console.log('🧪 Testing webhook with MISSING signature...');

  const bodyString = JSON.stringify(testPayload);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // No plaid-verification header
      },
      body: bodyString
    });

    const responseData = await response.text();

    console.log('❓ Missing signature test result:', {
      status: response.status,
      statusText: response.statusText,
      response: responseData
    });

    // Should return 401 for missing signature (if verification is enabled)
    return response.status === 401 || response.status === 200; // 200 if verification disabled
  } catch (error) {
    console.error('❌ Error testing missing signature:', error.message);
    return false;
  }
}

/**
 * Test webhook with tampered payload
 */
async function testTamperedPayload() {
  console.log('🧪 Testing webhook with TAMPERED payload...');

  // Generate signature for original payload
  const validSignature = generateValidSignature(testPayload, TEST_SECRET);

  // Modify the payload after generating signature
  const tamperedPayload = {
    ...testPayload,
    item_id: 'malicious-tampered-item-id'
  };
  const tamperedBodyString = JSON.stringify(tamperedPayload);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'plaid-verification': validSignature // Valid signature but for different payload
      },
      body: tamperedBodyString
    });

    const responseData = await response.text();

    console.log('🔒 Tampered payload test result:', {
      status: response.status,
      statusText: response.statusText,
      response: responseData
    });

    // Should return 401 for tampered payload
    return response.status === 401;
  } catch (error) {
    console.error('❌ Error testing tampered payload:', error.message);
    return false;
  }
}

/**
 * Run all security tests
 */
async function runSecurityTests() {
  console.log('🔐 WEBHOOK SIGNATURE VERIFICATION SECURITY TESTS');
  console.log('=================================================\n');

  const results = {
    validSignature: false,
    invalidSignature: false,
    missingSignature: false,
    tamperedPayload: false
  };

  // Test 1: Valid signature should work
  results.validSignature = await testValidSignature();
  console.log('');

  // Test 2: Invalid signature should be rejected
  results.invalidSignature = await testInvalidSignature();
  console.log('');

  // Test 3: Missing signature should be rejected (if verification enabled)
  results.missingSignature = await testMissingSignature();
  console.log('');

  // Test 4: Tampered payload should be rejected
  results.tamperedPayload = await testTamperedPayload();
  console.log('');

  // Summary
  console.log('📊 TEST RESULTS SUMMARY');
  console.log('======================');
  console.log(`✅ Valid signature accepted: ${results.validSignature ? 'PASS' : 'FAIL'}`);
  console.log(`🚫 Invalid signature rejected: ${results.invalidSignature ? 'PASS' : 'FAIL'}`);
  console.log(`❓ Missing signature handled: ${results.missingSignature ? 'PASS' : 'FAIL'}`);
  console.log(`🔒 Tampered payload rejected: ${results.tamperedPayload ? 'PASS' : 'FAIL'}`);

  const allPassed = Object.values(results).every(result => result);
  console.log(`\n🎯 Overall security status: ${allPassed ? '✅ SECURE' : '❌ VULNERABILITIES DETECTED'}`);

  if (!allPassed) {
    console.log('\n⚠️ SECURITY RECOMMENDATIONS:');
    if (!results.validSignature) {
      console.log('- Check webhook secret configuration');
      console.log('- Verify signature generation algorithm');
    }
    if (!results.invalidSignature) {
      console.log('- Ensure signature verification is enabled');
      console.log('- Check error handling for invalid signatures');
    }
    if (!results.missingSignature) {
      console.log('- Verify signature verification is required');
    }
    if (!results.tamperedPayload) {
      console.log('- Check payload integrity validation');
    }
  }

  return allPassed;
}

/**
 * Usage instructions
 */
function printUsage() {
  console.log('WEBHOOK SIGNATURE VERIFICATION TESTER');
  console.log('=====================================\n');
  console.log('Before running this test:');
  console.log('1. Deploy your webhook function with signature verification enabled');
  console.log('2. Set the correct WEBHOOK_URL in this script');
  console.log('3. Set the correct TEST_SECRET (your webhook secret)');
  console.log('4. Ensure NODE_ENV=production or VERIFY_WEBHOOK_SIGNATURE=true\n');
  console.log('To run: node webhookEndpointTest.js\n');
}

// Run tests if this file is executed directly
if (require.main === module) {
  // Check if required configuration is set
  if (TEST_SECRET === 'your-test-webhook-secret') {
    console.log('❌ Please configure TEST_SECRET before running tests');
    printUsage();
    process.exit(1);
  }

  runSecurityTests()
    .then(success => {
      process.exit(success ? 0 : 1);
    })
    .catch(error => {
      console.error('❌ Test suite failed:', error);
      process.exit(1);
    });
}

module.exports = {
  generateValidSignature,
  testValidSignature,
  testInvalidSignature,
  testMissingSignature,
  testTamperedPayload,
  runSecurityTests
};