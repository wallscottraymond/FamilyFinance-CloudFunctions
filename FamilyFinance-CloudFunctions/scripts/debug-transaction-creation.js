/**
 * Debug script to test transaction creation with splits
 * This will help identify if the issue is in the transaction creation logic
 */

const admin = require('firebase-admin');

// Initialize without credentials for now - this will use Application Default Credentials
// Run with: firebase functions:shell then call this function
const testTransactionCreation = async () => {
  console.log('🔍 Testing transaction creation with splits...\n');

  try {
    // Import the plaid transaction sync utility
    const plaidSyncModule = require('../lib/utils/plaidTransactionSync');
    
    if (!plaidSyncModule.createTransactionFromPlaid) {
      console.error('❌ createTransactionFromPlaid function not found in compiled module');
      console.log('Available functions:', Object.keys(plaidSyncModule));
      return;
    }

    console.log('✅ Found createTransactionFromPlaid function');
    
    // Create a sample Plaid transaction
    const samplePlaidTransaction = {
      transactionId: 'test_transaction_123',
      accountId: 'test_account_123',
      itemId: 'test_item_123',
      userId: 'test_user_123',
      amount: 25.50,
      category: ['Food and Drink', 'Restaurants'],
      merchantName: 'Test Restaurant',
      dateTransacted: admin.firestore.Timestamp.now(),
      pending: false,
      location: {
        address: '123 Test St',
        city: 'Test City',
        lat: 40.7128,
        lon: -74.0060
      },
      tags: []
    };

    const samplePlaidAccount = {
      accountId: 'test_account_123',
      name: 'Test Checking Account',
      type: 'depository',
      subtype: 'checking'
    };

    console.log('📝 Sample transaction data created');
    console.log('Transaction amount:', samplePlaidTransaction.amount);
    console.log('Transaction category:', samplePlaidTransaction.category);
    
    // This would normally create the transaction but we can't run it without proper setup
    console.log('✅ Transaction creation logic appears to be available');
    console.log('🔍 Check if the exchangePlaidToken function is actually being called when you link accounts');
    
  } catch (error) {
    console.error('❌ Error testing transaction creation:', error);
    console.log('This might indicate a compilation or import issue');
  }
};

console.log('To run this test properly:');
console.log('1. Run: npm run build');  
console.log('2. Check Firebase Console for exchangePlaidToken logs');
console.log('3. Verify the function is actually being called when linking accounts');

testTransactionCreation();