/**
 * rules_repo CRUD — round-trip (emulator).
 *
 * create → list/get_active → update → delete, plus count + active-only filtering + priority order.
 */

import * as admin from 'firebase-admin';

const rid = (p: string) => `${p}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

let rules_repo: typeof import('../src/functions/repositories/rules.repo').rules_repo;
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Refusing to run: FIRESTORE_EMULATOR_HOST not set (dev==prod safety).');
  }
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ rules_repo } = require('../src/functions/repositories/rules.repo'));
});

const CTX = { trace_id: 't', span_id: 's' };
const mkFields = (over: Record<string, unknown> = {}) => ({
  name: 'Anthropic → Software',
  conditions: { op: 'AND' as const, conditions: [{ variable: 'merchant' as const, operator: 'contains' as const, value: 'anthropic' }] },
  actions: { assign_category: 'Software', ignore: true },
  priority: 100,
  is_active: true,
  ...over,
});

describe('rules_repo CRUD (emulator)', () => {
  it('creates, lists (priority order), filters active, updates, and deletes', async () => {
    const userId = rid('u');

    // Create two rules (out of priority order) + one inactive.
    const idB = await rules_repo.create_rule(CTX, userId, mkFields({ name: 'B', priority: 200 }));
    const idA = await rules_repo.create_rule(CTX, userId, mkFields({ name: 'A', priority: 100 }));
    const idInactive = await rules_repo.create_rule(CTX, userId, mkFields({ name: 'Off', priority: 50, is_active: false }));

    expect(await rules_repo.count_rules(CTX, userId)).toBe(3);

    // list_rules = ALL, priority ascending.
    const all = await rules_repo.list_rules(CTX, userId);
    expect(all.map((r) => r.id)).toEqual([idInactive, idA, idB]); // 50, 100, 200

    // get_active_rules = active only, priority ascending.
    const active = await rules_repo.get_active_rules(CTX, userId);
    expect(active.map((r) => r.id)).toEqual([idA, idB]);
    expect(active[0].actions.assign_category).toBe('Software'); // nested blob round-trips

    // update: deactivate B, change its category.
    await rules_repo.update_rule(CTX, idB, { is_active: false, actions: { assign_category: 'Cloud' } });
    const b = await rules_repo.get_rule(CTX, idB);
    expect(b!.is_active).toBe(false);
    expect(b!.actions.assign_category).toBe('Cloud');
    expect((await rules_repo.get_active_rules(CTX, userId)).map((r) => r.id)).toEqual([idA]);

    // delete A.
    await rules_repo.delete_rule(CTX, idA);
    expect(await rules_repo.get_rule(CTX, idA)).toBeNull();
    expect(await rules_repo.count_rules(CTX, userId)).toBe(2);
  });
});
