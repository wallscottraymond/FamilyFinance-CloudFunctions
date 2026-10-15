/**
 * Transaction card payload (Tappable-Transaction-Rows)
 *
 * The slice of a stored transaction doc the app's `TransactionCard` (the one transaction row
 * used everywhere) renders: names, amount, date, pending, type / transfer role, note + tags,
 * and per split the category, budget, bill / income link and spend-status fields. The derive
 * callables that list transactions (budget detail, bill / income detail) already load the full
 * docs, so attaching this costs no extra reads. The app maps it with the SAME
 * `mapTransactionDoc` the Transactions list uses, so the row is identical everywhere.
 *
 * An ALLOWLIST (not the whole doc): keeps cached results small (`derived_budget_txn_cache` holds
 * a whole budget period in one doc — Everything Else can own hundreds of transactions) and keeps
 * raw Plaid data off the wire. Firestore Timestamps become epoch millis (a callable can't send a
 * Timestamp; `mapTransactionDoc` accepts millis).
 *
 * PURE: no IO.
 *
 * @module domain/transactions/transaction_card.service
 */

/** Top-level fields the card (and its helpers) read. */
const CARD_FIELDS = [
  "accountId",
  "ownerId",
  "userId",
  "amount",
  "transactionDate",
  "date",
  "dateTransacted",
  "datePosted",
  "isPending",
  "pending",
  "transactionStatus",
  "merchantName",
  "name",
  "description",
  "type",
  "transferRole",
  "tagIds",
  "userNotes",
  "categories",
  "category",
  "isSplit",
  "isActive",
  "isDeleted",
] as const;

/** Split fields the card reads: identity, amount, budget per lens, bill / income link, status,
 *  note / tags, and the category reference (Category canon M7: labels read `firstCategoryId`). */
const SPLIT_FIELDS = [
  "id",
  "splitId",
  "amount",
  "isDefault",
  "name",
  "description",
  "note",
  "tags",
  "budgetId",
  "budgetName",
  "monthlyBudgetId",
  "weeklyBudgetId",
  "biWeeklyBudgetId",
  "budgetAssignmentSource",
  "outflowId",
  "inflowId",
  "outflowAssignmentSource",
  "spendStatus",
  "isIgnored",
  "isRefund",
  "returnAmount",
  "isTaxDeductible",
  "categorySource",
  "firstCategoryId",
  "overallCategoryId",
  "secondCategoryId",
  "plaidDetailedCategory",
  "plaidPrimaryCategory",
] as const;

/** The card payload: `id` = the Firestore DOC id (what Transaction Detail loads). */
export type CardTransaction = { id: string } & Record<string, unknown>;

/** A Firestore Timestamp (or anything with `toMillis`) → epoch millis; other values unchanged. */
function to_wire(value: unknown): unknown {
  const to_millis = (value as Record<string, unknown> | null | undefined)?.["toMillis"];
  return typeof to_millis === "function" ? (to_millis as () => number).call(value) : value;
}

function pick(
  source: Record<string, unknown>,
  fields: ReadonlyArray<string>
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = source[f];
    if (v !== undefined) out[f] = to_wire(v);
  }
  return out;
}

/** A stored transaction doc → the card payload. PURE. */
export function to_card_transaction(
  doc_id: string,
  data: Record<string, unknown>
): CardTransaction {
  const card = pick(data, CARD_FIELDS);
  const splits = Array.isArray(data.splits) ? (data.splits as Array<Record<string, unknown>>) : [];
  card.splits = splits.map((s) => pick(s ?? {}, SPLIT_FIELDS));
  return { ...card, id: doc_id };
}
