/**
 * Convert-To-Recurring (Phase 2) — the pure heart of "Make this a bill / income".
 *
 * Everything here is deterministic and IO-free: the keys that link a vendor on an account to a
 * converted bill (D1), the schedule math (next due, first date, bounds), which past payments a
 * convert links (D2 / D46 — one per occurrence, the closest to its due date), the schedule guess
 * the preview suggests, and the record builder both convert and Add Bill / Add Income (D43) use.
 *
 * "Converted" in this module means a record created by the user through the new path:
 * `captureRulesVersion: 2` + `source: "manual"` + a stored `vendorKey` + an account. Nothing that
 * exists today carries all of them, so none of this touches an existing record (D13).
 *
 * @module domain/recurring/convert_recurring
 */

import { Timestamp } from "firebase-admin/firestore";
import type {
  InflowForPersistence,
  OutflowForPersistence,
} from "../../integrations/plaid/plaid_recurring_transformer";
import { generate_expected_occurrences_in_window } from "../outflows/outflow_period.service";
import { CAPTURE_RULES_VERSION } from "./capture_rules";
import { LATE_PAYMENT_MAX_MS } from "./late_payment.service";
import { normalize_frequency } from "./frequency";
import type { RemovalInterval } from "./recurring_suppression.service";
import { apply_inflow_pin_to_split } from "./inflow_pin.service";

export type ConvertDirection = "outflow" | "inflow";

/** Schedules a convert / Add Bill can pick (yearly is allowed for convert, D17). */
export const CONVERT_FREQUENCIES = [
  "weekly",
  "biweekly",
  "semimonthly",
  "monthly",
  "quarterly",
  "yearly",
] as const;
export type ConvertFrequency = (typeof CONVERT_FREQUENCIES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/** Input caps (a client value is never trusted: names and amounts are bounded). */
export const CONVERT_NAME_MAX = 120;
export const CONVERT_AMOUNT_MAX = 10_000_000;

/** D40: retro-link reaches back 12 months. */
export const RETRO_LINK_MONTHS = 12;

/**
 * The early-payment pad (D28): a payment up to 7 days before an occurrence still pays it. The
 * engine's D1 floor and the retro-link's date floor use this one constant.
 */
export const D1_EARLY_PAD_MS = LATE_PAYMENT_MAX_MS;

/** Bounds on the stored lists (P12: every array has a bound). */
export const MAX_ABSORBED_STREAMS = 20;
export const MAX_ABSORBED_TXN_IDS = 600;

/** A Plaid stream the converted bill absorbed (D42): recorded here, never saved as its own bill. */
export interface AbsorbedStream {
  stream_id: string;
  state: "absorbed" | "declined";
  at_ms: number;
  /** The Plaid payments of that stream the record claims (their union is `absorbed_txn_ids`). */
  txn_ids: string[];
  /** The stream's own vendor key (it can differ from the record's) — a delete remembers it too. */
  vendor_key?: string;
}

/** How a bill was merged into another (D7 / D22 / D41), kept so the merge can be undone (D18). */
export interface MergeLog {
  /** The bill this one was merged into. */
  into: string;
  at_ms: number;
  /** The old bill's removal intervals before the merge ended it. */
  prior_intervals: RemovalInterval[];
  /** What the new bill inherited from this one (null = nothing inherited for that field). */
  inherited_name: string | null;
  inherited_override: number | null;
  /** The old bill's active flag before the merge (the merge keeps it active; undo restores this). */
  prior_is_active?: boolean;
}

/** The key that links a payment (direction + account + vendor) to its converted bill(s). */
export function converted_key(direction: ConvertDirection, account_id: string, vendor_key: string): string {
  return `${direction}|${account_id}|${vendor_key}`;
}

/** A record the D1 matcher / fuzzy exclusion treats as "converted": v2 + manual + key + account. */
export function is_converted_candidate(r: {
  captureRulesVersion?: unknown;
  capture_rules_version?: unknown;
  source?: unknown;
  vendorKey?: unknown;
  vendor_key?: unknown;
  accountId?: unknown;
  account_id?: unknown;
}): boolean {
  const v2 = r.captureRulesVersion === CAPTURE_RULES_VERSION || r.capture_rules_version === CAPTURE_RULES_VERSION;
  const key = r.vendorKey ?? r.vendor_key;
  const account = r.accountId ?? r.account_id;
  return v2 && r.source === "manual" && typeof key === "string" && key.length > 0 &&
    typeof account === "string" && account.length > 0;
}

// ── Schedule math ───────────────────────────────────────────────────────────

const utc_day_start = (ms: number): number => {
  const d = new Date(ms);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
export { utc_day_start };

/** `YYYY-MM-DD` → UTC midnight ms, or null when it is not a real calendar date. */
export function parse_iso_date(s: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms : null;
}

/** Roughly one cadence in ms (for bounds and guesses only — never for placing occurrences). */
export function cadence_ms(frequency: string): number {
  switch (normalize_frequency(frequency)) {
    case "WEEKLY": return 7 * DAY_MS;
    case "BIWEEKLY": return 14 * DAY_MS;
    case "SEMIMONTHLY": return 15 * DAY_MS;
    case "MONTHLY": return 30 * DAY_MS;
    case "QUARTERLY": return 91 * DAY_MS;
    default: return 365 * DAY_MS;
  }
}

/** n calendar months after a UTC day, keeping its day-of-month (clamped to month end). */
function add_months(ms: number, n: number): number {
  const d = new Date(ms);
  const idx = d.getUTCFullYear() * 12 + d.getUTCMonth() + n;
  const year = Math.floor(idx / 12);
  const month = ((idx % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Date.UTC(year, month, Math.min(d.getUTCDate(), last));
}

/** The due date `n` cadences after (n > 0) or before (n < 0) `anchor_ms`, on the anchor's day. */
export function step_cadence(anchor_ms: number, frequency: string, n: number): number {
  switch (normalize_frequency(frequency)) {
    case "WEEKLY": return anchor_ms + n * 7 * DAY_MS;
    case "BIWEEKLY": return anchor_ms + n * 14 * DAY_MS;
    case "SEMIMONTHLY": {
      // Two fixed days a month (the anchor's and the one 15 days away); n counts payments.
      const d = new Date(anchor_ms).getUTCDate();
      const [d1, d2] = d <= 15 ? [d, d + 15] : [d - 15, d];
      const is_second = d === d2 && d !== d1;
      const slot = (is_second ? 1 : 0) + n;
      const months = Math.floor(slot / 2);
      const which = ((slot % 2) + 2) % 2;
      const base = add_months(Date.UTC(new Date(anchor_ms).getUTCFullYear(), new Date(anchor_ms).getUTCMonth(), 1), months);
      const bd = new Date(base);
      const last = new Date(Date.UTC(bd.getUTCFullYear(), bd.getUTCMonth() + 1, 0)).getUTCDate();
      return Date.UTC(bd.getUTCFullYear(), bd.getUTCMonth(), Math.min(which === 0 ? d1 : d2, last));
    }
    case "MONTHLY": return add_months(anchor_ms, n);
    case "QUARTERLY": return add_months(anchor_ms, 3 * n);
    default: return add_months(anchor_ms, 12 * n);
  }
}

/** Next due is kept in [today − 1 cadence − 7 days, today + 1 year] (period writes stay bounded). */
export function clamp_next_due(
  next_due_ms: number,
  frequency: string,
  now_ms: number
): { next_due_ms: number; clamped: boolean } {
  const today = utc_day_start(now_ms);
  const lo = today - cadence_ms(frequency) - LATE_PAYMENT_MAX_MS;
  const hi = today + 365 * DAY_MS;
  const v = Math.min(Math.max(utc_day_start(next_due_ms), lo), hi);
  return { next_due_ms: v, clamped: v !== utc_day_start(next_due_ms) };
}

/** The first date is never earlier than now − 12 months − 1 cadence (caps stored periods ≈ 260). */
export function floor_first_date(first_ms: number, frequency: string, now_ms: number): number {
  const lo = add_months(utc_day_start(now_ms), -RETRO_LINK_MONTHS) - cadence_ms(frequency);
  return Math.max(first_ms, lo);
}

/** Dates of a schedule's occurrences between two instants (anchor = next due, no first-date guard). */
export function occurrences_between(
  frequency: string,
  next_due_ms: number,
  from_ms: number,
  to_ms: number
): number[] {
  const ts = (ms: number) => Timestamp.fromMillis(ms);
  return generate_expected_occurrences_in_window(
    {
      frequency,
      average_amount: 1,
      first_date: ts(0),
      last_date: ts(next_due_ms),
      predicted_next_date: ts(next_due_ms),
      source: "plaid", // no "manual" start guard: the first date is what we are computing
    },
    from_ms,
    to_ms
  ).map((o) => o.due_date_ms).sort((a, b) => a - b);
}

// ── D2 / D46: which past payments a convert links ──────────────────────────

/** A past payment (a single-split transaction of the vendor on the bill's account). */
export interface PaymentCandidate {
  /** The transaction doc id. */
  id: string;
  /** Its Plaid transaction id (null for a manual transaction). */
  plaid_id: string | null;
  date_ms: number;
  amount: number;
}

export interface RetroSelection {
  /** The payments to link, oldest first (one per occurrence, incl. the source). */
  chosen: PaymentCandidate[];
  /** Candidates that stay normal transactions (no occurrence within 7 days, or a worse fit). */
  excluded: PaymentCandidate[];
  /** The occurrence due date the earliest chosen payment pays; null when none matched. */
  first_due_ms: number | null;
}

const MATCH_TOLERANCE_MS = LATE_PAYMENT_MAX_MS;

/**
 * D46: link at most ONE payment per occurrence — the one closest to its due date (ties: the
 * earlier payment, then the smaller id). A payment pays the occurrence nearest to it within 7
 * days (the earlier on a tie), exactly as the period page's matcher places it; one with no
 * occurrence in reach stays a normal transaction. The source payment (the one the user converted)
 * always counts and always claims the occurrence it pays. PURE and deterministic: the same
 * payments always give the same selection.
 */
export function select_retro_payments(input: {
  frequency: string;
  next_due_ms: number;
  payments: PaymentCandidate[];
  source?: PaymentCandidate | null;
  /** Payments before this are not candidates (12 months back, or the share date, D45). */
  floor_ms: number;
  now_ms: number;
}): RetroSelection {
  const { frequency, next_due_ms, floor_ms } = input;
  const all = new Map<string, PaymentCandidate>();
  for (const p of input.payments) if (p.date_ms >= floor_ms) all.set(p.id, p);
  if (input.source) all.set(input.source.id, input.source);
  const sorted = [...all.values()].sort((a, b) => a.date_ms - b.date_ms || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (sorted.length === 0) return { chosen: [], excluded: [], first_due_ms: null };

  const lo = sorted[0].date_ms - MATCH_TOLERANCE_MS - 1;
  const hi = Math.max(sorted[sorted.length - 1].date_ms, next_due_ms) + MATCH_TOLERANCE_MS + 1;
  const dues = occurrences_between(frequency, next_due_ms, lo, hi);
  // Only occurrences inside the window (on or after the floor, already due) can be linked to: a
  // payment just after the floor that pays an occurrence before it belongs to history we don't
  // reach (D40 / D45), and a past payment never claims an occurrence that isn't due yet (only the
  // source — the payment the user tapped — may be early).
  // One exception (an early payment): the NEXT occurrence, if it falls due within the early pad,
  // may be claimed by a payment already made (dated ≤ now) — at most that one occurrence.
  const first_future = dues.filter((d) => d > input.now_ms).reduce<number | null>((m, d) => (m === null || d < m ? d : m), null);
  const early_ok = first_future !== null && first_future <= input.now_ms + D1_EARLY_PAD_MS;
  const nearest = (date_ms: number, in_window_only: boolean): number | null => {
    let best: number | null = null;
    let best_diff = Infinity;
    for (const d of dues) {
      if (in_window_only) {
        if (d < floor_ms) continue;
        if (d > input.now_ms && !(early_ok && d === first_future && date_ms <= input.now_ms)) continue;
      }
      const diff = Math.abs(date_ms - d);
      if (diff <= MATCH_TOLERANCE_MS && diff < best_diff) {
        best = d;
        best_diff = diff;
      }
    }
    return best;
  };

  const by_due = new Map<number, PaymentCandidate>();
  const unmatched: PaymentCandidate[] = [];
  const better = (a: PaymentCandidate, b: PaymentCandidate, due: number): boolean => {
    const da = Math.abs(a.date_ms - due);
    const db = Math.abs(b.date_ms - due);
    if (da !== db) return da < db;
    if (a.date_ms !== b.date_ms) return a.date_ms < b.date_ms;
    return a.id < b.id;
  };
  const source_id = input.source?.id;
  for (const p of sorted) {
    const due = nearest(p.date_ms, p.id !== source_id);
    if (due === null) {
      unmatched.push(p);
      continue;
    }
    const cur = by_due.get(due);
    if (!cur) {
      by_due.set(due, p);
    } else if (cur.id === source_id) {
      // the source keeps the occurrence it pays
    } else if (p.id === source_id || better(p, cur, due)) {
      by_due.set(due, p);
    }
  }
  const chosen_set = new Set([...by_due.values()].map((p) => p.id));
  // The source is always linked (it is pinned), whether or not an occurrence is in reach.
  if (input.source) chosen_set.add(input.source.id);
  const chosen = sorted.filter((p) => chosen_set.has(p.id));
  const excluded = sorted.filter((p) => !chosen_set.has(p.id));
  const matched_dues = [...by_due.keys()].sort((a, b) => a - b);
  void unmatched;
  return { chosen, excluded, first_due_ms: matched_dues.length > 0 ? matched_dues[0] : null };
}

/**
 * The record's first date: the earliest occurrence a linked payment pays (so it reads paid, never
 * "unpaid" before its first real payment), never later than the next due and never earlier than
 * the 12-month floor. With no payment in reach of an occurrence it is the last occurrence at or
 * before the source payment (else the next due).
 */
export function compute_first_date(input: {
  frequency: string;
  next_due_ms: number;
  selection: RetroSelection;
  source_date_ms: number;
  now_ms: number;
}): number {
  let first = input.selection.first_due_ms;
  if (first === null) {
    const dues = occurrences_between(
      input.frequency,
      input.next_due_ms,
      input.source_date_ms - 400 * DAY_MS,
      input.next_due_ms
    );
    const at_or_before = dues.filter((d) => d <= input.source_date_ms);
    first = at_or_before.length > 0 ? at_or_before[at_or_before.length - 1] : input.next_due_ms;
  }
  return Math.min(floor_first_date(first, input.frequency, input.now_ms), input.next_due_ms);
}

// ── Preview: a schedule guess ──────────────────────────────────────────────

export interface ScheduleGuess {
  frequency: ConvertFrequency;
  /** Median gap between payments, in days. */
  median_gap_days: number;
  /** The next due date: the last payment stepped forward by the cadence until it is not past. */
  next_due_ms: number;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Guess the schedule from payment dates (median gap → cadence). null when there is no pattern. */
export function guess_schedule(dates_ms: number[], now_ms: number): ScheduleGuess | null {
  const days = [...new Set(dates_ms.map(utc_day_start))].sort((a, b) => a - b);
  if (days.length < 2) return null;
  const gaps = days.slice(1).map((d, i) => Math.round((d - days[i]) / DAY_MS));
  const g = median(gaps);
  let frequency: ConvertFrequency | null = null;
  if (g >= 5 && g <= 9) frequency = "weekly";
  else if (g >= 12 && g <= 16) {
    // Two fixed days a month (1st + 15th) gaps alternate 14/15/16/17; every 2 weeks stays 14.
    frequency = gaps.every((x) => x >= 13 && x <= 17) && new Set(gaps).size > 2 ? "semimonthly" : "biweekly";
  } else if (g >= 17 && g <= 19) frequency = "semimonthly";
  else if (g >= 27 && g <= 34) frequency = "monthly";
  else if (g >= 85 && g <= 100) frequency = "quarterly";
  else if (g >= 350 && g <= 380) frequency = "yearly";
  if (!frequency) return null;
  const last = days[days.length - 1];
  const today = utc_day_start(now_ms);
  let n = 1;
  let next = step_cadence(last, frequency, n);
  while (next < today && n < 800) {
    n++;
    next = step_cadence(last, frequency, n);
  }
  return { frequency, median_gap_days: g, next_due_ms: next };
}

/**
 * Pin the source split to the new record (pure). A bill is pinned like the manual bill pin; an
 * income like the manual income pin (`apply_inflow_pin_to_split`). A "remove from bill" detach on
 * the split is replaced: converting is the user's explicit choice.
 */
export function apply_source_pin(split: Record<string, unknown>, direction: ConvertDirection, id: string): Record<string, unknown> {
  if (direction === "inflow") return apply_inflow_pin_to_split(split, id);
  /* eslint-disable @typescript-eslint/naming-convention */
  return {
    ...split,
    outflowId: id,
    outflowAssignmentSource: "manual",
    outflowPinnedPeriodId: null,
    inflowId: null,
    suspendedOutflowPinId: null,
  };
  /* eslint-enable @typescript-eslint/naming-convention */
}

// ── The record both convert and Add Bill / Add Income build ────────────────

export interface BuildConvertedInput {
  id: string;
  direction: ConvertDirection;
  user_id: string;
  name: string;
  amount: number;
  frequency: ConvertFrequency;
  /** UTC-midnight next due. */
  next_due_ms: number;
  /** UTC-midnight first date (see `compute_first_date`). */
  first_date_ms: number;
  /** The Plaid account id the payments come from; "" = no account (no D1 key). */
  account_id: string;
  /** The stored vendor key; null/"" = none (a hand-added record without a real transaction). */
  vendor_key: string | null;
  /** The raw vendor string `vendor_key` was made from (the record's merchant). */
  merchant_source: string | null;
  converted_from_txn_id: string | null;
  converted_from_split_ids?: string[];
  now_ms: number;
  /** Categories (the converting transaction's; defaults are the generic-services ones). */
  plaid_primary_category?: string;
  plaid_detailed_category?: string;
  /** Expected-amount override written at creation (so the average never drifts it). */
  expected_amount_override?: number | null;
  expense_type?: string;
  is_essential?: boolean;
  income_type?: string;
  is_regular_salary?: boolean;
  is_variable?: boolean;
  /** Hidden from creation (never for convert). */
  is_hidden?: boolean;
  /** Add Income keeps its own description / user-modified flag / settings (D43). */
  description?: string;
  is_user_modified?: boolean;
  income_extras?: Record<string, unknown>;
}

export interface BuildConvertedResult {
  errors?: string[];
  outflow?: OutflowForPersistence;
  inflow?: InflowForPersistence;
}

/** App frequency spelling stored on the record (Plaid-style lowercase; derive normalizes it). */
const stored_frequency = (f: ConvertFrequency): OutflowForPersistence["frequency"] =>
  (f === "yearly" ? "yearly" : f) as OutflowForPersistence["frequency"];

/** Validate and build the record to persist. PURE. */
export function build_converted_recurring(input: BuildConvertedInput): BuildConvertedResult {
  const errors: string[] = [];
  const name = input.name.trim();
  if (name.length === 0) errors.push("A name is required");
  if (name.length > CONVERT_NAME_MAX) errors.push(`The name can be at most ${CONVERT_NAME_MAX} characters`);
  if (!(input.amount > 0) || !Number.isFinite(input.amount)) errors.push("The amount must be greater than zero");
  if (input.amount > CONVERT_AMOUNT_MAX) errors.push("The amount is too large");
  if (!CONVERT_FREQUENCIES.includes(input.frequency)) errors.push("Pick a schedule");
  if (errors.length > 0) return { errors };

  const first = new Date(input.first_date_ms);
  const next = new Date(input.next_due_ms);
  const key = input.vendor_key && input.vendor_key.length > 0 ? input.vendor_key : null;
  const merchant = input.merchant_source?.trim() || name;
  const common = {
    id: input.id,
    owner_id: input.user_id,
    created_by: input.user_id,
    updated_by: input.user_id,
    group_ids: [] as string[],
    // Not from Plaid: no item / stream, so Plaid sync and stale-marking (item-scoped) never touch it.
    plaid_item_id: "",
    plaid_stream_id: input.id,
    account_id: input.account_id,
    last_amount: input.amount,
    average_amount: input.amount,
    currency: "USD",
    description: input.description ?? name,
    user_custom_name: name,
    frequency: stored_frequency(input.frequency),
    first_date: first,
    last_date: next,
    predicted_next_date: next,
    plaid_primary_category: input.plaid_primary_category ?? "GENERAL_SERVICES",
    plaid_detailed_category: input.plaid_detailed_category ?? "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    internal_primary_category: null,
    internal_detailed_category: null,
    status: "active" as const,
    source: "manual" as const,
    plaid_status: "MANUAL",
    plaid_confidence_level: null,
    is_active: true,
    is_hidden: input.is_hidden === true,
    is_user_modified: input.is_user_modified ?? true,
    transaction_ids: [] as string[],
    tags: [] as string[],
    rules: [] as unknown[],
    capture_rules_version: CAPTURE_RULES_VERSION,
    plaid_is_active: true,
    // Conditional: a record without a key / source txn carries none of them (X1: no `?? null`).
    ...(key ? { vendor_key: key } : {}),
    ...(input.converted_from_txn_id ? { converted_from_txn_id: input.converted_from_txn_id } : {}),
    ...(input.converted_from_split_ids?.length ? { converted_from_split_ids: input.converted_from_split_ids } : {}),
    // the exact instant (a payment CREATED after it, but dated earlier, is a late arrival — A); the D1
    // floor is this instant's UTC day.
    converted_at_ms: input.now_ms,
    // The average never drifts what the user typed: the override pins the expected amount.
    expected_amount_override: input.expected_amount_override === undefined ? input.amount : input.expected_amount_override,
  };
  if (input.direction === "outflow") {
    return {
      outflow: {
        ...common,
        merchant_name: merchant,
        expense_type: input.expense_type ?? "other",
        is_essential: input.is_essential ?? false,
      } as OutflowForPersistence,
    };
  }
  return {
    inflow: {
      ...common,
      payer_name: merchant,
      income_type: input.income_type ?? "other",
      is_regular_salary: input.is_regular_salary ?? false,
      is_variable: input.is_variable ?? false,
      ...(input.income_extras ? { income_extras: input.income_extras } : {}),
    } as InflowForPersistence,
  };
}
