"use strict";
/**
 * On Transaction Written (Trigger) — Transaction Assignment Engine entry
 *
 * Thin trigger: extracts the before/after snapshots and the user, then calls
 * exactly ONE orchestrator (`process_transaction_written`) which decides what
 * to enqueue. All branching/field-guard/budget-scope logic lives there.
 *
 * Loop prevention: the engine's own write changes assignment fields, which the
 * field-guard sees as relevant → one redundant job, which skip-if-unchanged
 * no-ops (no further write, no further trigger). Converges in one extra pass.
 *
 * @module entry/triggers/on_transaction_written
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.on_transaction_written = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const observability_1 = require("../../observability");
const process_transaction_written_orchestrator_1 = require("../../orchestrators/transactions/process_transaction_written.orchestrator");
exports.on_transaction_written = (0, firestore_1.onDocumentWritten)({
    document: "transactions/{transactionId}",
    region: "us-central1",
    memory: "256MiB",
    // eslint-disable-next-line @typescript-eslint/naming-convention
    timeoutSeconds: 60,
}, async (event) => {
    var _a, _b, _c, _d, _e, _f;
    const transaction_id = event.params.transactionId;
    const before = (_c = (_b = (_a = event.data) === null || _a === void 0 ? void 0 : _a.before) === null || _b === void 0 ? void 0 : _b.data()) !== null && _c !== void 0 ? _c : null;
    const after = (_f = (_e = (_d = event.data) === null || _d === void 0 ? void 0 : _d.after) === null || _e === void 0 ? void 0 : _e.data()) !== null && _f !== void 0 ? _f : null;
    const user_id = (after === null || after === void 0 ? void 0 : after.userId) || (before === null || before === void 0 ? void 0 : before.userId);
    if (!user_id) {
        console.warn(`[on_transaction_written] no userId for transaction ${transaction_id}; skipping`);
        return;
    }
    // Idempotency: the trace's key (`trigger:${id}:${event.id}`) flows into the
    // orchestrator's per-event job deduplication keys, so trigger replays of the
    // SAME write collapse to one job.
    const trace = (0, observability_1.create_trigger_trace)(transaction_id, event.id);
    await (0, process_transaction_written_orchestrator_1.process_transaction_written_orchestrator)(trace, {
        transaction_id,
        user_id,
        before,
        after,
        event_id: event.id,
    });
});
//# sourceMappingURL=on_transaction_written.trigger.js.map