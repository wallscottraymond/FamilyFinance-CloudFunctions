/**
 * Get Accounts Orchestrator
 *
 * Coordinates retrieval of user accounts.
 * This is a read-only operation - no idempotency or events needed.
 *
 * @module orchestrators/accounts/get_accounts
 */

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
  fire_and_forget,
  log_async_debug,
} from "../../observability";
import { Account, account_repo } from "../../repositories";
import {
  check_account_read_access,
  AccountAccessData,
  UserAccessContext,
} from "../../domain";

/**
 * Performance budget for get_accounts.
 * Read-only operations have higher read limits.
 */
const BUDGET: PerformanceBudget = {
  max_reads: 50,
  max_writes: 0,
  max_time_ms: 300,
};

/**
 * Input for get accounts operation.
 */
export interface GetAccountsInput {
  /** Include inactive/deleted accounts */
  include_inactive?: boolean;
}

/**
 * Result of get accounts operation.
 */
export interface GetAccountsResult {
  accounts: Account[];
  count: number;
}

/**
 * Orchestrates retrieval of user accounts.
 *
 * Flow:
 * 1. Log start
 * 2. Repository read (no idempotency for reads)
 * 3. Log success
 * 4. Async debug logging
 *
 * @param ctx - Trace context
 * @param user_id - User ID
 * @param input - Optional filters
 * @returns User's accounts
 */
export async function get_accounts_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input?: GetAccountsInput
): Promise<GetAccountsResult> {
  const span = create_span(ctx, "orchestrator", "get_accounts");
  const perf = create_performance_metrics();
  log_operation_start(span, user_id);

  try {
    // Read-only: No idempotency check needed
    // Read-only: No resolver needed (not modifying anything)
    // Read-only: No domain service needed (just fetching)

    // Fetch accounts from repository
    const accounts = await account_repo.get_by_user_id(ctx, user_id, {
      include_deleted: input?.include_inactive,
    });
    perf.reads++;

    // Check performance budget
    if (is_budget_exceeded(perf, BUDGET)) {
      // For reads, we just log a warning - don't fail
      console.warn(`[${ctx.trace_id}] Performance budget exceeded for get_accounts`);
    }

    log_operation_success(span, user_id);

    // Read-only: No events needed

    // Async debug logging
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "get_accounts",
        status: "success",
        output: { count: accounts.length },
        context: { perf_reads: perf.reads },
      })
    );

    return {
      accounts,
      count: accounts.length,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id, error_code: "GET_ACCOUNTS_FAILED" }
    );
    throw error;
  }
}

/**
 * Gets a single account by ID with permission check.
 *
 * Flow:
 * 1. Log start
 * 2. Repository read
 * 3. Domain service permission check
 * 4. Log success
 *
 * @param ctx - Trace context
 * @param user_id - User ID (for permission check)
 * @param account_id - Account ID
 * @param user_group_ids - User's group memberships (for group access)
 * @returns Account or null if not found/not authorized
 */
export async function get_account_orchestrator(
  ctx: TraceContext,
  user_id: string,
  account_id: string,
  user_group_ids: string[] = []
): Promise<Account | null> {
  const span = create_span(ctx, "orchestrator", "get_account");
  const perf = create_performance_metrics();
  log_operation_start(span, user_id);

  try {
    // 1. Repository read
    const account = await account_repo.get_by_id(ctx, account_id);
    perf.reads++;

    if (!account) {
      log_operation_success(span, user_id);
      return null;
    }

    // 2. Domain service: Permission check (PURE - no IO)
    const access_data: AccountAccessData = {
      user_id: account.user_id,
      is_active: account.is_active,
      is_deleted: account.is_deleted,
      access: account.access,
    };

    const user_context: UserAccessContext = {
      user_id,
      group_ids: user_group_ids,
    };

    const access_result = check_account_read_access(access_data, user_context);

    if (!access_result.entity?.has_access) {
      log_operation_error(span, new Error("Permission denied"), {
        user_id,
        error_code: "PERMISSION_DENIED",
        context: { reason: access_result.entity?.reason },
      });
      return null;
    }

    log_operation_success(span, user_id);

    // Async debug logging
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "get_account",
        status: "success",
        context: {
          account_id,
          access_reason: access_result.entity?.reason,
        },
      })
    );

    return account;
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id, error_code: "GET_ACCOUNT_FAILED" }
    );
    throw error;
  }
}
