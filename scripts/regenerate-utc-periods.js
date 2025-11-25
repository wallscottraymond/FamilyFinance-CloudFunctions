#!/usr/bin/env node

const admin = require('firebase-admin');

// Initialize Firebase Admin SDK using application default credentials
admin.initializeApp({
  projectId: 'family-budget-app-cb59b'
});

const db = admin.firestore();

async function regenerateUTCPeriods() {
  console.log('🔄 Regenerating source periods with UTC+0 timezone...');
  
  try {    
    // Clear existing periods
    console.log('🔄 Clearing existing periods...');
    const existingPeriodsSnapshot = await db.collection('source_periods').get();
    const batch = db.batch();
    
    existingPeriodsSnapshot.docs.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    console.log(`🗑️  Cleared ${existingPeriodsSnapshot.size} existing periods`);
    
    // Generate new UTC periods
    console.log('🔄 Generating new UTC+0 periods...');
    await generateUTCPeriods();
    
    console.log('✅ Source periods regenerated successfully with UTC+0 timezone!');
    
  } catch (error) {
    console.error('❌ Error regenerating periods:', error);
    throw error;
  }
}

async function generateUTCPeriods() {
  const periods = [];
  const today = new Date();
  
  // Generate periods from 2023 to 2033
  for (let year = 2023; year <= 2033; year++) {
    // Generate monthly periods (UTC+0)
    for (let month = 1; month <= 12; month++) {
      const startDate = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
      const endDate = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)); // Last day of month
      
      const monthlyPeriod = {
        id: `${year}M${month.toString().padStart(2, '0')}`,
        periodId: `${year}M${month.toString().padStart(2, '0')}`,
        type: 'monthly',
        startDate: admin.firestore.Timestamp.fromDate(startDate),
        endDate: admin.firestore.Timestamp.fromDate(endDate),
        year,
        index: parseInt(`${year}${month.toString().padStart(2, '0')}`),
        isCurrent: isCurrentPeriod(startDate, endDate, today, 'monthly'),
        metadata: {
          month,
          weekStartDay: 0
        }
      };

      periods.push(monthlyPeriod);

      // Generate bi-monthly periods (1st-15th, 16th-end) (UTC+0)
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
        isCurrent: isCurrentPeriod(startDate, firstHalfEnd, today, 'bi_monthly'),
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
        isCurrent: isCurrentPeriod(secondHalfStart, endDate, today, 'bi_monthly'),
        metadata: {
          month,
          biMonthlyHalf: 2,
          weekStartDay: 0
        }
      };

      periods.push(biMonthlyFirstHalf, biMonthlySecondHalf);
    }

    // Generate weekly periods (Sunday start) (UTC+0)
    const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));
    
    // Find the first Sunday of the year or the first day if it's Sunday (UTC)
    let currentWeekStart = new Date(yearStart.getTime());
    while (currentWeekStart.getUTCDay() !== 0) {
      currentWeekStart.setUTCDate(currentWeekStart.getUTCDate() - 1);
    }

    let weekNumber = 1;
    while (currentWeekStart.getUTCFullYear() === year || currentWeekStart < yearEnd) {
      const weekEnd = new Date(currentWeekStart.getTime());
      weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
      weekEnd.setUTCHours(23, 59, 59, 999);

      // Only include weeks that have some days in the current year (UTC)
      if (weekEnd.getUTCFullYear() >= year && currentWeekStart.getUTCFullYear() <= year) {
        // Get the ISO week number for better accuracy
        const isoWeekNumber = getISOWeekNumber(currentWeekStart);
        
        const weeklyPeriod = {
          id: `${year}W${weekNumber.toString().padStart(2, '0')}`,
          periodId: `${year}W${weekNumber.toString().padStart(2, '0')}`,
          type: 'weekly',
          startDate: admin.firestore.Timestamp.fromDate(currentWeekStart),
          endDate: admin.firestore.Timestamp.fromDate(weekEnd),
          year,
          index: parseInt(`${year}${weekNumber.toString().padStart(3, '0')}`),
          isCurrent: isCurrentPeriod(currentWeekStart, weekEnd, today, 'weekly'),
          metadata: {
            weekNumber: isoWeekNumber,
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
    console.log(`💾 Saved batch ${Math.floor(i / batchSize) + 1} (${batchPeriods.length} periods)`);
  }
  
  console.log(`✅ Generated ${periods.length} total periods (2023-2033)`);
}

// Helper functions
function isCurrentPeriod(startDate, endDate, today, type) {
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

// Run the script
if (require.main === module) {
  regenerateUTCPeriods()
    .then(() => {
      console.log('🎉 Script completed successfully!');
      process.exit(0);
    })
    .catch((error) => {
      console.error('💥 Script failed:', error);
      process.exit(1);
    });
}

module.exports = { regenerateUTCPeriods };