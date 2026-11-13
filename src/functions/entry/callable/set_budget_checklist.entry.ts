/**
 * The checklist's callables (Manual-Budgets, AF-02). `get_budget_checklist` reads it;
 * `edit_budget_checklist` applies one edit, so two people's changes both survive. Any member may edit
 * a group budget's, like every budget edit. A budget the caller can't manage reads as not found.
 *
 * @module entry/callable/set_budget_checklist
 */

import { onCall, HttpsError } from "firebase-functions/v2/https";
import { z } from "zod";
import { create_trace_context } from "../../observability";
import { budget_checklist_repo } from "../../repositories/budget_checklist.repo";
import { resolve_set_budget_pause_dependencies } from "../../resolvers/budgets/set_budget_pause.resolver";
import { DomainError, get_https_error_code, get_user_message } from "../../types";

const budget_id = z.string().min(1).max(128);
const id = z.string().min(1).max(64);
const period_key = z.string().min(1).max(32);

const edit_schema = z.object({
  budget_id,
  edit: z.discriminatedUnion("op", [
    z.object({ op: z.literal("add"), id, name: z.string().max(100), estimate: z.number().min(0).max(100_000_000), period_key }),
    z.object({ op: z.literal("remove"), id }),
    z.object({ op: z.literal("update"), id, name: z.string().max(100), estimate: z.number().min(0).max(100_000_000) }),
    z.object({ op: z.literal("tick"), id, period_key, ticked: z.boolean() }),
    z.object({ op: z.literal("carry"), carry: z.boolean(), period_key }),
  ]),
});

const to_https = (error: unknown, fallback: string): HttpsError => {
  if (error instanceof HttpsError) return error;
  if (error instanceof DomainError) return new HttpsError(get_https_error_code(error), get_user_message(error.code));
  console.error(fallback, error);
  return new HttpsError("internal", fallback);
};

export const get_budget_checklist = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be authenticated");
    const parsed = budget_id.safeParse(request.data?.budget_id);
    if (!parsed.success) throw new HttpsError("invalid-argument", "budget_id is invalid");
    try {
      await resolve_set_budget_pause_dependencies(create_trace_context(false), request.auth.uid, parsed.data);
      return { checklist: await budget_checklist_repo.get(parsed.data) };
    } catch (error) {
      throw to_https(error, "Could not load the checklist");
    }
  }
);

export const edit_budget_checklist = onCall(
  // eslint-disable-next-line @typescript-eslint/naming-convention
  { maxInstances: 20 },
  async (request) => {
    if (!request.auth) throw new HttpsError("unauthenticated", "User must be authenticated");
    const parsed = edit_schema.safeParse(request.data);
    if (!parsed.success) {
      throw new HttpsError("invalid-argument", parsed.error.issues.map((i) => i.message).join("; "));
    }
    try {
      const { existing } = await resolve_set_budget_pause_dependencies(
        create_trace_context(false), request.auth.uid, parsed.data.budget_id
      );
      const { checklist, errors } = await budget_checklist_repo.apply(parsed.data.budget_id, existing.user_id, parsed.data.edit);
      if (!checklist) throw new HttpsError("invalid-argument", (errors ?? []).join("; "));
      return { checklist };
    } catch (error) {
      throw to_https(error, "Could not save the checklist");
    }
  }
);
