/**
 * Emulator Integration — scheduled outflow-period extension.
 *
 * Regression for the 2026-10-16 bug: the job resumed "the day after the latest period's END"
 * (23:59:59.999 + 1 day) and the creator keeps only source periods that START at/after that
 * instant, so the next monthly period (starting 00:00) was always excluded — monthly
 * outflow_periods were never extended. Also proves the fix never overwrites an existing period
 * (the creator is a set()) and never creates periods before the bill began.
 *
 * Uses its own years (2041–2042) so other suites' source_periods can't leak in.
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
}
const db = admin.firestore();

import { run_outflow_period_extension } from '../src/functions/outflows/outflow_periods/scheduled/extendRecurringOutflowPeriods';

const utc = (y: number, m: number, d: number, h = 0, mi = 0, s = 0, ms = 0) =>
  new Date(Date.UTC(y, m - 1, d, h, mi, s, ms));
const endOfDay = (y: number, m: number, d: number) => utc(y, m, d, 23, 59, 59, 999);
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n: number) => String(n).padStart(2, '0');

/* eslint-disable @typescript-eslint/naming-convention */
async function seedMonthlySource(y: number, m: number) {
  const id = `${y}M${pad(m)}`;
  await db.collection('source_periods').doc(id).set({
    periodId: id,
    type: 'monthly',
    startDate: Timestamp.fromDate(utc(y, m, 1)),
    endDate: Timestamp.fromDate(endOfDay(y, m, lastDay(y, m))),
    year: y,
    index: m,
    isCurrent: false,
  });
  return id;
}

async function seedWeeklySource(id: string, start: Date) {
  const end = new Date(start.getTime() + 6 * 86400000);
  end.setUTCHours(23, 59, 59, 999);
  await db.collection('source_periods').doc(id).set({
    periodId: id,
    type: 'weekly',
    startDate: Timestamp.fromDate(start),
    endDate: Timestamp.fromDate(end),
    year: start.getUTCFullYear(),
    index: 0,
    isCurrent: false,
  });
  return { id, start, end };
}

async function seedExistingPeriod(
  outflowId: string,
  sourceId: string,
  type: string,
  start: Date,
  end: Date,
  extra: Record<string, unknown> = {}
) {
  await db.collection('outflow_periods').doc(`${outflowId}_${sourceId}`).set({
    id: `${outflowId}_${sourceId}`,
    outflowId,
    sourcePeriodId: sourceId,
    periodType: type,
    periodStartDate: Timestamp.fromDate(start),
    periodEndDate: Timestamp.fromDate(end),
    isActive: true,
    ...extra,
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

describe('run_outflow_period_extension (emulator)', () => {
  afterAll(async () => {
    await db.terminate();
  });

  it('extends monthly periods past the latest one, never overwrites, never precedes the bill', async () => {
    const outflowId = `of_ext_${Date.now()}`;
    const userId = `u_ext_${Date.now()}`;

    // Source periods: monthly Jan 2041 → Jun 2042, plus weekly ones in early April 2041.
    for (let m = 1; m <= 12; m++) await seedMonthlySource(2041, m);
    for (let m = 1; m <= 6; m++) await seedMonthlySource(2042, m);
    const w14 = await seedWeeklySource('2041W14', utc(2041, 3, 31));
    await seedWeeklySource('2041W15', utc(2041, 4, 7));

    /* eslint-disable @typescript-eslint/naming-convention */
    await db.collection('outflows').doc(outflowId).set({
      userId,
      ownerId: userId,
      createdBy: userId,
      accountId: 'acct_ext',
      plaidItemId: 'item_ext',
      groupId: null,
      source: 'plaid',
      type: 'outflow',
      tags: [],
      plaidPrimaryCategory: 'GENERAL_SERVICES',
      plaidDetailedCategory: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
      internalPrimaryCategory: 'GENERAL_SERVICES',
      internalDetailedCategory: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
      isActive: true,
      description: 'Ext Test Bill',
      merchantName: 'Ext Test',
      averageAmount: 100,
      lastAmount: 100,
      frequency: 'MONTHLY',
      firstDate: Timestamp.fromDate(utc(2041, 1, 5)),
      lastDate: Timestamp.fromDate(utc(2041, 3, 5)),
      predictedNextDate: Timestamp.fromDate(utc(2041, 4, 5)),
      transactionIds: [],
      groupIds: [],
    });
    /* eslint-enable @typescript-eslint/naming-convention */

    // Existing: monthly Jan–Mar 2041 (March carries a paid marker that must survive), and the
    // weekly W14 — whose END (Apr 6) is the latest of any type, as in production.
    await seedExistingPeriod(outflowId, '2041M01', 'monthly', utc(2041, 1, 1), endOfDay(2041, 1, 31));
    await seedExistingPeriod(outflowId, '2041M02', 'monthly', utc(2041, 2, 1), endOfDay(2041, 2, 28));
    await seedExistingPeriod(outflowId, '2041M03', 'monthly', utc(2041, 3, 1), endOfDay(2041, 3, 31), {
      totalAmountPaid: 100,
      isFullyPaid: true,
      sentinel: 'paid-march-must-survive',
    });
    await seedExistingPeriod(outflowId, w14.id, 'weekly', w14.start, w14.end, { sentinel: 'w14' });

    const now = utc(2041, 3, 15);
    const run1 = await run_outflow_period_extension(db, now, { owner_id: userId });
    expect(run1.errors).toBe(0);

    const ids = (await db.collection('outflow_periods').where('outflowId', '==', outflowId).get()).docs.map(
      (d) => d.id
    );

    // The bug: April (starts 00:00 Apr 1, the day after March ended) was skipped. Now it exists,
    // and the monthly run continues to the 15-month horizon.
    expect(ids).toContain(`${outflowId}_2041M04`);
    expect(ids).toContain(`${outflowId}_2041M05`);
    expect(ids).toContain(`${outflowId}_2042M06`);
    expect(ids).toContain(`${outflowId}_2041W15`);

    // Existing periods are never overwritten.
    const march = (await db.collection('outflow_periods').doc(`${outflowId}_2041M03`).get()).data();
    expect(march?.sentinel).toBe('paid-march-must-survive');
    expect(march?.isFullyPaid).toBe(true);
    const w14doc = (await db.collection('outflow_periods').doc(`${outflowId}_2041W14`).get()).data();
    expect(w14doc?.sentinel).toBe('w14');

    // Idempotent: a second run creates nothing.
    const run2 = await run_outflow_period_extension(db, now, { owner_id: userId });
    expect(run2.errors).toBe(0);
    const after2 = await db.collection('outflow_periods').where('outflowId', '==', outflowId).get();
    expect(after2.size).toBe(ids.length);
  });

  it('never creates periods before the bill began, even inside the look-back window', async () => {
    const outflowId = `of_ext_new_${Date.now()}`;
    const userId = `u_ext_new_${Date.now()}`;

    /* eslint-disable @typescript-eslint/naming-convention */
    await db.collection('outflows').doc(outflowId).set({
      userId,
      ownerId: userId,
      createdBy: userId,
      accountId: 'acct_ext',
      plaidItemId: 'item_ext',
      groupId: null,
      source: 'plaid',
      type: 'outflow',
      tags: [],
      plaidPrimaryCategory: 'GENERAL_SERVICES',
      plaidDetailedCategory: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
      internalPrimaryCategory: 'GENERAL_SERVICES',
      internalDetailedCategory: 'GENERAL_SERVICES_OTHER_GENERAL_SERVICES',
      isActive: true,
      description: 'New Bill',
      merchantName: 'New',
      averageAmount: 50,
      lastAmount: 50,
      frequency: 'MONTHLY',
      // Began May 20 2041: April and May (May starts before the bill) must not be created.
      firstDate: Timestamp.fromDate(utc(2041, 5, 20)),
      lastDate: Timestamp.fromDate(utc(2041, 5, 20)),
      predictedNextDate: Timestamp.fromDate(utc(2041, 6, 20)),
      transactionIds: [],
      groupIds: [],
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    await seedExistingPeriod(outflowId, '2041M06', 'monthly', utc(2041, 6, 1), endOfDay(2041, 6, 30));

    const run = await run_outflow_period_extension(db, utc(2041, 6, 10), { owner_id: userId });
    expect(run.errors).toBe(0);
    const ids = (await db.collection('outflow_periods').where('outflowId', '==', outflowId).get()).docs.map(
      (d) => d.id
    );
    expect(ids).not.toContain(`${outflowId}_2041M04`);
    expect(ids).not.toContain(`${outflowId}_2041M05`);
    expect(ids).toContain(`${outflowId}_2041M07`);
  });

  it('creates periods hidden for a hidden bill and inactive inside a removal window', async () => {
    const userId = `u_ext_flags_${Date.now()}`;
    const base = {
      userId,
      ownerId: userId,
      createdBy: userId,
      accountId: 'acct_ext',
      plaidItemId: 'item_ext',
      groupId: null,
      source: 'plaid',
      type: 'outflow',
      tags: [],
      plaidPrimaryCategory: 'TRANSFER_OUT',
      plaidDetailedCategory: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
      internalPrimaryCategory: 'TRANSFER_OUT',
      internalDetailedCategory: 'TRANSFER_OUT_ACCOUNT_TRANSFER',
      isActive: true,
      description: 'Flags Bill',
      merchantName: 'Flags',
      averageAmount: 10,
      lastAmount: 10,
      frequency: 'MONTHLY',
      firstDate: Timestamp.fromDate(utc(2041, 6, 3)),
      lastDate: Timestamp.fromDate(utc(2041, 7, 3)),
      predictedNextDate: Timestamp.fromDate(utc(2041, 8, 3)),
      transactionIds: [],
      groupIds: [],
    };
    const hiddenId = `of_ext_hidden_${Date.now()}`;
    const removedId = `of_ext_removed_${Date.now()}`;
    /* eslint-disable @typescript-eslint/naming-convention */
    await db.collection('outflows').doc(hiddenId).set({ ...base, isHidden: true });
    // Removed going forward from Sept 1 2041 (open-ended).
    await db.collection('outflows').doc(removedId).set({
      ...base,
      removedByUser: true,
      removalIntervals: [{ fromMs: utc(2041, 9, 1).getTime(), toMs: null, mode: 'going_forward' }],
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    await seedExistingPeriod(hiddenId, '2041M07', 'monthly', utc(2041, 7, 1), endOfDay(2041, 7, 31));
    await seedExistingPeriod(removedId, '2041M07', 'monthly', utc(2041, 7, 1), endOfDay(2041, 7, 31));

    const run = await run_outflow_period_extension(db, utc(2041, 7, 10), { owner_id: userId });
    expect(run.errors).toBe(0);

    const aug = (await db.collection('outflow_periods').doc(`${hiddenId}_2041M08`).get()).data();
    expect(aug?.isHidden).toBe(true);

    const removedAug = (await db.collection('outflow_periods').doc(`${removedId}_2041M08`).get()).data();
    const removedSep = (await db.collection('outflow_periods').doc(`${removedId}_2041M09`).get()).data();
    const removedOct = (await db.collection('outflow_periods').doc(`${removedId}_2041M10`).get()).data();
    expect(removedAug?.isActive).toBe(true); // before the removal window
    expect(removedSep?.isActive).toBe(false); // inside it
    expect(removedOct?.isActive).toBe(false);
    expect(removedAug?.isHidden).toBe(false);
  });

  it('v2 removed / ended bill: creation alone applies the window (month rule) — no second suppression pass', async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { outflow_repo } = require('../src/functions/repositories/outflow.repo');
    const spy = jest.spyOn(outflow_repo, 'apply_period_suppression');
    const userId = `u_ext_v2_${Date.now()}`;
    const id = `of_ext_v2_${Date.now()}`;
    // Weekly source periods around the Nov 1 2041 end (Fri): Oct 27 – Nov 2 straddles it.
    const straddle = await seedWeeklySource(`ext_v2_w_${Date.now()}`, utc(2041, 10, 27));
    const after = await seedWeeklySource(`ext_v2_w2_${Date.now()}`, utc(2041, 11, 3));
    /* eslint-disable @typescript-eslint/naming-convention */
    await db.collection('outflows').doc(id).set({
      userId, ownerId: userId, createdBy: userId, accountId: 'acct_ext', plaidItemId: 'item_ext', groupId: null, groupIds: [],
      source: 'plaid', type: 'outflow', tags: [], plaidPrimaryCategory: 'RENT_AND_UTILITIES', plaidDetailedCategory: 'RENT_AND_UTILITIES_RENT',
      isActive: true, isHidden: false, description: 'V2 Ended', merchantName: 'V2', averageAmount: 50, lastAmount: 50, frequency: 'MONTHLY',
      firstDate: Timestamp.fromDate(utc(2041, 6, 29)), lastDate: Timestamp.fromDate(utc(2041, 10, 29)),
      predictedNextDate: Timestamp.fromDate(utc(2041, 11, 29)), transactionIds: [],
      captureRulesVersion: 2, removalIntervals: [{ fromMs: utc(2041, 11, 1).getTime(), toMs: null, mode: 'going_forward' }],
    });
    /* eslint-enable @typescript-eslint/naming-convention */
    await seedExistingPeriod(id, '2041M09', 'monthly', utc(2041, 9, 1), endOfDay(2041, 9, 30));
    const run = await run_outflow_period_extension(db, utc(2041, 10, 5), { owner_id: userId });
    expect(run.errors).toBe(0);
    expect(spy).not.toHaveBeenCalled(); // creation applied the window; nothing re-reads + flips
    spy.mockRestore();
    const get = async (sp: string) => (await db.collection('outflow_periods').doc(`${id}_${sp}`).get()).data();
    expect((await get('2041M10'))?.isActive).toBe(true); // Oct 29 paid month: kept
    expect((await get('2041M11'))?.isActive).toBe(false); // ended
    expect((await get(straddle.id))?.isActive).toBe(true); // its Oct 29 occurrence is before the end (D27)
    expect((await get(after.id))?.isActive).toBe(false);
  });
});

