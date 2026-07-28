/**
 * Emulator Integration — Per-Period Everything-Else provisioning (Phase 1)
 *
 * Verifies createEverythingElseBudget now provisions ONE EE budget per period
 * lens (monthly / weekly / bi_monthly), is idempotent, and UPGRADES a legacy
 * single monthly EE in place (adds the two missing lenses, no duplicate monthly).
 *
 * Prereqs: firebase emulators:exec --only firestore "..."
 */

import * as admin from 'firebase-admin';

process.env.FIRESTORE_EMULATOR_HOST = process.env.FIRESTORE_EMULATOR_HOST || 'localhost:8080';
if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
}
const db = admin.firestore();

import { createEverythingElseBudget } from '../src/functions/budgets/utils/createEverythingElseBudget';

const uid = () => `u_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

/* eslint-disable @typescript-eslint/naming-convention */
async function seedCategories() {
  // getActiveCategories() reads the `categories` collection (isActive === true).
  await db.collection('categories').doc('FOOD_AND_DRINK_GROCERIES').set({ isActive: true, name: 'Groceries' });
  await db.collection('categories').doc('TRAVEL_FLIGHTS').set({ isActive: true, name: 'Flights' });
}

async function eeBudgets(userId: string) {
  const snap = await db
    .collection('budgets')
    .where('userId', '==', userId)
    .where('isSystemEverythingElse', '==', true)
    .get();
  const byLens: Record<string, string> = {};
  snap.docs.forEach((d) => {
    const lens = (d.data().everythingElsePeriodType as string) || (d.data().period as string);
    byLens[lens] = d.id;
  });
  return { size: snap.size, byLens, docs: snap.docs };
}
/* eslint-enable @typescript-eslint/naming-convention */

describe('createEverythingElseBudget — per-period provisioning (emulator)', () => {
  beforeAll(async () => {
    await seedCategories();
  });
  afterAll(async () => {
    await db.terminate();
  });

  it('provisions THREE EE budgets (one per lens) and returns the monthly id', async () => {
    const user = uid();
    const monthlyId = await createEverythingElseBudget(db, user, 'USD');

    const { size, byLens } = await eeBudgets(user);
    expect(size).toBe(3);
    expect(Object.keys(byLens).sort()).toEqual(['bi_monthly', 'monthly', 'weekly']);
    expect(byLens['monthly']).toBe(monthlyId); // back-compat: returns the monthly lens
  });

  it('is idempotent — a second call creates no new EE budgets', async () => {
    const user = uid();
    await createEverythingElseBudget(db, user, 'USD');
    await createEverythingElseBudget(db, user, 'USD');
    expect((await eeBudgets(user)).size).toBe(3);
  });

  it('upgrades a legacy single monthly EE in place (adds the 2 missing lenses)', async () => {
    const user = uid();
    // Legacy state: one EE with period 'monthly' and NO everythingElsePeriodType.
    const legacy = await db.collection('budgets').add({
      userId: user,
      isSystemEverythingElse: true,
      period: 'monthly',
      name: 'Everything Else',
      amount: 0,
      isActive: true,
    });

    const monthlyId = await createEverythingElseBudget(db, user, 'USD');

    expect(monthlyId).toBe(legacy.id); // reused the legacy monthly EE, not duplicated
    const { size, byLens } = await eeBudgets(user);
    expect(size).toBe(3); // legacy monthly + new weekly + new bi_monthly
    expect(byLens['monthly']).toBe(legacy.id);
    expect(byLens['weekly']).toBeDefined();
    expect(byLens['bi_monthly']).toBeDefined();
  });
});
