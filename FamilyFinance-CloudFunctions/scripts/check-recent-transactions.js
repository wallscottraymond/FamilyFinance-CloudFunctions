const admin = require('firebase-admin');

// Initialize Firebase Admin with project
try {
  admin.initializeApp({
    projectId: 'family-budget-app-cb59b'
  });
} catch (error) {
  console.log('Admin already initialized');
}

async function checkRecentTransactions() {
  try {
    const db = admin.firestore();
    
    console.log('Checking recent transactions for splits...');
    
    // Get the 3 most recent transactions
    const snapshot = await db.collection('transactions')
      .orderBy('createdAt', 'desc')
      .limit(3)
      .get();
    
    if (snapshot.empty) {
      console.log('No transactions found');
      return;
    }
    
    console.log(`Found ${snapshot.size} recent transactions:`);
    console.log('');
    
    snapshot.forEach((doc, index) => {
      const data = doc.data();
      console.log(`Transaction ${index + 1} (ID: ${doc.id}):`);
      console.log(`  Amount: ${data.amount}`);
      console.log(`  Description: ${data.description}`);
      console.log(`  Created: ${data.createdAt?.toDate()}`);
      console.log(`  Has splits field: ${data.splits ? 'YES' : 'NO'}`);
      console.log(`  Splits count: ${data.splits ? data.splits.length : 0}`);
      console.log(`  isSplit: ${data.isSplit}`);
      console.log(`  totalAllocated: ${data.totalAllocated}`);
      console.log(`  unallocated: ${data.unallocated}`);
      console.log(`  affectedBudgets: ${JSON.stringify(data.affectedBudgets)}`);
      
      if (data.splits && data.splits.length > 0) {
        console.log('  Split details:');
        data.splits.forEach((split, i) => {
          console.log(`    Split ${i + 1}: $${split.amount} to ${split.budgetName} (${split.budgetId})`);
        });
      }
      console.log('');
    });
    
  } catch (error) {
    console.error('Error checking transactions:', error);
  }
}

checkRecentTransactions().then(() => {
  console.log('Check complete');
  process.exit(0);
}).catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});