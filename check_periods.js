const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function checkSourcePeriods() {
  try {
    // Get the transaction's userId from the screenshot
    const userId = 'JLJVpvLR7eeQ2gp72GX03I47ZszH3';
    
    console.log(`\n🔍 Checking source_periods for user: ${userId}\n`);
    
    const periodsSnapshot = await db.collection('source_periods')
      .where('userId', '==', userId)
      .limit(10)
      .get();
    
    console.log(`📊 Found ${periodsSnapshot.size} source_periods for this user\n`);
    
    if (periodsSnapshot.empty) {
      console.log('❌ NO SOURCE PERIODS FOUND! This is why the splits have null period IDs.\n');
      console.log('You need to run generateSourcePeriods function for this user.\n');
    } else {
      console.log('✅ Source periods exist:\n');
      periodsSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`  Period ID: ${doc.id}`);
        console.log(`  Type: ${data.periodType}`);
        console.log(`  Start: ${data.periodStartDate?.toDate?.()}`);
        console.log(`  End: ${data.periodEndDate?.toDate?.()}`);
        console.log('');
      });
    }
    
    // Check the transaction date
    const txnDate = new Date('August 16, 2025 at 6:00:00 AM UTC-6');
    console.log(`\n🗓️  Transaction Date: ${txnDate}\n`);
    
    // Check if any periods contain this date
    const matchingPeriods = await db.collection('source_periods')
      .where('userId', '==', userId)
      .where('periodStartDate', '<=', admin.firestore.Timestamp.fromDate(txnDate))
      .where('periodEndDate', '>', admin.firestore.Timestamp.fromDate(txnDate))
      .get();
    
    if (matchingPeriods.empty) {
      console.log('❌ No periods contain the transaction date! Need to generate periods.\n');
    } else {
      console.log(`✅ Found ${matchingPeriods.size} periods containing the transaction date:\n`);
      matchingPeriods.forEach(doc => {
        const data = doc.data();
        console.log(`  ${data.periodType}: ${doc.id}`);
      });
    }
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkSourcePeriods();
