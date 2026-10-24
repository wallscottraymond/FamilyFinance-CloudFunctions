/**
 * Emulator — a bill made in the app starts mid-month (on a payment's date): its FIRST month still
 * gets a period doc, so the first payment's bill tile opens (was "Bill not found": generation took
 * only periods STARTING on/after the first date). Plaid bills keep the old window.
 *
 * Run: firebase emulators:exec --only firestore --project demo-convert \
 *        "npx jest --selectProjects emulator --testPathPattern convertFirstPeriod"
 */
import * as admin from 'firebase-admin';
import { FAKE_CLOCK, makeHarness, plaidTxn, seedMonths } from './helpers/captureHarness';
import { NOW_MS } from './helpers/captureScenario';

const mockSync = jest.fn();
const mockRecurring = jest.fn();
jest.mock('../src/functions/integrations/plaid', () => {
  const actual = jest.requireActual('../src/functions/integrations/plaid');
  return {
    ...actual,
    sync_transactions: (...a: unknown[]) => mockSync(...a),
    fetch_recurring_transactions: (...a: unknown[]) => mockRecurring(...a),
    fetch_plaid_accounts: async () => ({ accounts: [], item_id: 'x', request_id: 'r' }),
    safe_fetch_liabilities: async () => null,
  };
});
jest.mock('../src/utils/encryption', () => {
  const actual = jest.requireActual('../src/utils/encryption');
  return { ...actual, decryptAccessToken: () => 'decrypted-token' };
});

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */
let db: FirebaseFirestore.Firestore;
let convert: any;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('emulator only (dev==prod)');
  jest.useFakeTimers(FAKE_CLOCK);
  if (!admin.apps.length) admin.initializeApp({ projectId: 'family-budget-app-cb59b' });
  require('../src/functions/orchestrators/plaid/sync_item.orchestrator');
  ({ convert_transaction_to_recurring_orchestrator: convert } = require('../src/functions/orchestrators/recurring/convert_transaction_to_recurring.orchestrator'));
  db = admin.firestore();
  await seedMonths(db);
}, 60000);
afterAll(() => jest.useRealTimers());
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-explicit-any */

const mocks = { mockSync, mockRecurring };
const DAY = 86400000;
const ctx = (n = 't') => ({ trace_id: `${n}_${Math.random()}`, span_id: 's' });
const settle = () => new Promise((r) => setTimeout(r, 300));
/** Days before the fake "today" (2037-10-15) of a calendar date. */
const ago = (y: number, m: number, d: number) => Math.round((Date.UTC(2037, 9, 15) - Date.UTC(y, m - 1, d)) / DAY);
const landlord = (ids: Parameters<typeof plaidTxn>[0], key: string, days_ago: number, amount = 1500, o: Record<string, unknown> = {}) => ({
  ...plaidTxn(ids, { key, account: 'chk', amount, days_ago, name: 'LANDLORD LLC', merchant: 'Landlord LLC',
    primary: 'RENT_AND_UTILITIES', detailed: 'RENT_AND_UTILITIES_RENT' }),
  ...o,
});
const RENT = { name: 'Rent', amount: 1500, frequency: 'monthly', next_due_date: '2037-11-03', link_past: true };
const doc_of = (h: { ids: { txn: (k: string) => string } }, key: string) => `plaid_${h.ids.txn(key)}`;

async function rent_user(tag: string, flag = true) {
  const h = await makeHarness(db, tag, mocks, { flag });
  await h.sync('link');
  h.postTxns([
    landlord(h.ids, 'r_oct', ago(2037, 10, 3)), landlord(h.ids, 'r_sep', ago(2037, 9, 3)), landlord(h.ids, 'r_aug', ago(2037, 8, 3)),
    landlord(h.ids, 'r_jul', ago(2037, 7, 3)), landlord(h.ids, 'r_jun', ago(2037, 6, 3)),
    landlord(h.ids, 'r_noise', ago(2037, 8, 20), 40), // not near an occurrence: stays a normal transaction
  ]);
  await h.sync('rent');
  return h;
}

describe('first period of an app-made bill (emulator)', () => {
  const period_ids = async (id: string) =>
    (await db.collection('outflow_periods').where('outflowId', '==', id).get()).docs.map((d) => d.id).sort();

  it('no past payments linked: the source payment month (first date Oct 3, month starts Oct 1) has a period', async () => {
    const h = await rent_user('qfp1');
    const r = await convert(ctx(), h.ids.userId, { transaction_id: doc_of(h, 'r_oct'), ...RENT, link_past: false }, NOW_MS);
    await settle();
    const bill = (await db.collection('outflows').doc(r.id).get()).data()!;
    expect(bill.firstDate.toDate().toISOString().slice(0, 10)).toBe('2037-10-03');
    const ids = await period_ids(r.id);
    expect(ids).toContain(`${r.id}_2037M10`);
    expect(ids).not.toContain(`${r.id}_2037M09`); // nothing before the month the first date is in
    // and the month's occurrence is the paid source payment
    const p = (await db.collection('outflow_periods').doc(`${r.id}_2037M10`).get()).data()!;
    expect(p.isActive).toBe(true);
  });

  it('past payments linked: the earliest linked payment month (Jun 3) has a period too', async () => {
    const h = await rent_user('qfp2');
    const r = await convert(ctx(), h.ids.userId, { transaction_id: doc_of(h, 'r_oct'), ...RENT }, NOW_MS);
    await settle();
    expect(r.linked_past_count).toBe(4);
    const ids = await period_ids(r.id);
    for (const m of ['06', '07', '08', '09', '10', '11']) expect(ids).toContain(`${r.id}_2037M${m}`);
    expect(ids).not.toContain(`${r.id}_2037M05`);
  });

  it('a Plaid bill keeps the old window: no period that starts before its first date', async () => {
    const { get_generation_source_periods } = require('../src/functions/resolvers/periods/generation_source_periods.resolver');
    const first = new Date(Date.UTC(2037, 9, 3));
    const end = new Date(Date.UTC(2037, 11, 31));
    const plaid = await get_generation_source_periods(ctx(), first, end, { source: 'plaid', explicit_start: false });
    const manual = await get_generation_source_periods(ctx(), first, end, { source: 'manual', explicit_start: false });
    const explicit = await get_generation_source_periods(ctx(), first, end, { source: 'manual', explicit_start: true });
    const ids = (ps: Array<{ id: string }>) => ps.map((p) => p.id).filter((x) => x.startsWith('2037M')).sort();
    expect(ids(plaid)).toEqual(['2037M11', '2037M12']);
    expect(ids(manual)).toEqual(['2037M10', '2037M11', '2037M12']);
    expect(ids(explicit)).toEqual(['2037M11', '2037M12']);
  });
});
