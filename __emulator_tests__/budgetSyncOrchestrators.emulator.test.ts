/**
 * Emulator Integration Tests — v2 Budget CRUD Synchronous Orchestrators
 *
 * Exercises the SYNC path (the onCall-backed orchestrators) against the
 * Firestore emulator: idempotency store, budget persistence, and cascade-job
 * enqueue. Distinct from budgetCascade.emulator.test.ts, which covers the async
 * cascade handlers. No functions emulator needed — we invoke the orchestrators
 * directly and assert the resulting Firestore state (_jobs stay "pending"
 * because on_job_created doesn't run under --only firestore).
 *
 * Verifies, per operation:
 *   - the budget document is written / removed
 *   - exactly one cascade job is enqueued with the right type + payload
 *   - a replay with the SAME idempotency key returns the cached response and
 *     does NOT duplicate the budget or the job
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
  create_budget_orchestrator,
  update_budget_orchestrator,
  delete_budget_orchestrator,
} from '../src/functions/orchestrators/budgets';
import { CreateBudgetInput } from '../src/functions/types/budgets/create_budget.types';
import { UpdateBudgetInput } from '../src/functions/types/budgets/update_budget.types';

const ctx = () => ({ trace_id: `t_${Date.now()}`, span_id: `s_${Date.now()}` });
const uid = () => `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const bid = () => `b_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const key = () => `k_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

/* eslint-disable @typescript-eslint/naming-convention */
async function seedBudget(
  id: string,
  userId: string,
  fields: Record<string, unknown> = {}
) {
  await db.collection('budgets').doc(id).set({
    id,
    userId,
    createdBy: userId,
    groupIds: [],
    isActive: true,
    access: {
      ownerId: userId,
      createdBy: userId,
      groupIds: [],
      isPrivate: true,
    },
    name: 'Groceries',
    amount: 300,
    currency: 'USD',
    categoryIds: ['cat_a'],
    period: 'monthly',
    budgetType: 'recurring',
    startDate: Timestamp.fromDate(new Date('2026-06-01T00:00:00Z')),
    endDate: Timestamp.fromDate(new Date('2026-07-01T00:00:00Z')),
    spent: 0,
    remaining: 300,
    alertThreshold: 80,
    isOngoing: true,
    isSystemEverythingElse: false,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
    ...fields,
  });
}

async function seedPeriod(id: string, budgetId: string, userId: string) {
  await db.collection('budget_periods').doc(id).set({
    id,
    budgetId,
    userId,
    groupIds: [],
    periodId: id,
    sourcePeriodId: id,
    periodType: 'monthly',
    periodStart: Timestamp.fromDate(new Date('2026-06-01T00:00:00Z')),
    periodEnd: Timestamp.fromDate(new Date('2026-06-30T23:59:59Z')),
    allocatedAmount: 300,
    isActive: true,
    createdAt: Timestamp.now(),
    updatedAt: Timestamp.now(),
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

// All _jobs of a type referencing a given budget (payload is unindexed → filter
// in memory; budget ids are unique per test so this is exact).
async function jobsFor(jobType: string, budgetId: string) {
  const snap = await db.collection('_jobs').where('job_type', '==', jobType).get();
  return snap.docs
    .map((d) => d.data())
    .filter((j) => (j.payload as { budget_id?: string })?.budget_id === budgetId);
}

function createInput(overrides: Partial<CreateBudgetInput> = {}): CreateBudgetInput {
  return {
    name: 'Groceries',
    amount: 300,
    category_ids: ['cat_a'],
    period: 'monthly',
    budget_type: 'recurring',
    start_date: '2026-06-01T00:00:00.000Z',
    alert_threshold: 80,
    is_shared: false,
    is_ongoing: true,
    ...overrides,
  };
}

describe('Budget CRUD Sync Orchestrators (emulator)', () => {
  afterAll(async () => {
    await db.terminate();
  });

  describe('create_budget_orchestrator', () => {
    it('persists the budget, enqueues process_budget_created, and is idempotent', async () => {
      const userId = uid();
      const k = key();

      const res = await create_budget_orchestrator(ctx(), userId, k, createInput());
      expect(res.budget_id).toBeTruthy();
      expect(res.processing_background).toBe(true);

      // Budget document written.
      const budgetDoc = await db.collection('budgets').doc(res.budget_id).get();
      expect(budgetDoc.exists).toBe(true);
      expect(budgetDoc.data()?.amount).toBe(300);

      // Exactly one cascade job, with a full 12-month generation horizon.
      const jobs = await jobsFor('process_budget_created', res.budget_id);
      expect(jobs).toHaveLength(1);
      const payload = jobs[0].payload as {
        cadence: string;
        start_ms: number;
        generation_end_ms: number;
      };
      expect(payload.cadence).toBe('monthly');
      expect(payload.generation_end_ms).toBeGreaterThan(payload.start_ms);

      // Replay with the same key → cached response, no duplicate budget/job.
      const replay = await create_budget_orchestrator(ctx(), userId, k, createInput());
      expect(replay.budget_id).toBe(res.budget_id);
      const budgetsForUser = await db
        .collection('budgets')
        .where('userId', '==', userId)
        .get();
      expect(budgetsForUser.size).toBe(1);
      expect(await jobsFor('process_budget_created', res.budget_id)).toHaveLength(1);
    });
  });

  describe('update_budget_orchestrator', () => {
    it('persists the new amount, enqueues process_budget_updated, and is idempotent', async () => {
      const userId = uid();
      const budgetId = bid();
      await seedBudget(budgetId, userId, { amount: 300 });

      const input: UpdateBudgetInput = { budget_id: budgetId, amount: 500 };
      const k = key();
      const res = await update_budget_orchestrator(ctx(), userId, k, input);
      expect(res.processing_background).toBe(true);
      expect(res.amount).toBe(500);

      // Budget document updated.
      const budgetDoc = await db.collection('budgets').doc(budgetId).get();
      expect(budgetDoc.data()?.amount).toBe(500);

      // One cascade job flagged for regeneration (amount changed).
      const jobs = await jobsFor('process_budget_updated', budgetId);
      expect(jobs).toHaveLength(1);
      const payload = jobs[0].payload as { amount: number; regenerate_periods: boolean };
      expect(payload.amount).toBe(500);
      expect(payload.regenerate_periods).toBe(true);

      // Replay → cached response, no second job.
      const replay = await update_budget_orchestrator(ctx(), userId, k, input);
      expect(replay.amount).toBe(500);
      expect(await jobsFor('process_budget_updated', budgetId)).toHaveLength(1);
    });
  });

  describe('delete_budget_orchestrator', () => {
    it('removes the budget, enqueues process_budget_deleted, and is idempotent', async () => {
      const userId = uid();
      const budgetId = bid();
      await seedBudget(budgetId, userId);
      await seedPeriod(`${budgetId}_p1`, budgetId, userId);

      const k = key();
      const res = await delete_budget_orchestrator(ctx(), userId, k, budgetId);
      expect(res.budget_id).toBe(budgetId);
      expect(res.processing_background).toBe(true);

      // Budget document hard-deleted.
      expect((await db.collection('budgets').doc(budgetId).get()).exists).toBe(false);

      // One cascade job carrying the period ids to clean up.
      const jobs = await jobsFor('process_budget_deleted', budgetId);
      expect(jobs).toHaveLength(1);
      const payload = jobs[0].payload as { budget_period_ids: string[] };
      expect(payload.budget_period_ids).toContain(`${budgetId}_p1`);

      // Replay → cached response, no second delete job.
      const replay = await delete_budget_orchestrator(ctx(), userId, k, budgetId);
      expect(replay.budget_id).toBe(budgetId);
      expect(await jobsFor('process_budget_deleted', budgetId)).toHaveLength(1);
    });
  });
});
