/**
 * Audit Transaction Assignments (read-only diagnostic)
 *
 * Dry-runs the Transaction Assignment Engine's pure category/budget matching
 * over EVERY active split and logs the ones whose CURRENT budget differs from
 * their natural category-home (the budget the engine would pick from category +
 * date alone, IGNORING any manual pin). This surfaces:
 *   - splits stuck in "Everything Else" whose category actually belongs to a
 *     real budget, and
 *   - whether each such split is a MANUAL PIN (budgetAssignmentSource ===
 *     "manual") — which the engine deliberately honors, so it will NOT re-home
 *     on its own.
 *
 * READ-ONLY: never writes. Logs one JSON line per mismatch (severity WARNING)
 * plus a summary line (severity NOTICE), so it stays well under log limits.
 *
 * Trigger (dev):
 *   GET https://us-central1-<project>.cloudfunctions.net/auditTransactionAssignments?userId=<uid>
 *
 * @module admin/auditTransactionAssignments
 */
export declare const auditTransactionAssignments: import("firebase-functions/v2/https").HttpsFunction;
//# sourceMappingURL=auditTransactionAssignments.d.ts.map