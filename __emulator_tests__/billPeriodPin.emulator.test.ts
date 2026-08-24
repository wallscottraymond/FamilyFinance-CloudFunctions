/**
 * Emulator Integration Test — manual PERIOD pin (Bill-Assignment-Two-Stage-Picker P1)
 *
 * A split pinned to a SPECIFIC period (`outflowPinnedPeriodId`) must reconcile into
 * THAT period, overriding date-based placement. Seeds a bill with a July + an August
 * period and a payment dated in AUGUST; pinned to July → July marks paid, August stays $0.
 * A control (no pin) lands in August.
 *
 * Prereqs: firebase emulators:exec --only firestore "npx jest --selectProjects emulator --testPathPattern billPeriodPin"
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
async function seedBill(pinnedPeriodId: string | null) {
  const userId = rid('u');
  const outflowId = rid('outflow');
  const amount = 100;
  await db.collection('outflows').doc(outflowId).set({
    id: outflowId, ownerId: userId, userId, averageAmount: amount,
    isActive: true, frequency: 'monthly', name: 'Test Bill',
  });
  const mkPeriod = (sp: string, y: number, m: number) => {
    const start = Timestamp.fromMillis(Date.UTC(y, m, 1));
    const end = Timestamp.fromMillis(Date.UTC(y, m + 1, 0, 23, 59, 59));
    const due = Timestamp.fromMillis(Date.UTC(y, m, 15));
    return db.collection('outflow_periods').doc(`${outflowId}_${sp}`).set({
      id: `${outflowId}_${sp}`, outflowId, ownerId: userId, userId,
      sourcePeriodId: sp, periodType: 'monthly',
      periodStartDate: start, periodEndDate: end,
      amountPerOccurrence: amount, totalAmountDue: amount, totalAmountPaid: 0,
      occurrenceDueDates: [due], firstDueDateInPeriod: due, isActive: true,
    });
  };
  await mkPeriod('2026M07', 2026, 6); // July
  await mkPeriod('2026M08', 2026, 7); // August
  // A payment dated in AUGUST, linked to the bill, optionally pinned to July.
  await db.collection('transactions').doc(`plaid_${rid('tx')}`).set({
    transactionId: rid('tx'), userId, ownerId: userId, isActive: true, isPending: false,
    transactionDate: Timestamp.fromMillis(Date.UTC(2026, 7, 20)), amount,
    splitOutflowIds: [outflowId],
    splits: [{ splitId: 'sp1', outflowId, amount, outflowPinnedPeriodId: pinnedPeriodId, isDefault: true }],
  });
  return { userId, outflowId };
}

const paidOf = async (outflowId: string, sp: string) =>
  ((await db.collection('outflow_periods').doc(`${outflowId}_${sp}`).get()).data()?.totalAmountPaid) ?? 0;

describe('manual period pin (emulator)', () => {
  it('pins an August-dated payment into JULY when outflowPinnedPeriodId=2026M07', async () => {
    const { outflowId } = await seedBill('2026M07');
    await reconcile({ trace_id: rid('t'), span_id: rid('s') }, { recurring_id: outflowId, recurring_type: 'outflow' });
    expect(await paidOf(outflowId, '2026M07')).toBeGreaterThan(0); // forced into July
    expect(await paidOf(outflowId, '2026M08')).toBe(0);            // NOT the txn-date month
  });

  it('CONTROL: with no pin, the same payment lands in AUGUST (its txn date)', async () => {
    const { outflowId } = await seedBill(null);
    await reconcile({ trace_id: rid('t'), span_id: rid('s') }, { recurring_id: outflowId, recurring_type: 'outflow' });
    expect(await paidOf(outflowId, '2026M08')).toBeGreaterThan(0);
    expect(await paidOf(outflowId, '2026M07')).toBe(0);
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
