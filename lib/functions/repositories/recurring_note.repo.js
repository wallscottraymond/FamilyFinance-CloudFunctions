"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.recurring_note_repo = void 0;
/* eslint-disable @typescript-eslint/naming-convention -- Firestore field names */
const firestore_1 = require("firebase-admin/firestore");
const PERIODS = {
    outflow: "outflow_periods",
    inflow: "inflow_periods",
};
const DEFINITIONS = { outflow: "outflows", inflow: "inflows" };
/** The period's note field: bills use `userNotes`, income `note` (as the app writes them). */
const PERIOD_NOTE_FIELD = {
    outflow: "userNotes",
    inflow: "note",
};
exports.recurring_note_repo = {
    /** A period doc's raw data, or null. READ-ONLY. */
    async get_period_raw(_ctx, kind, period_id) {
        const snap = await (0, firestore_1.getFirestore)().collection(PERIODS[kind]).doc(period_id).get();
        return snap.exists ? snap.data() : null;
    },
    /** A definition doc's raw data, or null. READ-ONLY. */
    async get_definition_raw(_ctx, kind, recurring_id) {
        const snap = await (0, firestore_1.getFirestore)().collection(DEFINITIONS[kind]).doc(recurring_id).get();
        return snap.exists ? snap.data() : null;
    },
    /** Set (or, when empty, clear) a period's note. */
    async set_period_note(_ctx, kind, period_id, note) {
        await (0, firestore_1.getFirestore)()
            .collection(PERIODS[kind])
            .doc(period_id)
            .update({
            [PERIOD_NOTE_FIELD[kind]]: note ? note : firestore_1.FieldValue.delete(),
            updatedAt: firestore_1.Timestamp.now(),
        });
    },
    /** Set an income's every-month note ("" clears it, as the app does). */
    async set_income_note(_ctx, inflow_id, note) {
        await (0, firestore_1.getFirestore)()
            .collection(DEFINITIONS.inflow)
            .doc(inflow_id)
            .update({ incomeNote: note, updatedAt: firestore_1.Timestamp.now() });
    },
};
//# sourceMappingURL=recurring_note.repo.js.map