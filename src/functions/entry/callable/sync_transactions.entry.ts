/**
 * Sync Transactions Entry Point
 *
 * Callable function for syncing transactions from Plaid.
 * Rate limited to once per 5 minutes per item.
 *
 * NOTE: This only syncs transactions from Plaid to Firestore.
 * Budget calculations are handled by existing Firestore triggers.
 *
 * @module entry/callable/sync_transactions
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { defineSecret } from "firebase-functions/params";
import { z } from "zod";
import { sync_transactions_orchestrator } from "../../orchestrators/plaid";
import { generate_id } from "../../observability";
import { TRANSACTION_SYNC_RATE_LIMIT_SECONDS } from "../../types/plaid";
import { check_and_record } from "../../infrastructure/rate_limiter";

// Secrets required for Plaid API calls
const plaidClientId = defineSecret("PLAID_CLIENT_ID");
const plaidSecret = defineSecret("PLAID_SECRET");
const tokenEncryptionKey = defineSecret("TOKEN_ENCRYPTION_KEY");

/**
 * Input validation schema.
 * Accepts camelCase from frontend, converts to snake_case internally.
 */
const sync_transactions_input_schema = z.object({
  /** Required: Plaid item document ID to sync */
  itemId: z.string().min(1, "itemId is required"),

  /** Optional: Force sync from specific cursor (admin use) */
  cursor: z.string().optional(),
});

/**
 * Rate limit configuration for transaction sync.
 * 1 request per 5 minutes per item.
 */
const TRANSACTION_SYNC_RATE_LIMIT = {
  max_requests: 1,
  window_ms: TRANSACTION_SYNC_RATE_LIMIT_SECONDS * 1000,
};

/**
 * Callable function for syncing transactions.
 *
 * Syncs transactions from Plaid for a specific item.
 * Uses cursor-based incremental sync for efficiency.
 * Rate limited to once per 5 minutes per item.
 *
 * Returns sync results including counts of added/modified/removed transactions.
 */
export const sync_transactions = onCall(
  {
    memory: "512MiB",
    timeoutSeconds: 300, // 5 minutes for large syncs
    secrets: [plaidClientId, plaidSecret, tokenEncryptionKey],
  },
  async (request) => {
    // 1. AUTHENTICATION
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;

    // 2. INPUT VALIDATION
    const validation = sync_transactions_input_schema.safeParse(request.data || {});
    if (!validation.success) {
      throw new HttpsError(
        "invalid-argument",
        validation.error.issues.map((e: { message: string }) => e.message).join("; ")
      );
    }

    const input = validation.data;

    // 3. RATE LIMITING (via infrastructure layer, per item)
    const rate_limit_key = `transaction_sync:${user_id}:${input.itemId}`;
    const rate_result = await check_and_record(rate_limit_key, TRANSACTION_SYNC_RATE_LIMIT);

    if (!rate_result.allowed) {
      const retry_minutes = Math.ceil((rate_result.retry_after_ms || 0) / 60000);
      throw new HttpsError(
        "resource-exhausted",
        `Transaction sync is limited to once per ${TRANSACTION_SYNC_RATE_LIMIT_SECONDS / 60} minutes per account. ` +
        `Please try again in ${retry_minutes} minute${retry_minutes !== 1 ? "s" : ""}.`
      );
    }

    // 4. CREATE TRACE CONTEXT
    const trace_id = generate_id();
    const span_id = generate_id();

    console.log(
      `[${trace_id}] syncTransactions called by user ${user_id}, itemId=${input.itemId}`
    );

    // 5. CALL ORCHESTRATOR (exactly one)
    try {
      const result = await sync_transactions_orchestrator({
        trace_id,
        span_id,
        input: {
          item_id: input.itemId,
          user_id,
          cursor: input.cursor,
        },
        user_id,
        idempotency_key: `sync_transactions:${user_id}:${input.itemId}:${Date.now()}`,
      });

      // 6. MAP RESPONSE (convert snake_case to camelCase for frontend)
      return {
        success: result.success,
        addedCount: result.added_count,
        modifiedCount: result.modified_count,
        removedCount: result.removed_count,
        pendingMigratedCount: result.pending_migrated_count,
        hasMore: result.has_more,
        nextCursor: result.next_cursor,
        error: result.error,
        traceId: trace_id,
      };
    } catch (error) {
      console.error(`[${trace_id}] syncTransactions failed:`, error);

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        "Failed to sync transactions. Please try again."
      );
    }
  }
);
