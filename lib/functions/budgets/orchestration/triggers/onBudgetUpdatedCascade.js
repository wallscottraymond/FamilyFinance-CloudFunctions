"use strict";
/**
 * Budget Update Cascade Trigger
 *
 * Cascades budget field changes to budget_periods.
 * Handles: name, amount, description, alertThreshold changes.
 *
 * This trigger complements onBudgetUpdatedReassignTransactions which
 * handles categoryIds changes (transaction reassignment).
 *
 * Update Strategy:
 * - Changes cascade to current + future periods only
 * - Historical periods (periodEnd < today) are preserved
 * - Uses the same pattern as inflows/outflows
 *
 * Memory: 512MiB (for batch operations)
 * Timeout: 60s
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
exports.onBudgetUpdatedCascade = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const runUpdateBudgetPeriods_1 = require("../../utils/runUpdateBudgetPeriods");
const redistributeBudgetAllocation_1 = require("../../utils/redistributeBudgetAllocation");
const handleBudgetDateChanges_1 = require("../../utils/handleBudgetDateChanges");
/**
 * Trigger: Cascade budget field changes to budget_periods
 *
 * Fires when a budget document is updated. Detects changes to
 * name, amount, description, alertThreshold and cascades them
 * to current + future budget_periods.
 */
exports.onBudgetUpdatedCascade = (0, firestore_1.onDocumentUpdated)({
    document: "budgets/{budgetId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60
}, async (event) => {
    var _a, _b, _c;
    try {
        const budgetId = event.params.budgetId;
        const beforeData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
        const afterData = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
        if (!beforeData || !afterData) {
            console.error("[onBudgetUpdatedCascade] Missing before or after data");
            return;
        }
        console.log('');
        console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
        console.log('[onBudgetUpdatedCascade] BUDGET UPDATED - CHECKING FOR CASCADE');
        console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
        console.log(`[onBudgetUpdatedCascade] Budget ID: ${budgetId}`);
        console.log(`[onBudgetUpdatedCascade] Name: ${afterData.name}`);
        console.log(`[onBudgetUpdatedCascade] isActive: ${afterData.isActive}`);
        console.log('');
        // Initialize Firestore
        const db = admin.firestore();
        // Handle isActive changes (pause/resume) FIRST before any early returns
        // This only affects the CURRENT period, not all periods
        if (beforeData.isActive !== afterData.isActive) {
            console.log('');
            console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
            console.log('[onBudgetUpdatedCascade] BUDGET isActive CHANGED - REDISTRIBUTION');
            console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
            console.log(`[onBudgetUpdatedCascade] isActive: ${beforeData.isActive} → ${afterData.isActive}`);
            // Don't redistribute if this is a system "Everything Else" budget
            if (afterData.isSystemEverythingElse) {
                console.log(`[onBudgetUpdatedCascade] Skipping redistribution for system budget`);
            }
            else {
                // Get userId from budget (supports both patterns)
                const userId = afterData.userId || ((_c = afterData.access) === null || _c === void 0 ? void 0 : _c.createdBy);
                if (!userId) {
                    console.error(`[onBudgetUpdatedCascade] No userId found on budget`);
                }
                else {
                    const isPausing = !afterData.isActive;
                    const redistributionResult = await (0, redistributeBudgetAllocation_1.redistributeBudgetAllocation)(db, budgetId, userId, isPausing);
                    if (redistributionResult.success) {
                        console.log(`[onBudgetUpdatedCascade] ✓ Redistribution ${redistributionResult.action}`);
                        console.log(`[onBudgetUpdatedCascade] ✓ Amount: $${redistributionResult.amountRedistributed.toFixed(2)}`);
                        console.log(`[onBudgetUpdatedCascade] ✓ Budget Period: ${redistributionResult.budgetPeriodId}`);
                        console.log(`[onBudgetUpdatedCascade] ✓ Everything Else Period: ${redistributionResult.everythingElsePeriodId}`);
                    }
                    else {
                        console.error(`[onBudgetUpdatedCascade] ⚠️  Redistribution failed: ${redistributionResult.error}`);
                    }
                }
            }
            console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
            console.log('');
        }
        // Skip field cascade if budget is now inactive (only redistribution matters)
        if (!afterData.isActive) {
            console.log(`[onBudgetUpdatedCascade] Skipping field cascade for inactive budget: ${budgetId}`);
            return;
        }
        // Run the update cascade logic
        console.log('[onBudgetUpdatedCascade] Calling runUpdateBudgetPeriods...');
        const result = await (0, runUpdateBudgetPeriods_1.runUpdateBudgetPeriods)(db, budgetId, beforeData, afterData);
        console.log('');
        console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
        console.log('[onBudgetUpdatedCascade] CASCADE COMPLETE');
        console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
        if (result.fieldsUpdated.length === 0) {
            console.log(`[onBudgetUpdatedCascade] No cascade-able changes detected`);
        }
        else {
            console.log(`[onBudgetUpdatedCascade] ✓ Fields changed: ${result.fieldsUpdated.join(', ')}`);
            console.log(`[onBudgetUpdatedCascade] ✓ Periods queried: ${result.periodsQueried}`);
            console.log(`[onBudgetUpdatedCascade] ✓ Periods updated: ${result.periodsUpdated}`);
            console.log(`[onBudgetUpdatedCascade] ✓ Periods skipped (historical): ${result.periodsSkipped}`);
        }
        if (result.errors.length > 0) {
            console.log(`[onBudgetUpdatedCascade] ⚠️  Errors encountered: ${result.errors.length}`);
            result.errors.forEach((err, idx) => {
                console.log(`[onBudgetUpdatedCascade]    ${idx + 1}. ${err}`);
            });
        }
        console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
        console.log('');
        // Handle date-related changes (startDate, isOngoing, budgetEndDate)
        const dateChangeResult = await (0, handleBudgetDateChanges_1.handleBudgetDateChanges)(db, budgetId, beforeData, afterData);
        if (dateChangeResult.startDateChange.detected || dateChangeResult.endDateChange.detected) {
            console.log('');
            console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
            console.log('[onBudgetUpdatedCascade] DATE CHANGE HANDLING COMPLETE');
            console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
            if (dateChangeResult.startDateChange.detected) {
                console.log(`[onBudgetUpdatedCascade] ✓ Start date: deactivated=${dateChangeResult.startDateChange.periodsDeactivated}, generated=${dateChangeResult.startDateChange.periodsGenerated}`);
            }
            if (dateChangeResult.endDateChange.detected) {
                console.log(`[onBudgetUpdatedCascade] ✓ End date: deactivated=${dateChangeResult.endDateChange.periodsDeactivated}, reactivated=${dateChangeResult.endDateChange.periodsReactivated}`);
            }
            if (dateChangeResult.errors.length > 0) {
                console.log(`[onBudgetUpdatedCascade] ⚠️  Date change errors: ${dateChangeResult.errors.join(', ')}`);
            }
            console.log('[onBudgetUpdatedCascade] ════════════════════════════════════════════');
            console.log('');
        }
    }
    catch (error) {
        console.error('');
        console.error('[onBudgetUpdatedCascade] ❌ CRITICAL ERROR:', error);
        console.error('');
        // Don't throw - we don't want to break budget updates if cascade fails
    }
});
//# sourceMappingURL=onBudgetUpdatedCascade.js.map