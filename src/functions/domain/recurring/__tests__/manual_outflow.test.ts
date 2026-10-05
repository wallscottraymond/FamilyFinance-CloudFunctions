/**
 * Manual Outflow — Domain Unit Tests
 *
 * Pure functions, no mocks. Verifies the bill a user creates by hand is valid,
 * stored in the derive-readable shape, and produces the expected occurrences on
 * the period page.
 */

import { Timestamp } from "firebase-admin/firestore";
import {
  build_manual_outflow,
  compute_manual_next_due_date,
  ManualOutflowRequest,
} from "../manual_outflow.service";
import { generate_expected_occurrences_in_window } from "../../outflows/outflow_period.service";

const utc = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d);
const iso = (d: Date) => d.toISOString().slice(0, 10);

const base: ManualOutflowRequest = {
  id: "manual_test",
  user_id: "user_1",
  name: "Netflix",
  merchant_name: null,
  amount: 15.49,
  frequency: "monthly",
  expense_type: "subscription",
  is_essential: false,
  due_day: 20,
  now_ms: utc(2026, 10, 5),
};

describe("compute_manual_next_due_date", () => {
  it("uses this month's due day when it hasn't passed", () => {
    expect(iso(compute_manual_next_due_date("monthly", 20, utc(2026, 10, 5)))).toBe("2026-10-20");
  });

  it("uses today when the due day is today", () => {
    expect(iso(compute_manual_next_due_date("monthly", 5, utc(2026, 10, 5)))).toBe("2026-10-05");
  });

  it("rolls to next month when the due day has passed", () => {
    expect(iso(compute_manual_next_due_date("monthly", 1, utc(2026, 10, 5)))).toBe("2026-11-01");
  });

  it("rolls over the year end", () => {
    expect(iso(compute_manual_next_due_date("monthly", 3, utc(2026, 12, 10)))).toBe("2027-01-03");
  });

  it("clamps a 31st due day to a short month", () => {
    expect(iso(compute_manual_next_due_date("monthly", 31, utc(2026, 2, 10)))).toBe("2026-02-28");
    expect(iso(compute_manual_next_due_date("monthly", 31, utc(2026, 4, 30)))).toBe("2026-04-30");
  });

  it("clamps when rolling into a short month", () => {
    expect(iso(compute_manual_next_due_date("monthly", 30, utc(2027, 1, 31)))).toBe("2027-02-28");
  });

  it("uses today for non-monthly frequencies", () => {
    for (const f of ["weekly", "biweekly", "quarterly", "yearly"] as const) {
      expect(iso(compute_manual_next_due_date(f, null, utc(2026, 10, 5)))).toBe("2026-10-05");
    }
  });
});

describe("build_manual_outflow — validation", () => {
  it("rejects a blank name", () => {
    expect(build_manual_outflow({ ...base, name: "   " }).validation_errors).toContain(
      "Bill name is required"
    );
  });

  it("rejects a non-positive amount", () => {
    expect(build_manual_outflow({ ...base, amount: 0 }).validation_errors).toContain(
      "Amount must be greater than zero"
    );
  });

  it("requires a due day for monthly bills", () => {
    expect(build_manual_outflow({ ...base, due_day: null }).validation_errors).toContain(
      "Due day must be between 1 and 31"
    );
  });

  it("doesn't require a due day for other frequencies", () => {
    expect(build_manual_outflow({ ...base, frequency: "weekly", due_day: null }).entity).toBeDefined();
  });
});

describe("build_manual_outflow — stored shape", () => {
  const entity = build_manual_outflow(base).entity!;

  it("is owned, active, visible and manual (what derive filters on)", () => {
    expect(entity.owner_id).toBe("user_1");
    expect(entity.is_active).toBe(true);
    expect(entity.is_hidden).toBe(false);
    expect(entity.source).toBe("manual");
  });

  it("is not tied to any Plaid item, so Plaid sync never touches it", () => {
    expect(entity.plaid_item_id).toBe("");
    expect(entity.account_id).toBe("");
  });

  it("anchors the schedule on the next due date", () => {
    expect(iso(entity.predicted_next_date!)).toBe("2026-10-20");
    expect(iso(entity.first_date)).toBe("2026-10-20");
  });

  it("uses the name for display and the merchant (when given) for matching", () => {
    expect(entity.user_custom_name).toBe("Netflix");
    const with_merchant = build_manual_outflow({ ...base, merchant_name: " NETFLIX.COM " }).entity!;
    expect(with_merchant.merchant_name).toBe("NETFLIX.COM");
  });
});

describe("derive-on-read sees the bill", () => {
  const schedule_for = (req: ManualOutflowRequest) => {
    const e = build_manual_outflow(req).entity!;
    return {
      frequency: e.frequency,
      average_amount: e.average_amount,
      first_date: Timestamp.fromDate(e.first_date),
      last_date: Timestamp.fromDate(e.last_date),
      predicted_next_date: e.predicted_next_date ? Timestamp.fromDate(e.predicted_next_date) : null,
      source: e.source,
    };
  };

  it("doesn't show the bill in months before it was created", () => {
    const occ = generate_expected_occurrences_in_window(
      schedule_for(base),
      utc(2026, 9, 1),
      utc(2026, 9, 30)
    );
    expect(occ).toHaveLength(0);
  });

  it("keeps backward placement for Plaid streams (their history is real)", () => {
    const occ = generate_expected_occurrences_in_window(
      { ...schedule_for(base), source: "plaid" },
      utc(2026, 9, 1),
      utc(2026, 9, 30)
    );
    expect(occ).toHaveLength(1);
  });

  it("places a monthly bill once in its due month, on its due day", () => {
    const occ = generate_expected_occurrences_in_window(
      schedule_for(base),
      utc(2026, 10, 1),
      utc(2026, 10, 31)
    );
    expect(occ).toHaveLength(1);
    expect(new Date(occ[0].due_date_ms).toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(occ[0].amount_due).toBeCloseTo(15.49);
  });

  it("repeats into the next month", () => {
    const occ = generate_expected_occurrences_in_window(
      schedule_for(base),
      utc(2026, 11, 1),
      utc(2026, 11, 30)
    );
    expect(occ.map((o) => new Date(o.due_date_ms).toISOString().slice(0, 10))).toEqual([
      "2026-11-20",
    ]);
  });

  it("places a bi-weekly bill (app spelling normalized) about twice a month", () => {
    const occ = generate_expected_occurrences_in_window(
      schedule_for({ ...base, frequency: "biweekly", due_day: null }),
      utc(2026, 10, 1),
      utc(2026, 10, 31)
    );
    expect(occ.length).toBeGreaterThanOrEqual(2);
  });
});
