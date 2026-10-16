/**
 * "Possible bill" detector (Convert-To-Recurring D11 / D17 / X12 / X14 / X17) — PURE.
 *
 * Finds payments Plaid never made a bill from (Avant: irregular amounts and dates) in the
 * transactions the transfer classifier already loaded (~180 days — X12: no extra transaction read),
 * and proposes ONE `suggested` item per (direction, vendor) — the same subject a Plaid suggestion
 * uses, so a vendor never gets two tiles (X14).
 *
 * Only transactions NOT already accounted for: not in any bill / income stream (active, hidden or
 * inactive), not held out (a Plaid suggestion or a "Not a bill"), not linked to a bill / income by a
 * split, not an internal transfer or edge money, posted, the user's own.
 *
 * Gates:
 *   - rhythm: ≥ 3 payments, average gap ≥ 6 days, and the gaps fit ONE schedule — weekly,
 *     every 2 weeks, twice a month or monthly (no quarterly / yearly in Phase 1: too few samples
 *     in ~180 days, and yearly comes from Plaid or the convert button — D17); still going (the last
 *     payment within two cycles of now);
 *   - category: bills = clearly bill-like (rent & utilities, loans, insurance, medical, government);
 *     entertainment, personal care, transportation, food, shopping, travel and person-to-person
 *     transfers are skipped (D17). Income = `INCOME_*` only, never on a credit / loan account (X17);
 *   - memory: a vendor the user said "Not a bill" about is never suggested (D11); a vendor that
 *     already has a bill / income record isn't either; an item the user already answered, or a
 *     Plaid-sourced open item, is left alone (one tile per vendor).
 *
 * @module domain/recurring/recurring_detector
 */

import { vendor_key as vendor_key_of } from "../transactions/vendor_key.service";
import { is_credit_or_loan_account } from "./capture_rules";
import {
  RecurringReviewState,
  ReviewDirection,
  ReviewItem,
  build_review_item_id,
  is_vendor_dismissed,
  make_review_item,
  suggested_subject,
} from "./review_item.service";

const DAY = 24 * 60 * 60 * 1000;
/** At most this many of the most recent transactions are considered (bound; logged when hit). */
export const DETECTOR_TXN_CAP = 5000;
export const MIN_PAYMENTS = 3;
export const MIN_AVG_GAP_DAYS = 6;

/** A schedule the detector may propose: nominal gap + accepted gap band (days). */
export const DETECTOR_CADENCES: Array<{ frequency: string; nominal: number; min: number; max: number }> = [
  { frequency: "weekly", nominal: 7, min: 5, max: 9 },
  { frequency: "biweekly", nominal: 14, min: 12, max: 16 },
  { frequency: "semimonthly", nominal: 15, min: 10, max: 20 },
  { frequency: "monthly", nominal: 30, min: 25, max: 36 },
];

const BILL_PRIMARY = new Set(["RENT_AND_UTILITIES", "LOAN_PAYMENTS", "MEDICAL", "GOVERNMENT_AND_NON_PROFIT"]);
const BILL_DETAILED = new Set(["GENERAL_SERVICES_INSURANCE"]);

/** Bill-like category (D11 / D17). */
export function is_bill_like_category(detailed: string | null | undefined): boolean {
  const d = String(detailed ?? "").toUpperCase();
  if (BILL_DETAILED.has(d)) return true;
  for (const p of BILL_PRIMARY) if (d.startsWith(`${p}_`) || d === p) return true;
  return false;
}

/** Income category for the income side (X17). */
export function is_income_category(detailed: string | null | undefined): boolean {
  return String(detailed ?? "").toUpperCase().startsWith("INCOME_");
}

/** UTC-normalized day number (CLAUDE.md day counting). */
const utc_day_n = (ms: number) => {
  const d = new Date(ms);
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / DAY);
};

/** The schedule a sorted list of payment dates fits, or null (all gaps in one band). PURE. */
export function fit_cadence(dates_ms: number[]): (typeof DETECTOR_CADENCES)[number] | null {
  if (dates_ms.length < MIN_PAYMENTS) return null;
  const days = [...dates_ms].sort((a, b) => a - b).map(utc_day_n);
  const gaps = days.slice(1).map((d, i) => d - days[i]);
  if (gaps.some((g) => g <= 0)) return null; // two on one day → not a bill rhythm
  const avg = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  if (avg < MIN_AVG_GAP_DAYS) return null;
  for (const c of DETECTOR_CADENCES) {
    if (gaps.every((g) => g >= c.min && g <= c.max)) return c;
  }
  return null;
}

export interface DetectorTxn {
  id: string;
  data: Record<string, unknown>;
}

export interface DetectorInput {
  user_id: string;
  now_ms: number;
  txns: DetectorTxn[];
  /** Doc ids of internal (matched-pair) transfers in the window. */
  internal_txn_ids: Set<string>;
  /** Plaid ids in ANY bill / income stream (active, hidden or inactive). */
  record_txn_ids: Set<string>;
  /** Vendor keys (`${direction}:${vendor}`) that already have a bill / income record. */
  record_vendor_subjects: Set<string>;
  state: RecurringReviewState | null;
  /** Plaid account id → account type; only needed for income candidates (null = not loaded). */
  account_types: Map<string, string> | null;
  /** Items at the candidate subjects' ids (getAll, X8). */
  existing_items: Map<string, ReviewItem>;
}

export interface DetectorCandidate {
  direction: ReviewDirection;
  vendor_key: string;
  subject_key: string;
  item_id: string;
  name: string;
  amount: number;
  frequency: string;
  next_due_ms: number;
  account_id: string;
  category: string;
  transaction_ids: string[];
  payments: number;
}

const split_linked = (data: Record<string, unknown>): boolean =>
  ((data.splits as Array<Record<string, unknown>> | undefined) ?? []).some(
    (s) => !!s.outflowId || !!s.inflowId
  );

/**
 * Step 1 — candidate vendors (no review-item knowledge yet; the caller then `getAll`s their ids).
 * Returns whether the transaction cap was hit (for the log).
 */
export function detect_candidates(input: Omit<DetectorInput, "existing_items">): {
  candidates: DetectorCandidate[];
  capped: boolean;
  needs_account_types: boolean;
} {
  const sorted = [...input.txns].sort(
    (a, b) => ms_of(b.data.transactionDate) - ms_of(a.data.transactionDate)
  );
  const capped = sorted.length > DETECTOR_TXN_CAP;
  const pool = sorted.slice(0, DETECTOR_TXN_CAP);
  const groups = new Map<string, { direction: ReviewDirection; vendor: string; txns: DetectorTxn[] }>();
  for (const t of pool) {
    const d = t.data;
    if ((d.userId ?? d.ownerId) !== input.user_id) continue;
    if (d.isPending === true || d.isActive === false) continue;
    if (input.internal_txn_ids.has(t.id)) continue;
    if (d.transferRole === "edge_out" || d.transferRole === "edge_in") continue;
    const plaid_id = (d.transactionId as string | undefined) ?? null;
    if (plaid_id && (input.record_txn_ids.has(plaid_id) || input.state?.suppressed_txn_ids.includes(plaid_id))) continue;
    if (split_linked(d)) continue;
    const type = String(d.type ?? "");
    const direction: ReviewDirection | null = type === "expense" ? "outflow" : type === "income" ? "inflow" : null;
    if (!direction) continue;
    const detailed = String(d.plaidDetailedCategory ?? "");
    if (direction === "outflow" ? !is_bill_like_category(detailed) : !is_income_category(detailed)) continue;
    const vendor =
      (typeof d.vendorKey === "string" && d.vendorKey) ||
      vendor_key_of({
        merchant_name: d.merchantName as string | null,
        name: d.name as string | null,
        description: d.description as string | null,
      });
    if (!vendor) continue;
    const key = suggested_subject(direction, vendor);
    if (!groups.has(key)) groups.set(key, { direction, vendor, txns: [] });
    groups.get(key)!.txns.push(t);
  }

  const candidates: DetectorCandidate[] = [];
  let needs_account_types = false;
  for (const [subject, g] of groups) {
    if (input.record_vendor_subjects.has(subject)) continue; // a record already covers this vendor
    if (is_vendor_dismissed(input.state, g.direction, g.vendor)) continue; // "Not a bill" (D11)
    const dates = g.txns.map((t) => ms_of(t.data.transactionDate));
    const cadence = fit_cadence(dates);
    if (!cadence) continue;
    const last = Math.max(...dates);
    if (input.now_ms - last > 2 * cadence.nominal * DAY) continue; // stopped — not a live bill
    const account_counts = new Map<string, number>();
    for (const t of g.txns) {
      const a = String(t.data.accountId ?? "");
      account_counts.set(a, (account_counts.get(a) ?? 0) + 1);
    }
    const account_id = [...account_counts].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0][0];
    if (g.direction === "inflow") {
      if (!input.account_types) {
        needs_account_types = true;
        continue;
      }
      if (is_credit_or_loan_account(input.account_types.get(account_id))) continue; // X17
    }
    const amounts = g.txns.map((t) => Math.abs(Number(t.data.amount ?? 0))).sort((a, b) => a - b);
    const median = amounts[Math.floor(amounts.length / 2)];
    const newest = [...g.txns].sort((a, b) => ms_of(a.data.transactionDate) - ms_of(b.data.transactionDate));
    candidates.push({
      direction: g.direction,
      vendor_key: g.vendor,
      subject_key: subject,
      item_id: build_review_item_id(input.user_id, "suggested", subject),
      name: (newest[newest.length - 1].data.merchantName as string) || (newest[newest.length - 1].data.name as string) || g.vendor,
      amount: Math.round(median * 100) / 100,
      frequency: cadence.frequency,
      next_due_ms: last + cadence.nominal * DAY,
      account_id,
      category: String(newest[newest.length - 1].data.plaidDetailedCategory ?? ""),
      transaction_ids: newest.map((t) => t.id),
      payments: g.txns.length,
    });
  }
  candidates.sort((a, b) => (a.subject_key < b.subject_key ? -1 : 1));
  return { candidates, capped, needs_account_types };
}

/**
 * Step 2 — the items to write: a new open detector item per candidate, or a refresh of the
 * detector's own open item. Never touches an answered item or a Plaid-sourced one (X14). PURE.
 */
export function detector_items(
  user_id: string,
  now_ms: number,
  candidates: DetectorCandidate[],
  existing: Map<string, ReviewItem>
): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const c of candidates) {
    const ex = existing.get(c.item_id);
    if (ex && (ex.status !== "open" || ex.source !== "detector")) continue;
    const item = make_review_item(
      {
        user_id,
        kind: "suggested",
        direction: c.direction,
        source: "detector",
        status: "open",
        answer: null,
        subject_key: c.subject_key,
        vendor_key: c.vendor_key,
        account_id: c.account_id,
        plaid_item_doc_id: null,
        stream_id: null,
        record_id: null,
        name: c.name,
        amount: c.amount,
        frequency: c.frequency,
        plaid_status: null,
        category: c.category,
        transaction_ids: c.transaction_ids,
        next_due_ms: c.next_due_ms,
        user_frequency: null,
        resolved_at_ms: null,
      },
      now_ms,
      ex ?? null
    );
    if (ex?.content_hash === item.content_hash) continue;
    out.push(item);
  }
  return out;
}

function ms_of(t: unknown): number {
  const v = t as { toMillis?: () => number } | null;
  return v && typeof v.toMillis === "function" ? v.toMillis() : 0;
}
