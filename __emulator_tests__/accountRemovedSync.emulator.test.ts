/**
 * Transactions for a removed account (Code-Health-Review P1-H2 / P2-M4, P1-H3).
 *
 * Removing ONE account keeps its bank connection syncing. The sync used to DROP that account's
 * added/modified transactions while the cursor moved past them, so restoring the account lost
 * everything that arrived in between (P1-H2). It now stores them hidden (`hiddenReason:
 * "account_removed"`, not deleted), so restore brings them back. And restore must not revive a
 * transaction Plaid deleted while the account was hidden, e.g. a pending that posted (P1-H3).
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

const mockSync = jest.fn();
const mockAccounts = jest.fn();
jest.mock("../src/functions/integrations/plaid", () => {
  const actual = jest.requireActual("../src/functions/integrations/plaid");
  return {
    ...actual,
    sync_transactions: (...a: unknown[]) => mockSync(...a),
    fetch_recurring_transactions: async () => ({
      inflow_streams: [], outflow_streams: [], updated_datetime: new Date().toISOString(), request_id: "r",
    }),
    fetch_plaid_accounts: (...a: unknown[]) => mockAccounts(...a),
    safe_fetch_liabilities: async () => null,
  };
});
jest.mock("../src/utils/encryption", () => {
  const actual = jest.requireActual("../src/utils/encryption");
  return { ...actual, decryptAccessToken: () => "decrypted-token" };
});

const rid = (p: string) => `${p}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
let db: FirebaseFirestore.Firestore;
let sync_item_orchestrator: (ctx: unknown, input: unknown) => Promise<Record<string, unknown>>;
let restore_account_transactions_orchestrator: (ctx: unknown, input: unknown) => Promise<unknown>;
let restore_account_orchestrator: (ctx: unknown, user_id: string, input: unknown) => Promise<unknown>;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("emulator only (dev==prod)");
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  db = admin.firestore();
  /* eslint-disable @typescript-eslint/no-var-requires */
  ({ sync_item_orchestrator } = require("../src/functions/orchestrators/plaid/sync_item.orchestrator"));
  ({ restore_account_transactions_orchestrator } =
    require("../src/functions/orchestrators/accounts/restore_account_transactions.orchestrator"));
  ({ restore_account_orchestrator } =
    require("../src/functions/orchestrators/accounts/restore_account.orchestrator"));
  /* eslint-enable @typescript-eslint/no-var-requires */
}, 30000);

/* eslint-disable @typescript-eslint/naming-convention */
const day = (n: number) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
const plaidTxn = (id: string, account_id: string, over: Record<string, unknown> = {}) => ({
  transaction_id: id, account_id, amount: 12.5, iso_currency_code: "USD",
  date: day(3), authorized_date: day(3), name: "STORE", merchant_name: "Store",
  pending: false, pending_transaction_id: null, payment_channel: "in store",
  personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES", confidence_level: "HIGH" },
  category: null, category_id: null, location: {}, counterparties: [],
  ...over,
});

async function seed() {
  const userId = rid("u");
  const itemDocId = rid("item");
  const active = rid("acctA");
  const removed = rid("acctR");
  await db.collection("plaid_items").doc(itemDocId).set({
    id: itemDocId, plaidItemId: itemDocId, userId, groupIds: [], accessToken: "enc", cursor: null,
    isActive: true, institutionId: "ins_1", institutionName: "Test Bank",
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
  await db.collection("users").doc(userId).set({ id: userId, currency: "USD" });
  const docIds: Record<string, string> = {};
  for (const [accountId, isActive] of [[active, true], [removed, false]] as const) {
    const id = rid("acctdoc");
    docIds[accountId] = id;
    await db.collection("accounts").doc(id).set({
      id, userId, groupIds: [], accountId, plaidAccountId: accountId, itemId: itemDocId,
      name: "Checking", accountType: "depository", currentBalance: 100,
      isActive, isDeleted: !isActive, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
  }
  mockAccounts.mockReset();
  mockAccounts.mockResolvedValue({
    accounts: [active, removed].map((account_id) => ({
      account_id, name: "Checking", official_name: null, mask: "1234", type: "depository", subtype: "checking",
      balances: { current: 100, available: 100, limit: null, iso_currency_code: "USD" },
    })),
    item_id: itemDocId, request_id: "r",
  });
  return { userId, itemDocId, active, removed, removedDocId: docIds[removed] };
}

/** Each sync() call returns the next page script: one pull per call. */
function scriptPulls(pulls: Array<{ added?: unknown[]; modified?: unknown[]; removed?: unknown[] }>) {
  let n = 0;
  mockSync.mockReset();
  mockSync.mockImplementation(async () => {
    const p = pulls[Math.min(n, pulls.length - 1)];
    n++;
    return {
      added: p.added ?? [], modified: p.modified ?? [], removed: p.removed ?? [],
      next_cursor: `c${n}`, has_more: false,
      transactions_update_status: "HISTORICAL_UPDATE_COMPLETE", accounts: [], request_id: "r",
    };
  });
}

const txn = async (plaidId: string) => (await db.collection("transactions").doc(`plaid_${plaidId}`).get()).data();
const runSync = (s: { itemDocId: string; userId: string }) =>
  sync_item_orchestrator({ trace_id: rid("run"), span_id: "s" }, {
    item_doc_id: s.itemDocId, user_id: s.userId, recurring: false, reason: "test",
  });
/** Like restore_account: the account doc is reactivated first, then the transaction job runs. */
const restore = async (s: { userId: string; removed: string; removedDocId: string }) => {
  await db.collection("accounts").doc(s.removedDocId).update({ isActive: true, isDeleted: false });
  return restore_account_transactions_orchestrator({ trace_id: rid("r"), span_id: "s" }, {
    plaid_account_id: s.removed, user_id: s.userId, trace_id: "t",
  });
};

describe("sync while an account is removed (emulator)", () => {
  it("stores the removed account's new transactions hidden (not dropped, not deleted)", async () => {
    const s = await seed();
    const a = rid("ta"), r = rid("tr");
    scriptPulls([{ added: [plaidTxn(a, s.active), plaidTxn(r, s.removed)] }]);
    await runSync(s);
    const onActive = await txn(a);
    expect(onActive?.isActive).toBe(true);
    const onRemoved = await txn(r);
    expect(onRemoved).toBeDefined();
    expect(onRemoved?.isActive).toBe(false);
    expect(onRemoved?.isHidden).toBe(true);
    expect(onRemoved?.hiddenReason).toBe("account_removed");
    expect(onRemoved?.isDeleted).toBe(false);
  });

  it("restore brings back what arrived while the account was removed (P1-H2)", async () => {
    const s = await seed();
    const r = rid("tr");
    scriptPulls([{ added: [plaidTxn(r, s.removed)] }]);
    await runSync(s);
    await restore(s);
    const t = await txn(r);
    expect(t?.isActive).toBe(true);
    expect(t?.isHidden).toBe(false);
  });

  it("a Plaid update to a hidden transaction keeps it hidden", async () => {
    const s = await seed();
    const r = rid("tr");
    scriptPulls([{ added: [plaidTxn(r, s.removed)] }, { modified: [plaidTxn(r, s.removed, { amount: 20 })] }]);
    await runSync(s);
    await runSync(s);
    const t = await txn(r);
    expect(t?.amount).toBe(20);
    expect(t?.isActive).toBe(false);
    expect(t?.hiddenReason).toBe("account_removed");
  });

  it("restore doesn't revive a transaction Plaid deleted while hidden: pending → posted (P1-H3)", async () => {
    const s = await seed();
    const pend = rid("pend"), post = rid("post");
    scriptPulls([
      { added: [plaidTxn(pend, s.removed, { pending: true })] },
      { added: [plaidTxn(post, s.removed, { pending_transaction_id: pend })], removed: [{ transaction_id: pend, account_id: s.removed }] },
    ]);
    await runSync(s);
    await runSync(s);
    await restore(s);
    const p = await txn(pend);
    expect(p?.isActive).toBe(false); // Plaid deleted it: stays gone
    const posted = await txn(post);
    expect(posted?.isActive).toBe(true); // the posted copy comes back
  });

  it("CONTROL: the active account's transactions are unaffected by the removed one", async () => {
    const s = await seed();
    const a = rid("ta");
    scriptPulls([{ added: [plaidTxn(a, s.active)] }]);
    await runSync(s);
    await restore(s);
    expect((await txn(a))?.isActive).toBe(true);
    expect((await txn(a))?.isHidden).toBeUndefined();
  });

  // Code-Health-Review P1-M4: removing the LAST account flags the bank connection for removal if
  // Plaid's itemRemove fails; the 4-hourly retry then disconnects it. Restoring the account means
  // the connection is wanted again, so restore must clear the flag.
  it("restoring an account clears its bank connection's removalPending flag (P1-M4)", async () => {
    const s = await seed();
    await db.collection("plaid_items").doc(s.itemDocId).update({ removalPending: true });
    await restore_account_orchestrator({ trace_id: rid("ra"), span_id: "s" }, s.userId, {
      account_id: s.removedDocId, idempotency_key: rid("idem"),
      restore_transactions: false, restore_recurring: false,
    });
    const item = (await db.collection("plaid_items").doc(s.itemDocId).get()).data();
    expect(item?.removalPending).toBe(false);
    const account = (await db.collection("accounts").doc(s.removedDocId).get()).data();
    expect(account?.isActive).toBe(true);
  });
});

