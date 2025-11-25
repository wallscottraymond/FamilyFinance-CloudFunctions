/**
 * Check Outflow Periods in Firestore Emulator
 *
 * This script queries the Firestore emulator to check:
 * - If outflow_periods exist
 * - What ownerId values they have
 * - If they match the expected user
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

async function checkOutflowPeriods() {
  console.log('');
  console.log('='.repeat(60));
  console.log('CHECKING OUTFLOW PERIODS IN FIRESTORE EMULATOR');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Get all outflow_periods
    const outflowPeriodsSnapshot = await db.collection('outflow_periods').get();

    console.log(`Total outflow_periods found: ${outflowPeriodsSnapshot.size}`);
    console.log('');

    if (outflowPeriodsSnapshot.empty) {
      console.log('❌ No outflow_periods found in emulator!');
      console.log('');
      console.log('This likely means:');
      console.log('  1. createTestOutflows has not been run yet');
      console.log('  2. Or outflows were created but onOutflowCreated trigger failed');
      console.log('');
      console.log('Try running:');
      console.log('  curl "http://localhost:5001/familyfinance-72c26/us-central1/createTestOutflows?userId=YOUR_USER_ID"');
      console.log('');
      return;
    }

    // Group by ownerId
    const periodsByOwner = {};
    outflowPeriodsSnapshot.forEach(doc => {
      const data = doc.data();
      const ownerId = data.ownerId || 'NO_OWNER_ID';

      if (!periodsByOwner[ownerId]) {
        periodsByOwner[ownerId] = [];
      }
      periodsByOwner[ownerId].push({
        id: doc.id,
        outflowId: data.outflowId,
        periodId: data.periodId,
        description: data.description,
        periodType: data.periodType,
        amountWithheld: data.amountWithheld
      });
    });

    // Display results by owner
    console.log('📊 Outflow Periods by Owner:');
    console.log('');

    for (const [ownerId, periods] of Object.entries(periodsByOwner)) {
      console.log(`Owner: ${ownerId}`);
      console.log(`  Periods: ${periods.length}`);
      console.log('');

      // Show first 5 periods as examples
      const examples = periods.slice(0, 5);
      examples.forEach((period, i) => {
        console.log(`  ${i + 1}. ${period.description}`);
        console.log(`     Period: ${period.periodId} (${period.periodType})`);
        console.log(`     Amount: $${period.amountWithheld?.toFixed(2) || '0.00'}`);
        console.log('');
      });

      if (periods.length > 5) {
        console.log(`  ... and ${periods.length - 5} more periods`);
        console.log('');
      }
    }

    // Get current authenticated user ID from logs
    console.log('');
    console.log('💡 To check if these match your current user:');
    console.log('   Check the Firebase Auth UID in your mobile app logs');
    console.log('   It should match one of the Owner IDs above');
    console.log('');

  } catch (error) {
    console.error('❌ Error checking outflow_periods:', error);
  } finally {
    process.exit(0);
  }
}

// Run the check
checkOutflowPeriods();
