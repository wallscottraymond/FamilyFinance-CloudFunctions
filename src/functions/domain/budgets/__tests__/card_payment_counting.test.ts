/**
 * Card payments are money movement, not spending (Trustworthy-Numbers D1).
 *
 * A linked card's purchases already count, so its payment must not count again:
 *   - paid from an account in the view, card in the view → NEITHER side counts;
 *   - card NOT in the view (not linked, or in another view) → the paying side counts, because it's
 *     the only record of that spending here;
 *   - the card-side credit NEVER reduces spending, paired or not;
 *   - ignoring one side changes nothing (the bug: −$18,147.80 in October);
 *   - a manual budget pin, or re-categorizing away from a card payment, is the user's word.
 */
import { Timestamp } from "firebase-admin/firestore";
import { build_category_catalog } from "../../transactions/split_category.service";
import {
  detect_card_payment_pairs_from_txns,
  map_raw_split_to_on_read_match,
} from "../../../resolvers/shared/on_read_matching";
import { stored_split_for_spend } from "../../../resolvers/budgets/budget_spend.resolver";
import { owned_splits_for_budget } from "../budget_spend_match.service";
import { compute_budget_spent, is_countable } from "../budget_spend.service";

const CARD = "LOAN_PAYMENTS_CREDIT_CARD_PAYMENT";
const catalog = build_category_catalog([
  { id: CARD, data: { firstCategoryId: "loan_payments", overallCategoryId: "o_loan" } },
  { id: "OTHER_EXPENSE", data: { firstCategoryId: "other", overallCategoryId: "o_other" } },
]);
const OCT = (d: number) => Date.UTC(2026, 9, d);
const EE = "ee";

function txn(id: string, account: string, amount: number, date_ms: number, type: "income" | "expense", extra: Record<string, unknown> = {}) {
  return {
    id,
    data: {
      transactionId: `p_${id}`,
      accountId: account,
      type,
      transactionDate: Timestamp.fromMillis(date_ms),
      plaidDetailedCategory: CARD,
      splits: [{ splitId: `${id}_s`, amount, plaidDetailedCategory: CARD, ...extra }],
    } as Record<string, unknown>,
  };
}

/** The page's calls for one view: pair → map → own → spent. */
function spent(view: ReturnType<typeof txn>[]): number {
  const paired = detect_card_payment_pairs_from_txns(view, catalog);
  const splits = view.flatMap(({ id, data }) =>
    (data.splits as Array<Record<string, unknown>>).map((s) =>
      map_raw_split_to_on_read_match(s, {
        txn_date_ms: (data.transactionDate as Timestamp).toMillis(),
        is_pending: false,
        is_transfer: false,
        is_paired_card_payment: paired.has(id),
        is_income: data.type === "income",
      }, catalog)
    )
  );
  return compute_budget_spent(EE, OCT(1), OCT(31), owned_splits_for_budget(EE, [], EE, splits)).spent;
}

describe("detect_card_payment_pairs_from_txns", () => {
  it("pairs same amount, different accounts, within the window, one for one", () => {
    const paired = detect_card_payment_pairs_from_txns([
      txn("out", "chk", 772, OCT(9), "expense"),
      txn("in", "card", 772, OCT(9), "income"),
      txn("out2", "chk", 772, OCT(20), "expense"),
    ], catalog);
    expect([...paired].sort()).toEqual(["in", "out"]);
  });
  it("does not pair across accounts' same side, a different amount, or too far apart", () => {
    expect(detect_card_payment_pairs_from_txns([
      txn("a", "chk", 100, OCT(1), "expense"),
      txn("b", "chk", 100, OCT(1), "income"),
      txn("c", "chk2", 200, OCT(1), "expense"),
      txn("d", "card", 201, OCT(1), "income"),
      txn("e", "chk3", 300, OCT(1), "expense"),
      txn("f", "card2", 300, OCT(20), "income"),
    ], catalog).size).toBe(0);
  });
  it("only looks at card payments", () => {
    const a = txn("a", "chk", 50, OCT(1), "expense");
    const b = txn("b", "card", 50, OCT(1), "income");
    for (const t of [a, b]) {
      t.data.plaidDetailedCategory = "OTHER_EXPENSE";
      (t.data.splits as Array<Record<string, unknown>>)[0].plaidDetailedCategory = "OTHER_EXPENSE";
    }
    expect(detect_card_payment_pairs_from_txns([a, b], catalog).size).toBe(0);
  });
});

describe("card payments in budget spend", () => {
  it("both sides in the view: neither counts", () => {
    expect(spent([txn("o", "chk", 772, OCT(9), "expense"), txn("i", "card", 772, OCT(9), "income")])).toBe(0);
  });
  it("October's bug: one side ignored is still zero, never negative", () => {
    expect(spent([
      txn("o", "chk", 24641.02, OCT(30), "expense", { spendStatus: "ignored", isIgnored: true }),
      txn("i", "card", 24641.02, OCT(31), "income"),
    ])).toBe(0);
  });
  it("card not in the view: the payment counts (the only record of that spending)", () => {
    expect(spent([txn("o", "chk", 300, OCT(13), "expense")])).toBe(300);
  });
  it("a card credit with no paying side never reduces spending", () => {
    expect(spent([txn("i", "card", 500, OCT(13), "income")])).toBe(0);
  });
  it("a payment whose sides fall in different months distorts neither month", () => {
    const view = [txn("o", "chk", 900, OCT(31), "expense"), txn("i", "card", 900, Date.UTC(2026, 10, 1), "income")];
    expect(spent(view)).toBe(0);
    const paired = detect_card_payment_pairs_from_txns(view, catalog);
    expect(paired.size).toBe(2);
  });
  it("a manual budget pin counts, the user's word (canon A4)", () => {
    expect(spent([
      txn("i", "card", 40, OCT(2), "income", { budgetAssignmentSource: "manual", budgetId: EE }),
    ])).toBe(-40);
  });
  it("a split re-categorized away from a card payment is ordinary money", () => {
    expect(spent([
      txn("o", "chk", 60, OCT(2), "expense", { plaidDetailedCategory: "OTHER_EXPENSE" }),
    ])).toBe(60);
  });
  it("the stored path agrees: a paired side and any card credit don't count", () => {
    const ctx = { txn_date_ms: OCT(9), is_pending: false, is_transfer: false, is_income: false };
    const raw = { budgetId: EE, amount: 772, plaidDetailedCategory: CARD };
    const base = { accountId: "chk", plaidDetailedCategory: CARD };
    const paid = stored_split_for_spend(raw, base, EE, "monthly", catalog, { ...ctx, is_paired_card_payment: true })!;
    const lone = stored_split_for_spend(raw, base, EE, "monthly", catalog, ctx)!;
    const credit = stored_split_for_spend(raw, base, EE, "monthly", catalog, { ...ctx, is_income: true })!;
    expect(is_countable(paid)).toBe(false);
    expect(is_countable(lone)).toBe(true);
    expect(is_countable(credit)).toBe(false);
  });
});

describe("view_cadence_of_window", () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { view_cadence_of_window: cad } = require("../../../orchestrators/budgets/derive_budget_transactions.orchestrator");
  const end = (y: number, m: number, d: number) => Date.UTC(y, m, d, 23, 59, 59, 999);
  it("reads the view from the period's length", () => {
    expect(cad(Date.UTC(2026, 9, 12), end(2026, 9, 18))).toBe("weekly");
    expect(cad(Date.UTC(2026, 11, 28), end(2026, 11, 31))).toBe("weekly"); // a short boundary week
    expect(cad(Date.UTC(2026, 9, 1), end(2026, 9, 15))).toBe("bi_monthly");
    expect(cad(Date.UTC(2026, 9, 16), end(2026, 9, 31))).toBe("bi_monthly");
    expect(cad(Date.UTC(2026, 1, 1), end(2026, 1, 28))).toBe("monthly");
    expect(cad(Date.UTC(2026, 9, 1), end(2026, 9, 31))).toBe("monthly");
  });
});

describe("D7: a card side labeled differently (Chase)", () => {
  const OTHER = "LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT";
  const chase = (id: string, amount: number, day: number, extra: Record<string, unknown> = {}) => {
    const t = txn(id, "chase_card", amount, OCT(day), "income", { plaidDetailedCategory: OTHER, ...extra });
    t.data.plaidDetailedCategory = OTHER;
    return t;
  };
  it("a same-amount credit on another account pairs, and neither side counts", () => {
    const view = [txn("o", "chk", 1283.71, OCT(9), "expense"), chase("i", 1283.71, 10)];
    expect([...detect_card_payment_pairs_from_txns(view, catalog)].sort()).toEqual(["i", "o"]);
    expect(spent(view)).toBe(0);
  });
  it("October's bug can't repeat: ignoring one side changes nothing", () => {
    expect(spent([
      txn("o", "chk", 1283.71, OCT(9), "expense", { spendStatus: "ignored", isIgnored: true }),
      chase("i", 1283.71, 10),
    ])).toBe(0);
  });
  it("a real card credit wins over a look-alike", () => {
    const paired = detect_card_payment_pairs_from_txns([
      txn("o", "chk", 50, OCT(9), "expense"),
      txn("i", "card", 50, OCT(11), "income"),
      chase("refund", 50, 10),
    ], catalog);
    expect([...paired].sort()).toEqual(["i", "o"]);
  });
  it("never a transfer, income, a user's pick, the same account, or a different amount", () => {
    const debit = txn("o", "chk", 75, OCT(9), "expense");
    const pool = (c: ReturnType<typeof txn>) => detect_card_payment_pairs_from_txns([debit, c], catalog).size;
    const coded = (code: string) => {
      const t = chase("c", 75, 10, { plaidDetailedCategory: code });
      t.data.plaidDetailedCategory = code;
      return t;
    };
    expect(pool(coded("TRANSFER_IN_ACCOUNT_TRANSFER"))).toBe(0);
    expect(pool(coded("INCOME_WAGES"))).toBe(0);
    expect(pool(chase("c", 75, 10, { categorySource: "user", firstCategoryId: "other" }))).toBe(0);
    const same = chase("c", 75, 10);
    same.data.accountId = "chk";
    expect(pool(same)).toBe(0);
    expect(pool(chase("c", 76, 10))).toBe(0);
  });
  it("needs a paying card payment: a lone credit stays an ordinary refund", () => {
    expect(detect_card_payment_pairs_from_txns([chase("c", 75, 10)], catalog).size).toBe(0);
  });
});

describe("D8: a payment waits for its card side", () => {
  const map = (ms: number, now_ms: number, extra: Record<string, unknown> = {}, income = false) =>
    map_raw_split_to_on_read_match(
      { amount: 900, plaidDetailedCategory: CARD, ...extra },
      { txn_date_ms: ms, is_pending: false, is_transfer: false, is_income: income, now_ms },
      catalog
    );
  const counted = (m: ReturnType<typeof map>) =>
    compute_budget_spent(EE, 0, Number.MAX_SAFE_INTEGER, owned_splits_for_budget(EE, [], EE, [m])).spent;
  const DAY = 24 * 60 * 60 * 1000;
  it("held for 5 days, then it counts", () => {
    const paid = OCT(10);
    expect(counted(map(paid, paid))).toBe(0);
    expect(counted(map(paid, paid + 5 * DAY - 1))).toBe(0);
    expect(counted(map(paid, paid + 5 * DAY))).toBe(900);
  });
  it("a date in the future isn't held, and a pin isn't held", () => {
    expect(counted(map(OCT(10), OCT(1)))).toBe(900);
    expect(counted(map(OCT(10), OCT(10), { budgetAssignmentSource: "manual", budgetId: EE }))).toBe(900);
  });
  it("only card payments are held", () => {
    expect(counted(map(OCT(10), OCT(10), { plaidDetailedCategory: "OTHER_EXPENSE" }))).toBe(900);
  });
});

describe("a user's pick wins over the pairing", () => {
  it("a paired look-alike credit re-picked as spending nets as a refund", () => {
    const m = map_raw_split_to_on_read_match(
      { amount: 40, plaidDetailedCategory: "LOAN_DISBURSEMENTS_OTHER_DISBURSEMENT", categorySource: "user", firstCategoryId: "other" },
      { txn_date_ms: OCT(2), is_pending: false, is_transfer: false, is_paired_card_payment: true, is_income: true },
      catalog
    );
    expect(m.is_transfer).toBe(false);
  });
  it("a credit tracked as income can't be a look-alike", () => {
    const debit = txn("o", "chk", 75, OCT(9), "expense");
    const credit = txn("c", "card", 75, OCT(10), "income", { plaidDetailedCategory: "OTHER_EXPENSE", inflowId: "paycheck" });
    credit.data.plaidDetailedCategory = "OTHER_EXPENSE";
    expect(detect_card_payment_pairs_from_txns([debit, credit], catalog).size).toBe(0);
  });
});
