/**
 * "As it comes" income (Budget-And-Bill-Detail-Pages D24): a named income with no planned checks
 * that counts only the deposits labelled with it.
 */
/* eslint-disable @typescript-eslint/naming-convention -- Firestore field names */
import { build_manual_inflow } from "../manual_inflow.service";
import { build_expected_occurrences } from "../expected_occurrences.service";
import { reconcile_income_occurrences } from "../reconcile_occurrences.service";

const base = {
  id: "manual_sd", user_id: "user_1", name: "Savings draw", amount: 0,
  frequency: "monthly" as const, description: null, income_type: "other",
  is_regular_salary: false, income_variability: "variable", hourly_config: null,
  commission_config: null, bonus_config: null, variable_config: null,
  account_id: "acct_1", vendor_key: null, now_ms: Date.UTC(2026, 10, 13),
  first_expected_ms: Date.UTC(2026, 10, 13),
};

describe("as it comes income", () => {
  it("may be created at $0 and stores the flag; any other income still can't", () => {
    const made = build_manual_inflow({ ...base, as_it_comes: true });
    expect(made.errors).toBeUndefined();
    const extras = (made.inflow as unknown as Record<string, unknown>).income_extras;
    expect(extras).toMatchObject({ asItComes: true });
    expect(build_manual_inflow({ ...base }).errors).toBeDefined();
  });

  it("plans no checks, so its deposits are exactly what it received", () => {
    const r = {
      id: "manual_sd",
      kind: "inflow" as const,
      as_it_comes: true,
      schedule: {
        frequency: "monthly", average_amount: 0, first_date: null, last_date: null,
        predicted_next_date: null, source: "manual",
      },
    };
    const start = Date.UTC(2026, 10, 1);
    const end = Date.UTC(2026, 10, 30, 23, 59, 59);
    const expected = build_expected_occurrences(r as never, start, end);
    expect(expected).toEqual([]);
    const deposits = [
      { transaction_id: "t1", split_id: "s1", date_ms: Date.UTC(2026, 10, 3), amount: 400 },
      { transaction_id: "t2", split_id: "s2", date_ms: Date.UTC(2026, 10, 9), amount: 500 },
      { transaction_id: "t3", split_id: "s3", date_ms: Date.UTC(2026, 10, 11), amount: 300 },
    ];
    const got = reconcile_income_occurrences("manual_sd", deposits, expected, start, end);
    expect(got.map((o) => [o.amount_paid, o.is_paid])).toEqual([
      [400, true], [500, true], [300, true],
    ]);
  });
});
