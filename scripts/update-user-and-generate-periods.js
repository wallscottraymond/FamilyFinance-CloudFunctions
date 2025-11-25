#!/usr/bin/env node

/**
 * Script to update a user to admin role and generate source periods
 * This bypasses the normal authentication flow for administrative setup
 */

const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin SDK
const serviceAccountPath = path.join(__dirname, '../service-account-key.json');
if (!fs.existsSync(serviceAccountPath)) {
  console.error('❌ Service account key not found at:', serviceAccountPath);
  console.log('   Please download the service account key from Firebase Console');
  console.log('   and place it at: scripts/service-account-key.json');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(require(serviceAccountPath)),
  databaseURL: 'https://familyfinance-bc0ab-default-rtdb.firebaseio.com'
});

const db = admin.firestore();
const auth = admin.auth();

async function updateUserToAdmin(userId) {
  try {
    console.log(`🔍 Checking if user ${userId} exists...`);
    
    // Check if user exists in Firestore
    const userDoc = await db.collection('users').doc(userId).get();
    
    if (!userDoc.exists) {
      console.error(`❌ User ${userId} not found in Firestore`);
      return false;
    }
    
    const userData = userDoc.data();
    console.log(`✅ User found: ${userData.email} (${userData.displayName})`);
    console.log(`   Current role: ${userData.role}`);
    
    if (userData.role === 'admin') {
      console.log('✅ User is already an admin');
      return true;
    }
    
    console.log('🔧 Updating user role to admin...');
    
    // Update Firestore document
    await db.collection('users').doc(userId).update({
      role: 'admin',
      updatedAt: admin.firestore.Timestamp.now()
    });
    
    // Update custom claims
    await auth.setCustomUserClaims(userId, {
      role: 'admin',
      familyId: userData.familyId || null
    });
    
    // Revoke existing tokens to force refresh
    await auth.revokeRefreshTokens(userId);
    
    console.log('✅ User role updated to admin successfully');
    console.log(`   Email: ${userData.email}`);
    console.log(`   Display Name: ${userData.displayName}`);
    console.log(`   Family ID: ${userData.familyId || 'None'}`);
    
    return true;
    
  } catch (error) {
    console.error('❌ Error updating user role:', error);
    return false;
  }
}

async function generateSourcePeriods() {
  try {
    console.log('🔧 Generating source periods...');
    
    const sourcePeriodsRef = db.collection('source_periods');
    
    // Clear existing periods first
    console.log('   Clearing existing periods...');
    const existingPeriods = await sourcePeriodsRef.get();
    const batch = db.batch();
    
    existingPeriods.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    if (existingPeriods.docs.length > 0) {
      await batch.commit();
      console.log(`   Deleted ${existingPeriods.docs.length} existing periods`);
    }
    
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
        
        // Generate bi-monthly periods (1st-15th, 16th-end)
        const firstHalfEnd = new Date(year, month - 1, 15, 23, 59, 59, 999);
        const secondHalfStart = new Date(year, month - 1, 16);
        
        const biMonthlyFirstHalf = {
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
        };
        
        const biMonthlySecondHalf = {
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
        };
        
        periods.push(biMonthlyFirstHalf, biMonthlySecondHalf);
      }
      
      // Generate weekly periods (Sunday start)
      const yearStart = new Date(year, 0, 1);
      const yearEnd = new Date(year, 11, 31);
      
      // Find the first Sunday of the year or the first day if it's Sunday
      let currentWeekStart = new Date(yearStart);
      while (currentWeekStart.getDay() !== 0) {
        currentWeekStart.setDate(currentWeekStart.getDate() - 1);
      }
      
      let weekNumber = 1;
      while (currentWeekStart.getFullYear() === year || currentWeekStart < yearEnd) {
        const weekEnd = new Date(currentWeekStart);
        weekEnd.setDate(weekEnd.getDate() + 6);
        weekEnd.setHours(23, 59, 59, 999);
        
        // Only include weeks that have some days in the current year
        if (weekEnd.getFullYear() >= year && currentWeekStart.getFullYear() <= year) {
          const isoWeekNumber = getISOWeekNumber(currentWeekStart);
          
          const weeklyPeriod = {
            id: `${year}W${weekNumber.toString().padStart(2, '0')}`,
            periodId: `${year}W${weekNumber.toString().padStart(2, '0')}`,
            type: 'weekly',
            startDate: admin.firestore.Timestamp.fromDate(currentWeekStart),
            endDate: admin.firestore.Timestamp.fromDate(weekEnd),
            year,
            index: parseInt(`${year}${weekNumber.toString().padStart(2, '0')}`),
            isCurrent: isCurrentPeriod(currentWeekStart, weekEnd, today),
            metadata: {
              weekNumber: isoWeekNumber,
              weekStartDay: 0
            }
          };
          
          periods.push(weeklyPeriod);
          weekNumber++;
        }
        
        currentWeekStart.setDate(currentWeekStart.getDate() + 7);
      }
    }
    
    // Add all periods to Firestore in batches (Firestore batch limit is 500)
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
    console.error('❌ Error generating source periods:', error);
    return false;
  }
}

function isCurrentPeriod(startDate, endDate, today) {
  return today >= startDate && today <= endDate;
}

function getISOWeekNumber(date) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getDay() + 6) % 7;
  target.setDate(target.getDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setMonth(0, 1);
  if (target.getDay() !== 4) {
    target.setMonth(0, 1 + ((4 - target.getDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target.valueOf()) / 604800000);
}

async function main() {
  const userId = 'HIXw4Pp4FpX72aHU4BHbF9o54no1';
  
  console.log('🚀 Starting user update and source period generation...');
  console.log(`   Target user ID: ${userId}`);
  console.log('');
  
  // Step 1: Update user to admin
  const userUpdateSuccess = await updateUserToAdmin(userId);
  
  if (!userUpdateSuccess) {
    console.error('❌ Failed to update user to admin. Aborting.');
    process.exit(1);
  }
  
  console.log('');
  
  // Step 2: Generate source periods
  const periodsSuccess = await generateSourcePeriods();
  
  if (!periodsSuccess) {
    console.error('❌ Failed to generate source periods.');
    process.exit(1);
  }
  
  console.log('');
  console.log('🎉 All tasks completed successfully!');
  console.log('   1. User updated to admin role');
  console.log('   2. Source periods generated');
  
  process.exit(0);
}

// Run the script
main().catch(error => {
  console.error('❌ Script failed:', error);
  process.exit(1);
});