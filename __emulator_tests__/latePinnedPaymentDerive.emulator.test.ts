/**
 * Emulator — a payment hand-pinned to ANOTHER period pays that period on the PERIOD PAGE (derive).
 *
 * The bug: the user assigns a late payment (Oct 20) to an overdue bill's September period with the
 * two-stage picker. Stored reconcile marked September paid, but the period page loads only the
 * payments dated in the period it shows (± a few days), so September stayed Overdue — and October
 * skipped the payment as pinned elsewhere: it counted nowhere on the page.
 *
 * The fix: `pin_split_to_outflow` records the pinned period (`outflow_pinned_periods`, same
 * transaction — its own collection, so a Plaid sync's full rewrite of the bill can't drop it); derive
 * reads the linked payments of a bill with a pinned period among the loaded ones, whatever their
 * date. Clock-free; its own year (2047), periods seeded here.
 *
 * Prereqs: firebase emulators:exec --only firestore
 *   "npx jest --selectProjects emulator --testPathPattern latePinnedPaymentDerive"
 */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';
import { halves, months, seedPeriods, weeks } from './helpers/sourcePeriods';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
const db = admin.firestore();

import { transaction_repo } from '../src/functions/repositories/transaction.repo';
import { derive_period_orchestrator } from '../src/functions/orchestrators/periods/derive_period.orchestrator';
import {
  load_period_derivation_raw,
  shape_period_derivation_deps,
} from '../src/functions/resolvers/periods/period_derivation.resolver';
import { compute_period_view } from '../src/functions/domain/periods/period_view.service';
import { reconcile_recurring_periods_orchestrator } from '../src/functions/orchestrators/recurring/reconcile_recurring_periods.orchestrator';

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const MONTHS: Array<[number, number]> = [[2047, 8], [2047, 9], [2047, 10], [2047, 11]];
const M = Object.fromEntries(months(MONTHS).map((m) => [m.id, m]));
const WEEKS = weeks(Date.UTC(2047, 6, 28), Date.UTC(2047, 11, 1)); // Sun Jul 28 2047 →
const W_SEP15 = WEEKS.find((w) => w.start <= Date.UTC(2047, 8, 15) && Date.UTC(2047, 8, 15) <= w.end)!;
const BM_SEP_A = halves(MONTHS).find((h) => h.id === '2047BM09A')!;
const ts = (y: number, m: number, d: number) => Timestamp.fromMillis(Date.UTC(y, m - 1, d, 12));
const t = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });

/* eslint-disable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any */
async function seedUser(tag: string) {
  const U = `lp_${tag}_${RUN}`;
  const BILL = `lp_bill_${tag}_${RUN}`; // monthly $100, due the 15th
  await db.collection('outflows').doc(BILL).set({
    id: BILL, ownerId: U, userId: U, createdBy: U, groupIds: [], isActive: true, isHidden: false,
    accountId: `acc_${U}`, plaidItemId: `item_${U}`, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    currency: 'USD', description: 'CAR LOAN', merchantName: 'Car Loan', userCustomName: null,
    averageAmount: 100, lastAmount: 100, frequency: 'MONTHLY',
    firstDate: ts(2047, 1, 15), lastDate: ts(2047, 10, 20), predictedNextDate: ts(2047, 11, 15),
    plaidPrimaryCategory: 'LOAN_PAYMENTS', plaidDetailedCategory: 'LOAN_PAYMENTS_CAR_PAYMENT',
    source: 'plaid', transactionIds: [], removedByUser: false, removalIntervals: [],
  });
  const pay = async (key: string, date: Timestamp) => {
    const doc = `plaid_${key}_${RUN}`;
    await db.collection('transactions').doc(doc).set({
      transactionId: `${key}_${RUN}`, userId: U, ownerId: U, accountId: `acc_${U}`, isActive: true,
      isPending: false, transactionDate: date, amount: 100, type: 'expense', name: 'CAR LOAN PAYMENT',
      merchantName: 'Car Loan', splitOutflowIds: [BILL],
      splits: [{ splitId: 'sp1', outflowId: BILL, amount: 100, isDefault: true,
        plaidPrimaryCategory: 'LOAN_PAYMENTS', plaidDetailedCategory: 'LOAN_PAYMENTS_CAR_PAYMENT' }],
    });
    return doc;
  };
  // Aug paid on time; Sep never paid on time (overdue); Oct paid Oct 10; a second, LATE payment Oct 20.
  const aug = await pay('aug', ts(2047, 8, 15));
  const oct = await pay('oct', ts(2047, 10, 10));
  const late = await pay('late', ts(2047, 10, 20));
  return { U, BILL, aug, oct, late };
}

const view = (U: string, cadence: string, w: { start: number; end: number }) =>
  derive_period_orchestrator(t(), U, { view_cadence: cadence as any, window_start_ms: w.start, window_end_ms: w.end, force: true });
const groupOf = (r: any, bill: string, pid: string) =>
  r.bills.find((b: any) => b.recurring_id === bill)?.groups.find((g: any) => g.period_id === pid);
/** How many times `txn` pays an occurrence anywhere in the result (must never exceed 1). */
const countOf = (r: any, txn: string) =>
  r.bills.flatMap((b: any) => b.groups.flatMap((g: any) => g.occurrences)).filter((o: any) => o.paid && o.transaction_id === txn).length;
const pinnedIds = async (U: string, bill: string) =>
  (await db.collection('outflow_pinned_periods').doc(`${U}__${bill}`).get()).data()?.periodIds;

beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  await seedPeriods(db, [...months(MONTHS), ...WEEKS, ...halves(MONTHS)]);
}, 60000);

describe('a late payment pinned to an overdue period pays it on the period page (emulator)', () => {
  it('Sep (overdue) turns paid by the Oct 20 payment; Oct keeps its own; each counted once', async () => {
    const { U, BILL, oct, late } = await seedUser('a');
    // Before the pin: Sep overdue (the late payment pays Oct's neighbour by date, never Sep).
    expect(groupOf(await view(U, 'monthly', M['2047M09']), BILL, '2047M09').is_fully_paid).toBe(false);

    await transaction_repo.pin_split_to_outflow(t() as any, late, 'sp1', BILL, U, false, '2047M09');
    expect(await pinnedIds(U, BILL)).toEqual(['2047M09']);

    const sep = await view(U, 'monthly', M['2047M09']);
    const g = groupOf(sep, BILL, '2047M09');
    expect([g.is_fully_paid, g.occurrences.map((o: any) => o.transaction_id)]).toEqual([true, [late]]);
    expect(countOf(sep, late)).toBe(1);

    const octV = await view(U, 'monthly', M['2047M10']);
    expect(groupOf(octV, BILL, '2047M10').occurrences.map((o: any) => [o.paid, o.transaction_id])).toEqual([[true, oct]]);
    expect(countOf(octV, late)).toBe(0); // pinned to Sep: never also Oct

    // Weekly / twice-a-month: the week / half holding Sep 15 (the pinned month's due date).
    const wk = await view(U, 'weekly', W_SEP15);
    expect(groupOf(wk, BILL, W_SEP15.id).is_fully_paid).toBe(true);
    expect(countOf(wk, late)).toBe(1);
    const bm = await view(U, 'bi_monthly', BM_SEP_A);
    expect(groupOf(bm, BILL, BM_SEP_A.id).is_fully_paid).toBe(true);
    expect(countOf(bm, late)).toBe(1);
  });

  it('multi-period load (Home preload): every month paid by exactly its own payment', async () => {
    const { U, BILL, aug, oct, late } = await seedUser('b');
    await transaction_repo.pin_split_to_outflow(t() as any, late, 'sp1', BILL, U, false, '2047M09');
    const ws = MONTHS.map(([y, m]) => M[`${y}M${String(m).padStart(2, '0')}`]).map((p) => ({ start_ms: p.start, end_ms: p.end }));
    const raw = await load_period_derivation_raw(t() as any, U, 'monthly', ws);
    const per = ws.map((w) => compute_period_view(shape_period_derivation_deps(raw, 'monthly', w.start_ms, w.end_ms), 'monthly'));
    const paidBy = per.map((r, i) => groupOf(r, BILL, Object.keys(M)[i])?.occurrences.map((o: any) => o.paid ? o.transaction_id : null));
    expect(paidBy).toEqual([[aug], [late], [oct], [null]]);
    expect(per.reduce((n, r) => n + countOf(r, late), 0)).toBe(1);
  });

  it('paid AHEAD: an Oct 10 payment pinned to November pays November, not October', async () => {
    const { U, BILL, oct } = await seedUser('c');
    await transaction_repo.pin_split_to_outflow(t() as any, oct, 'sp1', BILL, U, false, '2047M11');
    const nov = await view(U, 'monthly', M['2047M11']);
    expect(groupOf(nov, BILL, '2047M11').occurrences.map((o: any) => o.transaction_id)).toEqual([oct]);
    expect(countOf(await view(U, 'monthly', M['2047M10']), oct)).toBe(0);
  });

  it('a Plaid sync that read the bill BEFORE the pin and rewrites it whole can\'t undo the pin; repeat pins add nothing', async () => {
    const { U, BILL, late, oct } = await seedUser('d');
    const stale = (await db.collection('outflows').doc(BILL).get()).data()!; // the sync's earlier read
    await transaction_repo.pin_split_to_outflow(t() as any, late, 'sp1', BILL, U, false, '2047M09');
    await transaction_repo.pin_split_to_outflow(t() as any, late, 'sp1', BILL, U, false, '2047M09');
    await transaction_repo.pin_split_to_outflow(t() as any, oct, 'sp1', BILL, U, false, '2047M10');
    await db.collection('outflows').doc(BILL).set({ ...stale, lastSyncedAt: Timestamp.now() }); // full set
    expect(await pinnedIds(U, BILL)).toEqual(['2047M09', '2047M10']);
    expect(groupOf(await view(U, 'monthly', M['2047M09']), BILL, '2047M09').occurrences.map((o: any) => o.transaction_id)).toEqual([late]);
  });

  it('a pinned payment with a second split on the same bill pays the NET of both (as stored reconcile), once', async () => {
    const { U, BILL, late } = await seedUser('g');
    // The late payment split in two, both on the bill: $60 + $40; only the first is pinned.
    await db.collection('transactions').doc(late).update({
      splits: [
        { splitId: 'sp1', outflowId: BILL, amount: 60, isDefault: true },
        { splitId: 'sp2', outflowId: BILL, amount: 40, isDefault: false },
      ],
    });
    await transaction_repo.pin_split_to_outflow(t() as any, late, 'sp1', BILL, U, false, '2047M09');
    const sep = await view(U, 'monthly', M['2047M09']);
    const g = groupOf(sep, BILL, '2047M09');
    expect([g.total_paid, g.is_fully_paid, countOf(sep, late)]).toEqual([100, true, 1]);
    expect(countOf(await view(U, 'monthly', M['2047M10']), late)).toBe(0);
  });

  it('a linked record with no transaction date never breaks the page', async () => {
    const { U, BILL, late } = await seedUser('h');
    await db.collection('transactions').doc(`legacy_${RUN}_h`).set({
      userId: U, ownerId: U, accountId: `acc_${U}`, isActive: true, amount: 100, splitOutflowIds: [BILL],
      splits: [{ splitId: 'sp1', outflowId: BILL, amount: 100, isDefault: true }],
    });
    await transaction_repo.pin_split_to_outflow(t() as any, late, 'sp1', BILL, U, false, '2047M09');
    expect(groupOf(await view(U, 'monthly', M['2047M09']), BILL, '2047M09').is_fully_paid).toBe(true);
  });

  it('un-pinning puts the payment back by date (a stale pinned period on the bill is harmless)', async () => {
    const { U, BILL, late } = await seedUser('e');
    await transaction_repo.pin_split_to_outflow(t() as any, late, 'sp1', BILL, U, false, '2047M09');
    await transaction_repo.pin_split_to_outflow(t() as any, late, 'sp1', BILL, U, false, null); // same bill, no period
    const sep = await view(U, 'monthly', M['2047M09']);
    expect(groupOf(sep, BILL, '2047M09').is_fully_paid).toBe(false);
    expect(countOf(sep, late)).toBe(0);
  });

  it('a period pin left on an AUTOMATIC link (the engine re-linked it) is stale: placed by date, page and stored alike', async () => {
    const { U, BILL, late } = await seedUser('i');
    await transaction_repo.pin_split_to_outflow(t() as any, late, 'sp1', BILL, U, false, '2047M09');
    // The engine re-made the link automatically (e.g. after the pinned bill was hidden), keeping the old period.
    const doc = (await db.collection('transactions').doc(late).get()).data()!;
    await db.collection('transactions').doc(late).update({
      splits: doc.splits.map((sp: any) => ({ ...sp, outflowAssignmentSource: 'auto' })),
    });
    const sep = await view(U, 'monthly', M['2047M09']);
    expect([groupOf(sep, BILL, '2047M09').is_fully_paid, countOf(sep, late)]).toEqual([false, 0]);
    // Stored reconcile agrees: Sep unpaid; the payment counts by its date (October).
    for (const sp of ['2047M09', '2047M10']) {
      await db.collection('outflow_periods').doc(`${BILL}_${sp}`).set({
        id: `${BILL}_${sp}`, outflowId: BILL, ownerId: U, userId: U, sourcePeriodId: sp, periodType: 'monthly',
        periodStartDate: Timestamp.fromMillis(M[sp].start), periodEndDate: Timestamp.fromMillis(M[sp].end),
        amountPerOccurrence: 100, totalAmountDue: 100, totalAmountPaid: 0,
        occurrenceDueDates: [ts(2047, Number(sp.slice(-2)), 15)], firstDueDateInPeriod: ts(2047, Number(sp.slice(-2)), 15), isActive: true,
      });
    }
    await reconcile_recurring_periods_orchestrator(t() as any, { recurring_id: BILL, recurring_type: 'outflow', user_id: U, trace_id: 't' } as any);
    const stored = async (sp: string) => (await db.collection('outflow_periods').doc(`${BILL}_${sp}`).get()).data()!;
    const matched = async (sp: string) => ((await stored(sp)).reconciliation?.matchedSplits ?? []).map((m: any) => m.transactionId);
    expect(await matched('2047M09')).not.toContain(late);
  });

  it('a pin to someone else\'s bill is refused and records nothing on it', async () => {
    const a = await seedUser('f1');
    const b = await seedUser('f2');
    await expect(
      transaction_repo.pin_split_to_outflow(t() as any, a.late, 'sp1', b.BILL, a.U, false, '2047M09')
    ).rejects.toThrow();
    expect(await pinnedIds(a.U, b.BILL)).toBeUndefined();
    expect(await pinnedIds(b.U, b.BILL)).toBeUndefined();
  });
});
/* eslint-enable @typescript-eslint/naming-convention, @typescript-eslint/no-explicit-any */
