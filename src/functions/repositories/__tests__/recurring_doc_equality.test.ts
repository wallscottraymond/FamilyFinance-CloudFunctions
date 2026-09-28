import { Timestamp } from "firebase-admin/firestore";
import { is_unchanged_recurring_doc } from "../recurring_doc_equality";

const base = () => ({
  id: "o1",
  averageAmount: 18.82,
  firstDate: Timestamp.fromMillis(1000),
  transactionIds: ["a", "b"],
  removalIntervals: [],
  userCustomName: null,
  updatedAt: Timestamp.fromMillis(5000),
  lastSyncedAt: Timestamp.fromMillis(5000),
});

describe("is_unchanged_recurring_doc", () => {
  it("ignores only the sync timestamps", () => {
    const next = { ...base(), updatedAt: Timestamp.fromMillis(9000), lastSyncedAt: Timestamp.fromMillis(9000) };
    expect(is_unchanged_recurring_doc(base(), next)).toBe(true);
  });

  it("compares Timestamps by instant and ignores key order", () => {
    const { id, ...rest } = base();
    const next = { ...rest, id, firstDate: Timestamp.fromMillis(1000) };
    expect(is_unchanged_recurring_doc(base(), next)).toBe(true);
  });

  it("detects a changed value, a new transaction id, and a changed date", () => {
    expect(is_unchanged_recurring_doc(base(), { ...base(), averageAmount: 20.4 })).toBe(false);
    expect(is_unchanged_recurring_doc(base(), { ...base(), transactionIds: ["a", "b", "c"] })).toBe(false);
    expect(is_unchanged_recurring_doc(base(), { ...base(), firstDate: Timestamp.fromMillis(2000) })).toBe(false);
  });

  it("treats a stored field the new doc would drop as a change (the write must still happen)", () => {
    expect(is_unchanged_recurring_doc({ ...base(), extraField: 1 }, base())).toBe(false);
  });

  it("treats null vs missing as different, undefined vs missing as equal", () => {
    const { userCustomName: _u, ...without } = base();
    expect(is_unchanged_recurring_doc(base(), without)).toBe(false);
    expect(is_unchanged_recurring_doc(without, { ...without, userCustomName: undefined })).toBe(true);
  });
});
