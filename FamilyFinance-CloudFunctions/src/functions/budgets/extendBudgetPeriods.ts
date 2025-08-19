/**
 * Extend Budget Periods
 * 
 * This callable function extends budget_periods when users navigate to periods
 * that don't have budget data yet. It's called on-demand from the frontend
 * when the PeriodSwiper needs budget data for a period that hasn't been generated.
 * 
 * Features:
 * - On-demand period generation
 * - Extends existing budget period ranges
 * - Handles all period types (weekly, bi-monthly, monthly)
 * - User permission validation
 * 
 * Memory: 256MiB, Timeout: 30s
 */

import { onCall, CallableRequest } from 'firebase-functions/v2/https';
import * as admin from 'firebase-admin';
import { 
  Budget, 
  BudgetPeriodDocument, 
  SourcePeriod, 
  PeriodType,
  UserRole
} from '../../types';
import { authenticateRequest } from '../../utils/auth';

interface ExtendBudgetPeriodsRequest {
  periodId: string;       // Target period we need budget data for
  familyId?: string;      // Optional family context
}

interface ExtendBudgetPeriodsResponse {
  success: boolean;
  budgetPeriodsCreated: number;
  budgetsExtended: string[];
  error?: string;
}

/**
 * Extend budget periods to cover a specific period
 * Called when frontend needs budget data for a period that doesn't exist yet
 */
export const extendBudgetPeriods = onCall<ExtendBudgetPeriodsRequest, Promise<ExtendBudgetPeriodsResponse>>({
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30,
}, async (request: CallableRequest<ExtendBudgetPeriodsRequest>) => {
  try {
    const { periodId, familyId } = request.data;
    
    // Authenticate user
    const { user, userData } = await authenticateRequest(request, UserRole.VIEWER);
    if (!user || !userData) {
      throw new Error('Authentication required');
    }
    const db = admin.firestore();
    
    console.log(`Extending budget periods to cover period: ${periodId} for user: ${user.uid}`);
    
    // Get the target source period
    const targetPeriodDoc = await db.collection('source_periods').doc(periodId).get();
    if (!targetPeriodDoc.exists) {
      throw new Error(`Source period not found: ${periodId}`);
    }
    
    const targetPeriod = { id: targetPeriodDoc.id, ...targetPeriodDoc.data() } as SourcePeriod;
    
    // Find active budgets that need extension
    let budgetsQuery = db.collection('budgets')
      .where('isActive', '==', true);
    
    if (familyId) {
      // If familyId provided, get family budgets
      budgetsQuery = budgetsQuery.where('familyId', '==', familyId);
    } else {
      // Otherwise get user's personal budgets
      budgetsQuery = budgetsQuery.where('createdBy', '==', user.uid);
    }
    
    const budgetsSnapshot = await budgetsQuery.get();
    
    if (budgetsSnapshot.empty) {
      console.log('No active budgets found to extend');
      return {
        success: true,
        budgetPeriodsCreated: 0,
        budgetsExtended: [],
      };
    }
    
    console.log(`Found ${budgetsSnapshot.size} active budgets to potentially extend`);
    
    const budgetsToExtend: Budget[] = [];
    const budgetPeriodsToCreate: BudgetPeriodDocument[] = [];
    const now = admin.firestore.Timestamp.now();
    
    // Check each budget to see if it needs extension
    for (const budgetDoc of budgetsSnapshot.docs) {
      const budget = { id: budgetDoc.id, ...budgetDoc.data() } as Budget;
      
      // Check if this budget already has a period for the target period
      const existingPeriodQuery = await db.collection('budget_periods')
        .where('budgetId', '==', budget.id)
        .where('periodId', '==', periodId)
        .get();
      
      if (!existingPeriodQuery.empty) {
        console.log(`Budget ${budget.id} already has period ${periodId}, skipping`);
        continue;
      }
      
      // Check if this period falls within the budget's timeframe
      if (targetPeriod.startDate.toMillis() < budget.startDate.toMillis() ||
          (budget.endDate && targetPeriod.endDate.toMillis() > budget.endDate.toMillis())) {
        console.log(`Period ${periodId} is outside budget ${budget.id} timeframe, skipping`);
        continue;
      }
      
      budgetsToExtend.push(budget);
      
      // Calculate proportional amount for this period
      const allocatedAmount = calculateAllocatedAmount(budget.amount, targetPeriod);
      
      const budgetPeriod: BudgetPeriodDocument = {
        id: `${budget.id}_${targetPeriod.id}`,
        budgetId: budget.id!,
        periodId: targetPeriod.id!,
        sourcePeriodId: targetPeriod.id!, // Direct reference to source_periods.id for mapping
        familyId: String(budget.familyId || userData.familyId || ''),
        
        // Ownership
        userId: budget.createdBy,
        createdBy: budget.createdBy,
        
        // Period context
        periodType: targetPeriod.type,
        periodStart: targetPeriod.startDate,
        periodEnd: targetPeriod.endDate,
        
        // Budget amounts
        allocatedAmount,
        originalAmount: allocatedAmount,
        
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
    
    if (budgetPeriodsToCreate.length === 0) {
      console.log('No budget periods need to be created');
      return {
        success: true,
        budgetPeriodsCreated: 0,
        budgetsExtended: [],
      };
    }
    
    console.log(`Creating ${budgetPeriodsToCreate.length} new budget periods`);
    
    // Batch create the new budget periods
    const batch = db.batch();
    
    budgetPeriodsToCreate.forEach((budgetPeriod) => {
      if (budgetPeriod.id) {
        const docRef = db.collection('budget_periods').doc(budgetPeriod.id);
        batch.set(docRef, budgetPeriod);
      }
    });
    
    await batch.commit();
    
    // Update budget activePeriodRange if needed
    for (const budget of budgetsToExtend) {
      if (!budget.activePeriodRange || 
          targetPeriod.startDate.toMillis() > 
          (await db.collection('source_periods').doc(budget.activePeriodRange.endPeriod).get())
            .data()?.startDate?.toMillis()) {
        
        await db.collection('budgets').doc(budget.id!).update({
          'activePeriodRange.endPeriod': targetPeriod.id,
          lastExtended: now,
        });
      }
    }
    
    console.log(`Successfully created ${budgetPeriodsToCreate.length} budget periods`);
    
    return {
      success: true,
      budgetPeriodsCreated: budgetPeriodsToCreate.length,
      budgetsExtended: budgetsToExtend.map(b => b.id!),
    };
    
  } catch (error) {
    console.error('Error extending budget periods:', error);
    return {
      success: false,
      budgetPeriodsCreated: 0,
      budgetsExtended: [],
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