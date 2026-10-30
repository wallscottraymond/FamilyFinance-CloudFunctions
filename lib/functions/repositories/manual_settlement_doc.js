"use strict";
/**
 * Stored shape + transactional write of "Mark as paid / received" marks
 * (`manualSettledOccurrences` on an `outflows` / `inflows` DEFINITION doc).
 *
 * Shared by `outflow_repo` and `inflow_repo` so both store the same shape. The map is user state:
 * each repo's Plaid `save_batch` carries it over from the stored doc (Plaid never sets it).
 *
 * @module repositories/manual_settlement_doc
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.map_manual_settled_occurrences = map_manual_settled_occurrences;
exports.write_manual_settlement = write_manual_settlement;
const firestore_1 = require("firebase-admin/firestore");
/** Stored marks → domain marks (absent → empty). Malformed entries are dropped. */
function map_manual_settled_occurrences(docs) {
    var _a;
    const out = {};
    for (const [key, d] of Object.entries(docs !== null && docs !== void 0 ? docs : {})) {
        if (!d || typeof d.amount !== "number" || !Number.isFinite(d.amount))
            continue;
        const at = d.markedAt;
        out[key] = {
            amount: d.amount,
            marked_at_ms: at && typeof at.toMillis === "function" ? at.toMillis() : null,
            marked_by: (_a = d.markedBy) !== null && _a !== void 0 ? _a : null,
        };
    }
    return out;
}
/**
 * Set (mark) or clear (null) ONE occurrence's mark on a definition doc, in a Firestore
 * transaction (read → field-path update, so a concurrent Plaid re-save / another mark can't be
 * lost or resurrect a cleared one). Returns the doc's marks before and after, for the audit.
 * Throws when the doc doesn't exist.
 */
async function write_manual_settlement(collection, id, date_key, mark) {
    const db = (0, firestore_1.getFirestore)();
    const ref = db.collection(collection).doc(id);
    return db.runTransaction(async (tx) => {
        var _a;
        const snap = await tx.get(ref);
        if (!snap.exists) {
            throw new Error(`${collection} ${id} not found`);
        }
        const stored = ((_a = snap.data()) !== null && _a !== void 0 ? _a : {}).manualSettledOccurrences;
        const before = (stored !== null && stored !== void 0 ? stored : {});
        const after = Object.assign({}, before);
        const now = firestore_1.Timestamp.now();
        if (mark) {
            /* eslint-disable @typescript-eslint/naming-convention */
            after[date_key] = { amount: mark.amount, markedAt: now, markedBy: mark.marked_by };
            /* eslint-enable @typescript-eslint/naming-convention */
        }
        else {
            delete after[date_key];
        }
        tx.update(ref, new firestore_1.FieldPath("manualSettledOccurrences", date_key), mark ? after[date_key] : firestore_1.FieldValue.delete(), "updatedAt", now);
        return { before, after };
    });
}
//# sourceMappingURL=manual_settlement_doc.js.map