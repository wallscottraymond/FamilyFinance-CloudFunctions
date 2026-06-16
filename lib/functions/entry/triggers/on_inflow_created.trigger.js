"use strict";
/**
 * Inflow Created Trigger
 *
 * Firestore trigger that fires when a new inflow document is created.
 * Calls the generate_inflow_periods_orchestrator to create period instances.
 *
 * This replaces the legacy onInflowCreated trigger with an architecture-compliant version
 * that follows the 5-layer architecture: Entry → Orchestrator → Resolver → Domain → Repository.
 *
 * COEXISTENCE: During migration, this trigger checks if periods already exist
 * (created by legacy onInflowCreated). If so, it skips to avoid duplicates.
 *
 * Memory: 512MiB, Timeout: 60s
 *
 * @module entry/triggers/on_inflow_created
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.on_inflow_created = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const firestore_2 = require("firebase-admin/firestore");
const observability_1 = require("../../observability");
const job_queue_1 = require("../../infrastructure/job_queue");
const inflows_1 = require("../../orchestrators/inflows");
/**
 * Firestore trigger on inflows/{inflowId}
 *
 * Automatically generates inflow_period documents when a new inflow is created.
 * Uses idempotency to prevent duplicate processing.
 */
exports.on_inflow_created = (0, firestore_1.onDocumentCreated)({
    document: "inflows/{inflowId}",
    region: "us-central1",
    memory: "512MiB",
    timeoutSeconds: 60,
}, async (event) => {
    var _a, _b;
    const inflow_id = event.params.inflowId;
    const inflow_data = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    // Guard: No data
    if (!inflow_data) {
        console.error(`[on_inflow_created] No data found in inflow document: ${inflow_id}`);
        return;
    }
    // Guard: Inactive inflow
    if (inflow_data.isActive === false) {
        console.log(`[on_inflow_created] Skipping inactive inflow: ${inflow_id}`);
        return;
    }
    // Extract user ID (handle both naming conventions)
    const user_id = (_b = inflow_data.ownerId) !== null && _b !== void 0 ? _b : inflow_data.userId;
    if (!user_id) {
        console.error(`[on_inflow_created] Missing user ID in inflow document: ${inflow_id}`);
        return;
    }
    console.log(`[on_inflow_created] Trigger fired for inflow ${inflow_id}, user ${user_id}`);
    // COEXISTENCE CHECK: Skip if legacy trigger already created periods
    // This allows both triggers to be deployed during migration
    const db = (0, firestore_2.getFirestore)();
    const existing_periods = await db
        .collection("inflow_periods")
        .where("inflowId", "==", inflow_id)
        .limit(1)
        .select() // Only need to check existence, not data
        .get();
    if (!existing_periods.empty) {
        console.log(`[on_inflow_created] Periods already exist for inflow ${inflow_id} (legacy trigger). Skipping.`);
        return;
    }
    // Create trace context with idempotency key
    // Use event.id to ensure trigger replays don't create duplicates
    const trace = (0, observability_1.create_trigger_trace)(inflow_id, event.id);
    const idempotency_key = trace.idempotency_key;
    // Build orchestrator context
    const ctx = Object.assign(Object.assign({}, trace), { input: {
            inflow_id,
            inflow_data: inflow_data,
            user_id,
        }, idempotency_key });
    try {
        // Call exactly ONE orchestrator
        const result = await (0, inflows_1.generate_inflow_periods_orchestrator)(ctx);
        if (result.success) {
            console.log(`[on_inflow_created] Generated ${result.periods_created} periods for inflow ${inflow_id}`);
            // Now that periods exist, (1) re-assign the inflow's transactions so their
            // splits carry `inflowId` (they were synced before this inflow/its periods
            // existed), and (2) reconcile the periods' "received" status from the
            // transaction membership. Both AFTER period generation.
            const transaction_ids = inflow_data.transactionIds;
            if (transaction_ids && transaction_ids.length > 0) {
                await (0, job_queue_1.create_job)("assign_recurring_transactions", {
                    recurring_id: inflow_id,
                    recurring_type: "inflow",
                    user_id,
                    trace_id: trace.trace_id,
                }, { trace_id: trace.trace_id });
                await (0, job_queue_1.create_job)("reconcile_recurring_period", {
                    recurring_id: inflow_id,
                    recurring_type: "inflow",
                    user_id,
                    trace_id: trace.trace_id,
                }, { trace_id: trace.trace_id });
            }
        }
        else {
            console.error(`[on_inflow_created] Failed to generate periods for inflow ${inflow_id}:`, result.errors);
        }
    }
    catch (error) {
        console.error(`[on_inflow_created] Error generating periods for inflow ${inflow_id}:`, error);
        // Don't rethrow - Cloud Functions will retry the trigger
        // The idempotency check will prevent duplicate processing
    }
});
//# sourceMappingURL=on_inflow_created.trigger.js.map