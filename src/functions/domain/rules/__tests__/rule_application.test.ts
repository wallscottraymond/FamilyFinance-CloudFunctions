/**
 * apply_rule_intents — Unit Tests (PURE, no emulator).
 *
 * Pins the field-set application semantics: category/ignore/refund/income + rule-id tracking,
 * immutability of the input, the referential no-op path, and that DEFERRED intents
 * (assign_budget_id / make_recurring) do NOT alter the transaction here.
 */

import { apply_rule_intents } from "../rule_application.service";
import { RuleActionIntents } from "../../../types/rules.types";
import {
  TransactionForPersistence,
  TransactionSplitForPersistence,
} from "../../../types/plaid/transaction_sync.types";

const DATE = new Date(Date.UTC(2026, 8, 15));

function split(over: Partial<TransactionSplitForPersistence> = {}): TransactionSplitForPersistence {
  return {
    split_id: "s1",
    amount: 42.5,
    budget_id: "unassigned",
    outflow_id: null,
    monthly_period_id: null,
    weekly_period_id: null,
    bi_weekly_period_id: null,
    plaid_primary_category: "FOOD_AND_DRINK",
    plaid_detailed_category: "FOOD_AND_DRINK_COFFEE",
    internal_primary_category: null,
    internal_detailed_category: null,
    is_default: true,
    is_ignored: false,
    is_refund: false,
    is_tax_deductible: false,
    payment_date: DATE,
    tags: [],
    rules: [],
    ...over,
  };
}

function txn(over: Partial<TransactionForPersistence> = {}): TransactionForPersistence {
  return {
    transaction_id: "plaid_1",
    user_id: "u1",
    group_ids: [],
    is_active: true,
    plaid_item_id: "item1",
    account_id: "acct1",
    amount: 42.5,
    currency: "USD",
    transaction_date: DATE,
    name: "BLUE BOTTLE",
    merchant_name: "Blue Bottle",
    is_pending: false,
    pending_transaction_id: null,
    type: "expense",
    source: "plaid",
    plaid_primary_category: "FOOD_AND_DRINK",
    plaid_detailed_category: "FOOD_AND_DRINK_COFFEE",
    internal_primary_category: null,
    internal_detailed_category: null,
    splits: [split()],
    initial_plaid_data: {
      plaid_account_id: "acct1",
      plaid_merchant_name: "Blue Bottle",
      plaid_name: "BLUE BOTTLE",
      plaid_transaction_id: "1",
      plaid_pending: false,
    },
    ...over,
  };
}

const intents = (over: Partial<RuleActionIntents> = {}): RuleActionIntents => ({
  applied_rule_ids: [],
  ...over,
});

describe("apply_rule_intents", () => {
  it("assign_category sets internal_primary_category on the txn AND every split", () => {
    const t = txn({ splits: [split({ split_id: "a" }), split({ split_id: "b" })] });
    const out = apply_rule_intents(t, intents({ assign_category: "Coffee", applied_rule_ids: ["r"] }));
    expect(out.internal_primary_category).toBe("Coffee");
    expect(out.splits.map((s) => s.internal_primary_category)).toEqual(["Coffee", "Coffee"]);
  });

  it("ignore sets is_ignored on every split", () => {
    const out = apply_rule_intents(txn(), intents({ ignore: true, applied_rule_ids: ["r"] }));
    expect(out.splits.every((s) => s.is_ignored)).toBe(true);
  });

  it("mark_refund sets is_refund on every split", () => {
    const out = apply_rule_intents(txn(), intents({ mark_refund: true, applied_rule_ids: ["r"] }));
    expect(out.splits.every((s) => s.is_refund)).toBe(true);
  });

  it("mark_income sets txn type to income (amount/sign untouched)", () => {
    const out = apply_rule_intents(txn({ amount: -250 }), intents({ mark_income: true, applied_rule_ids: ["r"] }));
    expect(out.type).toBe("income");
    expect(out.amount).toBe(-250);
  });

  it("require_review / require_note set the non-blocking txn flags", () => {
    const out = apply_rule_intents(
      txn(),
      intents({ require_review: true, require_note: true, applied_rule_ids: ["r"] })
    );
    expect(out.needs_review).toBe(true);
    expect(out.needs_note).toBe(true);
  });

  it("flags are absent (not false) when not required", () => {
    const out = apply_rule_intents(txn(), intents({ ignore: true, applied_rule_ids: ["r"] }));
    expect(out.needs_review).toBeUndefined();
    expect(out.needs_note).toBeUndefined();
  });

  it("applied_rule_ids are unioned into split.rules (dedup, preserving existing)", () => {
    const t = txn({ splits: [split({ rules: ["existing"] })] });
    const out = apply_rule_intents(t, intents({ applied_rule_ids: ["existing", "new"] }));
    expect(out.splits[0].rules).toEqual(["existing", "new"]);
  });

  it("returns the SAME reference when no applicable intents (referential no-op)", () => {
    const t = txn();
    expect(apply_rule_intents(t, intents())).toBe(t);
  });

  it("does NOT mutate the input transaction or its splits", () => {
    const t = txn();
    const before = JSON.parse(JSON.stringify(t));
    apply_rule_intents(t, intents({ assign_category: "X", ignore: true, mark_refund: true, mark_income: true, applied_rule_ids: ["r"] }));
    expect(JSON.parse(JSON.stringify(t))).toEqual(before);
  });

  it("assign_budget_id pins the budget as a durable 'manual' assignment on every split", () => {
    const t = txn({ splits: [split({ split_id: "a" }), split({ split_id: "b" })] });
    const out = apply_rule_intents(t, intents({ assign_budget_id: "budget_x", applied_rule_ids: ["r"] }));
    expect(out.splits.map((s) => s.budget_id)).toEqual(["budget_x", "budget_x"]);
    expect(out.splits.every((s) => s.budget_assignment_source === "manual")).toBe(true);
  });

  it("split by percent replaces splits + adds an unassigned remainder (sums to total)", () => {
    const t = txn({ amount: 100, splits: [split({ amount: 100 })] });
    const out = apply_rule_intents(
      t,
      intents({ split: [{ percent: 70, budget_id: "b1" }], applied_rule_ids: ["r"] })
    );
    expect(out.splits).toHaveLength(2);
    expect(out.splits[0].amount).toBe(70);
    expect(out.splits[0].budget_id).toBe("b1");
    expect(out.splits[0].budget_assignment_source).toBe("manual");
    expect(out.splits[1].amount).toBe(30); // remainder
    expect(out.splits[1].budget_id).toBe("unassigned");
    const sum = out.splits.reduce((s, sp) => s + sp.amount, 0);
    expect(sum).toBe(100);
  });

  it("split covering 100% adds no remainder", () => {
    const t = txn({ amount: 100, splits: [split({ amount: 100 })] });
    const out = apply_rule_intents(
      t,
      intents({ split: [{ percent: 60 }, { percent: 40 }], applied_rule_ids: ["r"] })
    );
    expect(out.splits).toHaveLength(2);
    expect(out.splits.reduce((s, sp) => s + sp.amount, 0)).toBe(100);
  });

  it("split by fixed amount adds a remainder for the leftover", () => {
    const t = txn({ amount: 100, splits: [split({ amount: 100 })] });
    const out = apply_rule_intents(t, intents({ split: [{ amount: 25 }], applied_rule_ids: ["r"] }));
    expect(out.splits.map((s) => s.amount)).toEqual([25, 75]);
  });

  it("DEFERRED intent make_recurring does not change the txn here (orchestrator handles it)", () => {
    const t = txn();
    const out = apply_rule_intents(t, intents({ make_recurring: "outflow", applied_rule_ids: ["r"] }));
    expect(out.splits[0].budget_id).toBe("unassigned");
    expect(out.type).toBe("expense");
  });
});
