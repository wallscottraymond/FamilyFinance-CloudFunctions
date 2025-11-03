/**
 * Script to run RBAC migration on existing transactions
 *
 * Usage: node scripts/runRBACMigration.js
 */

const admin = require('firebase-admin');
const serviceAccount = require('../serviceAccountKey.json');

// Initialize Firebase Admin
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  projectId: 'family-budget-app-cb59b'
});

const functions = admin.functions();

async function runMigration() {
  console.log('Starting RBAC migration...\n');

  try {
    // Call the migration function
    const migrateFunction = functions.httpsCallable('migrateTransactionsRBAC');

    console.log('Calling migrateTransactionsRBAC function...');
    const result = await migrateFunction({});

    console.log('\n=== Migration Results ===');
    console.log(JSON.stringify(result.data, null, 2));

    if (result.data.success) {
      console.log('\n✅ Migration completed successfully!');
      console.log(`📊 Stats: ${result.data.message}`);

      // Run verification
      console.log('\n\nRunning verification...');
      const verifyFunction = functions.httpsCallable('verifyTransactionsRBAC');
      const verification = await verifyFunction({});

      console.log('\n=== Verification Results ===');
      console.log(JSON.stringify(verification.data, null, 2));

      if (verification.data.success) {
        console.log('\n✅ Verification completed successfully!');
      }
    } else {
      console.error('\n❌ Migration failed');
    }

  } catch (error) {
    console.error('\n❌ Error running migration:', error);
    if (error.details) {
      console.error('Details:', error.details);
    }
  }

  process.exit(0);
}

runMigration();
