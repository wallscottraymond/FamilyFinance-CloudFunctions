/**
 * Initial Sync Resolver
 *
 * Gathers dependencies for the initial sync orchestrator.
 * - Fetches plaid_item and decrypts access token
 * - Gets user's group_ids for RBAC
 * - Builds institution info for account creation
 *
 * @module resolvers/plaid/initial_sync
 */

import { getFirestore } from "firebase-admin/firestore";
import { TraceContext } from "../../types";
import { InitialSyncInput, InitialSyncDependencies } from "../../types/plaid";
import { decryptAccessToken } from "../../../utils/encryption";

/**
 * Resolves dependencies needed for the initial sync orchestrator.
 *
 * This resolver:
 * 1. Fetches the plaid_item document
 * 2. Decrypts the access token
 * 3. Fetches user profile for group_ids
 * 4. Builds institution info
 *
 * @param ctx - Trace context
 * @param input - Initial sync input
 * @returns Dependencies for the orchestrator
 */
export async function resolve_initial_sync_dependencies(
  ctx: TraceContext,
  input: InitialSyncInput
): Promise<InitialSyncDependencies> {
  const db = getFirestore();

  // Fetch plaid_item document
  const item_doc = await db.collection("plaid_items").doc(input.item_doc_id).get();

  if (!item_doc.exists) {
    throw new Error(`Plaid item not found: ${input.item_doc_id}`);
  }

  const item_data = item_doc.data();
  if (!item_data) {
    throw new Error(`Plaid item has no data: ${input.item_doc_id}`);
  }

  // Decrypt access token
  const encrypted_token = item_data.accessToken;
  if (!encrypted_token) {
    throw new Error(`Plaid item has no access token: ${input.item_doc_id}`);
  }

  let access_token: string;
  try {
    access_token = decryptAccessToken(encrypted_token);
  } catch (error) {
    throw new Error(`Failed to decrypt access token for item: ${input.item_doc_id}`);
  }

  // Fetch user profile for group_ids
  const user_doc = await db.collection("users").doc(input.user_id).get();
  let group_ids: string[] = [];

  if (user_doc.exists) {
    const user_data = user_doc.data();
    // groupIds can be on the user doc or we use familyId
    group_ids = user_data?.groupIds ?? [];

    // If user has familyId but no groupIds, use familyId as a group
    if (group_ids.length === 0 && user_data?.familyId) {
      group_ids = [user_data.familyId];
    }
  }

  // Build institution info
  const institution = {
    institution_id: input.institution_id,
    name: input.institution_name,
  };

  console.log(
    `[${ctx.trace_id}] Resolved initial sync dependencies for item ${input.plaid_item_id}: ` +
    `cursor=${item_data.cursor || "null"}, groups=${group_ids.length}`
  );

  return {
    plaid_item: {
      id: input.item_doc_id,
      access_token,
      cursor: item_data.cursor || null,
    },
    group_ids,
    institution,
  };
}
