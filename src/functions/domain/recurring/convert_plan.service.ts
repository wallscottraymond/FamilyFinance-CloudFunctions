/**
 * Convert-To-Recurring: plan a convert (and its preview) — PURE.
 *
 * The resolver loads facts (the transaction, the vendor's other payments, what already claims
 * them, the account's sharing); this decides: may it convert, what record, which past payments
 * link (D2 / D40 / D45 / D46), and what the sheet should suggest. Every refusal is a code the app
 * shows; nothing here touches IO.
 *
 * Refusals: NO_VENDOR (no usable name), NO_ACCOUNT (a manual / anonymous transaction has no Plaid
 * account), TRANSFER (an own-account move or edge money), CARD_PAYMENT (a card's "payment
 * received" credit isn't income, the classifier would hide it), PENDING (the vendor key may change
 * when it posts), ALREADY_TRACKED (a shown bill already claims it, D12 / D44), OUT_OF_VIEW (before
 * the account was shared into a group — it would count in Me while the bill is in the group view).
 *
 * @module domain/recurring/convert_plan
 */

import type { InflowForPersistence, OutflowForPersistence } from "../../integrations/plaid/plaid_recurring_transformer";
import { clean_vendor_name } from "../transactions/vendor_key.service";
import { is_card_payment_inflow } from "./capture_rules";
import {
  ConvertDirection,
  ConvertFrequency,
  CONVERT_FREQUENCIES,
  PaymentCandidate,
  RETRO_LINK_MONTHS,
  RetroSelection,
  build_converted_recurring,
  clamp_next_due,
  compute_first_date,
  guess_schedule,
  parse_iso_date,
  select_retro_payments,
  ScheduleGuess,
} from "./convert_recurring.service";
import { is_edge_money } from "./stream_membership";

/** A transaction as the convert rules see it (the source, or one of the vendor's other payments). */
export interface ConvertTxnFacts {
  doc_id: string;
  plaid_id: string | null;
  type: string | null;
  account_id: string;
  date_ms: number;
  amount: number;
  is_pending: boolean;
  is_active: boolean;
  transfer_role: string | null;
  plaid_primary_category: string | null;
  plaid_detailed_category: string | null;
  /** The raw vendor string (merchant, else name, else description) and its stored key. */
  vendor_source: string | null;
  vendor_key: string | null;
  splits: Array<{ split_id: string; outflow_id: string | null; inflow_id: string | null }>;
  /** A shown (live) bill / income streams this payment through Plaid. */
  in_shown_stream: boolean;
}

export interface ConvertFacts {
  user_id: string;
  txn: ConvertTxnFacts;
  /** The vendor's other payments from the account's last RETRO months (unfiltered). */
  vendor_txns: ConvertTxnFacts[];
  /** A SHOWN bill / income that already claims the source (a split link or its Plaid stream). */
  claimed_by: { id: string; name: string } | null;
  /** The account's sharing placement: the group + the date it was shared from (null = always). */
  placement: { group_id: string; shared_from_ms: number | null } | null;
  now_ms: number;
}

export interface ConvertRequest {
  split_id?: string;
  name: string;
  amount: number;
  frequency: ConvertFrequency;
  /** `YYYY-MM-DD` */
  next_due_date: string;
  link_past: boolean;
}

export type Refusal = {
  ok: false;
  code:
    | "NO_VENDOR" | "NO_ACCOUNT" | "TRANSFER" | "CARD_PAYMENT" | "PENDING" | "ALREADY_TRACKED"
    | "OUT_OF_VIEW" | "VALIDATION_ERROR" | "NOT_FOUND";
  message: string;
  details?: Record<string, unknown>;
};

export interface ConvertPlan {
  ok: true;
  direction: ConvertDirection;
  entity: OutflowForPersistence | InflowForPersistence;
  vendor_key: string;
  next_due_ms: number;
  first_date_ms: number;
  /** The splits of the source transaction the bill is pinned to. */
  source_split_ids: string[];
  selection: RetroSelection;
  /** Plaid ids of the past payments linked (stored on the record: D1 keeps them linked). */
  retro_plaid_ids: string[];
  /** Doc ids of the past payments to run the engine over (excludes the source). */
  retro_doc_ids: string[];
  /** The next due date was moved into the allowed range. */
  next_due_clamped: boolean;
}

const RETRO_BACK_MS = RETRO_LINK_MONTHS * 31 * 24 * 60 * 60 * 1000;

/** The direction of money: out → bill, in → income. */
export function direction_of(type: string | null): ConvertDirection | null {
  if (type === "expense") return "outflow";
  if (type === "income") return "inflow";
  return null;
}

/** May this transaction be converted at all? (shared by the plan and the preview) */
export function check_convertible(facts: ConvertFacts): Refusal | null {
  const t = facts.txn;
  const direction = direction_of(t.type);
  if (!direction) {
    return { ok: false, code: "TRANSFER", message: "A transfer between your accounts can't be a bill or income" };
  }
  if (t.transfer_role === "internal" || is_edge_money(t.transfer_role)) {
    return { ok: false, code: "TRANSFER", message: "A transfer between your accounts can't be a bill or income" };
  }
  if (!t.vendor_key) {
    return { ok: false, code: "NO_VENDOR", message: "This transaction has no name to track" };
  }
  if (!t.account_id) {
    return { ok: false, code: "NO_ACCOUNT", message: "Only transactions from a linked account can be tracked this way" };
  }
  if (direction === "inflow" && is_card_payment_inflow(t.plaid_detailed_category)) {
    return { ok: false, code: "CARD_PAYMENT", message: "A credit-card payment received isn't income" };
  }
  if (t.is_pending) {
    return { ok: false, code: "PENDING", message: "Wait until this transaction posts, then make it a bill" };
  }
  if (facts.claimed_by) {
    return {
      ok: false, code: "ALREADY_TRACKED", message: `This is already part of ${facts.claimed_by.name}`,
      details: { id: facts.claimed_by.id, name: facts.claimed_by.name },
    };
  }
  // Before the account was shared into a group: it counts in Me while the bill lives in the group.
  const shared_from = facts.placement?.shared_from_ms ?? null;
  if (facts.placement && shared_from !== null && t.date_ms < shared_from) {
    return { ok: false, code: "OUT_OF_VIEW", message: "This payment is from before the account was shared" };
  }
  return null;
}

/** The date the retro-link reaches back to: 12 months, or the share date (D45) if later. */
export function retro_floor_ms(facts: ConvertFacts): number {
  const back = facts.now_ms - RETRO_BACK_MS;
  const shared_from = facts.placement?.shared_from_ms ?? null;
  return shared_from !== null ? Math.max(back, shared_from) : back;
}

/**
 * The vendor's other payments a convert may link: same account + direction, single split, not
 * already linked to a bill / income or in a shown stream, not a transfer / pending / inactive. PURE.
 */
export function eligible_candidates(facts: ConvertFacts): PaymentCandidate[] {
  const direction = direction_of(facts.txn.type);
  const floor = retro_floor_ms(facts);
  return facts.vendor_txns
    .filter((c) =>
      c.doc_id !== facts.txn.doc_id &&
      c.is_active &&
      !c.is_pending &&
      c.account_id === facts.txn.account_id &&
      direction_of(c.type) === direction &&
      c.vendor_key === facts.txn.vendor_key &&
      c.date_ms >= floor &&
      c.date_ms <= facts.now_ms &&
      c.transfer_role !== "internal" && !is_edge_money(c.transfer_role) &&
      c.splits.length === 1 &&
      c.splits[0].outflow_id === null && c.splits[0].inflow_id === null &&
      !c.in_shown_stream
    )
    .map((c) => ({ id: c.doc_id, plaid_id: c.plaid_id, date_ms: c.date_ms, amount: Math.abs(c.amount) }));
}

/** Plan a convert. PURE. */
export function plan_convert(facts: ConvertFacts, req: ConvertRequest, new_id: string): Refusal | ConvertPlan {
  const refusal = check_convertible(facts);
  if (refusal) return refusal;
  const t = facts.txn;
  const direction = direction_of(t.type) as ConvertDirection;

  if (!CONVERT_FREQUENCIES.includes(req.frequency)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Pick a schedule" };
  }
  const next_raw = parse_iso_date(req.next_due_date);
  if (next_raw === null) return { ok: false, code: "VALIDATION_ERROR", message: "That due date isn't a real date" };
  const { next_due_ms, clamped } = clamp_next_due(next_raw, req.frequency, facts.now_ms);

  const split_ids = req.split_id
    ? t.splits.filter((s) => s.split_id === req.split_id).map((s) => s.split_id)
    : t.splits.map((s) => s.split_id);
  if (split_ids.length === 0) return { ok: false, code: "NOT_FOUND", message: "That split doesn't exist" };

  const source_amount = Math.abs(t.amount);
  const source: PaymentCandidate = { id: t.doc_id, plaid_id: t.plaid_id, date_ms: t.date_ms, amount: source_amount };
  const candidates = req.link_past ? eligible_candidates(facts) : [];
  const selection = select_retro_payments({
    frequency: req.frequency, next_due_ms, payments: candidates, source, floor_ms: retro_floor_ms(facts), now_ms: facts.now_ms,
  });
  const first_date_ms = compute_first_date({
    frequency: req.frequency, next_due_ms, selection, source_date_ms: t.date_ms, now_ms: facts.now_ms,
  });
  const retro = selection.chosen.filter((p) => p.id !== t.doc_id);

  const built = build_converted_recurring({
    id: new_id, direction, user_id: facts.user_id, name: req.name, amount: req.amount, frequency: req.frequency,
    next_due_ms, first_date_ms, account_id: t.account_id, vendor_key: t.vendor_key, merchant_source: t.vendor_source,
    converted_from_txn_id: t.doc_id, now_ms: facts.now_ms,
    plaid_primary_category: t.plaid_primary_category ?? undefined,
    plaid_detailed_category: t.plaid_detailed_category ?? undefined,
  });
  if (built.errors) return { ok: false, code: "VALIDATION_ERROR", message: built.errors.join("; ") };

  return {
    ok: true,
    direction,
    entity: (built.outflow ?? built.inflow) as OutflowForPersistence | InflowForPersistence,
    vendor_key: t.vendor_key as string,
    next_due_ms,
    first_date_ms,
    source_split_ids: split_ids,
    selection,
    retro_plaid_ids: retro.map((p) => p.plaid_id).filter((x): x is string => !!x),
    retro_doc_ids: retro.map((p) => p.id),
    next_due_clamped: clamped,
  };
}

// ── Preview ────────────────────────────────────────────────────────────────

export interface ConvertPreview {
  ok: true;
  direction: ConvertDirection;
  /** Suggestions for the sheet. */
  suggested_name: string;
  suggested_amount: number;
  schedule_guess: ScheduleGuess | null;
  /** With the guessed schedule: payments that would link / stay normal transactions (null = no guess). */
  linkable_count: number | null;
  excluded_count: number | null;
  /** Payments of the vendor on this account the preview looked at. */
  vendor_payment_count: number;
}

/** What the "Make this a bill" sheet should offer for this transaction. PURE. */
export function build_preview(facts: ConvertFacts): Refusal | ConvertPreview {
  const refusal = check_convertible(facts);
  if (refusal) return refusal;
  const t = facts.txn;
  const direction = direction_of(t.type) as ConvertDirection;
  const candidates = eligible_candidates(facts);
  const dates = [t.date_ms, ...candidates.map((c) => c.date_ms)];
  const guess = guess_schedule(dates, facts.now_ms);
  let linkable: number | null = null;
  let excluded: number | null = null;
  if (guess) {
    const sel = select_retro_payments({
      frequency: guess.frequency, next_due_ms: guess.next_due_ms, payments: candidates,
      source: { id: t.doc_id, plaid_id: t.plaid_id, date_ms: t.date_ms, amount: Math.abs(t.amount) },
      floor_ms: retro_floor_ms(facts), now_ms: facts.now_ms,
    });
    linkable = sel.chosen.length - 1; // the source itself is not a "past payment"
    excluded = sel.excluded.length;
  }
  return {
    ok: true,
    direction,
    suggested_name: clean_vendor_name(t.vendor_source ?? ""),
    suggested_amount: Math.abs(t.amount),
    schedule_guess: guess,
    linkable_count: linkable,
    excluded_count: excluded,
    vendor_payment_count: candidates.length,
  };
}
