/**
 * set_budget_tags — onCall entry to apply tags to a budget (owner only).
 *
 * Budgets store tags top-level (`tags`), directly queryable via array-contains.
 *
 * @module entry/callable/set_budget_tags
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { create_trace_context } from "../../observability";
import { tags_repo } from "../../repositories/tags.repo";
import { budget_repo } from "../../repositories/budget.repo";
import { set_budget_tags_input_schema } from "../../types/tags_crud.types";

export const set_budget_tags = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request): Promise<{ success: true }> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(false);

    const parsed = set_budget_tags_input_schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        parsed.error.issues.map((i) => i.message).join("; ")
      );
    }
    const { budget_id, tag_ids } = parsed.data;

    // Reject tag ids that aren't in the user's catalog (prevents dangling ids on docs).
    if (tag_ids.length > 0) {
      const catalog = await tags_repo.list_tags(ctx, user_id);
      const owned = new Set(catalog.map((t) => t.id));
      const unknown = tag_ids.filter((id) => !owned.has(id));
      if (unknown.length > 0) {
        throw new HttpsError("invalid-argument", `Unknown tag id(s): ${unknown.join(", ")}`);
      }
    }

    const budget = await budget_repo.get_by_id(ctx, budget_id);
    if (!budget) {
      throw new HttpsError("not-found", "Budget not found");
    }
    if (budget.user_id !== user_id) {
      throw new HttpsError("permission-denied", "Not your budget");
    }

    await budget_repo.set_tags(ctx, budget_id, tag_ids, user_id);
    return { success: true };
  }
);
