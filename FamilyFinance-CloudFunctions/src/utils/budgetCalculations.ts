/**
 * Budget Calculations with Transaction Splits Support
 * 
 * This utility module provides functions for calculating budget metrics using
 * the new transaction splitting system. It handles both legacy transactions
 * (without splits) and new transactions with split allocations.
 * 
 * Features:
 * - Calculate spending for budget periods using transaction splits
 * - Aggregate spending across multiple budget periods
 * - Handle both split and non-split transactions seamlessly
 * - Efficient querying using Firestore array-contains operations
 */

import * as admin from 'firebase-admin';
import { Transaction, TransactionSplit, BudgetPeriodDocument } from '../types';

/**
 * Calculate total spending for a specific budget period using transaction splits
 */
export async function calculateBudgetPeriodSpending(
  budgetPeriodId: string,
  userId: string,
  startDate?: admin.firestore.Timestamp,
  endDate?: admin.firestore.Timestamp
): Promise<number> {
  const db = admin.firestore();
  
  // Build query for transactions affecting this budget period
  let query = db.collection('transactions')
    .where('affectedBudgetPeriods', 'array-contains', budgetPeriodId)
    .where('userId', '==', userId);

  // Add date filters if provided
  if (startDate) {
    query = query.where('date', '>=', startDate);
  }
  if (endDate) {
    query = query.where('date', '<=', endDate);
  }

  const snapshot = await query.get();
  
  let totalSpending = 0;
  
  snapshot.forEach(doc => {
    const transaction = doc.data() as Transaction;
    
    // For each transaction, find the split(s) that affect this budget period
    if (transaction.splits && transaction.splits.length > 0) {
      // Use splits system
      transaction.splits.forEach(split => {
        if (split.budgetPeriodId === budgetPeriodId) {
          totalSpending += split.amount;
        }
      });
    } else {
      // Legacy transaction without splits - use full amount if it matches
      // This handles backward compatibility during transition period
      if (transaction.budgetId) {
        // Would need to check if budgetId matches the budget period's budget
        // For now, assume it matches if the transaction is in the query results
        totalSpending += transaction.amount;
      }
    }
  });
  
  return totalSpending;
}

/**
 * Calculate spending for multiple budget periods efficiently
 */
export async function calculateMultipleBudgetPeriodSpending(
  budgetPeriodIds: string[],
  userId: string,
  startDate?: admin.firestore.Timestamp,
  endDate?: admin.firestore.Timestamp
): Promise<Map<string, number>> {
  if (budgetPeriodIds.length === 0) {
    return new Map();
  }

  const db = admin.firestore();
  const spendingMap = new Map<string, number>();
  
  // Initialize all periods with 0
  budgetPeriodIds.forEach(id => spendingMap.set(id, 0));

  // Query transactions that affect any of these budget periods
  let query = db.collection('transactions')
    .where('affectedBudgetPeriods', 'array-contains-any', budgetPeriodIds)
    .where('userId', '==', userId);

  // Add date filters if provided
  if (startDate) {
    query = query.where('date', '>=', startDate);
  }
  if (endDate) {
    query = query.where('date', '<=', endDate);
  }

  const snapshot = await query.get();
  
  snapshot.forEach(doc => {
    const transaction = doc.data() as Transaction;
    
    if (transaction.splits && transaction.splits.length > 0) {
      // Use splits system
      transaction.splits.forEach(split => {
        if (budgetPeriodIds.includes(split.budgetPeriodId)) {
          const currentSpending = spendingMap.get(split.budgetPeriodId) || 0;
          spendingMap.set(split.budgetPeriodId, currentSpending + split.amount);
        }
      });
    } else {
      // Legacy transaction - would need additional logic to map to budget periods
      console.warn(`Legacy transaction ${transaction.id} without splits encountered`);
    }
  });
  
  return spendingMap;
}

/**
 * Calculate spending for a specific budget across all its periods
 */
export async function calculateBudgetSpending(
  budgetId: string,
  userId: string,
  startDate?: admin.firestore.Timestamp,
  endDate?: admin.firestore.Timestamp
): Promise<number> {
  const db = admin.firestore();
  
  // Build query for transactions affecting this budget
  let query = db.collection('transactions')
    .where('affectedBudgets', 'array-contains', budgetId)
    .where('userId', '==', userId);

  // Add date filters if provided
  if (startDate) {
    query = query.where('date', '>=', startDate);
  }
  if (endDate) {
    query = query.where('date', '<=', endDate);
  }

  const snapshot = await query.get();
  
  let totalSpending = 0;
  
  snapshot.forEach(doc => {
    const transaction = doc.data() as Transaction;
    
    // For each transaction, find the split(s) that affect this budget
    if (transaction.splits && transaction.splits.length > 0) {
      // Use splits system
      transaction.splits.forEach(split => {
        if (split.budgetId === budgetId) {
          totalSpending += split.amount;
        }
      });
    } else {
      // Legacy transaction - use full amount if budgetId matches
      if (transaction.budgetId === budgetId) {
        totalSpending += transaction.amount;
      }
    }
  });
  
  return totalSpending;
}

/**
 * Get detailed breakdown of spending for a budget period
 */
export async function getBudgetPeriodSpendingBreakdown(
  budgetPeriodId: string,
  userId: string,
  startDate?: admin.firestore.Timestamp,
  endDate?: admin.firestore.Timestamp
): Promise<{
  totalSpending: number;
  transactionCount: number;
  splitCount: number;
  transactions: Array<{
    transaction: Transaction;
    relevantSplits: TransactionSplit[];
    splitAmount: number;
  }>;
}> {
  const db = admin.firestore();
  
  // Build query for transactions affecting this budget period
  let query = db.collection('transactions')
    .where('affectedBudgetPeriods', 'array-contains', budgetPeriodId)
    .where('userId', '==', userId)
    .orderBy('date', 'desc');

  // Add date filters if provided
  if (startDate) {
    query = query.where('date', '>=', startDate);
  }
  if (endDate) {
    query = query.where('date', '<=', endDate);
  }

  const snapshot = await query.get();
  
  let totalSpending = 0;
  let splitCount = 0;
  const transactions: Array<{
    transaction: Transaction;
    relevantSplits: TransactionSplit[];
    splitAmount: number;
  }> = [];
  
  snapshot.forEach(doc => {
    const transaction = doc.data() as Transaction;
    const relevantSplits: TransactionSplit[] = [];
    let splitAmount = 0;
    
    if (transaction.splits && transaction.splits.length > 0) {
      // Find splits that affect this budget period
      transaction.splits.forEach(split => {
        if (split.budgetPeriodId === budgetPeriodId) {
          relevantSplits.push(split);
          splitAmount += split.amount;
          splitCount++;
        }
      });
    } else {
      // Legacy transaction handling
      if (transaction.budgetId) {
        splitAmount = transaction.amount;
        splitCount++;
      }
    }
    
    if (splitAmount > 0) {
      totalSpending += splitAmount;
      transactions.push({
        transaction,
        relevantSplits,
        splitAmount
      });
    }
  });
  
  return {
    totalSpending,
    transactionCount: transactions.length,
    splitCount,
    transactions
  };
}

/**
 * Update budget period with latest spending calculations
 */
export async function updateBudgetPeriodSpending(
  budgetPeriodId: string,
  userId: string
): Promise<void> {
  const db = admin.firestore();
  
  // Get the budget period to find its date range
  const budgetPeriodDoc = await db.collection('budget_periods').doc(budgetPeriodId).get();
  if (!budgetPeriodDoc.exists) {
    throw new Error('Budget period not found');
  }
  
  const budgetPeriod = budgetPeriodDoc.data() as BudgetPeriodDocument;
  
  // Verify ownership
  if (budgetPeriod.userId !== userId) {
    throw new Error('Permission denied');
  }
  
  // Calculate current spending for this period
  const totalSpent = await calculateBudgetPeriodSpending(
    budgetPeriodId,
    userId,
    budgetPeriod.periodStart,
    budgetPeriod.periodEnd
  );
  
  // Update the budget period document
  await budgetPeriodDoc.ref.update({
    totalSpent,
    remaining: budgetPeriod.allocatedAmount - totalSpent,
    lastCalculated: admin.firestore.Timestamp.now(),
    updatedAt: admin.firestore.Timestamp.now(),
  });
  
  console.log(`Updated budget period ${budgetPeriodId} spending: ${totalSpent}`);
}

/**
 * Batch update multiple budget periods with spending calculations
 */
export async function batchUpdateBudgetPeriodSpending(
  budgetPeriodIds: string[],
  userId: string
): Promise<void> {
  if (budgetPeriodIds.length === 0) {
    return;
  }

  const db = admin.firestore();
  
  // Get all budget periods
  const budgetPeriodsQuery = await db.collection('budget_periods')
    .where(admin.firestore.FieldPath.documentId(), 'in', budgetPeriodIds)
    .where('userId', '==', userId)
    .get();
  
  if (budgetPeriodsQuery.empty) {
    return;
  }
  
  // Calculate spending for all periods efficiently
  const spendingMap = await calculateMultipleBudgetPeriodSpending(budgetPeriodIds, userId);
  
  // Update all budget periods in batches
  const BATCH_SIZE = 500;
  const now = admin.firestore.Timestamp.now();
  
  for (let i = 0; i < budgetPeriodsQuery.docs.length; i += BATCH_SIZE) {
    const batch = db.batch();
    const batchDocs = budgetPeriodsQuery.docs.slice(i, i + BATCH_SIZE);
    
    batchDocs.forEach(doc => {
      const budgetPeriod = doc.data() as BudgetPeriodDocument;
      const totalSpent = spendingMap.get(doc.id) || 0;
      
      batch.update(doc.ref, {
        totalSpent,
        remaining: budgetPeriod.allocatedAmount - totalSpent,
        lastCalculated: now,
        updatedAt: now,
      });
    });
    
    await batch.commit();
    console.log(`Updated batch ${Math.floor(i / BATCH_SIZE) + 1} of budget period spending calculations`);
  }
}

// ============================================================================
// PERIOD COVERAGE ANALYSIS UTILITIES
// ============================================================================

/**
 * Budget Period Coverage Analysis Utilities
 *
 * This section provides utilities for analyzing budget period coverage,
 * detecting gaps, and optimizing period generation strategies.
 *
 * Features:
 * - Coverage gap detection across all period types
 * - Period range analysis and optimization
 * - Batch extension recommendations
 * - Performance optimization for large date ranges
 */

import {
  Budget,
  SourcePeriod,
  PeriodType,
  PeriodManagementConfig
} from '../types';

/**
 * Configuration for period management strategies
 */
export const DEFAULT_PERIOD_CONFIG: PeriodManagementConfig = {
  defaultWindowSize: 12, // 12 months
  edgeDetectionThreshold: 2, // months
  maxPreloadExpansion: 24, // months
  batchExtensionSize: 6, // periods at once
  maxBatchExtensionLimit: 50, // maximum periods per batch
  preloadStrategy: 'balanced'
};

/**
 * Coverage analysis result for a specific budget
 */
export interface BudgetCoverageAnalysis {
  budgetId: string;
  budgetName: string;
  budgetType: 'recurring' | 'limited';
  isOngoing: boolean;

  // Coverage statistics
  totalPeriodsAvailable: number;
  periodsWithCoverage: number;
  coveragePercentage: number;

  // Gap analysis
  gaps: PeriodGap[];
  largestGapSize: number;

  // Date ranges
  analysisStart: Date;
  analysisEnd: Date;
  budgetStart: Date;
  budgetEnd?: Date;

  // Coverage by period type
  coverageByType: {
    [PeriodType.WEEKLY]: PeriodTypeCoverage;
    [PeriodType.BI_MONTHLY]: PeriodTypeCoverage;
    [PeriodType.MONTHLY]: PeriodTypeCoverage;
  };

  // Recommendations
  recommendations: CoverageRecommendation[];
}

/**
 * Coverage information for a specific period type
 */
export interface PeriodTypeCoverage {
  periodType: PeriodType;
  totalPeriods: number;
  coveredPeriods: number;
  coveragePercentage: number;
  gaps: PeriodGap[];
  nextMissingPeriod?: string;
}

/**
 * Gap in budget period coverage
 */
export interface PeriodGap {
  startPeriodId: string;
  endPeriodId: string;
  startDate: Date;
  endDate: Date;
  periodType: PeriodType;
  gapSize: number; // number of periods
  priority: 'high' | 'medium' | 'low';
}

/**
 * Recommendation for improving coverage
 */
export interface CoverageRecommendation {
  type: 'extend' | 'backfill' | 'batch_create' | 'scheduled_extension';
  priority: 'high' | 'medium' | 'low';
  description: string;
  actionPeriods: string[];
  estimatedPeriods: number;
  rationale: string;
}

/**
 * Analyze budget period coverage for a specific budget
 */
export async function analyzeBudgetCoverage(
  budgetId: string,
  analysisWindowMonths: number = 12,
  config: Partial<PeriodManagementConfig> = {}
): Promise<BudgetCoverageAnalysis> {
  const db = admin.firestore();
  const mergedConfig = { ...DEFAULT_PERIOD_CONFIG, ...config };

  // Get budget details
  const budgetDoc = await db.collection('budgets').doc(budgetId).get();
  if (!budgetDoc.exists) {
    throw new Error(`Budget not found: ${budgetId}`);
  }

  const budget = { id: budgetDoc.id, ...budgetDoc.data() } as Budget;

  // Define analysis window
  const analysisStart = budget.startDate.toDate();
  let analysisEnd: Date;

  if (!budget.isOngoing && budget.budgetEndDate) {
    analysisEnd = budget.budgetEndDate.toDate();
  } else {
    analysisEnd = new Date(analysisStart);
    analysisEnd.setMonth(analysisEnd.getMonth() + analysisWindowMonths);
  }

  // Get all source periods in the analysis window
  const sourcePeriodsSnapshot = await db.collection('source_periods')
    .where('startDate', '>=', admin.firestore.Timestamp.fromDate(analysisStart))
    .where('startDate', '<=', admin.firestore.Timestamp.fromDate(analysisEnd))
    .orderBy('startDate')
    .get();

  const sourcePeriods = sourcePeriodsSnapshot.docs.map(doc => ({
    id: doc.id,
    ...doc.data()
  } as SourcePeriod));

  // Get existing budget periods
  const budgetPeriodsSnapshot = await db.collection('budget_periods')
    .where('budgetId', '==', budgetId)
    .get();

  const existingPeriodIds = new Set(
    budgetPeriodsSnapshot.docs.map(doc => doc.data().sourcePeriodId || doc.data().periodId)
  );

  // Analyze coverage by period type
  const coverageByType = {
    [PeriodType.WEEKLY]: analyzePeriodTypeCoverage(
      sourcePeriods.filter(p => p.type === PeriodType.WEEKLY),
      existingPeriodIds,
      PeriodType.WEEKLY
    ),
    [PeriodType.BI_MONTHLY]: analyzePeriodTypeCoverage(
      sourcePeriods.filter(p => p.type === PeriodType.BI_MONTHLY),
      existingPeriodIds,
      PeriodType.BI_MONTHLY
    ),
    [PeriodType.MONTHLY]: analyzePeriodTypeCoverage(
      sourcePeriods.filter(p => p.type === PeriodType.MONTHLY),
      existingPeriodIds,
      PeriodType.MONTHLY
    )
  };

  // Aggregate gaps
  const allGaps = [
    ...coverageByType[PeriodType.WEEKLY].gaps,
    ...coverageByType[PeriodType.BI_MONTHLY].gaps,
    ...coverageByType[PeriodType.MONTHLY].gaps
  ];

  // Calculate overall statistics
  const totalPeriodsAvailable = sourcePeriods.length;
  const periodsWithCoverage = sourcePeriods.filter(p => existingPeriodIds.has(p.id!)).length;
  const coveragePercentage = totalPeriodsAvailable > 0 ?
    (periodsWithCoverage / totalPeriodsAvailable) * 100 : 100;

  // Generate recommendations
  const recommendations = generateCoverageRecommendations(
    budget,
    coverageByType,
    allGaps,
    mergedConfig
  );

  return {
    budgetId: budget.id!,
    budgetName: budget.name,
    budgetType: budget.budgetType,
    isOngoing: budget.isOngoing,

    totalPeriodsAvailable,
    periodsWithCoverage,
    coveragePercentage,

    gaps: allGaps.sort((a, b) => b.gapSize - a.gapSize), // Sort by gap size desc
    largestGapSize: allGaps.length > 0 ? Math.max(...allGaps.map(g => g.gapSize)) : 0,

    analysisStart,
    analysisEnd,
    budgetStart: budget.startDate.toDate(),
    budgetEnd: budget.budgetEndDate?.toDate(),

    coverageByType,
    recommendations
  };
}

/**
 * Analyze coverage for all active budgets
 */
export async function analyzeAllBudgetsCoverage(
  userId: string,
  familyId?: string,
  analysisWindowMonths: number = 12
): Promise<{
  budgetAnalyses: BudgetCoverageAnalysis[];
  overallStats: {
    totalBudgets: number;
    budgetsWithGaps: number;
    averageCoverage: number;
    priorityGaps: number;
  };
  globalRecommendations: CoverageRecommendation[];
}> {
  const db = admin.firestore();

  // Get active budgets
  let budgetsQuery = db.collection('budgets')
    .where('isActive', '==', true);

  if (familyId) {
    budgetsQuery = budgetsQuery.where('familyId', '==', familyId);
  } else {
    budgetsQuery = budgetsQuery.where('createdBy', '==', userId);
  }

  const budgetsSnapshot = await budgetsQuery.get();
  const budgets = budgetsSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Budget));

  // Analyze each budget
  const budgetAnalyses: BudgetCoverageAnalysis[] = [];
  for (const budget of budgets) {
    try {
      const analysis = await analyzeBudgetCoverage(budget.id!, analysisWindowMonths);
      budgetAnalyses.push(analysis);
    } catch (error) {
      console.error(`Error analyzing budget ${budget.id}:`, error);
    }
  }

  // Calculate overall statistics
  const totalBudgets = budgetAnalyses.length;
  const budgetsWithGaps = budgetAnalyses.filter(a => a.gaps.length > 0).length;
  const averageCoverage = totalBudgets > 0 ?
    budgetAnalyses.reduce((sum, a) => sum + a.coveragePercentage, 0) / totalBudgets : 100;
  const priorityGaps = budgetAnalyses.reduce((sum, a) =>
    sum + a.gaps.filter(g => g.priority === 'high').length, 0);

  // Generate global recommendations
  const globalRecommendations = generateGlobalRecommendations(budgetAnalyses);

  return {
    budgetAnalyses,
    overallStats: {
      totalBudgets,
      budgetsWithGaps,
      averageCoverage,
      priorityGaps
    },
    globalRecommendations
  };
}

/**
 * Find optimal periods for batch extension
 */
export async function findOptimalExtensionPeriods(
  budgetIds: string[],
  targetPeriodCount: number = 6,
  prioritizeRecurring: boolean = true
): Promise<{
  recommendedPeriods: string[];
  impactAnalysis: {
    budgetsAffected: string[];
    periodsCreated: number;
    coverageImprovement: number;
  };
}> {

  // Get analysis for all specified budgets
  const analyses: BudgetCoverageAnalysis[] = [];
  for (const budgetId of budgetIds) {
    try {
      const analysis = await analyzeBudgetCoverage(budgetId);
      analyses.push(analysis);
    } catch (error) {
      console.error(`Error analyzing budget ${budgetId}:`, error);
    }
  }

  // Find periods that would benefit the most budgets
  const periodImpactMap = new Map<string, {
    budgetsAffected: string[];
    gapsFilled: number;
    priority: number;
  }>();

  for (const analysis of analyses) {
    const budgetWeight = prioritizeRecurring && analysis.budgetType === 'recurring' ? 2 : 1;

    for (const gap of analysis.gaps) {
      // For each period in the gap
      const gapPeriods = await getPeriodsInGap(gap);

      for (const periodId of gapPeriods) {
        if (!periodImpactMap.has(periodId)) {
          periodImpactMap.set(periodId, {
            budgetsAffected: [],
            gapsFilled: 0,
            priority: 0
          });
        }

        const impact = periodImpactMap.get(periodId)!;
        impact.budgetsAffected.push(analysis.budgetId);
        impact.gapsFilled += 1;
        impact.priority += (gap.priority === 'high' ? 3 : gap.priority === 'medium' ? 2 : 1) * budgetWeight;
      }
    }
  }

  // Sort periods by impact and select top N
  const sortedPeriods = Array.from(periodImpactMap.entries())
    .sort(([, a], [, b]) => b.priority - a.priority)
    .slice(0, targetPeriodCount);

  const recommendedPeriods = sortedPeriods.map(([periodId]) => periodId);

  // Calculate impact
  const budgetsAffected = new Set<string>();
  let totalGapsFilled = 0;

  for (const [, impact] of sortedPeriods) {
    impact.budgetsAffected.forEach(id => budgetsAffected.add(id));
    totalGapsFilled += impact.gapsFilled;
  }

  const estimatedImprovement = (totalGapsFilled / analyses.reduce((sum, a) => sum + a.totalPeriodsAvailable, 0)) * 100;

  return {
    recommendedPeriods,
    impactAnalysis: {
      budgetsAffected: Array.from(budgetsAffected),
      periodsCreated: totalGapsFilled,
      coverageImprovement: estimatedImprovement
    }
  };
}

/**
 * Helper function to analyze coverage for a specific period type
 */
function analyzePeriodTypeCoverage(
  periods: SourcePeriod[],
  existingPeriodIds: Set<string>,
  periodType: PeriodType
): PeriodTypeCoverage {
  const totalPeriods = periods.length;
  const coveredPeriods = periods.filter(p => existingPeriodIds.has(p.id!)).length;
  const coveragePercentage = totalPeriods > 0 ? (coveredPeriods / totalPeriods) * 100 : 100;

  // Find gaps
  const gaps: PeriodGap[] = [];
  let gapStart: SourcePeriod | null = null;

  for (const period of periods) {
    const isCovered = existingPeriodIds.has(period.id!);

    if (!isCovered && !gapStart) {
      gapStart = period;
    } else if (isCovered && gapStart) {
      // End of gap
      const gapSize = periods.indexOf(period) - periods.indexOf(gapStart);
      gaps.push({
        startPeriodId: gapStart.id!,
        endPeriodId: periods[periods.indexOf(period) - 1].id!,
        startDate: gapStart.startDate.toDate(),
        endDate: periods[periods.indexOf(period) - 1].endDate.toDate(),
        periodType,
        gapSize,
        priority: gapSize > 4 ? 'high' : gapSize > 2 ? 'medium' : 'low'
      });
      gapStart = null;
    }
  }

  // Handle gap that extends to the end
  if (gapStart) {
    const gapSize = periods.length - periods.indexOf(gapStart);
    gaps.push({
      startPeriodId: gapStart.id!,
      endPeriodId: periods[periods.length - 1].id!,
      startDate: gapStart.startDate.toDate(),
      endDate: periods[periods.length - 1].endDate.toDate(),
      periodType,
      gapSize,
      priority: gapSize > 4 ? 'high' : gapSize > 2 ? 'medium' : 'low'
    });
  }

  // Find next missing period
  const nextMissingPeriod = periods.find(p => !existingPeriodIds.has(p.id!))?.id;

  return {
    periodType,
    totalPeriods,
    coveredPeriods,
    coveragePercentage,
    gaps,
    nextMissingPeriod
  };
}

/**
 * Generate coverage recommendations for a budget
 */
function generateCoverageRecommendations(
  budget: Budget,
  coverageByType: { [key in PeriodType]: PeriodTypeCoverage },
  allGaps: PeriodGap[],
  config: PeriodManagementConfig
): CoverageRecommendation[] {
  const recommendations: CoverageRecommendation[] = [];

  // High priority gaps
  const highPriorityGaps = allGaps.filter(g => g.priority === 'high');
  if (highPriorityGaps.length > 0) {
    recommendations.push({
      type: 'extend',
      priority: 'high',
      description: `Fill ${highPriorityGaps.length} high-priority coverage gaps`,
      actionPeriods: highPriorityGaps.flatMap(g => [g.startPeriodId, g.endPeriodId]),
      estimatedPeriods: highPriorityGaps.reduce((sum, g) => sum + g.gapSize, 0),
      rationale: 'Large gaps can cause budget tracking inconsistencies'
    });
  }

  // Recurring budget extensions
  if (budget.budgetType === 'recurring' && budget.isOngoing) {
    const hasIncompleteTypes = Object.values(coverageByType).some(c => c.coveragePercentage < 95);
    if (hasIncompleteTypes) {
      recommendations.push({
        type: 'batch_create',
        priority: 'medium',
        description: 'Extend recurring budget with 12-month window across all period types',
        actionPeriods: Object.values(coverageByType)
          .filter(c => c.nextMissingPeriod)
          .map(c => c.nextMissingPeriod!),
        estimatedPeriods: Math.floor(config.defaultWindowSize * 3), // Approximate for all types
        rationale: 'Recurring budgets should maintain consistent forward coverage'
      });
    }
  }

  // Scheduled extension recommendation
  if (budget.budgetType === 'recurring' && allGaps.length > config.batchExtensionSize) {
    recommendations.push({
      type: 'scheduled_extension',
      priority: 'low',
      description: 'Enable automated period extension for this recurring budget',
      actionPeriods: [],
      estimatedPeriods: 0,
      rationale: 'Automated extension prevents manual intervention needs'
    });
  }

  return recommendations.sort((a, b) => {
    const priorityOrder = { high: 3, medium: 2, low: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });
}

/**
 * Generate global recommendations across all budgets
 */
function generateGlobalRecommendations(analyses: BudgetCoverageAnalysis[]): CoverageRecommendation[] {
  const recommendations: CoverageRecommendation[] = [];

  // Find budgets with many gaps
  const budgetsWithManyGaps = analyses.filter(a => a.gaps.length > 5);
  if (budgetsWithManyGaps.length > 0) {
    recommendations.push({
      type: 'batch_create',
      priority: 'high',
      description: `Batch extend ${budgetsWithManyGaps.length} budgets with significant gaps`,
      actionPeriods: [],
      estimatedPeriods: budgetsWithManyGaps.reduce((sum, a) => sum + a.gaps.length, 0),
      rationale: 'Multiple budgets with gaps indicate systematic extension needs'
    });
  }

  // Recurring budget optimization
  const recurringWithGaps = analyses.filter(a =>
    a.budgetType === 'recurring' && a.isOngoing && a.coveragePercentage < 90
  );
  if (recurringWithGaps.length > 0) {
    recommendations.push({
      type: 'scheduled_extension',
      priority: 'medium',
      description: `Enable scheduled extension for ${recurringWithGaps.length} recurring budgets`,
      actionPeriods: [],
      estimatedPeriods: 0,
      rationale: 'Recurring budgets benefit from automated period management'
    });
  }

  return recommendations;
}

/**
 * Helper to get period IDs within a gap
 */
async function getPeriodsInGap(gap: PeriodGap): Promise<string[]> {
  const db = admin.firestore();

  const periodsSnapshot = await db.collection('source_periods')
    .where('type', '==', gap.periodType)
    .where('startDate', '>=', admin.firestore.Timestamp.fromDate(gap.startDate))
    .where('startDate', '<=', admin.firestore.Timestamp.fromDate(gap.endDate))
    .orderBy('startDate')
    .get();

  return periodsSnapshot.docs.map(doc => doc.id);
}