/**
 * Refresh Plaid Data Entry Point
 *
 * Callable function for refreshing BOTH account balances AND transactions from Plaid.
 * Rate limited to once per 5 minutes per item (allows parallel refresh of multiple items).
 *
 * This is the main entry point for pull-to-refresh in the mobile app.
 *
 * @module entry/callable/refresh_plaid_data
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { z } from "zod";
import { refresh_plaid_data_orchestrator } from "../../orchestrators/plaid/refresh_plaid_data.orchestrator";
import { generate_id } from "../../observability";
import { BALANCE_SYNC_RATE_LIMIT_SECONDS } from "../../types/plaid";
import { check_and_record } from "../../infrastructure/rate_limiter";

// Secrets required for Plaid API calls
const plaidClientId = defineSecret("PLAID_CLIENT_ID");
const plaidSecret = defineSecret("PLAID_SECRET");
const tokenEncryptionKey = defineSecret("TOKEN_ENCRYPTION_KEY");

/**
 * Input validation schema.
 * Accepts camelCase from frontend, converts to snake_case internally.
 */
const sync_balances_input_schema = z.object({
  /** Optional: Sync only a specific Plaid item (camelCase from frontend) */
  itemId: z.string().optional(),

  /** Optional: Sync only specific account IDs */
  accountIds: z.array(z.string()).optional(),
});

/**
 * Rate limit configuration for balance sync.
 * 1 request per 5 minutes per item.
 */
const BALANCE_SYNC_RATE_LIMIT = {
  max_requests: 1,
  window_ms: BALANCE_SYNC_RATE_LIMIT_SECONDS * 1000,
};

/**
 * Callable function for syncing account balances AND transactions.
 *
 * Refreshes both balances AND transactions from Plaid for all accounts or specific items.
 * Rate limited to once per 5 minutes per item (allows parallel refresh of multiple items).
 *
 * This is the main pull-to-refresh endpoint for the mobile app.
 *
 * Returns the updated accounts and transaction sync stats in the format expected by the frontend.
 */
export const refresh_plaid_data = onCall(
  {
    memory: "512MiB",
    timeoutSeconds: 120,
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
  },
  async (request) => {
    // 1. AUTHENTICATION
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    // 2. INPUT VALIDATION
    const validation = sync_balances_input_schema.safeParse(request.data || {});
    if (!validation.success) {
      throw new HttpsError(
        "invalid-argument",
        validation.error.issues.map((e: { message: string }) => e.message).join("; ")
      );
    }

    const input = validation.data;

    // 3. RATE LIMITING (via infrastructure layer, per item)
    const rate_limit_key = `balance_sync:${user_id}:${input.itemId || "all"}`;
    const rate_result = await check_and_record(rate_limit_key, BALANCE_SYNC_RATE_LIMIT);

    if (!rate_result.allowed) {
      const retry_minutes = Math.ceil((rate_result.retry_after_ms || 0) / 60000);
      throw new HttpsError(
        "resource-exhausted",
        `Balance sync is limited to once per ${BALANCE_SYNC_RATE_LIMIT_SECONDS / 60} minutes per account. ` +
        `Please try again in ${retry_minutes} minute${retry_minutes !== 1 ? "s" : ""}.`
      );
    }

    // 4. CREATE TRACE CONTEXT
    const trace_id = generate_id();
    const span_id = generate_id();

    console.log(
      `[${trace_id}] refreshPlaidData called by user ${user_id}` +
      (input.itemId ? `, itemId=${input.itemId}` : "")
    );

    // 5. CALL ORCHESTRATOR (exactly one, convert camelCase to snake_case)
    try {
      const result = await refresh_plaid_data_orchestrator({
        trace_id,
        span_id,
        input: {
          item_id: input.itemId,
          account_ids: input.accountIds,
        },
        user_id,
        idempotency_key: `refresh_plaid_data:${user_id}:${trace_id}`,
      });

      // 6. MAP RESPONSE (camelCase for frontend, includes both balance + transaction stats)
      return {
        success: result.success,
        accounts: result.accounts,
        // Balance stats (backward compatible)
        accountsUpdated: result.accounts_updated,
        accountsFailed: result.accounts_failed,
        balanceChanges: result.balance_changes,
        // Transaction stats (new fields)
        transactionsAdded: result.transactions_added,
        transactionsModified: result.transactions_modified,
        transactionsRemoved: result.transactions_removed,
        pendingMigrated: result.pending_migrated,
        // Sync status
        itemsSynced: result.items_synced,
        itemsFailed: result.items_failed,
        itemsRateLimited: result.items_rate_limited,
        // Errors if any
        errors: result.errors,
        traceId: trace_id,
      };
    } catch (error) {
      console.error(`[${trace_id}] refreshPlaidData failed:`, error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        "Failed to refresh Plaid data. Please try again."
      );
    }
  }
);
