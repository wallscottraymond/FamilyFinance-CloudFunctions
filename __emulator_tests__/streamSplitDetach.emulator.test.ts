/**
 * Emulator Integration Test — per-SPLIT stream detach (Transaction-Integrity-Review, 10th review)
 *
 * A $150 Comcast payment is a member of the bill's Plaid stream (`transactionIds`), split
 * $100 / $50 with no split links. Taking ONE split off the bill (a budget pin, or "remove from
 * bill") must leave the OTHER split paying it: the bill reconciles $100 paid — not $150 (the
 * pinned split counted twice) and not $0 (the whole transaction unlinked).
 *
 * Prereqs: firebase emulators:exec --only firestore "npx jest --selectProjects emulator --testPathPattern streamSplitDetach"
 */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

const rid = (p: string) => `${p}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

let db: FirebaseFirestore.Firestore;
let reconcile: (ctx: unknown, input: unknown) => Promise<unknown>;
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Refusing to run: FIRESTORE_EMULATOR_HOST not set (dev==prod safety).');
  }
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  db = admin.firestore();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ reconcile_recurring_periods_orchestrator: reconcile } = require(
    '../src/functions/orchestrators/recurring/reconcile_recurring_periods.orchestrator'
  ));
});

/* eslint-disable @typescript-eslint/naming-convention */
async function seed(second_split: Record<string, unknown>) {
  const userId = rid('u');
  const outflowId = rid('outflow');
  const plaidId = rid('ptx');
  await db.collection('outflows').doc(outflowId).set({
    id: outflowId, ownerId: userId, userId, averageAmount: 150, isActive: true,
    frequency: 'monthly', name: 'Comcast', transactionIds: [plaidId],
  });
  const due = Timestamp.fromMillis(Date.UTC(2026, 7, 15));
  await db.collection('outflow_periods').doc(`${outflowId}_2026M08`).set({
    id: `${outflowId}_2026M08`, outflowId, ownerId: userId, userId, sourcePeriodId: '2026M08',
    periodType: 'monthly', periodStartDate: Timestamp.fromMillis(Date.UTC(2026, 7, 1)),
    periodEndDate: Timestamp.fromMillis(Date.UTC(2026, 8, 0, 23, 59, 59)),
    amountPerOccurrence: 150, totalAmountDue: 150, totalAmountPaid: 0,
    occurrenceDueDates: [due], firstDueDateInPeriod: due, isActive: true,
  });
  await db.collection('transactions').doc(`plaid_${plaidId}`).set({
    transactionId: plaidId, userId, ownerId: userId, isActive: true, isPending: false,
    transactionDate: Timestamp.fromMillis(Date.UTC(2026, 7, 14)), amount: 150, type: 'expense',
    splits: [
      { splitId: 'a', amount: 100, isDefault: true },
      { splitId: 'b', amount: 50, ...second_split },
    ],
  });
  await reconcile({ trace_id: rid('t'), span_id: rid('s') }, { recurring_id: outflowId, recurring_type: 'outflow' });
  return ((await db.collection('outflow_periods').doc(`${outflowId}_2026M08`).get()).data()?.totalAmountPaid) ?? 0;
}

describe('per-split stream detach (emulator)', () => {
  it('a budget pin on ONE split leaves the other split paying the bill ($100)', async () => {
    expect(await seed({ budgetAssignmentSource: 'manual', budgetId: 'ent' })).toBe(100);
  });

  it('a "remove from bill" on ONE split leaves the other split paying the bill ($100)', async () => {
    expect(await seed({ outflowAssignmentSource: 'manual', outflowId: null })).toBe(100);
  });

  it('CONTROL: neither split taken off → the whole payment ($150)', async () => {
    expect(await seed({})).toBe(150);
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
