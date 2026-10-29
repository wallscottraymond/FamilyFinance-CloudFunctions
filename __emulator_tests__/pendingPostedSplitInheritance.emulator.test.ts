/**
 * Emulator Integration Test — pending→posted split inheritance
 *
 * Proves the fix: when a user has applied splits (budget + recurring-bill link) to a
 * PENDING transaction and Plaid later posts it (a new posted txn with
 * `pending_transaction_id`, plus the pending in `removed`), the sync now OVERLAYS the
 * pending's splits onto the posted txn — so the assignment + bill link survive the
 * resync — and soft-deletes the pending.
 *
 * Firestore-only emulator (no functions emulator → the assignment-engine trigger does
 * NOT fire), so we assert the SYNC persists the posted doc WITH the inherited splits.
 *
 * Prereqs: firebase emulators:exec --only firestore "npx jest --selectProjects emulator --testPathPattern pendingPostedSplitInheritance"
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

// Mock the Plaid API call + token decryption. Hoisted above the require() below.
const mockSync = jest.fn();
jest.mock("../src/functions/integrations/plaid", () => {
  const actual = jest.requireActual("../src/functions/integrations/plaid");
  return { ...actual, sync_transactions: (...args: unknown[]) => mockSync(...args) };
});
jest.mock("../src/utils/encryption", () => {
  const actual = jest.requireActual("../src/utils/encryption");
  return { ...actual, decryptAccessToken: () => "decrypted-token" };
});

const rid = (p: string) => `${p}_${Date.now()}_${Math.floor(Math.random() * 1e6)}`;

// Initialize admin (emulator) BEFORE requiring the orchestrator — its import chain
// touches src/utils/firestore (which reads admin.firestore() at load).
let db: FirebaseFirestore.Firestore;
let sync_transactions_orchestrator: (ctx: unknown) => Promise<unknown>;
beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Refusing to run: FIRESTORE_EMULATOR_HOST not set (dev==prod safety).");
  }
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  db = admin.firestore();
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  ({ sync_transactions_orchestrator } = require("../src/functions/orchestrators/plaid/sync_transactions.orchestrator"));
});


/** A real budget doc the engine can see (a manual pin is only honored while its budget exists). */
async function seed_budget(userId: string, id: string, name = id) {
  await db.collection("budgets").doc(id).set({
    id, name, userId, ownerId: userId, createdBy: userId, isActive: true,
    isSystemEverythingElse: false, period: "monthly", amount: 100, categoryIds: [],
    isOngoing: true, budgetType: "recurring", groupIds: [],
    startDate: Timestamp.fromDate(new Date("2020-01-01")),
    endDate: Timestamp.fromDate(new Date("2099-01-01")),
  });
}

/** The bill the user pinned the pending payment to (a manual bill pin is honored while the bill is active). */
async function seed_outflow(userId: string, id: string) {
  await db.collection("outflows").doc(id).set({ id, userId, ownerId: userId, isActive: true, isHidden: false, transactionIds: [], description: "Claude" });
}

/* eslint-disable @typescript-eslint/naming-convention */
describe("pending→posted split inheritance (emulator)", () => {
  it("overlays the pending split (budget + outflow link) onto the posted txn and soft-deletes the pending", async () => {
    const userId = rid("u");
    const itemDocId = rid("itemdoc");
    const plaidItemId = rid("plaiditem");
    const accountId = rid("acct");
    const outflowId = rid("outflow");
    const budgetId = rid("budget");
    const pendingTxId = rid("pendingTx");
    const postedTxId = rid("postedTx");

    // Seed plaid_item (access token decryption is mocked)
    await db.collection("plaid_items").doc(itemDocId).set({
      id: itemDocId, plaidItemId, userId, groupIds: [],
      accessToken: "enc", cursor: null, isActive: true,
      institutionId: "ins_1", institutionName: "Test Bank",
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    await db.collection("users").doc(userId).set({ id: userId, currency: "USD" });
    await seed_outflow(userId, outflowId);
    await seed_budget(userId, budgetId, "Subscriptions");
    await db.collection("accounts").doc(accountId).set({
      id: accountId, accountId, itemId: plaidItemId, userId, ownerId: userId,
      isActive: true, isHidden: false, currentBalance: 0,
    });

    // Seed a PENDING transaction the user has assigned to a recurring bill (outflowId)
    await db.collection("transactions").doc(`plaid_${pendingTxId}`).set({
      id: `plaid_${pendingTxId}`, transactionId: pendingTxId,
      userId, ownerId: userId, groupIds: [], plaidItemId, accountId,
      name: "ANTHROPIC* CLAUDE", merchantName: "Anthropic",
      amount: 107.45, currency: "USD", isPending: true, isActive: true, isDeleted: false,
      transactionDate: Timestamp.now(), type: "expense", source: "plaid",
      splitOutflowIds: [outflowId], splitBudgetIds: [budgetId], splitInflowIds: [],
      splits: [{
        splitId: "sp1", amount: 107.45, budgetId, budgetName: "Subscriptions",
        outflowId, isDefault: true, isIgnored: false, isRefund: false,
        internalPrimaryCategory: null, internalDetailedCategory: null,
        // What the app writes when the user assigns the payment to a bill: a manual bill pin.
        outflowAssignmentSource: "manual", tags: [],
      }],
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });

    // Plaid posts the pending: a NEW posted txn referencing the pending + the pending in `removed`.
    mockSync.mockResolvedValue({
      added: [{
        transaction_id: postedTxId,
        pending_transaction_id: pendingTxId,
        account_id: accountId,
        amount: 107.45,
        iso_currency_code: "USD",
        unofficial_currency_code: null,
        name: "ANTHROPIC* CLAUDE",
        merchant_name: "Anthropic",
        date: "2026-08-21",
        authorized_date: "2026-08-20",
        pending: false,
        payment_channel: "online",
        personal_finance_category: { primary: "GENERAL_SERVICES", detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES" },
        category: ["Service"],
        category_id: "10000000",
      }],
      modified: [],
      removed: [{ transaction_id: pendingTxId }],
      has_more: false,
      next_cursor: "cursor-1",
    });

    await sync_transactions_orchestrator({
      trace_id: rid("t"), span_id: rid("s"),
      input: { item_id: itemDocId, user_id: userId, plaid_item_id: plaidItemId },
      user_id: userId,
      idempotency_key: rid("idem"),
    } as any);

    // The posted txn should exist WITH the inherited split (budget + outflow link).
    const posted = (await db.collection("transactions").doc(`plaid_${postedTxId}`).get()).data();
    expect(posted).toBeDefined();
    expect(posted!.isActive).not.toBe(false);
    expect(posted!.isPending).toBe(false);
    expect(posted!.splits?.length).toBeGreaterThan(0);
    expect(posted!.splits[0].outflowId).toBe(outflowId); // ← inherited bill link survives
    // …and it is still the USER's pin, so the assignment engine (which now runs before the write)
    // keeps it instead of re-deriving it.
    expect(posted!.splits[0].outflowAssignmentSource).toBe("manual");

    // The pending should be soft-deleted by the `removed` handler.
    const pending = (await db.collection("transactions").doc(`plaid_${pendingTxId}`).get()).data();
    expect(pending!.isActive).toBe(false);
  });

  it("CROSS-SYNC: inherits from a pending already removed in a PRIOR sync (posted arrives later, no `removed`)", async () => {
    const userId = rid("u");
    const itemDocId = rid("itemdoc");
    const plaidItemId = rid("plaiditem");
    const accountId = rid("acct");
    const outflowId = rid("outflow");
    const budgetId = rid("budget");
    const pendingTxId = rid("pendingTx");
    const postedTxId = rid("postedTx");

    await db.collection("plaid_items").doc(itemDocId).set({
      id: itemDocId, plaidItemId, userId, groupIds: [],
      accessToken: "enc", cursor: null, isActive: true,
      institutionId: "ins_1", institutionName: "Test Bank",
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
    await db.collection("users").doc(userId).set({ id: userId, currency: "USD" });
    await seed_outflow(userId, outflowId);
    await seed_budget(userId, budgetId, "Subscriptions");
    await db.collection("accounts").doc(accountId).set({
      id: accountId, accountId, itemId: plaidItemId, userId, ownerId: userId,
      isActive: true, isHidden: false, currentBalance: 0,
    });

    // A pending that was ALREADY removed-by-sync in a PRIOR sync (isActive=false),
    // but still carries the user's bill assignment. updatedAt is recent (in window).
    await db.collection("transactions").doc(`plaid_${pendingTxId}`).set({
      id: `plaid_${pendingTxId}`, transactionId: pendingTxId,
      userId, ownerId: userId, groupIds: [], plaidItemId, accountId,
      name: "ANTHROPIC* CLAUDE", merchantName: "Anthropic",
      amount: 107.45, currency: "USD", isPending: true,
      isActive: false, isDeleted: true, deletionReason: "Removed by Plaid sync",
      transactionDate: Timestamp.now(), type: "expense", source: "plaid",
      splitOutflowIds: [outflowId], splitBudgetIds: [budgetId], splitInflowIds: [],
      splits: [{
        splitId: "sp1", amount: 107.45, budgetId, budgetName: "Subscriptions",
        outflowId, isDefault: true, isIgnored: false, isRefund: false,
        internalPrimaryCategory: null, internalDetailedCategory: null,
        // What the app writes when the user assigns the payment to a bill: a manual bill pin.
        outflowAssignmentSource: "manual", tags: [],
      }],
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });

    // A LATER sync: posted arrives referencing the (already-removed) pending; no `removed`.
    mockSync.mockResolvedValue({
      added: [{
        transaction_id: postedTxId, pending_transaction_id: pendingTxId,
        account_id: accountId, amount: 107.45, iso_currency_code: "USD",
        unofficial_currency_code: null, name: "ANTHROPIC* CLAUDE", merchant_name: "Anthropic",
        date: "2026-08-22", authorized_date: "2026-08-20", pending: false, payment_channel: "online",
        personal_finance_category: { primary: "GENERAL_SERVICES", detailed: "GENERAL_SERVICES_OTHER_GENERAL_SERVICES" },
        category: ["Service"], category_id: "10000000",
      }],
      modified: [], removed: [], has_more: false, next_cursor: "cursor-2",
    });

    await sync_transactions_orchestrator({
      trace_id: rid("t"), span_id: rid("s"),
      input: { item_id: itemDocId, user_id: userId, plaid_item_id: plaidItemId },
      user_id: userId, idempotency_key: rid("idem"),
    } as any);

    const posted = (await db.collection("transactions").doc(`plaid_${postedTxId}`).get()).data();
    expect(posted).toBeDefined();
    expect(posted!.splits[0].outflowId).toBe(outflowId); // ← inherited across syncs
    expect(posted!.splits[0].outflowAssignmentSource).toBe("manual");
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
