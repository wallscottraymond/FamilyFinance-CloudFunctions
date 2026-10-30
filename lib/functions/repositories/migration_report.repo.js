"use strict";
/**
 * One-time migration reports + undo snapshots (`_migration_reports`, `_migration_snapshots`).
 * Server-only (deny-all in Firestore rules).
 *
 * @module repositories/migration_report
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.migration_report_repo = void 0;
const firestore_1 = require("firebase-admin/firestore");
const REPORTS = "_migration_reports";
const SNAPSHOTS = "_migration_snapshots";
exports.migration_report_repo = {
    async save_report(run_id, report) {
        await (0, firestore_1.getFirestore)().collection(REPORTS).doc(run_id).set(Object.assign(Object.assign({}, report), { created_at: firestore_1.Timestamp.now() }));
    },
    async get_report(run_id) {
        const snap = await (0, firestore_1.getFirestore)().collection(REPORTS).doc(run_id).get();
        return snap.exists ? snap.data() : null;
    },
    async mark_applied(run_id, fields) {
        await (0, firestore_1.getFirestore)()
            .collection(REPORTS)
            .doc(run_id)
            .update(Object.assign(Object.assign({}, fields), { applied_at: firestore_1.Timestamp.now() }));
    },
    /** The undo record — written ONCE per run (a re-run after a crash keeps the original). */
    async save_snapshot_once(run_id, snapshot) {
        await (0, firestore_1.getFirestore)()
            .collection(SNAPSHOTS)
            .doc(run_id)
            .create(Object.assign(Object.assign({}, snapshot), { created_at: firestore_1.Timestamp.now() }))
            .catch((error) => {
            if (error.code !== 6)
                throw error; // 6 = ALREADY_EXISTS
        });
    },
};
//# sourceMappingURL=migration_report.repo.js.map