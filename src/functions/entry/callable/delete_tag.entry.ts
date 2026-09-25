/**
 * delete_tag — onCall entry to delete a catalog tag (owner only).
 *
 * NOTE: stripping the tag id from tagged transactions/budgets/rules is added in later phases (once
 * the denormalized `tagIds`, budget tags, and rule tag-refs exist to strip). For now this deletes
 * the catalog doc; any not-yet-existent references get handled by that later bounded-batch strip.
 *
 * @module entry/callable/delete_tag
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { create_trace_context } from "../../observability";
import { tags_repo } from "../../repositories/tags.repo";
import { delete_tag_input_schema } from "../../types/tags_crud.types";

export const delete_tag = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request): Promise<{ success: true }> => {
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

    await tags_repo.delete_tag(ctx, parsed.data.tag_id);
    return { success: true };
  }
);
