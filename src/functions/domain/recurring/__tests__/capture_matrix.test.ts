/**
 * Configuration matrix (Convert-To-Recurring test plan G) for the capture planner — every
 * combination of: flag (off / on) × record age (none / old / v2) × Plaid status (MATURE /
 * EARLY_DETECTION / UNKNOWN / TOMBSTONED) × frequency (known / UNKNOWN) × direction (bill / income)
 * × Plaid active (yes / no) × account type (checking / savings / credit / loan) × category (bill /
 * income / transfer / card payment) — checked against an independent oracle of the rules.
 */
import { plan_recurring_capture, PlannerRecord, PlannerStream } from "../recurring_capture_planner.service";
import type { OutflowForPersistence } from "../../../integrations/plaid/plaid_recurring_transformer";

const NOW = Date.UTC(2026, 9, 15);
const FLAGS = [false, true];
const AGES = ["none", "old", "v2"] as const;
const STATUSES = ["MATURE", "EARLY_DETECTION", "UNKNOWN", "TOMBSTONED"];
const FREQS = ["MONTHLY", "UNKNOWN"];
const DIRS = ["outflow", "inflow"] as const;
const ACTIVE = [true, false];
const ACCOUNTS = ["depository", "credit", "loan"];
const CATS = ["LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", "INCOME_WAGES", "TRANSFER_OUT_ACCOUNT_TRANSFER", "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"];

type Expect = { saved: boolean; stamped: boolean; active?: boolean; hidden?: boolean; item: string | null; held: boolean };

function oracle(flag: boolean, age: string, status: string, freq: string, dir: string, active: boolean, acct: string, cat: string): Expect {
  if (age === "old") return { saved: true, stamped: false, active, item: null, held: false };
  if (age === "v2") return { saved: true, stamped: false, active: true, item: active ? null : "still_a_bill", held: false };
  if (!flag || !active) return { saved: true, stamped: false, active, item: null, held: false };
  if (status === "TOMBSTONED") return { saved: false, stamped: false, item: null, held: true };
  const low = status !== "MATURE" || freq === "UNKNOWN";
  if (low) {
    const transfer = cat.startsWith("TRANSFER_");
    const income_ok = dir === "outflow" || (cat.startsWith("INCOME") && acct !== "credit" && acct !== "loan");
    return { saved: false, stamped: false, item: !transfer && income_ok ? "suggested" : null, held: true };
  }
  return { saved: true, stamped: true, active: true, hidden: dir === "inflow" && cat === "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", item: null, held: false };
}

describe("capture planner — configuration matrix (G)", () => {
  let cases = 0;
  it("every combination matches the oracle", () => {
    for (const flag of FLAGS) for (const age of AGES) for (const status of STATUSES) for (const freq of FREQS)
      for (const dir of DIRS) for (const active of ACTIVE) for (const acct of ACCOUNTS) for (const cat of CATS) {
        const id = "s1";
        const entity = { id, is_active: active, is_hidden: false, frequency: "monthly", transaction_ids: ["t1"],
          plaid_detailed_category: cat } as unknown as OutflowForPersistence;
        const stream: PlannerStream = {
          direction: dir, stream_id: id, entity, raw_status: status, raw_frequency: freq, raw_is_active: active,
          account_id: "a", account_type: acct, merchant_name: "Vendor", description: "VENDOR", detailed_category: cat,
          transaction_ids: ["t1"], average_amount: 10, predicted_next_ms: null, first_date_ms: NOW - 1e9,
        };
        const rec: PlannerRecord = {
          id, direction: dir, is_active: true, is_hidden: false, v2: age === "v2", plaid_is_active: age === "v2" ? true : null,
          plaid_inactive_ack_ms: null, merged_into_id: null, account_id: "a", plaid_item_id: "i", source: "plaid",
          name: "Vendor", merchant_name: "Vendor", description: "VENDOR", average_amount: 10, frequency: "monthly",
          plaid_status: "MATURE", plaid_detailed_category: cat, first_date_ms: NOW - 2e9, last_date_ms: NOW - 1e9,
          removal_intervals: [], transaction_ids: ["t1"],
        };
        const plan = plan_recurring_capture({
          user_id: "u", plaid_item_doc_id: "i", now_ms: NOW, flag_on: flag, streams: [stream],
          existing: age === "none" ? new Map() : new Map([[id, rec]]), stale_candidates: [], review_items: new Map(), state: null,
          same_bill: { candidates: [], active_account_ids: new Set(["a"]), inactive_loaded: true },
        });
        const saved = [...plan.save_outflows, ...plan.save_inflows];
        const got: Expect = {
          saved: saved.length === 1,
          stamped: saved[0]?.capture_rules_version === 2,
          ...(saved.length ? { active: saved[0].is_active } : {}),
          ...(saved[0]?.capture_rules_version === 2 ? { hidden: saved[0].is_hidden } : {}),
          item: plan.review_items[0]?.kind ?? null,
          held: (plan.state_change.add_suppressed ?? []).includes("t1"),
        };
        const want = oracle(flag, age, status, freq, dir, active, acct, cat);
        expect([{ flag, age, status, freq, dir, active, acct, cat }, got]).toEqual([{ flag, age, status, freq, dir, active, acct, cat }, want]);
        cases++;
      }
    expect(cases).toBe(2 * 3 * 4 * 2 * 2 * 2 * 3 * 4);
  });
});
