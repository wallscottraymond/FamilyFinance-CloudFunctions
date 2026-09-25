/**
 * update_tag — onCall entry to rename/recolor a tag (owner only; name stays unique).
 *
 * @module entry/callable/update_tag
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { create_trace_context } from "../../observability";
import { tags_repo } from "../../repositories/tags.repo";
import { update_tag_input_schema } from "../../types/tags_crud.types";

export const update_tag = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request): Promise<{ success: true }> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(false);

    const parsed = update_tag_input_schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        parsed.error.issues.map((i) => i.message).join("; ")
      );
    }
    const input = parsed.data;

    const existing = await tags_repo.get_tag(ctx, input.tag_id);
    if (!existing) {
      throw new HttpsError("not-found", "Tag not found");
    }
    if (existing.user_id !== user_id) {
      throw new HttpsError("permission-denied", "Not your tag");
    }

    if (input.name !== undefined) {
      const name = input.name.trim();
      const all = await tags_repo.list_tags(ctx, user_id);
      if (all.some((t) => t.id !== input.tag_id && t.name.toLowerCase() === name.toLowerCase())) {
        throw new HttpsError("already-exists", "A tag with that name already exists.");
      }
    }

    await tags_repo.update_tag(ctx, input.tag_id, {
      name: input.name?.trim(),
      color: input.color,
    });
    return { success: true };
  }
);
