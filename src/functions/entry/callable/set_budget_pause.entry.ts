/**
 * set_budget_pause — onCall entry: pause / resume a budget for exactly the days of one period
 * (Code-Health-Review M1-M1). Any member may pause a group budget, like every budget edit.
 *
 * @module entry/callable/set_budget_pause
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { create_trace_context } from "../../observability";
import { set_budget_pause_orchestrator } from "../../orchestrators/budgets/set_budget_pause.orchestrator";
import { DomainError, ValidationError, get_https_error_code, get_user_message } from "../../types";
import {
  set_budget_pause_input_schema,
  SetBudgetPauseResponse,
} from "../../types/budgets/set_budget_pause.types";

export const set_budget_pause = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request): Promise<SetBudgetPauseResponse> => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "User must be authenticated");
    }
    const parsed = set_budget_pause_input_schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    const ctx = create_trace_context(false);
    try {
      return await set_budget_pause_orchestrator(ctx, request.auth.uid, parsed.data);
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (error instanceof DomainError) {
        const message = error instanceof ValidationError ? error.message : get_user_message(error.code);
        throw new HttpsError(get_https_error_code(error), message, { trace_id: ctx.trace_id });
      }
      console.error(`[${ctx.trace_id}] set_budget_pause failed:`, error);
      throw new HttpsError("internal", "Couldn't update the pause", { trace_id: ctx.trace_id });
    }
  }
);
