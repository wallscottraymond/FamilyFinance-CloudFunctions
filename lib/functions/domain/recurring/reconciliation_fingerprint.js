"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.fingerprint_result = fingerprint_result;
exports.fingerprint_stored = fingerprint_stored;
const r2 = (n) => Math.round(Number(n !== null && n !== void 0 ? n : 0) * 100) / 100;
const ms = (v) => {
    if (v === null || v === undefined)
        return null;
    const t = v;
    if (typeof t.toMillis === "function")
        return t.toMillis();
    if (typeof v === "number")
        return v;
    return null;
};
/** Fingerprint of a freshly computed result. */
function fingerprint_result(r) {
    return JSON.stringify([
        r.status, r2(r.matched_amount), r2(r.pending_amount), r2(r.expected_amount),
        r.occurrences_expected, r.occurrences_paid, !!r.has_pending, r2(r.manual_amount),
        r.occurrences.map((o) => {
            var _a;
            return [
                o.due_date_ms, !!o.paid, !!o.pending,
                (_a = o.transaction_id) !== null && _a !== void 0 ? _a : null,
                r2(o.amount), !!o.manual,
            ];
        }),
        r.matched_splits.map((s) => [s.transaction_id, s.split_id, r2(s.amount), !!s.is_pending]),
    ]);
}
/** Fingerprint of a period doc's stored `reconciliation` map (null when never reconciled). */
function fingerprint_stored(stored) {
    var _a, _b;
    if (!stored || typeof stored !== "object")
        return null;
    const s = stored;
    const occ = (_a = s.occurrences) !== null && _a !== void 0 ? _a : [];
    const splits = (_b = s.matchedSplits) !== null && _b !== void 0 ? _b : [];
    return JSON.stringify([
        s.status, r2(s.matchedAmount), r2(s.pendingAmount), r2(s.expectedAmount),
        s.occurrencesExpected, s.occurrencesPaid, !!s.hasPending, r2(s.manualAmount),
        occ.map((o) => {
            var _a;
            return [
                ms(o.dueDate), !!o.paid, !!o.pending,
                (_a = o.transactionId) !== null && _a !== void 0 ? _a : null,
                r2(o.amount), !!o.manual,
            ];
        }),
        splits.map((x) => [x.transactionId, x.splitId, r2(x.amount), !!x.isPending]),
    ]);
}
//# sourceMappingURL=reconciliation_fingerprint.js.map