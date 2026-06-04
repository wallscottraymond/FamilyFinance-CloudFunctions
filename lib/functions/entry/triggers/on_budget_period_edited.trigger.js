"use strict";
/**
 * On Budget Period Edited (Trigger)
 *
 * Syncs user-entered budget_period data — notes, checklist items, and modified
 * amount — across the overlapping periods of OTHER types for the same budget,
 * so an edit on a monthly period is reflected on the overlapping weekly /
 * bi-monthly periods (and vice versa).
 *
 * Reuses the existing sync utilities. Loop prevention relies on the `*SyncedAt`
 * timestamps those utilities stamp on the periods they write — if a sync
 * timestamp increased, this update was itself a sync, so we skip.
 *
 * Also handles period pause/resume (the "Pause This Period" toggle flips the
 * period's `isActive`): redistributes the period's allocation to/from Everything
 * Else via `handleBudgetPeriodPauseResume`.
 *
 * This restores the note/checklist/modified-amount + pause/resume portions of
 * the retired legacy `onBudgetPeriodUpdated` trigger. It does NOT handle rollover
 * recalculation (#6, depends on the spent pipeline). It is safe alongside the v2
 * period-generation cascade, which never writes these fields on an UPDATE.
 *
 * @module entry/triggers/on_budget_period_edited
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
exports.on_budget_period_edited = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const syncNotesToOverlappingPeriods_1 = require("../../budgets/utils/syncNotesToOverlappingPeriods");
const handleBudgetPeriodPauseResume_1 = require("../../budgets/utils/handleBudgetPeriodPauseResume");
exports.on_budget_period_edited = (0, firestore_1.onDocumentUpdated)({
    document: "budget_periods/{periodId}",
    region: "us-central1",
    memory: "256MiB",
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    timeoutSeconds: 30,
}, async (event) => {
    var _a, _b, _c, _d, _e;
    const period_id = event.params.periodId;
    const before = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const after = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
    if (!before || !after) {
        return;
    }
    // Loop prevention: skip writes the sync itself made (it stamps *SyncedAt).
    const ms = (v) => { var _a, _b; return (_b = (_a = v === null || v === void 0 ? void 0 : v.toMillis) === null || _a === void 0 ? void 0 : _a.call(v)) !== null && _b !== void 0 ? _b : 0; };
    const a = after;
    const b = before;
    if (ms(a.notesSyncedAt) > ms(b.notesSyncedAt) ||
        ms(a.checklistSyncedAt) > ms(b.checklistSyncedAt) ||
        ms(a.modifiedAmountSyncedAt) > ms(b.modifiedAmountSyncedAt)) {
        return;
    }
    // Detect which user-entered fields changed.
    const af = after;
    const bf = before;
    const notes_changed = before.userNotes !== after.userNotes;
    const checklist_changed = JSON.stringify((_c = bf.checklistItems) !== null && _c !== void 0 ? _c : []) !== JSON.stringify((_d = af.checklistItems) !== null && _d !== void 0 ? _d : []);
    const modified_changed = bf.modifiedAmount !== af.modifiedAmount || before.isModified !== after.isModified;
    // Period pause/resume — the "Pause This Period" toggle flips isActive.
    const active_changed = before.isActive !== after.isActive;
    if (!notes_changed && !checklist_changed && !modified_changed && !active_changed) {
        return;
    }
    const db = admin.firestore();
    const source = Object.assign(Object.assign({}, after), { id: period_id });
    try {
        if (notes_changed) {
            await (0, syncNotesToOverlappingPeriods_1.syncNotesToOverlappingPeriods)(db, source, after.userNotes);
        }
        if (checklist_changed) {
            await (0, syncNotesToOverlappingPeriods_1.syncChecklistToOverlappingPeriods)(db, source, (_e = af.checklistItems) !== null && _e !== void 0 ? _e : []);
        }
        if (modified_changed) {
            await (0, syncNotesToOverlappingPeriods_1.syncModifiedAmountToOverlappingPeriods)(db, source, af.modifiedAmount);
        }
        if (active_changed) {
            // Pausing redistributes this period's allocation to Everything Else;
            // resuming restores it. The util writes allocatedAmount (not isActive),
            // so it does not re-trigger this handler.
            const is_pausing = before.isActive === true && after.isActive === false;
            await (0, handleBudgetPeriodPauseResume_1.handleBudgetPeriodPauseResume)(db, period_id, after, is_pausing);
        }
    }
    catch (error) {
        // Non-fatal — a sync failure must not break the period edit.
        console.error(`[on_budget_period_edited] sync failed for ${period_id}:`, error);
    }
});
//# sourceMappingURL=on_budget_period_edited.trigger.js.map