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
/** Reports hold owner keys + budget names (Firestore TTL on `_migration_reports.expire_at`). */
const REPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** They're one-time reports: an erase's scan stays small. */
const MAX_REPORTS_SCANNED = 200;
const report_expiry = () => firestore_1.Timestamp.fromMillis(Date.now() + REPORT_RETENTION_MS);
exports.migration_report_repo = {
    async save_report(run_id, report) {
        await (0, firestore_1.getFirestore)().collection(REPORTS).doc(run_id).set(Object.assign(Object.assign({}, report), { created_at: firestore_1.Timestamp.now(), expire_at: report_expiry() }));
    },
    async get_report(run_id) {
        const snap = await (0, firestore_1.getFirestore)().collection(REPORTS).doc(run_id).get();
        return snap.exists ? snap.data() : null;
    },
    async mark_applied(run_id, fields) {
        await (0, firestore_1.getFirestore)()
            .collection(REPORTS)
            .doc(run_id)
            .update(Object.assign(Object.assign({}, fields), { applied_at: firestore_1.Timestamp.now(), expire_at: report_expiry() }));
    },
    /**
     * An erase: removes a person's lines from every report (one report holds every user, so it's
     * edited, not deleted). Bounded by MAX_REPORTS_SCANNED. Returns the reports changed.
     */
    async strip_user(user_id) {
        const snap = await (0, firestore_1.getFirestore)().collection(REPORTS).limit(MAX_REPORTS_SCANNED).get();
        let changed = 0;
        for (const doc of snap.docs) {
            const update = {};
            for (const field of ["changes", "flags"]) {
                const lines = doc.get(field);
                const kept = lines === null || lines === void 0 ? void 0 : lines.filter((l) => l.owner_key !== user_id);
                if (lines && kept && kept.length !== lines.length)
                    update[field] = kept;
            }
            if (Object.keys(update).length > 0) {
                await doc.ref.update(update);
                changed++;
            }
        }
        return changed;
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