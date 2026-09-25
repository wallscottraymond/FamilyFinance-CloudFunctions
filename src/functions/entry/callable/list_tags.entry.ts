/**
 * list_tags — onCall entry returning the caller's tag catalog, name-sorted.
 *
 * @module entry/callable/list_tags
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { create_trace_context } from "../../observability";
import { tags_repo } from "../../repositories/tags.repo";
import { ListTagsResponse } from "../../types/tags_crud.types";

export const list_tags = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request): Promise<ListTagsResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const ctx = create_trace_context(false);
    const tags = await tags_repo.list_tags(ctx, request.auth.uid);
    return { tags };
  }
);
