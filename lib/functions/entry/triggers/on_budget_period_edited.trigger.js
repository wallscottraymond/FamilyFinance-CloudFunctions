"use strict";
/**
 * On Budget Period Edited (Trigger)
 *
 * Syncs user-entered budget_period data — notes, checklist items, and modified
 * amount — across the overlapping periods of OTHER types for the same budget,
 * so an edit on a monthly period is reflected on the overlapping weekly /
 * bi-monthly periods (and vice versa).
 *
 * Thin trigger: extracts the before/after snapshots, applies an event-id
 * idempotency guard, and calls exactly ONE orchestrator
 * (`process_budget_period_edited`) which holds the change-detection, loop
 * prevention, and the cross-period sync. Restores the note/checklist/
 * modified-amount + pause/resume portions of the retired legacy
 * `onBudgetPeriodUpdated` trigger (rollover #6 still deferred).
 *
 * @module entry/triggers/on_budget_period_edited
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.on_budget_period_edited = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const observability_1 = require("../../observability");
const infrastructure_1 = require("../../repositories/infrastructure");
const process_budget_period_edited_orchestrator_1 = require("../../orchestrators/budgets/process_budget_period_edited.orchestrator");
exports.on_budget_period_edited = (0, firestore_1.onDocumentUpdated)({
    document: "budget_periods/{periodId}",
    region: "us-central1",
    memory: "256MiB",
    /* eslint-disable-next-line @typescript-eslint/naming-convention */
    timeoutSeconds: 30,
}, async (event) => {
    var _a, _b;
    const period_id = event.params.periodId;
    const before = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before.data();
    const after = (_b = event.data) === null || _b === void 0 ? void 0 : _b.after.data();
    if (!before || !after) {
        return;
    }
    const trace = (0, observability_1.create_trigger_trace)(period_id, event.id);
    // Idempotency guard: triggers fire at-least-once, so skip replays of the
    // SAME event (key = trigger:${period_id}:${event.id}).
    if (await (0, infrastructure_1.is_trigger_processed)(trace, trace.idempotency_key)) {
        return;
    }
    await (0, process_budget_period_edited_orchestrator_1.process_budget_period_edited_orchestrator)(trace, {
        period_id,
        before,
        after,
    });
    await (0, infrastructure_1.mark_trigger_processed)(trace, trace.idempotency_key, period_id, event.id);
});
//# sourceMappingURL=on_budget_period_edited.trigger.js.map