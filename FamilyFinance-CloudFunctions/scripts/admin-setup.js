#!/usr/bin/env node

/**
 * Alternative script using Firebase CLI authentication
 * This script uses the same Firebase auth context as the CLI
 */

const admin = require('firebase-admin');

// Initialize Firebase Admin with default credentials
// This will use the same authentication as Firebase CLI
admin.initializeApp({
  projectId: 'family-budget-app-cb59b'
});

const db = admin.firestore();
const auth = admin.auth();

async function updateUserToAdmin(userId) {
  try {
    console.log(`🔍 Checking if user ${userId} exists...`);
    
    // Check if user exists in Auth
    let authUser;
    try {
      authUser = await auth.getUser(userId);
      console.log(`✅ User found in Auth: ${authUser.email}`);
    } catch (error) {
      console.error(`❌ User ${userId} not found in Firebase Auth`);
      return false;
    }
    
    // Check if user exists in Firestore
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      console.log(`⚠️  User ${userId} not found in Firestore, creating profile...`);
      
      // Create user profile in Firestore
      const newUserData = {
        email: authUser.email,
        displayName: authUser.displayName || authUser.email.split('@')[0],
        photoURL: authUser.photoURL || null,
        role: 'admin',
        preferences: {
          currency: 'USD',
          locale: 'en-US',
          notifications: {
            email: true,
            push: true,
            transactionAlerts: true,
            budgetAlerts: true,
            weeklyReports: true,
            monthlyReports: true,
            goalReminders: true,
            billReminders: true,
            accountBalanceAlerts: true,
            suspiciousActivityAlerts: true,
            familyInvitations: true
          },
          theme: 'auto',
          privacy: {
            shareSpendingWithFamily: true,
            shareGoalsWithFamily: true,
            allowFamilyToSeeTransactionDetails: true,
            showProfileToFamilyMembers: true,
            dataRetentionPeriod: 2555, // 7 years
            allowAnalytics: true,
            allowMarketingEmails: false
          },
          display: {
            dateFormat: 'MM/DD/YYYY',
            timeFormat: '12h',
            numberFormat: 'US',
            showCentsInDisplays: true,
            defaultTransactionView: 'list',
            chartPreferences: {
              defaultChartType: 'line',
              showGridLines: true,
              animateCharts: true,
              colorScheme: 'default'
            },
            dashboardLayout: ['overview', 'recent-transactions', 'budgets', 'goals']
          },
          accessibility: {
            fontSize: 'medium',
            highContrast: false,
            reduceMotion: false,
            screenReaderOptimized: false,
            voiceOverEnabled: false,
            hapticFeedback: true,
            longPressDelay: 500
          },
          financial: {
            defaultTransactionCategory: 'other_expense',
            autoCategorizationEnabled: true,
            roundUpSavings: false,
            budgetStartDay: 1,
            showNetWorth: true,
            hiddenAccounts: [],
            defaultBudgetAlertThreshold: 80,
            enableSpendingLimits: false
          },
          security: {
            biometricAuthEnabled: false,
            pinAuthEnabled: false,
            autoLockTimeout: 15,
            requireAuthForTransactions: false,
            requireAuthForBudgetChanges: false,
            requireAuthForGoalChanges: false,
            sessionTimeout: 480,
            allowedDevices: [],
            twoFactorAuthEnabled: false,
            suspiciousActivityDetection: true
          }
        },
        isActive: true,
        createdAt: admin.firestore.Timestamp.now(),
        updatedAt: admin.firestore.Timestamp.now()
      };
      
      await db.collection('users').doc(userId).set(newUserData);
      console.log('✅ User profile created in Firestore');
    } else {
      const userData = userDoc.data();
      console.log(`✅ User found in Firestore: ${userData.email} (${userData.displayName})`);
      console.log(`   Current role: ${userData.role}`);
      
      if (userData.role === 'admin') {
        console.log('✅ User is already an admin');
      } else {
        console.log('🔧 Updating user role to admin...');
        
        // Update Firestore document
        await db.collection('users').doc(userId).update({
          role: 'admin',
          updatedAt: admin.firestore.Timestamp.now()
        });
        
        console.log('✅ User role updated to admin in Firestore');
      }
    }
    
    // Update custom claims
    console.log('🔧 Setting custom claims...');
    await auth.setCustomUserClaims(userId, {
      role: 'admin'
    });
    
    // Revoke existing tokens to force refresh
    await auth.revokeRefreshTokens(userId);
    
    console.log('✅ User setup completed successfully');
    console.log(`   Email: ${authUser.email}`);
    console.log(`   Display Name: ${authUser.displayName || 'Not set'}`);
    console.log(`   Role: admin`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Error updating user to admin:', error);
    return false;
  }
}

async function testFirestoreConnection() {
  try {
    console.log('🔍 Testing Firestore connection...');
    const testDoc = await db.collection('users').limit(1).get();
    console.log('✅ Firestore connection successful');
    return true;
  } catch (error) {
    console.error('❌ Firestore connection failed:', error);
    return false;
  }
}

async function callGenerateSourcePeriodsFunction() {
  try {
    console.log('🔧 Calling generateSourcePeriods function...');
    
    // Get the current user's ID token for authentication
    // Since we're running as admin, we'll directly call the function logic
    
    const sourcePeriodsRef = db.collection('source_periods');
    
    // Check if periods already exist
    const existingPeriods = await sourcePeriodsRef.limit(1).get();
    if (!existingPeriods.empty) {
      console.log('⚠️  Source periods already exist. Clearing them first...');
      
      // Clear existing periods
      const allPeriods = await sourcePeriodsRef.get();
      const batch = db.batch();
      
      allPeriods.docs.forEach(doc => {
        batch.delete(doc.ref);
      });
      
      if (allPeriods.docs.length > 0) {
        await batch.commit();
        console.log(`   Deleted ${allPeriods.docs.length} existing periods`);
      }
    }
    
    // Generate periods (same logic as the Cloud Function)
    const periods = [];
    const today = new Date();
    
    console.log('   Generating periods from 2023 to 2033...');
    
    // Generate periods from 2023 to 2033
    for (let year = 2023; year <= 2033; year++) {
      // Generate monthly periods
      for (let month = 1; month <= 12; month++) {
        const startDate = new Date(year, month - 1, 1);
        const endDate = new Date(year, month - 1 + 1, 0, 23, 59, 59, 999);
        
        const monthlyPeriod = {
          id: `${year}M${month.toString().padStart(2, '0')}`,
          periodId: `${year}M${month.toString().padStart(2, '0')}`,
          type: 'monthly',
          startDate: admin.firestore.Timestamp.fromDate(startDate),
          endDate: admin.firestore.Timestamp.fromDate(endDate),
          year,
          index: parseInt(`${year}${month.toString().padStart(2, '0')}`),
          isCurrent: isCurrentPeriod(startDate, endDate, today),
          metadata: {
            month,
            weekStartDay: 0
          }
        };
        
        periods.push(monthlyPeriod);
        
        // Generate bi-monthly periods
        const firstHalfEnd = new Date(year, month - 1, 15, 23, 59, 59, 999);
        const secondHalfStart = new Date(year, month - 1, 16);
        
        periods.push({
          id: `${year}BM${month.toString().padStart(2, '0')}A`,
          periodId: `${year}BM${month.toString().padStart(2, '0')}A`,
          type: 'bi_monthly',
          startDate: admin.firestore.Timestamp.fromDate(startDate),
          endDate: admin.firestore.Timestamp.fromDate(firstHalfEnd),
          year,
          index: parseInt(`${year}${month.toString().padStart(2, '0')}1`),
          isCurrent: isCurrentPeriod(startDate, firstHalfEnd, today),
          metadata: {
            month,
            biMonthlyHalf: 1,
            weekStartDay: 0
          }
        });
        
        periods.push({
          id: `${year}BM${month.toString().padStart(2, '0')}B`,
          periodId: `${year}BM${month.toString().padStart(2, '0')}B`,
          type: 'bi_monthly',
          startDate: admin.firestore.Timestamp.fromDate(secondHalfStart),
          endDate: admin.firestore.Timestamp.fromDate(endDate),
          year,
          index: parseInt(`${year}${month.toString().padStart(2, '0')}2`),
          isCurrent: isCurrentPeriod(secondHalfStart, endDate, today),
          metadata: {
            month,
            biMonthlyHalf: 2,
            weekStartDay: 0
          }
        });
      }
      
      // Generate weekly periods (simplified)
      const yearStart = new Date(year, 0, 1);
      let currentWeekStart = new Date(yearStart);
      
      // Find first Sunday
      while (currentWeekStart.getDay() !== 0) {
        currentWeekStart.setDate(currentWeekStart.getDate() - 1);
      }
      
      let weekNumber = 1;
      const yearEnd = new Date(year, 11, 31);
      
      while (currentWeekStart.getFullYear() === year || currentWeekStart < yearEnd) {
        const weekEnd = new Date(currentWeekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        
        if (weekEnd.getFullYear() >= year && currentWeekStart.getFullYear() <= year) {
          periods.push({
            id: `${year}W${weekNumber.toString().padStart(2, '0')}`,
            periodId: `${year}W${weekNumber.toString().padStart(2, '0')}`,
            type: 'weekly',
            startDate: admin.firestore.Timestamp.fromDate(currentWeekStart),
            endDate: admin.firestore.Timestamp.fromDate(weekEnd),
            year,
            index: parseInt(`${year}${weekNumber.toString().padStart(2, '0')}`),
            isCurrent: isCurrentPeriod(currentWeekStart, weekEnd, today),
            metadata: {
              weekNumber,
              weekStartDay: 0
            }
          });
          weekNumber++;
        }
        
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
      }
    }
    
    // Save periods in batches
    const now = admin.firestore.Timestamp.now();
    const batchSize = 500;
    let batchCount = 0;
    
    for (let i = 0; i < periods.length; i += batchSize) {
      const batch = db.batch();
      const batchPeriods = periods.slice(i, i + batchSize);
      
      batchPeriods.forEach(period => {
        const docRef = sourcePeriodsRef.doc(period.id);
        const fullPeriod = {
          ...period,
          createdAt: now,
          updatedAt: now
        };
        batch.set(docRef, fullPeriod);
      });
      
      await batch.commit();
      batchCount++;
      console.log(`   Batch ${batchCount} committed (${batchPeriods.length} periods)`);
    }
    
    const summary = {
      totalPeriods: periods.length,
      byType: {
        monthly: periods.filter(p => p.type === 'monthly').length,
        weekly: periods.filter(p => p.type === 'weekly').length,
        biMonthly: periods.filter(p => p.type === 'bi_monthly').length
      },
      currentPeriods: periods.filter(p => p.isCurrent).length,
      yearRange: '2023-2033'
    };
    
    console.log('✅ Source periods generated successfully!');
    console.log('   Summary:');
    console.log(`     Total periods: ${summary.totalPeriods}`);
    console.log(`     Monthly: ${summary.byType.monthly}`);
    console.log(`     Weekly: ${summary.byType.weekly}`);
    console.log(`     Bi-monthly: ${summary.byType.biMonthly}`);
    console.log(`     Current periods: ${summary.currentPeriods}`);
    console.log(`     Year range: ${summary.yearRange}`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Error calling generateSourcePeriods:', error);
    return false;
  }
}

function isCurrentPeriod(startDate, endDate, today) {
  return today >= startDate && today <= endDate;
}

async function main() {
  const userId = 'HIXw4Pp4FpX72aHU4BHbF9o54no1';
  
  console.log('🚀 Starting admin setup and source period generation...');
  console.log(`   Target user ID: ${userId}`);
  console.log(`   Project: family-budget-app-cb59b`);
  console.log('');
  
  // Test connection first
  const connectionOk = await testFirestoreConnection();
  if (!connectionOk) {
    console.error('❌ Cannot connect to Firestore. Make sure you are logged in with Firebase CLI:');
    console.log('   firebase login');
    process.exit(1);
  }
  
  console.log('');
  
  // Step 1: Update user to admin
  const userUpdateSuccess = await updateUserToAdmin(userId);
  
  if (!userUpdateSuccess) {
    console.error('❌ Failed to update user to admin. Aborting.');
    process.exit(1);
  }
  
  console.log('');
  
  // Step 2: Generate source periods
  const periodsSuccess = await callGenerateSourcePeriodsFunction();
  
  if (!periodsSuccess) {
    console.error('❌ Failed to generate source periods.');
    process.exit(1);
  }
  
  console.log('');
  console.log('🎉 All tasks completed successfully!');
  console.log('   1. User updated to admin role (with custom claims)');
  console.log('   2. Source periods generated for 2023-2033');
  console.log('');
  console.log('📋 Next steps:');
  console.log('   - The user can now access admin functions');
  console.log('   - All budget periods are available for selection');
  console.log('   - The user should log out and back in to refresh their tokens');
  
  process.exit(0);
}

// Run the script
main().catch(error => {
  console.error('❌ Script failed:', error);
  console.error('');
  console.log('🔧 Troubleshooting:');
  console.log('   1. Make sure you are logged in: firebase login');
  console.log('   2. Make sure you have admin access to the project');
  console.log('   3. Check that the user ID is correct');
  process.exit(1);
});