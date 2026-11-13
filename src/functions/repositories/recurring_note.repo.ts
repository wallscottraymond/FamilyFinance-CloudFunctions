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

/* eslint-disable @typescript-eslint/naming-convention -- Firestore field names */
import { FieldValue, getFirestore, Timestamp } from "firebase-admin/firestore";
import { TraceContext } from "../types";
import { RecurringNoteKind } from "../domain/recurring/recurring_note.service";

const PERIODS: Record<RecurringNoteKind, string> = {
  outflow: "outflow_periods",
  inflow: "inflow_periods",
};
const DEFINITIONS: Record<RecurringNoteKind, string> = { outflow: "outflows", inflow: "inflows" };
/** The period's note field: bills use `userNotes`, income `note` (as the app writes them). */
const PERIOD_NOTE_FIELD: Record<RecurringNoteKind, string> = {
  outflow: "userNotes",
  inflow: "note",
};

export const recurring_note_repo = {
  /** A period doc's raw data, or null. READ-ONLY. */
  async get_period_raw(
    _ctx: TraceContext,
    kind: RecurringNoteKind,
    period_id: string
  ): Promise<Record<string, unknown> | null> {
    const snap = await getFirestore().collection(PERIODS[kind]).doc(period_id).get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
  },

  /** A definition doc's raw data, or null. READ-ONLY. */
  async get_definition_raw(
    _ctx: TraceContext,
    kind: RecurringNoteKind,
    recurring_id: string
  ): Promise<Record<string, unknown> | null> {
    const snap = await getFirestore().collection(DEFINITIONS[kind]).doc(recurring_id).get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
  },

  /** Set (or, when empty, clear) a period's note. */
  async set_period_note(
    _ctx: TraceContext,
    kind: RecurringNoteKind,
    period_id: string,
    note: string
  ): Promise<void> {
    await getFirestore()
      .collection(PERIODS[kind])
      .doc(period_id)
      .update({
        [PERIOD_NOTE_FIELD[kind]]: note ? note : FieldValue.delete(),
        updatedAt: Timestamp.now(),
      });
  },

  /** Set an income's every-month note ("" clears it, as the app does). */
  async set_income_note(_ctx: TraceContext, inflow_id: string, note: string): Promise<void> {
    await getFirestore()
      .collection(DEFINITIONS.inflow)
      .doc(inflow_id)
      .update({ incomeNote: note, updatedAt: Timestamp.now() });
  },
};
