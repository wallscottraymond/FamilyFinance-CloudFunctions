"use strict";
/**
 * Source Period Repository
 *
 * Read-only access to the canonical `source_periods` collection. Source periods
 * are the system-wide calendar buckets (monthly / weekly / bi_monthly) that
 * budget periods are generated against.
 *
 * @module repositories/source_period
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.source_period_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
/* eslint-enable @typescript-eslint/naming-convention */
const COLLECTION = "source_periods";
function map_to_entity(id, doc) {
    var _a, _b, _c, _d;
    return {
        id,
        period_id: (_a = doc.periodId) !== null && _a !== void 0 ? _a : id,
        period_type: (_b = doc.type) !== null && _b !== void 0 ? _b : "monthly",
        start_date: doc.startDate,
        end_date: doc.endDate,
        year: doc.year,
        index: doc.index,
        month: (_c = doc.metadata) === null || _c === void 0 ? void 0 : _c.month,
        bi_monthly_half: (_d = doc.metadata) === null || _d === void 0 ? void 0 : _d.biMonthlyHalf,
    };
}
exports.source_period_repo = {
    /**
     * Gets a single source period by ID.
     */
    async get_by_id(_ctx, period_id) {
        const snap = await (0, firestore_1.getFirestore)().collection(COLLECTION).doc(period_id).get();
        if (!snap.exists) {
            return null;
        }
        return map_to_entity(snap.id, snap.data());
    },
    /**
     * Gets all source periods (every type: monthly, weekly, bi_monthly) that
     * OVERLAP the window [anchor, end] — i.e. periods that end on/after `anchor`
     * and start on/before `end`. This includes the partial period containing
     * `anchor` (matching the legacy generation semantics), so a budget whose
     * start date falls mid-period still gets that period.
     *
     * Implemented with a single-field `startDate` range (no composite index):
     * query `startDate >= anchor - 31d` (31d ≥ the longest source period) and
     * `startDate <= end`, then drop any period that already ended before `anchor`.
     */
    /**
     * Gets all source periods whose `startDate` falls in [start, end] (every
     * type), ordered by startDate. Used by period-generation resolvers.
     */
    async get_by_start_date_range(_ctx, start, end) {
        const snapshot = await (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .where("startDate", ">=", start)
            .where("startDate", "<=", end)
            .orderBy("startDate", "asc")
            .get();
        return snapshot.docs.map((doc) => map_to_entity(doc.id, doc.data()));
    },
    async get_overlapping(_ctx, anchor, end) {
        const buffer_ms = 31 * 24 * 60 * 60 * 1000;
        const lower = firestore_1.Timestamp.fromMillis(anchor.toMillis() - buffer_ms);
        const snapshot = await (0, firestore_1.getFirestore)()
            .collection(COLLECTION)
            .where("startDate", ">=", lower)
            .where("startDate", "<=", end)
            .orderBy("startDate", "asc")
            .get();
        return snapshot.docs
            .map((doc) => map_to_entity(doc.id, doc.data()))
            .filter((p) => p.end_date.toMillis() >= anchor.toMillis());
    },
};
//# sourceMappingURL=source_period.repo.js.map