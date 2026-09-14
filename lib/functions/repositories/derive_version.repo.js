"use strict";
/**
 * Derive-Version Repository
 *
 * A per-user monotonic `version` counter that changes whenever ANY data feeding
 * `derive_period` changes (bills/income/budgets/goals/transactions/periods/…). It is
 * the invalidation signal for the derived-period cache ([[Firestore-Read-Cost-Reduction]]):
 * `derive_period` returns the cached result iff its stamped version matches the current one.
 *
 * `bump_derive_version` is `FieldValue.increment(1)` — no read, commutative, so callers
 * fire-and-forget it from write paths. A burst of writes may contend on the single doc;
 * that's harmless: any one success invalidates the cache, and over-bumping only costs a
 * (rare) extra recompute. A short TTL backstop in the cache bounds any missed-bump path.
 *
 * @module repositories/derive_version
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.get_derive_version = get_derive_version;
exports.bump_derive_version = bump_derive_version;
const firestore_1 = require("firebase-admin/firestore");
const COLLECTION = "user_data_versions";
/** Current derive-input version for a user (0 if never written). 1 read. */
async function get_derive_version(user_id) {
    var _a, _b;
    const snap = await (0, firestore_1.getFirestore)().collection(COLLECTION).doc(user_id).get();
    return snap.exists ? ((_b = (_a = snap.data()) === null || _a === void 0 ? void 0 : _a.version) !== null && _b !== void 0 ? _b : 0) : 0;
}
/**
 * Bump a user's derive-input version. Call (fire-and-forget) from any write path that
 * changes derive inputs. Idempotent-enough: over-bumping is harmless; the point is that
 * the version STRICTLY CHANGES after a write so the cache misses and recomputes.
 */
async function bump_derive_version(user_id) {
    if (!user_id)
        return;
    await (0, firestore_1.getFirestore)()
        .collection(COLLECTION)
        .doc(user_id)
        .set({ version: firestore_1.FieldValue.increment(1), updated_at: firestore_1.Timestamp.now() }, { merge: true });
}
//# sourceMappingURL=derive_version.repo.js.map