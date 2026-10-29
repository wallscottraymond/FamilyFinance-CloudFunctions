/**
 * Emulator Integration Test — a SPLIT pending transaction, then Plaid posts it
 * (Transaction-Integrity proof, case G2 / G3).
 *
 * A $100 pending Costco charge (FOOD_AND_DRINK_GROCERIES) the user split three ways:
 *   s1 $60  left on Plaid's category        → Groceries (by category)
 *   s2 $30  re-categorized by the user      → Shopping (user pick)
 *   s3 $10  pinned to "Fun", Ignored, tagged → Fun (manual pin), not counted, tag kept
 * Plaid posts it under a NEW id. Every user choice must carry over, the engine must place each
 * split exactly as before, and the pending must be retired. A changed posted amount scales the
 * splits — and they must still add up to the posted amount to the cent.
 *
 * Prereqs: firebase emulators:exec --only firestore "npx jest --selectProjects emulator --testPathPattern pendingSplitPosting"
 */
import * as admin from "firebase-admin";
import { Timestamp } from "firebase-admin/firestore";

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
const RUN = rid("ps");

let db: FirebaseFirestore.Firestore;
let sync_transactions_orchestrator: (ctx: unknown) => Promise<unknown>;
let invalidate_category_cache: () => void;
beforeAll(async () => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    throw new Error("Refusing to run: FIRESTORE_EMULATOR_HOST not set (dev==prod safety).");
  }
  if (!admin.apps.length) admin.initializeApp({ projectId: "family-budget-app-cb59b" });
  db = admin.firestore();
  /* eslint-disable @typescript-eslint/no-var-requires */
  ({ sync_transactions_orchestrator } = require("../src/functions/orchestrators/plaid/sync_transactions.orchestrator"));
  ({ invalidate_category_cache } = require("../src/functions/repositories/category.repo"));
  /* eslint-enable @typescript-eslint/no-var-requires */
  // Our categories (unique slugs so other suites can't collide).
  const cat = (id: string, first: string) =>
    db.collection("categories").doc(id).set({
      isActive: true, firstCategoryId: first, overallCategoryId: first, first_category: first,
      type: "Outflow", merchants: [], keywords: [],
    });
  await cat(`PS_GROC_${RUN}`, `ps_groceries_${RUN}`);
  await cat(`PS_SHOP_${RUN}`, `ps_shopping_${RUN}`);
  invalidate_category_cache();
});

/* eslint-disable @typescript-eslint/naming-convention */
async function budget(userId: string, id: string, categoryIds: string[], ee = false, period = "monthly") {
  await db.collection("budgets").doc(id).set({
    id, name: id, userId, ownerId: userId, createdBy: userId, isActive: true,
    access: { ownerId: userId, createdBy: userId, groupIds: [], isPrivate: true },
    isSystemEverythingElse: ee, period, amount: 100, categoryIds, isOngoing: true,
    budgetType: "recurring", groupIds: [],
    startDate: Timestamp.fromDate(new Date("2020-01-01")),
    endDate: Timestamp.fromDate(new Date("2099-01-01")),
  });
}

/** Seed a user with a $100 pending split three ways; Plaid posts it as `posted_amount`. */
async function post_split_pending(
  posted_amount: number,
  amounts = [60, 30, 10],
  opts: { rule?: boolean } = {}
) {
  const userId = rid("u");
  const itemDocId = rid("itemdoc");
  const plaidItemId = rid("plaiditem");
  const accountId = rid("acct");
  const pendingTxId = rid("pendingTx");
  const postedTxId = rid("postedTx");
  const B = { groc: rid("groc"), shop: rid("shop"), fun: rid("fun"), ee: rid("ee") };
  await db.collection("plaid_items").doc(itemDocId).set({
    id: itemDocId, plaidItemId, userId, groupIds: [], accessToken: "enc", cursor: null,
    isActive: true, institutionId: "ins_1", institutionName: "Test Bank",
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });
  await db.collection("users").doc(userId).set({ id: userId, currency: "USD" });
  await db.collection("accounts").doc(accountId).set({
    id: accountId, accountId, itemId: plaidItemId, userId, ownerId: userId,
    isActive: true, isHidden: false, currentBalance: 0,
  });
  await budget(userId, B.groc, [`ps_groceries_${RUN}`]);
  await budget(userId, B.shop, [`ps_shopping_${RUN}`]);
  await budget(userId, B.fun, []);
  await budget(userId, B.ee, [], true, "monthly");
  await budget(userId, `${B.ee}_w`, [], true, "weekly");
  await budget(userId, `${B.ee}_b`, [], true, "bi_monthly");

  if (opts.rule) {
    // A Rule Book rule that would pin every Costco charge to Groceries (it ran when the PENDING
    // was created; the user then edited the pending).
    await db.collection("rules").doc(rid("rule")).set({
      userId, isActive: true, priority: 100, name: "Costco → Groceries",
      conditions: { op: "AND", conditions: [{ variable: "merchant", operator: "contains", value: "costco" }] },
      actions: { assign_budget_id: B.groc, assign_category: `ps_groceries_${RUN}` },
      createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
    });
  }
  const code = `PS_GROC_${RUN}`;
  const total = amounts.reduce((a, b) => a + b, 0);
  await db.collection("transactions").doc(`plaid_${pendingTxId}`).set({
    id: `plaid_${pendingTxId}`, transactionId: pendingTxId, userId, ownerId: userId, groupIds: [],
    plaidItemId, accountId, name: "COSTCO", merchantName: "Costco", amount: total, currency: "USD",
    isPending: true, isActive: true, isDeleted: false, transactionDate: Timestamp.fromDate(new Date("2026-08-20T12:00:00Z")),
    type: "expense", source: "plaid", plaidPrimaryCategory: "FOOD_AND_DRINK", plaidDetailedCategory: code,
    splitBudgetIds: [B.groc, B.shop, B.fun], splitOutflowIds: [], splitInflowIds: [],
    splits: [
      { splitId: "s1", amount: amounts[0], plaidPrimaryCategory: "FOOD_AND_DRINK", plaidDetailedCategory: code,
        budgetId: B.groc, budgetAssignmentSource: "category", isDefault: true, tags: [] },
      { splitId: "s2", amount: amounts[1], plaidPrimaryCategory: "FOOD_AND_DRINK", plaidDetailedCategory: code,
        budgetId: B.shop, budgetAssignmentSource: "category", categorySource: "user",
        firstCategoryId: `ps_shopping_${RUN}`, overallCategoryId: `ps_shopping_${RUN}`, tags: [] },
      { splitId: "s3", amount: amounts[2], plaidPrimaryCategory: "FOOD_AND_DRINK", plaidDetailedCategory: code,
        budgetId: B.fun, budgetAssignmentSource: "manual", spendStatus: "ignored", isIgnored: true,
        isTaxDeductible: true, tags: ["gift"] },
    ],
    createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
  });

  mockSync.mockResolvedValue({
    added: [{
      transaction_id: postedTxId, pending_transaction_id: pendingTxId, account_id: accountId,
      amount: posted_amount, iso_currency_code: "USD", unofficial_currency_code: null,
      name: "COSTCO", merchant_name: "Costco", date: "2026-08-21", authorized_date: "2026-08-20",
      pending: false, payment_channel: "in store",
      personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: code },
      category: ["Shops"], category_id: "19000000",
    }],
    modified: [], removed: [{ transaction_id: pendingTxId }], has_more: false, next_cursor: rid("cur"),
  });
  await sync_transactions_orchestrator({
    trace_id: rid("t"), span_id: rid("s"),
    input: { item_id: itemDocId, user_id: userId, plaid_item_id: plaidItemId },
    user_id: userId, idempotency_key: rid("idem"),
  } as never);

  const posted = (await db.collection("transactions").doc(`plaid_${postedTxId}`).get()).data()!;
  const pending = (await db.collection("transactions").doc(`plaid_${pendingTxId}`).get()).data()!;
  const by = (id: string) => (posted.splits as Array<Record<string, unknown>>).find((s) => (s.splitId ?? s.id) === id)!;
  return { posted, pending, by, B, userId, itemDocId, plaidItemId, accountId, postedTxId, code };
}

const status = (s: Record<string, unknown>) =>
  (s.spendStatus as string) ?? (s.isIgnored ? "ignored" : s.isRefund ? "refund" : "counted");
const cents = (n: unknown) => Math.round(Number(n) * 100);

describe("a split PENDING transaction, then Plaid posts it (emulator)", () => {
  it("a Rule Book rule does NOT re-run on the posted transaction (it would overwrite the edits)", async () => {
    const { by, B } = await post_split_pending(100, [60, 30, 10], { rule: true });
    expect(by("s2")).toMatchObject({ categorySource: "user", firstCategoryId: `ps_shopping_${RUN}`, monthlyBudgetId: B.shop });
    expect(by("s3")).toMatchObject({ budgetAssignmentSource: "manual", monthlyBudgetId: B.fun });
  });

  it("a Plaid \"modified\" update racing a user edit never overwrites the edit (re-merged onto it)", async () => {
    const { userId, itemDocId, plaidItemId, accountId, postedTxId, code } = await post_split_pending(100);
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { transaction_repo } = require("../src/functions/repositories/transaction.repo");
    const real = transaction_repo.get_by_plaid_transaction_ids.bind(transaction_repo);
    let landed = false;
    const spy = jest.spyOn(transaction_repo, "get_by_plaid_transaction_ids").mockImplementation(
      async (...args: unknown[]) => {
        const out = await real(...args);
        if (!landed && (args[2] as string[]).includes(postedTxId)) {
          landed = true;
          // The user re-categorizes s1 AFTER the sync read the doc, BEFORE it writes.
          const ref = db.collection("transactions").doc(`plaid_${postedTxId}`);
          const splits = (await ref.get()).data()!.splits;
          splits[0] = { ...splits[0], categorySource: "user", firstCategoryId: `ps_shopping_${RUN}` };
          await ref.update({ splits, userNotes: "mine" });
        }
        return out;
      }
    );
    mockSync.mockResolvedValue({
      added: [],
      modified: [{
        transaction_id: postedTxId, account_id: accountId, amount: 100, iso_currency_code: "USD",
        unofficial_currency_code: null, name: "COSTCO WHOLESALE #12", merchant_name: "Costco",
        date: "2026-08-21", authorized_date: "2026-08-20", pending: false, payment_channel: "in store",
        personal_finance_category: { primary: "FOOD_AND_DRINK", detailed: code },
        category: ["Shops"], category_id: "19000000",
      }],
      removed: [], has_more: false, next_cursor: rid("cur"),
    });
    try {
      await sync_transactions_orchestrator({
        trace_id: rid("t"), span_id: rid("s"),
        input: { item_id: itemDocId, user_id: userId, plaid_item_id: plaidItemId },
        user_id: userId, idempotency_key: rid("idem"),
      } as never);
    } finally {
      spy.mockRestore();
    }
    expect(landed).toBe(true);
    const doc = (await db.collection("transactions").doc(`plaid_${postedTxId}`).get()).data()!;
    expect(doc.name).toBe("COSTCO WHOLESALE #12"); // Plaid's update applied
    expect(doc.userNotes).toBe("mine"); // …onto the user's edit, which survived
    expect(doc.splits[0]).toMatchObject({ categorySource: "user", firstCategoryId: `ps_shopping_${RUN}` });
  });

  it("Plaid re-categorizes (modified): an untouched split's category AND budget follow Plaid; a user pick stays (M4)", async () => {
    const { userId, itemDocId, plaidItemId, accountId, postedTxId, B } = await post_split_pending(100);
    mockSync.mockResolvedValue({
      added: [],
      modified: [{
        transaction_id: postedTxId, account_id: accountId, amount: 100, iso_currency_code: "USD",
        unofficial_currency_code: null, name: "COSTCO", merchant_name: "Costco",
        date: "2026-08-21", authorized_date: "2026-08-20", pending: false, payment_channel: "in store",
        personal_finance_category: { primary: "GENERAL_MERCHANDISE", detailed: `PS_SHOP_${RUN}` },
        category: ["Shops"], category_id: "19000000",
      }],
      removed: [], has_more: false, next_cursor: rid("cur"),
    });
    await sync_transactions_orchestrator({
      trace_id: rid("t"), span_id: rid("s"),
      input: { item_id: itemDocId, user_id: userId, plaid_item_id: plaidItemId },
      user_id: userId, idempotency_key: rid("idem"),
    } as never);
    const doc = (await db.collection("transactions").doc(`plaid_${postedTxId}`).get()).data()!;
    const by = (id: string) => (doc.splits as Array<Record<string, unknown>>).find((x) => x.splitId === id)!;
    // s1 was untouched (Plaid's Groceries) → now Plaid's Shopping, in the Shopping budget
    expect(by("s1")).toMatchObject({ plaidDetailedCategory: `PS_SHOP_${RUN}`, firstCategoryId: `ps_shopping_${RUN}`, monthlyBudgetId: B.shop });
    expect(by("s1").categorySource).not.toBe("user");
    // s2 the user's pick and s3 the manual pin are kept
    expect(by("s2")).toMatchObject({ categorySource: "user", firstCategoryId: `ps_shopping_${RUN}`, monthlyBudgetId: B.shop });
    expect(by("s3")).toMatchObject({ budgetAssignmentSource: "manual", monthlyBudgetId: B.fun });
  });

  it("same amount: every user choice carries over and each split lands where it was", async () => {
    const { posted, pending, by, B } = await post_split_pending(100);
    expect(posted.isPending).toBe(false);
    expect(pending.isActive).toBe(false); // the pending is retired
    expect(posted.splits).toHaveLength(3);
    // s1: Plaid's category → Groceries
    expect(by("s1")).toMatchObject({ amount: 60, monthlyBudgetId: B.groc });
    // s2: the user's pick survives → Shopping
    expect(by("s2")).toMatchObject({ amount: 30, categorySource: "user", firstCategoryId: `ps_shopping_${RUN}`, monthlyBudgetId: B.shop });
    // s3: the manual pin, Ignored status, tag and tax flag survive
    expect(by("s3")).toMatchObject({ amount: 10, budgetAssignmentSource: "manual", monthlyBudgetId: B.fun, isTaxDeductible: true, tags: ["gift"] });
    expect(status(by("s3"))).toBe("ignored");
    expect([...(posted.splitBudgetIds as string[])].sort()).toEqual([B.groc, B.shop, B.fun].sort());
  });

  it("posted for MORE (a tip): splits scale proportionally and still add up to the posted amount", async () => {
    const { posted, by, B } = await post_split_pending(110);
    expect([by("s1").amount, by("s2").amount, by("s3").amount]).toEqual([66, 33, 11]);
    // …with every choice kept
    expect(by("s1").monthlyBudgetId).toBe(B.groc);
    expect(by("s2")).toMatchObject({ categorySource: "user", monthlyBudgetId: B.shop });
    expect(by("s3")).toMatchObject({ budgetAssignmentSource: "manual", monthlyBudgetId: B.fun, tags: ["gift"] });
    expect(status(by("s3"))).toBe("ignored");
    const sum = (posted.splits as Array<{ amount: number }>).reduce((t, s) => t + cents(s.amount), 0);
    expect(sum).toBe(cents(110));
  });

  it("an amount that does not divide evenly: the splits still add up to the posted amount to the cent", async () => {
    const { posted } = await post_split_pending(50, [33.33, 33.33, 33.34]);
    const sum = (posted.splits as Array<{ amount: number }>).reduce((t, s) => t + cents(s.amount), 0);
    expect(sum).toBe(cents(50));
  });
});
/* eslint-enable @typescript-eslint/naming-convention */
