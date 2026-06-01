/**
 * Remove Account Orchestrator
 *
 * Coordinates soft-deletion of an account with two-tier removal logic:
 * - Single Account Removal: Local soft-delete only (Plaid item stays active)
 * - Full Item Removal: Call Plaid API + soft-delete (last account for item)
 *
 * Includes idempotency handling, permission checks, cascade job scheduling,
 * and event emission.
 *
 * @module orchestrators/accounts/remove_account
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
import {
  check_idempotency,
  claim_key,
  complete_key,
  fail_key,
} from "../../infrastructure/idempotency_store";
import {
  check_account_delete_access,
  is_account_already_deleted,
  AccountAccessData,
  UserAccessContext,
  RemovalMode,
  determine_removal_type,
  compute_account_removal,
} from "../../domain";
import {
  resolve_account_removal_dependencies,
  AccountRemovalDependencyResult,
} from "../../resolvers";
import {
  create_event_emitter,
  ACCOUNT_EVENTS,
  AccountRemovedPayload,
} from "../../events";
import { remove_item } from "../../integrations/plaid";
import { plaid_item_repo } from "../../repositories/plaid/plaid_item.repo";
import { decryptAccessToken } from "../../../utils/encryption";
import { create_job } from "../../infrastructure/job_queue";
import { CascadeHideTransactionsInput } from "./cascade_hide_transactions.orchestrator";
import { CascadeSoftDeleteRecurringInput } from "./cascade_soft_delete_recurring.orchestrator";

/**
 * Performance budget for remove_account.
 */
const BUDGET: PerformanceBudget = {
  max_reads: 15, // Increased for resolver reads
  max_writes: 5,
  max_time_ms: 2000, // Increased to allow for Plaid API call
};

/**
 * Input for remove account operation.
 */
export interface RemoveAccountInput {
  /** Account ID to remove */
  account_id: string;

  /** Idempotency key for deduplication */
  idempotency_key: string;

  /**
   * How to handle transaction history.
   * - keep_history: Transactions hidden but still count in budget totals
   * - delete_history: Transactions hidden AND excluded from budget calculations
   */
  removal_mode: RemovalMode;
}

/**
 * Result of remove account operation.
 */
export interface RemoveAccountResult {
  /** Whether the account was removed */
  success: boolean;

  /** The removed account ID */
  account_id: string;

  /** Whether this was an idempotent return (already processed) */
  was_idempotent: boolean;

  /** Whether this was a single account or full item removal */
  removal_type: "single_account" | "full_item";

  /** Number of transactions that will be hidden */
  transaction_count: number;

  /** Number of recurring outflows that will be soft-deleted */
  outflow_count: number;

  /** Number of recurring inflows that will be soft-deleted */
  inflow_count: number;

  /** Whether cascade jobs were enqueued for background processing */
  cascade_jobs_enqueued: boolean;
}

/**
 * Orchestrates soft-deletion of an account with two-tier removal logic.
 *
 * Flow (per architecture):
 * 1. Create span, log start
 * 2. Idempotency check
 * 3. Claim idempotency key
 * 4. Repository read (get account)
 * 5. Domain service (permission check)
 * 6. Resolver (dependency analysis - determines removal type)
 * 7. Domain service (compute removal state)
 * 8. Integration client (Plaid API - only for full item removal)
 * 9. Repository write (soft delete)
 * 10. Complete idempotency key
 * 11. Emit domain event
 * 12. Enqueue cascade jobs (transactions, recurring items)
 * 13. Log success, async debug
 *
 * @param ctx - Trace context
 * @param user_id - User performing the deletion
 * @param input - Remove account input
 * @param user_group_ids - User's group memberships
 * @returns Remove result
 */
export async function remove_account_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: RemoveAccountInput,
  user_group_ids: string[] = []
): Promise<RemoveAccountResult> {
  const span = create_span(ctx, "orchestrator", "remove_account");
  const perf = create_performance_metrics();
  const events = create_event_emitter(ctx.trace_id, span.span_id, user_id);
  log_operation_start(span, user_id);

  let key_claimed = false;
  let dependencies: AccountRemovalDependencyResult | null = null;

  try {
    // 1. Idempotency check
    const idempotency_result = await check_idempotency(ctx, input.idempotency_key);
    perf.reads++;

    if (idempotency_result.is_duplicate) {
      if (idempotency_result.status === "completed") {
        log_idempotent_return(span, user_id);
        // Return cached result with default values for new fields
        return {
          success: true,
          account_id: input.account_id,
          was_idempotent: true,
          removal_type: "single_account",
          transaction_count: 0,
          outflow_count: 0,
          inflow_count: 0,
          cascade_jobs_enqueued: false,
        };
      }

      if (idempotency_result.status === "in_progress") {
        throw new Error("Request already in progress");
      }

      // If status is "failed", treat as new request (allow retry)
    }

    // 2. Claim the idempotency key before processing
    const claimed = await claim_key(ctx, input.idempotency_key);
    perf.writes++;
    if (!claimed) {
      throw new Error("Request already in progress");
    }
    key_claimed = true;

    // 3. Repository read: Get the account
    const account = await account_repo.get_by_id(ctx, input.account_id);
    perf.reads++;

    if (!account) {
      throw new NotFoundError("account", input.account_id);
    }

    // 4. Domain service: Permission check (PURE - no IO)
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

    const access_result = check_account_delete_access(access_data, user_context);

    if (!access_result.entity?.has_access) {
      if (access_result.validation_errors?.length) {
        throw new PermissionDeniedError(
          "remove_account",
          input.account_id
        );
      }
    }

    // 5. Domain service: Check if already deleted (idempotent case)
    if (is_account_already_deleted(access_data)) {
      log_idempotent_return(span, user_id);
      const result = { success: true, account_id: input.account_id };
      await complete_key(ctx, input.idempotency_key, result);
      perf.writes++;
      return {
        success: true,
        account_id: input.account_id,
        was_idempotent: true,
        removal_type: "single_account",
        transaction_count: 0,
        outflow_count: 0,
        inflow_count: 0,
        cascade_jobs_enqueued: false,
      };
    }

    // 6. Resolver: Dependency analysis (what else is affected?)
    // This also determines if this is a single account or full item removal
    dependencies = await resolve_account_removal_dependencies(
      ctx,
      input.account_id,
      user_id
    );
    // Note: Resolver reads are tracked internally

    // 7. Domain service: Determine removal type (PURE - no IO)
    const removal_type_result = determine_removal_type({
      account_id: input.account_id,
      item_id: dependencies.item_id,
      other_active_accounts_count: dependencies.other_active_accounts_count,
    });

    if (removal_type_result.validation_errors?.length) {
      throw new Error(removal_type_result.validation_errors.join("; "));
    }

    const { removal_type, should_call_plaid, reason } = removal_type_result.entity!;

    console.log(
      `[${ctx.trace_id}] remove_account: type=${removal_type}, ` +
      `call_plaid=${should_call_plaid}, reason="${reason}"`
    );

    // 8. Domain service: Compute removal state (PURE - no IO)
    const removal_result = compute_account_removal({
      account_id: input.account_id,
      account_user_id: account.user_id,
      item_id: dependencies.item_id || null,
      removal_mode: input.removal_mode,
      removal_type,
      now: new Date(),
    });

    if (removal_result.validation_errors?.length) {
      throw new Error(removal_result.validation_errors.join("; "));
    }

    const removal_actions = removal_result.entity!;

    // 9. Integration client: Call Plaid API (only for full item removal)
    let plaid_removal_success = true;
    if (removal_actions.should_remove_plaid_item && dependencies.item_id) {
      try {
        // Get the plaid item to retrieve the encrypted access token
        const plaid_item = await plaid_item_repo.get_by_id(ctx, dependencies.item_id);
        perf.reads++;

        if (plaid_item && plaid_item.access_token) {
          // Decrypt the access token
          const access_token = decryptAccessToken(plaid_item.access_token);

          const plaid_result = await remove_item(access_token);

          console.log(
            `[${ctx.trace_id}] Plaid itemRemove: success=${plaid_result.success}, ` +
            `already_removed=${plaid_result.already_removed}, request_id=${plaid_result.request_id}`
          );

          plaid_removal_success = plaid_result.success;

          // Also soft-delete the plaid item document
          if (plaid_removal_success) {
            await plaid_item_repo.soft_delete(ctx, dependencies.item_id, user_id);
            perf.writes++;
          }
        } else {
          console.warn(
            `[${ctx.trace_id}] No access token found for item ${dependencies.item_id}, ` +
            `skipping Plaid API call`
          );
        }
      } catch (plaid_error) {
        // Log but continue - still soft-delete locally
        // TODO: Enqueue background job to retry Plaid cleanup
        console.error(
          `[${ctx.trace_id}] Plaid itemRemove failed, continuing with local soft-delete:`,
          plaid_error
        );
        plaid_removal_success = false;
      }
    }

    // Check performance budget before write
    if (is_budget_exceeded(perf, BUDGET)) {
      console.warn(
        `[${ctx.trace_id}] Performance budget warning for remove_account`
      );
      // Continue anyway - completion is more important
    }

    // 10. Repository write: Soft delete the account (audit is automatic)
    await account_repo.soft_delete(ctx, input.account_id, user_id);
    perf.writes++;

    // 11. Complete idempotency key
    const result = { success: true, account_id: input.account_id };
    await complete_key(ctx, input.idempotency_key, result);
    perf.writes++;

    log_operation_success(span, user_id);

    // 12. Emit domain event (fire-and-forget)
    const event_payload: AccountRemovedPayload = {
      account_id: input.account_id,
      user_id,
      removed_at: Timestamp.now(),
    };
    events.emit(ACCOUNT_EVENTS.REMOVED, event_payload);

    // 13. Enqueue cascade jobs (if needed)
    let cascade_jobs_enqueued = false;

    if (dependencies.recomputation_scope !== "none") {
      console.log(
        `[${ctx.trace_id}] Enqueuing cascade jobs: ` +
        `transactions=${dependencies.transaction_count}, ` +
        `outflows=${dependencies.outflow_ids.length}, ` +
        `inflows=${dependencies.inflow_ids.length}`
      );

      // Enqueue transaction hiding job if there are transactions
      if (dependencies.transaction_count > 0) {
        const hide_transactions_payload: CascadeHideTransactionsInput = {
          plaid_account_id: account.account_id,
          user_id,
          removal_mode: input.removal_mode,
          trace_id: ctx.trace_id,
        };

        await create_job(
          "cascade_hide_transactions",
          hide_transactions_payload,
          { trace_id: ctx.trace_id }
        );
        cascade_jobs_enqueued = true;
      }

      // Enqueue recurring items soft-delete job if there are outflows or inflows
      if (dependencies.outflow_ids.length > 0 || dependencies.inflow_ids.length > 0) {
        const soft_delete_recurring_payload: CascadeSoftDeleteRecurringInput = {
          plaid_account_id: account.account_id,
          user_id,
          outflow_ids: dependencies.outflow_ids,
          inflow_ids: dependencies.inflow_ids,
          trace_id: ctx.trace_id,
        };

        await create_job(
          "cascade_soft_delete_recurring",
          soft_delete_recurring_payload,
          { trace_id: ctx.trace_id }
        );
        cascade_jobs_enqueued = true;
      }

      // TODO: Enqueue budget recalculation job if removal_mode === "delete_history"
      // TODO: Enqueue Plaid cleanup retry job if plaid_removal_success === false
    }

    // 14. Async debug logging
    fire_and_forget(() =>
      log_async_debug({
        trace_id: ctx.trace_id,
        span_id: span.span_id,
        layer: "orchestrator",
        function: "remove_account",
        status: "success",
        context: {
          account_id: input.account_id,
          removal_mode: input.removal_mode,
          removal_type,
          plaid_removal_success,
          transaction_count: dependencies?.transaction_count ?? 0,
          outflow_count: dependencies?.outflow_ids.length ?? 0,
          inflow_count: dependencies?.inflow_ids.length ?? 0,
          recomputation_scope: dependencies?.recomputation_scope ?? "none",
          perf_reads: perf.reads,
          perf_writes: perf.writes,
        },
      })
    );

    return {
      success: true,
      account_id: input.account_id,
      was_idempotent: false,
      removal_type,
      transaction_count: dependencies.transaction_count,
      outflow_count: dependencies.outflow_ids.length,
      inflow_count: dependencies.inflow_ids.length,
      cascade_jobs_enqueued,
    };
  } catch (error) {
    log_operation_error(
      span,
      error instanceof Error ? error : new Error(String(error)),
      { user_id, error_code: "REMOVE_ACCOUNT_FAILED" }
    );

    // Release the idempotency key on failure (if claimed)
    if (key_claimed) {
      try {
        await fail_key(
          ctx,
          input.idempotency_key,
          error instanceof Error ? error.message : "Unknown error"
        );
      } catch (fail_error) {
        // Log but don't throw - the original error is more important
        console.error("Failed to release idempotency key:", fail_error);
      }
    }

    throw error;
  }
}
