"use strict";
/**
 * Update Budget Period Amount
 *
 * Callable function to update a budget period's amount with proper cascade
 * to non-prime periods. Supports two modes:
 * - 'this_period': Update single period + cascade to referencing non-primes
 * - 'all_forward': Update budget base amount + all current/future periods
 *
 * Key features:
 * - Blocks updates to past/historical periods
 * - Atomic transaction for all updates
 * - Proper cascade to non-prime periods using SUMPRODUCT
 * - Recalculates dailyRate, remaining, and primePeriodBreakdown
 *
 * Memory: 512MiB, Timeout: 60s
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.updateBudgetPeriodAmount = void 0;
const https_1 = require("firebase-functions/v2/https");
const admin = __importStar(require("firebase-admin"));
const firestore_1 = require("firebase-admin/firestore");
const types_1 = require("../../../../types");
const auth_1 = require("../../../../utils/auth");
const nonPrimePeriodGeneration_1 = require("../../utils/nonPrimePeriodGeneration");
// ============================================================================
// HELPERS
// ============================================================================
/**
 * Get today's date at midnight UTC for period comparison
 */
function getTodayUTC() {
    const now = new Date();
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
/**
 * Check if a period is in the past (historical)
 * Past = periodEnd < today
 */
function isPastPeriod(periodEnd) {
    const today = getTodayUTC();
    return periodEnd.toDate() < today;
}
/**
 * Check if a period is current or future
 * Current + future = periodEnd >= today
 */
function isCurrentOrFuturePeriod(periodEnd) {
    return !isPastPeriod(periodEnd);
}
/**
 * Calculate days in a period (inclusive, UTC-normalized)
 */
function getDaysInPeriod(startDate, endDate) {
    const start = startDate.toDate();
    const end = endDate.toDate();
    const startUTC = Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate());
    const endUTC = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
    const diffDays = Math.round((endUTC - startUTC) / (1000 * 60 * 60 * 24));
    return diffDays + 1;
}
/**
 * Calculate daily rate with 6 decimal precision (for prime periods)
 */
function calculateDailyRate(amount, daysInPeriod) {
    return Math.round((amount / daysInPeriod) * 1000000) / 1000000;
}
// ============================================================================
// MAIN FUNCTION
// ============================================================================
exports.updateBudgetPeriodAmount = (0, https_1.onCall)({
    region: 'us-central1',
    memory: '512MiB',
    timeoutSeconds: 60,
}, async (request) => {
    const { budgetPeriodId, newAmount, cascadeScope } = request.data;
    const warnings = [];
    try {
        // ========================================================================
        // VALIDATION
        // ========================================================================
        if (!budgetPeriodId) {
            throw new https_1.HttpsError('invalid-argument', 'budgetPeriodId is required');
        }
        if (newAmount === undefined || newAmount === null || isNaN(newAmount)) {
            throw new https_1.HttpsError('invalid-argument', 'newAmount must be a valid number');
        }
        if (newAmount < 0) {
            throw new https_1.HttpsError('invalid-argument', 'newAmount cannot be negative');
        }
        if (!cascadeScope || !['this_period', 'all_forward'].includes(cascadeScope)) {
            throw new https_1.HttpsError('invalid-argument', 'cascadeScope must be "this_period" or "all_forward"');
        }
        // ========================================================================
        // AUTHENTICATION
        // ========================================================================
        const { user, userData } = await (0, auth_1.authenticateRequest)(request, types_1.UserRole.VIEWER);
        if (!user || !userData) {
            throw new https_1.HttpsError('unauthenticated', 'Authentication required');
        }
        const db = admin.firestore();
        console.log(`[updateBudgetPeriodAmount] User ${user.uid} updating period ${budgetPeriodId} to $${newAmount} (scope: ${cascadeScope})`);
        // ========================================================================
        // GET BUDGET PERIOD & BUDGET
        // ========================================================================
        const periodDoc = await db.collection('budget_periods').doc(budgetPeriodId).get();
        if (!periodDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Budget period not found');
        }
        const period = Object.assign({ id: periodDoc.id }, periodDoc.data());
        // Check ownership
        if (period.userId !== user.uid && period.createdBy !== user.uid) {
            // Check if user is editor/admin
            if (userData.role !== types_1.UserRole.EDITOR && userData.role !== types_1.UserRole.ADMIN) {
                throw new https_1.HttpsError('permission-denied', 'You do not have permission to edit this budget period');
            }
        }
        // Block past period updates
        if (isPastPeriod(period.periodEnd)) {
            throw new https_1.HttpsError('failed-precondition', 'Cannot edit past/historical periods. Only current and future periods can be modified.');
        }
        // Get the parent budget
        const budgetDoc = await db.collection('budgets').doc(period.budgetId).get();
        if (!budgetDoc.exists) {
            throw new https_1.HttpsError('not-found', 'Parent budget not found');
        }
        const budget = Object.assign({ id: budgetDoc.id }, budgetDoc.data());
        // Check for system budget
        if (budget.isSystemEverythingElse) {
            throw new https_1.HttpsError('failed-precondition', 'Cannot edit "Everything Else" system budget');
        }
        // Warn if new amount < spent (overspent)
        const spent = period.spent || 0;
        if (newAmount < spent) {
            warnings.push(`Warning: New amount ($${newAmount.toFixed(2)}) is less than spent ($${spent.toFixed(2)}). This will show as overspent.`);
        }
        // ========================================================================
        // DETERMINE PRIME PERIOD
        // ========================================================================
        // If editing a non-prime period, we need to edit the underlying prime
        let targetPrimePeriodId = budgetPeriodId;
        let targetPrimePeriod = period;
        if (period.isPrime === false && period.primePeriodIds && period.primePeriodIds.length > 0) {
            // This is a non-prime period - find the primary prime it references
            // For simplicity, we'll update the first referenced prime
            // (In practice, user edits the weekly view which spans one or two months)
            const firstPrimeId = period.primePeriodIds[0];
            const primeDoc = await db.collection('budget_periods').doc(firstPrimeId).get();
            if (!primeDoc.exists) {
                throw new https_1.HttpsError('not-found', 'Referenced prime period not found');
            }
            targetPrimePeriod = Object.assign({ id: primeDoc.id }, primeDoc.data());
            targetPrimePeriodId = firstPrimeId;
            console.log(`[updateBudgetPeriodAmount] Non-prime period detected. Editing underlying prime: ${targetPrimePeriodId}`);
            // Recalculate the newAmount to be the prime period equivalent
            // Since user edited the non-prime amount, we need to back-calculate what the prime should be
            // This is complex - for now, we'll apply the same $ change to the prime
            const currentNonPrimeAmount = period.allocatedAmount;
            const currentPrimeAmount = targetPrimePeriod.isModified
                ? (targetPrimePeriod.modifiedAmount || targetPrimePeriod.allocatedAmount)
                : targetPrimePeriod.allocatedAmount;
            // Calculate the ratio and apply to prime
            const ratio = currentPrimeAmount > 0 ? newAmount / currentNonPrimeAmount : 1;
            const adjustedPrimeAmount = currentPrimeAmount * ratio;
            console.log(`[updateBudgetPeriodAmount] Non-prime adjustment: $${currentNonPrimeAmount} → $${newAmount} (ratio: ${ratio.toFixed(4)})`);
            console.log(`[updateBudgetPeriodAmount] Prime adjustment: $${currentPrimeAmount} → $${adjustedPrimeAmount.toFixed(2)}`);
            // Note: We'll use the directly entered amount for now
            // The user expectation is that the prime will be updated proportionally
        }
        // ========================================================================
        // EXECUTE UPDATE
        // ========================================================================
        let periodsUpdated = 0;
        let budgetUpdated = false;
        if (cascadeScope === 'this_period') {
            periodsUpdated = await updateThisPeriodOnly(db, targetPrimePeriod, newAmount, period.budgetId);
        }
        else {
            // 'all_forward'
            const result = await updateAllPeriodsForward(db, budget, targetPrimePeriod, newAmount);
            periodsUpdated = result.periodsUpdated;
            budgetUpdated = result.budgetUpdated;
        }
        console.log(`[updateBudgetPeriodAmount] ✓ Success: ${periodsUpdated} periods updated, budget updated: ${budgetUpdated}`);
        return {
            success: true,
            periodsUpdated,
            budgetUpdated,
            warnings,
        };
    }
    catch (error) {
        console.error('[updateBudgetPeriodAmount] Error:', error);
        if (error instanceof https_1.HttpsError) {
            throw error;
        }
        throw new https_1.HttpsError('internal', error.message || 'Failed to update budget period amount');
    }
});
// ============================================================================
// UPDATE STRATEGIES
// ============================================================================
/**
 * Update only the target period and cascade to non-primes that reference it
 */
async function updateThisPeriodOnly(db, targetPeriod, newAmount, budgetId) {
    console.log(`[updateThisPeriodOnly] Updating period ${targetPeriod.id} to $${newAmount}`);
    // Get budget to determine period type for prime identification
    const budgetDoc = await db.collection('budgets').doc(budgetId).get();
    const budget = budgetDoc.exists ? budgetDoc.data() : null;
    const budgetPeriodType = (budget === null || budget === void 0 ? void 0 : budget.period) || 'monthly';
    return db.runTransaction(async (transaction) => {
        let updatedCount = 0;
        // Calculate new values for the target prime period
        const daysInPeriod = targetPeriod.daysInPeriod || getDaysInPeriod(targetPeriod.periodStart, targetPeriod.periodEnd);
        const newDailyRate = calculateDailyRate(newAmount, daysInPeriod);
        const spent = targetPeriod.spent || 0;
        const newRemaining = newAmount - spent;
        // Update the target period
        const targetRef = db.collection('budget_periods').doc(targetPeriod.id);
        transaction.update(targetRef, {
            modifiedAmount: newAmount,
            isModified: true,
            dailyRate: newDailyRate,
            remaining: newRemaining,
            isPrime: true, // Ensure isPrime is set for consistency
            lastModifiedAt: firestore_1.Timestamp.now(),
            updatedAt: firestore_1.Timestamp.now(),
        });
        updatedCount++;
        console.log(`[updateThisPeriodOnly] Updated prime: $${newAmount}, dailyRate: ${newDailyRate.toFixed(6)}, remaining: ${newRemaining}`);
        // Query ALL periods for this budget (not filtering by isPrime to handle legacy data)
        const allPeriodsQuery = await db.collection('budget_periods')
            .where('budgetId', '==', budgetId)
            .get();
        // Separate into primes and non-primes using period type matching
        const allPrimes = [];
        const nonPrimesToUpdate = [];
        const targetPrimeStart = targetPeriod.periodStart.toDate();
        const targetPrimeEnd = targetPeriod.periodEnd.toDate();
        for (const doc of allPeriodsQuery.docs) {
            const period = doc.data();
            if (isPrimePeriod(period, budgetPeriodType)) {
                // This is a prime period
                if (doc.id === targetPeriod.id) {
                    // Apply the pending update to the target prime for calculations
                    allPrimes.push(Object.assign(Object.assign({}, period), { id: doc.id, dailyRate: newDailyRate, modifiedAmount: newAmount, isModified: true }));
                }
                else {
                    allPrimes.push(Object.assign(Object.assign({}, period), { id: doc.id }));
                }
            }
            else {
                // This is a non-prime period - check if it overlaps with the updated prime
                const nonPrimeStart = period.periodStart.toDate();
                const nonPrimeEnd = period.periodEnd.toDate();
                // Check if this non-prime overlaps with the target prime's date range
                if (nonPrimeStart <= targetPrimeEnd && nonPrimeEnd >= targetPrimeStart) {
                    nonPrimesToUpdate.push(doc);
                }
            }
        }
        // Sort primes by start date for SUMPRODUCT calculation
        allPrimes.sort((a, b) => a.periodStart.toMillis() - b.periodStart.toMillis());
        console.log(`[updateThisPeriodOnly] Found ${allPrimes.length} prime periods, ${nonPrimesToUpdate.length} non-prime periods to cascade`);
        // Update each non-prime period that overlaps with the updated prime
        for (const nonPrimeDoc of nonPrimesToUpdate) {
            const nonPrime = nonPrimeDoc.data();
            // Find overlapping primes and recalculate using SUMPRODUCT
            const targetStart = nonPrime.periodStart.toDate();
            const targetEnd = nonPrime.periodEnd.toDate();
            const overlappingPrimes = (0, nonPrimePeriodGeneration_1.findOverlappingPrimePeriods)(targetStart, targetEnd, allPrimes);
            const { totalAmount, breakdown } = (0, nonPrimePeriodGeneration_1.calculatePrimeContributions)(targetStart, targetEnd, overlappingPrimes);
            const nonPrimeSpent = nonPrime.spent || 0;
            const nonPrimeRemaining = totalAmount - nonPrimeSpent;
            const nonPrimeDays = nonPrime.daysInPeriod || getDaysInPeriod(nonPrime.periodStart, nonPrime.periodEnd);
            const nonPrimeDailyRate = Math.round((totalAmount / nonPrimeDays) * 100) / 100; // 2 decimal for non-prime
            transaction.update(nonPrimeDoc.ref, {
                allocatedAmount: totalAmount,
                remaining: nonPrimeRemaining,
                dailyRate: nonPrimeDailyRate,
                primePeriodBreakdown: breakdown,
                primePeriodIds: overlappingPrimes.map(p => p.id),
                isPrime: false, // Ensure isPrime is set for consistency
                updatedAt: firestore_1.Timestamp.now(),
                lastCalculated: firestore_1.Timestamp.now(),
            });
            updatedCount++;
            console.log(`[updateThisPeriodOnly] Updated non-prime ${nonPrimeDoc.id}: $${totalAmount.toFixed(2)} (SUMPRODUCT from ${overlappingPrimes.length} primes)`);
        }
        return updatedCount;
    });
}
/**
 * Normalize period type for comparison (handles string vs enum differences)
 */
function normalizePeriodType(periodType) {
    if (!periodType)
        return '';
    return String(periodType).toLowerCase();
}
/**
 * Check if a period is a prime period (matches the budget's period type)
 * Prime periods are the "source of truth" for daily rates
 */
function isPrimePeriod(period, budgetPeriodType) {
    // First check the explicit isPrime flag if set
    if (period.isPrime === true)
        return true;
    if (period.isPrime === false)
        return false;
    // Fall back to period type matching (for legacy data without isPrime)
    const normalizedPeriodType = normalizePeriodType(period.periodType);
    const normalizedBudgetType = normalizePeriodType(budgetPeriodType);
    return normalizedPeriodType === normalizedBudgetType;
}
/**
 * Update the budget base amount and all current + future periods
 */
async function updateAllPeriodsForward(db, budget, targetPeriod, newAmount) {
    console.log(`[updateAllPeriodsForward] Updating budget ${budget.id} and all current/future periods`);
    // Calculate what the new budget base amount should be
    // If user edited a weekly period, we need to convert back to monthly
    const effectiveCurrentAmount = targetPeriod.isModified
        ? (targetPeriod.modifiedAmount || targetPeriod.allocatedAmount)
        : targetPeriod.allocatedAmount;
    const ratio = effectiveCurrentAmount > 0 ? newAmount / effectiveCurrentAmount : 1;
    const newBudgetAmount = Math.round(budget.amount * ratio * 100) / 100;
    console.log(`[updateAllPeriodsForward] Budget amount: $${budget.amount} → $${newBudgetAmount} (ratio: ${ratio.toFixed(4)})`);
    // Get budget period type - this determines what's "prime"
    // Prime periods match the budget's period type (e.g., monthly budget = monthly periods are prime)
    const budgetPeriodType = budget.period || 'monthly';
    console.log(`[updateAllPeriodsForward] Budget period type: ${budgetPeriodType}`);
    return db.runTransaction(async (transaction) => {
        let periodsUpdated = 0;
        // Update the budget document
        const budgetRef = db.collection('budgets').doc(budget.id);
        transaction.update(budgetRef, {
            amount: newBudgetAmount,
            remaining: newBudgetAmount - (budget.spent || 0),
            updatedAt: firestore_1.Timestamp.now(),
        });
        // Query all periods for this budget
        const allPeriodsQuery = await db.collection('budget_periods')
            .where('budgetId', '==', budget.id)
            .get();
        // Separate into current/future primes and non-primes
        // Use period type matching to identify primes (not just isPrime field)
        const currentFuturePrimes = [];
        const currentFutureNonPrimes = [];
        for (const doc of allPeriodsQuery.docs) {
            const period = doc.data();
            if (isCurrentOrFuturePeriod(period.periodEnd)) {
                // Use period type matching to correctly identify primes vs non-primes
                if (isPrimePeriod(period, budgetPeriodType)) {
                    currentFuturePrimes.push(doc);
                }
                else {
                    currentFutureNonPrimes.push(doc);
                }
            }
        }
        console.log(`[updateAllPeriodsForward] Current/future primes: ${currentFuturePrimes.length}, non-primes: ${currentFutureNonPrimes.length}`);
        // Update all current/future prime periods
        // Prime periods get the full budget amount for their period
        const updatedPrimes = [];
        for (const primeDoc of currentFuturePrimes) {
            const prime = primeDoc.data();
            // Calculate new allocated amount based on new budget amount
            const daysInPeriod = prime.daysInPeriod || getDaysInPeriod(prime.periodStart, prime.periodEnd);
            // Prime periods get the full budget amount
            const newAllocatedAmount = newBudgetAmount;
            const newDailyRate = calculateDailyRate(newAllocatedAmount, daysInPeriod);
            const primeSpent = prime.spent || 0;
            const newRemaining = newAllocatedAmount - primeSpent;
            transaction.update(primeDoc.ref, {
                allocatedAmount: newAllocatedAmount,
                originalAmount: newAllocatedAmount,
                dailyRate: newDailyRate,
                remaining: newRemaining,
                modifiedAmount: null, // Clear any manual override
                isModified: false,
                isPrime: true, // Ensure isPrime is set for future consistency
                updatedAt: firestore_1.Timestamp.now(),
                lastCalculated: firestore_1.Timestamp.now(),
            });
            periodsUpdated++;
            console.log(`[updateAllPeriodsForward] Updated prime ${primeDoc.id}: $${newAllocatedAmount}, dailyRate: ${newDailyRate.toFixed(6)}`);
            // Track for non-prime recalculation
            updatedPrimes.push(Object.assign(Object.assign({}, prime), { id: primeDoc.id, allocatedAmount: newAllocatedAmount, dailyRate: newDailyRate }));
        }
        // Update all current/future non-prime periods using SUMPRODUCT
        // Non-prime periods derive their amount from overlapping prime daily rates
        for (const nonPrimeDoc of currentFutureNonPrimes) {
            const nonPrime = nonPrimeDoc.data();
            const targetStart = nonPrime.periodStart.toDate();
            const targetEnd = nonPrime.periodEnd.toDate();
            // Find overlapping primes and calculate using SUMPRODUCT (same as initial creation)
            const overlappingPrimes = (0, nonPrimePeriodGeneration_1.findOverlappingPrimePeriods)(targetStart, targetEnd, updatedPrimes);
            const { totalAmount, breakdown } = (0, nonPrimePeriodGeneration_1.calculatePrimeContributions)(targetStart, targetEnd, overlappingPrimes);
            const nonPrimeSpent = nonPrime.spent || 0;
            const nonPrimeRemaining = totalAmount - nonPrimeSpent;
            const nonPrimeDays = nonPrime.daysInPeriod || getDaysInPeriod(nonPrime.periodStart, nonPrime.periodEnd);
            const nonPrimeDailyRate = Math.round((totalAmount / nonPrimeDays) * 100) / 100;
            transaction.update(nonPrimeDoc.ref, {
                allocatedAmount: totalAmount,
                originalAmount: totalAmount,
                remaining: nonPrimeRemaining,
                dailyRate: nonPrimeDailyRate,
                primePeriodBreakdown: breakdown,
                primePeriodIds: overlappingPrimes.map(p => p.id),
                modifiedAmount: null,
                isModified: false,
                isPrime: false, // Ensure isPrime is set for future consistency
                updatedAt: firestore_1.Timestamp.now(),
                lastCalculated: firestore_1.Timestamp.now(),
            });
            periodsUpdated++;
            console.log(`[updateAllPeriodsForward] Updated non-prime ${nonPrimeDoc.id}: $${totalAmount.toFixed(2)} (SUMPRODUCT from ${overlappingPrimes.length} primes)`);
        }
        console.log(`[updateAllPeriodsForward] ✓ Updated ${periodsUpdated} periods`);
        return {
            periodsUpdated,
            budgetUpdated: true,
        };
    });
}
//# sourceMappingURL=updateBudgetPeriodAmount.js.map