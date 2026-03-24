/**
 * Scheduled Budget Period Maintenance (Prime/Non-Prime System)
 *
 * This Cloud Function runs monthly to maintain a rolling 1-year window
 * of budget periods for recurring budgets using the Prime/Non-Prime system.
 *
 * Features:
 * - Runs on the 1st of each month at 2:00 AM UTC
 * - Maintains 1-year rolling window for recurring budgets
 * - Uses Prime/Non-Prime period generation for accurate cross-period calculations
 * - Prime periods generated first, then non-prime derived from primes
 *
 * Memory: 512MiB, Timeout: 300s (5 minutes)
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import {
  Budget,
  BudgetPeriodDocument,
  SourcePeriod,
  PeriodType,
} from '../../../../types';
import {
  getPrimePeriodType,
  getNonPrimePeriodTypes,
} from '../../utils/primePeriodGeneration';
import {
  findOverlappingPrimePeriods,
  calculatePrimeContributions,
} from '../../utils/nonPrimePeriodGeneration';

/**
 * Scheduled function to extend recurring budget periods
 * Runs monthly on the 1st at 2:00 AM UTC
 */
export const extendRecurringBudgetPeriods = onSchedule({
  schedule: '0 2 1 * *', // Cron: minute hour day month dayOfWeek
  timeZone: 'UTC',
  region: 'us-central1',
  memory: '512MiB',
  timeoutSeconds: 300,
}, async (event) => {
  console.log('🚀 Starting scheduled budget period extension (Prime/Non-Prime System)...');

  const db = admin.firestore();
  const now = Timestamp.now();

  try {
    // Get all recurring budgets that are ongoing
    const recurringBudgetsQuery = db.collection('budgets')
      .where('budgetType', '==', 'recurring')
      .where('isOngoing', '==', true)
      .where('isActive', '==', true);

    const recurringBudgetsSnapshot = await recurringBudgetsQuery.get();

    if (recurringBudgetsSnapshot.empty) {
      console.log('✅ No recurring budgets found to maintain');
      return;
    }

    console.log(`📊 Found ${recurringBudgetsSnapshot.size} recurring budgets to maintain`);

    let totalPeriodsCreated = 0;
    let budgetsProcessed = 0;

    // Simple rolling window: always maintain 1 year from today
    const today = new Date();
    const oneYearFromToday = new Date(today);
    oneYearFromToday.setMonth(oneYearFromToday.getMonth() + 12);

    console.log(`🎯 Maintaining 1-year window: ${today.toISOString()} to ${oneYearFromToday.toISOString()}`);

    // Get all source periods for the rolling window
    const sourcePeriodsQuery = db.collection('source_periods')
      .where('startDate', '>=', Timestamp.fromDate(today))
      .where('startDate', '<=', Timestamp.fromDate(oneYearFromToday));

    const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();

    if (sourcePeriodsSnapshot.empty) {
      console.warn('⚠️ No source periods found in rolling window - may need source period generation');
      return;
    }

    console.log(`📋 Found ${sourcePeriodsSnapshot.size} source periods in rolling window`);
    const allSourcePeriods = sourcePeriodsSnapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    } as SourcePeriod));

    // Process each recurring budget
    for (const budgetDoc of recurringBudgetsSnapshot.docs) {
      const budget = { id: budgetDoc.id, ...budgetDoc.data() } as Budget;

      try {
        console.log(`🔄 Processing budget: ${budget.name} (${budget.id})`);

        // Get existing budget periods for this budget
        const existingPeriodsQuery = db.collection('budget_periods')
          .where('budgetId', '==', budget.id);

        const existingPeriodsSnapshot = await existingPeriodsQuery.get();
        const existingPeriodIds = new Set(
          existingPeriodsSnapshot.docs.map(doc => doc.data().sourcePeriodId || doc.data().periodId)
        );

        // Determine prime and non-prime period types
        const primePeriodType = getPrimePeriodType(budget.period);
        const nonPrimePeriodTypes = getNonPrimePeriodTypes(budget.period);

        console.log(`  Prime type: ${primePeriodType}, Non-prime types: ${nonPrimePeriodTypes.join(', ')}`);

        // Filter source periods by type
        const primeSourcePeriods = allSourcePeriods.filter(sp => sp.type === primePeriodType);
        const nonPrimeSourcePeriodsByType = new Map<PeriodType, SourcePeriod[]>();
        for (const periodType of nonPrimePeriodTypes) {
          nonPrimeSourcePeriodsByType.set(
            periodType,
            allSourcePeriods.filter(sp => sp.type === periodType)
          );
        }

        // === PHASE 1: Generate new Prime periods ===
        const newPrimePeriods: BudgetPeriodDocument[] = [];

        for (const sourcePeriod of primeSourcePeriods) {
          // Skip if budget period already exists
          if (existingPeriodIds.has(sourcePeriod.id)) {
            continue;
          }

          // Calculate days in period using UTC-normalized dates to avoid off-by-one errors
          const periodStart = sourcePeriod.startDate.toDate();
          const periodEnd = sourcePeriod.endDate.toDate();
          const startUTC = Date.UTC(periodStart.getUTCFullYear(), periodStart.getUTCMonth(), periodStart.getUTCDate());
          const endUTC = Date.UTC(periodEnd.getUTCFullYear(), periodEnd.getUTCMonth(), periodEnd.getUTCDate());
          const daysInPeriod = Math.round((endUTC - startUTC) / (1000 * 60 * 60 * 24)) + 1;

          // For prime periods, allocatedAmount = budget.amount (full amount for the period type)
          const allocatedAmount = budget.amount;
          // Store dailyRate with 6 decimal precision for accurate non-prime calculations
          const dailyRate = Math.round((allocatedAmount / daysInPeriod) * 1000000) / 1000000;

          const budgetPeriod: BudgetPeriodDocument = {
            id: `${budget.id}_${sourcePeriod.id}`,
            budgetId: budget.id!,
            periodId: sourcePeriod.id!,
            sourcePeriodId: sourcePeriod.id!,
            familyId: String(budget.familyId || ''),

            // Ownership - inherit from budget
            userId: budget.access?.createdBy || budget.createdBy,
            createdBy: budget.access?.createdBy || budget.createdBy,
            ownerId: budget.access?.ownerId || budget.ownerId,
            groupId: budget.groupId,
            isPrivate: budget.access?.isPrivate ?? budget.isPrivate,
            accessibleBy: budget.accessibleBy,

            // Period context
            periodType: sourcePeriod.type,
            periodStart: sourcePeriod.startDate,
            periodEnd: sourcePeriod.endDate,

            // Budget amounts
            allocatedAmount,
            originalAmount: allocatedAmount,

            // Budget name
            budgetName: budget.name,

            // Checklist items
            checklistItems: [],

            // User modifications
            isModified: false,

            // System fields
            createdAt: now,
            updatedAt: now,
            lastCalculated: now,
            isActive: true,

            // === PRIME PERIOD FIELDS ===
            isPrime: true,
            dailyRate,
            daysInPeriod,
            primePeriodIds: [],
            primePeriodBreakdown: [],
          };

          newPrimePeriods.push(budgetPeriod);
        }

        // Persist new prime periods first (CRITICAL: must complete before non-prime generation)
        if (newPrimePeriods.length > 0) {
          console.log(`  🔨 Creating ${newPrimePeriods.length} new PRIME budget periods`);
          await batchCreateBudgetPeriods(db, newPrimePeriods);
        }

        // === PHASE 2: Get ALL prime periods (existing + new) for non-prime calculation ===
        // We need all prime periods to correctly calculate non-prime amounts
        const allPrimePeriodsQuery = db.collection('budget_periods')
          .where('budgetId', '==', budget.id)
          .where('isPrime', '==', true);

        const allPrimePeriodsSnapshot = await allPrimePeriodsQuery.get();

        // Also include existing primes that might not have isPrime field (backward compat)
        const existingPrimePeriodsQuery = db.collection('budget_periods')
          .where('budgetId', '==', budget.id)
          .where('periodType', '==', primePeriodType);

        const existingPrimePeriodsSnapshot = await existingPrimePeriodsQuery.get();

        // Merge and deduplicate prime periods
        const primePeriodsMap = new Map<string, BudgetPeriodDocument>();

        // Add from isPrime query
        allPrimePeriodsSnapshot.docs.forEach(doc => {
          const period = { id: doc.id, ...doc.data() } as BudgetPeriodDocument;
          primePeriodsMap.set(doc.id, period);
        });

        // Add from periodType query (for backward compatibility)
        existingPrimePeriodsSnapshot.docs.forEach(doc => {
          if (!primePeriodsMap.has(doc.id)) {
            const period = { id: doc.id, ...doc.data() } as BudgetPeriodDocument;
            // Calculate dailyRate if not present (with 6 decimal precision)
            if (!period.dailyRate && period.allocatedAmount) {
              // Use UTC-normalized dates to avoid off-by-one errors
              const pStart = period.periodStart.toDate();
              const pEnd = period.periodEnd.toDate();
              const pStartUTC = Date.UTC(pStart.getUTCFullYear(), pStart.getUTCMonth(), pStart.getUTCDate());
              const pEndUTC = Date.UTC(pEnd.getUTCFullYear(), pEnd.getUTCMonth(), pEnd.getUTCDate());
              const days = Math.round((pEndUTC - pStartUTC) / (1000 * 60 * 60 * 24)) + 1;
              period.dailyRate = Math.round((period.allocatedAmount / days) * 1000000) / 1000000;
              period.daysInPeriod = days;
            }
            primePeriodsMap.set(doc.id, period);
          }
        });

        // Also add newly created prime periods
        newPrimePeriods.forEach(period => {
          primePeriodsMap.set(period.id!, period);
        });

        const allPrimePeriods = Array.from(primePeriodsMap.values());

        // Sort prime periods by start date
        allPrimePeriods.sort((a, b) => a.periodStart.toMillis() - b.periodStart.toMillis());

        console.log(`  📊 Total prime periods available for non-prime calculation: ${allPrimePeriods.length}`);

        // === PHASE 3: Generate new Non-Prime periods ===
        const newNonPrimePeriods: BudgetPeriodDocument[] = [];

        for (const [nonPrimeType, sourcePeriods] of nonPrimeSourcePeriodsByType) {
          console.log(`  📝 Processing ${nonPrimeType} non-prime periods (${sourcePeriods.length} source periods)`);

          for (const sourcePeriod of sourcePeriods) {
            // Skip if budget period already exists
            if (existingPeriodIds.has(sourcePeriod.id)) {
              continue;
            }

            // Convert Timestamps to Dates for the helper functions
            const periodStartDate = sourcePeriod.startDate.toDate();
            const periodEndDate = sourcePeriod.endDate.toDate();

            // Find overlapping prime periods
            const overlappingPrimes = findOverlappingPrimePeriods(
              periodStartDate,
              periodEndDate,
              allPrimePeriods
            );

            if (overlappingPrimes.length === 0) {
              console.warn(`  ⚠️ No overlapping prime periods for ${sourcePeriod.id}, skipping`);
              continue;
            }

            // Calculate contributions from prime periods
            const { totalAmount, breakdown } = calculatePrimeContributions(
              periodStartDate,
              periodEndDate,
              overlappingPrimes
            );

            // Calculate days in period using UTC-normalized dates to avoid off-by-one errors
            const npStart = sourcePeriod.startDate.toDate();
            const npEnd = sourcePeriod.endDate.toDate();
            const npStartUTC = Date.UTC(npStart.getUTCFullYear(), npStart.getUTCMonth(), npStart.getUTCDate());
            const npEndUTC = Date.UTC(npEnd.getUTCFullYear(), npEnd.getUTCMonth(), npEnd.getUTCDate());
            const daysInPeriod = Math.round((npEndUTC - npStartUTC) / (1000 * 60 * 60 * 24)) + 1;

            const allocatedAmount = Math.round(totalAmount * 100) / 100;
            const dailyRate = daysInPeriod > 0 ? Math.round((allocatedAmount / daysInPeriod) * 100) / 100 : 0;

            const budgetPeriod: BudgetPeriodDocument = {
              id: `${budget.id}_${sourcePeriod.id}`,
              budgetId: budget.id!,
              periodId: sourcePeriod.id!,
              sourcePeriodId: sourcePeriod.id!,
              familyId: String(budget.familyId || ''),

              // Ownership - inherit from budget
              userId: budget.access?.createdBy || budget.createdBy,
              createdBy: budget.access?.createdBy || budget.createdBy,
              ownerId: budget.access?.ownerId || budget.ownerId,
              groupId: budget.groupId,
              isPrivate: budget.access?.isPrivate ?? budget.isPrivate,
              accessibleBy: budget.accessibleBy,

              // Period context
              periodType: sourcePeriod.type,
              periodStart: sourcePeriod.startDate,
              periodEnd: sourcePeriod.endDate,

              // Budget amounts (derived from prime periods)
              allocatedAmount,
              originalAmount: allocatedAmount,

              // Budget name
              budgetName: budget.name,

              // Checklist items
              checklistItems: [],

              // User modifications
              isModified: false,

              // System fields
              createdAt: now,
              updatedAt: now,
              lastCalculated: now,
              isActive: true,

              // === NON-PRIME PERIOD FIELDS ===
              isPrime: false,
              dailyRate,
              daysInPeriod,
              primePeriodIds: overlappingPrimes.map(p => p.id!),
              primePeriodBreakdown: breakdown,
            };

            newNonPrimePeriods.push(budgetPeriod);
          }
        }

        // Persist non-prime periods
        if (newNonPrimePeriods.length > 0) {
          console.log(`  🔨 Creating ${newNonPrimePeriods.length} new NON-PRIME budget periods`);
          await batchCreateBudgetPeriods(db, newNonPrimePeriods);
        }

        const totalNewPeriods = newPrimePeriods.length + newNonPrimePeriods.length;

        if (totalNewPeriods === 0) {
          console.log(`  ✅ No new periods needed for budget ${budget.id}`);
        } else {
          // Update budget metadata
          await db.collection('budgets').doc(budget.id!).update({
            lastExtended: now,
          });
          console.log(`  ✅ Extended budget ${budget.id} with ${totalNewPeriods} new periods (${newPrimePeriods.length} prime, ${newNonPrimePeriods.length} non-prime)`);
        }

        totalPeriodsCreated += totalNewPeriods;
        budgetsProcessed++;

      } catch (error) {
        console.error(`❌ Error processing budget ${budget.id}:`, error);
        // Continue processing other budgets
      }
    }

    // Log final summary
    console.log(`🎯 Maintenance complete:`);
    console.log(`   - Budgets processed: ${budgetsProcessed}`);
    console.log(`   - Total periods created: ${totalPeriodsCreated}`);

  } catch (error) {
    console.error('❌ Fatal error in scheduled budget period extension:', error);
    throw error; // Re-throw to mark the function execution as failed
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
      const docRef = db.collection('budget_periods').doc(budgetPeriod.id!);
      batch.set(docRef, budgetPeriod);
    });

    await batch.commit();
    console.log(`  📦 Created batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(budgetPeriods.length / BATCH_SIZE)} (${batchPeriods.length} periods)`);
  }
}
