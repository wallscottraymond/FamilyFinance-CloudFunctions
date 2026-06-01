/**
 * Restore Account Orchestrator
 *
 * Coordinates restoring a soft-deleted account.
 * Only accounts that were single-account removals (item still active) can be restored.
 *
 * @module orchestrators/accounts/restore_account
 */

import { Timestamp } from "firebase-admin/firestore";
import {
  TraceContext,
  NotFoundError,
  PermissionDeniedError,
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
import { plaid_item_repo } from "../../repositories/plaid/plaid_item.repo";
import {
  check_idempotency,
  claim_key,
  complete_key,
  fail_key,
} from "../../infrastructure/idempotency_store";
import {
  check_account_write_access,
  validate_account_restore,
  AccountAccessData,
  UserAccessContext,
} from "../../domain";
import {
  create_event_emitter,
  ACCOUNT_EVENTS,
  AccountRestoredPayload,
} from "../../events";
import { create_job } from "../../infrastructure/job_queue";

/**
 * Performance budget for restore_account.
 */
const BUDGET: PerformanceBudget = {
  max_reads: 10,
  max_writes: 5,
  max_time_ms: 1000,
};

/**
 * Input for restore account operation.
 */
export interface RestoreAccountInput {
  /** Account ID to restore */
  account_id: string;

  /** Idempotency key for deduplication */
  idempotency_key: string;

  /** Whether to also restore hidden transactions */
  restore_transactions: boolean;

  /** Whether to also restore recurring items */
  restore_recurring: boolean;
}

/**
 * Result of restore account operation.
 */
export interface RestoreAccountResult {
  /** Whether the account was restored */
  success: boolean;

  /** The restored account ID */
  account_id: string;

  /** Whether this was an idempotent return */
  was_idempotent: boolean;

  /** Whether restore jobs were enqueued */
  restore_jobs_enqueued: boolean;
}

/**
 * Orchestrates restoring a soft-deleted account.
 *
 * Flow:
 * 1. Idempotency check
 * 2. Repository read (get account)
 * 3. Domain service (permission + restore validation)
 * 4. Repository write (restore account)
 * 5. Enqueue restore jobs (if requested)
 * 6. Emit domain event
 *
 * @param ctx - Trace context
 * @param user_id - User performing the restore
 * @param input - Restore account input
 * @param user_group_ids - User's group memberships
 * @returns Restore result
 */
export async function restore_account_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: RestoreAccountInput,
  user_group_ids: string[] = []
): Promise<RestoreAccountResult> {
  const span = create_span(ctx, "orchestrator", "restore_account");
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
        return {
          success: true,
          account_id: input.account_id,
          was_idempotent: true,
          restore_jobs_enqueued: false,
        };
      }

      if (idempotency_result.status === "in_progress") {
        throw new Error("Request already in progress");
      }
    }

    // 2. Claim the idempotency key
    const claimed = await claim_key(ctx, input.idempotency_key);
    perf.writes++;
    if (!claimed) {
      throw new Error("Request already in progress");
    }
    key_claimed = true;

    // 3. Repository read: Get the account (including deleted)
    const account = await account_repo.get_by_id(ctx, input.account_id, {
      include_deleted: true,
    });
    perf.reads++;

    if (!account) {
      throw new NotFoundError("account", input.account_id);
    }

    // 4. Domain service: Permission check
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

    const access_result = check_account_write_access(access_data, user_context);

    if (!access_result.entity?.has_access) {
      throw new PermissionDeniedError("restore_account", input.account_id);
    }

    // 5. Check if already active (idempotent case)
    if (account.is_active) {
      log_idempotent_return(span, user_id);
      const result = { success: true, account_id: input.account_id };
      await complete_key(ctx, input.idempotency_key, result);
      perf.writes++;
      return {
        success: true,
        account_id: input.account_id,
        was_idempotent: true,
        restore_jobs_enqueued: false,
      };
    }

    // 6. Get the Plaid item to check if it's still active
    let item_is_active: boolean | null = null;
    if (account.item_id) {
      const plaid_item = await plaid_item_repo.get_by_id(ctx, account.item_id);
      perf.reads++;
      item_is_active = plaid_item?.is_active ?? false;
    }

    // 7. Domain service: Validate restore eligibility
    // For this, we need to know if the account was marked as restorable
    // We'll check if the item is still active as a proxy
    const restore_validation = validate_account_restore(
      account.is_active,
      item_is_active !== false, // Assume restorable if item is active or null
      item_is_active
    );

    if (!restore_validation.entity?.can_restore) {
      throw new Error(
        restore_validation.entity?.reason || "Account cannot be restored"
      );
    }

    // Check performance budget
    if (is_budget_exceeded(perf, BUDGET)) {
      console.warn(
        `[${ctx.trace_id}] Performance budget warning for restore_account`
      );
    }

    // 8. Repository write: Restore the account
    await account_repo.restore(ctx, input.account_id, user_id);
    perf.writes++;

    // 9. Complete idempotency key
    const result = { success: true, account_id: input.account_id };
    await complete_key(ctx, input.idempotency_key, result);
    perf.writes++;

    log_operation_success(span, user_id);

    // 10. Enqueue restore jobs if requested
    let restore_jobs_enqueued = false;

    if (input.restore_transactions) {
      await create_job(
        "restore_account_transactions",
        {
          plaid_account_id: account.account_id,
          user_id,
          trace_id: ctx.trace_id,
        },
        { trace_id: ctx.trace_id }
      );
      restore_jobs_enqueued = true;
    }

    if (input.restore_recurring) {
      await create_job(
        "restore_account_recurring",
        {
          plaid_account_id: account.account_id,
          user_id,
          trace_id: ctx.trace_id,
        },
        { trace_id: ctx.trace_id }
      );
      restore_jobs_enqueued = true;
    }

    // 11. Emit domain event
    const event_payload: AccountRestoredPayload = {
      account_id: input.account_id,
      user_id,
      restored_at: Timestamp.now(),
      restore_transactions: input.restore_transactions,
      restore_recurring: input.restore_recurring,
    };
    events.emit(ACCOUNT_EVENTS.RESTORED, event_payload);

    // 12. Async debug logging
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "restore_account",
        status: "success",
        context: {
          account_id: input.account_id,
          restore_transactions: input.restore_transactions,
          restore_recurring: input.restore_recurring,
          restore_jobs_enqueued,
          perf_reads: perf.reads,
          perf_writes: perf.writes,
        },
      })
    );

    console.log(
      `[${ctx.trace_id}] restore_account: account=${input.account_id}, ` +
      `jobs_enqueued=${restore_jobs_enqueued}`
    );

    return {
      success: true,
      account_id: input.account_id,
      was_idempotent: false,
      restore_jobs_enqueued,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id, error_code: "RESTORE_ACCOUNT_FAILED" }
    );

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
