/**
 * One-time migration reports + undo snapshots (`_migration_reports`, `_migration_snapshots`).
 * Server-only (deny-all in Firestore rules).
 *
 * @module repositories/migration_report
 */
export declare const migration_report_repo: {
    save_report(run_id: string, report: Record<string, unknown>): Promise<void>;
    get_report(run_id: string): Promise<Record<string, unknown> | null>;
    mark_applied(run_id: string, fields: Record<string, unknown>): Promise<void>;
    /** The undo record — written ONCE per run (a re-run after a crash keeps the original). */
    save_snapshot_once(run_id: string, snapshot: Record<string, unknown>): Promise<void>;
};
//# sourceMappingURL=migration_report.repo.d.ts.map