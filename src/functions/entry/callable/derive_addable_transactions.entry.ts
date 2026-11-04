/**
 * derive_addable_transactions — onCall entry: what can be added to a budget by hand in a period
 * (Manual-Budgets). Read-only. A view the caller isn't a member of is refused by the scope check.
 *
 * @module entry/callable/derive_addable_transactions
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { create_trace_context } from "../../observability";
import { derive_addable_transactions_orchestrator } from "../../orchestrators/budgets/derive_budget_transactions.orchestrator";
import { derive_scope_schema } from "../../types/schemas/derive_scope.schema";

const MAX_WINDOW_MS = 370 * 24 * 60 * 60 * 1000;
const schema = z
  .object({
    budget_id: z.string().min(1).max(128),
    window_start_ms: z.number().int().nonnegative(),
    window_end_ms: z.number().int().nonnegative(),
    scope: derive_scope_schema.optional(),
  })
  .refine((d) => d.window_end_ms >= d.window_start_ms && d.window_end_ms - d.window_start_ms <= MAX_WINDOW_MS, {
    message: "window is invalid",
  });

export const derive_addable_transactions = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be authenticated");
    const parsed = schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const ctx = create_trace_context(false);
    try {
      const rows = await derive_addable_transactions_orchestrator(
        ctx, request.auth.uid, parsed.data.budget_id, parsed.data.window_start_ms, parsed.data.window_end_ms,
        parsed.data.scope
      );
      return { rows };
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error(`[${ctx.trace_id}] derive_addable_transactions failed:`, error);
      throw new HttpsError("internal", "Could not load transactions");
    }
  }
);
