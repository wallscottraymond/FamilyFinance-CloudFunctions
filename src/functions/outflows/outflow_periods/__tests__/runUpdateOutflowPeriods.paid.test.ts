import { Timestamp } from "firebase-admin/firestore";

import { runUpdateOutflowPeriods } from "../utils/runUpdateOutflowPeriods";

// What was PAID has one writer: reconcile_recurring_period (from the transactions' split links).
// runUpdateOutflowPeriods used to also run the legacy auto-match + occurrence matcher whenever
// the linked transactions changed, and skipped the expected-amount update for those periods
// (Code-Health-Review F3 / M4-H2 / M4-M4). It also set the period total to ONE occurrence's
// amount (M4-M3). This guards all three.
const PAID_FIELDS = [
  "transactionSplits",
  "totalAmountPaid",
  "isPaid",
  "isFullyPaid",
  "isPartiallyPaid",
  "numberOfOccurrencesPaid",
  "status",
  "reconciliation",
];

function fakeDb(periods: Array<{ id: string; data: Record<string, unknown> }>) {
  const updates: Array<Record<string, unknown>> = [];
  const docs = periods.map((p) => ({ id: p.id, ref: { id: p.id }, data: () => p.data }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    collection: jest.fn(() => ({
      where: jest.fn(() => ({
        get: jest.fn(async () => ({ size: docs.length, empty: docs.length === 0, docs })),
      })),
      doc: jest.fn(() => ({ get: jest.fn(async () => ({ exists: false })) })),
    })),
    batch: jest.fn(() => ({
      update: jest.fn((_ref: unknown, data: Record<string, unknown>) => updates.push(data)),
      commit: jest.fn(async () => undefined),
    })),
  };
  return { db, updates };
}

const occ = (day: number, paid: boolean) => ({
  id: `o${day}`, dueDate: Timestamp.fromDate(new Date(`2026-10-${String(day).padStart(2, "0")}T12:00:00Z`)),
  amountDue: 20, amountPaid: paid ? 20 : 0, isPaid: paid,
});

// A weekly bill in a monthly period: 4 occurrences, one paid.
const weeklyInMonth = {
  outflowId: "out_1",
  isActive: true,
  periodStartDate: Timestamp.fromDate(new Date("2026-10-01T00:00:00Z")),
  periodEndDate: Timestamp.fromDate(new Date("2026-10-31T00:00:00Z")),
  cycleDays: 7,
  numberOfOccurrencesInPeriod: 4,
  occurrencesInPeriod: 4,
  occurrenceDueDates: [6, 13, 20, 27].map((d) => occ(d, false).dueDate),
  occurrences: [occ(6, true), occ(13, false), occ(20, false), occ(27, false)],
  totalAmountPaid: 20,
  isPartiallyPaid: false,
  isPaid: false,
  isFullyPaid: false,
};

describe("runUpdateOutflowPeriods (expected amounts only)", () => {
  it("amount + linked transactions changing together: expected updates, no matcher, no paid state", async () => {
    const { db, updates } = fakeDb([{ id: "out_1_2026M10", data: weeklyInMonth }]);
    const result = await runUpdateOutflowPeriods(
      db,
      "out_1",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { averageAmount: 20, transactionIds: ["t1"] } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { averageAmount: 25, transactionIds: ["t1", "t2"] } as any
    );

    expect(result.errors).toEqual([]);
    // It never reads transactions or re-reads a period to match payments (the legacy matcher did).
    expect(db.collection).not.toHaveBeenCalledWith("transactions");
    expect(db.collection).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(1);
    for (const field of PAID_FIELDS) {
      expect(updates[0]).not.toHaveProperty(field);
    }
    // M4-M4: the amount update is applied, not skipped.
    expect(updates[0].amountPerOccurrence).toBe(25);
    // M4-M3: the period total covers all 4 occurrences, not one.
    expect(updates[0].expectedAmount).toBe(100);
    expect(updates[0].totalAmountDue).toBe(100);
    expect(updates[0].totalAmountUnpaid).toBe(80);
    // The paid occurrence keeps its real amountPaid.
    const occs = updates[0].occurrences as Array<Record<string, unknown>>;
    expect(occs.map((o) => o.amountDue)).toEqual([25, 25, 25, 25]);
    expect(occs[0]).toMatchObject({ isPaid: true, amountPaid: 20 });
  });

  it("a period with no occurrences (bill not due) expects nothing", async () => {
    const notDue = { ...weeklyInMonth, numberOfOccurrencesInPeriod: 0, occurrencesInPeriod: 0,
      occurrences: [], occurrenceDueDates: [], totalAmountPaid: 0 };
    const { db, updates } = fakeDb([{ id: "out_1_2026M11", data: notDue }]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await runUpdateOutflowPeriods(db, "out_1", { averageAmount: 20 } as any, { averageAmount: 25 } as any);
    expect(updates[0].amountPerOccurrence).toBe(25);
    expect(updates[0].totalAmountDue).toBe(0);
    expect(updates[0].totalAmountUnpaid).toBe(0);
  });
});
