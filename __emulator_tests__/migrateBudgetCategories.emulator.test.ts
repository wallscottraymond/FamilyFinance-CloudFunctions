/**
 * Emulator Integration Test — the A2 budget-category migration (Transaction-Integrity-Review 3c).
 * Dry run writes only a report; apply needs the reviewed run, snapshots first, writes only what
 * was reviewed, and skips a budget edited since the review.
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

import { migrate_budget_categories_orchestrator } from '../src/functions/orchestrators/budgets/migrate_budget_categories.orchestrator';
import { invalidate_category_cache } from '../src/functions/repositories/category.repo';

const ctx = () => ({ trace_id: `t_${Date.now()}`, span_id: `s_${Date.now()}` });
const RUN = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

/* eslint-disable @typescript-eslint/naming-convention */
async function seedBudget(id: string, userId: string, categoryIds: string[], ee = false) {
  await db.collection('budgets').doc(id).set({
    id, userId, createdBy: userId, groupIds: [], isActive: true,
    access: { ownerId: userId, createdBy: userId, groupIds: [], isPrivate: true },
    name: id, amount: 100, currency: 'USD', categoryIds, period: 'monthly', budgetType: 'recurring',
    startDate: Timestamp.fromDate(new Date('2026-01-01T00:00:00Z')),
    endDate: Timestamp.fromDate(new Date('2027-01-01T00:00:00Z')),
    isOngoing: true, isSystemEverythingElse: ee, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}
/* eslint-enable @typescript-eslint/naming-convention */

const ids = async (id: string) => (await db.collection('budgets').doc(id).get()).data()!.categoryIds;

describe('migrate_budget_categories (emulator)', () => {
  afterAll(async () => { await db.terminate(); });

  it('dry run → review → apply exactly that; snapshot first; edited-since budgets skipped', async () => {
    // A whole first covered by codes (→ slug); an EE list (→ []); one budget edited after review.
    await db.collection('categories').doc(`MB_A_${RUN}`).set({ isActive: true, firstCategoryId: `mb_first_${RUN}`, overallCategoryId: 'x' });
    invalidate_category_cache();
    const u = `mb_u_${RUN}`;
    await seedBudget(`mb_codes_${RUN}`, u, [`MB_A_${RUN}`]);
    await seedBudget(`mb_ee_${RUN}`, u, ['a', 'b'], true);
    await seedBudget(`mb_edit_${RUN}`, u, [], true);
    await db.collection('budgets').doc(`mb_edit_${RUN}`).update({ categoryIds: ['z'] });

    const dry = await migrate_budget_categories_orchestrator(ctx(), { dry_run: true });
    expect(await ids(`mb_codes_${RUN}`)).toEqual([`MB_A_${RUN}`]); // nothing written
    const report = (await db.collection('_migration_reports').doc(dry.run_id).get()).data()!;
    const mine = report.changes.filter((c: { budget_id: string }) => c.budget_id.endsWith(RUN));
    expect(mine).toEqual(expect.arrayContaining([
      expect.objectContaining({ budget_id: `mb_codes_${RUN}`, after: [`mb_first_${RUN}`] }),
      expect.objectContaining({ budget_id: `mb_ee_${RUN}`, after: [] }),
    ]));

    // Apply without a reviewed run is refused.
    await expect(migrate_budget_categories_orchestrator(ctx(), { dry_run: false })).rejects.toThrow();

    const applied = await migrate_budget_categories_orchestrator(ctx(), { dry_run: false, reviewed_run_id: dry.run_id });
    expect(await ids(`mb_codes_${RUN}`)).toEqual([`mb_first_${RUN}`]);
    expect(await ids(`mb_ee_${RUN}`)).toEqual([]);
    const snap = (await db.collection('_migration_snapshots').doc(dry.run_id).get()).data()!;
    expect(snap.budgets[`mb_codes_${RUN}`]).toEqual([`MB_A_${RUN}`]);
    expect(applied.applied).toBeGreaterThanOrEqual(2);

    // A re-run of the same reviewed apply (e.g. after a crash) is safe: nothing left to write,
    // the original undo snapshot is kept.
    const again = await migrate_budget_categories_orchestrator(ctx(), { dry_run: false, reviewed_run_id: dry.run_id });
    expect(again.applied).toBe(0);
    expect((await db.collection('_migration_snapshots').doc(dry.run_id).get()).data()!.budgets[`mb_codes_${RUN}`])
      .toEqual([`MB_A_${RUN}`]);

    // Data changed after a review → the stale review is refused.
    await db.collection('budgets').doc(`mb_ee_${RUN}`).update({ categoryIds: ['c'] });
    await expect(
      migrate_budget_categories_orchestrator(ctx(), { dry_run: false, reviewed_run_id: dry.run_id })
    ).rejects.toThrow(/changed since the dry run/);
  });
});
