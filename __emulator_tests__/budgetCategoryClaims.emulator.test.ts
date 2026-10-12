/**
 * Emulator Integration Test — per-view category ownership (canon A3 / A3b, Transaction-Integrity-Review 3b)
 *
 * Drives the create / update budget orchestrators against the Firestore emulator:
 *   - taking a category another budget owns IN THE SAME VIEW claims it from that budget
 *     (the cascade payload names the source, and re-homes from the earliest affected start);
 *   - a take that would leave the other budget with no categories is refused before any write;
 *   - another view's budgets never conflict (a group budget can own what a Me budget owns);
 *   - an edit can't remove a budget's last category.
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
} from '../src/functions/orchestrators/budgets';
import { CreateBudgetInput } from '../src/functions/types/budgets/create_budget.types';

const ctx = () => ({ trace_id: `t_${Date.now()}`, span_id: `s_${Date.now()}` });
const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const key = () => `k_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

/* eslint-disable @typescript-eslint/naming-convention */
async function seedBudget(id: string, userId: string, name: string, categoryIds: string[], startISO = '2026-03-01') {
  await db.collection('budgets').doc(id).set({
    id, userId, createdBy: userId, groupIds: [], isActive: true,
    access: { ownerId: userId, createdBy: userId, groupIds: [], isPrivate: true },
    name, amount: 300, currency: 'USD', categoryIds, period: 'monthly', budgetType: 'recurring',
    startDate: Timestamp.fromDate(new Date(`${startISO}T00:00:00Z`)),
    endDate: Timestamp.fromDate(new Date('2027-01-01T00:00:00Z')),
    spent: 0, remaining: 300, alertThreshold: 80, isOngoing: true, isSystemEverythingElse: false,
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

function input(category_ids: string[], over: Partial<CreateBudgetInput> = {}): CreateBudgetInput {
  return {
    name: 'New', amount: 100, category_ids, period: 'monthly', budget_type: 'recurring',
    start_date: '2026-06-01T00:00:00.000Z', alert_threshold: 80, is_shared: false, is_ongoing: true,
    ...over,
  };
}

async function job(type: string, budgetId: string) {
  const snap = await db.collection('_jobs').where('job_type', '==', type).get();
  return snap.docs.map((d) => d.data()).find((j) => j.payload?.budget_id === budgetId)?.payload;
}

describe('per-view category ownership (emulator)', () => {
  afterAll(async () => { await db.terminate(); });

  it('create takes a category from the budget that owns it in the same view; re-homes from its start', async () => {
    const u = `cc_u1_${RUN}`;
    await seedBudget(`cc_food_${RUN}`, u, 'Food', ['ra_groc', 'ra_eat'], '2026-03-01');
    const res = await create_budget_orchestrator(ctx(), u, key(), input(['ra_groc']));
    const payload = await job('process_budget_created', res.budget_id);
    expect(payload.claims).toEqual([{ category_id: 'ra_groc', from_budget_id: `cc_food_${RUN}` }]);
    expect(payload.rehome_from_ms).toBe(Date.parse('2026-03-01T00:00:00Z'));
  });

  it('refuses a take that would leave the other budget with no categories — nothing written', async () => {
    const u = `cc_u2_${RUN}`;
    await seedBudget(`cc_shop_${RUN}`, u, 'Shopping', ['ra_shop']);
    await expect(create_budget_orchestrator(ctx(), u, key(), input(['ra_shop']))).rejects.toThrow();
    const mine = await db.collection('budgets').where('userId', '==', u).get();
    expect(mine.size).toBe(1);
  });

  it("another view's budgets never conflict (Me and a group can each own Groceries)", async () => {
    const u = `cc_u3_${RUN}`;
    await seedBudget(`cc_grp_${RUN}`, `group:cc_g_${RUN}`, 'Group Groceries', ['ra_groc']);
    const res = await create_budget_orchestrator(ctx(), u, key(), input(['ra_groc']));
    const payload = await job('process_budget_created', res.budget_id);
    expect(payload.claims).toEqual([{ category_id: 'ra_groc', from_budget_id: null }]);
  });

  it('edit: adding a category takes it from its owner; removing the last one is refused', async () => {
    const u = `cc_u4_${RUN}`;
    await seedBudget(`cc_a_${RUN}`, u, 'A', ['ra_x', 'ra_y']);
    await seedBudget(`cc_b_${RUN}`, u, 'B', ['ra_z']);
    await update_budget_orchestrator(ctx(), u, key(), { budget_id: `cc_b_${RUN}`, category_ids: ['ra_z', 'ra_y'] });
    const payload = await job('process_budget_updated', `cc_b_${RUN}`);
    expect(payload.added_claims).toEqual([{ category_id: 'ra_y', from_budget_id: `cc_a_${RUN}` }]);

    await expect(
      update_budget_orchestrator(ctx(), u, key(), { budget_id: `cc_a_${RUN}`, category_ids: [] })
    ).rejects.toThrow();
    // Taking A's LAST remaining category (x, once y is gone) is refused too.
    await db.collection('budgets').doc(`cc_a_${RUN}`).update({ categoryIds: ['ra_x'] });
    await expect(
      update_budget_orchestrator(ctx(), u, key(), { budget_id: `cc_b_${RUN}`, category_ids: ['ra_z', 'ra_y', 'ra_x'] })
    ).rejects.toThrow(/"A" would have no categories left/);
  });
});
