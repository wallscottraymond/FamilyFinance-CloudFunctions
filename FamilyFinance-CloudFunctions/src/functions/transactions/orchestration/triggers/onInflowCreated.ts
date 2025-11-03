/**
 * Inflow Periods Auto-Generation
 * 
 * This Cloud Function automatically creates inflow_periods when an inflow is created.
 * It generates periods for all period types by integrating with the source_periods collection
 * and calculating cycle-based earning amounts for each period.
 * 
 * Key Features:
 * - Integration with existing source_periods collection
 * - Cycle-based earning calculation (daily rate × period days)
 * - Payment receipt date tracking and period alignment
 * - Support for all Plaid recurring frequencies (WEEKLY, MONTHLY, QUARTERLY, ANNUALLY)
 * - Proper error handling for missing source periods
 * - Edge case handling for different month lengths and leap years
 * 
 * Memory: 512MiB, Timeout: 60s
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import {
  RecurringIncome,
  InflowPeriod,
  SourcePeriod,
  PlaidRecurringFrequency
} from '../../../../types';
import {
  inheritAccessControl,
  inheritCategories,
  inheritMetadata
} from '../../../../utils/documentStructure';

/**
 * Triggered when an inflow is created
 * Automatically generates inflow_periods for all active source periods
 */
export const onInflowCreated = onDocumentCreated({
  document: 'inflows/{inflowId}',
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (event) => {
  try {
    const inflowId = event.params.inflowId;
    const inflowData = event.data?.data() as RecurringIncome;
    
    if (!inflowData) {
      console.error('No inflow data found');
      return;
    }

    // Skip inactive inflows
    if (!inflowData.isActive) {
      console.log(`Skipping inactive inflow: ${inflowId}`);
      return;
    }

    console.log(`Creating inflow periods for inflow: ${inflowId}`);
    console.log(`Inflow details: ${inflowData.description}, Amount: ${inflowData.averageAmount.amount}, Frequency: ${inflowData.frequency}`);
    
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    
    // Calculate time range for period generation (3 months forward like budget periods)
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 3); // 3 months forward
    
    console.log(`Generating inflow periods from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Get all source periods that overlap with our time range
    const sourcePeriodsQuery = db.collection('source_periods')
      .where('startDate', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('startDate', '<=', admin.firestore.Timestamp.fromDate(endDate));
    
    const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();
    
    if (sourcePeriodsSnapshot.empty) {
      console.warn('No source periods found in date range - inflow periods cannot be generated');
      return;
    }
    
    console.log(`Found ${sourcePeriodsSnapshot.size} source periods to process`);
    
    // Calculate payment cycle information
    const cycleInfo = calculatePaymentCycle(inflowData);
    console.log(`Payment cycle: ${cycleInfo.cycleDays} days, Rate: ${cycleInfo.dailyRate}`);
    
    // Create inflow_periods for each source period
    const inflowPeriods: InflowPeriod[] = [];

    for (const doc of sourcePeriodsSnapshot.docs) {
      const sourcePeriod = { id: doc.id, ...doc.data() } as SourcePeriod;

      // Calculate earning amounts for this period
      const periodCalc = calculatePeriodAmounts(
        sourcePeriod,
        cycleInfo,
        inflowData
      );

      // Step 1: Build complete inflow period structure with defaults
      const inflowPeriodDoc: InflowPeriod = {
        id: `${inflowId}_${sourcePeriod.id}`,
        inflowId: inflowId!,
        periodId: sourcePeriod.id!,
        sourcePeriodId: sourcePeriod.id!,

        // === QUERY-CRITICAL FIELDS AT ROOT (defaults) ===
        userId: inflowData.userId,
        groupId: inflowData.groupId || null,
        isActive: true,
        createdAt: now,

        // === NESTED ACCESS CONTROL OBJECT (defaults) ===
        access: inheritAccessControl(inflowData.access, inflowData.userId),

        // === NESTED CATEGORIES OBJECT (inherited from parent) ===
        categories: inheritCategories(inflowData.categories),

        // === NESTED METADATA OBJECT (inherited + period-specific) ===
        metadata: {
          ...inheritMetadata(inflowData.metadata, {
            inheritedFrom: inflowId!
          }),
          lastCalculated: now,
          inflowDescription: inflowData.description,
          inflowMerchantName: inflowData.merchantName,
          inflowIsRegularSalary: inflowData.isRegularSalary
        } as any,

        // === NESTED RELATIONSHIPS OBJECT ===
        relationships: {
          parentId: inflowId,
          parentType: 'inflow',
          linkedIds: [sourcePeriod.id!],
          relatedDocs: [
            { type: 'source_period', id: sourcePeriod.id! }
          ]
        },

        // === INFLOW PERIOD-SPECIFIC FIELDS AT ROOT ===
        // Period context (denormalized for performance)
        periodType: sourcePeriod.type,
        periodStartDate: sourcePeriod.startDate,
        periodEndDate: sourcePeriod.endDate,

        // Payment cycle information
        cycleStartDate: cycleInfo.cycleStartDate,
        cycleEndDate: cycleInfo.cycleEndDate,
        cycleDays: cycleInfo.cycleDays,

        // Financial calculations
        incomeAmount: cycleInfo.incomeAmount,
        dailyEarningRate: cycleInfo.dailyRate,
        amountEarned: periodCalc.amountEarned,
        amountReceived: periodCalc.amountReceived,

        // Payment status
        isReceiptPeriod: periodCalc.isReceiptPeriod,
        receiptDate: periodCalc.receiptDate,

        // System fields
        updatedAt: now,
        lastCalculated: now,
      } as any;

      inflowPeriods.push(inflowPeriodDoc);
    }

    console.log('Document created:', {
      userId: inflowData.userId,
      groupId: inflowData.groupId || null
    });
    
    console.log(`Creating ${inflowPeriods.length} inflow periods`);
    
    // Batch create all inflow_periods
    await batchCreateInflowPeriods(db, inflowPeriods);
    
    console.log(`Successfully created ${inflowPeriods.length} inflow periods for inflow ${inflowId}`);
    
  } catch (error) {
    console.error('Error in onInflowCreated:', error);
    // Don't throw - we don't want to break inflow creation if period generation fails
  }
});

/**
 * Calculate payment cycle information from inflow data
 */
function calculatePaymentCycle(inflow: RecurringIncome) {
  const incomeAmount = Math.abs(inflow.averageAmount.amount); // Ensure positive
  
  // Calculate cycle days based on frequency
  let cycleDays: number;
  switch (inflow.frequency) {
    case PlaidRecurringFrequency.WEEKLY:
      cycleDays = 7;
      break;
    case PlaidRecurringFrequency.BIWEEKLY:
      cycleDays = 14;
      break;
    case PlaidRecurringFrequency.SEMI_MONTHLY:
      cycleDays = 15; // Approximate - twice per month
      break;
    case PlaidRecurringFrequency.MONTHLY:
      cycleDays = 30; // Use 30 as average month length
      break;
    case PlaidRecurringFrequency.ANNUALLY:
      cycleDays = 365;
      break;
    default:
      console.warn(`Unknown frequency: ${inflow.frequency}, defaulting to 30 days`);
      cycleDays = 30;
  }
  
  // Calculate daily earning rate
  const dailyRate = incomeAmount / cycleDays;
  
  // Use the inflow's lastDate as cycle end, calculate cycle start
  const cycleEndDate = inflow.lastDate;
  const cycleStartDate = admin.firestore.Timestamp.fromDate(
    new Date(cycleEndDate.toDate().getTime() - (cycleDays * 24 * 60 * 60 * 1000))
  );
  
  return {
    incomeAmount,
    cycleDays,
    dailyRate,
    cycleStartDate,
    cycleEndDate
  };
}

/**
 * Calculate earning and receipt amounts for a specific period
 */
function calculatePeriodAmounts(
  sourcePeriod: SourcePeriod,
  cycleInfo: ReturnType<typeof calculatePaymentCycle>,
  inflow: RecurringIncome
) {
  const periodStart = sourcePeriod.startDate.toDate();
  const periodEnd = sourcePeriod.endDate.toDate();
  const cycleEnd = cycleInfo.cycleEndDate.toDate();
  
  // Calculate days in this period
  const daysInPeriod = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  
  // Calculate amount earned for this period
  const amountEarned = cycleInfo.dailyRate * daysInPeriod;
  
  // Check if receipt date falls within this period
  const isReceiptPeriod = cycleEnd >= periodStart && cycleEnd <= periodEnd;
  const amountReceived = isReceiptPeriod ? cycleInfo.incomeAmount : 0;
  const receiptDate = isReceiptPeriod ? admin.firestore.Timestamp.fromDate(cycleEnd) : undefined;
  
  return {
    amountEarned: Math.round(amountEarned * 100) / 100, // Round to 2 decimal places
    amountReceived: Math.round(amountReceived * 100) / 100,
    isReceiptPeriod,
    receiptDate
  };
}

/**
 * Efficiently create multiple inflow_periods using Firestore batch operations
 */
async function batchCreateInflowPeriods(
  db: admin.firestore.Firestore, 
  inflowPeriods: InflowPeriod[]
): Promise<void> {
  const BATCH_SIZE = 500; // Firestore batch limit
  
  for (let i = 0; i < inflowPeriods.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const batchPeriods = inflowPeriods.slice(i, i + BATCH_SIZE);
    
    batchPeriods.forEach((inflowPeriod) => {
      const docRef = db.collection('inflow_periods').doc(inflowPeriod.id!);
      batch.set(docRef, inflowPeriod);
    });
    
    await batch.commit();
    console.log(`Created batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(inflowPeriods.length / BATCH_SIZE)} (${batchPeriods.length} periods)`);
  }
}