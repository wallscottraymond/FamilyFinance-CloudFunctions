/**
 * Check Outflows in Firestore Emulator
 *
 * This script checks if outflows have ownerId set correctly
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin for emulator
admin.initializeApp({
  projectId: 'familyfinance-72c26'
});

const db = admin.firestore();

// Connect to emulator
db.settings({
  host: 'localhost:8080',
  ssl: false
});

async function checkOutflows() {
  console.log('');
  console.log('='.repeat(60));
  console.log('CHECKING OUTFLOWS IN FIRESTORE EMULATOR');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Get all outflows
    const outflowsSnapshot = await db.collection('outflows').get();

    console.log(`Total outflows found: ${outflowsSnapshot.size}`);
    console.log('');

    if (outflowsSnapshot.empty) {
      console.log('❌ No outflows found in emulator!');
      return;
    }

    // Check each outflow
    outflowsSnapshot.forEach((doc, index) => {
      const data = doc.data();

      console.log(`${index + 1}. ${data.description || 'NO DESCRIPTION'}`);
      console.log(`   Document ID: ${doc.id}`);
      console.log(`   ownerId: ${data.ownerId || 'NO_OWNER_ID'}`);
      console.log(`   userId: ${data.userId || 'NO_USER_ID'}`);
      console.log(`   createdBy: ${data.createdBy || 'NO_CREATED_BY'}`);
      console.log(`   groupId: ${data.groupId || 'null'}`);
      console.log(`   streamId: ${data.streamId || 'NO_STREAM_ID'}`);
      console.log(`   frequency: ${data.frequency || 'NO_FREQUENCY'}`);
      console.log(`   averageAmount: $${data.averageAmount?.toFixed(2) || '0.00'}`);
      console.log('');
    });

  } catch (error) {
    console.error('❌ Error checking outflows:', error);
  } finally {
    process.exit(0);
  }
}

// Run the check
checkOutflows();
