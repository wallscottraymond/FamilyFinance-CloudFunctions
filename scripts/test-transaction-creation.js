console.log('Transaction Splits Troubleshooting Guide');
console.log('=========================================');
console.log('');
console.log('If new transactions don\'t have splits, here are the possible causes:');
console.log('');
console.log('1. DEPLOYMENT ISSUE:');
console.log('   - The updated createTransaction function may not have deployed properly');
console.log('   - Solution: Redeploy functions with `firebase deploy --only functions`');
console.log('');
console.log('2. CACHE ISSUE:');
console.log('   - Your mobile app may be cached or using old endpoints');
console.log('   - Solution: Clear app cache or restart mobile app completely');
console.log('');
console.log('3. DIFFERENT ENDPOINT:');
console.log('   - Your mobile app might be calling a different transaction creation endpoint');
console.log('   - Check if you\'re using createTransaction vs a different function');
console.log('');
console.log('4. ERROR IN TRANSACTION CREATION:');
console.log('   - There might be an error during the split creation process');
console.log('   - Check Firebase Functions logs for errors');
console.log('');
console.log('To verify the issue:');
console.log('==================');
console.log('');
console.log('1. Check Firebase Console > Functions > createTransaction');
console.log('   - Look at the logs for recent executions');
console.log('   - Look for any errors in split creation');
console.log('');
console.log('2. Check Firebase Console > Firestore > transactions collection');
console.log('   - Look at your newest transaction document');
console.log('   - Check if it has the "splits" field');
console.log('');
console.log('3. If transactions don\'t have splits:');
console.log('   - Run: firebase deploy --only functions');
console.log('   - Wait 2-3 minutes for deployment to complete');
console.log('   - Try creating a new transaction');
console.log('');
console.log('4. Check that you\'re creating transactions via the right endpoint:');
console.log('   - Should be calling: createTransaction (HTTP POST)');
console.log('   - URL: https://us-central1-family-budget-app-cb59b.cloudfunctions.net/createTransaction');
console.log('');
console.log('Expected new transaction structure:');
console.log('==================================');
console.log(JSON.stringify({
  id: "trans_123",
  amount: 100,
  description: "Test transaction",
  splits: [{
    id: "split_456",
    budgetId: "budget_or_unassigned",
    budgetPeriodId: "unassigned",
    budgetName: "General",
    amount: 100,
    isDefault: true
  }],
  isSplit: false,
  totalAllocated: 100,
  unallocated: 0,
  affectedBudgets: ["budget_id_or_empty"],
  affectedBudgetPeriods: []
}, null, 2));