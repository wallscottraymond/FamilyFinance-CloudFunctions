/**
 * Get Accounts Entry Point
 *
 * Cloud Function entry for retrieving user accounts.
 * Read-only operation - returns all accounts for the authenticated user.
 *
 * @module entry/callable/get_accounts
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import {
  create_trace_context,
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import {
  get_accounts_orchestrator,
  get_account_orchestrator,
  GetAccountsResult,
} from "../../orchestrators/accounts";
import { success_response, FunctionResponse } from "../../types";

/**
 * Input schema for get_accounts.
 * All fields are optional for this read operation.
 */
const get_accounts_input_schema = z.object({
  /** Include inactive/deleted accounts */
  include_inactive: z.boolean().optional(),
  /** Debug mode enables verbose logging */
  debug_mode: z.boolean().optional(),
}).optional();

/**
 * Input schema for get_account (single account).
 */
const get_account_input_schema = z.object({
  /** Account ID to retrieve */
  account_id: z.string().min(1, "account_id is required"),
  /** Debug mode enables verbose logging */
  debug_mode: z.boolean().optional(),
});

/**
 * Response data for get_accounts.
 * Entry layer DTO - decoupled from repository types.
 */
interface GetAccountsResponseData {
  accounts: AccountResponseData[];
  count: number;
}

/**
 * Account data as returned to client.
 * Entry layer DTO - maps from internal format to client format.
 */
interface AccountResponseData {
  id: string;
  account_id: string;
  item_id: string;
  name: string;
  mask?: string;
  official_name?: string;
  account_type: string;
  account_subtype: string;
  balances: {
    current: number;
    available?: number;
    limit?: number;
    currency_code?: string;
  };
  institution: {
    id: string;
    name: string;
    logo?: string;
  };
  is_sync_enabled: boolean;
}

/**
 * Internal account structure (from orchestrator).
 * Minimal interface to avoid coupling to full repository type.
 */
interface InternalAccount {
  id: string;
  account_id: string;
  item_id: string;
  name: string;
  mask?: string;
  official_name?: string;
  account_type: string;
  account_subtype: string;
  balances: {
    current: number;
    available?: number;
    limit?: number;
    iso_currency_code?: string;
  };
  institution: {
    id: string;
    name: string;
    logo?: string;
  };
  is_sync_enabled: boolean;
}

/**
 * Maps internal account to response DTO.
 * Transforms field names to client-friendly format.
 */
function map_account_to_response(account: InternalAccount): AccountResponseData {
  return {
    id: account.id,
    account_id: account.account_id,
    item_id: account.item_id,
    name: account.name,
    mask: account.mask,
    official_name: account.official_name,
    account_type: account.account_type,
    account_subtype: account.account_subtype,
    balances: {
      current: account.balances.current,
      available: account.balances.available,
      limit: account.balances.limit,
      currency_code: account.balances.iso_currency_code,
    },
    institution: {
      id: account.institution.id,
      name: account.institution.name,
      logo: account.institution.logo,
    },
    is_sync_enabled: account.is_sync_enabled,
  };
}

/**
 * Get all accounts for the authenticated user.
 *
 * @param request.data.include_inactive - Include deleted accounts
 * @param request.data.debug_mode - Enable verbose logging
 * @returns User's accounts
 */
export const get_accounts = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 100 },
  async (request): Promise<FunctionResponse<GetAccountsResponseData>> => {
    // 1. Authentication check
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "User must be authenticated"
      );
    }
    const user_id = request.auth.uid;

    // 2. Create trace context (root of trace)
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "get_accounts");
    log_operation_start(span, user_id);

    try {
      // 3. Validate input
      const validation = get_accounts_input_schema.safeParse(request.data);
      if (!validation.success) {
        const messages = validation.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        );
        throw new HttpsError(
          "invalid-argument",
          messages.join("; "),
          { trace_id: ctx.trace_id }
        );
      }
      const input = validation.data;

      // 4. Call orchestrator (exactly one)
      const result: GetAccountsResult = await get_accounts_orchestrator(
        ctx,
        user_id,
        input
      );

      // 5. Map response to client DTO
      const response_data: GetAccountsResponseData = {
        accounts: result.accounts.map(
          (account) => map_account_to_response(account as InternalAccount)
        ),
        count: result.count,
      };

      log_operation_success(span, user_id);

      return success_response(response_data, ctx.trace_id);
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id }
      );

      // Re-throw HttpsError as-is
      if (error instanceof HttpsError) {
        throw error;
      }

      // Convert other errors
      throw new HttpsError(
        "internal",
        "Failed to get accounts",
        { trace_id: ctx.trace_id }
      );
    }
  }
);

/**
 * Get a single account by ID.
 *
 * @param request.data.account_id - Account ID to retrieve
 * @param request.data.debug_mode - Enable verbose logging
 * @returns The account or null if not found/unauthorized
 */
export const get_account = onCall(
  /* eslint-disable-next-line @typescript-eslint/naming-convention */
  { maxInstances: 100 },
  async (request): Promise<FunctionResponse<AccountResponseData | null>> => {
    // 1. Authentication check
    if (!request.auth) {
      throw new HttpsError(
        "unauthenticated",
        "User must be authenticated"
      );
    }
    const user_id = request.auth.uid;

    // 2. Create trace context
    const ctx = create_trace_context(request.data?.debug_mode === true);
    const span = create_span(ctx, "entry", "get_account");
    log_operation_start(span, user_id);

    try {
      // 3. Validate input
      const validation = get_account_input_schema.safeParse(request.data);
      if (!validation.success) {
        const messages = validation.error.issues.map(
          (issue: z.ZodIssue) => issue.message
        );
        throw new HttpsError(
          "invalid-argument",
          messages.join("; "),
          { trace_id: ctx.trace_id }
        );
      }
      const input = validation.data;

      // 4. Get user's group memberships for access check
      // TODO: Fetch from user profile when user_repo is available
      const user_group_ids: string[] = [];

      // 5. Call orchestrator
      const account = await get_account_orchestrator(
        ctx,
        user_id,
        input.account_id,
        user_group_ids
      );

      // 6. Map response to client DTO
      const response_data = account
        ? map_account_to_response(account as InternalAccount)
        : null;

      log_operation_success(span, user_id);

      return success_response(response_data, ctx.trace_id);
    } catch (error) {
      log_operation_error(
        span,
        error instanceof Error ? error : new Error(String(error)),
        { user_id }
      );

      if (error instanceof HttpsError) {
        throw error;
      }

      throw new HttpsError(
        "internal",
        "Failed to get account",
        { trace_id: ctx.trace_id }
      );
    }
  }
);
