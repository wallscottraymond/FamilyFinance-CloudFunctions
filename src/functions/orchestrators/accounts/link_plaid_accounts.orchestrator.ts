/**
 * Link Plaid Accounts Orchestrator
 *
 * Coordinates the workflow of fetching accounts from Plaid
 * and saving them to Firestore using the new architecture.
 *
 * Flow:
 * 1. Idempotency check
 * 2. Fetch accounts from Plaid (Integration Client)
 * 3. Transform to domain entities (Integration Transformer - PURE)
 * 4. Save to Firestore (Repository)
 * 5. Emit domain events
 *
 * @module orchestrators/accounts/link_plaid_accounts
 */

import { Timestamp } from "firebase-admin/firestore";
import {
  TraceContext,
  PerformanceBudget,
  create_performance_metrics,
  is_budget_exceeded,
} from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
  log_idempotent_return,
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import { account_repo } from "../../repositories";
import {
  check_idempotency,
  claim_key,
  complete_key,
  fail_key,
} from "../../infrastructure/idempotency_store";
import {
  fetch_plaid_accounts,
  transform_plaid_accounts_to_domain,
  PlaidInstitutionInfo,
} from "../../integrations/plaid";
import {
  create_event_emitter,
  ACCOUNT_EVENTS,
  AccountCreatedPayload,
} from "../../events";

/**
 * Performance budget for link_plaid_accounts.
 * Higher limits due to external API call and batch writes.
 */
const BUDGET: PerformanceBudget = {
  max_reads: 15,
  max_writes: 25,
  max_time_ms: 30000, // 30 seconds (Plaid API can be slow)
};

/**
 * Input for linking Plaid accounts.
 */
export interface LinkPlaidAccountsInput {
  /** Decrypted Plaid access token */
  access_token: string;

  /** Plaid item ID */
  item_id: string;

  /** Institution information */
  institution: PlaidInstitutionInfo;

  /** Group IDs for sharing (empty = private) */
  group_ids: string[];

  /** Idempotency key for deduplication */
  idempotency_key: string;
}

/**
 * Result of linking Plaid accounts.
 */
export interface LinkPlaidAccountsResult {
  /** Whether the operation succeeded */
  success: boolean;

  /** Number of accounts linked */
  accounts_linked: number;

  /** Account IDs that were created */
  account_ids: string[];

  /** Plaid item ID */
  item_id: string;

  /** Whether this was an idempotent return */
  was_idempotent: boolean;
}

/**
 * Orchestrates linking Plaid accounts to the user's profile.
 *
 * This function:
 * 1. Fetches account data from Plaid API
 * 2. Transforms Plaid data to domain entities
 * 3. Saves accounts to Firestore
 * 4. Emits account created events
 *
 * @param ctx - Trace context
 * @param user_id - User ID to link accounts to
 * @param input - Link accounts input
 * @returns Result with linked account info
 */
export async function link_plaid_accounts_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: LinkPlaidAccountsInput
): Promise<LinkPlaidAccountsResult> {
  const span = create_span(ctx, "orchestrator", "link_plaid_accounts");
  const perf = create_performance_metrics();
  const events = create_event_emitter(ctx.trace_id, span.span_id, user_id);
  log_operation_start(span, user_id);

  let key_claimed = false;

  try {
    // 1. Idempotency check
    const idempotency_result = await check_idempotency(ctx, input.idempotency_key);
    perf.reads++;

    if (idempotency_result.is_duplicate) {
      if (idempotency_result.status === "completed") {
        log_idempotent_return(span, user_id);
        const cached = idempotency_result.cached_result as LinkPlaidAccountsResult;
        return {
          ...cached,
          was_idempotent: true,
        };
      }

      if (idempotency_result.status === "in_progress") {
        throw new Error("Request already in progress");
      }
      // status === "failed" - allow retry
    }

    // 2. Claim idempotency key
    const claimed = await claim_key(ctx, input.idempotency_key);
    perf.writes++;
    if (!claimed) {
      throw new Error("Request already in progress");
    }
    key_claimed = true;

    // 3. Fetch accounts from Plaid (Integration Client)
    const plaid_result = await fetch_plaid_accounts(input.access_token);
    perf.reads++; // Count external API call as read

    if (plaid_result.accounts.length === 0) {
      // No accounts returned - still a success
      const empty_result: LinkPlaidAccountsResult = {
        success: true,
        accounts_linked: 0,
        account_ids: [],
        item_id: input.item_id,
        was_idempotent: false,
      };

      await complete_key(ctx, input.idempotency_key, empty_result);
      perf.writes++;

      log_operation_success(span, user_id);
      return empty_result;
    }

    // 4. Transform to domain entities (Integration Transformer - PURE)
    const now = Timestamp.now();
    const transform_result = transform_plaid_accounts_to_domain(
      plaid_result.accounts,
      {
        user_id,
        item_id: input.item_id,
        institution: input.institution,
        group_ids: input.group_ids,
        now,
      }
    );

    // Handle validation errors
    if (transform_result.validation_errors?.length) {
      console.warn(
        `[${ctx.trace_id}] Plaid account validation warnings:`,
        transform_result.validation_errors
      );
      // Continue with valid entities
    }

    const accounts_to_save = transform_result.entities ?? [];

    if (accounts_to_save.length === 0) {
      throw new Error("All Plaid accounts failed validation");
    }

    // Check performance budget before writes
    if (is_budget_exceeded(perf, BUDGET)) {
      console.warn(
        `[${ctx.trace_id}] Performance budget warning for link_plaid_accounts`
      );
    }

    // 5. Save to Firestore (Repository) - using batch for efficiency
    // Note: We cast to Account type - the structure is compatible
    const batch_result = await account_repo.save_batch(
      ctx,
      accounts_to_save as unknown as Parameters<typeof account_repo.save_batch>[1]
    );
    perf.writes += batch_result.count;

    // 6. Complete idempotency key
    const result: LinkPlaidAccountsResult = {
      success: true,
      accounts_linked: accounts_to_save.length,
      account_ids: accounts_to_save.map(a => a.id),
      item_id: input.item_id,
      was_idempotent: false,
    };

    await complete_key(ctx, input.idempotency_key, result);
    perf.writes++;

    log_operation_success(span, user_id);

    // 7. Emit domain events for each account (fire-and-forget)
    for (const account of accounts_to_save) {
      const event_payload: AccountCreatedPayload = {
        account_id: account.id,
        user_id,
        item_id: input.item_id,
        institution_id: input.institution.institution_id,
        institution_name: input.institution.name,
        account_type: account.account_type,
        created_at: now,
      };
      events.emit(ACCOUNT_EVENTS.CREATED, event_payload);
    }

    // 8. Async debug logging
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "link_plaid_accounts",
        status: "success",
        context: {
          item_id: input.item_id,
          accounts_from_plaid: plaid_result.accounts.length,
          accounts_saved: accounts_to_save.length,
          validation_errors: transform_result.validation_errors?.length ?? 0,
          perf_reads: perf.reads,
          perf_writes: perf.writes,
        },
      })
    );

    return result;
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id, error_code: "LINK_PLAID_ACCOUNTS_FAILED" }
    );

    // Release idempotency key on failure
    if (key_claimed) {
      try {
        await fail_key(
          ctx,
          input.idempotency_key,
          error instanceof Error ? error.message : "Unknown error"
        );
      } catch (fail_error) {
        console.error("Failed to release idempotency key:", fail_error);
      }
    }

    throw error;
  }
}
