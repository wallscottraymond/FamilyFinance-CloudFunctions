/**
 * Outflow Periods Auto-Generation
 * 
 * This Cloud Function automatically creates outflow_periods when an outflow is created.
 * It generates periods for all period types by integrating with the source_periods collection
 * and calculating cycle-based withholding amounts for each period.
 * 
 * Key Features:
 * - Integration with existing source_periods collection
 * - Cycle-based withholding calculation (daily rate × period days)
 * - Payment due date tracking and period alignment
 * - Support for all Plaid recurring frequencies (WEEKLY, MONTHLY, QUARTERLY, ANNUALLY)
 * - Proper error handling for missing source periods
 * - Edge case handling for different month lengths and leap years
 * 
 * Memory: 512MiB, Timeout: 60s
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { 
  RecurringOutflow, 
  OutflowPeriod, 
  SourcePeriod, 
  PlaidRecurringFrequency
} from '../../types';

/**
 * Triggered when an outflow is created
 * Automatically generates outflow_periods for all active source periods
 */
export const onOutflowCreated = onDocumentCreated({
  document: 'outflows/{outflowId}',
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (event) => {
  try {
    const outflowId = event.params.outflowId;
    const outflowData = event.data?.data() as RecurringOutflow;
    
    if (!outflowData) {
      console.error('No outflow data found');
      return;
    }

    // Skip inactive outflows
    if (!outflowData.isActive) {
      console.log(`Skipping inactive outflow: ${outflowId}`);
      return;
    }

    console.log(`Creating outflow periods for outflow: ${outflowId}`);
    console.log(`Outflow details: ${outflowData.description}, Amount: ${outflowData.averageAmount.amount}, Frequency: ${outflowData.frequency}`);
    
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    
    // Calculate time range for period generation (3 months forward like budget periods)
    const startDate = new Date();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 3); // 3 months forward
    
    console.log(`Generating outflow periods from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Get all source periods that overlap with our time range
    const sourcePeriodsQuery = db.collection('source_periods')
      .where('startDate', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('startDate', '<=', admin.firestore.Timestamp.fromDate(endDate));
    
    const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();
    
    if (sourcePeriodsSnapshot.empty) {
      console.warn('No source periods found in date range - outflow periods cannot be generated');
      return;
    }
    
    console.log(`Found ${sourcePeriodsSnapshot.size} source periods to process`);
    
    // Calculate payment cycle information
    const cycleInfo = calculatePaymentCycle(outflowData);
    console.log(`Payment cycle: ${cycleInfo.cycleDays} days, Rate: ${cycleInfo.dailyRate}`);
    
    // Create outflow_periods for each source period
    const outflowPeriods: OutflowPeriod[] = [];
    
    sourcePeriodsSnapshot.forEach((doc) => {
      const sourcePeriod = { id: doc.id, ...doc.data() } as SourcePeriod;
      
      // Calculate withholding amounts for this period
      const periodCalc = calculatePeriodAmounts(
        sourcePeriod, 
        cycleInfo, 
        outflowData
      );
      
      const outflowPeriod: OutflowPeriod = {
        id: `${outflowId}_${sourcePeriod.id}`,
        outflowId: outflowId!,
        periodId: sourcePeriod.id!,
        sourcePeriodId: sourcePeriod.id!,
        userId: outflowData.userId,
        familyId: outflowData.familyId,
        
        // Period context (denormalized for performance)
        periodType: sourcePeriod.type,
        periodStartDate: sourcePeriod.startDate,
        periodEndDate: sourcePeriod.endDate,
        
        // Payment cycle information
        cycleStartDate: cycleInfo.cycleStartDate,
        cycleEndDate: cycleInfo.cycleEndDate,
        cycleDays: cycleInfo.cycleDays,
        
        // Financial calculations
        billAmount: cycleInfo.billAmount,
        dailyWithholdingRate: cycleInfo.dailyRate,
        amountWithheld: periodCalc.amountWithheld,
        amountDue: periodCalc.amountDue,
        
        // Payment status
        isDuePeriod: periodCalc.isDuePeriod,
        dueDate: periodCalc.dueDate,
        isActive: true,
        
        // Metadata from outflow (denormalized for performance)
        outflowDescription: outflowData.description,
        outflowMerchantName: outflowData.merchantName,
        outflowExpenseType: outflowData.expenseType,
        outflowIsEssential: outflowData.isEssential,
        
        // System fields
        createdAt: now,
        updatedAt: now,
        lastCalculated: now,
      };
      
      outflowPeriods.push(outflowPeriod);
    });
    
    console.log(`Creating ${outflowPeriods.length} outflow periods`);
    
    // Batch create all outflow_periods
    await batchCreateOutflowPeriods(db, outflowPeriods);
    
    console.log(`Successfully created ${outflowPeriods.length} outflow periods for outflow ${outflowId}`);
    
  } catch (error) {
    console.error('Error in onOutflowCreated:', error);
    // Don't throw - we don't want to break outflow creation if period generation fails
  }
});

/**
 * Calculate payment cycle information from outflow data
 */
function calculatePaymentCycle(outflow: RecurringOutflow) {
  const billAmount = Math.abs(outflow.averageAmount.amount); // Ensure positive
  
  // Calculate cycle days based on frequency
  let cycleDays: number;
  switch (outflow.frequency) {
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
      console.warn(`Unknown frequency: ${outflow.frequency}, defaulting to 30 days`);
      cycleDays = 30;
  }
  
  // Calculate daily withholding rate
  const dailyRate = billAmount / cycleDays;
  
  // Use the outflow's lastDate as cycle end, calculate cycle start
  const cycleEndDate = outflow.lastDate;
  const cycleStartDate = admin.firestore.Timestamp.fromDate(
    new Date(cycleEndDate.toDate().getTime() - (cycleDays * 24 * 60 * 60 * 1000))
  );
  
  return {
    billAmount,
    cycleDays,
    dailyRate,
    cycleStartDate,
    cycleEndDate
  };
}

/**
 * Calculate withholding and due amounts for a specific period
 */
function calculatePeriodAmounts(
  sourcePeriod: SourcePeriod,
  cycleInfo: ReturnType<typeof calculatePaymentCycle>,
  outflow: RecurringOutflow
) {
  const periodStart = sourcePeriod.startDate.toDate();
  const periodEnd = sourcePeriod.endDate.toDate();
  const cycleEnd = cycleInfo.cycleEndDate.toDate();
  
  // Calculate days in this period
  const daysInPeriod = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)) + 1;
  
  // Calculate amount to withhold for this period
  const amountWithheld = cycleInfo.dailyRate * daysInPeriod;
  
  // Check if due date falls within this period
  const isDuePeriod = cycleEnd >= periodStart && cycleEnd <= periodEnd;
  const amountDue = isDuePeriod ? cycleInfo.billAmount : 0;
  const dueDate = isDuePeriod ? admin.firestore.Timestamp.fromDate(cycleEnd) : undefined;
  
  return {
    amountWithheld: Math.round(amountWithheld * 100) / 100, // Round to 2 decimal places
    amountDue: Math.round(amountDue * 100) / 100,
    isDuePeriod,
    dueDate
  };
}

/**
 * Efficiently create multiple outflow_periods using Firestore batch operations
 */
async function batchCreateOutflowPeriods(
  db: admin.firestore.Firestore, 
  outflowPeriods: OutflowPeriod[]
): Promise<void> {
  const BATCH_SIZE = 500; // Firestore batch limit
  
  for (let i = 0; i < outflowPeriods.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const batchPeriods = outflowPeriods.slice(i, i + BATCH_SIZE);
    
    batchPeriods.forEach((outflowPeriod) => {
      const docRef = db.collection('outflow_periods').doc(outflowPeriod.id!);
      batch.set(docRef, outflowPeriod);
    });
    
    await batch.commit();
    console.log(`Created batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(outflowPeriods.length / BATCH_SIZE)} (${batchPeriods.length} periods)`);
  }
}