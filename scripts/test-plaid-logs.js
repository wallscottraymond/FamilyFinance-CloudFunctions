/**
 * Test script to help diagnose Plaid integration issues
 * 
 * This script helps check if:
 * 1. The exchangePlaidToken function is being called
 * 2. Transactions are being created in the database
 * 3. Error logs can be identified
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();

async function checkPlaidData() {
  console.log('🔍 Checking Plaid integration status...\n');

  try {
    // Check for Plaid items
    const plaidItemsSnapshot = await db.collection('plaid_items').limit(5).get();
    console.log(`📋 Plaid Items found: ${plaidItemsSnapshot.size}`);
    
    if (plaidItemsSnapshot.size > 0) {
      plaidItemsSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`  - Item: ${data.institutionName} (${data.itemId})`);
        console.log(`    Status: ${data.isActive ? 'Active' : 'Inactive'}`);
        console.log(`    Last synced: ${data.lastSyncedAt ? data.lastSyncedAt.toDate() : 'Never'}`);
      });
    }

    // Check for raw Plaid transactions
    const plaidTransactionsSnapshot = await db.collection('plaid_transactions')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();
    
    console.log(`\n💳 Raw Plaid Transactions found: ${plaidTransactionsSnapshot.size}`);
    
    if (plaidTransactionsSnapshot.size > 0) {
      plaidTransactionsSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`  - ${data.description || data.merchantName || 'Transaction'}: $${data.amount}`);
        console.log(`    Processed: ${data.isProcessed ? 'Yes' : 'No'}`);
        console.log(`    Date: ${data.dateTransacted ? data.dateTransacted.toDate().toLocaleDateString() : 'Unknown'}`);
      });
    }

    // Check for Family Finance transactions with Plaid metadata
    const familyTransactionsSnapshot = await db.collection('transactions')
      .where('metadata.source', '==', 'plaid')
      .orderBy('createdAt', 'desc')
      .limit(10)
      .get();
    
    console.log(`\n🏦 Family Finance Transactions from Plaid: ${familyTransactionsSnapshot.size}`);
    
    if (familyTransactionsSnapshot.size > 0) {
      familyTransactionsSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`  - ${data.description}: $${data.amount}`);
        console.log(`    Has splits: ${data.splits && data.splits.length > 0 ? 'Yes' : 'No'}`);
        console.log(`    Split count: ${data.splits ? data.splits.length : 0}`);
        console.log(`    Date: ${data.date ? data.date.toDate().toLocaleDateString() : 'Unknown'}`);
      });
    }

    // Check recent function executions
    console.log('\n📊 Summary:');
    console.log(`- Plaid items: ${plaidItemsSnapshot.size}`);
    console.log(`- Raw Plaid transactions: ${plaidTransactionsSnapshot.size}`);
    console.log(`- Converted transactions: ${familyTransactionsSnapshot.size}`);

    if (plaidItemsSnapshot.size > 0 && plaidTransactionsSnapshot.size === 0) {
      console.log('\n⚠️  Issue: Plaid items exist but no raw transactions found');
      console.log('   This suggests the exchangePlaidToken function may not be fetching transaction data');
    }

    if (plaidTransactionsSnapshot.size > 0 && familyTransactionsSnapshot.size === 0) {
      console.log('\n⚠️  Issue: Raw Plaid transactions exist but no converted transactions found');
      console.log('   This suggests the transaction conversion process is failing');
    }

  } catch (error) {
    console.error('Error checking Plaid data:', error);
  }
}

checkPlaidData().then(() => {
  console.log('\n✅ Diagnostic complete');
  process.exit(0);
}).catch(error => {
  console.error('Diagnostic failed:', error);
  process.exit(1);
});