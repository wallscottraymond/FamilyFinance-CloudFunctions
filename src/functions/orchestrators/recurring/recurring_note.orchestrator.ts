/**
 * Shared bill / income detail + notes (Account-Rooted-Sharing).
 *
 * - `get_recurring_detail_orchestrator`: a bill / income period + the definition fields its
 *   detail screen shows, for the owner or a member of the group its account is shared with
 *   (members can't read these docs from the app). READ-ONLY.
 * - `set_recurring_note_orchestrator`: set or clear a period's note, or an income's every-month
 *   note. One shared note: the owner and the group see the same text.
 *
 * Notes aren't derive inputs (no derive-version bump).
 *
 * @module orchestrators/recurring/recurring_note
 */

import { TraceContext, PermissionDeniedError, ValidationError } from "../../types";
import {
  create_span,
  log_operation_start,
  log_operation_success,
  log_operation_error,
} from "../../observability";
import {
  resolve_recurring_detail_deps,
  resolve_recurring_note_deps,
} from "../../resolvers/recurring/recurring_access.resolver";
import {
  RecurringNoteKind,
  normalize_note,
  period_belongs_to,
  pick_definition_fields,
  to_client,
} from "../../domain/recurring/recurring_note.service";
import { recurring_note_repo } from "../../repositories/recurring_note.repo";

export interface RecurringDetailResult {
  recurring_id: string;
  period: unknown;
  definition: unknown;
  /** Set when the caller sees it through a group (not the owner). */
  via_group_id: string | null;
}

export interface SetRecurringNoteInput {
  kind: RecurringNoteKind;
  recurring_id: string;
  period_id: string | null;
  scope: "period" | "income";
  note: string;
}

export async function get_recurring_detail_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: { kind: RecurringNoteKind; period_id: string }
): Promise<RecurringDetailResult> {
  const span = create_span(ctx, "orchestrator", "get_recurring_detail");
  log_operation_start(span, user_id);
  try {
    const deps = await resolve_recurring_detail_deps(ctx, user_id, input.kind, input.period_id);
    const result: RecurringDetailResult = {
      recurring_id: deps.recurring_id,
      period: to_client(deps.period),
      definition: to_client(pick_definition_fields(input.kind, deps.definition)),
      via_group_id: deps.access.via_group_id,
    };
    log_operation_success(span, user_id);
    return result;
  } catch (e) {
    log_operation_error(span, e as Error);
    throw e;
  }
}

export async function set_recurring_note_orchestrator(
  ctx: TraceContext,
  user_id: string,
  input: SetRecurringNoteInput
): Promise<{ note: string }> {
  const span = create_span(ctx, "orchestrator", "set_recurring_note");
  log_operation_start(span, user_id);
  try {
    if (input.scope === "income" && input.kind !== "inflow") {
      throw new ValidationError(["Only income has an every-month note"]);
    }
    const period_id = input.scope === "period" ? input.period_id : null;
    if (input.scope === "period" && !period_id) {
      throw new ValidationError(["period_id is required"]);
    }
    const deps = await resolve_recurring_note_deps(
      ctx, user_id, input.kind, input.recurring_id, period_id
    );
    if (deps.period && !period_belongs_to(input.kind, deps.period, input.recurring_id)) {
      throw new PermissionDeniedError("note", `period ${period_id}`);
    }
    const note = normalize_note(input.note);
    if (note.validation_errors) throw new ValidationError(note.validation_errors);
    const text = note.entity ?? "";
    if (period_id) {
      await recurring_note_repo.set_period_note(ctx, input.kind, period_id, text);
    } else {
      await recurring_note_repo.set_income_note(ctx, input.recurring_id, text);
    }
    log_operation_success(span, user_id);
    return { note: text };
  } catch (e) {
    log_operation_error(span, e as Error);
    throw e;
  }
}
