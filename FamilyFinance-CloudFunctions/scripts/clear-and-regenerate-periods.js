#!/usr/bin/env node

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');

// Initialize with environment variable for service account
const admin = require('firebase-admin');

// Try to initialize with existing app or create new one
let app;
try {
  app = admin.app();
} catch (error) {
  app = admin.initializeApp({
    projectId: 'family-budget-app-cb59b'
  });
}

const db = getFirestore(app);

async function clearAllSourcePeriods() {
  console.log('🗑️  Deleting all source periods...');
  
  try {
    const sourcePeriodsRef = db.collection('source_periods');
    const snapshot = await sourcePeriodsRef.get();
    
    if (snapshot.empty) {
      console.log('✅ No periods to delete');
      return;
    }
    
    console.log(`Found ${snapshot.size} periods to delete`);
    
    // Delete in batches of 500 (Firestore limit)
    const batchSize = 500;
    let batch = db.batch();
    let operationCount = 0;
    
    for (const doc of snapshot.docs) {
      batch.delete(doc.ref);
      operationCount++;
      
      if (operationCount === batchSize) {
        await batch.commit();
        console.log(`Deleted batch of ${operationCount} periods`);
        batch = db.batch();
        operationCount = 0;
      }
    }
    
    // Commit remaining operations
    if (operationCount > 0) {
      await batch.commit();
      console.log(`Deleted final batch of ${operationCount} periods`);
    }
    
    console.log('✅ All source periods deleted successfully');
    
  } catch (error) {
    console.error('❌ Error deleting periods:', error);
    throw error;
  }
}

async function generateUTCPeriods() {
  console.log('🔄 Generating new UTC+0 source periods...');
  
  try {
    const periods = [];
    const today = new Date();
    
    // Generate periods from 2023 to 2033
    for (let year = 2023; year <= 2033; year++) {
      console.log(`Generating periods for ${year}...`);
      
      // Generate monthly periods (UTC+0)
      for (let month = 1; month <= 12; month++) {
        const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
        const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
        
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

        // Generate bi-monthly periods (UTC+0)
        const firstHalfEnd = new Date(Date.UTC(year, month - 1, 15, 23, 59, 59, 999));
        const secondHalfStart = new Date(Date.UTC(year, month - 1, 16, 0, 0, 0, 0));

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

      // Generate weekly periods (Sunday start, UTC+0)
      const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
      const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
      
      // Find the first Sunday of the year (UTC)
      let currentWeekStart = new Date(yearStart.getTime());
      while (currentWeekStart.getUTCDay() !== 0) {
        currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - 1);
      }

      let weekNumber = 1;
      while (currentWeekStart.getUTCFullYear() === year || currentWeekStart < yearEnd) {
        const weekEnd = new Date(currentWeekStart.getTime());
        weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
        weekEnd.setUTCHours(23, 59, 59, 999);

        // Only include weeks that have some days in the current year
        if (weekEnd.getUTCFullYear() >= year && currentWeekStart.getUTCFullYear() <= year) {
          const weeklyPeriod = {
            id: `${year}W${weekNumber.toString().padStart(2, '0')}`,
            periodId: `${year}W${weekNumber.toString().padStart(2, '0')}`,
            type: 'weekly',
            startDate: admin.firestore.Timestamp.fromDate(currentWeekStart),
            endDate: admin.firestore.Timestamp.fromDate(weekEnd),
            year,
            index: parseInt(`${year}${weekNumber.toString().padStart(3, '0')}`),
            isCurrent: isCurrentPeriod(currentWeekStart, weekEnd, today),
            metadata: {
              weekNumber: getISOWeekNumber(currentWeekStart),
              weekStartDay: 0
            }
          };

          periods.push(weeklyPeriod);
          weekNumber++;
        }

        currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() + 7);
      }
    }

    // Save periods in batches
    console.log(`💾 Saving ${periods.length} periods to Firestore...`);
    const batchSize = 500;
    const now = admin.firestore.Timestamp.now();
    
    for (let i = 0; i < periods.length; i += batchSize) {
      const batch = db.batch();
      const batchPeriods = periods.slice(i, i + batchSize);
      
      batchPeriods.forEach(period => {
        const docRef = db.collection('source_periods').doc(period.id);
        const fullPeriod = {
          ...period,
          createdAt: now,
          updatedAt: now
        };
        batch.set(docRef, fullPeriod);
      });
      
      await batch.commit();
      console.log(`💾 Saved batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(periods.length / batchSize)} (${batchPeriods.length} periods)`);
    }
    
    console.log(`✅ Generated ${periods.length} total UTC+0 periods (2023-2033)`);
    
    // Show sample of what was created
    console.log('\n📋 Sample periods created:');
    const samplePeriods = periods.slice(0, 5);
    samplePeriods.forEach(period => {
      console.log(`  ${period.id}: ${period.startDate.toDate().toISOString()} - ${period.endDate.toDate().toISOString()}`);
    });
    
  } catch (error) {
    console.error('❌ Error generating periods:', error);
    throw error;
  }
}

// Helper functions
function isCurrentPeriod(startDate, endDate, today) {
  const startTime = startDate instanceof Date ? startDate.getTime() : startDate.toDate().getTime();
  const endTime = endDate instanceof Date ? endDate.getTime() : endDate.toDate().getTime();
  const todayTime = today.getTime();
  
  return todayTime >= startTime && todayTime <= endTime;
}

function getISOWeekNumber(date) {
  const target = new Date(date.valueOf());
  const dayNr = (date.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay()) + 7) % 7);
  }
  return 1 + Math.ceil((firstThursday - target) / 604800000);
}

// Main execution
async function main() {
  try {
    console.log('🚀 Starting fresh source periods generation...');
    console.log(`📅 Today is: ${new Date().toISOString()}`);
    
    await clearAllSourcePeriods();
    await generateUTCPeriods();
    
    console.log('🎉 Successfully cleared and regenerated all source periods with UTC+0!');
    process.exit(0);
    
  } catch (error) {
    console.error('💥 Script failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { clearAllSourcePeriods, generateUTCPeriods };