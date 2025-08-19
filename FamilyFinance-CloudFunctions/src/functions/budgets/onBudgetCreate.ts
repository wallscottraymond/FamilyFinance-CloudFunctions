/**
 * Budget Periods Auto-Generation
 * 
 * This Cloud Function automatically creates budget_periods when a budget is created.
 * It generates periods for all 3 period types (weekly, bi-monthly, monthly) covering
 * a 3-month forward window to minimize Firestore writes while providing functionality.
 * 
 * Features:
 * - Multi-period type generation (weekly, bi-monthly, monthly)
 * - Proportional amount calculation based on period duration
 * - Smart 3-month windowing to minimize document creation
 * - Owner-based permissions with family role support
 * 
 * Memory: 512MiB, Timeout: 60s
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import * as admin from 'firebase-admin';
import { 
  Budget, 
  BudgetPeriodDocument, 
  SourcePeriod, 
  PeriodType 
} from '../../types';

/**
 * Triggered when a budget is created
 * Automatically generates budget_periods for a 3-month forward window
 */
export const onBudgetCreate = onDocumentCreated({
  document: 'budgets/{budgetId}',
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (event) => {
  try {
    const budgetId = event.params.budgetId;
    const budgetData = event.data?.data() as Budget;
    
    if (!budgetData) {
      console.error('No budget data found');
      return;
    }

    console.log(`Creating budget periods for budget: ${budgetId}`);
    
    const db = admin.firestore();
    const now = admin.firestore.Timestamp.now();
    
    // Calculate 3-month forward window
    const startDate = budgetData.startDate.toDate();
    const endDate = new Date(startDate);
    endDate.setMonth(endDate.getMonth() + 3); // 3 months forward
    
    console.log(`Generating periods from ${startDate.toISOString()} to ${endDate.toISOString()}`);
    
    // Get all source_periods that overlap with our time range
    const sourcePeriodsQuery = db.collection('source_periods')
      .where('startDate', '>=', admin.firestore.Timestamp.fromDate(startDate))
      .where('startDate', '<=', admin.firestore.Timestamp.fromDate(endDate));
    
    const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();
    
    if (sourcePeriodsSnapshot.empty) {
      console.warn('No source periods found in date range');
      return;
    }
    
    console.log(`Found ${sourcePeriodsSnapshot.size} source periods to process`);
    
    // Create budget_periods for each source period
    const budgetPeriods: BudgetPeriodDocument[] = [];
    
    sourcePeriodsSnapshot.forEach((doc) => {
      const sourcePeriod = { id: doc.id, ...doc.data() } as SourcePeriod;
      
      // Calculate proportional amount for this period type
      const allocatedAmount = calculateAllocatedAmount(budgetData.amount, sourcePeriod);
      
      const budgetPeriod: BudgetPeriodDocument = {
        id: `${budgetId}_${sourcePeriod.id}`,
        budgetId: budgetId!,
        periodId: sourcePeriod.id!,
        sourcePeriodId: sourcePeriod.id!, // Direct reference to source_periods.id for mapping
        familyId: String(budgetData.familyId || ''),
        
        // Ownership
        userId: budgetData.createdBy,
        createdBy: budgetData.createdBy,
        
        // Period context (denormalized for performance)
        periodType: sourcePeriod.type,
        periodStart: sourcePeriod.startDate,
        periodEnd: sourcePeriod.endDate,
        
        // Budget amounts
        allocatedAmount,
        originalAmount: allocatedAmount,
        
        // User modifications (initially none)
        isModified: false,
        
        // System fields
        createdAt: now,
        updatedAt: now,
        lastCalculated: now,
        isActive: true,
      };
      
      budgetPeriods.push(budgetPeriod);
    });
    
    console.log(`Creating ${budgetPeriods.length} budget periods`);
    
    // Batch create all budget_periods
    await batchCreateBudgetPeriods(db, budgetPeriods);
    
    // Update budget with period range tracking
    const firstPeriod = budgetPeriods.sort((a, b) => 
      a.periodStart.toMillis() - b.periodStart.toMillis()
    )[0];
    
    const lastPeriod = budgetPeriods.sort((a, b) => 
      b.periodStart.toMillis() - a.periodStart.toMillis()
    )[0];
    
    await db.collection('budgets').doc(budgetId).update({
      activePeriodRange: {
        startPeriod: firstPeriod.periodId,
        endPeriod: lastPeriod.periodId,
      },
      lastExtended: now,
    });
    
    console.log(`Successfully created ${budgetPeriods.length} budget periods for budget ${budgetId}`);
    
  } catch (error) {
    console.error('Error in onBudgetCreate:', error);
    // Don't throw - we don't want to break budget creation if period generation fails
  }
});

/**
 * Calculate proportional amount for a budget period based on period type and duration
 */
function calculateAllocatedAmount(baseBudgetAmount: number, sourcePeriod: SourcePeriod): number {
  switch (sourcePeriod.type) {
    case PeriodType.MONTHLY:
      // Full amount for monthly periods
      return baseBudgetAmount;
      
    case PeriodType.BI_MONTHLY:
      // Half amount for bi-monthly periods (approximately half a month)
      return baseBudgetAmount * 0.5;
      
    case PeriodType.WEEKLY:
      // Calculate based on actual days in the period vs average month
      const startDate = sourcePeriod.startDate.toDate();
      const endDate = sourcePeriod.endDate.toDate();
      const daysInPeriod = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const averageDaysInMonth = 30.44; // 365.25 / 12
      
      return baseBudgetAmount * (daysInPeriod / averageDaysInMonth);
      
    default:
      console.warn(`Unknown period type: ${sourcePeriod.type}`);
      return baseBudgetAmount;
  }
}

/**
 * Efficiently create multiple budget_periods using Firestore batch operations
 */
async function batchCreateBudgetPeriods(
  db: admin.firestore.Firestore, 
  budgetPeriods: BudgetPeriodDocument[]
): Promise<void> {
  const BATCH_SIZE = 500; // Firestore batch limit
  
  for (let i = 0; i < budgetPeriods.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const batchPeriods = budgetPeriods.slice(i, i + BATCH_SIZE);
    
    batchPeriods.forEach((budgetPeriod) => {
      const docRef = db.collection('budget_periods').doc(budgetPeriod.id!);
      batch.set(docRef, budgetPeriod);
    });
    
    await batch.commit();
    console.log(`Created batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(budgetPeriods.length / BATCH_SIZE)} (${batchPeriods.length} periods)`);
  }
}