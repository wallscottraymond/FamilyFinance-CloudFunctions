/**
 * audit_transaction_assignments (admin) — Transaction-Integrity-Review 3-A, on demand.
 *
 * "Stored == derived" audit for one user (or every user): a DRY RUN of the bounded re-assign
 * engine (reassign_user) — read-only; the report (counts, budget moves, samples) lands in
 * `_reassign_runs/{run_id}`. Why that measures stored vs. the PERIOD PAGE: the engine and the page
 * build the same budget set (domain/budgets/match_budgets), resolve categories with the same
 * function and match with the same matcher, and a property test
 * (stored_equals_derived.property.test) proves they give the same answer; so any stored field that
 * differs from the engine's fresh answer is a stored ≠ page mismatch. Transfer roles are the one
 * input the dry run takes as stored — the transfer classifier keeps them fresh. Replaces the deleted
 * `auditTransactionAssignments` HTTP endpoint (unauthenticated, with a `?fix=true` write path).
 *
 * @module entry/callable/audit_transaction_assignments
 */
export declare const audit_transaction_assignments: import("firebase-functions/v2/https").CallableFunction<any, Promise<{
    success: boolean;
    queued: number;
    trace_id: string;
}>, unknown>;
//# sourceMappingURL=audit_transaction_assignments.entry.d.ts.map