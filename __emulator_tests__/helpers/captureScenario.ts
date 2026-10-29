/**
 * captureScenario — one realistic Plaid item for the Convert-To-Recurring capture-rules suites.
 *
 * A user with checking + savings + a credit card on one item, ~6 months of posted transactions,
 * and every kind of recurring stream the capture rules care about:
 *
 *   S_SPOT    bill    MATURE  MONTHLY  active          Spotify, 5 payments            (normal bill)
 *   S_GYM     bill    MATURE  MONTHLY  INACTIVE         old gym, ended ~4 months ago  (first seen inactive)
 *   S_SUNBIT  bill    EARLY_DETECTION MONTHLY active    Sunbit, 2 payments            (low confidence)
 *   S_AVANT   bill    MATURE  UNKNOWN freq  active      Avant, irregular amounts      (unknown frequency)
 *   S_TOMB    bill    TOMBSTONED MONTHLY  active        Hulu, dead stream
 *   S_XFER    bill    MATURE  MONTHLY  TRANSFER_OUT     checking → savings (every leg paired)
 *   S_CCPAY   bill    MATURE  MONTHLY  CC payment       checking pays the card
 *   S_CCIN    income  MATURE  MONTHLY  CC payment       the card's "payment received" credit
 *   S_PAY     income  MATURE  BIWEEKLY INCOME_WAGES     payroll
 *
 * Plus grocery noise. With `{ removals: true }` (the flag-off golden only), three more OLD bills
 * the user later removes / restores / pauses (see REMOVAL_BILLS) — the D26 boundary cases:
 *
 *   S_RMV     bill    MATURE  MONTHLY  active          City Water, due 29th, paid Jul–Sep  → removed from Oct 1
 *   S_RST     bill    MATURE  MONTHLY  active          Car Loan, due 12th, paid Jul–Oct    → removed Sep 1, restored Oct 20
 *   S_PSE     bill    MATURE  MONTHLY  active          Iron Gym, due 29th, paid Jul–Sep    → paused Sep 1 → Oct 2
 *   S_ERL     bill    MATURE  MONTHLY  active          Mortgage Co, due 1st, paid Aug 1, Sep 1 + Sep 29
 *                                                       (early, for Oct 1)                  → removed from Oct 1 (D28)
 *   S_LTE     bill    MATURE  MONTHLY  active          Home Lender, due 29th, paid Jul 29, Aug 29 + Oct 2
 *                                                       (late, for Sep 29)                  → removed from Oct 1 (D31)
 *   S_PPA     bill    MATURE  MONTHLY  active          Auto Lender, due 29th, paid Jul 29, Aug 29 + Oct 2
 *                                                       (late, for Sep 29)                  → a PAST pause, Mar 2037 (D37 #1)
 *   S_XTR     bill    MATURE  MONTHLY  active          Student Lender, due 29th, paid Jul 29, Aug 29, Sep 29
 *                                                       + an extra charge Oct 2             → removed from Oct 1 (D37 #2)
 *
 * Everything is deterministic for a fixed clock (`NOW_ISO`, frozen via jest
 * fake Date in the suites), and ids are prefixed with `tag` so many scenarios share one emulator.
 *
 * The same file runs against the untouched base commit to produce the flag-off golden dump
 * (`golden/captureRulesFlagOff.golden.json`) — so it only uses APIs that exist on both.
 */
/* eslint-disable @typescript-eslint/naming-convention */
import { Firestore, Timestamp } from "firebase-admin/firestore";

export const NOW_ISO = "2037-10-15T12:00:00Z";
export const NOW_MS = Date.parse(NOW_ISO);
const DAY = 24 * 60 * 60 * 1000;

export interface ScenarioIds {
  tag: string;
  userId: string;
  itemDocId: string;
  chk: string;
  sav: string;
  card: string;
  streams: Record<string, string>;
  txn: (key: string) => string; // plaid transaction id of a scenario txn key
}

const iso = (ms: number) => new Date(ms).toISOString().slice(0, 10);

export function scenarioIds(tag: string): ScenarioIds {
  const streams: Record<string, string> = {};
  for (const s of ["SPOT", "GYM", "SUNBIT", "AVANT", "TOMB", "XFER", "CCPAY", "CCIN", "PAY"]) {
    streams[s] = `${tag}_S_${s}`;
  }
  return {
    tag,
    userId: `${tag}_u`,
    itemDocId: `${tag}_item`,
    chk: `${tag}_chk`,
    sav: `${tag}_sav`,
    card: `${tag}_card`,
    streams,
    txn: (key: string) => `${tag}_t_${key}`,
  };
}

interface PlaidTxnSpec {
  key: string;
  account: "chk" | "sav" | "card";
  amount: number; // Plaid sign: + money out, − money in
  days_ago: number;
  name: string;
  merchant: string | null;
  primary: string;
  detailed: string;
}

/** The OLD bills the golden removes / restores / pauses (`{ removals: true }`). Categories are
 *  among SCENARIO_CATEGORY_CODES (read as unmapped, as on the base golden run). */
export const REMOVAL_BILLS = {
  RMV: { name: "CITY WATER", merchant: "City Water", primary: "RENT_AND_UTILITIES", detailed: "RENT_AND_UTILITIES_WATER", amount: 61, paid_days_ago: [78, 47, 16], first_days_ago: 78, last_days_ago: 16, next_days: 14 },
  RST: { name: "CAR LOAN CO", merchant: "Car Loan Co", primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CAR_PAYMENT", amount: 233, paid_days_ago: [95, 64, 33, 3], first_days_ago: 95, last_days_ago: 3, next_days: 28 },
  PSE: { name: "IRON GYM", merchant: "Iron Gym", primary: "PERSONAL_CARE", detailed: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", amount: 45, paid_days_ago: [78, 47, 16], first_days_ago: 78, last_days_ago: 16, next_days: 14 },
  // D28 (round 4): due the 1st, paid Aug 1, Sep 1 and EARLY on Sep 29 for Oct 1 → removed from Oct 1.
  ERL: { name: "MORTGAGE CO", merchant: "Mortgage Co", primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT", amount: 120, paid_days_ago: [75, 44, 16], first_days_ago: 75, last_days_ago: 16, next_days: 17 },
  // D31 (round 5): due the 29th, paid Jul 29, Aug 29 and LATE on Oct 2 for Sep 29 → removed from Oct 1.
  LTE: { name: "HOME LENDER", merchant: "Home Lender", primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT", amount: 88, paid_days_ago: [78, 47, 13], first_days_ago: 78, last_days_ago: 13, next_days: 14 },
  // D37 #1 (round 6): a LIVE bill with a past pause (Mar 2037), paid Jul 29, Aug 29 and Oct 2 — no different from a never-paused bill.
  PPA: { name: "AUTO LENDER", merchant: "Auto Lender", primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT", amount: 66, paid_days_ago: [78, 47, 13], first_days_ago: 78, last_days_ago: 13, next_days: 14 },
  // D37 #2 (round 6): paid on time Sep 29, plus an extra charge Oct 2 → removed from Oct 1: the Oct 2 charge stays October spend.
  XTR: { name: "STUDENT LENDER", merchant: "Student Lender", primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_MORTGAGE_PAYMENT", amount: 77, paid_days_ago: [78, 47, 16, 13], first_days_ago: 78, last_days_ago: 13, next_days: 14 },
} as const;

/** The scenario's transactions (keys are stable; ids come from `ids.txn(key)`). */
export function scenarioTxnSpecs(opts: { removals?: boolean } = {}): PlaidTxnSpec[] {
  const out: PlaidTxnSpec[] = [];
  if (opts.removals) {
    for (const [k, b] of Object.entries(REMOVAL_BILLS)) {
      b.paid_days_ago.forEach((d, i) => out.push({ key: `${k.toLowerCase()}${i}`, account: "chk", amount: b.amount, days_ago: d,
        name: b.name, merchant: b.merchant, primary: b.primary, detailed: b.detailed }));
    }
  }
  for (let m = 0; m < 5; m++) {
    out.push({ key: `spot${m}`, account: "chk", amount: 15.49, days_ago: 10 + 30 * m, name: "SPOTIFY USA", merchant: "Spotify",
      primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_MUSIC_AND_AUDIO" });
  }
  for (let m = 0; m < 3; m++) {
    out.push({ key: `gym${m}`, account: "chk", amount: 30, days_ago: 125 + 30 * m, name: "OLD GYM", merchant: "Old Gym",
      primary: "PERSONAL_CARE", detailed: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS" });
  }
  for (let m = 0; m < 2; m++) {
    out.push({ key: `sunbit${m}`, account: "chk", amount: 50, days_ago: 5 + 30 * m, name: "SUNBIT", merchant: "Sunbit",
      primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT" });
  }
  [[8, 82], [41, 117], [69, 95]].forEach(([d, a], i) =>
    out.push({ key: `avant${i}`, account: "chk", amount: a, days_ago: d, name: "AVANT LOAN", merchant: "Avant",
      primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT" }));
  for (let m = 0; m < 2; m++) {
    out.push({ key: `hulu${m}`, account: "chk", amount: 17.99, days_ago: 14 + 30 * m, name: "HULU", merchant: "Hulu",
      primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_TV_AND_MOVIES" });
  }
  for (let m = 0; m < 4; m++) {
    out.push({ key: `xferout${m}`, account: "chk", amount: 200, days_ago: 3 + 30 * m, name: "TRANSFER TO SAVINGS", merchant: null,
      primary: "TRANSFER_OUT", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER" });
    out.push({ key: `xferin${m}`, account: "sav", amount: -200, days_ago: 3 + 30 * m, name: "TRANSFER FROM CHECKING", merchant: null,
      primary: "TRANSFER_IN", detailed: "TRANSFER_IN_ACCOUNT_TRANSFER" });
  }
  for (let m = 0; m < 3; m++) {
    out.push({ key: `ccpay${m}`, account: "chk", amount: 300, days_ago: 20 + 30 * m, name: "CAPITAL ONE PAYMENT", merchant: "Capital One",
      primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" });
    out.push({ key: `ccin${m}`, account: "card", amount: -300, days_ago: 20 + 30 * m, name: "PAYMENT THANK YOU", merchant: "Capital One",
      primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT" });
  }
  for (let w = 0; w < 6; w++) {
    out.push({ key: `pay${w}`, account: "chk", amount: -2000, days_ago: 2 + 14 * w, name: "ACME PAYROLL", merchant: "Acme",
      primary: "INCOME", detailed: "INCOME_WAGES" });
  }
  for (let g = 0; g < 10; g++) {
    out.push({ key: `groc${g}`, account: "chk", amount: 40 + g, days_ago: 4 + 9 * g, name: "KROGER", merchant: "Kroger",
      primary: "FOOD_AND_DRINK", detailed: "FOOD_AND_DRINK_GROCERIES" });
  }
  return out;
}

export function plaidTxn(ids: ScenarioIds, spec: PlaidTxnSpec, now_ms = NOW_MS) {
  const date = iso(now_ms - spec.days_ago * DAY);
  return {
    transaction_id: ids.txn(spec.key),
    account_id: (ids as unknown as Record<string, string>)[spec.account],
    amount: spec.amount,
    iso_currency_code: "USD",
    date,
    authorized_date: date,
    name: spec.name,
    merchant_name: spec.merchant,
    pending: false,
    pending_transaction_id: null,
    payment_channel: "online",
    personal_finance_category: { primary: spec.primary, detailed: spec.detailed, confidence_level: "HIGH" },
    category: null,
    category_id: null,
    location: {},
    counterparties: [],
  };
}

interface StreamOverride {
  status?: string;
  is_active?: boolean;
  frequency?: string;
  transaction_keys?: string[];
  last_amount?: number;
  first_days_ago?: number;
  last_days_ago?: number;
}

/** A Plaid stream for the scenario (`keys` → its transaction ids). */
export function plaidStream(
  ids: ScenarioIds,
  stream: string,
  o: {
    account: "chk" | "sav" | "card";
    keys: string[];
    amount: number;
    description: string;
    merchant: string | null;
    primary: string;
    detailed: string;
    frequency: string;
    status: string;
    is_active: boolean;
    first_days_ago: number;
    last_days_ago: number;
    next_days?: number | null;
  },
  now_ms = NOW_MS
) {
  return {
    stream_id: ids.streams[stream],
    account_id: (ids as unknown as Record<string, string>)[o.account],
    description: o.description,
    merchant_name: o.merchant,
    first_date: iso(now_ms - o.first_days_ago * DAY),
    last_date: iso(now_ms - o.last_days_ago * DAY),
    predicted_next_date: o.next_days == null ? null : iso(now_ms + o.next_days * DAY),
    frequency: o.frequency,
    transaction_ids: o.keys.map(ids.txn),
    average_amount: { amount: o.amount, iso_currency_code: "USD" },
    last_amount: { amount: o.amount, iso_currency_code: "USD" },
    is_active: o.is_active,
    status: o.status,
    personal_finance_category: { primary: o.primary, detailed: o.detailed, confidence_level: "HIGH" },
    is_user_modified: false,
  };
}

const keys = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);

/** The scenario's recurring response, with optional per-stream overrides. */
export function scenarioRecurring(
  ids: ScenarioIds,
  overrides: Record<string, StreamOverride> = {},
  now_ms = NOW_MS,
  opts: { removals?: boolean } = {}
) {
  const s = (name: string, base: Parameters<typeof plaidStream>[2]) => {
    const o = overrides[name] ?? {};
    return plaidStream(ids, name, {
      ...base,
      ...(o.status ? { status: o.status } : {}),
      ...(o.is_active !== undefined ? { is_active: o.is_active } : {}),
      ...(o.frequency ? { frequency: o.frequency } : {}),
      ...(o.transaction_keys ? { keys: o.transaction_keys } : {}),
      ...(o.first_days_ago !== undefined ? { first_days_ago: o.first_days_ago } : {}),
      ...(o.last_days_ago !== undefined ? { last_days_ago: o.last_days_ago } : {}),
    }, now_ms);
  };
  return {
    outflow_streams: [
      s("SPOT", { account: "chk", keys: keys("spot", 5), amount: 15.49, description: "SPOTIFY USA", merchant: "Spotify",
        primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_MUSIC_AND_AUDIO", frequency: "MONTHLY", status: "MATURE",
        is_active: true, first_days_ago: 130, last_days_ago: 10, next_days: 20 }),
      s("GYM", { account: "chk", keys: keys("gym", 3), amount: 30, description: "OLD GYM", merchant: "Old Gym",
        primary: "PERSONAL_CARE", detailed: "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", frequency: "MONTHLY", status: "MATURE",
        is_active: false, first_days_ago: 185, last_days_ago: 125, next_days: null }),
      s("SUNBIT", { account: "chk", keys: keys("sunbit", 2), amount: 50, description: "SUNBIT", merchant: "Sunbit",
        primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", frequency: "MONTHLY", status: "EARLY_DETECTION",
        is_active: true, first_days_ago: 35, last_days_ago: 5, next_days: 25 }),
      s("AVANT", { account: "chk", keys: keys("avant", 3), amount: 98, description: "AVANT LOAN", merchant: "Avant",
        primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT", frequency: "UNKNOWN", status: "MATURE",
        is_active: true, first_days_ago: 69, last_days_ago: 8, next_days: 22 }),
      s("TOMB", { account: "chk", keys: keys("hulu", 2), amount: 17.99, description: "HULU", merchant: "Hulu",
        primary: "ENTERTAINMENT", detailed: "ENTERTAINMENT_TV_AND_MOVIES", frequency: "MONTHLY", status: "TOMBSTONED",
        is_active: true, first_days_ago: 44, last_days_ago: 14, next_days: 16 }),
      s("XFER", { account: "chk", keys: keys("xferout", 4), amount: 200, description: "TRANSFER TO SAVINGS", merchant: null,
        primary: "TRANSFER_OUT", detailed: "TRANSFER_OUT_ACCOUNT_TRANSFER", frequency: "MONTHLY", status: "MATURE",
        is_active: true, first_days_ago: 93, last_days_ago: 3, next_days: 27 }),
      s("CCPAY", { account: "chk", keys: keys("ccpay", 3), amount: 300, description: "CAPITAL ONE PAYMENT", merchant: "Capital One",
        primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", frequency: "MONTHLY", status: "MATURE",
        is_active: true, first_days_ago: 80, last_days_ago: 20, next_days: 10 }),
      ...(opts.removals
        ? Object.entries(REMOVAL_BILLS).map(([k, b]) => {
          ids.streams[k] = `${ids.tag}_S_${k}`;
          return s(k, { account: "chk", keys: keys(k.toLowerCase(), b.paid_days_ago.length), amount: b.amount, description: b.name,
            merchant: b.merchant, primary: b.primary, detailed: b.detailed, frequency: "MONTHLY", status: "MATURE", is_active: true,
            first_days_ago: b.first_days_ago, last_days_ago: b.last_days_ago, next_days: b.next_days });
        })
        : []),
    ],
    inflow_streams: [
      s("CCIN", { account: "card", keys: keys("ccin", 3), amount: -300, description: "PAYMENT THANK YOU", merchant: "Capital One",
        primary: "LOAN_PAYMENTS", detailed: "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", frequency: "MONTHLY", status: "MATURE",
        is_active: true, first_days_ago: 80, last_days_ago: 20, next_days: 10 }),
      s("PAY", { account: "chk", keys: keys("pay", 6), amount: -2000, description: "ACME PAYROLL", merchant: "Acme",
        primary: "INCOME", detailed: "INCOME_WAGES", frequency: "BIWEEKLY", status: "MATURE",
        is_active: true, first_days_ago: 72, last_days_ago: 2, next_days: 12 }),
    ],
    updated_datetime: new Date(now_ms).toISOString(),
    request_id: "r",
  };
}

/** Plaid category codes the scenarios use. Other suites seed `categories` docs for some of these;
 *  the scenarios are defined with NONE of them present (as on the base golden run). */
export const SCENARIO_CATEGORY_CODES = [
  "ENTERTAINMENT_MUSIC_AND_AUDIO", "PERSONAL_CARE_GYMS_AND_FITNESS_CENTERS", "LOAN_PAYMENTS_PERSONAL_LOAN_PAYMENT",
  "ENTERTAINMENT_TV_AND_MOVIES", "TRANSFER_OUT_ACCOUNT_TRANSFER", "TRANSFER_IN_ACCOUNT_TRANSFER",
  "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT", "INCOME_WAGES", "FOOD_AND_DRINK_GROCERIES", "RENT_AND_UTILITIES_WATER",
  "INCOME_OTHER_INCOME", "FOOD_AND_DRINK_COFFEE", "GENERAL_MERCHANDISE_OTHER", "LOAN_PAYMENTS_MORTGAGE_PAYMENT",
  "LOAN_PAYMENTS_CAR_PAYMENT", "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
];

/**
 * Isolation from other suites WITHOUT touching shared data: `categories` is global reference data
 * other suites seed (and need) in parallel, so the scenario never deletes it. Instead this suite's
 * own module instance of `category_repo` (jest gives each test file its own registry) is wrapped
 * so the scenario's codes read as unmapped — exactly the state the golden was captured in. Every
 * category read on the paths the scenarios exercise goes through `category_repo`. Idempotent.
 */
function isolate_scenario_categories(): void {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const mod = require("../../src/functions/repositories/category.repo");
  const repo = mod.category_repo as Record<string, unknown> & { __scenarioIsolated?: boolean };
  if (repo.__scenarioIsolated) return;
  const hidden = new Set(SCENARIO_CATEGORY_CODES);
  // Keyed by the source array so the catalog resolver's identity cache still hits.
  const memo = new WeakMap<object, unknown[]>();
  const filter = (docs: Array<{ id: string }>) => {
    let out = memo.get(docs);
    if (!out) { out = docs.filter((d) => !hidden.has(d.id)); memo.set(docs, out); }
    return out;
  };
  for (const name of ["get_active", "get_active_cached"]) {
    const orig = repo[name] as (...a: unknown[]) => Promise<Array<{ id: string }>>;
    if (typeof orig !== "function") continue;
    repo[name] = async (...a: unknown[]) => filter(await orig.apply(repo, a));
  }
  repo.__scenarioIsolated = true;
  mod.invalidate_category_cache?.();
}

/** Seed the user, item, accounts, Everything-Else budgets and the current month source periods. */
export async function seedScenario(db: Firestore, ids: ScenarioIds): Promise<void> {
  const now = Timestamp.fromMillis(NOW_MS);
  isolate_scenario_categories();
  const batch = db.batch();
  batch.set(db.collection("plaid_items").doc(ids.itemDocId), {
    id: ids.itemDocId, plaidItemId: ids.itemDocId, userId: ids.userId, groupIds: [],
    accessToken: "enc", cursor: null, isActive: true, institutionId: "ins_1", institutionName: "Test Bank",
    createdAt: now, updatedAt: now,
  });
  batch.set(db.collection("users").doc(ids.userId), { id: ids.userId, email: `${ids.tag}@x.com` });
  for (const [key, type, subtype] of [["chk", "depository", "checking"], ["sav", "depository", "savings"], ["card", "credit", "credit card"]]) {
    const accountId = (ids as unknown as Record<string, string>)[key];
    batch.set(db.collection("accounts").doc(accountId), {
      id: accountId, accountId, userId: ids.userId, itemId: ids.itemDocId, plaidItemId: ids.itemDocId,
      institutionId: "ins_1", institutionName: "Test Bank", accountName: key, name: key, type, subtype,
      accountType: type, accountSubtype: subtype,
      currentBalance: 1000, isActive: true, isDeleted: false, createdAt: now, updatedAt: now,
      access: { ownerId: ids.userId, createdBy: ids.userId, groupIds: [], isPrivate: true },
    });
  }
  for (const period of ["monthly", "weekly", "bi_monthly"]) {
    const eeId = `${ids.tag}_ee_${period}`;
    batch.set(db.collection("budgets").doc(eeId), {
      id: eeId, name: "Everything else", userId: ids.userId, ownerId: ids.userId, createdBy: ids.userId,
      isActive: true, isSystemEverythingElse: true, isEverythingElse: true, period, amount: 0, categoryIds: [],
      isOngoing: true, startDate: Timestamp.fromDate(new Date("2020-01-01")), endDate: Timestamp.fromDate(new Date("2099-01-01")),
      budgetType: "recurring", groupIds: [],
    });
  }
  await batch.commit();
}

/** Seed `source_periods` monthly docs for [from, to] months (shared, idempotent). */
export async function seedMonthlySourcePeriods(db: Firestore, months: Array<[number, number]>): Promise<void> {
  const batch = db.batch();
  for (const [y, m] of months) {
    const id = `${y}M${String(m).padStart(2, "0")}`;
    batch.set(db.collection("source_periods").doc(id), {
      id, periodId: id, type: "monthly", year: y, index: m,
      startDate: Timestamp.fromMillis(Date.UTC(y, m - 1, 1)),
      endDate: Timestamp.fromMillis(Date.UTC(y, m, 1) - 1),
    });
  }
  await batch.commit();
}

/** Mock implementations for `sync_transactions` (one page, then nothing new) + recurring. */
export function scenarioMocks(ids: ScenarioIds, now_ms = NOW_MS, opts: { removals?: boolean } = {}) {
  const txns = scenarioTxnSpecs(opts).map((s) => plaidTxn(ids, s, now_ms));
  return {
    txns,
    sync: async (_tok: string, cursor: string | null) => ({
      added: cursor ? [] : txns,
      modified: [],
      removed: [],
      next_cursor: "c1",
      has_more: false,
      transactions_update_status: "HISTORICAL_UPDATE_COMPLETE",
      accounts: [],
      request_id: "r",
    }),
  };
}

/** Normalize a doc for golden comparison: drop volatile bookkeeping, tag → "TAG". */
export function normalizeDoc(value: unknown, tag: string): unknown {
  const VOLATILE = new Set([
    "createdAt", "updatedAt", "lastSyncedAt", "syncRunId", "assignRunId", "lastWriteSource",
    "lastCalculated", "lastUpdated", "lastModified", "lastReconciledAt", "reconciledAt", "trace_id",
    "traceId", "computedAt", "generatedAt", "restoredAt", "lastAssignedAt", "assignedAt", "processedAt",
    "lastTransactionSyncAt", "lastRecurringSyncAt",
    // Split ids are random (auto-ids) — compared by position instead.
    "splitId", "split_id",
  ]);
  const walk = (v: unknown): unknown => {
    if (v === null || v === undefined) return v ?? null;
    if (typeof v === "string") return v.split(tag).join("TAG");
    if (Array.isArray(v)) return v.map(walk);
    if (typeof v === "object") {
      const t = v as { toMillis?: () => number };
      if (typeof t.toMillis === "function") return { __ts: t.toMillis() };
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        if (VOLATILE.has(k)) continue;
        out[k] = walk((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return walk(value);
}

/** Everything the capture rules could touch for this user, normalized (golden material). */
export async function dumpScenario(db: Firestore, ids: ScenarioIds): Promise<Record<string, unknown>> {
  const byId = (snap: FirebaseFirestore.QuerySnapshot) =>
    Object.fromEntries(
      snap.docs
        .map((d) => [d.id.split(ids.tag).join("TAG"), normalizeDoc(d.data(), ids.tag)] as const)
        .sort(([a], [b]) => (a < b ? -1 : 1))
    );
  const [outflows, inflows, ops, ips, txns, reviews, jobs] = await Promise.all([
    db.collection("outflows").where("ownerId", "==", ids.userId).get(),
    db.collection("inflows").where("ownerId", "==", ids.userId).get(),
    db.collection("outflow_periods").where("ownerId", "==", ids.userId).get(),
    db.collection("inflow_periods").where("ownerId", "==", ids.userId).get(),
    db.collection("transactions").where("ownerId", "==", ids.userId).get(),
    db.collection("recurring_review_items").where("userId", "==", ids.userId).get(),
    db.collection("_jobs").where("payload.user_id", "==", ids.userId).get(),
  ]);
  const state = await db.collection("_recurring_review_state").doc(ids.userId).get();
  return {
    outflows: byId(outflows),
    inflows: byId(inflows),
    outflow_periods: Object.keys(byId(ops)).length,
    outflow_period_docs: byId(ops),
    inflow_periods: Object.keys(byId(ips)).length,
    inflow_period_docs: byId(ips),
    transactions: byId(txns),
    review_items: reviews.size,
    review_state_exists: state.exists,
    job_types: jobs.docs.map((d) => d.data().job_type).sort(),
  };
}
