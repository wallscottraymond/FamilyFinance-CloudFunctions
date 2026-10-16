/**
 * Top-25 #23 — seeded property test on the capture planner + the review-state reducer (inline
 * mulberry32 PRNG, no new dependency). A simulated world of Plaid streams (status / frequency /
 * active flips, validation rejects, account removals), pre-existing OLD records, the flag
 * toggling, and the user answering items between syncs. After EVERY sync:
 *   1. a saved stream's ids are never held out;
 *   2. the identical input again produces no change (no item to write, no state change);
 *   3. an OLD record is never stamped, never marked Plaid-inactive, and keeps today's stale handling;
 *   4. each item is written at most once per sync (one content per id);
 *   5. a v2 record is never stale-marked.
 * The world mirrors the orchestrator: `existing` = records of the VALID streams, stale candidates =
 * this item's active records not among them.
 */
import {
  CapturePlanInput,
  PlannerRecord,
  PlannerStream,
  plan_recurring_capture,
} from "../recurring_capture_planner.service";
import {
  RecurringReviewState,
  ReviewItem,
  apply_review_state_change,
  changed_items,
} from "../review_item.service";
import { plan_review_answer } from "../review_answer.service";
import type { OutflowForPersistence } from "../../../integrations/plaid/plaid_recurring_transformer";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const U = "u1";
const ITEM = "item";
const DAY = 86400000;
const T0 = Date.UTC(2026, 9, 1, 12);

interface StreamSpec {
  id: string;
  direction: "outflow" | "inflow";
  vendor: string;
  category: string;
  account: string;
  txns: string[];
  status: string;
  frequency: string;
  active: boolean;
  present: boolean;
  rejected: boolean;
}

const entity = (s: StreamSpec, now: number): OutflowForPersistence => ({
  id: s.id, owner_id: U, created_by: U, updated_by: U, group_ids: [], plaid_item_id: ITEM, plaid_stream_id: s.id,
  account_id: s.account, last_amount: 10, average_amount: 10, currency: "USD", description: s.vendor.toUpperCase(),
  merchant_name: s.vendor, user_custom_name: null, frequency: "monthly", first_date: new Date(now - 200 * DAY),
  last_date: new Date(now - 5 * DAY), predicted_next_date: null, plaid_primary_category: "X",
  plaid_detailed_category: s.category, internal_primary_category: null, internal_detailed_category: null,
  expense_type: "loan", is_essential: true, status: "pending_review", source: "plaid", plaid_status: s.status,
  plaid_confidence_level: null, is_active: s.active, is_hidden: false, is_user_modified: false, transaction_ids: s.txns,
  tags: [], rules: [],
});

const to_stream = (s: StreamSpec, now: number): PlannerStream => ({
  direction: s.direction, stream_id: s.id, entity: s.rejected ? null : entity(s, now), raw_status: s.status,
  raw_frequency: s.frequency, raw_is_active: s.active, account_id: s.account, account_type: "depository",
  merchant_name: s.vendor, description: s.vendor.toUpperCase(), detailed_category: s.category, transaction_ids: s.txns,
  average_amount: 10, predicted_next_ms: null, first_date_ms: now - 200 * DAY,
});

const record_from = (e: OutflowForPersistence, dir: "outflow" | "inflow", prev: PlannerRecord | undefined): PlannerRecord => ({
  id: e.id, direction: dir, is_active: e.is_active, is_hidden: e.is_hidden === true,
  v2: prev?.v2 === true || (e as { capture_rules_version?: number }).capture_rules_version === 2,
  plaid_is_active: (e as { plaid_is_active?: boolean }).plaid_is_active ?? prev?.plaid_is_active ?? null,
  plaid_inactive_ack_ms: prev?.plaid_inactive_ack_ms ?? null, merged_into_id: null, account_id: e.account_id,
  plaid_item_id: ITEM, source: "plaid", name: e.merchant_name ?? e.id, merchant_name: e.merchant_name, description: e.description,
  average_amount: e.average_amount, frequency: e.frequency, plaid_status: e.plaid_status, plaid_detailed_category: e.plaid_detailed_category,
  first_date_ms: 0, last_date_ms: 0, removal_intervals: prev?.removal_intervals ?? [], transaction_ids: e.transaction_ids,
});

const STATUSES = ["MATURE", "MATURE", "MATURE", "EARLY_DETECTION", "UNKNOWN", "TOMBSTONED"];

describe("planner + state reducer property (seeded)", () => {
  const SEEDS = Array.from({ length: 120 }, (_, i) => 77 + i * 104729);
  for (const seed of SEEDS) {
    it(`seed ${seed}`, () => {
      const rnd = mulberry32(seed);
      const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
      const vendors = ["sunbit", "avant", "hulu", "acme", "landlord"];
      const specs: StreamSpec[] = Array.from({ length: 7 }, (_, i) => ({
        id: `s${i}`, direction: i === 6 ? "inflow" : "outflow", vendor: pick(vendors),
        category: i === 6 ? "INCOME_WAGES" : "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT",
        account: rnd() < 0.8 ? "chk" : "chk2", txns: [`s${i}_t0`, `s${i}_t1`, `s${i}_t2`],
        status: pick(STATUSES), frequency: rnd() < 0.85 ? "MONTHLY" : "UNKNOWN", active: rnd() < 0.85, present: true, rejected: false,
      }));
      // Two pre-existing OLD records (before the release): never stamped, today's handling.
      const records = new Map<string, PlannerRecord>();
      for (const s of specs.slice(0, 2)) records.set(s.id, { ...record_from(entity(s, T0), s.direction, undefined), v2: false });
      const old_ids = new Set(records.keys());
      let items = new Map<string, ReviewItem>();
      let state: RecurringReviewState | null = null;
      let now = T0;
      const removed_accounts = new Set<string>();

      for (let step = 0; step < 14; step++) {
        now += DAY;
        // World changes.
        for (const s of specs) {
          if (rnd() < 0.2) s.status = pick(STATUSES);
          if (rnd() < 0.15) s.active = !s.active;
          if (rnd() < 0.1) s.frequency = s.frequency === "MONTHLY" ? "UNKNOWN" : "MONTHLY";
          s.rejected = rnd() < 0.08;
          s.present = rnd() < 0.92;
        }
        if (rnd() < 0.1) removed_accounts.add("chk2");
        else if (rnd() < 0.1) removed_accounts.delete("chk2");
        const flag_on = rnd() < 0.85;
        // The user answers some open items.
        for (const it of [...items.values()].filter((i) => i.status === "open")) {
          if (rnd() < 0.5) continue;
          const answer = it.kind === "suggested" ? pick(["track", "not_bill"] as const)
            : it.kind === "still_a_bill" ? pick(["still_a_bill", "it_ended"] as const) : "keep_separate";
          const r = plan_review_answer(it, answer, now, { frequency: "monthly" });
          if (!r.ok || r.plan.no_op) continue;
          items = new Map(items).set(it.id, r.plan.item!);
          state = apply_review_state_change(state, U, r.plan.state_change).next;
          const rec = it.record_id ? records.get(it.record_id) : undefined;
          if (rec && r.plan.record_action === "ack_still_a_bill") records.set(rec.id, { ...rec, plaid_inactive_ack_ms: now });
          if (rec && r.plan.record_action === "end") {
            records.set(rec.id, { ...rec, removal_intervals: [...rec.removal_intervals, { from_ms: now, to_ms: null, mode: "going_forward" }] });
          }
        }

        // One sync (as the orchestrator assembles it).
        const streams = specs.filter((s) => s.present && !removed_accounts.has(s.account)).map((s) => to_stream(s, now));
        const valid = new Set(streams.filter((s) => s.entity).map((s) => s.stream_id));
        const existing = new Map([...records].filter(([id]) => valid.has(id)));
        const stale = [...records.values()].filter((r) => r.is_active && r.plaid_item_id === ITEM && !valid.has(r.id));
        const input: CapturePlanInput = {
          user_id: U, plaid_item_doc_id: ITEM, now_ms: now, flag_on, streams, existing, stale_candidates: stale,
          review_items: items, state,
        };
        const plan = plan_recurring_capture(input);
        const ctx = `seed ${seed} step ${step}`;

        // 4. one content per item id.
        const by_id = new Map<string, Set<string>>();
        for (const i of plan.review_items) by_id.set(i.id, (by_id.get(i.id) ?? new Set()).add(i.content_hash));
        expect({ ctx, conflicting: [...by_id].filter(([, h]) => h.size > 1).map(([id]) => id) }).toEqual({ ctx, conflicting: [] });
        // 3 + 5. old records: never stamped / Plaid-inactive, stale as today; v2 never stale.
        const saved = [...plan.save_outflows, ...plan.save_inflows] as OutflowForPersistence[];
        for (const e of saved) {
          if (old_ids.has(e.id)) {
            expect({ ctx, id: e.id, v: (e as { capture_rules_version?: number }).capture_rules_version, p: (e as { plaid_is_active?: boolean }).plaid_is_active })
              .toEqual({ ctx, id: e.id, v: undefined, p: undefined });
          }
        }
        const inactive_ids = [...plan.plaid_inactive_outflow_ids, ...plan.plaid_inactive_inflow_ids];
        const stale_ids = [...plan.stale_outflow_ids, ...plan.stale_inflow_ids];
        for (const id of inactive_ids) expect({ ctx, id, old: old_ids.has(id) }).toEqual({ ctx, id, old: false });
        for (const r of stale) {
          if (!r.v2) expect({ ctx, id: r.id, stale: stale_ids.includes(r.id) }).toEqual({ ctx, id: r.id, stale: true });
          else expect({ ctx, id: r.id, stale: stale_ids.includes(r.id) }).toEqual({ ctx, id: r.id, stale: false });
        }

        // Apply the plan.
        for (const e of saved) records.set(e.id, record_from(e, plan.save_outflows.includes(e) ? "outflow" : "inflow", records.get(e.id)));
        for (const id of stale_ids) { const r = records.get(id)!; records.set(id, { ...r, is_active: false }); }
        for (const id of inactive_ids) { const r = records.get(id)!; records.set(id, { ...r, plaid_is_active: false }); }
        for (const i of changed_items(plan.review_items, items)) items = new Map(items).set(i.id, i);
        state = apply_review_state_change(state, U, plan.state_change).next;

        // 1. a saved stream's ids are never held out.
        const held = new Set(state.suppressed_txn_ids);
        for (const e of saved) {
          const leaked = e.transaction_ids.filter((t) => held.has(t));
          expect({ ctx, id: e.id, leaked }).toEqual({ ctx, id: e.id, leaked: [] });
        }

        // 2. the identical input again → nothing to write.
        const again = plan_recurring_capture({
          ...input,
          existing: new Map([...records].filter(([id]) => valid.has(id))),
          stale_candidates: [...records.values()].filter((r) => r.is_active && r.plaid_item_id === ITEM && !valid.has(r.id)),
          review_items: items,
          state,
        });
        expect({ ctx, items: changed_items(again.review_items, items).map((i) => `${i.id}:${i.status}:${i.answer}`) })
          .toEqual({ ctx, items: [] });
        expect({ ctx, state: apply_review_state_change(state, U, again.state_change).changed }).toEqual({ ctx, state: false });
        expect({ ctx, stale: [...again.stale_outflow_ids, ...again.stale_inflow_ids], inactive: [...again.plaid_inactive_outflow_ids, ...again.plaid_inactive_inflow_ids] })
          .toEqual({ ctx, stale: [], inactive: [] });
      }
    });
  }
});
