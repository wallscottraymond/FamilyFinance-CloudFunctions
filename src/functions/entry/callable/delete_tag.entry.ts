/**
 * delete_tag — onCall entry to delete a catalog tag (owner only).
 *
 * Bounded-batch strip: removes the tag id from every tagged transaction (`split.tags` + the
 * denormalized `tagIds`) and budget (`tags`), then deletes the catalog doc. Rule tag-refs are
 * stripped in Phase 3 (once the Rule Book gains tag conditions/actions).
 *
 * @module entry/callable/delete_tag
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { create_trace_context } from "../../observability";
import { tags_repo } from "../../repositories/tags.repo";
import { transaction_repo } from "../../repositories/transaction.repo";
import { budget_repo } from "../../repositories/budget.repo";
import { delete_tag_input_schema } from "../../types/tags_crud.types";

export const delete_tag = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (
    request
  ): Promise<{ success: true; stripped: { transactions: number; budgets: number } }> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(false);

    const parsed = delete_tag_input_schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        parsed.error.issues.map((i) => i.message).join("; ")
      );
    }

    const existing = await tags_repo.get_tag(ctx, parsed.data.tag_id);
    if (!existing) {
      throw new HttpsError("not-found", "Tag not found");
    }
    if (existing.user_id !== user_id) {
      throw new HttpsError("permission-denied", "Not your tag");
    }

    // Strip references BEFORE deleting the catalog doc so a mid-way failure leaves the tag
    // recoverable (still in the catalog) rather than orphaned ids on docs.
    const transactions = await transaction_repo.strip_tag(ctx, user_id, parsed.data.tag_id);
    const budgets = await budget_repo.strip_tag(ctx, user_id, parsed.data.tag_id);

    await tags_repo.delete_tag(ctx, parsed.data.tag_id);
    return { success: true, stripped: { transactions, budgets } };
  }
);
