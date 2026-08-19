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
exports.on_inflow_updated = exports.on_outflow_updated = void 0;
exports.transaction_ids_changed = transaction_ids_changed;
exports.handle_recurring_write = handle_recurring_write;
const firestore_1 = require("firebase-functions/v2/firestore");
const admin = __importStar(require("firebase-admin"));
const observability_1 = require("../../observability");
const job_queue_1 = require("../../infrastructure/job_queue");
const runUpdateOutflowPeriods_1 = require("../../outflows/outflow_periods/utils/runUpdateOutflowPeriods");
const runUpdateInflowPeriods_1 = require("../../inflows/inflow_periods/utils/runUpdateInflowPeriods");
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
/**
 * The EFFECTIVE expected amount of a recurring doc = the user override when set,
 * else Plaid's average. Drives the materialized period amounts.
 */
function effective_amount(doc) {
    if (!doc)
        return undefined;
    const override = doc.expectedAmountOverride;
    return (override !== null && override !== void 0 ? override : doc.averageAmount);
}
/** Shared handler: enqueue a reconcile when the inbound list changed. Exported for tests. */
async function handle_recurring_write(recurring_type, recurring_id, before, after, event_id) {
    if (!after)
        return false; // deletion → the removal cascade handles soft-delete
    const user_id = after.userId || after.ownerId;
    if (!user_id)
        return false;
    const trace = (0, observability_1.create_trigger_trace)(recurring_id, event_id);
    let did = false;
    // 1. `transactionIds` changed (Plaid recurring detection) → reconcile paid/received.
    if (transaction_ids_changed(before, after)) {
        await (0, job_queue_1.create_job)("reconcile_recurring_period", { recurring_id, recurring_type, user_id, trace_id: trace.trace_id }, { trace_id: trace.trace_id });
        did = true;
    }
    // 2. Effective EXPECTED AMOUNT changed (`expectedAmountOverride ?? averageAmount`)
    //    → recompute the MATERIALIZED period amounts so the summaries-backed list
    //    reflects it. Without this, a user's expected-amount override updates only the
    //    derive-aware detail screen; the list (summaries) shows the stale average.
    //    Gated to amount changes (rare), so no per-write cascade. runUpdate* recomputes
    //    amounts only here — its auto-match path is gated on transactionIds separately.
    if (before && effective_amount(before) !== effective_amount(after)) {
        const db = admin.firestore();
        try {
            if (recurring_type === "outflow") {
                await (0, runUpdateOutflowPeriods_1.runUpdateOutflowPeriods)(db, recurring_id, before, after);
            }
            else {
                await (0, runUpdateInflowPeriods_1.runUpdateInflowPeriods)(db, recurring_id, before, after);
            }
            did = true;
        }
        catch (error) {
            // Non-fatal: an amount-recompute failure must not break the recurring update.
            console.error(`[on_recurring_updated] period amount recompute failed for ${recurring_type} ${recurring_id}:`, error);
        }
    }
    return did;
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