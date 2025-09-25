/**
 * Debug script to check outflow periods data
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin with service account (ensure GOOGLE_APPLICATION_CREDENTIALS is set)
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault()
  });
}

const db = admin.firestore();

async function debugOutflowPeriods() {
  try {
    console.log('🔍 Debugging outflow periods data...\n');

    // Get current user from auth (you'll need to replace this with a real user ID)
    // For testing, let's use a known user ID
    const testUserId = 'IKzBkwEZb6MdJkdDVnVyTFAFj5i1'; // Replace with actual user ID if known
    
    // 1. Check source_periods collection
    console.log('📅 Checking source_periods collection...');
    const sourcePeriodsSnapshot = await db.collection('source_periods')
      .where('isCurrent', '==', true)
      .limit(5)
      .get();
    
    console.log(`Found ${sourcePeriodsSnapshot.size} current source periods:`);
    sourcePeriodsSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`  - ${doc.id}: ${data.type} period (${data.startDate.toDate().toISOString().split('T')[0]} to ${data.endDate.toDate().toISOString().split('T')[0]})`);
    });
    console.log();

    // 2. Check outflow_periods collection 
    console.log('💰 Checking outflow_periods collection...');
    const outflowPeriodsSnapshot = await db.collection('outflow_periods')
      .limit(10)
      .get();
    
    console.log(`Found ${outflowPeriodsSnapshot.size} total outflow periods:`);
    outflowPeriodsSnapshot.forEach(doc => {
      const data = doc.data();
      console.log(`  - ${doc.id}:`);
      console.log(`    periodId: ${data.periodId || 'undefined'}`);
      console.log(`    sourcePeriodId: ${data.sourcePeriodId || 'undefined'}`);
      console.log(`    userId: ${data.userId || 'undefined'}`);
      console.log(`    isActive: ${data.isActive !== undefined ? data.isActive : 'undefined'}`);
      console.log(`    billAmount: $${data.billAmount || 0}`);
      console.log(`    periodType: ${data.periodType || 'undefined'}`);
      console.log();
    });

    // 3. Check for specific user's outflow periods
    if (testUserId) {
      console.log(`👤 Checking outflow_periods for user: ${testUserId}...`);
      const userOutflowsSnapshot = await db.collection('outflow_periods')
        .where('userId', '==', testUserId)
        .where('isActive', '==', true)
        .get();
      
      console.log(`Found ${userOutflowsSnapshot.size} active outflow periods for user ${testUserId}:`);
      userOutflowsSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`  - ${doc.id}: periodId=${data.periodId}, billAmount=$${data.billAmount}`);
      });
      console.log();
    }

    // 4. Check a specific period ID (from logs: 2025M09, 2025M10, 2025M11 are working)
    console.log('🎯 Checking specific period IDs that showed data...');
    const workingPeriods = ['2025M09', '2025M10', '2025M11'];
    
    for (const periodId of workingPeriods) {
      console.log(`\n📊 Period ${periodId}:`);
      
      // Check with periodId field
      const periodIdSnapshot = await db.collection('outflow_periods')
        .where('periodId', '==', periodId)
        .where('isActive', '==', true)
        .get();
      
      console.log(`  periodId query: ${periodIdSnapshot.size} documents`);
      
      // Check with sourcePeriodId field  
      const sourcePeriodIdSnapshot = await db.collection('outflow_periods')
        .where('sourcePeriodId', '==', periodId) 
        .where('isActive', '==', true)
        .get();
      
      console.log(`  sourcePeriodId query: ${sourcePeriodIdSnapshot.size} documents`);
      
      // Show details of found documents
      periodIdSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`    Found (periodId): userId=${data.userId}, billAmount=$${data.billAmount}`);
      });
      
      sourcePeriodIdSnapshot.forEach(doc => {
        const data = doc.data();
        console.log(`    Found (sourcePeriodId): userId=${data.userId}, billAmount=$${data.billAmount}`);
      });
    }

    // 5. Check non-working periods
    console.log('\n🚫 Checking periods that returned empty...');
    const nonWorkingPeriods = ['2025M01', '2025M02', '2025M03', '2025M04', '2025M05'];
    
    for (const periodId of nonWorkingPeriods.slice(0, 2)) { // Check first 2 to avoid too much output
      console.log(`\n📊 Period ${periodId}:`);
      
      const periodIdSnapshot = await db.collection('outflow_periods')
        .where('periodId', '==', periodId)
        .get();
      
      console.log(`  periodId query (no isActive filter): ${periodIdSnapshot.size} documents`);
      
      const sourcePeriodIdSnapshot = await db.collection('outflow_periods')
        .where('sourcePeriodId', '==', periodId)
        .get();
      
      console.log(`  sourcePeriodId query (no isActive filter): ${sourcePeriodIdSnapshot.size} documents`);
    }

    console.log('\n✅ Debug complete!');
    
  } catch (error) {
    console.error('❌ Error debugging outflow periods:', error);
  }
}

debugOutflowPeriods()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });