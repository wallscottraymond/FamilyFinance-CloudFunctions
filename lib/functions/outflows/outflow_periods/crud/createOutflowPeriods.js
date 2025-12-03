"use strict";
/**
 * Outflow Period Creation - FLAT STRUCTURE
 *
 * Pure creation function for outflow_periods based on recurring outflows and source periods.
 * This is the single source of truth for outflow period generation.
 *
 * ARCHITECTURE: This is a pure orchestration function that delegates to utilities.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.calculatePeriodGenerationRange = void 0;
exports.createOutflowPeriodsFromSource = createOutflowPeriodsFromSource;
const firestore_1 = require("firebase-admin/firestore");
const utils_1 = require("../utils");
// Re-export utilities for backward compatibility
var utils_2 = require("../utils");
Object.defineProperty(exports, "calculatePeriodGenerationRange", { enumerable: true, get: function () { return utils_2.calculatePeriodGenerationRange; } });
/**
 * Create outflow periods from source periods for a given outflow - FLAT STRUCTURE
 *
 * UPDATED: Complete flat structure with multi-occurrence tracking.
 * - All fields at root level (no nested access, categories, metadata, relationships objects)
 * - Uses calculateAllOccurrencesInPeriod to handle variable occurrences (4 vs 5 Mondays)
 * - Tracks individual occurrence due dates, payment status, and transaction IDs
 * - Supports both unit tracking (2/4 paid) and dollar tracking ($20/$40)
 *
 * @param db - Firestore instance
 * @param outflowId - The outflow document ID
 * @param outflow - The recurring outflow data (flat structure)
 * @param startDate - Start date for period generation
 * @param endDate - End date for period generation
 * @returns Result with count and IDs of created periods
 */
async function createOutflowPeriodsFromSource(db, outflowId, outflow, // Accept flat outflow structure
startDate, endDate) {
    const now = firestore_1.Timestamp.now();
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('[createOutflowPeriodsFromSource] STARTING OUTFLOW PERIOD CREATION');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log(`[createOutflowPeriodsFromSource] Input Parameters:`);
    console.log(`  - Outflow ID: ${outflowId}`);
    console.log(`  - Description: ${outflow.description || 'N/A'}`);
    console.log(`  - Frequency: ${outflow.frequency}`);
    console.log(`  - Date Range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    // Extract fields from flat structure
    const ownerId = outflow.ownerId;
    const createdBy = outflow.createdBy;
    const groupId = outflow.groupId || null;
    const description = outflow.description || null;
    const merchantName = outflow.merchantName || null;
    // Get all source periods that overlap with our time range
    // Use year-based query (single range) to avoid Firestore limitation, then filter in memory
    const startYear = startDate.getFullYear();
    const endYear = endDate.getFullYear();
    console.log('');
    console.log('[createOutflowPeriodsFromSource] STEP 1: QUERY SOURCE PERIODS');
    console.log(`  - Start Year: ${startYear}`);
    console.log(`  - End Year: ${endYear}`);
    console.log(`  - Query: source_periods WHERE year >= ${startYear}`);
    console.log(`  - Note: Upper bound (year <= ${endYear}) will be filtered in memory`);
    // DIAGNOSTIC: Check what's actually in the collection
    console.log('');
    console.log('[createOutflowPeriodsFromSource] DIAGNOSTIC: Sampling collection...');
    const allPeriodsSnapshot = await db.collection('source_periods').limit(5).get();
    console.log(`  - Total sample size: ${allPeriodsSnapshot.size} documents`);
    if (!allPeriodsSnapshot.empty) {
        allPeriodsSnapshot.docs.forEach((doc, index) => {
            var _a, _b;
            const sample = doc.data();
            console.log(`  - Sample ${index + 1}: ID=${doc.id}, year=${sample.year}, type=${sample.type}, startDate=${(_a = sample.startDate) === null || _a === void 0 ? void 0 : _a.toDate().toISOString().split('T')[0]}, endDate=${(_b = sample.endDate) === null || _b === void 0 ? void 0 : _b.toDate().toISOString().split('T')[0]}`);
        });
    }
    else {
        console.warn('  ⚠️  WARNING: Collection appears to be EMPTY!');
    }
    // FIXED: Use single range query (Firestore doesn't support two range queries on same field)
    const sourcePeriodsQuery = db.collection('source_periods')
        .where('year', '>=', startYear);
    console.log('');
    console.log('[createOutflowPeriodsFromSource] Executing query...');
    const sourcePeriodsSnapshot = await sourcePeriodsQuery.get();
    console.log(`  ✓ Query returned ${sourcePeriodsSnapshot.size} documents`);
    if (sourcePeriodsSnapshot.empty) {
        console.error('');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('❌ QUERY FAILED: No source periods found');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error(`  - Query: year >= ${startYear}`);
        console.error(`  - Date range requested: ${startDate.toISOString()} to ${endDate.toISOString()}`);
        console.error(`  - Possible causes:`);
        console.error(`    1. source_periods collection is empty (check emulator data)`);
        console.error(`    2. No periods exist for year >= ${startYear}`);
        console.error(`    3. Data was not persisted (emulator restart without persistence)`);
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return { periodsCreated: 0, periodIds: [] };
    }
    // Filter for upper year bound in memory (Firestore limitation workaround)
    console.log('');
    console.log('[createOutflowPeriodsFromSource] Filtering year upper bound in memory...');
    const yearFilteredPeriods = sourcePeriodsSnapshot.docs.filter(doc => {
        const data = doc.data();
        const inRange = data.year <= endYear;
        if (!inRange) {
            console.log(`  - Excluded: ${doc.id} (year=${data.year} > ${endYear})`);
        }
        return inRange;
    });
    console.log(`  ✓ After year filter: ${yearFilteredPeriods.length} documents (excluded ${sourcePeriodsSnapshot.size - yearFilteredPeriods.length})`);
    if (yearFilteredPeriods.length === 0) {
        console.error('');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('❌ FILTER FAILED: No periods in year range');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error(`  - Year range: ${startYear} to ${endYear}`);
        console.error(`  - All ${sourcePeriodsSnapshot.size} periods were outside this range`);
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return { periodsCreated: 0, periodIds: [] };
    }
    // Filter in memory for periods that start on or after the outflow's firstDate
    // Only create periods for source_periods that begin after the bill existed
    console.log('');
    console.log('[createOutflowPeriodsFromSource] STEP 2: FILTER PERIODS BY START DATE');
    console.log(`  - Target range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
    console.log(`  - Filter logic: period.startDate >= ${startDate.toISOString().split('T')[0]} AND period.startDate <= ${endDate.toISOString().split('T')[0]}`);
    let overlapCount = 0;
    let excludedCount = 0;
    const overlappingPeriods = yearFilteredPeriods.filter(doc => {
        const data = doc.data();
        const periodStart = data.startDate.toDate();
        const periodEnd = data.endDate.toDate();
        const overlaps = periodStart >= startDate && periodStart <= endDate;
        if (overlaps) {
            overlapCount++;
            if (overlapCount <= 5) { // Log first 5 matches
                console.log(`  ✓ MATCH #${overlapCount}: ${doc.id} (${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]})`);
            }
        }
        else {
            excludedCount++;
            if (excludedCount <= 3) { // Log first 3 exclusions
                console.log(`  ✗ Excluded: ${doc.id} (${periodStart.toISOString().split('T')[0]} to ${periodEnd.toISOString().split('T')[0]}) - starts before outflow firstDate`);
            }
        }
        return overlaps;
    });
    console.log('');
    console.log(`[createOutflowPeriodsFromSource] Date filtering complete:`);
    console.log(`  ✓ Matching periods: ${overlappingPeriods.length}`);
    console.log(`  ✗ Excluded (started before firstDate): ${excludedCount}`);
    console.log(`  📊 Total processed: ${yearFilteredPeriods.length}`);
    if (overlappingPeriods.length === 0) {
        console.error('');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error('❌ DATE FILTER FAILED: No matching periods');
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.error(`  - Requested range: ${startDate.toISOString()} to ${endDate.toISOString()}`);
        console.error(`  - Periods checked: ${yearFilteredPeriods.length}`);
        console.error(`  - None of these periods start on or after the outflow's firstDate`);
        console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        return { periodsCreated: 0, periodIds: [] };
    }
    // Calculate payment cycle information
    const cycleInfo = (0, utils_1.calculatePaymentCycle)(outflow);
    console.log(`[createOutflowPeriodsFromSource] Payment cycle: ${cycleInfo.cycleDays} days, Bill: $${cycleInfo.billAmount.toFixed(2)}`);
    // Create outflow_periods for each source period
    const outflowPeriods = [];
    const periodIds = [];
    for (const doc of overlappingPeriods) {
        const sourcePeriod = Object.assign({ id: doc.id }, doc.data());
        // Calculate ALL occurrences in this period (handles variable 4 vs 5 Mondays)
        const occurrences = (0, utils_1.calculateAllOccurrencesInPeriod)(outflow, sourcePeriod);
        // Calculate withholding amounts for this period
        const periodCalc = (0, utils_1.calculateWithholdingAmount)(sourcePeriod, cycleInfo, outflow);
        // Calculate financial totals based on occurrences
        const amountPerOccurrence = cycleInfo.billAmount;
        const totalAmountDue = amountPerOccurrence * occurrences.numberOfOccurrences;
        const totalAmountPaid = 0; // At creation, nothing is paid yet
        const totalAmountUnpaid = totalAmountDue;
        // Initialize occurrence tracking arrays (all unpaid at creation)
        const occurrencePaidFlags = new Array(occurrences.numberOfOccurrences).fill(false);
        const occurrenceTransactionIds = new Array(occurrences.numberOfOccurrences).fill(null);
        // Calculate progress metrics
        const paymentProgressPercentage = 0; // No payments yet
        const dollarProgressPercentage = 0; // No payments yet
        // Determine payment status
        const isFullyPaid = false;
        const isPartiallyPaid = false;
        // Determine first and last due dates
        const firstDueDateInPeriod = occurrences.numberOfOccurrences > 0 ? occurrences.occurrenceDueDates[0] : null;
        const lastDueDateInPeriod = occurrences.numberOfOccurrences > 0
            ? occurrences.occurrenceDueDates[occurrences.numberOfOccurrences - 1]
            : null;
        const nextUnpaidDueDate = firstDueDateInPeriod; // First due date is next unpaid
        // No need to calculate status/days - these are computed on read
        if (occurrences.numberOfOccurrences > 0) {
            console.log(`[createOutflowPeriodsFromSource] ${description} - ${occurrences.numberOfOccurrences} occurrence(s) in ${sourcePeriod.id}: ` +
                `$${totalAmountDue.toFixed(2)} total (${occurrences.occurrenceDueDates.map(d => d.toDate().toISOString().split('T')[0]).join(', ')})`);
        }
        const periodId = `${outflowId}_${sourcePeriod.id}`;
        // Build FLAT outflow period structure
        const outflowPeriodDoc = {
            // === IDENTITY ===
            id: periodId,
            outflowId: outflowId,
            sourcePeriodId: sourcePeriod.id,
            // === OWNERSHIP & ACCESS (Query-Critical) ===
            ownerId: ownerId,
            createdBy: createdBy,
            updatedBy: createdBy,
            groupId: groupId,
            // === PLAID IDENTIFIERS ===
            accountId: outflow.accountId,
            plaidItemId: outflow.plaidItemId,
            // === FINANCIAL TRACKING ===
            actualAmount: null, // Null until transaction attached
            amountWithheld: periodCalc.amountWithheld,
            averageAmount: cycleInfo.billAmount, // Use bill amount as average
            expectedAmount: totalAmountDue,
            amountPerOccurrence: amountPerOccurrence,
            totalAmountDue: totalAmountDue,
            totalAmountPaid: totalAmountPaid,
            totalAmountUnpaid: totalAmountUnpaid,
            // === TIMESTAMPS ===
            createdAt: now,
            updatedAt: now,
            lastCalculated: now,
            // === PAYMENT CYCLE INFO ===
            currency: 'USD', // Default to USD, update from Plaid data if available
            cycleDays: cycleInfo.cycleDays,
            cycleStartDate: firestore_1.Timestamp.fromDate(new Date()), // Placeholder
            cycleEndDate: firestore_1.Timestamp.fromDate(new Date()), // Placeholder
            dailyWithholdingRate: periodCalc.amountWithheld / (0, utils_1.getDaysInPeriod)(sourcePeriod.startDate, sourcePeriod.endDate),
            // === OUTFLOW METADATA (Denormalized) ===
            description: description,
            frequency: outflow.frequency,
            // === PAYMENT STATUS ===
            isPaid: isFullyPaid, // Legacy: same as isFullyPaid
            isFullyPaid: isFullyPaid,
            isPartiallyPaid: isPartiallyPaid,
            isDuePeriod: occurrences.numberOfOccurrences > 0,
            // === CATEGORIZATION ===
            internalDetailedCategory: outflow.internalDetailedCategory || null,
            internalPrimaryCategory: outflow.internalPrimaryCategory || null,
            plaidPrimaryCategory: outflow.plaidPrimaryCategory || 'GENERAL_SERVICES',
            plaidDetailedCategory: outflow.plaidDetailedCategory || '',
            // === STATUS & CONTROL ===
            isActive: true,
            isHidden: false,
            // === MERCHANT INFO ===
            merchant: merchantName,
            payee: merchantName,
            // === PERIOD CONTEXT ===
            periodStartDate: sourcePeriod.startDate,
            periodEndDate: sourcePeriod.endDate,
            periodType: sourcePeriod.type,
            // === PLAID PREDICTION ===
            predictedNextDate: outflow.predictedNextDate || null,
            // === USER INTERACTION ===
            rules: [],
            tags: outflow.tags || [],
            type: outflow.type || 'expense',
            note: null,
            userCustomName: null,
            // === SOURCE ===
            source: outflow.source || 'plaid',
            // === TRANSACTION TRACKING ===
            transactionIds: [],
            // === MULTI-OCCURRENCE TRACKING ===
            numberOfOccurrencesInPeriod: occurrences.numberOfOccurrences,
            numberOfOccurrencesPaid: 0,
            numberOfOccurrencesUnpaid: occurrences.numberOfOccurrences,
            occurrenceDueDates: occurrences.occurrenceDueDates,
            occurrencePaidFlags: occurrencePaidFlags,
            occurrenceTransactionIds: occurrenceTransactionIds,
            // === PROGRESS METRICS ===
            paymentProgressPercentage: paymentProgressPercentage,
            dollarProgressPercentage: dollarProgressPercentage,
            // === DUE DATE TRACKING ===
            firstDueDateInPeriod: firstDueDateInPeriod,
            lastDueDateInPeriod: lastDueDateInPeriod,
            nextUnpaidDueDate: nextUnpaidDueDate
        };
        outflowPeriods.push(outflowPeriodDoc);
        periodIds.push(periodId);
    }
    console.log(`[createOutflowPeriodsFromSource] Creating ${outflowPeriods.length} FLAT outflow periods`);
    // Batch create all outflow_periods
    await (0, utils_1.batchCreateOutflowPeriods)(db, outflowPeriods);
    console.log(`[createOutflowPeriodsFromSource] Successfully created ${outflowPeriods.length} FLAT outflow periods`);
    return {
        periodsCreated: outflowPeriods.length,
        periodIds
    };
}
//# sourceMappingURL=createOutflowPeriods.js.map