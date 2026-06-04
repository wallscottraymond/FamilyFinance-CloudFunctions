"use strict";
/**
 * Plaid Item Created Trigger
 *
 * Firestore trigger that fires when a new plaid_item document is created.
 * Calls the plaid_initial_sync_orchestrator to coordinate:
 * 1. Account creation (with balances)
 * 2. Transaction sync
 * 3. Recurring transaction sync
 *
 * This replaces the old onPlaidItemCreated trigger with an architecture-compliant version.
 *
 * Memory: 1GiB, Timeout: 540s (9 minutes)
 *
 * @module entry/triggers/on_plaid_item_created
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.on_plaid_item_created = void 0;
const firestore_1 = require("firebase-functions/v2/firestore");
const params_1 = require("firebase-functions/params");
const observability_1 = require("../../observability");
const plaid_1 = require("../../orchestrators/plaid");
// Define secrets required for Plaid operations
const plaidClientId = (0, params_1.defineSecret)("PLAID_CLIENT_ID");
const plaidSecret = (0, params_1.defineSecret)("PLAID_SECRET");
const tokenEncryptionKey = (0, params_1.defineSecret)("TOKEN_ENCRYPTION_KEY");
/**
 * Firestore trigger on plaid_items/{itemDocId}
 *
 * Automatically runs the initial sync when a new Plaid item is created.
 * Uses idempotency to prevent duplicate processing.
 */
exports.on_plaid_item_created = (0, firestore_1.onDocumentCreated)({
    document: "plaid_items/{itemDocId}",
    memory: "1GiB",
    timeoutSeconds: 540,
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
}, async (event) => {
    var _a;
    const item_doc_id = event.params.itemDocId;
    const item_data = (_a = event.data) === null || _a === void 0 ? void 0 : _a.data();
    // Guard: No data
    if (!item_data) {
        console.error(`[on_plaid_item_created] No data found in plaid_item document: ${item_doc_id}`);
        return;
    }
    // Extract fields (handle both snake_case and camelCase)
    const plaid_item_id = item_data.plaidItemId || item_data.plaid_item_id;
    const user_id = item_data.userId || item_data.user_id;
    const institution_id = item_data.institutionId || item_data.institution_id;
    const institution_name = item_data.institutionName || item_data.institution_name;
    // Guard: Required fields
    if (!plaid_item_id || !user_id) {
        console.error(`[on_plaid_item_created] Missing required fields. ` +
            `plaid_item_id=${plaid_item_id}, user_id=${user_id}`);
        return;
    }
    console.log(`[on_plaid_item_created] Trigger fired for item ${plaid_item_id}, ` +
        `user ${user_id}, institution ${institution_name}`);
    // Create trace context with idempotency key
    // Use event.id to ensure trigger replays don't create duplicates
    const trace = (0, observability_1.create_trigger_trace)(item_doc_id, event.id);
    const idempotency_key = trace.idempotency_key;
    // Build input
    const input = {
        item_doc_id,
        plaid_item_id,
        user_id,
        institution_id: institution_id || "",
        institution_name: institution_name || "Unknown Institution",
    };
    // Build orchestrator context
    const ctx = Object.assign(Object.assign({}, trace), { input,
        user_id,
        idempotency_key });
    try {
        // Call exactly ONE orchestrator
        const result = await (0, plaid_1.plaid_initial_sync_orchestrator)(ctx);
        if (result.success) {
            console.log(`[on_plaid_item_created] Initial sync completed for item ${plaid_item_id}:`, {
                accounts: result.summary.accounts_created,
                transactions_added: result.summary.transactions_added,
                transactions_modified: result.summary.transactions_modified,
                transactions_removed: result.summary.transactions_removed,
                inflows: result.summary.inflows_created,
                outflows: result.summary.outflows_created,
                duration_ms: result.summary.total_duration_ms,
            });
        }
        else {
            console.error(`[on_plaid_item_created] Initial sync failed for item ${plaid_item_id}:`, result.errors);
        }
    }
    catch (error) {
        console.error(`[on_plaid_item_created] Error during initial sync for item ${plaid_item_id}:`, error);
        // Don't rethrow - Cloud Functions will retry the trigger
        // The idempotency check will prevent duplicate processing
    }
});
//# sourceMappingURL=on_plaid_item_created.trigger.js.map