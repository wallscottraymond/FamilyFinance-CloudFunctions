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

import { onDocumentCreated } from "firebase-functions/v2/firestore";
import { defineSecret } from "firebase-functions/params";
import { create_trigger_trace } from "../../observability";
import { plaid_initial_sync_orchestrator } from "../../orchestrators/plaid";
import { InitialSyncInput, OrchestratorContext } from "../../types";

// Define secrets required for Plaid operations
const plaidClientId = defineSecret("PLAID_CLIENT_ID");
const plaidSecret = defineSecret("PLAID_SECRET");
const tokenEncryptionKey = defineSecret("TOKEN_ENCRYPTION_KEY");

/**
 * Firestore trigger on plaid_items/{itemDocId}
 *
 * Automatically runs the initial sync when a new Plaid item is created.
 * Uses idempotency to prevent duplicate processing.
 */
export const on_plaid_item_created = onDocumentCreated(
  {
    document: "plaid_items/{itemDocId}",
    memory: "1GiB",
    timeoutSeconds: 540,
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
  },
  async (event) => {
    const item_doc_id = event.params.itemDocId;
    const item_data = event.data?.data();

    // Guard: No data
    if (!item_data) {
      console.error(
        `[on_plaid_item_created] No data found in plaid_item document: ${item_doc_id}`
      );
      return;
    }

    // Extract fields (handle both snake_case and camelCase)
    const plaid_item_id = item_data.plaidItemId || item_data.plaid_item_id;
    const user_id = item_data.userId || item_data.user_id;
    const institution_id = item_data.institutionId || item_data.institution_id;
    const institution_name = item_data.institutionName || item_data.institution_name;

    // Guard: Required fields
    if (!plaid_item_id || !user_id) {
      console.error(
        `[on_plaid_item_created] Missing required fields. ` +
        `plaid_item_id=${plaid_item_id}, user_id=${user_id}`
      );
      return;
    }

    console.log(
      `[on_plaid_item_created] Trigger fired for item ${plaid_item_id}, ` +
      `user ${user_id}, institution ${institution_name}`
    );

    // Create trace context with idempotency key
    // Use event.id to ensure trigger replays don't create duplicates
    const trace = create_trigger_trace(item_doc_id, event.id);
    const idempotency_key = trace.idempotency_key;

    // Build input
    const input: InitialSyncInput = {
      item_doc_id,
      plaid_item_id,
      user_id,
      institution_id: institution_id || "",
      institution_name: institution_name || "Unknown Institution",
    };

    // Build orchestrator context
    const ctx: OrchestratorContext<InitialSyncInput> = {
      ...trace,
      input,
      user_id,
      idempotency_key,
    };

    try {
      // Call exactly ONE orchestrator
      const result = await plaid_initial_sync_orchestrator(ctx);

      if (result.success) {
        console.log(
          `[on_plaid_item_created] Initial sync completed for item ${plaid_item_id}:`,
          {
            accounts: result.summary.accounts_created,
            transactions_added: result.summary.transactions_added,
            transactions_modified: result.summary.transactions_modified,
            transactions_removed: result.summary.transactions_removed,
            inflows: result.summary.inflows_created,
            outflows: result.summary.outflows_created,
            duration_ms: result.summary.total_duration_ms,
          }
        );
      } else {
        console.error(
          `[on_plaid_item_created] Initial sync failed for item ${plaid_item_id}:`,
          result.errors
        );
      }
    } catch (error) {
      console.error(
        `[on_plaid_item_created] Error during initial sync for item ${plaid_item_id}:`,
        error
      );

      // Don't rethrow - Cloud Functions will retry the trigger
      // The idempotency check will prevent duplicate processing
    }
  }
);
