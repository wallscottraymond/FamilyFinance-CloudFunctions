/**
 * Reconciliation fingerprint — lets a reconcile skip periods whose result didn't change.
 *
 * A reconcile computes every active period of a bill / income stream and used to rewrite ALL of
 * them every time (a stream has dozens to hundreds of periods; a first link reconciled each stream
 * up to 3×). The same canonical shape is built from a fresh result and from the stored doc's
 * `reconciliation` map; equal → skip the write. PURE.
 *
 * @module domain/recurring/reconciliation_fingerprint
 */
import type { ReconciliationResult } from "./period_reconciliation.service";
/** Fingerprint of a freshly computed result. */
export declare function fingerprint_result(r: ReconciliationResult): string;
/** Fingerprint of a period doc's stored `reconciliation` map (null when never reconciled). */
export declare function fingerprint_stored(stored: unknown): string | null;
//# sourceMappingURL=reconciliation_fingerprint.d.ts.map