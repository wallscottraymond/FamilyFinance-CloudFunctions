/**
 * Refresh Plaid Data Resolver
 *
 * Resolves dependencies for the combined balance + transaction sync.
 * This is primarily a delegation to the balance sync resolver with
 * additional context for transaction sync.
 *
 * @module resolvers/plaid/refresh_plaid_data
 */

import { TraceContext } from "../../types";
import {
  ResolveRefreshInput,
  RefreshPlaidDataDependencies,
} from "../../types/plaid/refresh_plaid_data.types";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { decryptAccessToken } from "../../../utils/encryption";
import { plaid_item_repo } from "../../repositories/plaid";

/** Rate limit window in seconds (5 minutes) */
const RATE_LIMIT_SECONDS = 300;

/**
 * Resolves dependencies for the refresh operation.
 *
 * Fetches:
 * - Plaid items for the user
 * - User context (group_ids, family_id, currency)
 * - Rate limit status for each item
 *
 * @param ctx - Trace context
 * @param input - Resolver input
 * @returns Dependencies or null if user has no items
 */
export async function resolve_refresh_dependencies(
  ctx: TraceContext,
  input: ResolveRefreshInput
): Promise<RefreshPlaidDataDependencies | null> {
  const db = getFirestore();
  const now = Timestamp.now();

  console.log(
    `[${ctx.trace_id}] Resolving refresh dependencies for user ${input.user_id}`
  );

  // 1. The user's ACTIVE Plaid items, whatever their status (Code-Health-Review P2-M1: the old
  //    `status == "active"` matched no item — writers set "good", "item_login_required", …).
  const all_items = await plaid_item_repo.get_by_user_id(ctx, input.user_id);
  const selected = input.item_id
    ? all_items.filter((i) => i.plaid_item_id === input.item_id)
    : all_items;

  if (selected.length === 0) {
    console.log(`[${ctx.trace_id}] No Plaid items found for user`);
    return null;
  }

  // 2. Fetch user document for context
  const user_doc = await db.collection("users").doc(input.user_id).get();
  const user_data = user_doc.data();

  const user_context = {
    // Accounts start private (Account-Rooted-Sharing P1); sharing is per-account placement.
    group_ids: [],
    family_id: user_data?.familyId || null,
    currency: user_data?.currency || "USD",
  };

  // 3. Build items list with decrypted tokens and check rate limits
  const items: RefreshPlaidDataDependencies["items"] = [];
  const rate_limited_items: string[] = [];

  for (const item of selected) {
    const item_id = item.plaid_item_id;

    // Rate limit on the field the sync actually writes (`lastSyncedAt`).
    const last_sync = item.last_synced_at;
    if (last_sync) {
      const seconds_since = now.seconds - last_sync.seconds;
      if (seconds_since < RATE_LIMIT_SECONDS) {
        rate_limited_items.push(item_id);
        console.log(
          `[${ctx.trace_id}] Item ${item_id} rate limited (${seconds_since}s since last sync)`
        );
        continue;
      }
    }

    // The stored, encrypted `accessToken`.
    if (!item.access_token) {
      console.warn(`[${ctx.trace_id}] Plaid item ${item.id} has no access token, skipping`);
      continue;
    }
    try {
      items.push({
        item_id,
        doc_id: item.id,
        access_token: decryptAccessToken(item.access_token),
        institution_name: item.institution_name || "Unknown",
      });
    } catch (error) {
      console.error(
        `[${ctx.trace_id}] Failed to decrypt token for item ${item_id}:`,
        error
      );
      // Skip this item but continue with others
    }
  }

  console.log(
    `[${ctx.trace_id}] Resolved ${items.length} items to sync, ${rate_limited_items.length} rate limited`
  );

  return {
    items,
    user_context,
    rate_limited_items,
  };
}

