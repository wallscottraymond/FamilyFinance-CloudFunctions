/**
 * Plaid "modified" sync preserves user edits (emulator) — Plaid-Modified-Sync-Preserves-Edits.
 *
 * Drives the REAL sync orchestrator (Plaid mocked) against an existing transaction carrying every
 * kind of user edit, then checks each edit survives while Plaid's fields refresh. Covers both
 * paths that reach the repository's update branch: Plaid's "modified" array and a re-sent "added".
 *
 * (Harness copied from the Rules Engine ingest test.)
 */
/* Original harness header:
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


/** An existing transaction with user edits on it (the shape the app + engine write). */
async function seed_edited_txn(userId: string, plaidItemId: string, accountId: string, txnId: string) {
  await db.collection('transactions').doc(`plaid_${txnId}`).set({
    id: `plaid_${txnId}`, transactionId: txnId,
    userId, ownerId: userId, groupIds: ['g1'], plaidItemId, accountId,
    name: 'ANTHROPIC* CLAUDE', description: 'Claude subscription (work)', merchantName: 'Anthropic',
    amount: 40, currency: 'USD', isPending: false, isActive: true, isDeleted: false,
    transactionDate: Timestamp.fromDate(new Date('2026-09-15T00:00:00Z')), type: 'expense', source: 'plaid',
    tagIds: ['tag-work'], needsReview: false, needsNote: false, userNotes: 'expense it', isHidden: false,
    splits: [
      {
        splitId: 'sp-user', amount: 25, isDefault: false, description: 'work part',
        budgetId: 'budget_work', budgetAssignmentSource: 'manual',
        spendStatus: 'refund', isIgnored: false, isRefund: true, isTaxDeductible: true,
        internalPrimaryCategory: 'GENERAL_SERVICES', internalDetailedCategory: 'GENERAL_SERVICES_OTHER',
        categorySource: 'user', tags: ['tag-work'], rules: [],
      },
      {
        splitId: 'sp-default', amount: 15, isDefault: true, budgetId: 'budget_ee',
        spendStatus: 'ignored', isIgnored: true, isRefund: false, isTaxDeductible: false,
        internalPrimaryCategory: 'GENERAL_SERVICES', internalDetailedCategory: 'GENERAL_SERVICES_OTHER',
        tags: [], rules: [],
      },
    ],
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
}

function expect_edits_kept(doc: FirebaseFirestore.DocumentData) {
  const splits = doc.splits as Array<Record<string, unknown>>;
  expect(splits.map((s) => s.splitId)).toEqual(['sp-user', 'sp-default']);
  const user = splits[0];
  const dflt = splits[1];
  expect(user).toMatchObject({
    amount: 25, description: 'work part', budgetAssignmentSource: 'manual',
    spendStatus: 'refund', isRefund: true, isTaxDeductible: true,
    categorySource: 'user', internalDetailedCategory: 'GENERAL_SERVICES_OTHER', tags: ['tag-work'],
  });
  expect(dflt).toMatchObject({ spendStatus: 'ignored', isIgnored: true });
  expect(doc.tagIds).toEqual(['tag-work']);
  expect(doc.needsReview).toBe(false);
  expect(doc.description).toBe('Claude subscription (work)');
  expect(doc.userNotes).toBe('expense it');
  expect(doc.groupIds).toEqual(['g1']);
}

describe('Plaid "modified" sync preserves user edits (emulator)', () => {
  it('MODIFIED: keeps every user edit; refreshes Plaid fields; default split absorbs the new amount', async () => {
    const { userId, itemDocId, plaidItemId, accountId } = await seed_context();
    const txnId = rid('tx');
    await seed_edited_txn(userId, plaidItemId, accountId, txnId);

    mockSync.mockResolvedValue({
      added: [], removed: [], has_more: false, next_cursor: 'c1',
      modified: [plaid_txn(accountId, txnId, { amount: 46, merchant_name: 'Anthropic PBC', date: '2026-09-16' })],
    });
    await run_sync(itemDocId, userId, plaidItemId);

    const doc = (await db.collection('transactions').doc(`plaid_${txnId}`).get()).data()!;
    expect_edits_kept(doc);
    expect(doc.merchantName).toBe('Anthropic PBC');
    expect(doc.vendorKey).toBe('anthropic pbc');
    expect((doc.transactionDate as Timestamp).toDate().toISOString().slice(0, 10)).toBe('2026-09-16');
    expect(doc.splits[1].amount).toBe(21); // 15 + 6
    expect(doc.splits[0].amount + doc.splits[1].amount).toBeCloseTo(doc.amount);
    expect(doc.totalAllocated).toBe(46);
  });

  it('RE-SENT ADDED: an existing txn re-sent in "added" also keeps every edit', async () => {
    const { userId, itemDocId, plaidItemId, accountId } = await seed_context();
    const txnId = rid('tx');
    await seed_edited_txn(userId, plaidItemId, accountId, txnId);

    mockSync.mockResolvedValue({
      added: [plaid_txn(accountId, txnId, { amount: 40 })],
      modified: [], removed: [], has_more: false, next_cursor: 'c1',
    });
    await run_sync(itemDocId, userId, plaidItemId);

    const doc = (await db.collection('transactions').doc(`plaid_${txnId}`).get()).data()!;
    expect_edits_kept(doc);
    expect(doc.splits[1].amount).toBe(15); // unchanged amount → splits untouched
  });

  it('NEW txn: still created normally from Plaid (merge only applies to existing docs)', async () => {
    const { userId, itemDocId, plaidItemId, accountId } = await seed_context();
    const txnId = rid('tx');
    mockSync.mockResolvedValue({
      added: [plaid_txn(accountId, txnId)], modified: [], removed: [], has_more: false, next_cursor: 'c1',
    });
    await run_sync(itemDocId, userId, plaidItemId);
    const doc = (await db.collection('transactions').doc(`plaid_${txnId}`).get()).data()!;
    expect(doc.amount).toBe(42.5);
    expect(doc.splits).toHaveLength(1);
  });
});
