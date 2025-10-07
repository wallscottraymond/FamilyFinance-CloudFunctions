/**
 * Extend Budget Periods Range
 * 
 * This callable function extends budget_periods for multiple periods at once
 * to improve performance when users are scrolling through periods. Instead of
 * creating periods one-at-a-time, this function creates them in batches.
 * 
 * Features:
 * - Batch period generation (create multiple periods in one call)
 * - Smart period selection (only creates missing periods)
 * - Handles all period types (weekly, bi-monthly, monthly)
 * - User permission validation
 * - Efficient batch writes
 * 
 * Memory: 512MiB, Timeout: 60s (increased for batch processing)
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { 
  Budget, 
  BudgetPeriodDocument, 
  SourcePeriod, 
  PeriodType,
  UserRole
} from '../../../../types';
import { authenticateRequest } from '../../../../utils/auth';

interface ExtendBudgetPeriodsRangeRequest {
  startPeriodId: string;    // First period we need budget data for
  endPeriodId: string;      // Last period we need budget data for  
  periodType: PeriodType;   // Type of periods to create
  familyId?: string;        // Optional family context
  maxPeriods?: number;      // Safety limit (default: 20)
}

interface ExtendBudgetPeriodsRangeResponse {
  success: boolean;
  budgetPeriodsCreated: number;
  budgetsExtended: string[];
  periodsProcessed: string[];
  skippedPeriods: string[];  // Periods that already had budget data
  error?: string;
}

/**
 * Extend budget periods to cover a range of periods
 * Called proactively when frontend detects user approaching periods without budget data
 */
export const extendBudgetPeriodsRange = onCall<ExtendBudgetPeriodsRangeRequest, Promise<ExtendBudgetPeriodsRangeResponse>>({
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 60,
}, async (request: CallableRequest<ExtendBudgetPeriodsRangeRequest>) => {
  try {
    const { startPeriodId, endPeriodId, periodType, familyId, maxPeriods = 20 } = request.data;
    
    // Authenticate user
    const { user, userData } = await authenticateRequest(request, UserRole.VIEWER);
    if (!user || !userData) {
      throw new Error('Authentication required');
    }
    const db = admin.firestore();
    
    console.log(`Extending budget periods range: ${startPeriodId} to ${endPeriodId} (${periodType}) for user: ${user.uid}`);
    
    // Get all source periods in the requested range
    const sourcePeriodsQuery = await db.collection('source_periods')
      .where('type', '==', periodType)
      .where('id', '>=', startPeriodId)
      .where('id', '<=', endPeriodId)
      .orderBy('id')
      .limit(maxPeriods)
      .get();
    
    if (sourcePeriodsQuery.empty) {
      throw new Error(`No source periods found in range: ${startPeriodId} to ${endPeriodId}`);
    }
    
    const sourcePeriods = sourcePeriodsQuery.docs.map(doc => 
      ({ id: doc.id, ...doc.data() } as SourcePeriod)
    );
    
    console.log(`Found ${sourcePeriods.length} source periods in range`);
    
    // Find active budgets that need extension
    let budgetsQuery = db.collection('budgets')
      .where('isActive', '==', true);
    
    if (familyId) {
      budgetsQuery = budgetsQuery.where('familyId', '==', familyId);
    } else {
      budgetsQuery = budgetsQuery.where('createdBy', '==', user.uid);
    }
    
    const budgetsSnapshot = await budgetsQuery.get();
    
    if (budgetsSnapshot.empty) {
      console.log('No active budgets found to extend');
      return {
        success: true,
        budgetPeriodsCreated: 0,
        budgetsExtended: [],
        periodsProcessed: sourcePeriods.map(p => p.id!),
        skippedPeriods: [],
      };
    }
    
    const budgets = budgetsSnapshot.docs.map(doc => 
      ({ id: doc.id, ...doc.data() } as Budget)
    );
    
    console.log(`Found ${budgets.length} active budgets to potentially extend`);
    
    // Check which budget periods already exist to avoid duplicates
    const existingPeriodsQuery = await db.collection('budget_periods')
      .where('userId', '==', user.uid)
      .where('periodType', '==', periodType)
      .where('periodId', 'in', sourcePeriods.map(p => p.id!))
      .get();
    
    const existingPeriodIds = new Set<string>();
    existingPeriodsQuery.docs.forEach(doc => {
      const data = doc.data();
      existingPeriodIds.add(`${data.budgetId}_${data.periodId}`);
    });
    
    const budgetPeriodsToCreate: BudgetPeriodDocument[] = [];
    const budgetsToExtend = new Set<string>();
    const skippedPeriods: string[] = [];
    const now = admin.firestore.Timestamp.now();
    
    // Create budget periods for each combination of budget and period
    for (const budget of budgets) {
      for (const sourcePeriod of sourcePeriods) {
        const budgetPeriodKey = `${budget.id}_${sourcePeriod.id}`;
        
        // Skip if this budget period already exists
        if (existingPeriodIds.has(budgetPeriodKey)) {
          skippedPeriods.push(sourcePeriod.id!);
          continue;
        }
        
        // Check if this period falls within the budget's timeframe
        if (sourcePeriod.startDate.toMillis() < budget.startDate.toMillis() ||
            (budget.endDate && sourcePeriod.endDate.toMillis() > budget.endDate.toMillis())) {
          console.log(`Period ${sourcePeriod.id} is outside budget ${budget.id} timeframe, skipping`);
          continue;
        }
        
        budgetsToExtend.add(budget.id!);
        
        // Calculate proportional amount for this period
        const allocatedAmount = calculateAllocatedAmount(budget.amount, sourcePeriod);
        
        const budgetPeriod: BudgetPeriodDocument = {
          id: `${budget.id}_${sourcePeriod.id}`,
          budgetId: budget.id!,
          periodId: sourcePeriod.id!,
          sourcePeriodId: sourcePeriod.id!, // Direct reference to source_periods.id for mapping
          familyId: String(budget.familyId || userData.familyId || ''),
          
          // Ownership
          userId: budget.createdBy,
          createdBy: budget.createdBy,
          
          // Period context
          periodType: sourcePeriod.type,
          periodStart: sourcePeriod.startDate,
          periodEnd: sourcePeriod.endDate,
          
          // Budget amounts
          allocatedAmount,
          originalAmount: allocatedAmount,
          
          // Budget name (denormalized for performance)
          budgetName: budget.name,
          
          // Checklist items (initially empty)
          checklistItems: [],
          
          // User modifications
          isModified: false,
          
          // System fields
          createdAt: now,
          updatedAt: now,
          lastCalculated: now,
          isActive: true,
        };
        
        budgetPeriodsToCreate.push(budgetPeriod);
      }
    }
    
    if (budgetPeriodsToCreate.length === 0) {
      console.log('No budget periods need to be created');
      return {
        success: true,
        budgetPeriodsCreated: 0,
        budgetsExtended: [],
        periodsProcessed: sourcePeriods.map(p => p.id!),
        skippedPeriods: [...new Set(skippedPeriods)],
      };
    }
    
    console.log(`Creating ${budgetPeriodsToCreate.length} new budget periods across ${budgetsToExtend.size} budgets`);
    
    // Batch create the new budget periods
    // Use multiple batches if needed (Firestore limit is 500 operations per batch)
    const batchSize = 450; // Leave some margin for safety
    const batches: admin.firestore.WriteBatch[] = [];
    
    for (let i = 0; i < budgetPeriodsToCreate.length; i += batchSize) {
      const batch = db.batch();
      const batchItems = budgetPeriodsToCreate.slice(i, i + batchSize);
      
      batchItems.forEach((budgetPeriod) => {
        if (budgetPeriod.id) {
          const docRef = db.collection('budget_periods').doc(budgetPeriod.id);
          batch.set(docRef, budgetPeriod);
        }
      });
      
      batches.push(batch);
    }
    
    // Execute all batches
    await Promise.all(batches.map(batch => batch.commit()));
    
    // Update budget activePeriodRange for extended budgets
    const latestPeriod = sourcePeriods[sourcePeriods.length - 1];
    const budgetUpdatePromises = Array.from(budgetsToExtend).map(async (budgetId) => {
      const budget = budgets.find(b => b.id === budgetId);
      if (!budget) return;
      
      // Only update if this is extending beyond current range
      if (!budget.activePeriodRange || 
          latestPeriod.startDate.toMillis() > 
          (await db.collection('source_periods').doc(budget.activePeriodRange.endPeriod).get())
            .data()?.startDate?.toMillis()) {
        
        await db.collection('budgets').doc(budgetId).update({
          'activePeriodRange.endPeriod': latestPeriod.id,
          lastExtended: now,
        });
      }
    });
    
    await Promise.all(budgetUpdatePromises);
    
    console.log(`Successfully created ${budgetPeriodsToCreate.length} budget periods for ${budgetsToExtend.size} budgets`);
    
    return {
      success: true,
      budgetPeriodsCreated: budgetPeriodsToCreate.length,
      budgetsExtended: Array.from(budgetsToExtend),
      periodsProcessed: sourcePeriods.map(p => p.id!),
      skippedPeriods: [...new Set(skippedPeriods)],
    };
    
  } catch (error) {
    console.error('Error extending budget periods range:', error);
    return {
      success: false,
      budgetPeriodsCreated: 0,
      budgetsExtended: [],
      periodsProcessed: [],
      skippedPeriods: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
});

/**
 * Calculate proportional amount for a budget period based on period type and duration
 */
function calculateAllocatedAmount(baseBudgetAmount: number, sourcePeriod: SourcePeriod): number {
  switch (sourcePeriod.type) {
    case PeriodType.MONTHLY:
      return baseBudgetAmount;
      
    case PeriodType.BI_MONTHLY:
      return baseBudgetAmount * 0.5;
      
    case PeriodType.WEEKLY:
      const startDate = sourcePeriod.startDate.toDate();
      const endDate = sourcePeriod.endDate.toDate();
      const daysInPeriod = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)) + 1;
      const averageDaysInMonth = 30.44;
      
      return baseBudgetAmount * (daysInPeriod / averageDaysInMonth);
      
    default:
      console.warn(`Unknown period type: ${sourcePeriod.type}`);
      return baseBudgetAmount;
  }
}