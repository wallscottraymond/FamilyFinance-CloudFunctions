/**
 * Import source_periods.json into Firebase Emulator
 *
 * Usage:
 * 1. Make sure Firebase emulator is running
 * 2. Place source_periods.json in the same directory as this script
 * 3. Run: node scripts/importToEmulator.js
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin pointing to emulator
const app = admin.initializeApp({
  projectId: 'family-budget-app-cb59b',
});

const db = app.firestore();

// Configure to use emulator
db.settings({
  host: 'localhost:8080',
  ssl: false,
});

async function importSourcePeriods() {
  const jsonPath = path.join(__dirname, '..', 'source_periods.json');

  console.log('🔄 Starting import to emulator...');
  console.log('📁 Reading from:', jsonPath);

  try {
    // Check if file exists
    if (!fs.existsSync(jsonPath)) {
      console.error('❌ File not found:', jsonPath);
      console.log('💡 Please place source_periods.json in:');
      console.log('   /Users/scottwall/Desktop/Projects/FamilyFinance/FamilyFinance-CloudFunctions/');
      process.exit(1);
    }

    // Read JSON file
    const fileContent = fs.readFileSync(jsonPath, 'utf8');
    const documents = JSON.parse(fileContent);

    console.log(`📊 Found ${documents.length} documents to import`);

    // Import in batches of 500 (Firestore batch limit)
    const batchSize = 500;
    let totalImported = 0;

    for (let i = 0; i < documents.length; i += batchSize) {
      const batch = db.batch();
      const batchDocs = documents.slice(i, i + batchSize);

      batchDocs.forEach(doc => {
        const { id, ...data } = doc;
        const docRef = db.collection('source_periods').doc(id);
        batch.set(docRef, data);
      });

      await batch.commit();
      totalImported += batchDocs.length;
      console.log(`   ✓ Imported ${totalImported} of ${documents.length} documents...`);
    }

    console.log('✅ Import complete!');
    console.log(`📊 Total documents imported: ${totalImported}`);

    // Verify
    const snapshot = await db.collection('source_periods').get();
    console.log(`✓ Verified: ${snapshot.size} documents in emulator`);

    process.exit(0);
  } catch (error) {
    console.error('❌ Error importing:', error);
    process.exit(1);
  }
}

// Run import
importSourcePeriods();
