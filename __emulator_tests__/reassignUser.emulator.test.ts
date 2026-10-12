/**
 * Emulator Integration Test — the bounded re-assign engine (Transaction-Integrity-Review 3-R + 3-0b)
 *
 * Seeds one user's budgets, categories and transactions, then drives reassign_user_orchestrator:
 *   - a DRY RUN writes no transaction, only the report (counts, budget moves, samples);
 *   - the real run re-homes what's wrong, carries an old override into a user pick, clears the
 *     legacy fields, writes ONLY the changed transactions, stamps `assignRunId`, bumps once;
 *   - a second run changes nothing (idempotent);
 *   - the kill switch stops a run; the cap stops a run; a run out of time continues from its cursor.
 *
 * Prereqs: firebase emulators:exec --only firestore "npm run test:emulator"
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
}
const db = admin.firestore();

import {
  enqueue_reassign_user,
  reassign_user_orchestrator,
} from '../src/functions/orchestrators/transactions/reassign_user.orchestrator';
import { assign_transactions_batch_orchestrator } from '../src/functions/orchestrators/transactions/assign_transactions_batch.orchestrator';
import { transaction_repo } from '../src/functions/repositories/transaction.repo';
import { request_category_reassign } from '../src/functions/orchestrators/transactions/reassign_fanout.orchestrator';
import { invalidate_category_cache } from '../src/functions/repositories/category.repo';

const ctx = () => ({ trace_id: `t_${Date.now()}`, span_id: `s_${Date.now()}` });
const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const ts = (iso: string) => Timestamp.fromDate(new Date(iso));

// Unique category codes / slugs so the shared emulator `categories` collection can't collide.
const SHOP_CODE = `RA_SHOP_${RUN}`;
const FOOD_CODE = `RA_FOOD_${RUN}`;
const OTHER_CODE = `RA_OTHER_${RUN}`;
const SHOP = `ra_shop_${RUN}`;
const FOOD = `ra_food_${RUN}`;

/* eslint-disable @typescript-eslint/naming-convention */
async function seedCategories() {
  const doc = (id: string, first: string, name: string) =>
    db.collection('categories').doc(id).set({
      isActive: true, firstCategoryId: first, overallCategoryId: first, first_category: name,
      type: 'Outflow', merchants: [], keywords: [],
    });
  await Promise.all([
    doc(SHOP_CODE, SHOP, `RA Shopping ${RUN}`),
    doc(FOOD_CODE, FOOD, `RA Food ${RUN}`),
    doc(OTHER_CODE, `ra_other_${RUN}`, `RA Other ${RUN}`),
  ]);
  invalidate_category_cache();
}

async function seedBudget(id: string, userId: string, fields: Record<string, unknown>) {
  await db.collection('budgets').doc(id).set({
    id, userId, createdBy: userId, groupIds: [], isActive: true,
    access: { ownerId: userId, createdBy: userId, groupIds: [], isPrivate: true },
    name: id, amount: 100, currency: 'USD', categoryIds: [], period: 'monthly',
    startDate: ts('2026-01-01'), endDate: ts('2027-01-01'), isOngoing: true,
    isSystemEverythingElse: false, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    ...fields,
  });
}

function split(code: string, budgetId: string, over: Record<string, unknown> = {}) {
  return {
    splitId: 's1', budgetId, monthlyBudgetId: budgetId, plaidPrimaryCategory: code,
    plaidDetailedCategory: code, internalPrimaryCategory: null, internalDetailedCategory: null,
    amount: 10, monthlyPeriodId: null, weeklyPeriodId: null, biWeeklyPeriodId: null,
    isDefault: true, rules: [], tags: [], createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    ...over,
  };
}

async function seedTxn(
  id: string, userId: string, dateISO: string, s: Record<string, unknown>, accountId = 'acc1'
) {
  await db.collection('transactions').doc(id).set({
    transactionId: id, userId, isActive: true, transactionDate: ts(dateISO),
    merchantName: id, name: id, type: 'expense', accountId, splits: [s],
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

async function seedUser(n = 0) {
  const userId = `ra_u_${RUN}_${n}`;
  const shop = `ra_shop_b_${RUN}_${n}`;
  const food = `ra_food_b_${RUN}_${n}`;
  const ee = { m: `ra_ee_m_${RUN}_${n}`, w: `ra_ee_w_${RUN}_${n}`, b: `ra_ee_b_${RUN}_${n}` };
  await seedBudget(shop, userId, { categoryIds: [SHOP] }); // slug-only Shopping budget
  await seedBudget(food, userId, { categoryIds: [FOOD] }); // budgets own slugs (A2)
  await seedBudget(ee.m, userId, { isSystemEverythingElse: true, period: 'monthly' });
  await seedBudget(ee.w, userId, { isSystemEverythingElse: true, period: 'weekly' });
  await seedBudget(ee.b, userId, { isSystemEverythingElse: true, period: 'bi_monthly' });
  return { userId, shop, food, ee };
}

async function txn(id: string) {
  return (await db.collection('transactions').doc(id).get()).data()!;
}

describe('reassign_user_orchestrator (emulator)', () => {
  beforeAll(async () => { await seedCategories(); });
  afterAll(async () => {
    await db.collection('_config').doc('reassign').delete();
    await db.terminate();
  });

  it('dry run reports; real run fixes only what is wrong, once; a re-run changes nothing', async () => {
    const u = await seedUser(1);
    const mous = `ra_mous_${RUN}`; // Shopping code, wrongly in EE → Shopping budget
    const ok = `ra_ok_${RUN}`; // already right → untouched
    const legacy = `ra_legacy_${RUN}`; // old override to food in internal* → user pick → Food
    await seedTxn(mous, u.userId, '2026-05-03', split(SHOP_CODE, u.ee.m, {
      weeklyBudgetId: u.ee.w, biWeeklyBudgetId: u.ee.b,
    }));
    await seedTxn(ok, u.userId, '2026-05-04', split(SHOP_CODE, u.shop, {
      weeklyBudgetId: u.shop, biWeeklyBudgetId: u.shop, firstCategoryId: SHOP,
      overallCategoryId: SHOP, categorySource: 'plaid', secondCategoryId: null,
      budgetName: u.shop, weeklyBudgetName: u.shop, biWeeklyBudgetName: u.shop,
    }));
    await seedTxn(legacy, u.userId, '2026-05-05', split(SHOP_CODE, u.shop, {
      internalDetailedCategory: FOOD_CODE,
    }));
    const okBefore = (await db.collection('transactions').doc(ok).get()).updateTime!;

    // DRY RUN — nothing written, report filled.
    const dry = await reassign_user_orchestrator(ctx(), { user_id: u.userId, reason: 'backfill', dry_run: true });
    expect(dry.status).toBe('done');
    expect((await txn(mous)).splits[0].monthlyBudgetId).toBe(u.ee.m);
    expect((await txn(legacy)).splits[0].internalDetailedCategory).toBe(FOOD_CODE);
    const report = (await db.collection('_reassign_runs').doc(dry.run_id).get()).data()!;
    expect(report.dry_run).toBe(true);
    expect(report.scanned).toBe(3);
    expect(report.picks_carried).toBe(1);
    expect(report.moves[`${u.ee.m}→${u.shop}`]).toBe(1);
    expect(report.moves[`${u.shop}→${u.food}`]).toBe(1);

    // REAL RUN.
    const real = await reassign_user_orchestrator(ctx(), { user_id: u.userId, reason: 'backfill' });
    expect(real.status).toBe('done');
    const m = await txn(mous);
    expect(m.splits[0].monthlyBudgetId).toBe(u.shop);
    expect(m.assignRunId).toBe(real.run_id); // stamped → the trigger skips it
    const l = await txn(legacy);
    expect(l.splits[0]).toMatchObject({
      categorySource: 'user', firstCategoryId: FOOD, internalDetailedCategory: null,
      monthlyBudgetId: u.food, // the carried-over pick lands in the Food budget
    });
    // Untouched: the already-correct transaction was not rewritten.
    expect((await db.collection('transactions').doc(ok).get()).updateTime!.isEqual(okBefore)).toBe(true);
    // One derive bump for the run.
    const v = await db.collection('user_data_versions').doc(u.userId).get();
    expect(v.exists).toBe(true);

    // RE-RUN: idempotent.
    const again = await reassign_user_orchestrator(ctx(), { user_id: u.userId, reason: 'manual' });
    expect(again.changed).toBe(0);
  });

  it('a view-change run (scoped to accounts) touches only those accounts', async () => {
    const u = await seedUser(4);
    const inScope = `ra_scope_in_${RUN}`;
    const outScope = `ra_scope_out_${RUN}`;
    await seedTxn(inScope, u.userId, '2026-05-03', split(SHOP_CODE, u.ee.m), 'acc_shared');
    await seedTxn(outScope, u.userId, '2026-05-04', split(SHOP_CODE, u.ee.m), 'acc_private');
    const r = await reassign_user_orchestrator(ctx(), {
      user_id: u.userId, reason: 'view_change', scope: { account_ids: ['acc_shared'] },
    });
    expect(r.status).toBe('done');
    expect((await txn(inScope)).splits[0].monthlyBudgetId).toBe(u.shop);
    expect((await txn(outScope)).splits[0].monthlyBudgetId).toBe(u.ee.m); // untouched
  });

  it('kill switch stops a run before it touches anything', async () => {
    const u = await seedUser(2);
    const id = `ra_kill_${RUN}`;
    await seedTxn(id, u.userId, '2026-05-03', split(SHOP_CODE, u.ee.m));
    await db.collection('_config').doc('reassign').set({ enabled: false });
    const r = await reassign_user_orchestrator(ctx(), { user_id: u.userId });
    await db.collection('_config').doc('reassign').delete();
    expect(r.status).toBe('stopped');
    expect((await txn(id)).splits[0].monthlyBudgetId).toBe(u.ee.m);
  });

  it('cap stops a run after max_txns; out of time continues from the cursor in a new job', async () => {
    const u = await seedUser(3);
    for (let i = 0; i < 3; i++) {
      await seedTxn(`ra_cap_${RUN}_${i}`, u.userId, `2026-05-0${i + 1}`, split(SHOP_CODE, u.ee.m));
    }
    const capped = await reassign_user_orchestrator(ctx(), { user_id: u.userId, max_txns: 1 });
    expect(capped.status).toBe('capped');

    // Out of time immediately → saved cursor + a continuation job; nothing scanned yet.
    let t = 0;
    const clock = () => (t += 10 * 60 * 1000);
    const cont = await reassign_user_orchestrator(ctx(), { user_id: u.userId }, clock);
    expect(cont.status).toBe('continuing');
    const jobs = await db.collection('_jobs').where('job_type', '==', 'reassign_user').get();
    expect(jobs.docs.some((d) => d.data().payload?.run_id === cont.run_id)).toBe(true);
    // The continuation finishes the run.
    const done = await reassign_user_orchestrator(ctx(), { user_id: u.userId, run_id: cont.run_id });
    expect(done.status).toBe('done');
    for (let i = 0; i < 3; i++) {
      expect((await txn(`ra_cap_${RUN}_${i}`)).splits[0].monthlyBudgetId).toBe(u.shop);
    }
  });

  it("never overwrites a write that landed after the engine's read (precondition)", async () => {
    const u = await seedUser(5);
    const id = `ra_race_${RUN}`;
    await seedTxn(id, u.userId, '2026-05-03', split(SHOP_CODE, u.ee.m));
    const [read] = await transaction_repo.get_raw_by_ids(ctx(), [id]);
    // A user edit lands between the engine's read and its write.
    await db.collection('transactions').doc(id).update({ userNotes: 'edited', 'splits': [{ ...split(SHOP_CODE, u.ee.m), spendStatus: 'ignored' }] });
    await assign_transactions_batch_orchestrator(ctx(), {
      user_id: u.userId, transaction_ids: [id], preloaded_docs: [read],
    });
    const after = await txn(id);
    expect(after.userNotes).toBe('edited');
    expect(after.splits[0].spendStatus).toBe('ignored'); // the edit survived
    expect(after.splits[0].monthlyBudgetId).toBe(u.ee.m); // the stale write was skipped
  });

  it('a request while a run is RUNNING is queued delayed, never dropped; a queued one merges', async () => {
    const u = `ra_sf_${RUN}`;
    await db.collection('_reassign_runs').doc(`ra_sf_run_${RUN}`).set({
      run_id: `ra_sf_run_${RUN}`, user_id: u, dedup_key: `reassign_user:${u}`, status: 'running',
      updated_at: Timestamp.now(),
    });
    expect(await enqueue_reassign_user({ user_id: u }, 't')).toBe(true);
    expect(await enqueue_reassign_user({ user_id: u }, 't')).toBe(false); // merged into the queued one
    const jobs = (await db.collection('_jobs').where('job_type', '==', 'reassign_user').get()).docs
      .map((d) => d.data()).filter((j) => j.payload?.user_id === u);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].scheduled_for.toMillis()).toBeGreaterThan(Date.now() + 60_000); // after the run
    expect(typeof jobs[0].payload.run_id).toBe('string'); // a retry resumes the same run
  });

  it('a burst of category edits schedules ONE fan-out', async () => {
    await db.collection('_config').doc('category_reassign').delete();
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => request_category_reassign(ctx())));
    expect(results.filter(Boolean)).toHaveLength(1);
    await db.collection('_config').doc('category_reassign').delete();
  });
});
