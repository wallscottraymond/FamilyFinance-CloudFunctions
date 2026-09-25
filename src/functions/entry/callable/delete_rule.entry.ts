/**
 * delete_rule — onCall entry to delete a Rule Book rule (owner only).
 *
 * @module entry/callable/delete_rule
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { create_trace_context } from "../../observability";
import { rules_repo } from "../../repositories/rules.repo";
import { delete_rule_input_schema } from "../../types/rules_crud.types";

export const delete_rule = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request): Promise<{ success: true }> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(false);

    const parsed = delete_rule_input_schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        parsed.error.issues.map((i) => i.message).join("; ")
      );
    }

    const existing = await rules_repo.get_rule(ctx, parsed.data.rule_id);
    if (!existing) {
      throw new HttpsError("not-found", "Rule not found");
    }
    if (existing.user_id !== user_id) {
      throw new HttpsError("permission-denied", "Not your rule");
    }

    await rules_repo.delete_rule(ctx, parsed.data.rule_id);
    return { success: true };
  }
);
