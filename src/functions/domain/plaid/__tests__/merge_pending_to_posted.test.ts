/**
 * merge_pending_to_posted — the user's per-split Ignore / Refund / Tax choices on a PENDING
 * transaction must survive when Plaid posts it (they used to be reset to false).
 */
import { merge_pending_to_posted } from "../transaction_sync.service";
import type {
  PendingMigration,
  TransactionForPersistence,
  TransactionSplitForMigration,
} from "../../../types/plaid/transaction_sync.types";

const pendingSplit = (over: Partial<TransactionSplitForMigration> = {}): TransactionSplitForMigration => ({
  split_id: "s1",
  amount: 40,
  budget_id: "b-food",
  outflow_id: null,
  internal_primary_category: null,
  internal_detailed_category: null,
  is_default: true,
  tags: [],
  ...over,
});

const posted = {
  transaction_id: "posted-1",
  transaction_date: new Date("2026-10-01T00:00:00Z"),
  plaid_primary_category: "FOOD_AND_DRINK",
  plaid_detailed_category: "FOOD_AND_DRINK_GROCERIES",
  internal_primary_category: null,
  internal_detailed_category: null,
  splits: [
    {
      split_id: "posted-split",
      amount: 40,
      monthly_period_id: "2026M10",
      weekly_period_id: "2026W40",
      bi_weekly_period_id: "2026BM10A",
      plaid_primary_category: "FOOD_AND_DRINK",
      plaid_detailed_category: "FOOD_AND_DRINK_GROCERIES",
    },
  ],
} as unknown as TransactionForPersistence;

const migration = (splits: TransactionSplitForMigration[], amounts = { old: 40, next: 40 }): PendingMigration =>
  ({
    posted_plaid_transaction_id: "posted-1",
    pending_plaid_transaction_id: "pending-1",
    pending_transaction: { doc_id: "d1", plaid_transaction_id: "pending-1", amount: amounts.old, splits },
    amount_changed: amounts.old !== amounts.next,
    old_amount: amounts.old,
    new_amount: amounts.next,
  }) as unknown as PendingMigration;

describe("merge_pending_to_posted — split flags", () => {
  it("keeps ignore + tax from the pending split", () => {
    const out = merge_pending_to_posted(
      posted,
      migration([pendingSplit({ is_ignored: true, is_tax_deductible: true })])
    );
    expect(out.splits[0].is_ignored).toBe(true);
    expect(out.splits[0].is_refund).toBe(false);
    expect(out.splits[0].is_tax_deductible).toBe(true);
  });

  it("keeps refund", () => {
    const out = merge_pending_to_posted(posted, migration([pendingSplit({ is_refund: true })]));
    expect(out.splits[0].is_refund).toBe(true);
    expect(out.splits[0].is_ignored).toBe(false);
  });

  it("keeps flags when the amount changes on post (proportional rescale)", () => {
    const out = merge_pending_to_posted(
      posted,
      migration([pendingSplit({ is_ignored: true, is_tax_deductible: true })], { old: 40, next: 44 })
    );
    expect(out.splits[0].amount).toBe(44);
    expect(out.splits[0].is_ignored).toBe(true);
    expect(out.splits[0].is_tax_deductible).toBe(true);
  });

  it("defaults to false when the pending split has no flags", () => {
    const out = merge_pending_to_posted(posted, migration([pendingSplit()]));
    expect(out.splits[0]).toMatchObject({ is_ignored: false, is_refund: false, is_tax_deductible: false });
  });
});

describe("merge_pending_to_posted — parked bill pin (X9)", () => {
  it("carries a bill pin parked while its bill is removed / paused", () => {
    const out = merge_pending_to_posted(
      posted,
      migration([pendingSplit({ suspended_outflow_pin_id: "bill_1", outflow_pinned_period_id: "2026M06" })])
    );
    expect(out.splits[0]).toMatchObject({ suspended_outflow_pin_id: "bill_1", outflow_pinned_period_id: "2026M06" });
  });
});

describe("merge_pending_to_posted — manual income pin (Convert-To-Recurring Phase 2)", () => {
  it("carries a manual income pin (id + marker) to the posted split", () => {
    const out = merge_pending_to_posted(
      posted,
      migration([pendingSplit({ inflow_assignment_source: "manual", inflow_id: "income_1" })])
    );
    expect(out.splits[0]).toMatchObject({ inflow_assignment_source: "manual", inflow_id: "income_1" });
  });
  it("adds nothing for a split that was never pinned", () => {
    const out = merge_pending_to_posted(posted, migration([pendingSplit()]));
    expect("inflow_assignment_source" in out.splits[0]).toBe(false);
    expect("inflow_id" in out.splits[0]).toBe(false);
  });
});
