"use strict";
/**
 * Update Outflow Periods Utility
 *
 * Updates all outflow periods when parent outflow changes.
 * Only updates future unpaid periods to preserve historical payment data.
 *
 * Handles EXPECTED amounts and names/metadata only. What was PAID is written by
 * reconcile_recurring_period alone (on_recurring_updated enqueues it when transactionIds
 * change); the legacy auto-match + occurrence matcher that also ran here was retired
 * 2026-10-30 (Code-Health-Review F3 / M4-H2), as its income twin was (F1).
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.runUpdateOutflowPeriods = runUpdateOutflowPeriods;
const firestore_1 = require("firebase-admin/firestore");
/**
 * Helper: Calculate number of days in a period
 */
function calculateDaysInPeriod(period) {
    const start = period.periodStartDate.toDate();
    const end = period.periodEndDate.toDate();
    return Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)) + 1;
}
/**
 * Main function: Update all outflow periods when parent outflow changes
 *
 * @param db - Firestore instance
 * @param outflowId - The outflow ID
 * @param outflowBefore - Outflow data before update
 * @param outflowAfter - Outflow data after update
 * @returns Result with update statistics
 */
async function runUpdateOutflowPeriods(db, outflowId, outflowBefore, outflowAfter) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
    const result = {
        success: false,
        periodsQueried: 0,
        periodsUpdated: 0,
        periodsSkipped: 0,
        fieldsUpdated: [],
        errors: []
    };
    try {
        console.log(`[runUpdateOutflowPeriods] Starting update for outflow: ${outflowId}`);
        // Step 1: Detect which fields changed
        const changedFields = [];
        // The EFFECTIVE expected amount is the user's override when set, else Plaid's
        // average. A change to EITHER (edit the override, or Plaid refreshing the
        // average while no override is set) recomputes period amounts.
        const effectiveAmountBefore = (_a = outflowBefore.expectedAmountOverride) !== null && _a !== void 0 ? _a : outflowBefore.averageAmount;
        const effectiveAmount = (_b = outflowAfter.expectedAmountOverride) !== null && _b !== void 0 ? _b : outflowAfter.averageAmount;
        if (effectiveAmountBefore !== effectiveAmount) {
            changedFields.push("averageAmount");
            console.log(`[runUpdateOutflowPeriods] effective expected amount changed: ${effectiveAmountBefore} → ${effectiveAmount} (override=${(_c = outflowAfter.expectedAmountOverride) !== null && _c !== void 0 ? _c : "none"})`);
        }
        if (outflowBefore.userCustomName !== outflowAfter.userCustomName) {
            changedFields.push("userCustomName");
            console.log(`[runUpdateOutflowPeriods] userCustomName changed: "${outflowBefore.userCustomName}" → "${outflowAfter.userCustomName}"`);
        }
        // Check for description changes (separate from userCustomName)
        if (outflowBefore.description !== outflowAfter.description) {
            changedFields.push("description");
            console.log(`[runUpdateOutflowPeriods] description changed: "${outflowBefore.description}" → "${outflowAfter.description}"`);
        }
        // Check for merchantName changes
        if (outflowBefore.merchantName !== outflowAfter.merchantName) {
            changedFields.push("merchantName");
            console.log(`[runUpdateOutflowPeriods] merchantName changed: "${outflowBefore.merchantName}" → "${outflowAfter.merchantName}"`);
        }
        // Check for expenseType changes
        if (outflowBefore.expenseType !== outflowAfter.expenseType) {
            changedFields.push("expenseType");
            console.log(`[runUpdateOutflowPeriods] expenseType changed: "${outflowBefore.expenseType}" → "${outflowAfter.expenseType}"`);
        }
        // Check for isEssential changes
        if (outflowBefore.isEssential !== outflowAfter.isEssential) {
            changedFields.push("isEssential");
            console.log(`[runUpdateOutflowPeriods] isEssential changed: ${outflowBefore.isEssential} → ${outflowAfter.isEssential}`);
        }
        // Check for frequency changes
        if (outflowBefore.frequency !== outflowAfter.frequency) {
            changedFields.push("frequency");
            console.log(`[runUpdateOutflowPeriods] frequency changed: "${outflowBefore.frequency}" → "${outflowAfter.frequency}"`);
        }
        // Check for isActive changes
        if (outflowBefore.isActive !== outflowAfter.isActive) {
            changedFields.push("isActive");
            console.log(`[runUpdateOutflowPeriods] isActive changed: ${outflowBefore.isActive} → ${outflowAfter.isActive}`);
        }
        if (changedFields.length === 0) {
            console.log("[runUpdateOutflowPeriods] No relevant changes detected, skipping update");
            result.success = true;
            result.fieldsUpdated = [];
            return result;
        }
        result.fieldsUpdated = changedFields;
        console.log(`[runUpdateOutflowPeriods] Fields to update: ${changedFields.join(", ")}`);
        // Step 2: Query all periods for this outflow
        console.log(`[runUpdateOutflowPeriods] Querying periods for outflow: ${outflowId}`);
        const periodsSnapshot = await db.collection("outflow_periods")
            .where("outflowId", "==", outflowId)
            .get();
        result.periodsQueried = periodsSnapshot.size;
        console.log(`[runUpdateOutflowPeriods] Found ${result.periodsQueried} periods`);
        if (periodsSnapshot.empty) {
            console.log(`[runUpdateOutflowPeriods] No periods found for outflow ${outflowId}`);
            result.success = true;
            return result;
        }
        // Step 3: Separate periods into two groups
        // - allPeriods: For userCustomName changes (propagate to ALL periods including paid)
        // - unpaidPeriods: For amount changes (skip paid periods to preserve payment data)
        const allPeriods = periodsSnapshot.docs;
        const unpaidPeriods = [];
        let paidCount = 0;
        for (const periodDoc of periodsSnapshot.docs) {
            const period = periodDoc.data();
            // Check if period is paid/partially paid
            if (period.isPaid || period.isFullyPaid || period.isPartiallyPaid) {
                paidCount++;
                continue;
            }
            // Unpaid periods can receive amount updates
            unpaidPeriods.push(periodDoc);
        }
        console.log(`[runUpdateOutflowPeriods] All periods: ${allPeriods.length}`);
        console.log(`[runUpdateOutflowPeriods] Unpaid periods (for amount changes): ${unpaidPeriods.length}`);
        console.log(`[runUpdateOutflowPeriods] Paid periods (name-only updates): ${paidCount}`);
        // Determine which periods to update based on what changed.
        // EXPECTED-amount + name/metadata changes propagate to ALL periods — INCLUDING paid ones.
        // Rationale (locked 2026-08-21): the EXPECTED amount is what you *expect* the bill to be and
        // is independent of payment; only the ACTUAL paid amount (totalAmountPaid, occurrence.amountPaid)
        // is tied to the real transaction and is NEVER overwritten here. Previously amount changes were
        // gated to unpaid periods, so editing a bill whose current period was already paid silently did
        // nothing (the name — which always went to all periods — DID change), i.e. "name changes but
        // amount doesn't".
        const periodsToUpdate = allPeriods;
        result.periodsSkipped = 0;
        console.log(`[runUpdateOutflowPeriods] Periods to update: ${periodsToUpdate.length} (all; ${paidCount} paid get EXPECTED-only updates, actual paid amounts preserved)`);
        if (periodsToUpdate.length === 0) {
            console.log("[runUpdateOutflowPeriods] No periods need updating");
            result.success = true;
            return result;
        }
        // Step 4: Update periods in batches
        const batchSize = 500; // Firestore batch limit
        let updatedCount = 0;
        for (let i = 0; i < periodsToUpdate.length; i += batchSize) {
            const batch = db.batch();
            const batchPeriods = periodsToUpdate.slice(i, i + batchSize);
            for (const periodDoc of batchPeriods) {
                const period = periodDoc.data();
                const updates = {};
                // Handle averageAmount change (uses the EFFECTIVE amount: override ?? average)
                if (changedFields.includes("averageAmount")) {
                    const dailyRate = effectiveAmount / period.cycleDays;
                    const daysInPeriod = calculateDaysInPeriod(period);
                    // EXPECTED fields — recomputed on every period (paid included).
                    updates.averageAmount = effectiveAmount;
                    updates.amountWithheld = dailyRate * daysInPeriod;
                    // The period expects one amount per occurrence, as generation does (a weekly bill in a
                    // month has 4-5; a bill not due this period has 0) (Code-Health-Review M4-M3).
                    const occurrenceCount = (_f = (_d = period.numberOfOccurrencesInPeriod) !== null && _d !== void 0 ? _d : (_e = period.occurrences) === null || _e === void 0 ? void 0 : _e.length) !== null && _f !== void 0 ? _f : 1;
                    const totalDue = effectiveAmount * occurrenceCount;
                    updates.expectedAmount = totalDue;
                    updates.totalAmountDue = totalDue;
                    updates.amountPerOccurrence = effectiveAmount;
                    updates.dailyWithholdingRate = dailyRate;
                    // ACTUAL paid is tied to the transaction and is NOT touched here; only the
                    // derived "unpaid = expected − paid" is recomputed (clamped at 0 when overpaid).
                    updates.totalAmountUnpaid = Math.max(0, totalDue - (period.totalAmountPaid || 0));
                    // Update each occurrence's EXPECTED amountDue to the new amount, but PRESERVE its
                    // ACTUAL payment facts (amountPaid, isPaid, paymentDate, transactionSplitId, …).
                    if (period.occurrences && period.occurrences.length > 0) {
                        updates.occurrences = period.occurrences.map(occ => (Object.assign(Object.assign({}, occ), { amountDue: effectiveAmount })));
                        const paidOcc = period.occurrences.filter(o => o.isPaid).length;
                        console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: set amountDue=$${effectiveAmount.toFixed(2)} on ${period.occurrences.length} occurrence(s) (${paidOcc} paid — amountPaid preserved)`);
                    }
                    console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: updating amounts`);
                    console.log(`  - Daily rate: $${dailyRate.toFixed(2)}`);
                    console.log(`  - Days in period: ${daysInPeriod}`);
                    console.log(`  - Amount withheld: $${updates.amountWithheld.toFixed(2)}`);
                }
                // Handle userCustomName change
                if (changedFields.includes("userCustomName")) {
                    // Update userCustomName field on the period (this is what the frontend reads)
                    updates.userCustomName = outflowAfter.userCustomName || "";
                    // Also update description for backwards compatibility
                    updates.description = outflowAfter.userCustomName || outflowAfter.description;
                    console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: updating userCustomName to "${updates.userCustomName}"`);
                }
                // Handle description change (when not overridden by userCustomName)
                if (changedFields.includes("description") && !changedFields.includes("userCustomName")) {
                    // Only update description if userCustomName is not set
                    if (!outflowAfter.userCustomName) {
                        updates.description = outflowAfter.description || "";
                        console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: updating description to "${updates.description}"`);
                    }
                }
                // Handle merchantName change
                if (changedFields.includes("merchantName")) {
                    updates.merchantName = outflowAfter.merchantName || null;
                    console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: updating merchantName to "${updates.merchantName}"`);
                }
                // Handle expenseType change
                if (changedFields.includes("expenseType")) {
                    updates.expenseType = outflowAfter.expenseType;
                    console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: updating expenseType to "${updates.expenseType}"`);
                }
                // Handle isEssential change
                if (changedFields.includes("isEssential")) {
                    updates.isEssential = (_g = outflowAfter.isEssential) !== null && _g !== void 0 ? _g : false;
                    console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: updating isEssential to ${updates.isEssential}`);
                }
                // Handle isActive change - only affects unpaid periods
                // Check if this is a paid period (skip isActive update for paid periods)
                const isPaid = period.isPaid || period.isFullyPaid || period.isPartiallyPaid;
                if (changedFields.includes("isActive") && !isPaid) {
                    updates.isActive = (_h = outflowAfter.isActive) !== null && _h !== void 0 ? _h : true;
                    console.log(`[runUpdateOutflowPeriods] Period ${periodDoc.id}: updating isActive to ${updates.isActive}`);
                }
                // Apply updates via batch
                if (Object.keys(updates).length > 0) {
                    updates.updatedAt = firestore_1.Timestamp.now();
                    batch.update(periodDoc.ref, updates);
                    updatedCount++;
                }
            }
            // Commit batch
            await batch.commit();
            console.log(`[runUpdateOutflowPeriods] Committed batch ${Math.floor(i / batchSize) + 1}`);
        }
        result.periodsUpdated = updatedCount;
        result.success = true;
        console.log(`[runUpdateOutflowPeriods] ✓ Update complete: ${updatedCount} periods updated`);
    }
    catch (error) {
        console.error("[runUpdateOutflowPeriods] Error:", error);
        result.errors.push(error.message || "Unknown error");
    }
    return result;
}
//# sourceMappingURL=runUpdateOutflowPeriods.js.map