/**
 * Review round 5 defects 3 + 4 (D28 stored carry): stored reconcile carries EXACTLY what the
 * derive's own matcher (`reconcile_occurrences`) assigns to a suppressed occurrence — so stored
 * periods and the period page count the same payments. PURE.
 *   test 3 — two early payments for one suppressed occurrence: one carried, as the page;
 *   test 4 — a payment exactly 7 days from a kept and a suppressed occurrence: the tie breaks the
 *            derive's way (the earlier, kept one), and an occurrence already paid is skipped.
 */
import { carried_payments } from "../period_reconciliation.service";
import { reconcile_occurrences } from "../reconcile_occurrences.service";
import { keep_unsuppressed } from "../../periods/period_view.service";
import type { RemovalInterval } from "../recurring_suppression.service";

const D = (s: string) => Date.parse(`${s}T00:00:00Z`);
const iv: RemovalInterval[] = [{ from_ms: D("2037-10-01"), to_ms: null, mode: "going_forward" }];
// Monthly periods (dues the 3rd + 17th: twice a month), Oct off (removed from Oct 1).
const periods = [
  { period_id: "Sep", start_ms: D("2037-09-01"), end_ms: D("2037-10-01") - 1, occurrence_due_dates_ms: [D("2037-09-03"), D("2037-09-17")] },
  { period_id: "Oct", start_ms: D("2037-10-01"), end_ms: D("2037-11-01") - 1, occurrence_due_dates_ms: [D("2037-10-01"), D("2037-10-15")] },
];
const SEP = { start: D("2037-09-01"), end: D("2037-10-01") - 1 };

/** What the derive's Sep view keeps carried: the payment dates of occurrences moved to their payment. */
function derive_carried(pays: number[]): number[] {
  // The Sep view's expected occurrences + the D28 look-ahead (a suppressed one within 7 days).
  const exp = [D("2037-09-03"), D("2037-09-17"), D("2037-10-01")]
    .map((d, i) => ({ occurrence_id: `o${i}`, recurring_id: "r", due_date_ms: d, amount_due: 10 }));
  const rec = reconcile_occurrences(exp, pays.map((ms, i) => ({ transaction_id: `p${i}`, split_id: null, date_ms: ms, amount: 10 })));
  return keep_unsuppressed(rec, iv, SEP.start, SEP.end)
    .filter((o) => o.payment_date_ms !== null && o.due_date_ms === o.payment_date_ms && o.due_date_ms !== D("2037-09-03") && o.due_date_ms !== D("2037-09-17"))
    .map((o) => o.payment_date_ms!);
}
const stored_carried = (pays: number[]) =>
  carried_payments(periods, pays.map((ms) => ({ date_ms: ms, amount: 10 })), iv).map((c) => pays[c.index]);

describe("round 5 test 3 — two early payments for one suppressed occurrence", () => {
  it("stored carries exactly the one the derive's matcher gives it (was: both)", () => {
    const pays = [D("2037-09-03"), D("2037-09-17"), D("2037-09-29"), D("2037-09-30")];
    expect(derive_carried(pays)).toEqual([D("2037-09-29")]);
    expect(stored_carried(pays)).toEqual(derive_carried(pays));
    const c = carried_payments(periods, pays.map((ms) => ({ date_ms: ms, amount: 10 })), iv);
    expect(c).toEqual([{ index: 2, period_id: "Sep", carried_due_ms: D("2037-10-01") }]);
  });

  it("a refund / zero payment never carries (the page drops it before matching)", () => {
    expect(carried_payments(periods, [{ date_ms: D("2037-09-29"), amount: -10 }, { date_ms: D("2037-09-30"), amount: 0 }], iv)).toEqual([]);
  });
});

describe("round 5 test 4 — a tie at exactly 7 days, and an occurrence already paid", () => {
  it("Sep 24: 7 days after Sep 17 (kept, unpaid) and 7 before Oct 1 (suppressed) → the kept one, as the derive (was: carried)", () => {
    const pays = [D("2037-09-03"), D("2037-09-24")];
    expect(derive_carried(pays)).toEqual([]);
    expect(stored_carried(pays)).toEqual([]);
  });

  it("Sep 17 already paid → Sep 24 pays Oct 1 early, in both (the matcher skips a paid occurrence)", () => {
    const pays = [D("2037-09-03"), D("2037-09-17"), D("2037-09-24")];
    expect(derive_carried(pays)).toEqual([D("2037-09-24")]);
    expect(stored_carried(pays)).toEqual(derive_carried(pays));
  });
});
