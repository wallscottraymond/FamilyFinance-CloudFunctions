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
  it("assign_category is the user's own pick on every split (first slug — canon M5)", () => {
    const t = txn({ splits: [split({ split_id: "a" }), split({ split_id: "b" })] });
    const out = apply_rule_intents(t, intents({ assign_category: "eating_out", applied_rule_ids: ["r"] }));
    for (const s of out.splits) {
      expect(s.category_source).toBe("user");
      expect(s.first_category_id).toBe("eating_out");
      expect(s.second_category_id).toBeNull();
      expect(s.internal_primary_category).toBeNull(); // legacy field never written
    }
    expect(out.internal_primary_category).toBeNull();
  });

  it("a split spec's category is a pick on that split; the remainder takes the rule's", () => {
    const out = apply_rule_intents(
      txn(),
      intents({
        assign_category: "shopping",
        split: [{ percent: 50, category: "groceries" }],
        applied_rule_ids: ["r"],
      })
    );
    expect(out.splits.map((s) => s.first_category_id)).toEqual(["groceries", "shopping"]);
    expect(out.splits.every((s) => s.category_source === "user")).toBe(true);
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

  // Code-Health-Review A1-H1: specs are unbounded user input. A split must never exceed what's
  // left of the transaction, must follow the transaction's sign, and the remainder is never
  // negative (a "$50 to Groceries" rule on a $30 purchase used to give +$50 and a -$20 remainder).
  describe("split bounds (A1-H1)", () => {
    const amounts = (t: TransactionForPersistence) =>
      apply_rule_intents(t, intents({ split: SPECS, applied_rule_ids: ["r"] })).splits.map((s) => s.amount);
    let SPECS: Array<{ percent?: number; amount?: number }> = [];

    it("a fixed amount larger than the purchase is capped at the purchase (no negative remainder)", () => {
      SPECS = [{ amount: 50 }];
      expect(amounts(txn({ amount: 30, splits: [split({ amount: 30 })] }))).toEqual([30]);
    });

    it("fixed amounts that add up to more than the purchase: the last one gets what's left", () => {
      SPECS = [{ amount: 20 }, { amount: 20 }];
      expect(amounts(txn({ amount: 30, splits: [split({ amount: 30 })] }))).toEqual([20, 10]);
    });

    it("a spec after the purchase is fully allocated makes no zero split", () => {
      SPECS = [{ amount: 30 }, { amount: 10 }];
      expect(amounts(txn({ amount: 30, splits: [split({ amount: 30 })] }))).toEqual([30]);
    });

    it("percents adding up to more than 100 are capped at the total", () => {
      SPECS = [{ percent: 70 }, { percent: 70 }];
      expect(amounts(txn({ amount: 100, splits: [split({ amount: 100 })] }))).toEqual([70, 30]);
    });

    it("a percent above 100 is capped at the total", () => {
      SPECS = [{ percent: 150 }];
      expect(amounts(txn({ amount: 80, splits: [split({ amount: 80 })] }))).toEqual([80]);
    });

    it("negative or zero specs are ignored (the whole amount stays in the remainder)", () => {
      SPECS = [{ amount: -10 }, { percent: -20 }, { amount: 0 }, { percent: 0 }];
      expect(amounts(txn({ amount: 40, splits: [split({ amount: 40 })] }))).toEqual([40]);
    });

    it("a refund (negative total) with a fixed amount keeps the refund's sign", () => {
      SPECS = [{ amount: 25 }];
      expect(amounts(txn({ amount: -40, splits: [split({ amount: -40 })] }))).toEqual([-25, -15]);
    });

    it("a refund with a percent keeps the refund's sign", () => {
      SPECS = [{ percent: 50 }];
      expect(amounts(txn({ amount: -40, splits: [split({ amount: -40 })] }))).toEqual([-20, -20]);
    });

    it("a refund smaller than a fixed amount is capped at the refund", () => {
      SPECS = [{ amount: 50 }];
      expect(amounts(txn({ amount: -30, splits: [split({ amount: -30 })] }))).toEqual([-30]);
    });

    it("cents: 3 × 33.33% of $10 leaves a 1-cent remainder, never a negative one", () => {
      SPECS = [{ percent: 33.33 }, { percent: 33.33 }, { percent: 33.33 }];
      const out = amounts(txn({ amount: 10, splits: [split({ amount: 10 })] }));
      expect(out).toEqual([3.33, 3.33, 3.33, 0.01]);
    });

    it("a $0 transaction keeps its split (a split rule never leaves it with none)", () => {
      SPECS = [{ percent: 50 }, { amount: 10 }];
      const out = apply_rule_intents(
        txn({ amount: 0, splits: [split({ amount: 0 })] }),
        intents({ split: SPECS, applied_rule_ids: ["r"] })
      );
      expect(out.splits).toHaveLength(1);
      expect(out.splits[0].amount).toBe(0);
    });

    it("invariant over many random specs: splits sum to the total, none crosses zero, none is zero", () => {
      let seed = 42;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
      for (let run = 0; run < 500; run++) {
        const total = Math.round((rnd() * 400 - 100) * 100) / 100 || 1;
        SPECS = Array.from({ length: 1 + Math.floor(rnd() * 4) }, () =>
          rnd() < 0.5
            ? { percent: Math.round((rnd() * 160 - 30) * 100) / 100 }
            : { amount: Math.round((rnd() * 300 - 50) * 100) / 100 }
        );
        const out = amounts(txn({ amount: total, splits: [split({ amount: total })] }));
        const sum = Math.round(out.reduce((a, b) => a + b, 0) * 100) / 100;
        expect({ run, total, sum }).toEqual({ run, total, sum: total });
        for (const a of out) {
          expect({ run, total, a, sameSign: Math.sign(a) === Math.sign(total) }).toEqual(
            { run, total, a, sameSign: true }
          );
        }
      }
    });
  });

  it("DEFERRED intent make_recurring does not change the txn here (orchestrator handles it)", () => {
    const t = txn();
    const out = apply_rule_intents(t, intents({ make_recurring: "outflow", applied_rule_ids: ["r"] }));
    expect(out.splits[0].budget_id).toBe("unassigned");
    expect(out.type).toBe("expense");
  });

  it("add_tag unions tag ids onto every split (deduped, existing preserved)", () => {
    const t = txn({ splits: [split({ tags: ["existing"] }), split({ split_id: "s2", tags: ["dup"] })] });
    const out = apply_rule_intents(t, intents({ add_tag: ["dup", "new"], applied_rule_ids: ["r"] }));
    expect(out.splits[0].tags).toEqual(["existing", "dup", "new"]); // applies to every split
    expect(out.splits[1].tags).toEqual(["dup", "new"]); // "dup" not duplicated
  });

  it("add_tag alone (no other action) still applies", () => {
    const t = txn();
    const out = apply_rule_intents(t, intents({ add_tag: ["x"] }));
    expect(out.splits[0].tags).toEqual(["x"]);
  });

  it("add_tag on a split action carries tags onto materialized splits", () => {
    const t = txn({ amount: 100, splits: [split({ amount: 100 })] });
    const out = apply_rule_intents(
      t, intents({ split: [{ percent: 50 }], add_tag: ["x"], applied_rule_ids: ["r"] })
    );
    expect(out.splits.every((s) => s.tags.includes("x"))).toBe(true);
  });
});

import { only_known_categories } from "../rule_application.service";

describe("only_known_categories (canon C1)", () => {
  const known = (s: string) => ["eating_out", "groceries"].includes(s);
  it("keeps a known first slug, drops an unknown / display-name value", () => {
    expect(only_known_categories({ applied_rule_ids: ["r"], assign_category: "eating_out" }, known).assign_category).toBe("eating_out");
    expect(only_known_categories({ applied_rule_ids: ["r"], assign_category: "Coffee" }, known).assign_category).toBeUndefined();
  });
  it("cleans split specs the same way", () => {
    const r = only_known_categories(
      { applied_rule_ids: ["r"], split: [{ percent: 50, category: "groceries" }, { percent: 50, category: "Nope" }] },
      known
    );
    expect(r.split!.map((s) => s.category)).toEqual(["groceries", undefined]);
  });
});

import { with_income_category } from "../rule_application.service";

describe("with_income_category — 'Mark as income' makes it income, not a refund (X13)", () => {
  it("sets the income category when the rule sets none", () => {
    const r = with_income_category({ applied_rule_ids: ["r"], mark_income: true }, "other_income");
    expect(r.assign_category).toBe("other_income");
    const out = apply_rule_intents(txn({ amount: -250 }), r);
    expect(out.type).toBe("income");
    expect(out.splits.every((s) => s.category_source === "user" && s.first_category_id === "other_income")).toBe(true);
  });
  it("a rule's own category wins; no mark_income → unchanged", () => {
    expect(with_income_category({ applied_rule_ids: ["r"], mark_income: true, assign_category: "paycheck" }, "other_income").assign_category).toBe("paycheck");
    const none = { applied_rule_ids: ["r"] };
    expect(with_income_category(none, "other_income")).toBe(none);
  });
});
