import { Timestamp } from "firebase-admin/firestore";
import { runUpdateInflowPeriods } from "../utils/runUpdateInflowPeriods";

// What was RECEIVED has one writer: reconcile_recurring_period (from the transactions' split
// links). The legacy alignment pass that also wrote these from runUpdateInflowPeriods dated
// every paycheck "now" and overwrote reconcile's totals; it was retired 2026-10-29. This guards
// that runUpdateInflowPeriods never writes received state again, even when the linked
// transactions change in the same write as the expected amount (a Plaid recurring update).
const RECEIVED_FIELDS = [
  "reconciliation",
  "transactionIds",
  "occurrencePaidFlags",
  "occurrenceTransactionIds",
  "amountPaid",
  "totalAmountPaid",
  "isPaid",
  "isFullyPaid",
  "isPartiallyPaid",
  "numberOfOccurrencesPaid",
  "numberOfOccurrencesUnpaid",
  "status",
];

function fakeDb(periods: Array<{ id: string; data: Record<string, unknown> }>) {
  const updates: Array<Record<string, unknown>> = [];
  const docs = periods.map((p) => ({ id: p.id, ref: { id: p.id }, data: () => p.data }));
  const db: any = {
    collection: jest.fn(() => ({
      where: jest.fn(() => ({
        get: jest.fn(async () => ({ size: docs.length, empty: docs.length === 0, docs })),
      })),
    })),
    batch: jest.fn(() => ({
      update: jest.fn((_ref: unknown, data: Record<string, unknown>) => updates.push(data)),
      commit: jest.fn(async () => undefined),
    })),
  };
  return { db, updates };
}

describe("runUpdateInflowPeriods never writes what was received", () => {
  const period = {
    inflowId: "inf_1",
    isActive: true,
    periodStartDate: Timestamp.fromDate(new Date("2026-10-01")),
    periodEndDate: Timestamp.fromDate(new Date("2026-10-31")),
    numberOfOccurrencesInPeriod: 2,
    cycleDays: 14,
    occurrencePaidFlags: [true, false],
    occurrenceTransactionIds: ["txn_paid", null],
    occurrenceAmounts: [2000, 0],
    totalAmountPaid: 2000,
    isPartiallyPaid: true,
  };

  it("amount + linked transactions changing together: expected updates only", async () => {
    const { db, updates } = fakeDb([{ id: "inf_1_2026M10", data: period }]);
    const result = await runUpdateInflowPeriods(
      db,
      "inf_1",
      { ownerId: "user_1", averageAmount: 2000, transactionIds: ["txn_paid"] } as any,
      { ownerId: "user_1", averageAmount: 2100, transactionIds: ["txn_paid", "txn_new"] } as any
    );

    expect(result.errors).toEqual([]);
    // It never reads transactions to work out what was received (the legacy pass did).
    expect(db.collection).not.toHaveBeenCalledWith("transactions");
    expect(updates).toHaveLength(1);
    for (const field of RECEIVED_FIELDS) {
      expect(updates[0]).not.toHaveProperty(field);
    }
    // Expected moved; the received occurrence keeps its real amount.
    expect(updates[0].amountPerOccurrence).toBe(2100);
    expect(updates[0].occurrenceAmounts).toEqual([2000, 0]);
  });
});
