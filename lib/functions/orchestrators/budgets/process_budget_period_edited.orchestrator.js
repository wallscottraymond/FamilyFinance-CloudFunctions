"use strict";
/**
 * Process Budget Period Edited Orchestrator
 *
 * The control-flow brain behind the `on_budget_period_edited` trigger. Given a
 * budget_period's before/after snapshots it decides what (if anything) to sync
 * across the overlapping periods of OTHER types for the same budget:
 *   • notes / checklist / modified-amount edits → propagate via the sync utils
 *   • pause/resume (isActive flip)              → redistribute the allocation
 *
 * Loop prevention: the sync utils stamp `*SyncedAt`; if one increased, this
 * update was itself a sync, so we skip.
 *
 * NOTE (legacy coupling): the cross-period sync is still performed by the legacy
 * `budgets/utils/syncNotesToOverlappingPeriods` + `handleBudgetPeriodPauseResume`
 * helpers (they own the overlap query + writes for this legacy feature, like a
 * scoped repo). Repo-ifying them is tracked as follow-up; the orchestrator only
 * delegates to them.
 *
 * @module orchestrators/budgets/process_budget_period_edited
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
exports.process_budget_period_edited_orchestrator = process_budget_period_edited_orchestrator;
const admin = __importStar(require("firebase-admin"));
const observability_1 = require("../../observability");
const syncNotesToOverlappingPeriods_1 = require("../../budgets/utils/syncNotesToOverlappingPeriods");
const handleBudgetPeriodPauseResume_1 = require("../../budgets/utils/handleBudgetPeriodPauseResume");
/**
 * True when this update was itself written by a sync pass (a `*SyncedAt` stamp
 * increased) — in which case there is nothing to propagate.
 */
function is_sync_echo(before, after) {
    const ms = (v) => { var _a, _b; return (_b = (_a = v === null || v === void 0 ? void 0 : v.toMillis) === null || _a === void 0 ? void 0 : _a.call(v)) !== null && _b !== void 0 ? _b : 0; };
    const a = after;
    const b = before;
    return (ms(a.notesSyncedAt) > ms(b.notesSyncedAt) ||
        ms(a.checklistSyncedAt) > ms(b.checklistSyncedAt) ||
        ms(a.modifiedAmountSyncedAt) > ms(b.modifiedAmountSyncedAt));
}
async function process_budget_period_edited_orchestrator(ctx, input) {
    var _a, _b, _c;
    const span = (0, observability_1.create_span)(ctx, "orchestrator", "process_budget_period_edited");
    (0, observability_1.log_operation_start)(span, "system");
    const { period_id, before, after } = input;
    if (is_sync_echo(before, after)) {
        (0, observability_1.log_operation_success)(span, "system");
        return;
    }
    // Detect which user-entered fields changed.
    const af = after;
    const bf = before;
    const notes_changed = before.userNotes !== after.userNotes;
    const checklist_changed = JSON.stringify((_a = bf.checklistItems) !== null && _a !== void 0 ? _a : []) !== JSON.stringify((_b = af.checklistItems) !== null && _b !== void 0 ? _b : []);
    const modified_changed = bf.modifiedAmount !== af.modifiedAmount || before.isModified !== after.isModified;
    // Period pause/resume — the "Pause This Period" toggle flips isActive.
    const active_changed = before.isActive !== after.isActive;
    if (!notes_changed && !checklist_changed && !modified_changed && !active_changed) {
        (0, observability_1.log_operation_success)(span, "system");
        return;
    }
    const db = admin.firestore();
    const source = Object.assign(Object.assign({}, after), { id: period_id });
    try {
        if (notes_changed) {
            await (0, syncNotesToOverlappingPeriods_1.syncNotesToOverlappingPeriods)(db, source, after.userNotes);
        }
        if (checklist_changed) {
            await (0, syncNotesToOverlappingPeriods_1.syncChecklistToOverlappingPeriods)(db, source, (_c = af.checklistItems) !== null && _c !== void 0 ? _c : []);
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
        console.error(`[process_budget_period_edited] sync failed for ${period_id}:`, error);
    }
    (0, observability_1.log_operation_success)(span, "system");
}
//# sourceMappingURL=process_budget_period_edited.orchestrator.js.map