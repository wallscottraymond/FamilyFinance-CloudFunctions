"use strict";
/**
 * Budget Period Update Trigger
 *
 * Handles budget_period document updates, specifically:
 * - Syncing userNotes to overlapping periods of other types
 * - Syncing checklistItems to overlapping periods
 * - Syncing modifiedAmount to overlapping periods
 *
 * This ensures that user-entered data is consistent across all
 * period views (monthly, weekly, bi-monthly) for the same budget.
 *
 * Memory: 256MiB (lightweight sync operations)
 * Timeout: 30s
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
exports.onBudgetPeriodUpdated = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const syncNotesToOverlappingPeriods_1 = require("../../utils/syncNotesToOverlappingPeriods");
const handleBudgetPeriodPauseResume_1 = require("../../utils/handleBudgetPeriodPauseResume");
/**
 * Trigger: Sync budget period changes to overlapping periods
 *
 * Fires when a budget_period document is updated. Detects changes to
 * userNotes, checklistItems, and modifiedAmount and syncs them
 * to overlapping periods of other types.
 */
exports.onBudgetPeriodUpdated = (0, firestore_1.onDocumentUpdated)({
    document: "budget_periods/{periodId}",
    region: "us-central1",
    memory: "256MiB",
    timeoutSeconds: 30
}, async (event) => {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
    try {
        const periodId = event.params.periodId;
        const beforeData = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
        const afterData = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
        if (!beforeData || !afterData) {
            console.error("[onBudgetPeriodUpdated] Missing before or after data");
            return;
        }
        // Skip if this is a synced update (prevent infinite loop)
        const beforeSyncedAt = (_e = (_d = (_c = beforeData.notesSyncedAt) === null || _c === void 0 ? void 0 : _c.toMillis) === null || _d === void 0 ? void 0 : _d.call(_c)) !== null && _e !== void 0 ? _e : 0;
        const afterSyncedAt = (_h = (_g = (_f = afterData.notesSyncedAt) === null || _f === void 0 ? void 0 : _f.toMillis) === null || _g === void 0 ? void 0 : _g.call(_f)) !== null && _h !== void 0 ? _h : 0;
        const beforeChecklistSyncedAt = (_l = (_k = (_j = beforeData.checklistSyncedAt) === null || _j === void 0 ? void 0 : _j.toMillis) === null || _k === void 0 ? void 0 : _k.call(_j)) !== null && _l !== void 0 ? _l : 0;
        const afterChecklistSyncedAt = (_p = (_o = (_m = afterData.checklistSyncedAt) === null || _m === void 0 ? void 0 : _m.toMillis) === null || _o === void 0 ? void 0 : _o.call(_m)) !== null && _p !== void 0 ? _p : 0;
        const beforeModifiedSyncedAt = (_s = (_r = (_q = beforeData.modifiedAmountSyncedAt) === null || _q === void 0 ? void 0 : _q.toMillis) === null || _r === void 0 ? void 0 : _r.call(_q)) !== null && _s !== void 0 ? _s : 0;
        const afterModifiedSyncedAt = (_v = (_u = (_t = afterData.modifiedAmountSyncedAt) === null || _t === void 0 ? void 0 : _t.toMillis) === null || _u === void 0 ? void 0 : _u.call(_t)) !== null && _v !== void 0 ? _v : 0;
        // If any sync timestamp changed, this is a cascaded update - skip to prevent loop
        if (afterSyncedAt > beforeSyncedAt ||
            afterChecklistSyncedAt > beforeChecklistSyncedAt ||
            afterModifiedSyncedAt > beforeModifiedSyncedAt) {
            console.log(`[onBudgetPeriodUpdated] Skipping cascaded sync update for period: ${periodId}`);
            return;
        }
        // Detect what changed
        const notesChanged = beforeData.userNotes !== afterData.userNotes;
        const checklistChanged = JSON.stringify(beforeData.checklistItems || []) !==
            JSON.stringify(afterData.checklistItems || []);
        const modifiedAmountChanged = beforeData.modifiedAmount !== afterData.modifiedAmount ||
            beforeData.isModified !== afterData.isModified;
        const isActiveChanged = beforeData.isActive !== afterData.isActive;
        // Skip if nothing we care about changed
        if (!notesChanged && !checklistChanged && !modifiedAmountChanged && !isActiveChanged) {
            return;
        }
        console.log('');
        console.log('[onBudgetPeriodUpdated] ════════════════════════════════════════════');
        console.log('[onBudgetPeriodUpdated] BUDGET PERIOD UPDATED - SYNC CHECK');
        console.log('[onBudgetPeriodUpdated] ════════════════════════════════════════════');
        console.log(`[onBudgetPeriodUpdated] Period ID: ${periodId}`);
        console.log(`[onBudgetPeriodUpdated] Budget ID: ${afterData.budgetId}`);
        console.log(`[onBudgetPeriodUpdated] Period Type: ${afterData.periodType}`);
        console.log(`[onBudgetPeriodUpdated] Notes changed: ${notesChanged}`);
        console.log(`[onBudgetPeriodUpdated] Checklist changed: ${checklistChanged}`);
        console.log(`[onBudgetPeriodUpdated] Modified amount changed: ${modifiedAmountChanged}`);
        console.log(`[onBudgetPeriodUpdated] isActive changed: ${isActiveChanged} (${beforeData.isActive} → ${afterData.isActive})`);
        console.log('');
        // Initialize Firestore
        const db = admin.firestore();
        // Build source period object with id included
        const sourcePeriod = Object.assign(Object.assign({}, afterData), { id: periodId });
        // Sync notes if changed
        if (notesChanged) {
            console.log('[onBudgetPeriodUpdated] Syncing notes to overlapping periods...');
            const notesResult = await (0, syncNotesToOverlappingPeriods_1.syncNotesToOverlappingPeriods)(db, sourcePeriod, afterData.userNotes);
            if (notesResult.success) {
                console.log(`[onBudgetPeriodUpdated] ✓ Notes synced to ${notesResult.periodsUpdated} periods`);
            }
            else {
                console.error(`[onBudgetPeriodUpdated] ⚠️  Notes sync errors: ${notesResult.errors.join(', ')}`);
            }
        }
        // Sync checklist if changed
        if (checklistChanged) {
            console.log('[onBudgetPeriodUpdated] Syncing checklist to overlapping periods...');
            const checklistResult = await (0, syncNotesToOverlappingPeriods_1.syncChecklistToOverlappingPeriods)(db, sourcePeriod, afterData.checklistItems || []);
            if (checklistResult.success) {
                console.log(`[onBudgetPeriodUpdated] ✓ Checklist synced to ${checklistResult.periodsUpdated} periods`);
            }
            else {
                console.error(`[onBudgetPeriodUpdated] ⚠️  Checklist sync errors: ${checklistResult.errors.join(', ')}`);
            }
        }
        // Sync modified amount if changed
        if (modifiedAmountChanged) {
            console.log('[onBudgetPeriodUpdated] Syncing modified amount to overlapping periods...');
            const modifiedResult = await (0, syncNotesToOverlappingPeriods_1.syncModifiedAmountToOverlappingPeriods)(db, sourcePeriod, afterData.modifiedAmount);
            if (modifiedResult.success) {
                console.log(`[onBudgetPeriodUpdated] ✓ Modified amount synced to ${modifiedResult.periodsUpdated} periods`);
            }
            else {
                console.error(`[onBudgetPeriodUpdated] ⚠️  Modified amount sync errors: ${modifiedResult.errors.join(', ')}`);
            }
        }
        // Handle isActive change (pause/resume)
        if (isActiveChanged) {
            const isPausing = beforeData.isActive === true && afterData.isActive === false;
            console.log(`[onBudgetPeriodUpdated] ${isPausing ? 'PAUSING' : 'RESUMING'} budget period...`);
            const pauseResumeResult = await (0, handleBudgetPeriodPauseResume_1.handleBudgetPeriodPauseResume)(db, periodId, afterData, isPausing);
            if (pauseResumeResult.success) {
                console.log(`[onBudgetPeriodUpdated] ✓ ${pauseResumeResult.action}: ${pauseResumeResult.message}`);
            }
            else {
                console.error(`[onBudgetPeriodUpdated] ⚠️ Pause/resume error: ${pauseResumeResult.error}`);
            }
        }
        console.log('[onBudgetPeriodUpdated] ════════════════════════════════════════════');
        console.log('[onBudgetPeriodUpdated] SYNC COMPLETE');
        console.log('[onBudgetPeriodUpdated] ════════════════════════════════════════════');
        console.log('');
    }
    catch (error) {
        console.error('');
        console.error('[onBudgetPeriodUpdated] ❌ CRITICAL ERROR:', error);
        console.error('');
        // Don't throw - we don't want to break period updates if sync fails
    }
});
//# sourceMappingURL=onBudgetPeriodUpdated.js.map