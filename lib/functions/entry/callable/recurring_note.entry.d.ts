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
export declare const get_recurring_detail: import("firebase-functions/v2/https").CallableFunction<any, Promise<import("../../types").FunctionResponse<import("../../orchestrators/recurring/recurring_note.orchestrator").RecurringDetailResult>>, unknown>;
export declare const set_recurring_note: import("firebase-functions/v2/https").CallableFunction<any, Promise<import("../../types").FunctionResponse<{
    note: string;
}>>, unknown>;
//# sourceMappingURL=recurring_note.entry.d.ts.map