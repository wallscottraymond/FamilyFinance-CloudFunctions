/**
 * Link Plaid Account Resolver
 *
 * Gathers dependencies needed for linking a Plaid account.
 * READ-ONLY operations - no mutations.
 *
 * @module resolvers/plaid/link_plaid_account
 */

import {
  TraceContext,
  LinkAccountDependencies,
  ResolveLinkAccountInput,
} from "../../types";
import { create_span, log_operation_start, log_operation_success } from "../../observability";
import { plaid_item_repo } from "../../repositories/plaid";
import { user_repo } from "../../repositories/user.repo";

/**
 * Resolves dependencies for linking a Plaid account.
 *
 * Gathers:
 * - User's group IDs for RBAC
 * - Whether the institution is already linked (duplicate detection)
 *
 * @param ctx - Trace context
 * @param input - Resolution input
 * @returns Resolved dependencies
 */
export async function resolve_link_account_dependencies(
  ctx: TraceContext,
  input: ResolveLinkAccountInput
): Promise<LinkAccountDependencies> {
  const span = create_span(ctx, "resolver", "resolve_link_account_dependencies");
  log_operation_start(span, input.user_id);

  // 1. Fetch user profile for group IDs
  const user = await user_repo.get_by_id(ctx, input.user_id);
  const user_data = user?.data ?? null;

  // Extract group IDs from user profile
  const group_id =
    (user_data?.familyId as string | undefined) ||
    (user_data?.groupId as string | undefined) ||
    null;
  const group_ids: string[] = group_id ? [group_id] : [];

  // 2. Check if institution is already linked (via repository)
  const existing_item = await plaid_item_repo.get_by_user_and_institution(
    ctx,
    input.user_id,
    input.institution_id
  );

  const institution_already_linked = existing_item !== null;
  const existing_item_id = existing_item?.id || null;

  log_operation_success(span, input.user_id);

  return {
    group_ids,
    institution_already_linked,
    existing_item_id,
  };
}
