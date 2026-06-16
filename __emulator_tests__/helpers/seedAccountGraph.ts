/**
 * seedAccountGraph — emulator-test seed factory for the account-removal cascade.
 *
 * Builds a coherent, valid object graph in the Firestore emulator in one call:
 *
 *   plaid_item
 *     └─ accounts[ ]                       (N accounts share the item)
 *          ├─ transactions[ ]              (txnsPerAccount on EACH account)
 *          ├─ outflows[ ]   (target only)  (recurring bills on accounts[0])
 *          └─ inflows[ ]    (target only)  (recurring income on accounts[0])
 *
 * The linking field across the graph is `accountId` (the Plaid account ID),
 * exactly as the removal cascade reads it:
 *   - transactions.accountId === account.accountId, transactions.ownerId === userId
 *   - outflows/inflows.accountId === account.accountId
 *   - accounts.itemId === the plaid_item doc id (groups accounts under one item)
 *
 * `accounts[0]` is the "target" the cascade tests remove/restore; the remaining
 * accounts let tests assert the cascade does NOT touch siblings.
 *
 * Each call generates globally-unique IDs, so multiple seeds can coexist in one
 * emulator run without collisions.
 */

/* eslint-disable @typescript-eslint/naming-convention */
// ^ Firestore documents use camelCase field names (mapped to snake_case only
//   inside the repositories). Seed docs must match the on-disk camelCase shape.

import { Firestore, Timestamp } from "firebase-admin/firestore";

let _counter = 0;
function uniq(prefix: string): string {
  _counter += 1;
  return `${prefix}_${Date.now()}_${_counter}_${Math.floor(Math.random() * 1e6)}`;
}

export interface SeedAccountGraphOptions {
  /** Owner user id. Defaults to a fresh unique id. */
  userId?: string;
  /** Number of accounts on the shared Plaid item. Default 1. */
  accounts?: number;
  /** Transactions seeded on EACH account. Default 2. */
  txnsPerAccount?: number;
  /** Recurring outflows on the target account (accounts[0]). Default 0. */
  outflows?: number;
  /** Recurring inflows on the target account (accounts[0]). Default 0. */
  inflows?: number;
  /** Periods seeded per recurring outflow/inflow (linked by accountId). Default 0. */
  periodsPerRecurring?: number;
}

export interface SeededAccount {
  /** Firestore document id for the account. */
  id: string;
  /** Plaid account id — the value that links transactions/outflows/inflows. */
  accountId: string;
}

export interface SeedAccountGraphResult {
  userId: string;
  itemDocId: string;
  plaidItemId: string;
  /** All seeded accounts; index 0 is the cascade target. */
  accounts: SeededAccount[];
  /** Convenience alias for accounts[0]. */
  target: SeededAccount;
  /** Transaction doc ids keyed by Plaid accountId. */
  txnIdsByAccountId: Record<string, string[]>;
  /** Outflow doc ids attached to the target account. */
  outflowIds: string[];
  /** Inflow doc ids attached to the target account. */
  inflowIds: string[];
  /** Outflow period doc ids (linked to the target account). */
  outflowPeriodIds: string[];
  /** Inflow period doc ids (linked to the target account). */
  inflowPeriodIds: string[];
}

export async function seedAccountGraph(
  db: Firestore,
  options: SeedAccountGraphOptions = {}
): Promise<SeedAccountGraphResult> {
  const userId = options.userId ?? uniq("user");
  const accountsCount = options.accounts ?? 1;
  const txnsPerAccount = options.txnsPerAccount ?? 2;
  const outflowsCount = options.outflows ?? 0;
  const inflowsCount = options.inflows ?? 0;
  const periodsPerRecurring = options.periodsPerRecurring ?? 0;
  const now = Timestamp.now();

  const itemDocId = uniq("item");
  const plaidItemId = uniq("plaiditem");

  const batch = db.batch();

  // plaid_item
  batch.set(db.collection("plaid_items").doc(itemDocId), {
    id: itemDocId,
    plaidItemId,
    userId,
    groupIds: [],
    institutionId: "ins_test",
    institutionName: "Test Bank",
    accessToken: "encrypted_placeholder",
    status: "good",
    error: null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  const accounts: SeededAccount[] = [];
  const txnIdsByAccountId: Record<string, string[]> = {};

  for (let a = 0; a < accountsCount; a++) {
    const id = uniq("acct");
    const accountId = uniq("plaidacct");
    accounts.push({ id, accountId });

    batch.set(db.collection("accounts").doc(id), {
      id,
      userId,
      accountId,
      itemId: itemDocId,
      institutionId: "ins_test",
      institutionName: "Test Bank",
      accountName: `Test Account ${a + 1}`,
      currentBalance: 100,
      isActive: true,
      isDeleted: false,
      createdAt: now,
      updatedAt: now,
      access: {
        ownerId: userId,
        createdBy: userId,
        groupIds: [],
        isPrivate: true,
      },
    });

    const txnIds: string[] = [];
    for (let t = 0; t < txnsPerAccount; t++) {
      const tid = uniq("txn");
      txnIds.push(tid);
      batch.set(db.collection("transactions").doc(tid), {
        id: tid,
        transactionId: uniq("plaidtxn"),
        accountId,
        ownerId: userId,
        userId,
        amount: 12.34,
        isActive: true,
        isDeleted: false,
        isHidden: false,
        createdAt: now,
        updatedAt: now,
      });
    }
    txnIdsByAccountId[accountId] = txnIds;
  }

  const target = accounts[0];

  const outflowIds: string[] = [];
  const outflowPeriodIds: string[] = [];
  for (let o = 0; o < outflowsCount; o++) {
    const id = uniq("outflow");
    outflowIds.push(id);
    batch.set(db.collection("outflows").doc(id), {
      id,
      accountId: target.accountId,
      ownerId: userId,
      groupIds: [],
      plaidItemId,
      description: `Test Outflow ${o + 1}`,
      isActive: true,
      isHidden: false,
      createdAt: now,
      updatedAt: now,
    });
    for (let p = 0; p < periodsPerRecurring; p++) {
      const periodId = `${id}_TP${p}`;
      outflowPeriodIds.push(periodId);
      batch.set(db.collection("outflow_periods").doc(periodId), {
        id: periodId,
        outflowId: id,
        accountId: target.accountId,
        ownerId: userId,
        userId,
        sourcePeriodId: `2026M${String(p + 1).padStart(2, "0")}`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  const inflowIds: string[] = [];
  const inflowPeriodIds: string[] = [];
  for (let i = 0; i < inflowsCount; i++) {
    const id = uniq("inflow");
    inflowIds.push(id);
    batch.set(db.collection("inflows").doc(id), {
      id,
      accountId: target.accountId,
      ownerId: userId,
      groupIds: [],
      plaidItemId,
      description: `Test Inflow ${i + 1}`,
      isActive: true,
      isHidden: false,
      createdAt: now,
      updatedAt: now,
    });
    for (let p = 0; p < periodsPerRecurring; p++) {
      const periodId = `${id}_TP${p}`;
      inflowPeriodIds.push(periodId);
      batch.set(db.collection("inflow_periods").doc(periodId), {
        id: periodId,
        inflowId: id,
        accountId: target.accountId,
        ownerId: userId,
        userId,
        sourcePeriodId: `2026M${String(p + 1).padStart(2, "0")}`,
        isActive: true,
        createdAt: now,
        updatedAt: now,
      });
    }
  }

  await batch.commit();

  return {
    userId,
    itemDocId,
    plaidItemId,
    accounts,
    target,
    txnIdsByAccountId,
    outflowIds,
    inflowIds,
    outflowPeriodIds,
    inflowPeriodIds,
  };
}
