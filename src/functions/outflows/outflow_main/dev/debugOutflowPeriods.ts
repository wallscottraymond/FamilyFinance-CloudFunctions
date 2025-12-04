/**
 * Debug Outflow Periods - Admin Function
 * Query outflow_periods collection to see what data exists
 */

import { onRequest } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { initializeApp, getApps } from 'firebase-admin/app';

// Initialize Firebase Admin if not already initialized
if (getApps().length === 0) {
  initializeApp();
}

const db = getFirestore();

export const debugOutflowPeriods = onRequest({
  cors: true,
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (req, res) => {
  try {
    console.log('🔍 Debugging outflow_periods collection...');

    // Query all outflow periods (limit 30 to show more results)
    const outflowPeriodsSnapshot = await db.collection('outflow_periods')
      .limit(30)
      .get();

    const results = {
      total: outflowPeriodsSnapshot.size,
      periods: [] as any[],
      users: new Set<string>(),
      currentPeriods: [] as any[],
    };

    const now = new Date();
    console.log(`Current time: ${now.toISOString()}`);

    outflowPeriodsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const periodStart = data.periodStartDate?.toDate();
      const periodEnd = data.periodEndDate?.toDate();
      
      results.users.add(data.userId);
      
      const periodInfo = {
        id: doc.id,
        userId: data.userId,
        outflowId: data.outflowId,
        billAmount: data.billAmount,
        periodStartDate: periodStart?.toISOString(),
        periodEndDate: periodEnd?.toISOString(),
        isDuePeriod: data.isDuePeriod,
        isActive: data.isActive,
        isCurrent: periodStart && periodEnd && periodStart <= now && periodEnd >= now,
        // Show the critical fields for subscription queries
        periodId: data.periodId,
        sourcePeriodId: data.sourcePeriodId,
        hasFields: {
          periodId: data.periodId !== undefined,
          sourcePeriodId: data.sourcePeriodId !== undefined,
          userId: data.userId !== undefined,
          isActive: data.isActive !== undefined,
        }
      };
      
      results.periods.push(periodInfo);
      
      if (periodInfo.isCurrent) {
        results.currentPeriods.push(periodInfo);
      }
    });

    console.log(`Found ${results.total} outflow periods for ${results.users.size} users`);
    console.log(`Current periods: ${results.currentPeriods.length}`);
    console.log('Users:', Array.from(results.users));

    // Also query specifically for the current user  
    const currentUserId = 'IKzBkwEZb6MdJkdDVnVyTFAFj5i1';
    const currentUserSnapshot = await db.collection('outflow_periods')
      .where('userId', '==', currentUserId)
      .get();
    
    console.log(`Found ${currentUserSnapshot.size} outflow periods for current user: ${currentUserId}`);
    
    const currentUserResults = {
      userId: currentUserId,
      count: currentUserSnapshot.size,
      periods: [] as any[]
    };
    
    currentUserSnapshot.docs.forEach(doc => {
      const data = doc.data();
      currentUserResults.periods.push({
        id: doc.id,
        periodId: data.periodId,
        sourcePeriodId: data.sourcePeriodId,
        billAmount: data.billAmount,
        outflowId: data.outflowId,
        description: data.outflowDescription || 'N/A'
      });
    });

    res.status(200).json({
      success: true,
      data: {
        ...results,
        users: Array.from(results.users), // Convert Set to Array for JSON
        currentUserResults, // Add current user specific results
      }
    });
  } catch (error) {
    console.error('Error debugging outflow periods:', error);
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});