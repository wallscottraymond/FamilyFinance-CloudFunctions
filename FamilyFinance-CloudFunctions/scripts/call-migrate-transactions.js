const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.applicationDefault()
});

async function callMigrateTransactionsToSplits() {
  try {
    console.log('Calling migrateTransactionsToSplits function...');
    
    // Call the Cloud Function directly using the Admin SDK
    const functions = admin.functions();
    const migrateFunction = functions.httpsCallable('migrateTransactionsToSplits');
    
    const result = await migrateFunction({});
    
    console.log('Migration completed successfully:');
    console.log(JSON.stringify(result.data, null, 2));
    
  } catch (error) {
    console.error('Error calling migration function:', error);
    if (error.details) {
      console.error('Error details:', error.details);
    }
  }
}

callMigrateTransactionsToSplits().then(() => {
  console.log('Script completed');
  process.exit(0);
}).catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});