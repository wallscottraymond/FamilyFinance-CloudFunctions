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
import { TraceContext } from "../../types";
import { RecurringNoteKind } from "../../domain/recurring/recurring_note.service";
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
export declare function get_recurring_detail_orchestrator(ctx: TraceContext, user_id: string, input: {
    kind: RecurringNoteKind;
    period_id: string;
}): Promise<RecurringDetailResult>;
export declare function set_recurring_note_orchestrator(ctx: TraceContext, user_id: string, input: SetRecurringNoteInput): Promise<{
    note: string;
}>;
//# sourceMappingURL=recurring_note.orchestrator.d.ts.map