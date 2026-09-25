/**
 * clear_transaction_review — onCall entry to clear a transaction's Rules Engine review flags
 * (`needsReview`/`needsNote`) from the "Needs review" queue. Owner only.
 *
 * @module entry/callable/clear_transaction_review
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { create_trace_context } from "../../observability";
import { transaction_repo } from "../../repositories";

const schema = z.object({ transaction_id: z.string().min(1) });

export const clear_transaction_review = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request): Promise<{ success: true }> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const user_id = request.auth.uid;
    const ctx = create_trace_context(false);

    const parsed = schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError(
        "invalid-argument",
        parsed.error.issues.map((i) => i.message).join("; ")
      );
    }

    const existing = await transaction_repo.get_raw_by_id(ctx, parsed.data.transaction_id);
    if (!existing) {
      throw new HttpsError("not-found", "Transaction not found");
    }
    if (existing.data.ownerId !== user_id) {
      throw new HttpsError("permission-denied", "Not your transaction");
    }

    await transaction_repo.clear_review_flags(ctx, existing.id);
    return { success: true };
  }
);
