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

const r2 = (n: unknown): number => Math.round(Number(n ?? 0) * 100) / 100;
const ms = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const t = v as { toMillis?: () => number };
  if (typeof t.toMillis === "function") return t.toMillis();
  if (typeof v === "number") return v;
  return null;
};

/** Fingerprint of a freshly computed result. */
export function fingerprint_result(r: ReconciliationResult): string {
  return JSON.stringify([
    r.status, r2(r.matched_amount), r2(r.pending_amount), r2(r.expected_amount),
    r.occurrences_expected, r.occurrences_paid, !!r.has_pending, r2(r.manual_amount),
    r.occurrences.map((o) => [
      o.due_date_ms, !!o.paid, !!o.pending, o.transaction_id ?? null, r2(o.amount), !!o.manual,
    ]),
    r.matched_splits.map((s) => [s.transaction_id, s.split_id, r2(s.amount), !!s.is_pending]),
  ]);
}

/** Fingerprint of a period doc's stored `reconciliation` map (null when never reconciled). */
export function fingerprint_stored(stored: unknown): string | null {
  if (!stored || typeof stored !== "object") return null;
  const s = stored as Record<string, unknown>;
  const occ = (s.occurrences as Array<Record<string, unknown>> | undefined) ?? [];
  const splits = (s.matchedSplits as Array<Record<string, unknown>> | undefined) ?? [];
  return JSON.stringify([
    s.status, r2(s.matchedAmount), r2(s.pendingAmount), r2(s.expectedAmount),
    s.occurrencesExpected, s.occurrencesPaid, !!s.hasPending, r2(s.manualAmount),
    occ.map((o) => [
      ms(o.dueDate), !!o.paid, !!o.pending, (o.transactionId as string | null) ?? null,
      r2(o.amount), !!o.manual,
    ]),
    splits.map((x) => [x.transactionId, x.splitId, r2(x.amount), !!x.isPending]),
  ]);
}
