/**
 * Test script for updateBudgetDuration Cloud Function
 *
 * This script demonstrates how to call the updateBudgetDuration function
 * with proper parameters and handle responses.
 *
 * Usage:
 * node test-update-budget-duration.js [budgetId] [newEndDate] [operation]
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin (use your service account key)
if (!admin.apps.length) {
  admin.initializeApp({
    projectId: 'your-project-id', // Replace with your actual project ID
  });
}

const functions = admin.functions();

async function testUpdateBudgetDuration() {
  try {
    // Get parameters from command line or use defaults for testing
    const budgetId = process.argv[2] || 'test-budget-id';
    const newEndDate = process.argv[3] || '2025-12-31T23:59:59.000Z';
    const operation = process.argv[4] || 'extend';

    console.log('Testing updateBudgetDuration with parameters:');
    console.log(`- Budget ID: ${budgetId}`);
    console.log(`- New End Date: ${newEndDate}`);
    console.log(`- Operation: ${operation}`);
    console.log();

    // Call the cloud function
    const callable = functions.httpsCallable('updateBudgetDuration');
    const result = await callable({
      budgetId: budgetId,
      newEndDate: newEndDate,
      operation: operation
    });

    console.log('✅ Function call successful!');
    console.log('Response:', JSON.stringify(result.data, null, 2));

    if (result.data.success) {
      console.log();
      console.log(`🎉 Budget duration ${operation} completed successfully!`);
      console.log(`📊 Periods affected: ${result.data.periodsAffected}`);
      console.log(`📅 New end date: ${result.data.newEndDate}`);

      if (result.data.operationDetails) {
        const details = result.data.operationDetails;
        if (details.periodsCreated) {
          console.log(`➕ Periods created: ${details.periodsCreated}`);
        }
        if (details.periodsDeactivated) {
          console.log(`➖ Periods deactivated: ${details.periodsDeactivated}`);
        }
        console.log(`📈 Period types affected: ${details.periodTypes.join(', ')}`);
      }
    } else {
      console.log('❌ Function reported failure:', result.data.message);
    }

  } catch (error) {
    console.error('❌ Error calling updateBudgetDuration:');
    console.error('Error code:', error.code);
    console.error('Error message:', error.message);
    console.error('Error details:', error.details);

    // Common error scenarios and suggested fixes
    if (error.code === 'unauthenticated') {
      console.log('\n💡 Tip: Make sure you have proper authentication configured');
    } else if (error.code === 'permission-denied') {
      console.log('\n💡 Tip: Make sure you own the budget or are a member');
    } else if (error.code === 'not-found') {
      console.log('\n💡 Tip: Check that the budget ID exists');
    } else if (error.code === 'invalid-argument') {
      console.log('\n💡 Tip: Check your parameters (budgetId, newEndDate, operation)');
    }
  }
}

// Run the test
testUpdateBudgetDuration().then(() => {
  console.log('\n✨ Test completed');
  process.exit(0);
}).catch((error) => {
  console.error('💥 Test failed:', error);
  process.exit(1);
});