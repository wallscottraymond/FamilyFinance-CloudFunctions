/**
 * One-time migration reports + undo snapshots (`_migration_reports`, `_migration_snapshots`).
 * Server-only (deny-all in Firestore rules).
 *
 * @module repositories/migration_report
 */

import { getFirestore, Timestamp } from "firebase-admin/firestore";

const REPORTS = "_migration_reports";
const SNAPSHOTS = "_migration_snapshots";
/** Reports hold owner keys + budget names (Firestore TTL on `_migration_reports.expire_at`). */
const REPORT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
/** They're one-time reports: an erase's scan stays small. */
const MAX_REPORTS_SCANNED = 200;
const report_expiry = (): Timestamp => Timestamp.fromMillis(Date.now() + REPORT_RETENTION_MS);

export const migration_report_repo = {
  async save_report(run_id: string, report: Record<string, unknown>): Promise<void> {
    await getFirestore().collection(REPORTS).doc(run_id).set({
      ...report,
      created_at: Timestamp.now(),
      expire_at: report_expiry(),
    });
  },

  async get_report(run_id: string): Promise<Record<string, unknown> | null> {
    const snap = await getFirestore().collection(REPORTS).doc(run_id).get();
    return snap.exists ? (snap.data() as Record<string, unknown>) : null;
  },

  async mark_applied(run_id: string, fields: Record<string, unknown>): Promise<void> {
    await getFirestore()
      .collection(REPORTS)
      .doc(run_id)
      .update({ ...fields, applied_at: Timestamp.now(), expire_at: report_expiry() });
  },

  /**
   * An erase: removes a person's lines from every report (one report holds every user, so it's
   * edited, not deleted). Bounded by MAX_REPORTS_SCANNED. Returns the reports changed.
   */
  async strip_user(user_id: string): Promise<number> {
    const snap = await getFirestore().collection(REPORTS).limit(MAX_REPORTS_SCANNED).get();
    let changed = 0;
    for (const doc of snap.docs) {
      const update: Record<string, unknown> = {};
      for (const field of ["changes", "flags"]) {
        const lines = doc.get(field) as Array<{ owner_key?: string }> | undefined;
        const kept = lines?.filter((l) => l.owner_key !== user_id);
        if (lines && kept && kept.length !== lines.length) update[field] = kept;
      }
      if (Object.keys(update).length > 0) {
        await doc.ref.update(update);
        changed++;
      }
    }
    return changed;
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
