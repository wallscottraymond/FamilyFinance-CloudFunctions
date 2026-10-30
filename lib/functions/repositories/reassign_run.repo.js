"use strict";
/**
 * Re-assign runs (Transaction-Integrity-Review 3-R) — the bounded per-user re-assign engine's
 * progress + report, and its kill switch.
 *
 *   `_reassign_runs/{run_id}`  one run: scope, cursor, counters, merged follow-ups, dry-run report
 *   `_reassign_locks/{slot}`   `{ run_id, heartbeat }` — atomic single-flight (one real run per
 *                              user; one dry run per key); a stale heartbeat frees it
 *   `_config/reassign`         `{ enabled: false }` stops every run at its next page (kill switch)
 *
 * Server-only collections (deny-all in Firestore rules — 3-S).
 *
 * @module repositories/reassign_run
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.reassign_run_repo = void 0;
exports.reassign_slot_id = reassign_slot_id;
const crypto_1 = require("crypto");
const firestore_1 = require("firebase-admin/firestore");
const RUNS = "_reassign_runs";
/** One doc per run slot: `{ run_id, heartbeat }` — the atomic single-flight lock. */
const LOCKS = "_reassign_locks";
const is_fresh = (snap, stale_ms) => { var _a, _b; return Date.now() - ((_b = (_a = snap.get("heartbeat")) === null || _a === void 0 ? void 0 : _a.toMillis()) !== null && _b !== void 0 ? _b : 0) < stale_ms; };
/**
 * The slot a run holds while it runs. Real runs: ONE per user, whatever the scope (a run uses the
 * budgets / categories it loaded when its invocation began, so two real runs in parallel could
 * overwrite each other with an older view). Dry runs (write nothing): one per key.
 */
function reassign_slot_id(user_id, dedup_key, dry_run) {
    return dry_run
        ? `dry_${(0, crypto_1.createHash)("sha1").update(dedup_key).digest("hex")}`
        : `user_${user_id}`;
}
exports.reassign_run_repo = {
    async get(run_id) {
        const snap = await (0, firestore_1.getFirestore)().collection(RUNS).doc(run_id).get();
        return snap.exists ? snap.data() : null;
    },
    async save(run) {
        await (0, firestore_1.getFirestore)()
            .collection(RUNS)
            .doc(run.run_id)
            .set(Object.assign(Object.assign({}, run), { updated_at: firestore_1.Timestamp.now() }));
    },
    /**
     * Claim (or keep) a run SLOT — atomic single-flight. One slot per user for real runs, one per
     * key for dry runs (`reassign_slot_id`). Succeeds when the slot is free, held by this run, or
     * its holder hasn't heartbeat for `stale_ms` (crashed / timed out); then (re)stamps the
     * heartbeat. Called at the start of every invocation and after every page.
     */
    async claim_slot(slot_id, run_id, stale_ms) {
        const ref = (0, firestore_1.getFirestore)().collection(LOCKS).doc(slot_id);
        return (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (snap.exists && snap.get("run_id") !== run_id && is_fresh(snap, stale_ms))
                return false;
            tx.set(ref, { run_id, heartbeat: firestore_1.Timestamp.now() });
            return true;
        });
    },
    /** Is the slot held by another run with a fresh heartbeat? (Read-only: the enqueue's delay.) */
    async slot_busy(slot_id, except_run_id, stale_ms) {
        const snap = await (0, firestore_1.getFirestore)().collection(LOCKS).doc(slot_id).get();
        return snap.exists && snap.get("run_id") !== except_run_id && is_fresh(snap, stale_ms);
    },
    /** Free the slot if this run holds it (the run ended: done / capped / stopped / failed). */
    async release_slot(slot_id, run_id) {
        const ref = (0, firestore_1.getFirestore)().collection(LOCKS).doc(slot_id);
        await (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
            const snap = await tx.get(ref);
            if (snap.exists && snap.get("run_id") === run_id)
                tx.delete(ref);
        });
    },
    /**
     * Claim the ONE pending category fan-out (atomic): true for the first caller in a burst of
     * category edits, false while one is already pending. Released by the fan-out job when it runs.
     */
    async claim_category_fanout() {
        const ref = (0, firestore_1.getFirestore)().collection("_config").doc("category_reassign");
        return (0, firestore_1.getFirestore)().runTransaction(async (tx) => {
            var _a, _b;
            const snap = await tx.get(ref);
            // A claim whose job never ran (30 min) is dead — never let it block category re-assigns.
            const claimed_ms = (_b = (_a = snap.get("claimed_at")) === null || _a === void 0 ? void 0 : _a.toMillis()) !== null && _b !== void 0 ? _b : 0;
            if (snap.exists && snap.get("pending") === true && Date.now() - claimed_ms < 30 * 60000) {
                return false;
            }
            tx.set(ref, { pending: true, claimed_at: firestore_1.Timestamp.now() }, { merge: true });
            return true;
        });
    },
    async release_category_fanout() {
        await (0, firestore_1.getFirestore)()
            .collection("_config")
            .doc("category_reassign")
            .set({ pending: false, released_at: firestore_1.Timestamp.now() }, { merge: true });
    },
    /** Kill switch: false only when `_config/reassign.enabled === false`. One read per page. */
    async is_enabled() {
        var _a;
        const snap = await (0, firestore_1.getFirestore)().collection("_config").doc("reassign").get();
        return !(snap.exists && ((_a = snap.data()) === null || _a === void 0 ? void 0 : _a.enabled) === false);
    },
};
//# sourceMappingURL=reassign_run.repo.js.map