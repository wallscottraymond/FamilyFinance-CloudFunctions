/**
 * list_rules — onCall entry returning the caller's rules (active + inactive), priority-ordered,
 * for the Rule Book UI.
 *
 * @module entry/callable/list_rules
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { create_trace_context } from "../../observability";
import { rules_repo } from "../../repositories/rules.repo";
import { ListRulesResponse } from "../../types/rules_crud.types";

export const list_rules = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request): Promise<ListRulesResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const ctx = create_trace_context(false);
    const rules = await rules_repo.list_rules(ctx, request.auth.uid);
    return { rules };
  }
);
