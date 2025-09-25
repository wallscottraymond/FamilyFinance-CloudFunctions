/**
 * Extend Budget Periods (Simplified)
 *
 * This callable function handles rare cases where budget periods need to be created
 * for existing budgets. Since periods are now created upfront, this should rarely be needed.
 *
 * Features:
 * - Simple period generation for edge cases
 * - Handles single period requests
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
    
    console.log(`Creating budget periods for period: ${periodId} for user: ${user.uid}`);

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
      console.log('No active budgets found');
      return {
        success: true,
        budgetPeriodsCreated: 0,
        budgetsExtended: [],
      };
    }

    console.log(`Found ${budgetsSnapshot.size} active budgets`);

    const budgetsToExtend: Budget[] = [];
    const budgetPeriodsToCreate: BudgetPeriodDocument[] = [];
    const now = admin.firestore.Timestamp.now();

    // Check each budget to see if it needs this period
    for (const budgetDoc of budgetsSnapshot.docs) {
      const budget = { id: budgetDoc.id, ...budgetDoc.data() } as Budget;

      // Check if this budget already has this period
      const existingPeriodQuery = await db.collection('budget_periods')
        .where('budgetId', '==', budget.id)
        .where('periodId', '==', periodId)
        .get();

      if (!existingPeriodQuery.empty) {
        console.log(`Budget ${budget.id} already has period ${periodId}, skipping`);
        continue;
      }

      // Check if this period falls within the budget's timeframe
      const budgetStartTime = budget.startDate.toMillis();
      const periodStartTime = targetPeriod.startDate.toMillis();

      // Skip if period starts before budget starts
      if (periodStartTime < budgetStartTime) {
        console.log(`Period ${periodId} starts before budget ${budget.id} start date, skipping`);
        continue;
      }

      // Check budget end date based on isOngoing flag
      if (!budget.isOngoing && budget.budgetEndDate) {
        const budgetEndTime = budget.budgetEndDate.toMillis();
        if (periodStartTime > budgetEndTime) {
          console.log(`Period ${periodId} starts after budget ${budget.id} end date, skipping`);
          continue;
        }
      }

      budgetsToExtend.push(budget);

      // Calculate proportional amount for this period
      const allocatedAmount = calculateAllocatedAmount(budget.amount, targetPeriod);

      const budgetPeriod: BudgetPeriodDocument = {
        id: `${budget.id}_${targetPeriod.id}`,
        budgetId: budget.id!,
        periodId: targetPeriod.id!,
        sourcePeriodId: targetPeriod.id!,
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
    await batchCreateBudgetPeriods(db, budgetPeriodsToCreate);
    
    // Update budget lastExtended timestamp
    for (const budget of budgetsToExtend) {
      const updateData: any = { lastExtended: now };

      // For single period extension, update the range if needed
      if (!budget.activePeriodRange) {
        updateData.activePeriodRange = {
          startPeriod: targetPeriod.id,
          endPeriod: targetPeriod.id,
        };
      } else {
        // Check if this period extends the current range
        const currentEndPeriodDoc = await db.collection('source_periods').doc(budget.activePeriodRange.endPeriod).get();
        const currentEndTime = currentEndPeriodDoc.data()?.startDate?.toMillis() || 0;

        if (targetPeriod.startDate.toMillis() > currentEndTime) {
          updateData['activePeriodRange.endPeriod'] = targetPeriod.id;
        }
      }

      await db.collection('budgets').doc(budget.id!).update(updateData);
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
      if (budgetPeriod.id) {
        const docRef = db.collection('budget_periods').doc(budgetPeriod.id);
        batch.set(docRef, budgetPeriod);
      }
    });

    await batch.commit();
    console.log(`📦 Created batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(budgetPeriods.length / BATCH_SIZE)} (${batchPeriods.length} periods)`);
  }
}

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