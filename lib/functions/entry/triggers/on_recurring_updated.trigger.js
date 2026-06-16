"use strict";
/**
 * On Recurring Updated (Trigger) — Recurring-Period-Reconciliation Phase 4
 *
 * Fires when a recurring outflow/inflow doc changes. When its `transactionIds`
 * list GROWS (Plaid recurring detection / webhook), enqueue a `reconcile_recurring_period`
 * job so the new transactions align to periods and the period status updates.
 *
 * Field-guard: only enqueues when `transactionIds` actually changed (ignores
 * unrelated edits). Loop-safe: the reconcile job writes only to `*_periods`,
 * never back to the recurring doc, so it can't re-trigger this.
 *
 * @module entry/triggers/on_recurring_updated
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.on_inflow_updated = exports.on_outflow_updated = void 0;
exports.transaction_ids_changed = transaction_ids_changed;
exports.handle_recurring_write = handle_recurring_write;
const firestore_1 = require("firebase-functions/v2/firestore");
const observability_1 = require("../../observability");
const job_queue_1 = require("../../infrastructure/job_queue");
/** True if the recurring doc's `transactionIds` grew/changed (the field-guard). */
function transaction_ids_changed(before, after) {
    var _a, _b;
    const b = (_a = before === null || before === void 0 ? void 0 : before.transactionIds) !== null && _a !== void 0 ? _a : [];
    const a = (_b = after.transactionIds) !== null && _b !== void 0 ? _b : [];
    if (a.length !== b.length)
        return true;
    const b_set = new Set(b);
    return a.some((id) => !b_set.has(id));
}
/** Shared handler: enqueue a reconcile when the inbound list changed. Exported for tests. */
async function handle_recurring_write(recurring_type, recurring_id, before, after, event_id) {
    if (!after)
        return false; // deletion → the removal cascade handles soft-delete
    if (!transaction_ids_changed(before, after))
        return false; // field-guard
    const user_id = after.userId || after.ownerId;
    if (!user_id)
        return false;
    const trace = (0, observability_1.create_trigger_trace)(recurring_id, event_id);
    await (0, job_queue_1.create_job)("reconcile_recurring_period", { recurring_id, recurring_type, user_id, trace_id: trace.trace_id }, { trace_id: trace.trace_id });
    return true;
}
exports.on_outflow_updated = (0, firestore_1.onDocumentWritten)({
    document: "outflows/{recurringId}",
    region: "us-central1",
    memory: "256MiB",
    // eslint-disable-next-line @typescript-eslint/naming-convention
    timeoutSeconds: 60,
}, async (event) => {
    var _a, _b, _c, _d, _e, _f;
    await handle_recurring_write("outflow", event.params.recurringId, (_c = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data()) !== null && _c !== void 0 ? _c : null, (_f = (_e = (_d = event.data) === null || _d === void 0 ? void 0 : _d.after) === null || _e === void 0 ? void 0 : _e.data()) !== null && _f !== void 0 ? _f : null, event.id);
});
exports.on_inflow_updated = (0, firestore_1.onDocumentWritten)({
    document: "inflows/{recurringId}",
    region: "us-central1",
    memory: "256MiB",
    // eslint-disable-next-line @typescript-eslint/naming-convention
    timeoutSeconds: 60,
}, async (event) => {
    var _a, _b, _c, _d, _e, _f;
    await handle_recurring_write("inflow", event.params.recurringId, (_c = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data()) !== null && _c !== void 0 ? _c : null, (_f = (_e = (_d = event.data) === null || _d === void 0 ? void 0 : _d.after) === null || _e === void 0 ? void 0 : _e.data()) !== null && _f !== void 0 ? _f : null, event.id);
});
//# sourceMappingURL=on_recurring_updated.trigger.js.map