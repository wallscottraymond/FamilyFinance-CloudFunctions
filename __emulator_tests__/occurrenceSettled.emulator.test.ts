/**
 * Emulator Integration Test — "Mark as paid" / "Mark as received" (set_occurrence_settled)
 *
 * A bill paid in cash / from an unlinked account (or income received outside the linked accounts)
 * never gets a transaction, so the user marks that OCCURRENCE settled. The mark lives on the
 * definition and ONE rule applies it on the PERIOD PAGE (derive) and in the STORED reconcile:
 * a real payment always wins; an unpaid marked occurrence is settled by the mark's amount.
 *
 * Every assertion checks both the page (derive_period) and the stored outflow / inflow period.
 *
 * Prereqs: firebase emulators:exec --project demo-branch --only firestore
 *   "npx jest --selectProjects emulator --testPathPattern occurrenceSettled"
 */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
const db = admin.firestore();

import { outflow_repo } from '../src/functions/repositories/outflow.repo';
import { derive_period_orchestrator } from '../src/functions/orchestrators/periods/derive_period.orchestrator';
import { reconcile_recurring_periods_orchestrator } from '../src/functions/orchestrators/recurring/reconcile_recurring_periods.orchestrator';
import { set_occurrence_settled_orchestrator } from '../src/functions/orchestrators/recurring/set_occurrence_settled.orchestrator';
import { generate_expected_occurrences_in_window } from '../src/functions/domain/outflows/outflow_period.service';
import type { OutflowForPersistence } from '../src/functions/integrations/plaid/plaid_recurring_transformer';

const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const U = `ms_u_${RUN}`;
const OTHER = `ms_o_${RUN}`;
const GROUP = `ms_g_${RUN}`;
const BILL = `ms_bill_${RUN}`; // monthly $50, due the 15th
const WEEKLY = `ms_wk_${RUN}`; // weekly $20, shared with GROUP
const INC = `ms_inc_${RUN}`; // monthly $1000 income, due the 20th
const PAY = `ms_pay_${RUN}`;
const EE = `ms_ee_${RUN}`;
const SP = '2033M08';
const AUG = { start: Date.parse('2033-08-01T00:00:00Z'), end: Date.parse('2033-08-31T23:59:59.999Z') };
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));
const t = () => ({ trace_id: `t_${Math.random()}`, span_id: 's' });
let created_source_period = false;

/* eslint-disable @typescript-eslint/naming-convention */
const recurringDoc = (id: string, o: Record<string, unknown>) => ({
  id, ownerId: U, userId: U, createdBy: U, groupIds: [], isActive: true, isHidden: false,
  accountId: 'acc_ms', plaidItemId: 'item_ms', createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  currency: 'USD', description: id, merchantName: id, userCustomName: null,
  firstDate: ts('2033-01-01T00:00:00Z'), plaidPrimaryCategory: 'GENERAL_SERVICES',
  plaidDetailedCategory: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', source: 'plaid',
  transactionIds: [], removedByUser: false, removalIntervals: [], ...o,
});

/** A stored period for the window, with the SAME due dates the page generates. */
async function storedPeriod(
  coll: 'outflow_periods' | 'inflow_periods', link: 'outflowId' | 'inflowId', id: string,
  schedule: Parameters<typeof generate_expected_occurrences_in_window>[0]
) {
  const dues = generate_expected_occurrences_in_window(schedule, AUG.start, AUG.end)
    .map((g) => Timestamp.fromMillis(g.due_date_ms));
  await db.collection(coll).doc(`${id}_${SP}`).set({
    id: `${id}_${SP}`, [link]: id, ownerId: U, userId: U, sourcePeriodId: SP, periodType: 'monthly',
    periodStartDate: Timestamp.fromMillis(AUG.start), periodEndDate: Timestamp.fromMillis(AUG.end),
    amountPerOccurrence: schedule.average_amount, totalAmountDue: dues.length * schedule.average_amount,
    totalAmountPaid: 0, occurrenceDueDates: dues, firstDueDateInPeriod: dues[0], isActive: true,
  });
  return dues.length;
}
/* eslint-enable @typescript-eslint/naming-convention */

const page = async () =>
  derive_period_orchestrator(t(), U, {
    view_cadence: 'monthly', window_start_ms: AUG.start, window_end_ms: AUG.end, force: true,
  });
const pageGroup = async (kind: 'bills' | 'income', id: string) =>
  (await page())[kind].find((r) => r.recurring_id === id)?.groups.find((g) => g.period_id === SP);
const stored = async (kind: 'outflow' | 'inflow', id: string) => {
  await reconcile_recurring_periods_orchestrator(t(), {
    recurring_id: id, recurring_type: kind, user_id: U, trace_id: 't',
  });
  return (await db.collection(`${kind}_periods`).doc(`${id}_${SP}`).get()).data()!;
};
const settle = (
  input: Parameters<typeof set_occurrence_settled_orchestrator>[3],
  user = U,
  groups: string[] = []
) => set_occurrence_settled_orchestrator(t(), user, groups, input);

describe('Mark as paid / received (emulator)', () => {
  beforeAll(async () => {
    const sp = db.collection('source_periods').doc(SP);
    if (!(await sp.get()).exists) {
      created_source_period = true;
      /* eslint-disable @typescript-eslint/naming-convention */
      await sp.set({
        periodId: SP, type: 'monthly', startDate: Timestamp.fromMillis(AUG.start),
        endDate: Timestamp.fromMillis(AUG.end), year: 2033,
      });
      /* eslint-enable @typescript-eslint/naming-convention */
    }
    await db.collection('users').doc(U).set({ email: 'x@x.com' });
    /* eslint-disable @typescript-eslint/naming-convention */
    await db.collection('budgets').doc(EE).set({
      id: EE, userId: U, createdBy: U, groupIds: [], isActive: true,
      access: { ownerId: U, createdBy: U, groupIds: [], isPrivate: true },
      name: 'Everything Else', amount: 0, currency: 'USD', categoryIds: [], period: 'monthly',
      budgetType: 'recurring', startDate: ts('2033-01-01T00:00:00Z'), endDate: ts('2034-01-01T00:00:00Z'),
      isOngoing: true, isSystemEverythingElse: true, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    const bill = {
      averageAmount: 50, lastAmount: 50, frequency: 'monthly',
      lastDate: ts('2033-07-15T00:00:00Z'), predictedNextDate: ts('2033-08-15T00:00:00Z'),
    };
    await db.collection('outflows').doc(BILL).set(recurringDoc(BILL, bill));
    const wk = {
      averageAmount: 20, lastAmount: 20, frequency: 'weekly', groupIds: [GROUP],
      lastDate: ts('2033-07-29T00:00:00Z'), predictedNextDate: ts('2033-08-05T00:00:00Z'),
    };
    await db.collection('outflows').doc(WEEKLY).set(recurringDoc(WEEKLY, wk));
    const inc = {
      averageAmount: 1000, lastAmount: 1000, frequency: 'monthly', payerName: 'Employer',
      lastDate: ts('2033-07-20T00:00:00Z'), predictedNextDate: ts('2033-08-20T00:00:00Z'),
      plaidPrimaryCategory: 'INCOME', plaidDetailedCategory: 'INCOME_WAGES',
    };
    await db.collection('inflows').doc(INC).set(recurringDoc(INC, inc));
    /* eslint-enable @typescript-eslint/naming-convention */
    const sched = (o: Record<string, unknown>) => ({
      frequency: o.frequency as string, average_amount: o.averageAmount as number,
      first_date: ts('2033-01-01T00:00:00Z'), last_date: o.lastDate as Timestamp,
      predicted_next_date: o.predictedNextDate as Timestamp, source: 'plaid',
    });
    await storedPeriod('outflow_periods', 'outflowId', BILL, sched(bill));
    expect(await storedPeriod('outflow_periods', 'outflowId', WEEKLY, sched(wk))).toBe(4);
    await storedPeriod('inflow_periods', 'inflowId', INC, sched(inc));
  });

  afterAll(async () => {
    // Delete EVERYTHING this suite created — incl. the shared source period and its queued jobs.
    const refs = [
      db.collection('outflows').doc(BILL), db.collection('outflows').doc(WEEKLY),
      db.collection('inflows').doc(INC), db.collection('outflow_periods').doc(`${BILL}_${SP}`),
      db.collection('outflow_periods').doc(`${WEEKLY}_${SP}`), db.collection('inflow_periods').doc(`${INC}_${SP}`),
      db.collection('transactions').doc(PAY), db.collection('budgets').doc(EE), db.collection('users').doc(U),
      db.collection('user_data_versions').doc(U),
    ];
    if (created_source_period) refs.push(db.collection('source_periods').doc(SP));
    const jobs = await db.collection('_jobs').get();
    for (const d of jobs.docs) if (JSON.stringify(d.data().payload ?? {}).includes(RUN)) refs.push(d.ref);
    for (const c of ['derived_period_cache', 'derived_recurring_view_cache']) {
      for (const d of (await db.collection(c).get()).docs) if (d.id.includes(RUN)) refs.push(d.ref);
    }
    for (const r of refs) await r.delete();
    await db.terminate();
  });

  it('monthly bill, no transaction: Mark as paid → paid on the page AND the stored period', async () => {
    const r = await settle({ kind: 'outflow', recurring_id: BILL, due_date: '2033-08-15', settled: true });
    expect(r.amount).toBe(50); // defaults to the expected amount the page shows
    const g = (await pageGroup('bills', BILL))!;
    expect(g).toMatchObject({ count_paid: 1, total_paid: 50, total_due: 50, is_fully_paid: true });
    expect(g.occurrences[0]).toMatchObject({ paid: true, amount: 50, manual: true });
    const s = await stored('outflow', BILL);
    expect(s).toMatchObject({ isPaid: true, totalAmountPaid: 50, numberOfOccurrencesPaid: 1 });
    expect(s.reconciliation).toMatchObject({ status: 'complete', manualAmount: 50 });
    expect(s.reconciliation.occurrences[0]).toMatchObject({ paid: true, manual: true, transactionId: null });
    // The stored reconcile was queued for the item (stored periods follow without a manual run).
    const jobs = await db.collection('_jobs').where('job_type', '==', 'reconcile_recurring_period').get();
    expect(jobs.docs.some((d) => d.data().payload?.recurring_id === BILL)).toBe(true);
  });

  it('the mark survives a Plaid-style re-save of the outflow doc (repo save path)', async () => {
    const e = (await outflow_repo.get_by_id(t(), BILL))!;
    /* eslint-disable @typescript-eslint/naming-convention */
    const entity: OutflowForPersistence = {
      id: BILL, owner_id: U, created_by: U, updated_by: U, group_ids: [], plaid_item_id: 'item_ms',
      plaid_stream_id: BILL, account_id: 'acc_ms', last_amount: 51, average_amount: 50, currency: 'USD',
      description: e.description, merchant_name: e.merchant_name, user_custom_name: null,
      frequency: 'monthly' as never, first_date: e.first_date.toDate(), last_date: e.last_date.toDate(),
      predicted_next_date: e.predicted_next_date!.toDate(), plaid_primary_category: 'GENERAL_SERVICES',
      plaid_detailed_category: e.plaid_detailed_category, internal_primary_category: null,
      internal_detailed_category: null, expense_type: 'other', is_essential: false,
      status: 'active' as never, source: 'plaid' as never, plaid_status: 'MATURE', plaid_confidence_level: null,
      is_active: true, is_hidden: false, is_user_modified: false, transaction_ids: [], tags: [], rules: [],
    };
    /* eslint-enable @typescript-eslint/naming-convention */
    const res = await outflow_repo.save_batch(t(), [entity]);
    expect(res.written).toHaveLength(1); // lastAmount changed → a real rewrite happened
    const doc = (await db.collection('outflows').doc(BILL).get()).data()!;
    expect(doc.lastAmount).toBe(51);
    expect(doc.manualSettledOccurrences['2033-08-15']).toMatchObject({ amount: 50, markedBy: U });
    expect((await pageGroup('bills', BILL))!.count_paid).toBe(1);
  });

  it('Mark as unpaid → unpaid on the page AND the stored period', async () => {
    const r = await settle({ kind: 'outflow', recurring_id: BILL, due_date: '2033-08-15', settled: false });
    expect(r.amount).toBeNull();
    const g = (await pageGroup('bills', BILL))!;
    expect(g).toMatchObject({ count_paid: 0, total_paid: 0, is_fully_paid: false });
    expect(g.occurrences[0]).not.toHaveProperty('manual');
    const s = await stored('outflow', BILL);
    expect(s).toMatchObject({ isPaid: false, totalAmountPaid: 0, numberOfOccurrencesPaid: 0 });
    expect(s.reconciliation.status).toBe('none');
    const doc = (await db.collection('outflows').doc(BILL).get()).data()!;
    expect(doc.manualSettledOccurrences ?? {}).not.toHaveProperty('2033-08-15');
  });

  it('a real payment arriving for a marked occurrence pays it ONCE, by the transaction', async () => {
    await settle({ kind: 'outflow', recurring_id: BILL, due_date: '2033-08-15', settled: true, amount: 45 });
    expect((await pageGroup('bills', BILL))!.total_paid).toBe(45); // the mark's own amount
    /* eslint-disable @typescript-eslint/naming-convention */
    await db.collection('transactions').doc(PAY).set({
      transactionId: `p_${PAY}`, userId: U, ownerId: U, accountId: 'acc_ms', isActive: true, isPending: false,
      transactionDate: ts('2033-08-16T12:00:00Z'), amount: 50, type: 'expense', name: BILL, merchantName: BILL,
      splitOutflowIds: [BILL],
      splits: [{
        splitId: 's1', amount: 50, isDefault: true, plaidPrimaryCategory: 'GENERAL_SERVICES',
        plaidDetailedCategory: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES', budgetId: 'unassigned',
        outflowId: BILL, inflowId: null,
      }],
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    const g = (await pageGroup('bills', BILL))!;
    expect(g).toMatchObject({ count_paid: 1, total_paid: 50 }); // not 95, not 45
    expect(g.occurrences[0]).not.toHaveProperty('manual');
    const s = await stored('outflow', BILL);
    expect(s).toMatchObject({ isPaid: true, totalAmountPaid: 50, numberOfOccurrencesPaid: 1 });
    expect(s.reconciliation).toMatchObject({ manualAmount: 0, matchedAmount: 50 });
    expect(s.reconciliation.occurrences[0]).toMatchObject({ manual: false, transactionId: PAY });
    // The payment goes away (e.g. removed account) → the mark settles it again.
    await db.collection('transactions').doc(PAY).delete();
    expect((await pageGroup('bills', BILL))!.total_paid).toBe(45);
    expect(await stored('outflow', BILL)).toMatchObject({ isPaid: true, totalAmountPaid: 45 });
  });

  it('weekly bill: marking ONE occurrence of four settles only that one (page and stored)', async () => {
    await settle({ kind: 'outflow', recurring_id: WEEKLY, due_date: '2033-08-12', settled: true });
    const g = (await pageGroup('bills', WEEKLY))!;
    expect(g).toMatchObject({ count_in_period: 4, count_paid: 1, total_paid: 20, status: 'partial' });
    expect(g.occurrences.filter((o) => o.manual).map((o) => new Date(o.due_ms).toISOString().slice(0, 10)))
      .toEqual(['2033-08-12']);
    const s = await stored('outflow', WEEKLY);
    expect(s).toMatchObject({
      numberOfOccurrencesInPeriod: 4, numberOfOccurrencesPaid: 1, totalAmountPaid: 20, isPartiallyPaid: true,
    });
  });

  it('income: Mark as received counts toward received (page and stored)', async () => {
    const r = await settle({ kind: 'inflow', recurring_id: INC, due_date: '2033-08-20', settled: true });
    expect(r.amount).toBe(1000);
    const g = (await pageGroup('income', INC))!;
    expect(g).toMatchObject({ count_paid: 1, total_paid: 1000, is_fully_paid: true });
    expect(g.occurrences[0].manual).toBe(true);
    expect(await stored('inflow', INC)).toMatchObject({ isPaid: true, totalAmountPaid: 1000 });
    await settle({ kind: 'inflow', recurring_id: INC, due_date: '2033-08-20', settled: false });
    expect((await pageGroup('income', INC))!.count_paid).toBe(0);
    expect(await stored('inflow', INC)).toMatchObject({ isPaid: false, totalAmountPaid: 0 });
  });

  it('auth: a non-owner is refused; a member of a group the item is shared with is allowed', async () => {
    await expect(
      settle({ kind: 'outflow', recurring_id: BILL, due_date: '2033-08-15', settled: false }, OTHER)
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' });
    await expect(
      settle({ kind: 'outflow', recurring_id: BILL, due_date: '2033-08-15', settled: false }, OTHER, [GROUP])
    ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' }); // BILL isn't shared with GROUP
    const r = await settle(
      { kind: 'outflow', recurring_id: WEEKLY, due_date: '2033-08-19', settled: true }, OTHER, [GROUP]
    );
    expect(r.amount).toBe(20);
    const doc = (await db.collection('outflows').doc(WEEKLY).get()).data()!;
    expect(doc.manualSettledOccurrences['2033-08-19'].markedBy).toBe(OTHER);
  });

  it('a due date that is not an occurrence of the item is refused (invalid-argument)', async () => {
    await expect(
      settle({ kind: 'outflow', recurring_id: BILL, due_date: '2033-08-14', settled: true })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      settle({ kind: 'outflow', recurring_id: BILL, due_date: '2033-02-30', settled: true })
    ).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(
      settle({ kind: 'outflow', recurring_id: `${BILL}_nope`, due_date: '2033-08-15', settled: true })
    ).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('a marked occurrence in a removed month is hidden like every occurrence there', async () => {
    /* eslint-disable @typescript-eslint/naming-convention */
    await db.collection('outflows').doc(BILL).update({
      removalIntervals: [{ fromMs: AUG.start, toMs: null, mode: 'going_forward' }],
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    const bill = (await page()).bills.find((b) => b.recurring_id === BILL);
    expect(bill?.groups.find((g) => g.period_id === SP)).toBeUndefined();
  });
});
