"use strict";
/**
 * Period Generation Orchestrator
 *
 * Orchestrates the Prime/Non-Prime budget period generation system.
 * This is the entry point for generating all budget periods using the new system.
 *
 * Process:
 * 1. Determine prime period type from budget.period
 * 2. Generate prime periods with calculated dailyRate
 * 3. Persist prime periods to Firestore (CRITICAL: must complete before step 4)
 * 4. In parallel: Generate non-prime periods for each non-prime type
 * 5. Persist non-prime periods to Firestore
 * 6. Return combined result
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateBudgetPeriodsWithPrimeSystem = generateBudgetPeriodsWithPrimeSystem;
const primePeriodGeneration_1 = require("./primePeriodGeneration");
const nonPrimePeriodGeneration_1 = require("./nonPrimePeriodGeneration");
const budgetPeriods_1 = require("./budgetPeriods");
/**
 * Generate all budget periods using the Prime/Non-Prime system
 *
 * This orchestrator function coordinates:
 * - Prime period generation (matches budget's period type)
 * - Non-prime period generation (derived from prime periods)
 * - Firestore persistence (primes first, then non-primes)
 * - Budget metadata updates
 *
 * @param db - Firestore instance
 * @param budgetId - Budget document ID
 * @param budget - Budget document data
 * @returns Result of period generation including count and period range
 */
async function generateBudgetPeriodsWithPrimeSystem(db, budgetId, budget) {
    console.log(`[periodGenerationOrchestrator] Starting Prime/Non-Prime period generation for budget ${budgetId}`);
    console.log(`[periodGenerationOrchestrator] Budget period type: ${budget.period}`);
    // Step 1: Determine date range for budget period generation
    const dateRange = await (0, budgetPeriods_1.determineBudgetPeriodDateRange)(db, budget);
    const { startDate, endDate } = dateRange;
    console.log(`[periodGenerationOrchestrator] Date range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    // Step 2: Determine prime and non-prime period types
    const primePeriodType = (0, primePeriodGeneration_1.getPrimePeriodType)(budget.period);
    const nonPrimePeriodTypes = (0, primePeriodGeneration_1.getNonPrimePeriodTypes)(budget.period);
    console.log(`[periodGenerationOrchestrator] Prime type: ${primePeriodType}`);
    console.log(`[periodGenerationOrchestrator] Non-prime types: ${nonPrimePeriodTypes.join(', ')}`);
    // Step 3: Generate prime periods
    console.log('[periodGenerationOrchestrator] === PHASE 1: GENERATING PRIME PERIODS ===');
    const primePeriods = await (0, primePeriodGeneration_1.generatePrimeBudgetPeriods)(db, budgetId, budget, startDate, endDate);
    console.log(`[periodGenerationOrchestrator] Generated ${primePeriods.length} prime periods`);
    if (primePeriods.length === 0) {
        throw new Error(`No prime ${primePeriodType} periods found in date range ${startDate.toISOString()} to ${endDate.toISOString()}. ` +
            'Please run generateSourcePeriods admin function.');
    }
    // Step 4: PERSIST PRIME PERIODS TO FIRESTORE (CRITICAL: must complete before non-prime generation)
    console.log('[periodGenerationOrchestrator] === PHASE 2: PERSISTING PRIME PERIODS ===');
    await (0, budgetPeriods_1.batchCreateBudgetPeriods)(db, primePeriods);
    console.log(`[periodGenerationOrchestrator] Persisted ${primePeriods.length} prime periods to Firestore`);
    // Step 5: Generate non-prime periods (in parallel for each type)
    console.log('[periodGenerationOrchestrator] === PHASE 3: GENERATING NON-PRIME PERIODS ===');
    const nonPrimeGenerationPromises = nonPrimePeriodTypes.map(async (periodType) => {
        return (0, nonPrimePeriodGeneration_1.generateNonPrimeBudgetPeriods)(db, budgetId, budget, primePeriods, // Use in-memory prime periods for calculations
        startDate, endDate, periodType);
    });
    const nonPrimePeriodsArrays = await Promise.all(nonPrimeGenerationPromises);
    const nonPrimePeriods = nonPrimePeriodsArrays.flat();
    console.log(`[periodGenerationOrchestrator] Generated ${nonPrimePeriods.length} non-prime periods`);
    // Step 6: Persist non-prime periods to Firestore
    console.log('[periodGenerationOrchestrator] === PHASE 4: PERSISTING NON-PRIME PERIODS ===');
    await (0, budgetPeriods_1.batchCreateBudgetPeriods)(db, nonPrimePeriods);
    console.log(`[periodGenerationOrchestrator] Persisted ${nonPrimePeriods.length} non-prime periods to Firestore`);
    // Step 7: Combine all periods for result calculation
    const allPeriods = [...primePeriods, ...nonPrimePeriods];
    // Sort by period start to get first and last periods
    const sortedPeriods = [...allPeriods].sort((a, b) => a.periodStart.toMillis() - b.periodStart.toMillis());
    // Count periods by type
    const periodTypeCounts = {
        weekly: allPeriods.filter(p => p.periodType === 'weekly').length,
        biMonthly: allPeriods.filter(p => p.periodType === 'bi_monthly').length,
        monthly: allPeriods.filter(p => p.periodType === 'monthly').length,
    };
    // Step 8: Update budget with period range tracking
    await (0, budgetPeriods_1.updateBudgetPeriodRange)(db, budgetId, sortedPeriods[0].periodId, sortedPeriods[sortedPeriods.length - 1].periodId, endDate, budget.budgetType === 'recurring');
    const result = {
        budgetPeriods: allPeriods,
        count: allPeriods.length,
        periodTypeCounts,
        firstPeriodId: sortedPeriods[0].periodId,
        lastPeriodId: sortedPeriods[sortedPeriods.length - 1].periodId,
    };
    console.log(`[periodGenerationOrchestrator] === GENERATION COMPLETE ===`);
    console.log(`[periodGenerationOrchestrator] Total periods created: ${result.count}`);
    console.log(`[periodGenerationOrchestrator] Period counts:`, {
        prime: primePeriods.length,
        nonPrime: nonPrimePeriods.length,
        weekly: periodTypeCounts.weekly,
        biMonthly: periodTypeCounts.biMonthly,
        monthly: periodTypeCounts.monthly,
    });
    return result;
}
//# sourceMappingURL=periodGenerationOrchestrator.js.map