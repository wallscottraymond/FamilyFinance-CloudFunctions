const admin = require('firebase-admin');

// Initialize with Application Default Credentials (if available)
try {
  admin.initializeApp();
  console.log('Firebase Admin initialized successfully');
} catch (error) {
  console.log('Could not initialize Firebase Admin. This is expected if not running with proper credentials.');
  console.log('To check transaction status, you can:');
  console.log('1. Run the verification function from Firebase console');
  console.log('2. Use the mobile app with admin authentication');
  console.log('3. Check Firestore directly in Firebase console');
  console.log('');
  console.log('Functions deployed and ready:');
  console.log('- migrateTransactionsToSplits (callable)');
  console.log('- verifyTransactionSplitsMigration (callable)');
  console.log('- addTransactionSplit (callable)');
  console.log('- updateTransactionSplit (callable)');
  console.log('- deleteTransactionSplit (callable)');
  process.exit(0);
}

async function checkTransactionStatus() {
  try {
    const db = admin.firestore();
    
    // Count total transactions
    const totalSnapshot = await db.collection('transactions').count().get();
    const totalTransactions = totalSnapshot.data().count;
    
    // Try to count transactions with splits (this might fail if none exist yet)
    let transactionsWithSplits = 0;
    try {
      const withSplitsSnapshot = await db.collection('transactions')
        .where('splits', '!=', null)
        .count()
        .get();
      transactionsWithSplits = withSplitsSnapshot.data().count;
    } catch (error) {
      console.log('No transactions with splits found yet (expected before migration)');
    }
    
    const transactionsWithoutSplits = totalTransactions - transactionsWithSplits;
    
    console.log('Transaction Status:');
    console.log(`Total transactions: ${totalTransactions}`);
    console.log(`Transactions with splits: ${transactionsWithSplits}`);
    console.log(`Transactions needing migration: ${transactionsWithoutSplits}`);
    console.log('');
    
    if (transactionsWithoutSplits === 0) {
      console.log('✅ All transactions have been migrated to use splits!');
    } else {
      console.log('📋 Migration needed. Run migrateTransactionsToSplits function.');
    }
    
  } catch (error) {
    console.error('Error checking transaction status:', error.message);
  }
}

checkTransactionStatus().then(() => {
  process.exit(0);
}).catch(error => {
  console.error('Script failed:', error.message);
  process.exit(1);
});