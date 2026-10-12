/**
 * One-time migration reports + undo snapshots (`_migration_reports`, `_migration_snapshots`).
 * Server-only (deny-all in Firestore rules).
 *
 * @module repositories/migration_report
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";

const REPORTS = "_migration_reports";
const SNAPSHOTS = "_migration_snapshots";

export const migration_report_repo = {
  async save_report(run_id: string, report: Record<string, unknown>): Promise<void> {
    await getFirestore().collection(REPORTS).doc(run_id).set({ ...report, created_at: Timestamp.now() });
  },

  async get_report(run_id: string): Promise<Record<string, unknown> | null> {
    const snap = await getFirestore().collection(REPORTS).doc(run_id).get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
  },

  async mark_applied(run_id: string, fields: Record<string, unknown>): Promise<void> {
    await getFirestore()
      .collection(REPORTS)
      .doc(run_id)
      .update({ ...fields, applied_at: Timestamp.now() });
  },

  /** The undo record — written ONCE per run (a re-run after a crash keeps the original). */
  async save_snapshot_once(run_id: string, snapshot: Record<string, unknown>): Promise<void> {
    await getFirestore()
      .collection(SNAPSHOTS)
      .doc(run_id)
      .create({ ...snapshot, created_at: Timestamp.now() })
      .catch((error: { code?: number }) => {
        if (error.code !== 6) throw error; // 6 = ALREADY_EXISTS
      });
  },
};
