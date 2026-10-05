/**
 * Pending Item Removal Resolver
 *
 * READ-ONLY: the Plaid items whose removal failed during an account removal,
 * with decrypted access tokens for the retry. No mutations.
 *
 * @module resolvers/plaid/pending_item_removal
 */

import { TraceContext } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
} from "../../observability";
import { plaid_item_repo } from "../../repositories/plaid/plaid_item.repo";
import { decryptAccessToken } from "../../../utils/encryption";

/** An item awaiting a retried Plaid removal. */
export interface PendingItemRemoval {
  item_doc_id: string;
  user_id: string;
  /** Decrypted access token, or null if missing/undecryptable */
  access_token: string | null;
}

/**
 * Resolves items flagged `removalPending`.
 *
 * @param ctx - Trace context
 * @returns Items to retry
 */
export async function resolve_pending_item_removals(
  ctx: TraceContext
): Promise<PendingItemRemoval[]> {
  const span = create_span(ctx, "resolver", "resolve_pending_item_removals");
  log_operation_start(span, "system");

  const rows = await plaid_item_repo.get_pending_removal(ctx);
  const items = rows.map((row) => {
    let access_token: string | null = null;
    const encrypted = row.data.accessToken;
    if (typeof encrypted === "string" && encrypted.length > 0) {
      try {
        access_token = decryptAccessToken(encrypted);
      } catch {
        access_token = null;
      }
    }
    return { item_doc_id: row.id, user_id: row.data.userId as string, access_token };
  });

  log_operation_success(span, "system");
  return items;
}
