/**
 * Shared bill / income detail + notes (Account-Rooted-Sharing; Budget-And-Bill-Detail-Pages).
 *
 * - `get_recurring_detail`: Bill / Income detail's data for a period the app can't read itself
 *   (a member of the group the account is shared with). Timestamps come back as `{ __ts: ms }`.
 * - `set_recurring_note`: set or clear a bill / income period's note, or an income's
 *   every-month note — the owner or any member of the group its account is shared with.
 *
 * @module entry/callable/recurring_note
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { create_trace_context } from "../../observability";
import {
  get_recurring_detail_orchestrator,
  set_recurring_note_orchestrator,
} from "../../orchestrators/recurring/recurring_note.orchestrator";
import {
  DomainError,
  get_https_error_code,
  get_user_message,
  success_response,
} from "../../types";

const kind = z.enum(["outflow", "inflow"]);
const id = z.string().min(1).max(256);

const detail_schema = z.object({ kind, period_id: id });
const note_schema = z.object({
  kind,
  recurring_id: id,
  period_id: id.optional(),
  scope: z.enum(["period", "income"]),
  note: z.string().max(4000),
});

const issues = (e: z.ZodError): string => e.issues.map((i) => i.message).join("; ");

const to_https = (error: unknown, fallback: string, trace_id: string): HttpsError => {
  if (error instanceof HttpsError) return error;
  if (error instanceof DomainError) {
    return new HttpsError(get_https_error_code(error), get_user_message(error.code), { trace_id });
  }
  console.error(fallback, error);
  return new HttpsError("internal", fallback, { trace_id });
};

export const get_recurring_detail = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be authenticated");
    const parsed = detail_schema.safeParse(request.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", issues(parsed.error));
    const ctx = create_trace_context(false);
    try {
      const result = await get_recurring_detail_orchestrator(ctx, request.auth.uid, parsed.data);
      return success_response(result, ctx.trace_id);
    } catch (error) {
      throw to_https(error, "Could not load this item", ctx.trace_id);
    }
  }
);

export const set_recurring_note = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be authenticated");
    const parsed = note_schema.safeParse(request.data);
    if (!parsed.success) throw new HttpsError("invalid-argument", issues(parsed.error));
    const ctx = create_trace_context(false);
    try {
      const { period_id, ...rest } = parsed.data;
      const result = await set_recurring_note_orchestrator(ctx, request.auth.uid, {
        ...rest,
        period_id: period_id ?? null,
      });
      return success_response(result, ctx.trace_id);
    } catch (error) {
      throw to_https(error, "Could not save the note", ctx.trace_id);
    }
  }
);
