/**
 * Raw reads + note writes for a bill (outflow) or income (inflow) and its periods, for the
 * group-member detail path (`get_recurring_detail`, `set_recurring_note`). Members of the group
 * an account is shared with can't read these docs from the app (rules), so the server reads and
 * writes them after `resolve_recurring_access`.
 *
 * Notes are shared: one note per period (bill `userNotes`, income `note`) and one "every month"
 * note per income (`incomeNote`), seen by the owner and the group.
 *
 * @module repositories/recurring_note
 */
import { TraceContext } from "../types";
import { RecurringNoteKind } from "../domain/recurring/recurring_note.service";
export declare const recurring_note_repo: {
    /** A period doc's raw data, or null. READ-ONLY. */
    get_period_raw(_ctx: TraceContext, kind: RecurringNoteKind, period_id: string): Promise<Record<string, unknown> | null>;
    /** A definition doc's raw data, or null. READ-ONLY. */
    get_definition_raw(_ctx: TraceContext, kind: RecurringNoteKind, recurring_id: string): Promise<Record<string, unknown> | null>;
    /** Set (or, when empty, clear) a period's note. */
    set_period_note(_ctx: TraceContext, kind: RecurringNoteKind, period_id: string, note: string): Promise<void>;
    /** Set an income's every-month note ("" clears it, as the app does). */
    set_income_note(_ctx: TraceContext, inflow_id: string, note: string): Promise<void>;
};
//# sourceMappingURL=recurring_note.repo.d.ts.map