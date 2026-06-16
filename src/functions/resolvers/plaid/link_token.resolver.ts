/**
 * Link Token Resolver
 *
 * Gathers dependencies needed for link token creation.
 * READ-ONLY operations - no mutations.
 *
 * @module resolvers/plaid/link_token
 */

import {
  TraceContext,
  LinkTokenDependencies,
  ResolveLinkTokenInput,
  LINK_TOKEN_CACHE_TTL_HOURS,
} from "../../types";
import { link_token_event_repo, plaid_item_repo } from "../../repositories/plaid";
import { user_repo } from "../../repositories/user.repo";
import { create_span, log_operation_start, log_operation_success } from "../../observability";

/**
 * Resolves dependencies for link token creation.
 *
 * Gathers:
 * - User profile (display name, email)
 * - Existing Plaid items count (for future account limits)
 * - Cached token if available
 * - Access token validity for update mode
 *
 * @param ctx - Trace context
 * @param input - Resolution input
 * @returns Resolved dependencies
 */
export async function resolve_link_token_dependencies(
  ctx: TraceContext,
  input: ResolveLinkTokenInput
): Promise<LinkTokenDependencies> {
  const span = create_span(ctx, "resolver", "resolve_link_token_dependencies");
  log_operation_start(span, input.user_id);

  // 1. Check for cached token first
  const cached = await link_token_event_repo.get_valid_token(
    ctx,
    input.user_id,
    input.is_update_mode,
    { max_age_hours: LINK_TOKEN_CACHE_TTL_HOURS }
  );

  // 2. Fetch user profile
  const user = await user_repo.get_by_id(ctx, input.user_id);
  const user_data = user?.data ?? null;

  // 3. Existing active Plaid items for this user
  const active_items = await plaid_item_repo.get_by_user_id(ctx, input.user_id);

  // 4. Validate access token if provided (update mode): the user must have at
  //    least one active item.
  let access_token_valid = true;
  if (input.access_token) {
    access_token_valid = active_items.length > 0;
  }

  log_operation_success(span, input.user_id);

  return {
    user_display_name:
      (user_data?.displayName as string) ||
      (user_data?.name as string) ||
      "Family Finance User",
    user_email: (user_data?.email as string) || null,
    existing_item_count: active_items.length,
    access_token_valid,
    cached_token: cached?.link_token || null,
    cached_expiration: cached?.expiration || null,
  };
}
