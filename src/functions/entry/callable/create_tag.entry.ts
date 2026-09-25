/**
 * create_tag — onCall entry to create a catalog tag (unique case-insensitive name, per-user cap).
 *
 * @module entry/callable/create_tag
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { create_trace_context } from "../../observability";
import { tags_repo } from "../../repositories/tags.repo";
import {
  create_tag_input_schema,
  CreateTagResponse,
  MAX_TAGS_PER_USER,
} from "../../types/tags_crud.types";

export const create_tag = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request): Promise<CreateTagResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(false);

    const parsed = create_tag_input_schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        parsed.error.issues.map((i) => i.message).join("; ")
      );
    }
    const name = parsed.data.name.trim();

    const existing = await tags_repo.list_tags(ctx, user_id);
    if (existing.length >= MAX_TAGS_PER_USER) {
      throw new HttpsError("resource-exhausted", `Tag limit reached (${MAX_TAGS_PER_USER}).`);
    }
    if (existing.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
      throw new HttpsError("already-exists", "A tag with that name already exists.");
    }

    const tag_id = await tags_repo.create_tag(ctx, user_id, {
      name,
      color: parsed.data.color,
    });
    return { tag_id };
  }
);
