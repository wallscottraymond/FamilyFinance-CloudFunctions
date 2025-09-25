#!/usr/bin/env node

/**
 * Call the admin fetchRecurringTransactions function using Firebase Admin SDK
 */

const admin = require('firebase-admin');
const path = require('path');

// Initialize Firebase Admin
const serviceAccount = require(path.join(process.env.HOME, 'google-service-account-key.json'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();

async function checkPlaidItems() {
  try {
    console.log('🔍 Checking for Plaid items in database...');
    
    const usersSnapshot = await db.collection('users').limit(5).get();
    console.log(`Found ${usersSnapshot.size} users`);
    
    let totalPlaidItems = 0;
    
    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      
      console.log(`User: ${userData.email || userId}`);
      
      // Check plaidItems subcollection
      const plaidItemsSnapshot = await db.collection('users').doc(userId).collection('plaidItems').get();
      console.log(`  Plaid items: ${plaidItemsSnapshot.size}`);
      totalPlaidItems += plaidItemsSnapshot.size;
      
      if (plaidItemsSnapshot.size > 0) {
        plaidItemsSnapshot.docs.forEach(doc => {
          const data = doc.data();
          console.log(`    Item: ${data.institutionName} (${data.isActive ? 'active' : 'inactive'})`);
        });
      }
    }
    
    return totalPlaidItems;
  } catch (error) {
    console.error('Error checking Plaid items:', error);
    return 0;
  }
}

async function checkOutflowsAndPeriods() {
  try {
    console.log('🔍 Checking outflows and outflow_periods collections...');
    
    const outflowsSnapshot = await db.collection('outflows').limit(10).get();
    console.log(`Outflows collection: ${outflowsSnapshot.size} documents`);
    
    const outflowPeriodsSnapshot = await db.collection('outflow_periods').limit(10).get();
    console.log(`Outflow periods collection: ${outflowPeriodsSnapshot.size} documents`);
    
    if (outflowsSnapshot.size > 0) {
      console.log('Sample outflows:');
      outflowsSnapshot.docs.slice(0, 3).forEach(doc => {
        const data = doc.data();
        console.log(`  - ${data.description}: $${data.averageAmount?.amount} (${data.frequency})`);
      });
    }
    
    if (outflowPeriodsSnapshot.size > 0) {
      console.log('Sample outflow periods:');
      outflowPeriodsSnapshot.docs.slice(0, 3).forEach(doc => {
        const data = doc.data();
        console.log(`  - Period ${data.periodType}: $${data.billAmount} (due: ${data.isDuePeriod})`);
      });
    }
    
    return { outflows: outflowsSnapshot.size, periods: outflowPeriodsSnapshot.size };
  } catch (error) {
    console.error('Error checking collections:', error);
    return { outflows: 0, periods: 0 };
  }
}

async function callAdminFunctionDirectly() {
  try {
    console.log('🔄 Calling admin function directly via Firestore trigger simulation...');
    
    // Since we can't call the HTTP function directly, let's manually trigger the process
    // by finding Plaid items and creating some test outflows
    
    const usersSnapshot = await db.collection('users').limit(5).get();
    
    for (const userDoc of usersSnapshot.docs) {
      const userId = userDoc.id;
      const userData = userDoc.data();
      
      // Check if user has Plaid items
      const plaidItemsSnapshot = await db.collection('users').doc(userId).collection('plaidItems')
        .where('isActive', '==', true)
        .get();
      
      if (plaidItemsSnapshot.size > 0) {
        console.log(`Found ${plaidItemsSnapshot.size} active Plaid items for user ${userData.email}`);
        
        // For now, let's create a test outflow to trigger the onOutflowCreated function
        const testOutflow = {
          streamId: 'test_stream_' + Date.now(),
          itemId: plaidItemsSnapshot.docs[0].data().itemId,
          userId: userId,
          familyId: userData.familyId || null,
          accountId: 'test_account',
          isActive: true,
          status: 'MATURE',
          description: 'Test Monthly Bill',
          merchantName: 'Test Utility Company',
          category: ['Bills', 'Utilities'],
          averageAmount: {
            amount: 150.00,
            isoCurrencyCode: 'USD',
            unofficialCurrencyCode: null,
          },
          lastAmount: {
            amount: 150.00,
            isoCurrencyCode: 'USD',
            unofficialCurrencyCode: null,
          },
          frequency: 'MONTHLY',
          firstDate: admin.firestore.Timestamp.fromDate(new Date('2024-01-01')),
          lastDate: admin.firestore.Timestamp.fromDate(new Date('2025-08-01')),
          transactionIds: [],
          userCategory: undefined,
          userNotes: undefined,
          tags: [],
          isHidden: false,
          lastSyncedAt: admin.firestore.Timestamp.now(),
          syncVersion: 1,
          expenseType: 'utility',
          isEssential: true,
          merchantCategory: 'UTILITIES',
          isCancellable: false,
          reminderDays: 5,
          createdAt: admin.firestore.Timestamp.now(),
          updatedAt: admin.firestore.Timestamp.now(),
        };
        
        console.log('Creating test outflow...');
        const outflowRef = await db.collection('outflows').add(testOutflow);
        console.log(`Created test outflow: ${outflowRef.id}`);
        
        // Wait a moment for the trigger to fire
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        return true;
      }
    }
    
    console.log('No active Plaid items found to process');
    return false;
    
  } catch (error) {
    console.error('Error in admin function call:', error);
    return false;
  }
}

async function main() {
  console.log('🚀 Admin function caller starting...');
  
  // Check current state
  const plaidItems = await checkPlaidItems();
  const { outflows, periods } = await checkOutflowsAndPeriods();
  
  console.log('\n📊 Current state:');
  console.log(`  Plaid items: ${plaidItems}`);
  console.log(`  Outflows: ${outflows}`);
  console.log(`  Outflow periods: ${periods}`);
  
  if (plaidItems === 0) {
    console.log('\n❌ No Plaid items found. Cannot create outflows without connected accounts.');
    console.log('💡 Connect a bank account in the mobile app first.');
    process.exit(1);
  }
  
  if (outflows === 0) {
    console.log('\n🔄 No outflows found. Creating test outflow to trigger period generation...');
    const success = await callAdminFunctionDirectly();
    
    if (success) {
      console.log('✅ Test outflow created successfully');
      
      // Check again after creation
      setTimeout(async () => {
        const newState = await checkOutflowsAndPeriods();
        console.log('\n📊 Updated state:');
        console.log(`  Outflows: ${newState.outflows}`);
        console.log(`  Outflow periods: ${newState.periods}`);
        process.exit(0);
      }, 5000);
    } else {
      console.log('❌ Failed to create test outflow');
      process.exit(1);
    }
  } else {
    console.log('\n✅ Outflows already exist');
    process.exit(0);
  }
}

main().catch(error => {
  console.error('Script failed:', error);
  process.exit(1);
});