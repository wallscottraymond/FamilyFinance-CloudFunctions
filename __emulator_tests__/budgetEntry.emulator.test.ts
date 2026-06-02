/**
 * Emulator E2E Tests — v2 Budget Entry (onCall)
 *
 * Drives the create_budget onCall handler end-to-end via its `.run()` method
 * (firebase-functions v2 callables expose it), against the Firestore emulator.
 * Verifies the entry contract: auth gate, Zod validation, and the happy path
 * threading through entry → orchestrator → Firestore (budget + cascade job).
 *
 * Prereqs: firebase emulators:exec --only firestore "npm run test:emulator"
 */

import * as admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
}
const db = admin.firestore();

import { create_budget } from '../src/functions/entry/callable/create_budget.entry';

const uid = () => `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const ikey = () => `k_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

// Invoke the v2 callable handler with a minimal CallableRequest.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const run = (data: unknown, userId?: string): Promise<any> =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (create_budget as any).run({
    data,
    auth: userId ? { uid: userId, token: {} } : undefined,
    rawRequest: {},
  });

function validData(userId: string, overrides: Record<string, unknown> = {}) {
  return {
    idempotency_key: ikey(),
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

describe('create_budget entry (emulator E2E)', () => {
  afterAll(async () => {
    await db.terminate();
  });

  it('rejects unauthenticated callers', async () => {
    await expect(run(validData(uid()))).rejects.toMatchObject({
      code: 'unauthenticated',
    });
  });

  it('rejects invalid input with invalid-argument', async () => {
    const userId = uid();
    // amount must be positive → schema failure.
    await expect(run(validData(userId, { amount: -5 }), userId)).rejects.toMatchObject({
      code: 'invalid-argument',
    });
  });

  it('rejects a non-ongoing budget without an end date', async () => {
    const userId = uid();
    await expect(
      run(validData(userId, { is_ongoing: false }), userId)
    ).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('creates a budget and returns the success envelope', async () => {
    const userId = uid();
    const res = await run(validData(userId), userId);

    expect(res.success).toBe(true);
    expect(res.trace_id).toBeTruthy();
    expect(res.data.budget_id).toBeTruthy();
    expect(res.data.processing_background).toBe(true);

    // Persisted through the full entry → orchestrator → Firestore path.
    const budgetDoc = await db.collection('budgets').doc(res.data.budget_id).get();
    expect(budgetDoc.exists).toBe(true);

    const jobs = await db
      .collection('_jobs')
      .where('job_type', '==', 'process_budget_created')
      .get();
    const matching = jobs.docs.filter(
      (d) => (d.data().payload as { budget_id?: string })?.budget_id === res.data.budget_id
    );
    expect(matching).toHaveLength(1);
  });
});
