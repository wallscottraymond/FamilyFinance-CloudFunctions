/**
 * Import source_periods from production to emulator
 *
 * Usage:
 * 1. Make sure Firebase emulator is running
 * 2. Run: node scripts/importSourcePeriods.js
 */

const admin = require('firebase-admin');

// Initialize production Firestore
const prodApp = admin.initializeApp({
  projectId: 'family-budget-app-cb59b',
}, 'production');

// Initialize emulator Firestore
const emulatorApp = admin.initializeApp({
  projectId: 'family-budget-app-cb59b',
}, 'emulator');

// Point emulator app to local emulator
const emulatorDb = emulatorApp.firestore();
emulatorDb.settings({
  host: 'localhost:8080',
  ssl: false,
});

const prodDb = prodApp.firestore();

async function importSourcePeriods() {
  console.log('🔄 Starting import of source_periods from production to emulator...');

  try {
    // Get all source_periods from production
    const snapshot = await prodDb.collection('source_periods').get();

    console.log(`📊 Found ${snapshot.size} source_periods documents in production`);

    if (snapshot.empty) {
      console.log('⚠️  No source_periods found in production');
      return;
    }

    // Batch write to emulator
    const batch = emulatorDb.batch();
    let count = 0;

    snapshot.forEach(doc => {
      const docRef = emulatorDb.collection('source_periods').doc(doc.id);
      batch.set(docRef, doc.data());
      count++;

      // Firebase batches have a 500 operation limit
      if (count % 500 === 0) {
        console.log(`   Prepared ${count} documents...`);
      }
    });

    console.log('💾 Writing documents to emulator...');
    await batch.commit();

    console.log(`✅ Successfully imported ${count} source_periods documents to emulator!`);

    // Verify
    const emulatorSnapshot = await emulatorDb.collection('source_periods').get();
    console.log(`✓ Verified: ${emulatorSnapshot.size} documents in emulator`);

  } catch (error) {
    console.error('❌ Error importing source_periods:', error);
    throw error;
  } finally {
    // Clean up
    await prodApp.delete();
    await emulatorApp.delete();
  }
}

// Run the import
importSourcePeriods()
  .then(() => {
    console.log('🎉 Import complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Import failed:', error);
    process.exit(1);
  });
