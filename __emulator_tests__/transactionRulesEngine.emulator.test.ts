/**
 * Transaction Rules Engine — ingest wiring (emulator).
 *
 * Proves the Rules Engine is wired into the live Plaid sync path correctly:
 *   1. CREATE — a newly-synced transaction matching a rule gets the rule's field-set actions applied
 *      (category / ignore / income + rule-id tracking).
 *   2. FIRST-WRITE-ONLY — a re-synced EXISTING transaction (update branch) does NOT get rules applied,
 *      even if a matching rule now exists (honors future-only retroactivity).
 *   3. NO RULES — a user with no rules gets an unmodified transaction (the on_create=undefined path).
 *
 * Drives the real `sync_transactions_orchestrator` with Plaid mocked (same pattern as the
 * pending→posted inheritance test).
 */

import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

const mockSync = jest.fn();
jest.mock('../src/functions/integrations/plaid', () => {
  const actual = jest.requireActual('../src/functions/integrations/plaid');
  return { ...actual, sync_transactions: (...args: unknown[]) => mockSync(...args) };
});
jest.mock('../src/utils/encryption', () => {
  const actual = jest.requireActual('../src/utils/encryption');
  return { ...actual, decryptAccessToken: () => 'decrypted-token' };
});

const rid = (p: string) => `${p}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

let db: FirebaseFirestore.Firestore;
let sync_transactions_orchestrator: (ctx: unknown) => Promise<unknown>;
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Refusing to run: FIRESTORE_EMULATOR_HOST not set (dev==prod safety).');
  }
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  db = admin.firestore();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ sync_transactions_orchestrator } = require('../src/functions/orchestrators/plaid/sync_transactions.orchestrator'));
});

/* eslint-disable @typescript-eslint/naming-convention */

/** Seed the plaid_item + user + account the sync resolver needs. Returns the ids. */
async function seed_context() {
  const userId = rid('u');
  const itemDocId = rid('itemdoc');
  const plaidItemId = rid('plaiditem');
  const accountId = rid('acct');
  await db.collection('plaid_items').doc(itemDocId).set({
    id: itemDocId, plaidItemId, userId, groupIds: [],
    accessToken: 'enc', cursor: null, isActive: true,
    institutionId: 'ins_1', institutionName: 'Test Bank',
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
  await db.collection('users').doc(userId).set({ id: userId, currency: 'USD' });
  await db.collection('accounts').doc(accountId).set({
    id: accountId, accountId, itemId: plaidItemId, userId, ownerId: userId,
    isActive: true, isHidden: false, currentBalance: 0,
  });
  return { userId, itemDocId, plaidItemId, accountId };
}

/** A Plaid "added" transaction payload. */
function plaid_txn(accountId: string, txnId: string, over: Record<string, unknown> = {}) {
  return {
    transaction_id: txnId,
    pending_transaction_id: null,
    account_id: accountId,
    amount: 42.5,
    iso_currency_code: 'USD',
    unofficial_currency_code: null,
    name: 'ANTHROPIC* CLAUDE',
    merchant_name: 'Anthropic',
    date: '2026-09-15',
    authorized_date: '2026-09-14',
    pending: false,
    payment_channel: 'online',
    personal_finance_category: { primary: 'GENERAL_SERVICES', detailed: 'GENERAL_SERVICES_OTHER' },
    category: ['Service'],
    category_id: '10000000',
    ...over,
  };
}

function run_sync(itemDocId: string, userId: string, plaidItemId: string) {
  return sync_transactions_orchestrator({
    trace_id: rid('t'), span_id: rid('s'),
    input: { item_id: itemDocId, user_id: userId, plaid_item_id: plaidItemId },
    user_id: userId,
    idempotency_key: rid('idem'),
  } as unknown);
}

describe('Transaction Rules Engine — ingest wiring (emulator)', () => {
  it('CREATE: a new txn matching a rule gets the rule applied (category + ignore + income + rule id)', async () => {
    const { userId, itemDocId, plaidItemId, accountId } = await seed_context();
    const ruleId = rid('rule');
    const txnId = rid('tx');

    await db.collection('rules').doc(ruleId).set({
      userId, isActive: true, priority: 100, name: 'Anthropic → Software',
      conditions: { op: 'AND', conditions: [{ variable: 'merchant', operator: 'contains', value: 'anthropic' }] },
      actions: {
        assign_budget_id: 'budget_abc', assign_category: 'Software',
        ignore: true, mark_income: true, require_review: true,
      },
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });

    mockSync.mockResolvedValue({
      added: [plaid_txn(accountId, txnId)],
      modified: [], removed: [], has_more: false, next_cursor: 'c1',
    });

    await run_sync(itemDocId, userId, plaidItemId);

    const doc = (await db.collection('transactions').doc(`plaid_${txnId}`).get()).data();
    expect(doc).toBeDefined();
    expect(doc!.type).toBe('income'); // mark_income
    expect(doc!.internalPrimaryCategory).toBe('Software'); // assign_category
    expect(doc!.needsReview).toBe(true); // require_review
    expect(doc!.splits[0].budgetId).toBe('budget_abc'); // assign_budget_id
    expect(doc!.splits[0].budgetAssignmentSource).toBe('manual'); // durable pin the engine preserves
    expect(doc!.splits[0].isIgnored).toBe(true); // ignore
    expect(doc!.splits[0].internalPrimaryCategory).toBe('Software');
    expect(doc!.splits[0].rules).toContain(ruleId); // tracked in split.rules[]
  });

  it('FIRST-WRITE-ONLY: re-syncing an EXISTING txn does NOT apply a now-matching rule', async () => {
    const { userId, itemDocId, plaidItemId, accountId } = await seed_context();
    const ruleId = rid('rule');
    const txnId = rid('tx');

    // The txn already exists (created on a PRIOR sync, before the rule) — plain expense, no rule effects.
    await db.collection('transactions').doc(`plaid_${txnId}`).set({
      id: `plaid_${txnId}`, transactionId: txnId,
      userId, ownerId: userId, groupIds: [], plaidItemId, accountId,
      name: 'ANTHROPIC* CLAUDE', merchantName: 'Anthropic',
      amount: 42.5, currency: 'USD', isPending: false, isActive: true, isDeleted: false,
      transactionDate: Timestamp.now(), type: 'expense', source: 'plaid',
      splits: [{
        splitId: 'sp1', amount: 42.5, budgetId: 'unassigned', isDefault: true,
        isIgnored: false, isRefund: false, internalPrimaryCategory: null,
        rules: [], tags: [],
      }],
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });

    // A rule that WOULD match — created after the txn existed.
    await db.collection('rules').doc(ruleId).set({
      userId, isActive: true, priority: 100, name: 'Anthropic → income',
      conditions: { op: 'AND', conditions: [{ variable: 'merchant', operator: 'contains', value: 'anthropic' }] },
      actions: { mark_income: true, ignore: true },
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });

    // Plaid re-sends the same txn (→ update branch, since it already exists).
    mockSync.mockResolvedValue({
      added: [plaid_txn(accountId, txnId)],
      modified: [], removed: [], has_more: false, next_cursor: 'c1',
    });

    await run_sync(itemDocId, userId, plaidItemId);

    const doc = (await db.collection('transactions').doc(`plaid_${txnId}`).get()).data();
    expect(doc).toBeDefined();
    // Rule must NOT have been applied on the update path (future-only retroactivity).
    expect(doc!.type).not.toBe('income');
    expect(doc!.splits[0].rules ?? []).not.toContain(ruleId);
  });

  it('NO RULES: a user with no rules gets an unmodified transaction', async () => {
    const { userId, itemDocId, plaidItemId, accountId } = await seed_context();
    const txnId = rid('tx');

    mockSync.mockResolvedValue({
      added: [plaid_txn(accountId, txnId)],
      modified: [], removed: [], has_more: false, next_cursor: 'c1',
    });

    await run_sync(itemDocId, userId, plaidItemId);

    const doc = (await db.collection('transactions').doc(`plaid_${txnId}`).get()).data();
    expect(doc).toBeDefined();
    expect(doc!.type).toBe('expense'); // untouched
    expect(doc!.splits[0].isIgnored).toBe(false);
    expect(doc!.splits[0].rules ?? []).toEqual([]);
  });
});
