import { Timestamp } from 'firebase-admin/firestore';
import { fingerprint_result, fingerprint_stored } from '../reconciliation_fingerprint';
import type { ReconciliationResult } from '../period_reconciliation.service';

/* eslint-disable @typescript-eslint/naming-convention */
const result: ReconciliationResult = {
  period_id: 'p1',
  status: 'complete',
  matched_amount: 15.49,
  pending_amount: 0,
  manual_amount: 0,
  expected_amount: 15.49,
  occurrences_expected: 1,
  occurrences_paid: 1,
  has_pending: false,
  occurrences: [{ due_date_ms: 1_760_000_000_000, paid: true, pending: false, transaction_id: 't1', amount: 15.49, manual: false }],
  matched_splits: [{ transaction_id: 't1', split_id: 's1', amount: 15.49, is_pending: false, date_ms: 1 } as never],
};

/** The map `update_reconciliation` stores for `result`. */
const stored = {
  status: 'complete', matchedAmount: 15.49, pendingAmount: 0, expectedAmount: 15.49,
  occurrencesExpected: 1, occurrencesPaid: 1, hasPending: false,
  occurrences: [{ dueDate: Timestamp.fromMillis(1_760_000_000_000), paid: true, pending: false, transactionId: 't1', amount: 15.49 }],
  matchedSplits: [{ transactionId: 't1', splitId: 's1', amount: 15.49, isPending: false }],
  lastReconciledAt: Timestamp.now(),
};

describe('reconciliation fingerprint', () => {
  it('a stored result equals the same freshly computed result (→ no rewrite)', () => {
    expect(fingerprint_stored(stored)).toBe(fingerprint_result(result));
  });
  it('any change in status / amounts / occurrences is detected', () => {
    expect(fingerprint_stored({ ...stored, status: 'partial' })).not.toBe(fingerprint_result(result));
    expect(fingerprint_stored({ ...stored, matchedAmount: 15.5 })).not.toBe(fingerprint_result(result));
    expect(fingerprint_stored({ ...stored, occurrences: [] })).not.toBe(fingerprint_result(result));
  });
  it('a never-reconciled period always writes', () => {
    expect(fingerprint_stored(undefined)).toBeNull();
  });
});
