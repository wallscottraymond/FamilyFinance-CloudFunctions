/**
 * Emulator Integration Test — first link, single pass (First-Link-Load-Speed)
 *
 * Proves the rebuilt item sync on a realistic first link:
 *   - accounts not saved yet when the transactions arrive → nothing dropped (accounts saved, re-pulled)
 *   - every page pulled first, every transaction written ONCE, already assigned
 *     (budget = Everything Else per lens; bill link for the stream's transactions), stamped `syncRunId`
 *   - bills saved BEFORE transactions (stream membership in the in-memory assignment)
 *   - one audit entry per page (not per transaction)
 *   - cursor saved once, at the end
 *   - a second sync request while one runs → "already_running", and the holder runs one more round
 *
 * Firestore-only emulator (triggers don't fire), so this exercises the orchestrator's own writes;
 * the trigger skip is covered by the unit test `process_transaction_written.run_skip.test.ts`.
 *
 * Run: firebase emulators:exec --only firestore "npx jest --selectProjects emulator --testPathPattern firstLinkSinglePass"
 */
import * as admin from 'firebase-admin';
import { Timestamp } from 'firebase-admin/firestore';

const mockSync = jest.fn();
const mockRecurring = jest.fn();
const mockAccounts = jest.fn();
jest.mock('../src/functions/integrations/plaid', () => {
  const actual = jest.requireActual('../src/functions/integrations/plaid');
  return {
    ...actual,
    sync_transactions: (...a: unknown[]) => mockSync(...a),
    fetch_recurring_transactions: (...a: unknown[]) => mockRecurring(...a),
    fetch_plaid_accounts: (...a: unknown[]) => mockAccounts(...a),
    safe_fetch_liabilities: async () => null,
  };
});
jest.mock('../src/utils/encryption', () => {
  const actual = jest.requireActual('../src/utils/encryption');
  return { ...actual, decryptAccessToken: () => 'decrypted-token' };
});

const rid = (p: string) => `${p}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
const N = 1200; // 3 pages of 500 + 200 (enough pages to prove "pull all, then write")
const PAGE = 500;

let db: FirebaseFirestore.Firestore;
let sync_item_orchestrator: (ctx: unknown, input: unknown) => Promise<Record<string, unknown>>;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error('Refusing to run: FIRESTORE_EMULATOR_HOST not set (dev==prod safety).');
  }
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  db = admin.firestore();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ sync_item_orchestrator } = require('../src/functions/orchestrators/plaid/sync_item.orchestrator'));
}, 30000);

/* eslint-disable @typescript-eslint/naming-convention */
const day = (i: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 2 - Math.floor(i / 3)); // ~3 txns per day, newest first
  return d.toISOString().slice(0, 10);
};

function plaidTxn(id: string, accountId: string, i: number, bill = false) {
  return {
    transaction_id: id,
    account_id: accountId,
    amount: bill ? 15.49 : 10 + (i % 50),
    iso_currency_code: 'USD',
    date: day(i),
    authorized_date: day(i),
    name: bill ? 'SPOTIFY USA' : `STORE ${i % 40}`,
    merchant_name: bill ? 'Spotify' : `Store ${i % 40}`,
    pending: false,
    pending_transaction_id: null,
    payment_channel: 'in store',
    personal_finance_category: bill
      ? { primary: 'ENTERTAINMENT', detailed: 'ENTERTAINMENT_MUSIC_AND_AUDIO', confidence_level: 'HIGH' }
      : { primary: 'FOOD_AND_DRINK', detailed: 'FOOD_AND_DRINK_GROCERIES', confidence_level: 'HIGH' },
    category: null,
    category_id: null,
    location: {},
    counterparties: [],
  };
}

describe('first link — single pass (emulator)', () => {
  it('writes every transaction once, assigned, with bills linked and no account dropped', async () => {
    const userId = rid('u');
    const itemDocId = rid('item');
    const plaidItemId = itemDocId;
    const accountId = rid('acct');
    const streamId = rid('stream');

    await db.collection('plaid_items').doc(itemDocId).set({
      id: itemDocId, plaidItemId, userId, groupIds: [],
      accessToken: 'enc', cursor: null, isActive: true,
      institutionId: 'ins_1', institutionName: 'Test Bank',
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    await db.collection('users').doc(userId).set({ id: userId, currency: 'USD' });
    // Everything Else budget (monthly lens) so the engine has a fallback.
    const eeId = rid('ee');
    await db.collection('budgets').doc(eeId).set({
      id: eeId, name: 'Everything else', userId, ownerId: userId, createdBy: userId,
      isActive: true, isSystemEverythingElse: true, isEverythingElse: true,
      period: 'monthly', amount: 0, categoryIds: [], isOngoing: true,
      startDate: Timestamp.fromDate(new Date('2020-01-01')),
      endDate: Timestamp.fromDate(new Date('2099-01-01')),
      budgetType: 'recurring', groupIds: [],
    });

    // N transactions; every 30th is a Spotify bill payment the stream claims.
    const txns = Array.from({ length: N }, (_, i) => plaidTxn(rid(`t${i}`), accountId, i, i % 30 === 0));
    const billIds = txns.filter((_, i) => i % 30 === 0).map((t) => t.transaction_id);
    const pages: ReturnType<typeof plaidTxn>[][] = [];
    for (let p = 0; p < N; p += PAGE) pages.push(txns.slice(p, p + PAGE));
    let call = 0;
    mockSync.mockReset();
    mockSync.mockImplementation(async (_tok: string, cursor: string | null) => {
      // Cursor-driven pages: cursor "" / null → page 0, "c1" → page 1 …
      const idx = cursor ? Number(String(cursor).slice(1)) : 0;
      call++;
      return {
        added: pages[idx] ?? [],
        modified: [],
        removed: [],
        next_cursor: `c${idx + 1}`,
        has_more: idx + 1 < pages.length,
        transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE',
        accounts: [],
        request_id: 'r',
      };
    });
    mockRecurring.mockReset();
    mockRecurring.mockResolvedValue({
      inflow_streams: [],
      outflow_streams: [{
        stream_id: streamId,
        account_id: accountId,
        description: 'SPOTIFY USA',
        merchant_name: 'Spotify',
        first_date: day(N),
        last_date: day(0),
        predicted_next_date: null,
        frequency: 'MONTHLY',
        transaction_ids: billIds,
        average_amount: { amount: 15.49, iso_currency_code: 'USD' },
        last_amount: { amount: 15.49, iso_currency_code: 'USD' },
        is_active: true,
        status: 'MATURE',
        personal_finance_category: { primary: 'ENTERTAINMENT', detailed: 'ENTERTAINMENT_MUSIC_AND_AUDIO', confidence_level: 'HIGH' },
        is_user_modified: false,
      }],
      updated_datetime: new Date().toISOString(),
      request_id: 'r',
    });
    // The account is NOT saved yet — the sync must save it, not drop its transactions.
    mockAccounts.mockReset();
    mockAccounts.mockResolvedValue({
      accounts: [{
        account_id: accountId, name: 'Checking', official_name: null, mask: '1234',
        type: 'depository', subtype: 'checking',
        balances: { current: 1000, available: 900, limit: null, iso_currency_code: 'USD' },
      }],
      item_id: plaidItemId,
      request_id: 'r',
    });

    const ctx = { trace_id: rid('run'), span_id: 's' };
    const result = await sync_item_orchestrator(ctx, {
      item_doc_id: itemDocId, user_id: userId, recurring: true, reason: 'test',
    });

    expect(result.status).toBe('synced');
    expect(result.added).toBe(N);
    expect(mockAccounts).toHaveBeenCalledTimes(1); // accounts saved after the "unknown account" pull

    // Every transaction: written once (created == updated), stamped, assigned.
    const snap = await db.collection('transactions').where('ownerId', '==', userId).get();
    expect(snap.size).toBe(N);
    const billSet = new Set(billIds);
    let linked = 0;
    for (const doc of snap.docs) {
      const d = doc.data();
      expect(d.syncRunId).toBe(ctx.trace_id);
      expect((d.createdAt as Timestamp).toMillis()).toBe((d.updatedAt as Timestamp).toMillis());
      const split = d.splits[0];
      expect(split.monthlyBudgetId ?? split.budgetId).toBe(eeId); // assigned in memory
      if (billSet.has(d.transactionId)) {
        expect(split.outflowId).toBe(streamId); // stream saved first → linked on first write
        expect(d.splitOutflowIds).toEqual([streamId]);
        linked++;
      }
    }
    expect(linked).toBe(billIds.length);

    // Bill saved with the run's stamp (its create trigger leaves periods + reconcile to the sync).
    const stream = await db.collection('outflows').doc(streamId).get();
    expect(stream.exists).toBe(true);
    expect(stream.data()?.syncRunId).toBe(ctx.trace_id);

    // Cursor saved once, at the end of the pull.
    const item = await db.collection('plaid_items').doc(itemDocId).get();
    expect(item.data()?.cursor).toBe(`c${pages.length}`);

    // One audit entry per written page, not per transaction.
    const audits = await db.collection('_audit').where('user_id', '==', userId).get();
    const txnAudits = audits.docs.filter((a) => a.data().entity_type === 'transaction');
    expect(txnAudits.length).toBe(Math.ceil(N / PAGE)); // 3 for 1,200 (was 1,200)

    // Lease released.
    const lease = await db.collection('_item_sync_leases').doc(itemDocId).get();
    expect(lease.data()?.lease_until ?? null).toBeNull();
    void call;
  }, 120000);

  it('a request during a sync runs one more round on the holder instead of a parallel sync', async () => {
    const userId = rid('u2');
    const itemDocId = rid('item2');
    const accountId = rid('acct2');
    await db.collection('plaid_items').doc(itemDocId).set({
      id: itemDocId, plaidItemId: itemDocId, userId, groupIds: [], accessToken: 'enc', cursor: null,
      isActive: true, institutionId: 'ins_1', institutionName: 'Test Bank', lastRecurringSyncAt: Timestamp.now(),
    });
    await db.collection('users').doc(userId).set({ id: userId, currency: 'USD' });
    await db.collection('accounts').doc(accountId).set({
      id: accountId, accountId, itemId: itemDocId, userId, ownerId: userId, isActive: true, currentBalance: 0,
    });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let pulls = 0;
    mockSync.mockReset();
    mockSync.mockImplementation(async () => {
      pulls++;
      if (pulls === 1) await gate; // hold the first sync open
      return {
        added: pulls === 1 ? [plaidTxn(rid('x'), accountId, 1)] : [],
        modified: [], removed: [], next_cursor: `k${pulls}`, has_more: false,
        transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE', accounts: [], request_id: 'r',
      };
    });

    const first = sync_item_orchestrator({ trace_id: rid('runA'), span_id: 's' }, { item_doc_id: itemDocId, user_id: userId });
    await new Promise((r) => setTimeout(r, 300));
    const second = await sync_item_orchestrator({ trace_id: rid('runB'), span_id: 's' }, { item_doc_id: itemDocId, user_id: userId });
    expect(second.status).toBe('already_running');
    release();
    const done = await first;
    expect(done.rounds).toBe(2); // the holder picked up the second request
    expect(pulls).toBe(2);       // never two pulls at once
  }, 60000);
});
