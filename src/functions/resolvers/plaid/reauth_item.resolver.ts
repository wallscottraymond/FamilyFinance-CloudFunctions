/**
 * Re-authentication Item Resolver
 *
 * READ-ONLY: loads Plaid items needing re-authentication with their decrypted
 * access tokens, for the recovery probe. No mutations.
 *
 * @module resolvers/plaid/reauth_item
 */

import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { plaid_item_repo } from "../../repositories/plaid/plaid_item.repo";
import { decryptAccessToken } from "../../../utils/encryption";
import {
  REAUTH_STATUSES,
  MAX_REAUTH_PROBES_PER_RUN,
  ReauthItem,
} from "../../types/plaid/reauth_recovery.types";

/**
 * Decrypts a stored token; null when missing or undecryptable.
 */
function decrypt_or_null(
  ctx: TraceContext,
  item_doc_id: string,
  encrypted: unknown
): string | null {
  if (typeof encrypted !== "string" || encrypted.length === 0) {
    return null;
  }
  try {
    return decryptAccessToken(encrypted);
  } catch (error) {
    console.error(
      `[${ctx.trace_id}] Failed to decrypt access token for item ${item_doc_id}:`,
      error
    );
    return null;
  }
}

/**
 * Resolves one item by document ID.
 *
 * @param ctx - Trace context
 * @param item_doc_id - Plaid item document ID
 * @returns The item, or null when it doesn't exist
 */
export async function resolve_reauth_item(
  ctx: TraceContext,
  item_doc_id: string
): Promise<ReauthItem | null> {
  const span = create_span(ctx, "resolver", "resolve_reauth_item");
  log_operation_start(span, "system");

  const raw = await plaid_item_repo.get_raw_by_id(ctx, item_doc_id);
  if (!raw) {
    log_operation_success(span, "system");
    return null;
  }

  const data = raw.data;
  const item: ReauthItem = {
    item_doc_id: raw.id,
    plaid_item_id: data.plaidItemId as string,
    user_id: data.userId as string,
    status: (data.status as string) || "good",
    is_active: data.isActive !== false,
    access_token: decrypt_or_null(ctx, raw.id, data.accessToken),
  };

  log_operation_success(span, "system");
  return item;
}

/**
 * Resolves every active item currently needing re-authentication (capped).
 *
 * @param ctx - Trace context
 * @returns Items to probe
 */
export async function resolve_reauth_items_to_probe(
  ctx: TraceContext
): Promise<ReauthItem[]> {
  const span = create_span(ctx, "resolver", "resolve_reauth_items_to_probe");
  log_operation_start(span, "system");

  // Same status query the transient-retry job uses; it already skips inactive items.
  const rows = await plaid_item_repo.get_in_transient_state(ctx, REAUTH_STATUSES);

  const items: ReauthItem[] = [];
  for (const row of rows.slice(0, MAX_REAUTH_PROBES_PER_RUN)) {
    const item = await resolve_reauth_item(ctx, row.item_doc_id);
    if (item && item.is_active) {
      items.push(item);
    }
  }

  log_operation_success(span, "system");
  return items;
}
