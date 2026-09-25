/**
 * set_transaction_tags — onCall entry to apply tags to a transaction (owner only).
 *
 * All tags live at the split level. `split_id` null ⇒ set every split's tags (whole-transaction
 * case, common for single-split txns); a value ⇒ set that one split (multi-split advanced). The
 * repository recomputes the top-level `tagIds` union used by array-contains filtering + strip.
 *
 * The FE cannot write `transactions` directly (owner-read rules), so this is the write path.
 *
 * @module entry/callable/set_transaction_tags
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { create_trace_context } from "../../observability";
import { tags_repo } from "../../repositories/tags.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import { set_transaction_tags_input_schema } from "../../types/tags_crud.types";

export const set_transaction_tags = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request): Promise<{ success: true }> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(false);

    const parsed = set_transaction_tags_input_schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        parsed.error.issues.map((i) => i.message).join("; ")
      );
    }
    const { transaction_id, split_id, tag_ids } = parsed.data;

    // Reject tag ids that aren't in the user's catalog (prevents dangling ids on docs).
    if (tag_ids.length > 0) {
      const catalog = await tags_repo.list_tags(ctx, user_id);
      const owned = new Set(catalog.map((t) => t.id));
      const unknown = tag_ids.filter((id) => !owned.has(id));
      if (unknown.length > 0) {
        throw new HttpsError("invalid-argument", `Unknown tag id(s): ${unknown.join(", ")}`);
      }
    }

    const raw = await transaction_repo.get_raw_by_id(ctx, transaction_id);
    if (!raw) {
      throw new HttpsError("not-found", "Transaction not found");
    }
    const owner = (raw.data.userId ?? raw.data.ownerId) as string | undefined;
    if (owner !== user_id) {
      throw new HttpsError("permission-denied", "Not your transaction");
    }

    await transaction_repo.write_split_tags(
      ctx,
      transaction_id,
      raw.data.splits,
      split_id ?? null,
      tag_ids
    );
    return { success: true };
  }
);
