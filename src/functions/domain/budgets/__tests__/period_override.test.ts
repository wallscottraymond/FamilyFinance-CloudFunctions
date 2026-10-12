import { Timestamp } from "firebase-admin/firestore";
import { direct_period_override, period_allocation } from "../period_override.service";

const at = (ms: number): Timestamp => Timestamp.fromMillis(ms);

describe("This Period Only — THE rule (X10)", () => {
  it("a direct override on the budget's own period counts", () => {
    expect(period_allocation({ allocatedAmount: 400, modifiedAmount: 250, isModified: true, isPrime: true })).toBe(250);
  });
  it("no override, or Reset (isModified false) → the allocation", () => {
    expect(period_allocation({ allocatedAmount: 400 })).toBe(400);
    expect(period_allocation({ allocatedAmount: 400, modifiedAmount: 250, isModified: false })).toBe(400);
  });
  it("a synced copy (from another period type) never counts", () => {
    expect(direct_period_override({ modifiedAmount: 150, isModified: true, modifiedAmountSyncedFrom: "w", modifiedAmountSyncedAt: at(2) })).toBeNull();
    expect(direct_period_override({ modifiedAmount: 150, isModified: true, isPrime: false })).toBeNull();
  });
  it("a direct edit AFTER an old copy marker counts (old code never cleared the marker)", () => {
    expect(direct_period_override({
      modifiedAmount: 300, isModified: true, modifiedAmountSyncedFrom: "w",
      modifiedAmountSyncedAt: at(1000), lastModifiedAt: at(2000),
    })).toBe(300);
  });
});
